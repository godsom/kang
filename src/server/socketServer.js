const { createServer } = require('http');
const { Server } = require('socket.io');
const { createRoomStore } = require('./roomStore');
const { createRoom, addPlayer, findPlayer } = require('./room');
const { setPlayerReady, canStart, startRound } = require('./roomLifecycle');
const { getPlayerView, getSpectatorView } = require('./playerView');
const { disconnectPlayer } = require('./roomConnection');
const { addSpectator, removeSpectator } = require('./spectator');
const { applyDraw, applyDiscard, applyEat } = require('./turnActions');
const { resolveDeckExhaustedWinner, applyKaengDeclaration, finishRound } = require('./roundEnd');
const { VOICE_CONFIG } = require('../config');
const { createVoiceToken } = require('../voice/tokens');

function createSocketServer() {
  const httpServer = createServer();
  const io = new Server(httpServer, { cors: { origin: '*' } });
  const roomStore = createRoomStore();
  const socketIndex = new Map(); // socket.id -> { roomId, userId }

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

  function endRound(room, result) {
    const outcome = finishRound(room, result);
    broadcastGameResult(room, outcome);
    broadcastRoomState(room);
  }

  function getRoomForSocket(socket) {
    const entry = socketIndex.get(socket.id);
    if (!entry) return null;
    const room = roomStore.get(entry.roomId);
    if (!room) return null;
    return { room, userId: entry.userId, isSpectator: entry.isSpectator };
  }

  io.on('connection', (socket) => {
    socket.on('room:join', ({ roomId, userId, asSpectator }) => {
      let room = roomStore.get(roomId);
      if (!room) {
        room = createRoom(roomId);
        roomStore.set(roomId, room);
      }
      if (asSpectator) {
        try {
          addSpectator(room, userId, socket.id);
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
        addPlayer(room, userId, socket.id);
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

    socket.on('disconnect', () => {
      const entry = socketIndex.get(socket.id);
      if (!entry) return;
      socketIndex.delete(socket.id);
      const room = roomStore.get(entry.roomId);
      if (!room) return;

      if (entry.isSpectator) {
        removeSpectator(room, entry.userId);
        if (room.players.length === 0 && room.spectators.length === 0) {
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
        roomStore.delete(entry.roomId);
        return;
      }
      broadcastRoomState(updatedRoom);
    });
  });

  return { httpServer, io, roomStore };
}

module.exports = { createSocketServer };
