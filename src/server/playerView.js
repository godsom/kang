const { GAME_CONFIG } = require('../config');
const { computeSettlement, withUsernames } = require('./ledger');
const { canStart } = require('./roomLifecycle');

function liveSettlement(room) {
  return withUsernames(room, computeSettlement(room, GAME_CONFIG.BAHT_PER_POINT));
}

function spectatorRoster(room) {
  return room.spectators.map(s => ({
    userId: s.userId,
    username: s.username || s.userId,
    pendingSit: !!s.pendingSit,
  }));
}

function usernameFor(room, userId) {
  return room.players.find(p => p.userId === userId)?.username || userId;
}

// One-per-player reveal of the "who deals first" draw, for a client animation.
function firstDealerDraws(room) {
  if (!room.firstDealerDraws) return null;
  return room.firstDealerDraws.map(d => ({ ...d, username: usernameFor(room, d.userId) }));
}

function getPlayerView(room, userId) {
  return {
    roomId: room.id,
    status: room.status,
    direction: room.direction,
    eatMode: room.eatMode,
    dealerId: room.dealerId,
    turnIndex: room.turnIndex,
    awaitingDiscard: !!room.awaitingDiscard,
    isFirstTurn: !!room.isFirstTurn,
    turnDeadline: room.turnDeadline || null,
    pot: room.pot,
    deckCount: room.deck.length,
    discardTop: room.discardPile.length > 0 ? room.discardPile[room.discardPile.length - 1] : null,
    discardPile: room.discardPile.slice(-8),
    settlement: liveSettlement(room),
    spectators: spectatorRoster(room),
    firstDealerDraws: firstDealerDraws(room),
    readyToDeal: canStart(room),
    players: room.players.map(p => ({
      userId: p.userId,
      username: p.username || p.userId,
      ready: p.ready,
      connected: p.connected,
      isDealer: p.userId === room.dealerId,
      pendingStand: !!p.pendingStand,
      seatIndex: p.seatIndex,
      handCount: p.hand.length,
      ...(p.userId === userId ? { hand: p.hand } : {}),
    })),
  };
}

function getSpectatorView(room) {
  return {
    roomId: room.id,
    status: room.status,
    direction: room.direction,
    eatMode: room.eatMode,
    dealerId: room.dealerId,
    turnIndex: room.turnIndex,
    awaitingDiscard: !!room.awaitingDiscard,
    isFirstTurn: !!room.isFirstTurn,
    turnDeadline: room.turnDeadline || null,
    pot: room.pot,
    deckCount: room.deck.length,
    discardTop: room.discardPile.length > 0 ? room.discardPile[room.discardPile.length - 1] : null,
    discardPile: room.discardPile.slice(-8),
    settlement: liveSettlement(room),
    spectators: spectatorRoster(room),
    firstDealerDraws: firstDealerDraws(room),
    readyToDeal: canStart(room),
    players: room.players.map(p => ({
      userId: p.userId,
      username: p.username || p.userId,
      ready: p.ready,
      connected: p.connected,
      isDealer: p.userId === room.dealerId,
      pendingStand: !!p.pendingStand,
      seatIndex: p.seatIndex,
      handCount: p.hand.length,
    })),
  };
}

function getRoomSummary(room) {
  return {
    roomId: room.id,
    status: room.status,
    playerCount: room.players.length,
    players: room.players.map(p => p.username || p.userId),
  };
}

module.exports = { getPlayerView, getSpectatorView, getRoomSummary };
