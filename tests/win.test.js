// tests/win.test.js
const { checkKaengWin, resolveMeldWin, resolveKaengShowdown, getPayoutMultiplier } = require('../src/win');

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

  test('a claimant with any single card worth 8+ is not instant-kaeng eligible, but a real tong still wins on the fallback', () => {
    const players = [
      // total = 1+1+1+1+8 = 12; the 8 disqualifies instant kaeng, but four
      // aces + a kicker is a genuine tong, so it wins on the meld fallback.
      player('p1', [c('A', 's'), c('A', 'h'), c('A', 'd'), c('A', 'c'), c('8', 's')], true),
    ];
    expect(checkKaengWin(players, true)).toEqual({ winners: ['p1'], reason: 'tong' });
  });

  test('a claimant with any single card worth 8+ and no meld is not instant/meld eligible, so falls to the showdown', () => {
    const players = [
      player('p1', [c('A', 's'), c('2', 'h'), c('3', 'd'), c('4', 'c'), c('8', 's')], true), // score 18
      player('p2', [c('A', 'd'), c('A', 'h'), c('2', 's'), c('2', 'c'), c('3', 'h')], false), // score 9, lower
    ];
    expect(checkKaengWin(players, true)).toEqual({ winners: ['p2'], reason: 'kaeng_call_loss' });
  });

  test('not instant-kaeng eligible on any turn after the first, even if all cards are < 8 — still falls to the showdown', () => {
    const players = [
      player('p1', [c('A', 's'), c('A', 'h'), c('2', 'd'), c('2', 'c'), c('7', 'd')], true), // score 13
      player('p2', [c('K', 's'), c('K', 'h'), c('Q', 'd'), c('Q', 'c'), c('J', 'd')], false), // score 50, higher
    ];
    expect(checkKaengWin(players, false)).toEqual({ winners: ['p1'], reason: 'kaeng_call_win' });
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
      player('p1', [c('A', 's'), c('A', 'h'), c('2', 'd'), c('2', 'c'), c('3', 's')], true), // 1+1+2+2+3=9, no meld
      player('p2', [c('A', 'd'), c('A', 'c'), c('2', 's'), c('2', 'h'), c('3', 'd')], true), // 9, no meld
    ];
    const result = checkKaengWin(players, true);
    expect(result.reason).toBe('split_pot');
    expect(result.winners.sort()).toEqual(['p1', 'p2']);
  });

  test('a valid meld on the first turn upgrades the win reason (for a bigger payout multiplier) when the caller also has the lowest score', () => {
    const players = [
      player('p1', [c('9', 's'), c('9', 'h'), c('9', 'd')], true), // tong, score 27, has a 9 (>= 8) so not instant-eligible
      player('p2', [c('K', 'c'), c('K', 'd'), c('K', 's')], false), // score 30, doesn't declare
    ];
    const result = checkKaengWin(players, true);
    expect(result).toEqual({ winners: ['p1'], reason: 'tong' });
  });

  test('a valid meld does NOT win outright — the caller still loses if someone else genuinely scores lower', () => {
    const players = [
      player('p1', [c('9', 's'), c('9', 'h'), c('9', 'd')], true), // tong, score 27, has a 9 (>= 8) so not instant-eligible
      player('p2', [c('A', 'c'), c('A', 'd')], false), // score 2, beats p1's meld
    ];
    const result = checkKaengWin(players, true);
    expect(result).toEqual({ winners: ['p2'], reason: 'kaeng_call_loss' });
  });

  test('a meld is not checked on a later turn — falls straight to the showdown, like instant kaeng', () => {
    const players = [
      player('p1', [c('9', 's'), c('9', 'h'), c('9', 'd'), c('2', 'c'), c('3', 'h')], true), // real tong, score 26
      player('p2', [c('A', 'c'), c('A', 'd')], false), // score 2, wins the showdown
    ];
    const result = checkKaengWin(players, false);
    expect(result).toEqual({ winners: ['p2'], reason: 'kaeng_call_loss' });
  });

  test('with no instant-kaeng eligibility and no meld, falls back to a score showdown against everyone', () => {
    const players = [
      player('p1', [c('K', 's'), c('Q', 'h'), c('J', 'd'), c('9', 'c'), c('8', 's')], true), // no meld, declares
      player('p2', [c('2', 's'), c('2', 'h'), c('3', 'd'), c('3', 'c'), c('4', 's')], false), // lower score, didn't declare
    ];
    const result = checkKaengWin(players, true);
    expect(result).toEqual({ winners: ['p2'], reason: 'kaeng_call_loss' });
  });

  test('the showdown fallback still lets the caller win when their score is the best', () => {
    const players = [
      player('p1', [c('A', 's'), c('2', 'h'), c('3', 'd'), c('4', 'c'), c('9', 's')], true), // no meld, but low score, declares
      player('p2', [c('K', 's'), c('Q', 'h'), c('J', 'd'), c('10', 'c'), c('9', 'h')], false),
    ];
    const result = checkKaengWin(players, true);
    expect(result).toEqual({ winners: ['p1'], reason: 'kaeng_call_win' });
  });
});

