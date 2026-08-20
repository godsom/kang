// src/win.js
const { GAME_CONFIG } = require('./config');
const { calcHandScore } = require('./handScore');
const { validateMeld, MELD_PRIORITY, RANK_ORDER } = require('./meld');

function getMeldTopCardOrder(cards, type) {
  if (type === 'tong') {
    // cards may be the full hand (tong cards + kickers), so find the rank
    // that actually appears 3-4 times rather than assuming cards[0] is it.
    const counts = {};
    cards.forEach(card => { counts[card.rank] = (counts[card.rank] || 0) + 1; });
    const tongRank = Object.keys(counts).find(rank => counts[rank] >= 3);
    return RANK_ORDER[tongRank];
  }
  const orders = cards.map(card => RANK_ORDER[card.rank]);
  if (type === 'straight' && orders.includes(1) && orders.includes(13)) {
    // Ace-high straight (10-J-Q-K-A): meld.js's isStraight treats the ace as
    // structurally high in this shape, so for top-card comparison it must
    // outrank a K-high straight (9-10-J-Q-K), not tie with it. This is
    // specific to straights — flush/tong comparisons keep A low (order 1).
    return 14;
  }
  return Math.max(...orders);
}

function toMeldClaimants(players) {
  return players
    .map(player => ({ playerId: player.userId, ...validateMeld(player.hand), meldCards: player.hand }))
    .filter(claimant => claimant.valid);
}

function resolveMeldWin(claimants) {
  const maxPriority = Math.max(...claimants.map(c => MELD_PRIORITY[c.type]));
  const topTier = claimants.filter(c => MELD_PRIORITY[c.type] === maxPriority);

  const maxOrder = Math.max(...topTier.map(c => getMeldTopCardOrder(c.meldCards, c.type)));
  const winners = topTier.filter(c => getMeldTopCardOrder(c.meldCards, c.type) === maxOrder);

  return { winners: winners.map(w => w.playerId), reason: winners[0].type };
}

function resolveTie(winners) {
  const meldClaimants = toMeldClaimants(winners);
  if (meldClaimants.length > 0) return resolveMeldWin(meldClaimants);
  return { winners: winners.map(p => p.userId), reason: 'split_pot' };
}

function isInstantKaengEligible(player) {
  return player.hand.every(card => GAME_CONFIG.RANK_VALUE[card.rank] < GAME_CONFIG.INSTANT_KAENG_THRESHOLD);
}

// A kaeng declaration with no instant-kaeng eligibility and no meld still
// ends the round: the caller's hand score is compared against everyone
// else's. A tie (or an outright low) favors the caller — they called it
// first — so only a strictly lower score elsewhere beats them. Losing means
// the caller pays every other player instead of collecting from them.
function resolveKaengShowdown(players, caller) {
  const callerScore = calcHandScore(caller.hand);
  const others = players.filter(p => p.userId !== caller.userId);
  const othersMinScore = Math.min(...others.map(p => calcHandScore(p.hand)));
  if (callerScore <= othersMinScore) {
    return { winners: [caller.userId], reason: 'kaeng_call_win' };
  }
  return { winners: others.map(p => p.userId), reason: 'kaeng_call_loss' };
}

function checkKaengWin(players, isFirstTurn) {
  const claimants = players.filter(p => p.declaredKaeng);
  if (claimants.length === 0) return null;

  claimants.forEach(p => { p.handScore = calcHandScore(p.hand); });
  const eligible = isFirstTurn ? claimants.filter(isInstantKaengEligible) : [];

  if (eligible.length === 0) {
    // Only the instant-kaeng threshold (<8 every card, first turn) skips the
    // comparison entirely. A meld (ตอง/เรียง/สเตรท) never wins on its own —
    // the caller's hand score must still be compared against everyone else's,
    // exactly like a plain kaeng call. A meld only upgrades the payout
    // multiplier (×2/×3 instead of ×1) for whichever hand actually wins that
    // comparison, and only on the first turn (the hand as originally dealt).
    const result = resolveKaengShowdown(players, claimants[0]);
    if (isFirstTurn && result.reason === 'kaeng_call_win') {
      const meld = validateMeld(claimants[0].hand);
      if (meld.valid) return { winners: result.winners, reason: meld.type };
    }
    return result;
  }
  if (eligible.length === 1) return { winners: [eligible[0].userId], reason: 'instant_kaeng' };

  const minScore = Math.min(...eligible.map(p => p.handScore));
  const winners = eligible.filter(p => p.handScore === minScore);
  return winners.length === 1
    ? { winners: [winners[0].userId], reason: 'instant_kaeng' }
    : resolveTie(winners);
}

function getPayoutMultiplier(reason) {
  const { PAYOUT } = GAME_CONFIG;
  if (
    reason === 'instant_kaeng' ||
    reason === 'instant_kaeng_lowest' ||
    reason === 'split_pot' ||
    reason === 'kaeng_call_win' ||
    reason === 'kaeng_call_loss'
  ) {
    return PAYOUT.instantKaeng;
  }
  if (reason === 'tong') return PAYOUT.tong;
  if (reason === 'flush' || reason === 'straight') return PAYOUT.flushOrStraight;
  if (reason === 'deck_exhausted') return PAYOUT.instantKaeng;
  throw new Error(`Unknown win reason: ${reason}`);
}

module.exports = { checkKaengWin, resolveMeldWin, resolveTie, resolveKaengShowdown, getPayoutMultiplier };
