function getPlayerView(room, userId) {
  return {
    roomId: room.id,
    status: room.status,
    direction: room.direction,
    eatMode: room.eatMode,
    dealerId: room.dealerId,
    turnIndex: room.turnIndex,
    pot: room.pot,
    deckCount: room.deck.length,
    discardTop: room.discardPile.length > 0 ? room.discardPile[room.discardPile.length - 1] : null,
    players: room.players.map(p => ({
      userId: p.userId,
      ready: p.ready,
      connected: p.connected,
      isDealer: p.userId === room.dealerId,
      handCount: p.hand.length,
      ...(p.userId === userId ? { hand: p.hand } : {}),
    })),
  };
}

module.exports = { getPlayerView };
