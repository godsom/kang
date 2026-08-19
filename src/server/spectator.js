const { SPECTATOR_CONFIG } = require('../config');
const { findPlayer } = require('./room');

function findSpectator(room, userId) {
  return room.spectators.find(s => s.userId === userId) || null;
}

function addSpectator(room, userId, socketId, username = userId) {
  const existing = findSpectator(room, userId);
  if (existing) {
    existing.socketId = socketId;
    existing.username = username;
    return { room, spectator: existing, reconnected: true };
  }
  if (findPlayer(room, userId)) {
    throw new Error('Already a player in this room');
  }
  if (room.spectators.length >= SPECTATOR_CONFIG.maxPerRoom) {
    throw new Error('Room is full of spectators');
  }
  const spectator = { userId, socketId, username };
  room.spectators.push(spectator);
  return { room, spectator, reconnected: false };
}

function removeSpectator(room, userId) {
  room.spectators = room.spectators.filter(s => s.userId !== userId);
  return room;
}

module.exports = { findSpectator, addSpectator, removeSpectator };
