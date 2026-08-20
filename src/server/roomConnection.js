const { ROOM_STATUS, findPlayer, removePlayer } = require('./room');

function disconnectPlayer(room, userId) {
  const player = findPlayer(room, userId);
  if (!player) {
    return { room, removed: false };
  }
  if (room.status === ROOM_STATUS.WAITING) {
    return { room: removePlayer(room, userId), removed: true };
  }
  player.connected = false;
  // A disconnected player can't act, so their turn (if/when it comes up)
  // resolves via the existing turn-timeout auto-play — they effectively
  // "play out" the rest of this round automatically. Queue them to actually
  // leave the seat once it ends, same as an explicit mid-round พัก, rather
  // than holding their seat open indefinitely for a reconnect.
  player.pendingStand = true;
  return { room, removed: false };
}

module.exports = { disconnectPlayer };
