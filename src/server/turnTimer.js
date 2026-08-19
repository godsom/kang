const { GAME_CONFIG } = require('../config');
const { ROOM_STATUS } = require('./room');

const TURN_DURATION_MS = 10000;

// Suggests the card to auto-discard on turn timeout: prefers keeping pairs
// (they're worth more toward ตอง), so it picks the highest-value card that
// isn't part of a pair, falling back to the highest-value card overall.
function pickAutoDiscardCard(hand) {
  const counts = {};
  hand.forEach(c => { counts[c.rank] = (counts[c.rank] || 0) + 1; });
  const unpaired = hand.filter(c => counts[c.rank] === 1);
  const pool = unpaired.length > 0 ? unpaired : hand;
  return pool.reduce((highest, c) => (
    GAME_CONFIG.RANK_VALUE[c.rank] > GAME_CONFIG.RANK_VALUE[highest.rank] ? c : highest
  ), pool[0]);
}

function createTurnTimerManager({ onTimeout }) {
  const timers = new Map(); // roomId -> timeout handle

  function clear(roomId) {
    const handle = timers.get(roomId);
    if (handle) {
      clearTimeout(handle);
      timers.delete(roomId);
    }
  }

  function schedule(room) {
    clear(room.id);
    if (room.status !== ROOM_STATUS.IN_PROGRESS) {
      room.turnDeadline = null;
      return;
    }
    room.turnDeadline = Date.now() + TURN_DURATION_MS;
    const handle = setTimeout(() => onTimeout(room.id), TURN_DURATION_MS);
    timers.set(room.id, handle);
  }

  return { schedule, clear };
}

module.exports = { TURN_DURATION_MS, pickAutoDiscardCard, createTurnTimerManager };
