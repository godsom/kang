const { createRoom, addPlayer } = require('../../src/server/room');
const { setPlayerReady, canStart, startRound } = require('../../src/server/roomLifecycle');

describe('setPlayerReady', () => {
  test('toggles a player\'s ready flag', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    setPlayerReady(room, 'alice', true);
    expect(room.players[0].ready).toBe(true);
    setPlayerReady(room, 'alice', false);
    expect(room.players[0].ready).toBe(false);
  });

  test('throws for an unknown player', () => {
    const room = createRoom('room1');
    expect(() => setPlayerReady(room, 'ghost', true)).toThrow('Player not in room');
  });
});

describe('canStart', () => {
  test('false below MIN_PLAYERS even if the lone player is ready', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    setPlayerReady(room, 'alice', true);
    expect(canStart(room)).toBe(false);
  });

  test('false if any player is not ready', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    addPlayer(room, 'bob', 's2');
    setPlayerReady(room, 'alice', true);
    expect(canStart(room)).toBe(false);
  });

  test('true once player count >= MIN_PLAYERS and everyone is ready', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    addPlayer(room, 'bob', 's2');
    setPlayerReady(room, 'alice', true);
    setPlayerReady(room, 'bob', true);
    expect(canStart(room)).toBe(true);
  });

  test('false once the room is already in progress', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    addPlayer(room, 'bob', 's2');
    setPlayerReady(room, 'alice', true);
    setPlayerReady(room, 'bob', true);
    startRound(room);
    expect(canStart(room)).toBe(false);
  });
});

describe('startRound', () => {
  test('deals HAND_SIZE cards to every player and marks the room in progress', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    addPlayer(room, 'bob', 's2');
    startRound(room);
    expect(room.status).toBe('in_progress');
    room.players.forEach(p => expect(p.hand).toHaveLength(5));
    expect(room.discardPile).toEqual([]);
    expect(room.isFirstTurn).toBe(true);
  });

  test('sets a dealer and turnIndex pointing at the dealer', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    addPlayer(room, 'bob', 's2');
    startRound(room);
    expect(room.dealerId).not.toBeNull();
    expect(room.players[room.turnIndex].userId).toBe(room.dealerId);
  });

  test('does not re-determine the dealer on a room that already has one', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    addPlayer(room, 'bob', 's2');
    room.dealerId = 'alice';
    startRound(room);
    expect(room.dealerId).toBe('alice');
  });

  test('resets turn-action flags for the new round', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    addPlayer(room, 'bob', 's2');
    startRound(room);
    expect(room.awaitingDiscard).toBe(false);
    expect(room.lastDiscardWasEat).toBe(false);
  });
});
