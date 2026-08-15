// tests/win.test.js
const { checkKaengWin, resolveMeldWin, getPayoutMultiplier } = require('../src/win');

const c = (rank, suit) => ({ rank, suit });
const player = (userId, hand, declaredKaeng = false) => ({ userId, hand, declaredKaeng });

describe('checkKaengWin', () => {
  test('returns null if nobody declared kaeng', () => {
    const players = [player('p1', [c('2', 's'), c('3', 'h')], false)];
    expect(checkKaengWin(players, true)).toBeNull();
  });

  test('single eligible claimant (every card < 8, first turn) wins instantly', () => {
    const players = [
      player('p1', [c('A', 's'), c('A', 'h'), c('2', 'd'), c('2', 'c'), c('7', 'd')], true), // all cards < 8
      player('p2', [c('2', 's'), c('3', 'h'), c('A', 'd'), c('A', 'c'), c('9', 's')], false), // has a 9, and didn't declare
    ];
    const result = checkKaengWin(players, true);
    expect(result).toEqual({ winners: ['p1'], reason: 'instant_kaeng' });
  });

  test('a claimant with any single card worth 8+ is not eligible, even with a low total', () => {
    const players = [
      // total = 1+1+1+1+8 = 12, but the 8 disqualifies this hand card-by-card
      player('p1', [c('A', 's'), c('A', 'h'), c('A', 'd'), c('A', 'c'), c('8', 's')], true),
    ];
    expect(checkKaengWin(players, true)).toBeNull();
  });

  test('not eligible on any turn after the first, even if all cards are < 8', () => {
    const players = [
      player('p1', [c('A', 's'), c('A', 'h'), c('2', 'd'), c('2', 'c'), c('7', 'd')], true),
    ];
    expect(checkKaengWin(players, false)).toBeNull();
  });

  test('two eligible claimants, lowest total score wins', () => {
    const players = [
      player('p1', [c('A', 's'), c('A', 'h'), c('2', 'd'), c('2', 'c'), c('2', 's')], true), // 1+1+2+2+2=8, all cards < 8
      player('p2', [c('A', 's'), c('A', 'h'), c('A', 'd'), c('2', 'c'), c('2', 's')], true), // 1+1+1+2+2=7, all cards < 8
    ];
    const result = checkKaengWin(players, true);
    expect(result).toEqual({ winners: ['p2'], reason: 'instant_kaeng' });
  });

  test('tie on lowest score with no meld splits the pot', () => {
    const players = [
      player('p1', [c('A', 's'), c('2', 'h'), c('2', 'd'), c('A', 'c'), c('A', 'h')], true), // 1+2+2+1+1=7
      player('p2', [c('A', 'd'), c('2', 's'), c('2', 'c'), c('A', 'h'), c('A', 'c')], true), // 7, no meld
    ];
    const result = checkKaengWin(players, true);
    expect(result.reason).toBe('split_pot');
    expect(result.winners.sort()).toEqual(['p1', 'p2']);
  });

  test('falls back to meld comparison when no claimant is instant-kaeng eligible', () => {
    const players = [
      player('p1', [c('9', 's'), c('9', 'h'), c('9', 'd')], true), // tong, has a 9 (>= 8), not instant-eligible
      player('p2', [c('K', 'c'), c('K', 'd'), c('K', 's')], true), // tong, has Ks (>= 8), not instant-eligible, higher rank
    ];
    const result = checkKaengWin(players, true);
    expect(result).toEqual({ winners: ['p2'], reason: 'tong' });
  });

  test('returns null for an invalid declaration (not eligible, no meld)', () => {
    const players = [player('p1', [c('K', 's'), c('Q', 'h'), c('J', 'd'), c('9', 'c'), c('8', 's')], true)];
    expect(checkKaengWin(players, true)).toBeNull();
  });
});

describe('resolveMeldWin', () => {
  test('tong beats flush', () => {
    const claimants = [
      { playerId: 'p1', valid: true, type: 'flush', meldCards: [c('2', 's'), c('5', 's'), c('9', 's'), c('K', 's'), c('A', 's')] },
      { playerId: 'p2', valid: true, type: 'tong', meldCards: [c('3', 'h'), c('3', 'd'), c('3', 'c')] },
    ];
    expect(resolveMeldWin(claimants)).toEqual({ winners: ['p2'], reason: 'tong' });
  });

  test('same meld type breaks tie by highest card', () => {
    const claimants = [
      { playerId: 'p1', valid: true, type: 'flush', meldCards: [c('2', 's'), c('5', 's'), c('9', 's'), c('K', 's'), c('7', 's')] },
      { playerId: 'p2', valid: true, type: 'flush', meldCards: [c('2', 'h'), c('5', 'h'), c('9', 'h'), c('A', 'h'), c('7', 'h')] },
    ];
    // both have K/A as top card by face value, but A is always low (RANK_ORDER.A = 1) -> p1's K wins
    expect(resolveMeldWin(claimants)).toEqual({ winners: ['p1'], reason: 'flush' });
  });
});

describe('getPayoutMultiplier', () => {
  test('maps reasons to configured multipliers', () => {
    expect(getPayoutMultiplier('instant_kaeng')).toBe(1);
    expect(getPayoutMultiplier('instant_kaeng_lowest')).toBe(1);
    expect(getPayoutMultiplier('split_pot')).toBe(1);
    expect(getPayoutMultiplier('tong')).toBe(2);
    expect(getPayoutMultiplier('flush')).toBe(3);
    expect(getPayoutMultiplier('straight')).toBe(3);
  });

  test('throws on an unknown reason', () => {
    expect(() => getPayoutMultiplier('nonsense')).toThrow('Unknown win reason: nonsense');
  });
});
