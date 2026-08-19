const { createRoom, addPlayer } = require('../../src/server/room');
const { getPlayerView, getSpectatorView } = require('../../src/server/playerView');

function setup() {
  const room = createRoom('room1');
  addPlayer(room, 'alice', 's1');
  addPlayer(room, 'bob', 's2');
  room.players[0].hand = [{ suit: 'spades', rank: 'A' }, { suit: 'hearts', rank: 'K' }];
  room.players[1].hand = [{ suit: 'clubs', rank: '2' }];
  room.deck = [{ suit: 'diamonds', rank: '5' }, { suit: 'diamonds', rank: '6' }];
  room.discardPile = [{ suit: 'spades', rank: '9' }];
  room.dealerId = 'alice';
  room.turnIndex = 0;
  room.players[0].username = 'Alice A.';
  room.awaitingDiscard = true;
  room.isFirstTurn = false;
  room.turnDeadline = 1234;
  return room;
}

describe('getPlayerView', () => {
  test('exposes the viewer\'s own hand in full', () => {
    const room = setup();
    const view = getPlayerView(room, 'alice');
    const aliceEntry = view.players.find(p => p.userId === 'alice');
    expect(aliceEntry.hand).toEqual(room.players[0].hand);
    expect(aliceEntry.handCount).toBe(2);
  });

  test('never exposes another player\'s hand, only their count', () => {
    const room = setup();
    const view = getPlayerView(room, 'alice');
    const bobEntry = view.players.find(p => p.userId === 'bob');
    expect(bobEntry.hand).toBeUndefined();
    expect(bobEntry.handCount).toBe(1);
    expect('hand' in bobEntry).toBe(false);
  });

  test('never exposes deck contents, only deckCount', () => {
    const room = setup();
    const view = getPlayerView(room, 'alice');
    expect(view.deckCount).toBe(2);
    expect(view.deck).toBeUndefined();
  });

  test('exposes only the top discard card, not the whole pile', () => {
    const room = setup();
    const view = getPlayerView(room, 'alice');
    expect(view.discardTop).toEqual({ suit: 'spades', rank: '9' });
  });

  test('discardTop is null for an empty discard pile', () => {
    const room = setup();
    room.discardPile = [];
    const view = getPlayerView(room, 'alice');
    expect(view.discardTop).toBeNull();
  });

  test('marks isDealer correctly per player', () => {
    const room = setup();
    const view = getPlayerView(room, 'alice');
    expect(view.players.find(p => p.userId === 'alice').isDealer).toBe(true);
    expect(view.players.find(p => p.userId === 'bob').isDealer).toBe(false);
  });

  test('includes room-level fields', () => {
    const room = setup();
    const view = getPlayerView(room, 'bob');
    expect(view).toMatchObject({
      roomId: 'room1',
      status: 'waiting',
      direction: 'one_way',
      eatMode: 'chain_eat',
      dealerId: 'alice',
      turnIndex: 0,
      pot: 0,
      awaitingDiscard: true,
      isFirstTurn: false,
      turnDeadline: 1234,
    });
  });

  test('exposes each player\'s display username, defaulting to userId', () => {
    const room = setup();
    const view = getPlayerView(room, 'alice');
    expect(view.players.find(p => p.userId === 'alice').username).toBe('Alice A.');
    expect(view.players.find(p => p.userId === 'bob').username).toBe('bob');
  });

  test('exposes a spectator roster with username and pendingSit, never a hand', () => {
    const room = setup();
    room.spectators = [{ userId: 'carol', username: 'Carol C.', socketId: 's3', pendingSit: true }];
    const view = getPlayerView(room, 'alice');
    expect(view.spectators).toEqual([{ userId: 'carol', username: 'Carol C.', pendingSit: true }]);
  });

  test('exposes a live, username-annotated settlement matrix derived from the ledger', () => {
    const room = setup();
    room.ledger = { bob: { alice: 2 } };
    const view = getPlayerView(room, 'alice');
    expect(view.settlement).toEqual([
      { from: 'bob', to: 'alice', points: 2, baht: 10, fromUsername: 'bob', toUsername: 'Alice A.' },
    ]);
  });
});

describe('getSpectatorView', () => {
  test('never exposes any player\'s hand, not even structurally', () => {
    const room = setup();
    const view = getSpectatorView(room);
    view.players.forEach(p => {
      expect('hand' in p).toBe(false);
    });
    expect(view.players.find(p => p.userId === 'alice').handCount).toBe(2);
    expect(view.players.find(p => p.userId === 'bob').handCount).toBe(1);
  });

  test('never exposes deck contents, only deckCount', () => {
    const room = setup();
    const view = getSpectatorView(room);
    expect(view.deckCount).toBe(2);
    expect(view.deck).toBeUndefined();
  });

  test('exposes only the top discard card and room-level fields', () => {
    const room = setup();
    const view = getSpectatorView(room);
    expect(view.discardTop).toEqual({ suit: 'spades', rank: '9' });
    expect(view).toMatchObject({
      roomId: 'room1',
      status: 'waiting',
      direction: 'one_way',
      eatMode: 'chain_eat',
      dealerId: 'alice',
      turnIndex: 0,
      pot: 0,
      awaitingDiscard: true,
      isFirstTurn: false,
      turnDeadline: 1234,
    });
  });

  test('exposes each player\'s display username, defaulting to userId', () => {
    const room = setup();
    const view = getSpectatorView(room);
    expect(view.players.find(p => p.userId === 'alice').username).toBe('Alice A.');
    expect(view.players.find(p => p.userId === 'bob').username).toBe('bob');
  });

  test('marks isDealer correctly per player', () => {
    const room = setup();
    const view = getSpectatorView(room);
    expect(view.players.find(p => p.userId === 'alice').isDealer).toBe(true);
    expect(view.players.find(p => p.userId === 'bob').isDealer).toBe(false);
  });

  test('exposes the same live settlement matrix as the player view', () => {
    const room = setup();
    room.ledger = { bob: { alice: 2 } };
    const view = getSpectatorView(room);
    expect(view.settlement).toEqual([
      { from: 'bob', to: 'alice', points: 2, baht: 10, fromUsername: 'bob', toUsername: 'Alice A.' },
    ]);
  });
});
