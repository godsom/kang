const { GAME_CONFIG } = require('../config');
const { ROOM_STATUS, findPlayer } = require('./room');
const { buildDeck, shuffle } = require('../deck');
const { dealCards, determineFirstDealer } = require('../dealing');

function setPlayerReady(room, userId, ready) {
  const player = findPlayer(room, userId);
  if (!player) {
    throw new Error('Player not in room');
  }
  player.ready = ready;
  return room;
}

function canStart(room) {
  return (
    room.status === ROOM_STATUS.WAITING &&
    room.players.length >= GAME_CONFIG.MIN_PLAYERS &&
    room.players.every(p => p.ready)
  );
}

function startRound(room) {
  if (!room.dealerId) {
    const drawDeck = shuffle(buildDeck());
    room.dealerId = determineFirstDealer(room.players, drawDeck);
  }
  const deck = shuffle(buildDeck());
  dealCards(room.players, deck, GAME_CONFIG.HAND_SIZE);
  room.deck = deck;
  room.discardPile = [];
  room.turnIndex = room.players.findIndex(p => p.userId === room.dealerId);
  room.directionSign = 1;
  room.isFirstTurn = true;
  room.awaitingDiscard = false;
  room.lastDiscardWasEat = false;
  room.status = ROOM_STATUS.IN_PROGRESS;
  return room;
}

module.exports = { setPlayerReady, canStart, startRound };
