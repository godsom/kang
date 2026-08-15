const { SUITS, RANKS, buildDeck, shuffle, drawCard } = require('../src/deck');

describe('buildDeck', () => {
  test('builds a standard 52-card deck with no duplicates', () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(52);
    const keys = new Set(deck.map(c => `${c.suit}-${c.rank}`));
    expect(keys.size).toBe(52);
  });

  test('contains all 4 suits and 13 ranks', () => {
    const deck = buildDeck();
    expect(new Set(deck.map(c => c.suit)).size).toBe(4);
    expect(new Set(deck.map(c => c.rank)).size).toBe(13);
    expect(SUITS).toHaveLength(4);
    expect(RANKS).toHaveLength(13);
  });

  test('scales with deckCount', () => {
    expect(buildDeck(2)).toHaveLength(104);
  });
});

describe('shuffle', () => {
  test('preserves length and card multiset without mutating input', () => {
    const deck = buildDeck();
    const original = [...deck];
    const shuffled = shuffle(deck);
    expect(shuffled).toHaveLength(52);
    expect(deck).toEqual(original); // input untouched
    const sortKey = c => `${c.suit}-${c.rank}`;
    expect(shuffled.map(sortKey).sort()).toEqual(original.map(sortKey).sort());
  });

  test('is deterministic given a fixed rng (Fisher-Yates with rng always 0)', () => {
    const deck = [{ suit: 's', rank: '1' }, { suit: 's', rank: '2' }, { suit: 's', rank: '3' }];
    const rng = () => 0;
    // Fisher-Yates from i=2..1 with rng=0 always swaps index i with index 0
    // i=2: swap(2,0) -> [3,2,1]; i=1: swap(1,0) -> [2,3,1]
    const result = shuffle(deck, rng);
    expect(result.map(c => c.rank)).toEqual(['2', '3', '1']);
  });
});

describe('drawCard', () => {
  test('removes and returns the last card, mutating the deck', () => {
    const deck = [{ suit: 's', rank: 'A' }, { suit: 'h', rank: 'K' }];
    const card = drawCard(deck);
    expect(card).toEqual({ suit: 'h', rank: 'K' });
    expect(deck).toHaveLength(1);
  });

  test('throws when the deck is empty', () => {
    expect(() => drawCard([])).toThrow('Cannot draw from an empty deck');
  });
});
