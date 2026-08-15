const { createRoom, addPlayer } = require('../../src/server/room');
const { getPlayerView } = require('../../src/server/playerView');

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
    });
  });
});
