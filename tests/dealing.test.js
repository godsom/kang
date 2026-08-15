const { dealCards, determineFirstDealer } = require('../src/dealing');

describe('dealCards', () => {
  test('deals HAND_SIZE cards to every player regardless of player count', () => {
    const deck = Array.from({ length: 30 }, (_, i) => ({ suit: 's', rank: '2', id: i }));
    const players = [{ userId: 'p1' }, { userId: 'p2' }, { userId: 'p3' }];
    dealCards(players, deck);
    players.forEach(p => expect(p.hand).toHaveLength(5));
  });

  test('respects a custom hand size and removes dealt cards from the deck', () => {
    const deck = Array.from({ length: 10 }, (_, i) => ({ suit: 's', rank: '2', id: i }));
    const players = [{ userId: 'p1' }, { userId: 'p2' }];
    dealCards(players, deck, 3);
    expect(players[0].hand).toHaveLength(3);
    expect(players[1].hand).toHaveLength(3);
    expect(deck).toHaveLength(4);
  });
});

describe('determineFirstDealer', () => {
  test('returns the userId of the player who drew the lowest-value card', () => {
    // drawCard pops from the end, so build the deck so p1 gets K, p2 gets A
    const deck = [{ suit: 's', rank: 'K' }, { suit: 'h', rank: 'A' }];
    const players = [{ userId: 'p1' }, { userId: 'p2' }];
    expect(determineFirstDealer(players, deck)).toBe('p2');
  });

  test('consumes exactly one card per player from the deck', () => {
    const deck = [{ suit: 's', rank: '5' }, { suit: 'h', rank: '2' }, { suit: 'd', rank: '9' }];
    const players = [{ userId: 'p1' }, { userId: 'p2' }];
    determineFirstDealer(players, deck);
    expect(deck).toHaveLength(1);
  });
});
