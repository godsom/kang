const { ROOM_STATUS, createRoom, findPlayer, addPlayer, removePlayer } = require('../../src/server/room');
const { addSpectator } = require('../../src/server/spectator');

describe('createRoom', () => {
  test('creates a room with sensible defaults', () => {
    const room = createRoom('room1');
    expect(room).toMatchObject({
      id: 'room1',
      players: [],
      direction: 'one_way',
      eatMode: 'chain_eat',
      deck: [],
      discardPile: [],
      turnIndex: 0,
      directionSign: 1,
      dealerId: null,
      pot: 0,
      status: ROOM_STATUS.WAITING,
      isFirstTurn: true,
    });
  });

  test('accepts explicit direction and eatMode', () => {
    const room = createRoom('room1', 'alternating', 'sequential_beat');
    expect(room.direction).toBe('alternating');
    expect(room.eatMode).toBe('sequential_beat');
  });

  test('includes an empty spectators array', () => {
    const room = createRoom('room1');
    expect(room.spectators).toEqual([]);
  });
});

describe('addPlayer', () => {
  test('adds a new player to a waiting room', () => {
    const room = createRoom('room1');
    const { player, reconnected } = addPlayer(room, 'alice', 'socket-1');
    expect(reconnected).toBe(false);
    expect(player).toMatchObject({ userId: 'alice', socketId: 'socket-1', hand: [], ready: false, connected: true });
    expect(room.players).toHaveLength(1);
    expect(findPlayer(room, 'alice')).toBe(player);
  });

  test('rejoining with the same userId rebinds the socket instead of duplicating', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 'socket-1');
    const { player, reconnected } = addPlayer(room, 'alice', 'socket-2');
    expect(reconnected).toBe(true);
    expect(player.socketId).toBe('socket-2');
    expect(player.connected).toBe(true);
    expect(room.players).toHaveLength(1);
  });

  test('rejects a new player once the room is full', () => {
    const room = createRoom('room1');
    for (let i = 0; i < 5; i++) addPlayer(room, `p${i}`, `s${i}`);
    expect(() => addPlayer(room, 'newcomer', 'socket-x')).toThrow('Room is full');
  });

  test('rejects a new player once the room is no longer waiting', () => {
    const room = createRoom('room1');
    room.status = ROOM_STATUS.IN_PROGRESS;
    expect(() => addPlayer(room, 'alice', 'socket-1')).toThrow('Room is not accepting new players');
  });

  test('a reconnect is allowed even when the room is in progress or full', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 'socket-1');
    room.status = ROOM_STATUS.IN_PROGRESS;
    const { reconnected } = addPlayer(room, 'alice', 'socket-2');
    expect(reconnected).toBe(true);
  });

  test('rejects a player join for a userId that is already a spectator', () => {
    const room = createRoom('room1');
    addSpectator(room, 'alice', 'ws1');
    expect(() => addPlayer(room, 'alice', 'socket-1')).toThrow('Already a spectator in this room');
    expect(room.players).toHaveLength(0);
  });
});

describe('removePlayer', () => {
  test('removes a player from the room', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 'socket-1');
    addPlayer(room, 'bob', 'socket-2');
    removePlayer(room, 'alice');
    expect(room.players).toHaveLength(1);
    expect(findPlayer(room, 'alice')).toBeNull();
    expect(findPlayer(room, 'bob')).not.toBeNull();
  });
});
