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
  return { room, removed: false };
}

module.exports = { disconnectPlayer };
