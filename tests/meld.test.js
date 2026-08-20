// tests/meld.test.js
const { isTong, isFlush, isStraight, validateMeld, MELD_PRIORITY, RANK_ORDER } = require('../src/meld');

const c = (rank, suit) => ({ rank, suit });

describe('isTong', () => {
  test('true for 3 same rank, different suits', () => {
    expect(isTong([c('7', 's'), c('7', 'h'), c('7', 'd')])).toBe(true);
  });

  test('true for 4 same rank', () => {
    expect(isTong([c('7', 's'), c('7', 'h'), c('7', 'd'), c('7', 'c')])).toBe(true);
  });

  test('false for a lone pair, or no matching cards at all', () => {
    expect(isTong([c('7', 's'), c('7', 'h')])).toBe(false);
    expect(isTong([c('7', 's'), c('7', 'h'), c('8', 'd')])).toBe(false);
  });

  test('true for a full 5-card hand containing 3 (or 4) matching cards plus kickers', () => {
    // A real hand is always dealt at 5 cards — a tong here is 3-4 matching
    // cards plus 1-2 unrelated kickers, not the whole hand being 3-4 cards.
    expect(isTong([c('7', 's'), c('7', 'h'), c('7', 'd'), c('2', 'c'), c('9', 's')])).toBe(true);
    expect(isTong([c('7', 's'), c('7', 'h'), c('7', 'd'), c('7', 'c'), c('9', 's')])).toBe(true);
  });

  test('false for a 5-card hand with only a pair, no triple', () => {
    expect(isTong([c('7', 's'), c('7', 'h'), c('2', 'd'), c('3', 'c'), c('9', 's')])).toBe(false);
  });
});

describe('isFlush', () => {
  test('true for 5 same-suit cards, any ranks', () => {
    expect(isFlush([c('2', 's'), c('5', 's'), c('9', 's'), c('K', 's'), c('A', 's')])).toBe(true);
  });

  test('false if suits differ or length != 5', () => {
    expect(isFlush([c('2', 's'), c('5', 'h'), c('9', 's'), c('K', 's'), c('A', 's')])).toBe(false);
    expect(isFlush([c('2', 's'), c('5', 's')])).toBe(false);
  });
});

describe('isStraight', () => {
  test('true for a same-suit sequential run', () => {
    expect(isStraight([c('5', 's'), c('6', 's'), c('7', 's'), c('8', 's'), c('9', 's')])).toBe(true);
  });

  test('true for ace-low (A-2-3-4-5)', () => {
    expect(isStraight([c('A', 'h'), c('2', 'h'), c('3', 'h'), c('4', 'h'), c('5', 'h')])).toBe(true);
  });

  test('true for ace-high (10-J-Q-K-A)', () => {
    expect(isStraight([c('10', 'd'), c('J', 'd'), c('Q', 'd'), c('K', 'd'), c('A', 'd')])).toBe(true);
  });

  test('false for wraparound (K-A-2-3-4)', () => {
    expect(isStraight([c('K', 'c'), c('A', 'c'), c('2', 'c'), c('3', 'c'), c('4', 'c')])).toBe(false);
  });

  test('false if suits differ', () => {
    expect(isStraight([c('5', 's'), c('6', 'h'), c('7', 's'), c('8', 's'), c('9', 's')])).toBe(false);
  });
});

describe('validateMeld', () => {
  test('classifies tong', () => {
    expect(validateMeld([c('7', 's'), c('7', 'h'), c('7', 'd')])).toEqual({ valid: true, type: 'tong' });
  });

  test('classifies straight over flush when both suit-uniform and sequential', () => {
    expect(validateMeld([c('5', 's'), c('6', 's'), c('7', 's'), c('8', 's'), c('9', 's')]))
      .toEqual({ valid: true, type: 'straight' });
  });

  test('classifies flush when same-suit but not sequential', () => {
    expect(validateMeld([c('2', 's'), c('5', 's'), c('9', 's'), c('K', 's'), c('A', 's')]))
      .toEqual({ valid: true, type: 'flush' });
  });

  test('invalid for a non-meld hand', () => {
    expect(validateMeld([c('2', 's'), c('5', 'h'), c('9', 'd'), c('K', 'c'), c('3', 's')]))
      .toEqual({ valid: false, type: null });
  });
});

describe('MELD_PRIORITY and RANK_ORDER', () => {
  test('tong outranks straight outranks flush', () => {
    expect(MELD_PRIORITY.tong).toBeGreaterThan(MELD_PRIORITY.straight);
    expect(MELD_PRIORITY.straight).toBeGreaterThan(MELD_PRIORITY.flush);
  });

  test('RANK_ORDER keeps A low and orders face cards J < Q < K', () => {
    expect(RANK_ORDER.A).toBe(1);
    expect(RANK_ORDER.J).toBeLessThan(RANK_ORDER.Q);
    expect(RANK_ORDER.Q).toBeLessThan(RANK_ORDER.K);
  });
});
