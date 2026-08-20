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
  test('returns the userId of the player who drew the highest-value card', () => {
    // drawCard pops from the end, so build the deck so p1 gets K, p2 gets A
    const deck = [{ suit: 'h', rank: 'A' }, { suit: 's', rank: 'K' }];
    const players = [{ userId: 'p1' }, { userId: 'p2' }];
    expect(determineFirstDealer(players, deck).dealerId).toBe('p1');
  });

  test('also returns the full set of draws, one per player, for a reveal animation', () => {
    const deck = [{ suit: 'h', rank: 'A' }, { suit: 's', rank: 'K' }];
    const players = [{ userId: 'p1' }, { userId: 'p2' }];
    const { draws } = determineFirstDealer(players, deck);
    expect(draws).toEqual([
      { userId: 'p1', card: { suit: 's', rank: 'K' } },
      { userId: 'p2', card: { suit: 'h', rank: 'A' } },
    ]);
  });

  test('consumes exactly one card per player from the deck', () => {
    const deck = [{ suit: 's', rank: '5' }, { suit: 'h', rank: '2' }, { suit: 'd', rank: '9' }];
    const players = [{ userId: 'p1' }, { userId: 'p2' }];
    determineFirstDealer(players, deck);
    expect(deck).toHaveLength(1);
  });

  test('ranks by true card order (A low ... K high), not RANK_VALUE which ties J/Q/K at 10', () => {
    // drawCard pops from the end, so build the deck so p1 gets Q, p2 gets J
    const deck = [{ suit: 's', rank: 'J' }, { suit: 'd', rank: 'Q' }];
    const players = [{ userId: 'p1' }, { userId: 'p2' }];
    expect(determineFirstDealer(players, deck).dealerId).toBe('p1'); // Q beats J
  });

  test('breaks a same-rank tie by suit: clubs < diamonds < hearts < spades', () => {
    const deck = [{ suit: 'clubs', rank: 'K' }, { suit: 'spades', rank: 'K' }];
    const players = [{ userId: 'p1' }, { userId: 'p2' }];
    expect(determineFirstDealer(players, deck).dealerId).toBe('p1'); // p1 drew spades, beats clubs
  });

  test('a same-rank, same-suit-rank-lower draw does not overtake the current highest', () => {
    const deck = [{ suit: 'spades', rank: 'K' }, { suit: 'clubs', rank: 'K' }];
    const players = [{ userId: 'p1' }, { userId: 'p2' }];
    expect(determineFirstDealer(players, deck).dealerId).toBe('p2'); // p2 drew spades, beats p1's clubs
  });
});
