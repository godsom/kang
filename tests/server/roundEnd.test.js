const { createRoom, addPlayer, ROOM_STATUS } = require('../../src/server/room');
const { resolveDeckExhaustedWinner, applyKaengDeclaration, finishRound } = require('../../src/server/roundEnd');

const c = (rank, suit) => ({ rank, suit });

function setupRoom() {
  const room = createRoom('room1');
  addPlayer(room, 'alice', 's1');
  addPlayer(room, 'bob', 's2');
  room.status = ROOM_STATUS.IN_PROGRESS;
  room.turnIndex = 0;
  room.awaitingDiscard = false;
  room.isFirstTurn = true;
  return room;
}

describe('resolveDeckExhaustedWinner', () => {
  test('lowest total hand score wins', () => {
    const room = setupRoom();
    room.players[0].hand = [c('A', 'spades'), c('2', 'hearts')]; // 3
    room.players[1].hand = [c('9', 'clubs'), c('K', 'diamonds')]; // 19
    const result = resolveDeckExhaustedWinner(room.players);
    expect(result).toEqual({ winners: ['alice'], reason: 'deck_exhausted' });
  });

  test('ties split between all lowest-scoring players', () => {
    const room = setupRoom();
    room.players[0].hand = [c('5', 'spades')];
    room.players[1].hand = [c('5', 'clubs')];
    const result = resolveDeckExhaustedWinner(room.players);
    expect(result.winners.sort()).toEqual(['alice', 'bob']);
  });
});

describe('applyKaengDeclaration', () => {
  test('an instant-kaeng-eligible hand on the first turn wins', () => {
    const room = setupRoom();
    room.players[0].hand = [c('A', 'spades'), c('2', 'hearts'), c('3', 'clubs'), c('A', 'diamonds'), c('2', 'clubs')];
    const result = applyKaengDeclaration(room, 'alice');
    expect(result).toEqual({ winners: ['alice'], reason: 'instant_kaeng' });
    expect(room.players[0].declaredKaeng).toBe(false);
  });

  test('a valid meld wins on any turn', () => {
    const room = setupRoom();
    room.isFirstTurn = false;
    room.players[0].hand = [c('7', 'spades'), c('7', 'hearts'), c('7', 'clubs')];
    const result = applyKaengDeclaration(room, 'alice');
    expect(result).toEqual({ winners: ['alice'], reason: 'tong' });
  });

  test('throws for an invalid declaration and clears the flag', () => {
    const room = setupRoom();
    room.isFirstTurn = false;
    room.players[0].hand = [c('K', 'spades'), c('Q', 'hearts'), c('J', 'clubs'), c('9', 'diamonds'), c('8', 'spades')];
    expect(() => applyKaengDeclaration(room, 'alice')).toThrow('Invalid kaeng declaration');
    expect(room.players[0].declaredKaeng).toBe(false);
  });

  test('throws if the caller already drew this turn', () => {
    const room = setupRoom();
    room.awaitingDiscard = true;
    expect(() => applyKaengDeclaration(room, 'alice')).toThrow('Cannot declare kaeng after drawing this turn');
  });

  test('throws if it is not the caller\'s turn, even with an otherwise-winning hand', () => {
    const room = setupRoom();
    room.turnIndex = 0; // alice's turn, not bob's
    room.players[1].hand = [c('A', 'spades'), c('2', 'hearts'), c('3', 'clubs'), c('A', 'diamonds'), c('2', 'clubs')];
    expect(() => applyKaengDeclaration(room, 'bob')).toThrow('Not your turn');
  });
});

describe('finishRound', () => {
  test('applies the payout multiplier, resets the room to waiting, and rotates the dealer to the winner', () => {
    const room = setupRoom();
    room.players.forEach(p => { p.ready = true; p.declaredKaeng = true; });
    const outcome = finishRound(room, { winners: ['bob'], reason: 'tong' });
    expect(outcome).toEqual({ winners: ['bob'], reason: 'tong', multiplier: 2 });
    expect(room.status).toBe('waiting');
    expect(room.dealerId).toBe('bob');
    room.players.forEach(p => {
      expect(p.ready).toBe(false);
      expect(p.declaredKaeng).toBe(false);
    });
  });
});
