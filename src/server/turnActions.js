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

function assertCanDiscard(room, userId) {
  if (room.status !== ROOM_STATUS.IN_PROGRESS) {
    throw new Error('Round is not in progress');
  }
  if (!isPlayersTurn(room, userId)) {
    throw new Error('Not your turn');
  }
  if (!room.awaitingDiscard) {
    throw new Error('Must draw before discarding');
  }
}

function finishDiscard(room, userId, discardedCards) {
  discardedCards.forEach(c => room.discardPile.push(c));
  room.discardOwnerId = userId;
  room.awaitingDiscard = false;
  room.lastDiscardWasEat = false;
  room.isFirstTurn = false;
  advanceTurn(room);
}

function applyDiscard(room, userId, card) {
  assertCanDiscard(room, userId);
  const player = findPlayer(room, userId);
  const discarded = removeCardFromHand(player, card);
  finishDiscard(room, userId, [discarded]);
  return { discarded };
}

// The hand isn't held at a fixed size — the goal is the lowest score/fewest
// cards, not a full 5. Discarding an entire matching set (2-4 of the same
// rank) in one action is how a hand actually shrinks, no replacement draw.
function applyMultiDiscard(room, userId, cards) {
  assertCanDiscard(room, userId);
  if (!Array.isArray(cards) || cards.length < 2) {
    throw new Error('Multi-discard requires at least 2 cards');
  }
  if (!cards.every(c => c.rank === cards[0].rank)) {
    throw new Error('Multi-discard cards must all share the same rank');
  }

  const player = findPlayer(room, userId);
  // Validate every requested card actually exists in hand (as distinct
  // cards, not the same one claimed twice) before removing any of them, so
  // an invalid request can never leave the hand partially mutated.
  const claimedIndices = [];
  for (const card of cards) {
    const idx = player.hand.findIndex((c, i) => (
      c.suit === card.suit && c.rank === card.rank && !claimedIndices.includes(i)
    ));
    if (idx === -1) {
      throw new Error('Card not in hand');
    }
    claimedIndices.push(idx);
  }

  const discarded = [...claimedIndices]
    .sort((a, b) => b - a)
    .map(i => player.hand.splice(i, 1)[0])
    .reverse();
  finishDiscard(room, userId, discarded);
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

// Eating with a whole matching set (2-3 cards, same rank as the discard top)
// in one action plays every one of those cards onto the pile, not just one —
// and the ledger points scale with how many were actually played (x2 for a
// pair, x3 for a triple), same shape as applyMultiDiscard's set-claim.
function applyMultiEat(room, userId, cards) {
  if (!Array.isArray(cards) || cards.length < 2) {
    throw new Error('Multi-eat requires at least 2 cards');
  }
  if (!cards.every(c => c.rank === cards[0].rank)) {
    throw new Error('Multi-eat cards must all share the same rank');
  }
  if (!canEat(room, userId, cards[0])) {
    throw new Error('Cannot eat this card');
  }

  const player = findPlayer(room, userId);
  const claimedIndices = [];
  for (const card of cards) {
    const idx = player.hand.findIndex((c, i) => (
      c.suit === card.suit && c.rank === card.rank && !claimedIndices.includes(i)
    ));
    if (idx === -1) {
      throw new Error('Card not in hand');
    }
    claimedIndices.push(idx);
  }

  const eaten = [...claimedIndices]
    .sort((a, b) => b - a)
    .map(i => player.hand.splice(i, 1)[0])
    .reverse();
  eaten.forEach(c => room.discardPile.push(c));
  const points = eaten.length;
  if (room.discardOwnerId) {
    addLedgerPoints(room, room.discardOwnerId, userId, points);
  }
  room.discardOwnerId = userId;
  room.lastDiscardWasEat = true;
  room.isFirstTurn = false;
  advanceTurn(room);
  return { eaten, points };
}

module.exports = { isPlayersTurn, applyDraw, applyDiscard, applyMultiDiscard, canEat, applyEat, applyMultiEat };
