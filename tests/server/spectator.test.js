const { createRoom, addPlayer, ROOM_STATUS } = require('../../src/server/room');
const { findSpectator, addSpectator, removeSpectator } = require('../../src/server/spectator');

describe('addSpectator', () => {
  test('adds a new spectator to the room', () => {
    const room = createRoom('room1');
    const { spectator, reconnected } = addSpectator(room, 'alice', 's1');
    expect(reconnected).toBe(false);
    expect(spectator).toEqual({ userId: 'alice', socketId: 's1', username: 'alice' });
    expect(room.spectators).toHaveLength(1);
    expect(findSpectator(room, 'alice')).toBe(spectator);
  });

  test('stores a display username, defaulting to the userId when not given', () => {
    const room = createRoom('room1');
    const { spectator } = addSpectator(room, 'bob', 's1', 'Bobby');
    expect(spectator.username).toBe('Bobby');
  });

  test('rejoining with the same userId rebinds the socket instead of duplicating', () => {
    const room = createRoom('room1');
    addSpectator(room, 'alice', 's1');
    const { spectator, reconnected } = addSpectator(room, 'alice', 's2');
    expect(reconnected).toBe(true);
    expect(spectator.socketId).toBe('s2');
    expect(room.spectators).toHaveLength(1);
  });

  test('rejects a new spectator once the room hits maxPerRoom', () => {
    const room = createRoom('room1');
    for (let i = 0; i < 50; i++) addSpectator(room, `s${i}`, `sock${i}`);
    expect(() => addSpectator(room, 'newcomer', 'sockX')).toThrow('Room is full of spectators');
  });

  test('a spectator can join regardless of room status or player count', () => {
    const room = createRoom('room1');
    addPlayer(room, 'p1', 'ps1');
    room.status = ROOM_STATUS.IN_PROGRESS;
    const { reconnected } = addSpectator(room, 'watcher', 'ws1');
    expect(reconnected).toBe(false);
    expect(room.spectators).toHaveLength(1);
  });

  test('rejects a spectator join for a userId that is already a player', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 'ps1');
    expect(() => addSpectator(room, 'alice', 'ws1')).toThrow('Already a player in this room');
    expect(room.spectators).toHaveLength(0);
  });
});

describe('removeSpectator', () => {
  test('removes a spectator from the room', () => {
    const room = createRoom('room1');
    addSpectator(room, 'alice', 's1');
    addSpectator(room, 'bob', 's2');
    removeSpectator(room, 'alice');
    expect(room.spectators).toHaveLength(1);
    expect(findSpectator(room, 'alice')).toBeNull();
  });
});
