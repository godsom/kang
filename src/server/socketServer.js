const { createServer } = require('http');
const { Server } = require('socket.io');
const { createRoomStore } = require('./roomStore');
const { createRoom, addPlayer, findPlayer, removePlayer, standPlayer, sitPlayer, ROOM_STATUS } = require('./room');
const { setPlayerReady, canStart, startRound } = require('./roomLifecycle');
const { getPlayerView, getSpectatorView } = require('./playerView');
const { disconnectPlayer } = require('./roomConnection');
const { addSpectator, removeSpectator, findSpectator } = require('./spectator');
const { applyDraw, applyDiscard, applyEat } = require('./turnActions');
const { resolveDeckExhaustedWinner, applyKaengDeclaration, finishRound } = require('./roundEnd');
const { VOICE_CONFIG } = require('../config');
const { createVoiceToken } = require('../voice/tokens');
const { createPool } = require('../auth/db');
const { createRedisClient } = require('./redisClient');
const { recordRoundOutcome, getLeaderboard } = require('./stats');
const { verifyToken } = require('../auth/tokens');
const { pickAutoDiscardCard, createTurnTimerManager } = require('./turnTimer');
const { computeSettlement, withUsernames } = require('./ledger');
const { GAME_CONFIG } = require('../config');

function createSocketServer() {
  const httpServer = createServer();
  const io = new Server(httpServer, { cors: { origin: '*' } });
  const roomStore = createRoomStore();
  const socketIndex = new Map(); // socket.id -> { roomId, userId }
  const authenticatedSockets = new Map(); // socket.id -> { userId, username }
  const pool = createPool();
  const redisClient = createRedisClient();
  let redisConnectPromise = null;

  function ensureRedisConnected() {
    if (redisConnectPromise) {
      return redisConnectPromise;
    }
    if (redisClient.isOpen) {
      return Promise.resolve();
    }
    redisConnectPromise = redisClient.connect();
    return redisConnectPromise;
  }

  function broadcastRoomState(room) {
    room.players.forEach(player => {
      const socket = io.sockets.sockets.get(player.socketId);
      if (socket) {
        socket.emit('room:state', getPlayerView(room, player.userId));
      }
    });
    if (room.spectators.length > 0) {
      const spectatorView = getSpectatorView(room);
      room.spectators.forEach(spectator => {
        const socket = io.sockets.sockets.get(spectator.socketId);
        if (socket) {
          socket.emit('room:state', spectatorView);
        }
      });
    }
  }

  function broadcastGameResult(room, outcome) {
    room.players.forEach(player => {
      const socket = io.sockets.sockets.get(player.socketId);
      if (socket) {
        socket.emit('game:result', outcome);
      }
    });
    room.spectators.forEach(spectator => {
      const socket = io.sockets.sockets.get(spectator.socketId);
      if (socket) {
        socket.emit('game:result', outcome);
      }
    });
  }

  function handleTurnTimeout(roomId) {
    const room = roomStore.get(roomId);
    if (!room || room.status !== ROOM_STATUS.IN_PROGRESS) return;
    const player = room.players[room.turnIndex];
    if (!player) return;
    try {
      if (!room.awaitingDiscard) {
        const drawResult = applyDraw(room, player.userId);
        if (drawResult.deckExhausted) {
          endRound(room, resolveDeckExhaustedWinner(room.players));
          return;
        }
      }
      const card = pickAutoDiscardCard(player.hand);
      applyDiscard(room, player.userId, card);
    } catch (err) {
      console.error('Turn timeout auto-action failed:', err.message);
    }
    broadcastRoomState(room);
    turnTimers.schedule(room);
  }

  const turnTimers = createTurnTimerManager({ onTimeout: handleTurnTimeout });

  function promotePendingSitters(room) {
    room.spectators
      .filter(s => s.pendingSit)
      .forEach(s => {
        sitPlayer(room, s.userId, s.socketId);
        socketIndex.set(s.socketId, { roomId: room.id, userId: s.userId, isSpectator: false });
      });
  }

  async function endRound(room, result) {
    turnTimers.clear(room.id);
    const outcome = finishRound(room, result);
    promotePendingSitters(room);
    broadcastGameResult(room, outcome);
    broadcastRoomState(room);
    try {
      await ensureRedisConnected();
      await recordRoundOutcome(pool, redisClient, room, outcome);
    } catch (err) {
      console.error('Failed to record round outcome:', err.message);
    }
  }

  function getRoomForSocket(socket) {
    const entry = socketIndex.get(socket.id);
    if (!entry) return null;
    const room = roomStore.get(entry.roomId);
    if (!room) return null;
    return { room, userId: entry.userId, isSpectator: entry.isSpectator };
  }

  io.on('connection', (socket) => {
    socket.on('auth', ({ token }) => {
      const payload = token ? verifyToken(token) : null;
      if (!payload) {
        socket.emit('auth:error', { message: 'Invalid token' });
        return;
      }
      authenticatedSockets.set(socket.id, { userId: payload.userId, username: payload.username });
      socket.emit('auth:ok', { userId: payload.userId });
    });

    socket.on('room:join', ({ roomId, asSpectator }) => {
      const auth = authenticatedSockets.get(socket.id);
      if (!auth) {
        socket.emit('room:error', { message: 'Not authenticated' });
        return;
      }
      const { userId, username } = auth;
      let room = roomStore.get(roomId);
      if (!room) {
        room = createRoom(roomId);
        roomStore.set(roomId, room);
      }
      if (asSpectator) {
        try {
          addSpectator(room, userId, socket.id, username);
        } catch (err) {
          socket.emit('room:error', { message: err.message });
          return;
        }
        socketIndex.set(socket.id, { roomId, userId, isSpectator: true });
        socket.join(roomId);
        broadcastRoomState(room);
        return;
      }
      try {
        addPlayer(room, userId, socket.id, username);
      } catch (err) {
        socket.emit('room:error', { message: err.message });
        return;
      }
      socketIndex.set(socket.id, { roomId, userId, isSpectator: false });
      socket.join(roomId);
      broadcastRoomState(room);
    });

    socket.on('player:ready', ({ ready }) => {
      const ctx = getRoomForSocket(socket);
      if (!ctx) return;
      setPlayerReady(ctx.room, ctx.userId, ready);
      if (canStart(ctx.room)) {
        startRound(ctx.room);
        turnTimers.schedule(ctx.room);
      }
      broadcastRoomState(ctx.room);
    });

    socket.on('game:draw', () => {
      const ctx = getRoomForSocket(socket);
      if (!ctx) return;
      let result;
      try {
        result = applyDraw(ctx.room, ctx.userId);
      } catch (err) {
        socket.emit('game:error', { message: err.message });
        return;
      }
      if (result.deckExhausted) {
        endRound(ctx.room, resolveDeckExhaustedWinner(ctx.room.players));
        return;
      }
      broadcastRoomState(ctx.room);
    });

    socket.on('game:discard', ({ card }) => {
      const ctx = getRoomForSocket(socket);
      if (!ctx) return;
      try {
        applyDiscard(ctx.room, ctx.userId, card);
      } catch (err) {
        socket.emit('game:error', { message: err.message });
        return;
      }
      turnTimers.schedule(ctx.room);
      broadcastRoomState(ctx.room);
    });

    socket.on('game:eat', ({ card }) => {
      const ctx = getRoomForSocket(socket);
      if (!ctx) return;
      try {
        applyEat(ctx.room, ctx.userId, card);
      } catch (err) {
        socket.emit('game:error', { message: err.message });
        return;
      }
      turnTimers.schedule(ctx.room);
      broadcastRoomState(ctx.room);
    });

    socket.on('game:kaeng', () => {
      const ctx = getRoomForSocket(socket);
      if (!ctx) return;
      let result;
      try {
        result = applyKaengDeclaration(ctx.room, ctx.userId);
      } catch (err) {
        socket.emit('game:error', { message: err.message });
        return;
      }
      endRound(ctx.room, result);
    });

    socket.on('voice:join', async ({ roomId, role }) => {
      const ctx = getRoomForSocket(socket);
      if (!ctx || ctx.room.id !== roomId) {
        socket.emit('voice:error', { message: 'Not a member of this room' });
        return;
      }
      const expectedRole = ctx.isSpectator ? 'spectator' : 'player';
      if (role !== expectedRole) {
        socket.emit('voice:error', { message: `Only ${expectedRole} voice access is available for this membership` });
        return;
      }
      let token;
      try {
        token = await createVoiceToken({
          apiKey: process.env.LIVEKIT_API_KEY,
          apiSecret: process.env.LIVEKIT_API_SECRET,
          roomName: ctx.room.id,
          identity: ctx.userId,
          canPublish: !ctx.isSpectator,
          canSubscribe: true,
        });
      } catch (err) {
        socket.emit('voice:error', { message: 'Failed to issue voice token' });
        return;
      }
      socket.emit('voice:token', {
        token,
        url: process.env.LIVEKIT_URL,
        pushToTalk: VOICE_CONFIG.pushToTalk,
      });
    });

    socket.on('player:stand', () => {
      const ctx = getRoomForSocket(socket);
      if (!ctx || ctx.isSpectator) return;
      if (ctx.room.status !== ROOM_STATUS.WAITING) {
        socket.emit('room:error', { message: 'Can only stand between rounds' });
        return;
      }
      try {
        standPlayer(ctx.room, ctx.userId);
      } catch (err) {
        socket.emit('room:error', { message: err.message });
        return;
      }
      socketIndex.set(socket.id, { roomId: ctx.room.id, userId: ctx.userId, isSpectator: true });
      broadcastRoomState(ctx.room);
    });

    socket.on('player:sit', () => {
      const ctx = getRoomForSocket(socket);
      if (!ctx || !ctx.isSpectator) return;
      if (ctx.room.status !== ROOM_STATUS.WAITING) {
        // Queue to be seated once the current round finishes rather than
        // joining mid-round with no cards and a corrupted turn order.
        const spectator = findSpectator(ctx.room, ctx.userId);
        if (spectator) spectator.pendingSit = true;
        broadcastRoomState(ctx.room);
        return;
      }
      try {
        sitPlayer(ctx.room, ctx.userId, socket.id);
      } catch (err) {
        socket.emit('room:error', { message: err.message });
        return;
      }
      socketIndex.set(socket.id, { roomId: ctx.room.id, userId: ctx.userId, isSpectator: false });
      broadcastRoomState(ctx.room);
    });

    socket.on('player:quit', () => {
      const ctx = getRoomForSocket(socket);
      if (!ctx) return;
      if (ctx.isSpectator) {
        removeSpectator(ctx.room, ctx.userId);
      } else {
        if (ctx.room.status !== ROOM_STATUS.WAITING) {
          socket.emit('room:error', { message: 'Can only quit between rounds' });
          return;
        }
        removePlayer(ctx.room, ctx.userId);
      }
      socketIndex.delete(socket.id);
      if (ctx.room.players.length === 0 && ctx.room.spectators.length === 0) {
        turnTimers.clear(ctx.room.id);
        roomStore.delete(ctx.room.id);
        return;
      }
      broadcastRoomState(ctx.room);
    });

    socket.on('session:end', () => {
      const ctx = getRoomForSocket(socket);
      if (!ctx || ctx.isSpectator) return;
      const settlements = withUsernames(ctx.room, computeSettlement(ctx.room, GAME_CONFIG.BAHT_PER_POINT));
      ctx.room.ledger = {};
      const payload = { settlements };
      ctx.room.players.forEach(p => {
        const playerSocket = io.sockets.sockets.get(p.socketId);
        if (playerSocket) playerSocket.emit('session:settlement', payload);
      });
      ctx.room.spectators.forEach(s => {
        const spectatorSocket = io.sockets.sockets.get(s.socketId);
        if (spectatorSocket) spectatorSocket.emit('session:settlement', payload);
      });
      broadcastRoomState(ctx.room);
    });

    socket.on('leaderboard:get', async ({ type, limit }) => {
      try {
        await ensureRedisConnected();
        const entries = await getLeaderboard(redisClient, type, limit);
        socket.emit('leaderboard:result', { type: type || 'wins', entries });
      } catch (err) {
        socket.emit('leaderboard:error', { message: 'Failed to fetch leaderboard' });
      }
    });

    socket.on('disconnect', () => {
      authenticatedSockets.delete(socket.id);
      const entry = socketIndex.get(socket.id);
      if (!entry) return;
      socketIndex.delete(socket.id);
      const room = roomStore.get(entry.roomId);
      if (!room) return;

      if (entry.isSpectator) {
        removeSpectator(room, entry.userId);
        if (room.players.length === 0 && room.spectators.length === 0) {
          turnTimers.clear(entry.roomId);
          roomStore.delete(entry.roomId);
          return;
        }
        broadcastRoomState(room);
        return;
      }

      const player = findPlayer(room, entry.userId);
      // If a newer socket has already reconnected this player (e.g. a rejoin
      // landing before this stale disconnect is processed), ignore it.
      if (!player || player.socketId !== socket.id) return;
      const { room: updatedRoom } = disconnectPlayer(room, entry.userId);
      if (updatedRoom.players.length === 0 && updatedRoom.spectators.length === 0) {
        turnTimers.clear(entry.roomId);
        roomStore.delete(entry.roomId);
        return;
      }
      broadcastRoomState(updatedRoom);
    });
  });

  return { httpServer, io, roomStore, pool, redisClient };
}

module.exports = { createSocketServer };
