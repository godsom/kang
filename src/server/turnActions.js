const { GAME_CONFIG } = require('../config');
const { drawCard } = require('../deck');
const { getNextTurn } = require('../turn');
const { ROOM_STATUS, findPlayer } = require('./room');
const { addLedgerPoints } = require('./ledger');

function activePlayer(room) {
  return room.players[room.turnIndex];
}

function isPlayersTurn(room, userId) {
  const player = activePlayer(room);
  return !!player && player.userId === userId;
}

function advanceTurn(room) {
  const next = getNextTurn(room.turnIndex, room.directionSign, room.players.length, room.direction);
  room.turnIndex = next.turnIndex;
  room.directionSign = next.directionSign;
}

function removeCardFromHand(player, card) {
  const index = player.hand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
  if (index === -1) {
    throw new Error('Card not in hand');
  }
  return player.hand.splice(index, 1)[0];
}

function applyDraw(room, userId) {
  if (room.status !== ROOM_STATUS.IN_PROGRESS) {
    throw new Error('Round is not in progress');
  }
  if (!isPlayersTurn(room, userId)) {
    throw new Error('Not your turn');
  }
  if (room.awaitingDiscard) {
    throw new Error('Already drawn this turn');
  }
  if (room.deck.length === 0) {
    return { deckExhausted: true };
  }
  const player = findPlayer(room, userId);
  const card = drawCard(room.deck);
  player.hand.push(card);
  room.awaitingDiscard = true;
  return { deckExhausted: false, card };
}

function applyDiscard(room, userId, card) {
  if (room.status !== ROOM_STATUS.IN_PROGRESS) {
    throw new Error('Round is not in progress');
  }
  if (!isPlayersTurn(room, userId)) {
    throw new Error('Not your turn');
  }
  if (!room.awaitingDiscard) {
    throw new Error('Must draw before discarding');
  }
  const player = findPlayer(room, userId);
  const discarded = removeCardFromHand(player, card);
  room.discardPile.push(discarded);
  room.discardOwnerId = userId;
  room.awaitingDiscard = false;
  room.lastDiscardWasEat = false;
  room.isFirstTurn = false;
  advanceTurn(room);
  return { discarded };
}

function canEat(room, userId, card) {
  if (room.status !== ROOM_STATUS.IN_PROGRESS) return false;
  if (!isPlayersTurn(room, userId)) return false;
  if (room.awaitingDiscard) return false;
  if (room.discardPile.length === 0) return false;
  if (room.eatMode === GAME_CONFIG.EAT_MODE.SEQUENTIAL && room.lastDiscardWasEat) return false;
  const topCard = room.discardPile[room.discardPile.length - 1];
  return card.rank === topCard.rank;
}

function applyEat(room, userId, card) {
  if (!canEat(room, userId, card)) {
    throw new Error('Cannot eat this card');
  }
  const player = findPlayer(room, userId);
  // Eating with a matching pair already in hand (2+ of that rank, including
  // the card being played) is worth double the ledger points.
  const rankCount = player.hand.filter(c => c.rank === card.rank).length;
  const points = rankCount >= 2 ? 2 : 1;
  const eaten = removeCardFromHand(player, card);
  room.discardPile.push(eaten);
  if (room.discardOwnerId) {
    addLedgerPoints(room, room.discardOwnerId, userId, points);
  }
  room.discardOwnerId = userId;
  room.lastDiscardWasEat = true;
  room.isFirstTurn = false;
  advanceTurn(room);
  return { eaten, points };
}

module.exports = { isPlayersTurn, applyDraw, applyDiscard, canEat, applyEat };
