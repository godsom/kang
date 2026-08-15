function createRoomStore() {
  const rooms = new Map();
  return {
    get(roomId) {
      return rooms.get(roomId) || null;
    },
    set(roomId, room) {
      rooms.set(roomId, room);
      return room;
    },
    delete(roomId) {
      rooms.delete(roomId);
    },
    has(roomId) {
      return rooms.has(roomId);
    },
  };
}

module.exports = { createRoomStore };
