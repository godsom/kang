const { createServer } = require('http');
const { Server } = require('socket.io');
const { createRoomStore } = require('./roomStore');
const { createRoom, addPlayer, findPlayer, removePlayer, standPlayer, sitPlayer, ROOM_STATUS } = require('./room');
const { setPlayerReady, canStart, ensureDealer, dealRound } = require('./roomLifecycle');
const { getPlayerView, getSpectatorView, getRoomSummary } = require('./playerView');
const { disconnectPlayer } = require('./roomConnection');
const { addSpectator, removeSpectator, findSpectator } = require('./spectator');
const { applyDraw, applyDiscard, applyMultiDiscard, applyEat, applyMultiEat } = require('./turnActions');
const { resolveDeckExhaustedWinner, applyKaengDeclaration, finishRound } = require('./roundEnd');
const { VOICE_CONFIG } = require('../config');
const { createVoiceToken } = require('../voice/tokens');
const { createPool } = require('../auth/db');
const { createRedisClient } = require('./redisClient');
const { recordRoundOutcome, getLeaderboard } = require('./stats');
const { verifyToken } = require('../auth/tokens');
const { pickAutoDiscardCard, createTurnTimerManager } = require('./turnTimer');
const { computeSettlement, withUsernames } = require('./ledger');
const { calcHandScore } = require('../handScore');
const { GAME_CONFIG } = require('../config');

function createSocketServer({ databaseUrl = process.env.DATABASE_URL } = {}) {
  const httpServer = createServer();
  const io = new Server(httpServer, { cors: { origin: '*' } });
  const roomStore = createRoomStore();
  const socketIndex = new Map(); // socket.id -> { roomId, userId }
  const authenticatedSockets = new Map(); // socket.id -> { userId, username }
  const activeUserSockets = new Map(); // userId -> socket.id of that user's current session
  const pool = createPool(databaseUrl);
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

  function demotePendingStanders(room) {
    room.players
      .filter(p => p.pendingStand)
      .forEach(p => {
        const socketId = p.socketId;
        standPlayer(room, p.userId);
        socketIndex.set(socketId, { roomId: room.id, userId: p.userId, isSpectator: true });
      });
  }

  async function endRound(room, result) {
    turnTimers.clear(room.id);
    const outcome = finishRound(room, result);
    // Snapshot usernames + final hand score before promote/demote can move a
    // player to spectator (or vice versa) and before the next deal overwrites
    // hands — game:result must resolve winner/payout names and each player's
    // final score against who was actually in the round, not whoever/whatever
    // room.players is by the time the client renders it. The round is over,
    // so revealing everyone's final score here is fine — nothing is secret
    // anymore, unlike mid-round hands.
    const roster = room.players.map(p => ({
      userId: p.userId,
      username: p.username || p.userId,
      handScore: calcHandScore(p.hand),
    }));
    promotePendingSitters(room);
    demotePendingStanders(room);
    broadcastGameResult(room, { ...outcome, roster });
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
      // One account, one active session: a fresh login for this userId kicks
      // out whatever socket previously held it (e.g. an older tab/device),
      // rather than letting both act on the same seat at once. A server-
      // initiated disconnect does not auto-reconnect on the client, so this
      // doesn't turn into a kick war between the two sockets.
      const previousSocketId = activeUserSockets.get(payload.userId);
      if (previousSocketId && previousSocketId !== socket.id) {
        const previousSocket = io.sockets.sockets.get(previousSocketId);
        if (previousSocket) {
          previousSocket.emit('auth:error', { message: 'Logged in from another session' });
          previousSocket.disconnect(true);
        }
      }
      activeUserSockets.set(payload.userId, socket.id);
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
      // Only picks who the dealer is (once) — the actual hand deal is a
      // separate, explicit action the dealer triggers with game:deal.
      if (canStart(ctx.room)) {
        ensureDealer(ctx.room);
      }
      broadcastRoomState(ctx.room);
    });

    socket.on('game:deal', () => {
      const ctx = getRoomForSocket(socket);
      if (!ctx) return;
      if (!canStart(ctx.room)) {
        socket.emit('room:error', { message: 'Not everyone is ready yet' });
        return;
      }
      if (ctx.room.dealerId !== ctx.userId) {
        socket.emit('room:error', { message: 'Only the dealer can deal' });
        return;
      }
      dealRound(ctx.room);
      turnTimers.schedule(ctx.room);
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
      // Without this, the turn timer set when the turn STARTED keeps running
      // through the draw — so a player who takes a while to draw gets no
      // fresh window to actually pick a discard, and the still-ticking timer
      // fires right after, force-discarding a card the player never chose.
      turnTimers.schedule(ctx.room);
      broadcastRoomState(ctx.room);
    });

    socket.on('game:discard', ({ card, cards }) => {
      const ctx = getRoomForSocket(socket);
      if (!ctx) return;
      try {
        if (cards) {
          applyMultiDiscard(ctx.room, ctx.userId, cards);
        } else {
          applyDiscard(ctx.room, ctx.userId, card);
        }
      } catch (err) {
        socket.emit('game:error', { message: err.message });
        return;
      }
      turnTimers.schedule(ctx.room);
      broadcastRoomState(ctx.room);
    });

    socket.on('game:eat', ({ card, cards }) => {
      const ctx = getRoomForSocket(socket);
      if (!ctx) return;
      try {
        if (cards) {
          applyMultiEat(ctx.room, ctx.userId, cards);
        } else {
          applyEat(ctx.room, ctx.userId, card);
        }
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
        // Mid-round, standing is deferred: finish the current round, then
        // move to the rail once it ends (see promotePendingSitters's sibling
        // below) rather than leaving mid-hand or erroring out.
        const player = findPlayer(ctx.room, ctx.userId);
        if (player) player.pendingStand = true;
        broadcastRoomState(ctx.room);
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
      // The quitting socket is no longer in room.players/spectators, so the
      // broadcast below won't reach it — tell it directly that it has no
      // room anymore, or its own screen would never update.
      socket.emit('room:state', null);
      if (ctx.room.players.length === 0 && ctx.room.spectators.length === 0) {
        turnTimers.clear(ctx.room.id);
        roomStore.delete(ctx.room.id);
        return;
      }
      broadcastRoomState(ctx.room);
    });

    socket.on('session:end', () => {
      const ctx = getRoomForSocket(socket);
      if (!ctx) return;
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

    socket.on('settlement:clear', ({ from }) => {
      const ctx = getRoomForSocket(socket);
      if (!ctx) return;
      // Only the creditor (who was owed the money) can confirm it was paid
      // and clear the debt — a debtor cannot clear their own debt.
      if (ctx.room.ledger[from]) {
        delete ctx.room.ledger[from][ctx.userId];
      }
      broadcastRoomState(ctx.room);
    });

    socket.on('rooms:list', () => {
      const rooms = roomStore.all()
        .filter(r => r.players.length > 0)
        .map(getRoomSummary);
      socket.emit('rooms:list', { rooms });
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
      const authEntry = authenticatedSockets.get(socket.id);
      authenticatedSockets.delete(socket.id);
      // Only clear the active-session pointer if it's still this socket — a
      // newer login may have already replaced it and claimed the pointer.
      if (authEntry && activeUserSockets.get(authEntry.userId) === socket.id) {
        activeUserSockets.delete(authEntry.userId);
      }
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