describe('resolveKaengShowdown', () => {
  test('caller wins on a strictly lower score than everyone else', () => {
    const caller = player('p1', [c('A', 's'), c('2', 'h')]);
    const others = [player('p2', [c('9', 's'), c('9', 'h')]), player('p3', [c('K', 's'), c('K', 'h')])];
    expect(resolveKaengShowdown([caller, ...others], caller)).toEqual({ winners: ['p1'], reason: 'kaeng_call_win' });
  });

  test('caller wins on a tie for lowest score — they called it first', () => {
    const caller = player('p1', [c('5', 's'), c('5', 'h')]); // score 10
    const tied = player('p2', [c('4', 's'), c('6', 'h')]); // score 10
    expect(resolveKaengShowdown([caller, tied], caller)).toEqual({ winners: ['p1'], reason: 'kaeng_call_win' });
  });

  test('caller loses to a strictly lower score elsewhere — everyone else gets paid, not just the actual best hand', () => {
    const caller = player('p1', [c('9', 's'), c('9', 'h')]); // score 18
    const best = player('p2', [c('A', 's'), c('A', 'h')]); // score 2
    const middling = player('p3', [c('5', 's'), c('5', 'h')]); // score 10, also beats caller
    const result = resolveKaengShowdown([caller, best, middling], caller);
    expect(result.reason).toBe('kaeng_call_loss');
    expect(result.winners.sort()).toEqual(['p2', 'p3']);
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

  test('ace-high straight (10-J-Q-K-A) beats a king-high straight (9-10-J-Q-K)', () => {
    const claimants = [
      { playerId: 'p1', valid: true, type: 'straight', meldCards: [c('9', 's'), c('10', 's'), c('J', 's'), c('Q', 's'), c('K', 's')] },
      { playerId: 'p2', valid: true, type: 'straight', meldCards: [c('10', 'h'), c('J', 'h'), c('Q', 'h'), c('K', 'h'), c('A', 'h')] },
    ];
    // p2's straight is ace-high (10-J-Q-K-A), structurally stronger than p1's king-high straight,
    // even though RANK_ORDER.A = 1 -> p2 must win outright, not tie with p1.
    expect(resolveMeldWin(claimants)).toEqual({ winners: ['p2'], reason: 'straight' });
  });

  test('an ace-low straight (A-2-3-4-5) is not mistaken for ace-high and still loses to a higher straight', () => {
    const claimants = [
      { playerId: 'p1', valid: true, type: 'straight', meldCards: [c('A', 's'), c('2', 's'), c('3', 's'), c('4', 's'), c('5', 's')] },
      { playerId: 'p2', valid: true, type: 'straight', meldCards: [c('4', 'h'), c('5', 'h'), c('6', 'h'), c('7', 'h'), c('8', 'h')] },
    ];
    // p1's hand contains an ace but no king, so it must NOT trigger the ace-high exception -> p2 (top card 8) wins.
    expect(resolveMeldWin(claimants)).toEqual({ winners: ['p2'], reason: 'straight' });
  });
});

describe('getPayoutMultiplier', () => {
  test('maps reasons to configured multipliers', () => {
    expect(getPayoutMultiplier('instant_kaeng')).toBe(1);
    expect(getPayoutMultiplier('instant_kaeng_lowest')).toBe(1);
    expect(getPayoutMultiplier('split_pot')).toBe(1);
    expect(getPayoutMultiplier('kaeng_call_win')).toBe(1);
    expect(getPayoutMultiplier('kaeng_call_loss')).toBe(1);
    expect(getPayoutMultiplier('tong')).toBe(2);
    expect(getPayoutMultiplier('flush')).toBe(3);
    expect(getPayoutMultiplier('straight')).toBe(3);
  });

  test('deck_exhausted maps to the instantKaeng multiplier', () => {
    expect(getPayoutMultiplier('deck_exhausted')).toBe(1);
  });

  test('throws on an unknown reason', () => {
    expect(() => getPayoutMultiplier('nonsense')).toThrow('Unknown win reason: nonsense');
  });
});
