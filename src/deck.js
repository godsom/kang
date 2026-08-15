const { GAME_CONFIG } = require('./config');

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function buildDeck(deckCount = GAME_CONFIG.DECK_COUNT) {
  const deck = [];
  for (let i = 0; i < deckCount; i++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank });
      }
    }
  }
  return deck;
}

function shuffle(deck, rng = Math.random) {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function drawCard(deck) {
  if (deck.length === 0) {
    throw new Error('Cannot draw from an empty deck');
  }
  return deck.pop();
}

module.exports = { SUITS, RANKS, buildDeck, shuffle, drawCard };
