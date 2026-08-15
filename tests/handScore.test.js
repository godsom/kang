// tests/handScore.test.js
const { calcHandScore } = require('../src/handScore');

describe('calcHandScore', () => {
  test('sums face-value ranks', () => {
    const hand = [{ suit: 's', rank: '2' }, { suit: 'h', rank: '5' }, { suit: 'd', rank: '9' }];
    expect(calcHandScore(hand)).toBe(16);
  });

  test('treats A as 1', () => {
    const hand = [{ suit: 's', rank: 'A' }, { suit: 'h', rank: 'A' }];
    expect(calcHandScore(hand)).toBe(2);
  });

  test('treats J, Q, K as 10', () => {
    const hand = [{ suit: 's', rank: 'J' }, { suit: 'h', rank: 'Q' }, { suit: 'd', rank: 'K' }];
    expect(calcHandScore(hand)).toBe(30);
  });

  test('returns 0 for an empty hand', () => {
    expect(calcHandScore([])).toBe(0);
  });
});
