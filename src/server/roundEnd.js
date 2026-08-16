// src/server/roundEnd.js
const { calcHandScore } = require('../handScore');
const { checkKaengWin, getPayoutMultiplier } = require('../win');
const { ROOM_STATUS, findPlayer } = require('./room');
const { isPlayersTurn } = require('./turnActions');

function resolveDeckExhaustedWinner(players) {
  const scored = players.map(p => ({ userId: p.userId, score: calcHandScore(p.hand) }));
  const minScore = Math.min(...scored.map(p => p.score));
  const winners = scored.filter(p => p.score === minScore).map(p => p.userId);
  return { winners, reason: 'deck_exhausted' };
}

function applyKaengDeclaration(room, userId) {
  if (room.status !== ROOM_STATUS.IN_PROGRESS) {
    throw new Error('Round is not in progress');
  }
  const player = findPlayer(room, userId);
  if (!player) {
    throw new Error('Player not in room');
  }
  if (!isPlayersTurn(room, userId)) {
    throw new Error('Not your turn');
  }
  if (room.awaitingDiscard) {
    throw new Error('Cannot declare kaeng after drawing this turn');
  }

  player.declaredKaeng = true;
  const result = checkKaengWin(room.players, room.isFirstTurn);
  player.declaredKaeng = false;

  if (!result) {
    throw new Error('Invalid kaeng declaration');
  }
  return result;
}

function finishRound(room, result) {
  const multiplier = getPayoutMultiplier(result.reason);
  room.status = ROOM_STATUS.WAITING;
  room.dealerId = result.winners[0];
  room.players.forEach(p => {
    p.ready = false;
    p.declaredKaeng = false;
  });
  return { ...result, multiplier };
}

module.exports = { resolveDeckExhaustedWinner, applyKaengDeclaration, finishRound };
