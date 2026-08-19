const { GAME_CONFIG } = require('../config');

const ROOM_STATUS = { WAITING: 'waiting', IN_PROGRESS: 'in_progress', FINISHED: 'finished' };

function createRoom(id, direction = GAME_CONFIG.DIRECTION.ONE_WAY, eatMode = GAME_CONFIG.EAT_MODE.CHAIN) {
  return {
    id,
    players: [],
    spectators: [],
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
    discardOwnerId: null,
    ledger: {},
  };
}

function findPlayer(room, userId) {
  return room.players.find(p => p.userId === userId) || null;
}

function addPlayer(room, userId, socketId, username = userId) {
  const existing = findPlayer(room, userId);
  if (existing) {
    existing.socketId = socketId;
    existing.connected = true;
    existing.username = username;
    return { room, player: existing, reconnected: true };
  }
  if (room.status !== ROOM_STATUS.WAITING) {
    throw new Error('Room is not accepting new players');
  }
  if (room.players.length >= GAME_CONFIG.MAX_PLAYERS) {
    throw new Error('Room is full');
  }
  // Lazy require avoids a circular top-level dependency: spectator.js
  // requires findPlayer from this module at load time.
  const { findSpectator } = require('./spectator');
  if (findSpectator(room, userId)) {
    throw new Error('Already a spectator in this room');
  }
  const player = {
    userId,
    socketId,
    username,
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

// Moves a seated player to the rail as a spectator ("stand up" / stop playing
// without leaving the room). Callers gate this to between-round windows.
function standPlayer(room, userId) {
  const player = findPlayer(room, userId);
  if (!player) {
    throw new Error('Player not in room');
  }
  room.players = room.players.filter(p => p.userId !== userId);
  room.spectators.push({ userId: player.userId, socketId: player.socketId, username: player.username });
  return room;
}

// Moves a spectator into a seat ("sit down" to play). Callers may defer the
// actual move (via a pendingSit marker) until the current round ends.
function sitPlayer(room, userId, socketId) {
  // Lazy require avoids a circular top-level dependency, same as addPlayer above.
  const { findSpectator } = require('./spectator');
  const spectator = findSpectator(room, userId);
  if (!spectator) {
    throw new Error('Spectator not in room');
  }
  if (room.players.length >= GAME_CONFIG.MAX_PLAYERS) {
    throw new Error('Room is full');
  }
  room.spectators = room.spectators.filter(s => s.userId !== userId);
  const player = {
    userId,
    socketId: socketId || spectator.socketId,
    username: spectator.username || userId,
    hand: [],
    ready: false,
    connected: true,
    handScore: 0,
    declaredKaeng: false,
  };
  room.players.push(player);
  return { room, player };
}

module.exports = { ROOM_STATUS, createRoom, findPlayer, addPlayer, removePlayer, standPlayer, sitPlayer };
