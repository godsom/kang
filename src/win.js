// src/win.js
const { GAME_CONFIG } = require('./config');
const { calcHandScore } = require('./handScore');
const { validateMeld, MELD_PRIORITY, RANK_ORDER } = require('./meld');

function getMeldTopCardOrder(cards, type) {
  if (type === 'tong') return RANK_ORDER[cards[0].rank];
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

function checkMeldBasedWin(claimants) {
  const meldClaimants = toMeldClaimants(claimants);
  if (meldClaimants.length === 0) return null;
  return resolveMeldWin(meldClaimants);
}

function resolveTie(winners) {
  const meldClaimants = toMeldClaimants(winners);
  if (meldClaimants.length > 0) return resolveMeldWin(meldClaimants);
  return { winners: winners.map(p => p.userId), reason: 'split_pot' };
}

function isInstantKaengEligible(player) {
  return player.hand.every(card => GAME_CONFIG.RANK_VALUE[card.rank] < GAME_CONFIG.INSTANT_KAENG_THRESHOLD);
}

function checkKaengWin(players, isFirstTurn) {
  const claimants = players.filter(p => p.declaredKaeng);
  if (claimants.length === 0) return null;

  claimants.forEach(p => { p.handScore = calcHandScore(p.hand); });
  const eligible = isFirstTurn ? claimants.filter(isInstantKaengEligible) : [];

  if (eligible.length === 0) return checkMeldBasedWin(claimants);
  if (eligible.length === 1) return { winners: [eligible[0].userId], reason: 'instant_kaeng' };

  const minScore = Math.min(...eligible.map(p => p.handScore));
  const winners = eligible.filter(p => p.handScore === minScore);
  return winners.length === 1
    ? { winners: [winners[0].userId], reason: 'instant_kaeng' }
    : resolveTie(winners);
}

function getPayoutMultiplier(reason) {
  const { PAYOUT } = GAME_CONFIG;
  if (reason === 'instant_kaeng' || reason === 'instant_kaeng_lowest' || reason === 'split_pot') {
    return PAYOUT.instantKaeng;
  }
  if (reason === 'tong') return PAYOUT.tong;
  if (reason === 'flush' || reason === 'straight') return PAYOUT.flushOrStraight;
  throw new Error(`Unknown win reason: ${reason}`);
}

module.exports = { checkKaengWin, checkMeldBasedWin, resolveMeldWin, resolveTie, getPayoutMultiplier };
