const { createRoom, addPlayer, ROOM_STATUS } = require('../../src/server/room');
const { isPlayersTurn, applyDraw, applyDiscard, canEat, applyEat } = require('../../src/server/turnActions');

const c = (rank, suit) => ({ rank, suit });

function setupRoom({ eatMode = 'chain_eat' } = {}) {
  const room = createRoom('room1', 'one_way', eatMode);
  addPlayer(room, 'alice', 's1');
  addPlayer(room, 'bob', 's2');
  room.status = ROOM_STATUS.IN_PROGRESS;
  room.turnIndex = 0;
  room.directionSign = 1;
  room.awaitingDiscard = false;
  room.lastDiscardWasEat = false;
  room.isFirstTurn = true;
  room.discardPile = [];
  room.players[0].hand = [c('2', 'spades'), c('5', 'hearts')];
  room.players[1].hand = [c('2', 'clubs'), c('9', 'diamonds')];
  room.deck = [c('K', 'spades'), c('7', 'hearts')]; // last element is drawn first
  return room;
}

describe('isPlayersTurn', () => {
  test('true for the active player, false otherwise', () => {
    const room = setupRoom();
    expect(isPlayersTurn(room, 'alice')).toBe(true);
    expect(isPlayersTurn(room, 'bob')).toBe(false);
  });
});

describe('applyDraw', () => {
  test('draws a card into the active player\'s hand and sets awaitingDiscard', () => {
    const room = setupRoom();
    const result = applyDraw(room, 'alice');
    expect(result.deckExhausted).toBe(false);
    expect(room.players[0].hand).toHaveLength(3);
    expect(room.awaitingDiscard).toBe(true);
    expect(room.deck).toHaveLength(1);
  });

  test('throws if it is not the caller\'s turn', () => {
    const room = setupRoom();
    expect(() => applyDraw(room, 'bob')).toThrow('Not your turn');
  });

  test('throws if already drawn this turn', () => {
    const room = setupRoom();
    applyDraw(room, 'alice');
    expect(() => applyDraw(room, 'alice')).toThrow('Already drawn this turn');
  });

  test('signals deckExhausted instead of throwing when the deck is empty', () => {
    const room = setupRoom();
    room.deck = [];
    const result = applyDraw(room, 'alice');
    expect(result.deckExhausted).toBe(true);
    expect(room.players[0].hand).toHaveLength(2);
    expect(room.awaitingDiscard).toBe(false);
  });
});

describe('applyDiscard', () => {
  test('discards a card, advances the turn, and closes the first-turn window', () => {
    const room = setupRoom();
    applyDraw(room, 'alice');
    const drawnCard = room.players[0].hand[room.players[0].hand.length - 1];
    applyDiscard(room, 'alice', drawnCard);
    expect(room.discardPile).toEqual([drawnCard]);
    expect(room.awaitingDiscard).toBe(false);
    expect(room.isFirstTurn).toBe(false);
    expect(room.turnIndex).toBe(1);
  });

  test('throws if discarding before drawing', () => {
    const room = setupRoom();
    expect(() => applyDiscard(room, 'alice', room.players[0].hand[0])).toThrow('Must draw before discarding');
  });

  test('throws if the card is not in hand', () => {
    const room = setupRoom();
    applyDraw(room, 'alice');
    expect(() => applyDiscard(room, 'alice', c('K', 'clubs'))).toThrow('Card not in hand');
  });
});

describe('canEat / applyEat', () => {
  test('eating is allowed on your turn with a matching-rank card, without drawing first', () => {
    const room = setupRoom();
    room.discardPile = [c('2', 'diamonds')];
    expect(canEat(room, 'alice', c('2', 'spades'))).toBe(true);
    const result = applyEat(room, 'alice', c('2', 'spades'));
    expect(result.eaten).toEqual(c('2', 'spades'));
    expect(room.discardPile).toEqual([c('2', 'diamonds'), c('2', 'spades')]);
    expect(room.players[0].hand).toEqual([c('5', 'hearts')]);
    expect(room.turnIndex).toBe(1);
    expect(room.lastDiscardWasEat).toBe(true);
  });

  test('eating credits 1 ledger point from the previous discard owner to the eater', () => {
    const room = setupRoom();
    room.discardPile = [c('2', 'diamonds')];
    room.discardOwnerId = 'bob';
    const result = applyEat(room, 'alice', c('2', 'spades'));
    expect(result.points).toBe(1);
    expect(room.ledger.bob.alice).toBe(1);
    expect(room.discardOwnerId).toBe('alice');
  });

  test('eating with a matching pair already in hand credits 2 ledger points', () => {
    const room = setupRoom();
    room.players[0].hand = [c('2', 'spades'), c('2', 'hearts')];
    room.discardPile = [c('2', 'diamonds')];
    room.discardOwnerId = 'bob';
    const result = applyEat(room, 'alice', c('2', 'spades'));
    expect(result.points).toBe(2);
    expect(room.ledger.bob.alice).toBe(2);
  });

  test('cannot eat a non-matching rank', () => {
    const room = setupRoom();
    room.discardPile = [c('9', 'diamonds')];
    expect(canEat(room, 'alice', c('2', 'spades'))).toBe(false);
    expect(() => applyEat(room, 'alice', c('2', 'spades'))).toThrow('Cannot eat this card');
  });

  test('cannot eat after already drawing this turn', () => {
    const room = setupRoom();
    room.discardPile = [c('2', 'diamonds')];
    applyDraw(room, 'alice');
    expect(canEat(room, 'alice', c('2', 'spades'))).toBe(false);
  });

  test('sequential_beat forbids eating a discard that was itself placed by an eat', () => {
    const room = setupRoom({ eatMode: 'sequential_beat' });
    room.discardPile = [c('2', 'diamonds')];
    applyEat(room, 'alice', c('2', 'spades')); // bob is now active, lastDiscardWasEat=true
    expect(room.turnIndex).toBe(1);
    expect(canEat(room, 'bob', c('2', 'clubs'))).toBe(false);
  });

  test('chain_eat allows eating a discard that was itself placed by an eat', () => {
    const room = setupRoom({ eatMode: 'chain_eat' });
    room.discardPile = [c('2', 'diamonds')];
    applyEat(room, 'alice', c('2', 'spades')); // bob is now active, lastDiscardWasEat=true
    expect(canEat(room, 'bob', c('2', 'clubs'))).toBe(true);
  });
});
