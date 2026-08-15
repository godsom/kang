const { GAME_CONFIG } = require('./config');

function getNextTurn(turnIndex, directionSign, playerCount, direction) {
  if (direction === GAME_CONFIG.DIRECTION.ONE_WAY) {
    return { turnIndex: (turnIndex + 1) % playerCount, directionSign: 1 };
  }

  let nextIndex = turnIndex + directionSign;
  let nextSign = directionSign;
  if (nextIndex >= playerCount || nextIndex < 0) {
    nextSign = -directionSign;
    nextIndex = turnIndex + nextSign;
  }
  return { turnIndex: nextIndex, directionSign: nextSign };
}

module.exports = { getNextTurn };
