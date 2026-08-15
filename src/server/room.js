const { GAME_CONFIG } = require('../config');

const ROOM_STATUS = { WAITING: 'waiting', IN_PROGRESS: 'in_progress', FINISHED: 'finished' };

function createRoom(id, direction = GAME_CONFIG.DIRECTION.ONE_WAY, eatMode = GAME_CONFIG.EAT_MODE.CHAIN) {
  return {
    id,
    players: [],
    direction,
    eatMode,
    deck: [],
    discardPile: [],
    turnIndex: 0,
    directionSign: 1,
    dealerId: null,
    pot: 0,
    status: ROOM_STATUS.WAITING,
    isFirstTurn: true,
  };
}

function findPlayer(room, userId) {
  return room.players.find(p => p.userId === userId) || null;
}

function addPlayer(room, userId, socketId) {
  const existing = findPlayer(room, userId);
  if (existing) {
    existing.socketId = socketId;
    existing.connected = true;
    return { room, player: existing, reconnected: true };
  }
  if (room.status !== ROOM_STATUS.WAITING) {
    throw new Error('Room is not accepting new players');
  }
  if (room.players.length >= GAME_CONFIG.MAX_PLAYERS) {
    throw new Error('Room is full');
  }
  const player = {
    userId,
    socketId,
    hand: [],
    ready: false,
    connected: true,
    handScore: 0,
    declaredKaeng: false,
  };
  room.players.push(player);
  return { room, player, reconnected: false };
}

function removePlayer(room, userId) {
  room.players = room.players.filter(p => p.userId !== userId);
  return room;
}

module.exports = { ROOM_STATUS, createRoom, findPlayer, addPlayer, removePlayer };
