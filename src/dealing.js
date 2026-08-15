const { GAME_CONFIG } = require('./config');
const { drawCard } = require('./deck');

function dealCards(players, deck, handSize = GAME_CONFIG.HAND_SIZE) {
  players.forEach(player => { player.hand = []; });
  for (let i = 0; i < handSize; i++) {
    players.forEach(player => { player.hand.push(drawCard(deck)); });
  }
  return players;
}

function determineFirstDealer(players, deck) {
  const draws = [...players].reverse().map(player => ({ userId: player.userId, card: drawCard(deck) }));
  const lowest = draws.reduce((min, draw) =>
    GAME_CONFIG.RANK_VALUE[draw.card.rank] < GAME_CONFIG.RANK_VALUE[min.card.rank] ? draw : min
  );
  return lowest.userId;
}

module.exports = { dealCards, determineFirstDealer };
