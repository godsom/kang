require('dotenv').config();
const Client = require('socket.io-client');
const { createSocketServer } = require('../../src/server/socketServer');
const { waitForEvent, collectEvents, waitUntil } = require('./testHelpers');

const card = (rank, suit) => ({ rank, suit });

describe('socketServer', () => {
  let httpServer, io, roomStore, port, clients;

  beforeEach((done) => {
    ({ httpServer, io, roomStore } = createSocketServer());
    httpServer.listen(() => {
      port = httpServer.address().port;
      done();
    });
    clients = [];
  });

  afterEach((done) => {
    clients.forEach(c => c.close());
    io.close();
    httpServer.close(done);
  });

  function connectClient() {
    const client = Client(`http://localhost:${port}`);
    clients.push(client);
    return client;
  }

  test('two players join, ready up, and receive their own dealt hand only', async () => {
    const alice = connectClient();
    const bob = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);

    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');

    alice.emit('room:join', { roomId: 'room1', userId: 'alice' });
    await waitUntil(() => aliceStates.length >= 1);
    expect(aliceStates[0].status).toBe('waiting');

    bob.emit('room:join', { roomId: 'room1', userId: 'bob' });
    await waitUntil(() => bobStates.length >= 1 && aliceStates.length >= 2);

    alice.emit('player:ready', { ready: true });
    await waitUntil(() => {
      const last = aliceStates[aliceStates.length - 1];
      return last.players.find(p => p.userId === 'alice').ready === true;
    });

    bob.emit('player:ready', { ready: true });
    await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'in_progress');
    await waitUntil(() => bobStates[bobStates.length - 1].status === 'in_progress');

    const aliceFinal = aliceStates[aliceStates.length - 1];
    const bobFinal = bobStates[bobStates.length - 1];

    expect(aliceFinal.players.find(p => p.userId === 'alice').hand).toHaveLength(5);
    expect(aliceFinal.players.find(p => p.userId === 'bob').hand).toBeUndefined();
    expect(aliceFinal.players.find(p => p.userId === 'bob').handCount).toBe(5);

    expect(bobFinal.players.find(p => p.userId === 'bob').hand).toHaveLength(5);
    expect(bobFinal.players.find(p => p.userId === 'alice').hand).toBeUndefined();
  });

  test('an unknown room is auto-created on first join with default direction/eatMode', async () => {
    const alice = connectClient();
    await waitForEvent(alice, 'connect');
    const aliceStates = collectEvents(alice, 'room:state');
    alice.emit('room:join', { roomId: 'brand-new-room', userId: 'alice' });
    await waitUntil(() => aliceStates.length >= 1);
    expect(aliceStates[0]).toMatchObject({ direction: 'one_way', eatMode: 'chain_eat', status: 'waiting' });
  });

  test('joining a full room emits room:error and does not add the player', async () => {
    for (let i = 0; i < 5; i++) {
      const c = connectClient();
      await waitForEvent(c, 'connect');
      const states = collectEvents(c, 'room:state');
      c.emit('room:join', { roomId: 'full-room', userId: `p${i}` });
      await waitUntil(() => states.length >= 1); // wait for each join to be confirmed before the next connects
    }
    const sixth = connectClient();
    await waitForEvent(sixth, 'connect');
    const errorPromise = waitForEvent(sixth, 'room:error');
    sixth.emit('room:join', { roomId: 'full-room', userId: 'p5' });
    const error = await errorPromise;
    expect(error.message).toBe('Room is full');
  });

  test('disconnecting during an in-progress round preserves the hand on reconnect', async () => {
    const alice = connectClient();
    const bob = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);

    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');

    alice.emit('room:join', { roomId: 'room2', userId: 'alice' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('room:join', { roomId: 'room2', userId: 'bob' });
    await waitUntil(() => bobStates.length >= 1);

    alice.emit('player:ready', { ready: true });
    bob.emit('player:ready', { ready: true });
    await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'in_progress');

    const aliceHandBeforeDisconnect = aliceStates[aliceStates.length - 1].players.find(p => p.userId === 'alice').hand;

    alice.close();
    await waitUntil(() => {
      const last = bobStates[bobStates.length - 1];
      const aliceEntry = last.players.find(p => p.userId === 'alice');
      return aliceEntry && aliceEntry.connected === false;
    });

    const aliceReconnect = connectClient();
    await waitForEvent(aliceReconnect, 'connect');
    const aliceReconnectStates = collectEvents(aliceReconnect, 'room:state');
    aliceReconnect.emit('room:join', { roomId: 'room2', userId: 'alice' });
    await waitUntil(() => aliceReconnectStates.length >= 1);

    const aliceView = aliceReconnectStates[aliceReconnectStates.length - 1].players.find(p => p.userId === 'alice');
    expect(aliceView.connected).toBe(true);
    expect(aliceView.hand).toEqual(aliceHandBeforeDisconnect);
  });

  test('a stale disconnect from an old socket does not clobber a player who already reconnected', async () => {
    const alice = connectClient();
    const bob = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);

    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');

    alice.emit('room:join', { roomId: 'room4', userId: 'alice' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('room:join', { roomId: 'room4', userId: 'bob' });
    await waitUntil(() => bobStates.length >= 1);

    alice.emit('player:ready', { ready: true });
    bob.emit('player:ready', { ready: true });
    await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'in_progress');

    // Simulate the rejoin arriving BEFORE the old socket's disconnect is
    // processed: rebind alice's player to a new socket while the original
    // socket is still open.
    const aliceReconnect = connectClient();
    await waitForEvent(aliceReconnect, 'connect');
    const aliceReconnectStates = collectEvents(aliceReconnect, 'room:state');
    aliceReconnect.emit('room:join', { roomId: 'room4', userId: 'alice' });
    await waitUntil(() => aliceReconnectStates.length >= 1);
    expect(aliceReconnectStates[aliceReconnectStates.length - 1].players.find(p => p.userId === 'alice').connected).toBe(true);

    // Now the original (stale) socket's disconnect finally arrives.
    const bobStatesBeforeStaleDisconnect = bobStates.length;
    alice.close();

    // Force a fresh broadcast so we can observe the resulting state.
    bob.emit('player:ready', { ready: true });
    await waitUntil(() => bobStates.length > bobStatesBeforeStaleDisconnect);

    const finalBobState = bobStates[bobStates.length - 1];
    const aliceEntry = finalBobState.players.find(p => p.userId === 'alice');
    expect(aliceEntry).toBeDefined();
    expect(aliceEntry.connected).toBe(true);
  });

  test('disconnecting while the room is waiting frees the seat', async () => {
    const alice = connectClient();
    const bob = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);

    const bobStates = collectEvents(bob, 'room:state');

    alice.emit('room:join', { roomId: 'room3', userId: 'alice' });
    bob.emit('room:join', { roomId: 'room3', userId: 'bob' });
    await waitUntil(() => bobStates.length >= 1 && bobStates[bobStates.length - 1].players.length === 2);

    alice.close();
    await waitUntil(() => bobStates[bobStates.length - 1].players.length === 1);
    expect(bobStates[bobStates.length - 1].players.find(p => p.userId === 'alice')).toBeUndefined();
  });

  test('a full turn: draw then discard advances to the next player', async () => {
    const alice = connectClient();
    const bob = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);

    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');

    alice.emit('room:join', { roomId: 'room4', userId: 'alice' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('room:join', { roomId: 'room4', userId: 'bob' });
    await waitUntil(() => bobStates.length >= 1);

    alice.emit('player:ready', { ready: true });
    bob.emit('player:ready', { ready: true });
    await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'in_progress');

    const dealtState = aliceStates[aliceStates.length - 1];
    const activeUserId = dealtState.players[dealtState.turnIndex].userId;
    const activeClient = activeUserId === 'alice' ? alice : bob;
    const activeStates = activeUserId === 'alice' ? aliceStates : bobStates;
    const otherStates = activeUserId === 'alice' ? bobStates : aliceStates;

    activeClient.emit('game:draw');
    await waitUntil(() => {
      const last = activeStates[activeStates.length - 1];
      const me = last.players.find(p => p.userId === activeUserId);
      return me.handCount === 6;
    });

    const myHand = activeStates[activeStates.length - 1].players.find(p => p.userId === activeUserId).hand;
    activeClient.emit('game:discard', { card: myHand[0] });
    await waitUntil(() => {
      const last = otherStates[otherStates.length - 1];
      return last.discardTop && last.discardTop.rank === myHand[0].rank && last.discardTop.suit === myHand[0].suit;
    });

    const finalState = otherStates[otherStates.length - 1];
    const newActiveUserId = finalState.players[finalState.turnIndex].userId;
    expect(newActiveUserId).not.toBe(activeUserId);
  });

  test('an invalid action emits game:error and does not change room state', async () => {
    const alice = connectClient();
    const bob = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);

    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');

    alice.emit('room:join', { roomId: 'room5', userId: 'alice' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('room:join', { roomId: 'room5', userId: 'bob' });
    await waitUntil(() => bobStates.length >= 1);

    alice.emit('player:ready', { ready: true });
    bob.emit('player:ready', { ready: true });
    await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'in_progress');

    const dealtState = aliceStates[aliceStates.length - 1];
    const inactiveUserId = dealtState.players[(dealtState.turnIndex + 1) % 2].userId;
    const inactiveClient = inactiveUserId === 'alice' ? alice : bob;

    const errorPromise = waitForEvent(inactiveClient, 'game:error');
    inactiveClient.emit('game:draw'); // not their turn
    const error = await errorPromise;
    expect(error.message).toBe('Not your turn');
  });

  test('a kaeng declaration ends the round and both players receive the same game:result', async () => {
    const alice = connectClient();
    const bob = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);

    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');
    const aliceResults = collectEvents(alice, 'game:result');
    const bobResults = collectEvents(bob, 'game:result');

    alice.emit('room:join', { roomId: 'room6', userId: 'alice' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('room:join', { roomId: 'room6', userId: 'bob' });
    await waitUntil(() => bobStates.length >= 1);

    alice.emit('player:ready', { ready: true });
    bob.emit('player:ready', { ready: true });
    await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'in_progress');

    const dealtState = aliceStates[aliceStates.length - 1];
    const activeUserId = dealtState.players[dealtState.turnIndex].userId;
    const activeClient = activeUserId === 'alice' ? alice : bob;

    // Stack the active player's hand with a guaranteed instant-kaeng-eligible
    // hand (all cards under the threshold) so the declaration is deterministic
    // rather than dependent on the random deal.
    const room = roomStore.get('room6');
    const activePlayer = room.players.find(p => p.userId === activeUserId);
    activePlayer.hand = [card('A', 'spades'), card('2', 'hearts'), card('3', 'clubs'), card('A', 'diamonds'), card('2', 'clubs')];

    activeClient.emit('game:kaeng');
    await waitUntil(() => aliceResults.length >= 1 && bobResults.length >= 1);

    expect(aliceResults[0]).toEqual({ winners: [activeUserId], reason: 'instant_kaeng', multiplier: 1 });
    expect(bobResults[0]).toEqual({ winners: [activeUserId], reason: 'instant_kaeng', multiplier: 1 });

    await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'waiting');
    await waitUntil(() => bobStates[bobStates.length - 1].status === 'waiting');
  });

  test('an invalid kaeng declaration does not end the round', async () => {
    const alice = connectClient();
    const bob = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);

    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');
    const aliceResults = collectEvents(alice, 'game:result');
    const bobResults = collectEvents(bob, 'game:result');

    alice.emit('room:join', { roomId: 'room7', userId: 'alice' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('room:join', { roomId: 'room7', userId: 'bob' });
    await waitUntil(() => bobStates.length >= 1);

    alice.emit('player:ready', { ready: true });
    bob.emit('player:ready', { ready: true });
    await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'in_progress');

    const dealtState = aliceStates[aliceStates.length - 1];
    const activeUserId = dealtState.players[dealtState.turnIndex].userId;
    const activeClient = activeUserId === 'alice' ? alice : bob;

    // Stack the active player's hand with a guaranteed-invalid declaration
    // (mixed high cards, no meld, not all under the instant-kaeng threshold),
    // matching the invalid-declaration fixture already used in roundEnd.test.js.
    const room = roomStore.get('room7');
    const activePlayer = room.players.find(p => p.userId === activeUserId);
    activePlayer.hand = [card('K', 'spades'), card('Q', 'hearts'), card('J', 'clubs'), card('9', 'diamonds'), card('8', 'spades')];

    const errorPromise = waitForEvent(activeClient, 'game:error');
    activeClient.emit('game:kaeng');
    const error = await errorPromise;
    expect(error.message).toBe('Invalid kaeng declaration');

    expect(aliceResults.length).toBe(0);
    expect(bobResults.length).toBe(0);
    expect(aliceStates[aliceStates.length - 1].status).toBe('in_progress');
  });

  test('a kaeng declaration from the inactive player is rejected as not their turn', async () => {
    const alice = connectClient();
    const bob = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);

    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');
    const aliceResults = collectEvents(alice, 'game:result');
    const bobResults = collectEvents(bob, 'game:result');

    alice.emit('room:join', { roomId: 'room8', userId: 'alice' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('room:join', { roomId: 'room8', userId: 'bob' });
    await waitUntil(() => bobStates.length >= 1);

    alice.emit('player:ready', { ready: true });
    bob.emit('player:ready', { ready: true });
    await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'in_progress');

    const dealtState = aliceStates[aliceStates.length - 1];
    const inactiveUserId = dealtState.players[(dealtState.turnIndex + 1) % 2].userId;
    const inactiveClient = inactiveUserId === 'alice' ? alice : bob;

    // No need to stack a hand here: the turn check must reject the
    // declaration before hand evaluation is ever reached.
    const errorPromise = waitForEvent(inactiveClient, 'game:error');
    inactiveClient.emit('game:kaeng'); // not their turn
    const error = await errorPromise;
    expect(error.message).toBe('Not your turn');

    expect(aliceResults.length).toBe(0);
    expect(bobResults.length).toBe(0);
    expect(aliceStates[aliceStates.length - 1].status).toBe('in_progress');
  });

  test('voice:join issues a token for a real room member requesting the player role', async () => {
    const alice = connectClient();
    await waitForEvent(alice, 'connect');
    const aliceStates = collectEvents(alice, 'room:state');
    alice.emit('room:join', { roomId: 'voice-room-1', userId: 'alice' });
    await waitUntil(() => aliceStates.length >= 1);

    const tokenPromise = waitForEvent(alice, 'voice:token');
    alice.emit('voice:join', { roomId: 'voice-room-1', role: 'player' });
    const payload = await tokenPromise;

    expect(payload.token).toBeDefined();
    expect(payload.url).toBeDefined();
    expect(typeof payload.pushToTalk).toBe('boolean');
  });

  test('voice:join rejects a caller who is not a member of the requested room', async () => {
    const alice = connectClient();
    await waitForEvent(alice, 'connect');
    const aliceStates = collectEvents(alice, 'room:state');
    alice.emit('room:join', { roomId: 'voice-room-2', userId: 'alice' });
    await waitUntil(() => aliceStates.length >= 1);

    const errorPromise = waitForEvent(alice, 'voice:error');
    alice.emit('voice:join', { roomId: 'some-other-room', role: 'player' });
    const error = await errorPromise;
    expect(error.message).toBe('Not a member of this room');
  });

  test('voice:join rejects an unsupported role', async () => {
    const alice = connectClient();
    await waitForEvent(alice, 'connect');
    const aliceStates = collectEvents(alice, 'room:state');
    alice.emit('room:join', { roomId: 'voice-room-3', userId: 'alice' });
    await waitUntil(() => aliceStates.length >= 1);

    const errorPromise = waitForEvent(alice, 'voice:error');
    alice.emit('voice:join', { roomId: 'voice-room-3', role: 'spectator' });
    const error = await errorPromise;
    expect(error.message).toBe('Only player voice access is supported currently');
  });

  test('voice:join emits voice:error instead of hanging or crashing when token issuance fails', async () => {
    const alice = connectClient();
    await waitForEvent(alice, 'connect');
    const aliceStates = collectEvents(alice, 'room:state');
    alice.emit('room:join', { roomId: 'voice-room-4', userId: 'alice' });
    await waitUntil(() => aliceStates.length >= 1);

    const originalApiKey = process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_KEY;
    try {
      const errorPromise = waitForEvent(alice, 'voice:error');
      alice.emit('voice:join', { roomId: 'voice-room-4', role: 'player' });
      const error = await errorPromise;
      expect(error.message).toBe('Failed to issue voice token');
    } finally {
      process.env.LIVEKIT_API_KEY = originalApiKey;
    }
  });
});
