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

  test('a valid meld wins on the first turn when it also has the lowest score', () => {
    const room = setupRoom();
    room.isFirstTurn = true;
    // A K kicker (value 10) disqualifies instant-kaeng eligibility, so this
    // must go through the score comparison, not the instant-kaeng check.
    room.players[0].hand = [c('7', 'spades'), c('7', 'hearts'), c('7', 'clubs'), c('K', 'diamonds')]; // score 31
    room.players[1].hand = [c('K', 'spades'), c('Q', 'hearts'), c('J', 'clubs'), c('10', 'diamonds'), c('9', 'spades')]; // score 49
    const result = applyKaengDeclaration(room, 'alice');
    expect(result).toEqual({ winners: ['alice'], reason: 'tong' });
  });

  test('a real dealt 5-card hand with a tong (3 matching + 2 kickers) wins on the first turn when it also has the lowest score', () => {
    const room = setupRoom();
    room.isFirstTurn = true;
    room.players[0].hand = [c('7', 'spades'), c('7', 'hearts'), c('7', 'clubs'), c('2', 'diamonds'), c('K', 'spades')]; // score 33
    room.players[1].hand = [c('K', 'spades'), c('Q', 'hearts'), c('J', 'clubs'), c('10', 'diamonds'), c('9', 'spades')]; // score 49
    const result = applyKaengDeclaration(room, 'alice');
    expect(result).toEqual({ winners: ['alice'], reason: 'tong' });
  });

  test('a meld does NOT win outright even on the first turn — it still loses if another hand actually scores lower', () => {
    const room = setupRoom();
    room.isFirstTurn = true;
    room.players[0].hand = [c('7', 'spades'), c('7', 'hearts'), c('7', 'clubs'), c('2', 'diamonds'), c('K', 'spades')]; // score 33, a real tong
    room.players[1].hand = [c('A', 'spades'), c('A', 'hearts')]; // score 2, beats alice despite her meld
    const result = applyKaengDeclaration(room, 'alice');
    expect(result).toEqual({ winners: ['bob'], reason: 'kaeng_call_loss', doubledWinners: ['bob'] });
  });

  test('a meld on a later turn still only pays the plain kaeng multiplier, even when it wins the comparison — ตอง/เรียง/สเตรท only ever upgrade the multiplier on the first turn', () => {
    const room = setupRoom();
    room.isFirstTurn = false;
    room.players[0].hand = [c('7', 'spades'), c('7', 'hearts'), c('7', 'clubs'), c('A', 'diamonds'), c('A', 'spades')]; // score 23, a real tong, and the lowest score
    room.players[1].hand = [c('K', 'spades'), c('Q', 'hearts'), c('J', 'clubs'), c('10', 'diamonds'), c('9', 'spades')]; // score 49
    const result = applyKaengDeclaration(room, 'alice');
    expect(result).toEqual({ winners: ['alice'], reason: 'kaeng_call_win' });
  });

  test('a kaeng declaration with no meld and no instant-kaeng eligibility falls back to a score showdown', () => {
    const room = setupRoom();
    room.isFirstTurn = false;
    room.players[0].hand = [c('K', 'spades'), c('Q', 'hearts'), c('J', 'clubs'), c('9', 'diamonds'), c('8', 'spades')]; // score 47
    room.players[1].hand = [c('2', 'clubs'), c('2', 'diamonds'), c('3', 'hearts'), c('3', 'spades'), c('4', 'clubs')]; // score 14
    const result = applyKaengDeclaration(room, 'alice');
    expect(result).toEqual({ winners: ['bob'], reason: 'kaeng_call_loss', doubledWinners: ['bob'] });
    expect(room.players[0].declaredKaeng).toBe(false);
  });

  test('the showdown fallback still lets the caller win with the better score', () => {
    const room = setupRoom();
    room.isFirstTurn = false;
    room.players[0].hand = [c('A', 'spades'), c('2', 'hearts'), c('3', 'clubs'), c('4', 'diamonds'), c('5', 'spades')]; // score 15
    room.players[1].hand = [c('K', 'clubs'), c('Q', 'diamonds'), c('J', 'hearts'), c('10', 'spades'), c('9', 'clubs')]; // score 49
    const result = applyKaengDeclaration(room, 'alice');
    expect(result).toEqual({ winners: ['alice'], reason: 'kaeng_call_win' });
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
    expect(outcome).toEqual({ winners: ['bob'], reason: 'tong', multiplier: 2, points: { alice: -2, bob: 2 } });
    expect(room.status).toBe('waiting');
    expect(room.dealerId).toBe('bob');
    room.players.forEach(p => {
      expect(p.ready).toBe(false);
      expect(p.declaredKaeng).toBe(false);
    });
  });

  test('credits the payout multiplier as ledger points from each loser to the winner', () => {
    const room = setupRoom();
    finishRound(room, { winners: ['bob'], reason: 'tong' });
    expect(room.ledger.alice.bob).toBe(2);
  });

  test('a lost kaeng call credits the multiplier from the caller to every other player', () => {
    const room = setupRoom();
    // Add a third player directly, bypassing addPlayer's WAITING-only guard
    // — setupRoom() already put the room IN_PROGRESS for this describe block.
    room.players.push({ userId: 'carol', socketId: 's3', hand: [], ready: false, connected: true, handScore: 0, declaredKaeng: false });
    // winners = everyone except the caller (alice) — this is how a
    // kaeng_call_loss outcome is shaped by resolveKaengShowdown.
    finishRound(room, { winners: ['bob', 'carol'], reason: 'kaeng_call_loss' });
    expect(room.ledger.alice.bob).toBe(1);
    expect(room.ledger.alice.carol).toBe(1);
  });

  test('a lost kaeng call pays the actual lowest score double, everyone else who merely beat the caller single', () => {
    const room = setupRoom();
    room.players.push({ userId: 'carol', socketId: 's3', hand: [], ready: false, connected: true, handScore: 0, declaredKaeng: false });
    // bob has the true lowest score and is doubled; carol only beat the
    // caller (alice) and gets the plain rate.
    const outcome = finishRound(room, { winners: ['bob', 'carol'], reason: 'kaeng_call_loss', doubledWinners: ['bob'] });
    expect(room.ledger.alice.bob).toBe(2);
    expect(room.ledger.alice.carol).toBe(1);
    expect(outcome.points).toEqual({ alice: -3, bob: 2, carol: 1 });
  });
});
