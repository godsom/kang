const { ROOM_STATUS, createRoom, findPlayer, addPlayer, removePlayer, standPlayer, sitPlayer } = require('../../src/server/room');
const { addSpectator, findSpectator } = require('../../src/server/spectator');
const { GAME_CONFIG } = require('../../src/config');

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

  test('stores a display username, defaulting to the userId when not given', () => {
    const room = createRoom('room1');
    const { player } = addPlayer(room, 'alice', 'socket-1', 'Alice A.');
    expect(player.username).toBe('Alice A.');
    const { player: bob } = addPlayer(room, 'bob', 'socket-2');
    expect(bob.username).toBe('bob');
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

  test('assigns each new player the next lowest free seat index, starting at 0', () => {
    const room = createRoom('room1');
    const { player: alice } = addPlayer(room, 'alice', 's1');
    const { player: bob } = addPlayer(room, 'bob', 's2');
    expect(alice.seatIndex).toBe(0);
    expect(bob.seatIndex).toBe(1);
  });

  test('a reconnect keeps the player\'s existing seat index rather than reassigning one', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    addPlayer(room, 'bob', 's2');
    room.status = ROOM_STATUS.IN_PROGRESS;
    const { player } = addPlayer(room, 'alice', 's1-new');
    expect(player.seatIndex).toBe(0);
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

describe('standPlayer', () => {
  test('moves a seated player to the spectator rail, preserving identity', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 'socket-1', 'Alice A.');
    standPlayer(room, 'alice');
    expect(findPlayer(room, 'alice')).toBeNull();
    const spectator = findSpectator(room, 'alice');
    expect(spectator).toMatchObject({ userId: 'alice', socketId: 'socket-1', username: 'Alice A.' });
  });

  test('throws if the userId is not a seated player', () => {
    const room = createRoom('room1');
    expect(() => standPlayer(room, 'ghost')).toThrow('Player not in room');
  });
});

describe('sitPlayer', () => {
  test('moves a spectator into a seat as a fresh player', () => {
    const room = createRoom('room1');
    addSpectator(room, 'alice', 'ws1', 'Alice A.');
    const { player } = sitPlayer(room, 'alice', 'socket-2');
    expect(findSpectator(room, 'alice')).toBeNull();
    expect(player).toMatchObject({ userId: 'alice', socketId: 'socket-2', username: 'Alice A.', hand: [], ready: false });
    expect(findPlayer(room, 'alice')).toBe(player);
  });

  test('throws if the userId is not a spectator', () => {
    const room = createRoom('room1');
    expect(() => sitPlayer(room, 'ghost', 'socket-2')).toThrow('Spectator not in room');
  });

  test('throws once the room is already at max players', () => {
    const room = createRoom('room1');
    for (let i = 0; i < GAME_CONFIG.MAX_PLAYERS; i++) addPlayer(room, `p${i}`, `s${i}`);
    addSpectator(room, 'alice', 'ws1');
    expect(() => sitPlayer(room, 'alice', 'socket-2')).toThrow('Room is full');
  });

  test('sitting works even while the room is in progress, for a caller that gates the timing itself', () => {
    const room = createRoom('room1');
    addSpectator(room, 'alice', 'ws1');
    room.status = ROOM_STATUS.IN_PROGRESS;
    const { player } = sitPlayer(room, 'alice', 'socket-2');
    expect(player.userId).toBe('alice');
  });

  test('a player who sits back down after standing gets the lowest free seat, not necessarily their old one', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1'); // seat 0
    addPlayer(room, 'bob', 's2'); // seat 1
    standPlayer(room, 'alice'); // frees seat 0
    const { player } = sitPlayer(room, 'alice', 's1-new');
    expect(player.seatIndex).toBe(0);
  });

  test('sitting fills the lowest free seat left empty by an earlier stand, without disturbing others', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1'); // seat 0
    addPlayer(room, 'bob', 's2'); // seat 1
    addPlayer(room, 'carol', 's3'); // seat 2
    standPlayer(room, 'bob'); // frees seat 1
    addSpectator(room, 'dan', 'ws1');
    const { player: dan } = sitPlayer(room, 'dan', 's4');
    expect(dan.seatIndex).toBe(1);
    expect(findPlayer(room, 'alice').seatIndex).toBe(0);
    expect(findPlayer(room, 'carol').seatIndex).toBe(2);
  });
});
