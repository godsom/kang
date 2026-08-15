const { createRoom, addPlayer, ROOM_STATUS } = require('../../src/server/room');
const { disconnectPlayer } = require('../../src/server/roomConnection');

describe('disconnectPlayer', () => {
  test('removes the player outright while the room is waiting', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    addPlayer(room, 'bob', 's2');
    const { removed } = disconnectPlayer(room, 'alice');
    expect(removed).toBe(true);
    expect(room.players).toHaveLength(1);
    expect(room.players[0].userId).toBe('bob');
  });

  test('marks the player disconnected but keeps their hand while in progress', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    room.status = ROOM_STATUS.IN_PROGRESS;
    room.players[0].hand = [{ suit: 'spades', rank: 'A' }];
    const { removed } = disconnectPlayer(room, 'alice');
    expect(removed).toBe(false);
    expect(room.players).toHaveLength(1);
    expect(room.players[0].connected).toBe(false);
    expect(room.players[0].hand).toEqual([{ suit: 'spades', rank: 'A' }]);
  });

  test('is a no-op for an unknown userId', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    const { removed } = disconnectPlayer(room, 'ghost');
    expect(removed).toBe(false);
    expect(room.players).toHaveLength(1);
  });

  test('reconnecting after an in-progress disconnect restores connected status', () => {
    const { addPlayer: reAddPlayer } = require('../../src/server/room');
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    room.status = ROOM_STATUS.IN_PROGRESS;
    disconnectPlayer(room, 'alice');
    expect(room.players[0].connected).toBe(false);
    const { reconnected } = reAddPlayer(room, 'alice', 's2');
    expect(reconnected).toBe(true);
    expect(room.players[0].connected).toBe(true);
    expect(room.players[0].socketId).toBe('s2');
  });
});
