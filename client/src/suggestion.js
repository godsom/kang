const RANK_VALUE = {
  A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
  J: 10, Q: 10, K: 10,
};
const RANK_ORDER = {
  A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
  J: 11, Q: 12, K: 13,
};
const INSTANT_KAENG_THRESHOLD = 8;

const MELD_LABEL = { tong: 'ตอง', flush: 'เรียง', straight: 'สเตรท' };

function sameSuit(cards) {
  return cards.every((c) => c.suit === cards[0].suit);
}

function isSequential(orders) {
  const sorted = [...orders].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  }
  return true;
}

function isFlushHand(hand) {
  return hand.length === 5 && sameSuit(hand);
}

function isStraightHand(hand) {
  if (hand.length !== 5 || !sameSuit(hand)) return false;
  const orders = hand.map((c) => RANK_ORDER[c.rank]);
  if (isSequential(orders)) return true;
  if (orders.includes(1)) {
    const aceHigh = orders.map((o) => (o === 1 ? 14 : o));
    if (isSequential(aceHigh)) return true;
  }
  return false;
}

function hasTongPotential(hand) {
  const counts = {};
  hand.forEach((c) => { counts[c.rank] = (counts[c.rank] || 0) + 1; });
  return Object.values(counts).some((n) => n >= 3);
}

// Informational hint only — real meld/win validation always happens server-side.
function detectMeldHint(hand) {
  if (!hand || hand.length !== 5) return null;
  if (hasTongPotential(hand)) return 'tong';
  if (isStraightHand(hand)) return 'straight';
  if (isFlushHand(hand)) return 'flush';
  return null;
}

function isInstantKaengEligible(hand) {
  return !!hand && hand.length > 0 && hand.every((c) => RANK_VALUE[c.rank] < INSTANT_KAENG_THRESHOLD);
}

// Prefers keeping pairs (worth more toward ตอง): suggests discarding the
// highest-value card that isn't part of a pair, falling back to the highest
// overall when every card is paired up.
function pickSuggestedDiscard(hand) {
  if (!hand || hand.length === 0) return null;
  const counts = {};
  hand.forEach((c) => { counts[c.rank] = (counts[c.rank] || 0) + 1; });
  const unpaired = hand.filter((c) => counts[c.rank] === 1);
  const pool = unpaired.length > 0 ? unpaired : hand;
  return pool.reduce((highest, c) => (
    RANK_VALUE[c.rank] > RANK_VALUE[highest.rank] ? c : highest
  ), pool[0]);
}

function sameCard(a, b) {
  return !!a && !!b && a.rank === b.rank && a.suit === b.suit;
}

// Sum of each card's rank value — lower is better (mirrors src/handScore.js).
function calcHandScore(hand) {
  if (!hand) return 0;
  return hand.reduce((sum, c) => sum + RANK_VALUE[c.rank], 0);
}

// Sorts by rank value so pairs/doubles land next to each other in the hand display.
function sortHand(hand) {
  if (!hand) return [];
  return [...hand].sort((a, b) => RANK_VALUE[a.rank] - RANK_VALUE[b.rank] || a.suit.localeCompare(b.suit));
}

export { MELD_LABEL, detectMeldHint, isInstantKaengEligible, pickSuggestedDiscard, sameCard, sortHand, calcHandScore };
