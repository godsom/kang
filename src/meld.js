// src/meld.js
const RANK_ORDER = {
  A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
  J: 11, Q: 12, K: 13,
};

const MELD_PRIORITY = { tong: 3, straight: 2, flush: 1 };

function sameRank(cards) {
  return cards.every(card => card.rank === cards[0].rank);
}

function sameSuit(cards) {
  return cards.every(card => card.suit === cards[0].suit);
}

function isTong(cards) {
  return (cards.length === 3 || cards.length === 4) && sameRank(cards);
}

function isFlush(cards) {
  return cards.length === 5 && sameSuit(cards);
}

function isSequential(orders) {
  const sorted = [...orders].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  }
  return true;
}

function isStraight(cards) {
  if (cards.length !== 5 || !sameSuit(cards)) return false;

  const orders = cards.map(card => RANK_ORDER[card.rank]);
  if (isSequential(orders)) return true;

  if (orders.includes(1)) {
    const aceHighOrders = orders.map(order => (order === 1 ? 14 : order));
    if (isSequential(aceHighOrders)) return true;
  }

  return false;
}

function validateMeld(cards) {
  if (isTong(cards)) return { valid: true, type: 'tong' };
  if (isStraight(cards)) return { valid: true, type: 'straight' };
  if (isFlush(cards)) return { valid: true, type: 'flush' };
  return { valid: false, type: null };
}

module.exports = { RANK_ORDER, MELD_PRIORITY, isTong, isFlush, isStraight, validateMeld };
