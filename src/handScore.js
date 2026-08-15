// src/handScore.js
const { GAME_CONFIG } = require('./config');

function calcHandScore(hand) {
  return hand.reduce((sum, card) => sum + GAME_CONFIG.RANK_VALUE[card.rank], 0);
}

module.exports = { calcHandScore };
