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

// Just picks who deals (once per room, never re-drawn on later rounds) — not
// the actual card deal. Split out so a room can know its dealer, and show
// that player a "แจกไพ่" button, before any cards are actually dealt.
function ensureDealer(room) {
  if (room.dealerId) return room;
  const drawDeck = shuffle(buildDeck());
  const { dealerId, draws } = determineFirstDealer(room.players, drawDeck);
  room.dealerId = dealerId;
  room.firstDealerDraws = draws; // exposed to clients for a reveal animation
  return room;
}

// The actual hand deal — only ever triggered by the dealer's own explicit
// action (game:deal), never automatically once everyone is ready.
function dealRound(room) {
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

function startRound(room) {
  ensureDealer(room);
  return dealRound(room);
}

module.exports = { setPlayerReady, canStart, startRound, ensureDealer, dealRound };
