const { GAME_CONFIG } = require('../config');
const { computeSettlement, withUsernames } = require('./ledger');

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
    settlement: liveSettlement(room),
    spectators: spectatorRoster(room),
    players: room.players.map(p => ({
      userId: p.userId,
      username: p.username || p.userId,
      ready: p.ready,
      connected: p.connected,
      isDealer: p.userId === room.dealerId,
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
    settlement: liveSettlement(room),
    spectators: spectatorRoster(room),
    players: room.players.map(p => ({
      userId: p.userId,
      username: p.username || p.userId,
      ready: p.ready,
      connected: p.connected,
      isDealer: p.userId === room.dealerId,
      handCount: p.hand.length,
    })),
  };
}

module.exports = { getPlayerView, getSpectatorView };
