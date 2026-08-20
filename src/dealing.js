const { GAME_CONFIG } = require('./config');
const { drawCard } = require('./deck');
const { RANK_ORDER } = require('./meld');

// Suit tie-break order for determineFirstDealer, when two draws share a
// rank: ดอกจิก (clubs) < ข้าวหลามตัด (diamonds) < หัวใจ (hearts) < โพดำ (spades) —
// the standard low-to-high suit ranking.
const SUIT_ORDER = { clubs: 1, diamonds: 2, hearts: 3, spades: 4 };

function dealCards(players, deck, handSize = GAME_CONFIG.HAND_SIZE) {
  players.forEach(player => { player.hand = []; });
  for (let i = 0; i < handSize; i++) {
    players.forEach(player => { player.hand.push(drawCard(deck)); });
  }
  return players;
}

// Draws one card per player to determine the table's first dealer — whoever
// draws the highest-ranked card starts as dealer (A low ... K high, per
// meld.js's RANK_ORDER). This must NOT use GAME_CONFIG.RANK_VALUE: that map
// is for hand-score/instant-kaeng purposes and collapses J/Q/K to the same
// value 10, which can't tell a King from a Jack when picking the dealer.
// Returns the full set of draws too, so callers can show a reveal of who drew what.
function beatsCurrentHighest(draw, max) {
  const rankDiff = RANK_ORDER[draw.card.rank] - RANK_ORDER[max.card.rank];
  if (rankDiff !== 0) return rankDiff > 0;
  return SUIT_ORDER[draw.card.suit] > SUIT_ORDER[max.card.suit];
}

function determineFirstDealer(players, deck) {
  const draws = players.map(player => ({ userId: player.userId, card: drawCard(deck) }));
  const highest = draws.reduce((max, draw) => (beatsCurrentHighest(draw, max) ? draw : max));
  return { dealerId: highest.userId, draws };
}

module.exports = { dealCards, determineFirstDealer };
