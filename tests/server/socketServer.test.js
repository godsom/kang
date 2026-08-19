require('dotenv').config();
const Client = require('socket.io-client');
const { createSocketServer } = require('../../src/server/socketServer');
const { waitForEvent, collectEvents, waitUntil } = require('./testHelpers');
const { signToken } = require('../../src/auth/tokens');

const card = (rank, suit) => ({ rank, suit });

describe('socketServer', () => {
  let server, httpServer, io, roomStore, port, clients;

  beforeEach((done) => {
    server = createSocketServer();
    ({ httpServer, io, roomStore } = server);
    httpServer.listen(() => {
      port = httpServer.address().port;
      done();
    });
    clients = [];
  });

  afterEach(async () => {
    clients.forEach(c => c.close());
    if (server.redisClient && server.redisClient.isOpen) {
      await server.redisClient.quit();
    }
    if (server.pool) {
      await server.pool.end();
    }
    io.close();
    await new Promise(resolve => httpServer.close(resolve));
  });

  function connectClient() {
    const client = Client(`http://localhost:${port}`);
    clients.push(client);
    return client;
  }

  test('room:join is rejected before auth', async () => {
    const alice = connectClient();
    await waitForEvent(alice, 'connect');
    const errorPromise = waitForEvent(alice, 'room:error');
    alice.emit('room:join', { roomId: 'unauth-room' });
    const error = await errorPromise;
    expect(error.message).toBe('Not authenticated');
  });

  test('a garbage token is rejected with auth:error', async () => {
    const alice = connectClient();
    await waitForEvent(alice, 'connect');
    const errorPromise = waitForEvent(alice, 'auth:error');
    alice.emit('auth', { token: 'not-a-real-token' });
    const error = await errorPromise;
    expect(error.message).toBe('Invalid token');
  });

  test('a valid token authenticates the socket and room:join uses the token subject as userId', async () => {
    const alice = connectClient();
    await waitForEvent(alice, 'connect');
    const okPromise = waitForEvent(alice, 'auth:ok');
    const token = signToken({ id: 'alice-id', username: 'alice' }, process.env.JWT_SECRET);
    alice.emit('auth', { token });
    const ok = await okPromise;
    expect(ok.userId).toBe('alice-id');

    const aliceStates = collectEvents(alice, 'room:state');
    // even if the client lies about userId in the payload, the server must use the verified one
    alice.emit('room:join', { roomId: 'auth-room', userId: 'someone-else' });
    await waitUntil(() => aliceStates.length >= 1);
    expect(aliceStates[0].players[0].userId).toBe('alice-id');
  });

  test('two players join, ready up, and receive their own dealt hand only', async () => {
    const alice = connectClient();
    const bob = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);

    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');

    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'room1' });
    await waitUntil(() => aliceStates.length >= 1);
    expect(aliceStates[0].status).toBe('waiting');

    bob.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bob, 'auth:ok');
    bob.emit('room:join', { roomId: 'room1' });
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
    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'brand-new-room' });
    await waitUntil(() => aliceStates.length >= 1);
    expect(aliceStates[0]).toMatchObject({ direction: 'one_way', eatMode: 'chain_eat', status: 'waiting' });
  });

  test('joining a full room emits room:error and does not add the player', async () => {
    for (let i = 0; i < 5; i++) {
      const c = connectClient();
      await waitForEvent(c, 'connect');
      const states = collectEvents(c, 'room:state');
      c.emit('auth', { token: signToken({ id: `p${i}`, username: `p${i}` }, process.env.JWT_SECRET) });
      await waitForEvent(c, 'auth:ok');
      c.emit('room:join', { roomId: 'full-room' });
      await waitUntil(() => states.length >= 1); // wait for each join to be confirmed before the next connects
    }
    const sixth = connectClient();
    await waitForEvent(sixth, 'connect');
    const errorPromise = waitForEvent(sixth, 'room:error');
    sixth.emit('auth', { token: signToken({ id: 'p5', username: 'p5' }, process.env.JWT_SECRET) });
    await waitForEvent(sixth, 'auth:ok');
    sixth.emit('room:join', { roomId: 'full-room' });
    const error = await errorPromise;
    expect(error.message).toBe('Room is full');
  });

  test('a userId cannot join as both a player and a spectator in the same room', async () => {
    const alice = connectClient();
    await waitForEvent(alice, 'connect');
    const aliceStates = collectEvents(alice, 'room:state');
    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'dual-role-room' });
    await waitUntil(() => aliceStates.length >= 1);

    const aliceSpectate = connectClient();
    await waitForEvent(aliceSpectate, 'connect');
    const spectateErrorPromise = waitForEvent(aliceSpectate, 'room:error');
    aliceSpectate.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(aliceSpectate, 'auth:ok');
    aliceSpectate.emit('room:join', { roomId: 'dual-role-room', asSpectator: true });
    const spectateError = await spectateErrorPromise;
    expect(spectateError.message).toBe('Already a player in this room');

    const bobSpectate = connectClient();
    await waitForEvent(bobSpectate, 'connect');
    const bobStates = collectEvents(bobSpectate, 'room:state');
    bobSpectate.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bobSpectate, 'auth:ok');
    bobSpectate.emit('room:join', { roomId: 'dual-role-room', asSpectator: true });
    await waitUntil(() => bobStates.length >= 1);

    const bobJoinAsPlayer = connectClient();
    await waitForEvent(bobJoinAsPlayer, 'connect');
    const playerErrorPromise = waitForEvent(bobJoinAsPlayer, 'room:error');
    bobJoinAsPlayer.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bobJoinAsPlayer, 'auth:ok');
    bobJoinAsPlayer.emit('room:join', { roomId: 'dual-role-room' });
    const playerError = await playerErrorPromise;
    expect(playerError.message).toBe('Already a spectator in this room');
  });

  test('disconnecting during an in-progress round preserves the hand on reconnect', async () => {
    const alice = connectClient();
    const bob = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);

    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');

    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'room2' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bob, 'auth:ok');
    bob.emit('room:join', { roomId: 'room2' });
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
    aliceReconnect.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(aliceReconnect, 'auth:ok');
    aliceReconnect.emit('room:join', { roomId: 'room2' });
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

    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'room4' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bob, 'auth:ok');
    bob.emit('room:join', { roomId: 'room4' });
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
    aliceReconnect.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(aliceReconnect, 'auth:ok');
    aliceReconnect.emit('room:join', { roomId: 'room4' });
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

    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'room3' });
    bob.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bob, 'auth:ok');
    bob.emit('room:join', { roomId: 'room3' });
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

    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'room4' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bob, 'auth:ok');
    bob.emit('room:join', { roomId: 'room4' });
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

    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'room5' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bob, 'auth:ok');
    bob.emit('room:join', { roomId: 'room5' });
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

    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'room6' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bob, 'auth:ok');
    bob.emit('room:join', { roomId: 'room6' });
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

    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'room7' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bob, 'auth:ok');
    bob.emit('room:join', { roomId: 'room7' });
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

    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'room8' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bob, 'auth:ok');
    bob.emit('room:join', { roomId: 'room8' });
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
    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'voice-room-1' });
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
    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'voice-room-2' });
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
    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'voice-room-3' });
    await waitUntil(() => aliceStates.length >= 1);

    const errorPromise = waitForEvent(alice, 'voice:error');
    alice.emit('voice:join', { roomId: 'voice-room-3', role: 'spectator' });
    const error = await errorPromise;
    expect(error.message).toBe('Only player voice access is available for this membership');
  });

  test('voice:join emits voice:error instead of hanging or crashing when token issuance fails', async () => {
    const alice = connectClient();
    await waitForEvent(alice, 'connect');
    const aliceStates = collectEvents(alice, 'room:state');
    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'voice-room-4' });
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

  test('a spectator can join a room and receives a filtered room:state with no hands', async () => {
    const alice = connectClient();
    const bob = connectClient();
    const spectator = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect'), waitForEvent(spectator, 'connect')]);

    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');
    const specStates = collectEvents(spectator, 'room:state');

    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'spec-room-1' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bob, 'auth:ok');
    bob.emit('room:join', { roomId: 'spec-room-1' });
    await waitUntil(() => bobStates.length >= 1);
    spectator.emit('auth', { token: signToken({ id: 'watcher', username: 'watcher' }, process.env.JWT_SECRET) });
    await waitForEvent(spectator, 'auth:ok');
    spectator.emit('room:join', { roomId: 'spec-room-1', asSpectator: true });
    await waitUntil(() => specStates.length >= 1);

    alice.emit('player:ready', { ready: true });
    bob.emit('player:ready', { ready: true });
    await waitUntil(() => specStates[specStates.length - 1].status === 'in_progress');

    const specView = specStates[specStates.length - 1];
    specView.players.forEach(p => {
      expect('hand' in p).toBe(false);
      expect(p.handCount).toBe(5);
    });
  });

  test('a spectator can join a full or in-progress room where a player join would fail', async () => {
    const clients = [];
    for (let i = 0; i < 5; i++) {
      const c = connectClient();
      await waitForEvent(c, 'connect');
      const states = collectEvents(c, 'room:state');
      c.emit('auth', { token: signToken({ id: `p${i}`, username: `p${i}` }, process.env.JWT_SECRET) });
      await waitForEvent(c, 'auth:ok');
      c.emit('room:join', { roomId: 'spec-room-2' });
      await waitUntil(() => states.length >= 1);
      clients.push(c);
    }

    const spectator = connectClient();
    await waitForEvent(spectator, 'connect');
    const specStates = collectEvents(spectator, 'room:state');
    spectator.emit('auth', { token: signToken({ id: 'watcher', username: 'watcher' }, process.env.JWT_SECRET) });
    await waitForEvent(spectator, 'auth:ok');
    spectator.emit('room:join', { roomId: 'spec-room-2', asSpectator: true });
    await waitUntil(() => specStates.length >= 1);

    expect(specStates[0].players).toHaveLength(5);
  });

  test('a room with a departed player but a remaining spectator is not deleted', async () => {
    const alice = connectClient();
    const spectator = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(spectator, 'connect')]);

    const aliceStates = collectEvents(alice, 'room:state');
    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'spec-room-3' });
    await waitUntil(() => aliceStates.length >= 1);

    const specStates = collectEvents(spectator, 'room:state');
    spectator.emit('auth', { token: signToken({ id: 'watcher', username: 'watcher' }, process.env.JWT_SECRET) });
    await waitForEvent(spectator, 'auth:ok');
    spectator.emit('room:join', { roomId: 'spec-room-3', asSpectator: true });
    await waitUntil(() => specStates.length >= 1);

    alice.close(); // room is 'waiting', so this removes alice outright (Milestone 2 behavior) — 0 players, 1 spectator
    await waitUntil(() => specStates[specStates.length - 1].players.length === 0);

    // If the room had been deleted from the store, a fresh join would create a brand-new empty room;
    // instead it must still be the SAME room the spectator is watching, reflected via a normal broadcast.
    const bob = connectClient();
    await waitForEvent(bob, 'connect');
    const bobStates = collectEvents(bob, 'room:state');
    bob.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bob, 'auth:ok');
    bob.emit('room:join', { roomId: 'spec-room-3' });
    await waitUntil(() => specStates.length >= 3); // spectator gets a broadcast when bob joins the (still-alive) room
    await waitUntil(() => bobStates.length >= 1);
    expect(bobStates[0].players.map(p => p.userId)).toEqual(['bob']);
  });

  test('a spectator gets a subscribe-only voice token', async () => {
    const alice = connectClient();
    const spectator = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(spectator, 'connect')]);

    const aliceStates = collectEvents(alice, 'room:state');
    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'spec-voice-1' });
    await waitUntil(() => aliceStates.length >= 1);

    const specStates = collectEvents(spectator, 'room:state');
    spectator.emit('auth', { token: signToken({ id: 'watcher', username: 'watcher' }, process.env.JWT_SECRET) });
    await waitForEvent(spectator, 'auth:ok');
    spectator.emit('room:join', { roomId: 'spec-voice-1', asSpectator: true });
    await waitUntil(() => specStates.length >= 1);

    const tokenPromise = waitForEvent(spectator, 'voice:token');
    spectator.emit('voice:join', { roomId: 'spec-voice-1', role: 'spectator' });
    const payload = await tokenPromise;

    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(payload.token, process.env.LIVEKIT_API_SECRET);
    expect(decoded.video.canPublish).toBe(false);
    expect(decoded.video.canSubscribe).toBe(true);
  });

  test('a finished round is persisted to match history and the winner appears on the leaderboard', async () => {
    // Identifiers are suffixed per run: match_history/player_stats/the Redis
    // leaderboard persist in a real, un-truncated database across test runs, so a
    // fixed userId would let a *stale* row from an earlier run satisfy the
    // "row exists" poll below before this round's own write has actually landed.
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const statsAliceId = `stats-alice-${runId}`;
    const statsBobId = `stats-bob-${runId}`;
    const roomId = `stats-room-${runId}`;

    const alice = connectClient();
    const bob = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);

    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');

    alice.emit('auth', { token: signToken({ id: statsAliceId, username: statsAliceId }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('auth', { token: signToken({ id: statsBobId, username: statsBobId }, process.env.JWT_SECRET) });
    await waitForEvent(bob, 'auth:ok');
    bob.emit('room:join', { roomId });
    await waitUntil(() => bobStates.length >= 1);

    alice.emit('player:ready', { ready: true });
    bob.emit('player:ready', { ready: true });
    await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'in_progress');

    // Stack the active player's hand with a guaranteed-winning instant-kaeng hand.
    const dealtState = aliceStates[aliceStates.length - 1];
    const activeUserId = dealtState.players[dealtState.turnIndex].userId;
    const activeClient = activeUserId === statsAliceId ? alice : bob;
    const room = server.roomStore.get(roomId);
    const activePlayer = room.players.find(p => p.userId === activeUserId);
    activePlayer.hand = [
      { rank: 'A', suit: 'spades' }, { rank: '2', suit: 'hearts' }, { rank: '3', suit: 'clubs' },
      { rank: 'A', suit: 'diamonds' }, { rank: '2', suit: 'clubs' },
    ];

    const resultPromise = waitForEvent(activeClient, 'game:result');
    activeClient.emit('game:kaeng');
    await resultPromise;

    // Persistence happens after the broadcast; poll briefly for the async write to land.
    await waitUntil(async () => {
      const rows = await server.pool.query('SELECT * FROM match_history WHERE player_id = $1', [activeUserId]);
      return rows.rows.length >= 1;
    }, { timeout: 3000 });

    const history = await server.pool.query(
      'SELECT result, win_type FROM match_history WHERE player_id = $1 ORDER BY created_at DESC LIMIT 1',
      [activeUserId]
    );
    expect(history.rows[0]).toMatchObject({ result: 'win', win_type: 'instant_kaeng' });

    if (!server.redisClient.isOpen) await server.redisClient.connect();
    const score = await server.redisClient.zScore('leaderboard:wins', activeUserId);
    expect(Number(score)).toBeGreaterThanOrEqual(1);
  });

  test('leaderboard:get returns the current standings', async () => {
    const alice = connectClient();
    await waitForEvent(alice, 'connect');

    if (!server.redisClient.isOpen) await server.redisClient.connect();
    await server.redisClient.zAdd('leaderboard:wins', [{ score: 5, value: 'leaderboard-test-player' }]);

    const resultPromise = waitForEvent(alice, 'leaderboard:result');
    alice.emit('leaderboard:get', { type: 'wins', limit: 10 });
    const payload = await resultPromise;

    expect(payload.type).toBe('wins');
    expect(payload.entries).toEqual(
      expect.arrayContaining([{ playerId: 'leaderboard-test-player', score: 5 }])
    );

    await server.redisClient.zRem('leaderboard:wins', 'leaderboard-test-player');
  });

  test('session:end settles the ledger built up across a round into a baht matrix, then clears it', async () => {
    const alice = connectClient();
    const bob = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);

    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');
    const aliceResults = collectEvents(alice, 'game:result');
    const bobResults = collectEvents(bob, 'game:result');

    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'session-room' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bob, 'auth:ok');
    bob.emit('room:join', { roomId: 'session-room' });
    await waitUntil(() => bobStates.length >= 1);

    alice.emit('player:ready', { ready: true });
    bob.emit('player:ready', { ready: true });
    await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'in_progress');

    const dealtState = aliceStates[aliceStates.length - 1];
    const activeUserId = dealtState.players[dealtState.turnIndex].userId;
    const activeClient = activeUserId === 'alice' ? alice : bob;

    const room = roomStore.get('session-room');
    const activePlayer = room.players.find(p => p.userId === activeUserId);
    activePlayer.hand = [card('A', 'spades'), card('2', 'hearts'), card('3', 'clubs'), card('A', 'diamonds'), card('2', 'clubs')];

    activeClient.emit('game:kaeng');
    await waitUntil(() => aliceResults.length >= 1 && bobResults.length >= 1);

    const aliceSettlement = waitForEvent(alice, 'session:settlement');
    const bobSettlement = waitForEvent(bob, 'session:settlement');
    activeClient.emit('session:end');
    const [alicePayload, bobPayload] = await Promise.all([aliceSettlement, bobSettlement]);

    const otherUserId = activeUserId === 'alice' ? 'bob' : 'alice';
    expect(alicePayload.settlements).toEqual([
      { from: otherUserId, to: activeUserId, points: 1, baht: 5, fromUsername: otherUserId, toUsername: activeUserId },
    ]);
    expect(bobPayload).toEqual(alicePayload);
    expect(room.ledger).toEqual({});
  });

  test('player:stand moves a seated player to the rail between rounds, and player:sit seats them back', async () => {
    const alice = connectClient();
    await waitForEvent(alice, 'connect');
    const aliceStates = collectEvents(alice, 'room:state');

    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'stand-room-1' });
    await waitUntil(() => aliceStates.length >= 1);

    alice.emit('player:stand');
    await waitUntil(() => aliceStates[aliceStates.length - 1].players.length === 0);
    expect(aliceStates[aliceStates.length - 1].spectators).toEqual([{ userId: 'alice', username: 'alice', pendingSit: false }]);

    alice.emit('player:sit');
    await waitUntil(() => aliceStates[aliceStates.length - 1].players.length === 1);
    expect(aliceStates[aliceStates.length - 1].players[0].userId).toBe('alice');
    expect(aliceStates[aliceStates.length - 1].spectators).toEqual([]);
  });

  test('player:stand is rejected while a round is in progress', async () => {
    const alice = connectClient();
    const bob = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);
    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');

    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'stand-room-2' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bob, 'auth:ok');
    bob.emit('room:join', { roomId: 'stand-room-2' });
    await waitUntil(() => bobStates.length >= 1);

    alice.emit('player:ready', { ready: true });
    bob.emit('player:ready', { ready: true });
    await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'in_progress');

    const errorPromise = waitForEvent(alice, 'room:error');
    alice.emit('player:stand');
    const error = await errorPromise;
    expect(error.message).toBe('Can only stand between rounds');
    expect(aliceStates[aliceStates.length - 1].players).toHaveLength(2);
  });

  test('player:sit mid-round queues the spectator, and they are seated once the round ends', async () => {
    const alice = connectClient();
    const bob = connectClient();
    const carol = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect'), waitForEvent(carol, 'connect')]);
    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');
    const carolStates = collectEvents(carol, 'room:state');

    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'sit-room-1' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bob, 'auth:ok');
    bob.emit('room:join', { roomId: 'sit-room-1' });
    await waitUntil(() => bobStates.length >= 1);
    carol.emit('auth', { token: signToken({ id: 'carol', username: 'carol' }, process.env.JWT_SECRET) });
    await waitForEvent(carol, 'auth:ok');
    carol.emit('room:join', { roomId: 'sit-room-1', asSpectator: true });
    await waitUntil(() => carolStates.length >= 1);

    alice.emit('player:ready', { ready: true });
    bob.emit('player:ready', { ready: true });
    await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'in_progress');

    carol.emit('player:sit');
    await waitUntil(() => carolStates[carolStates.length - 1].spectators.some(s => s.pendingSit));
    // Still a spectator, not yet dealt in, while the round is live.
    expect(carolStates[carolStates.length - 1].players.find(p => p.userId === 'carol')).toBeUndefined();

    const dealtState = aliceStates[aliceStates.length - 1];
    const activeUserId = dealtState.players[dealtState.turnIndex].userId;
    const activeClient = activeUserId === 'alice' ? alice : bob;
    const room = roomStore.get('sit-room-1');
    const activePlayer = room.players.find(p => p.userId === activeUserId);
    activePlayer.hand = [card('A', 'spades'), card('2', 'hearts'), card('3', 'clubs'), card('A', 'diamonds'), card('2', 'clubs')];
    activeClient.emit('game:kaeng');

    await waitUntil(() => carolStates[carolStates.length - 1].players.some(p => p.userId === 'carol'));
    expect(carolStates[carolStates.length - 1].spectators).toEqual([]);
  });

  test('player:quit removes a spectator immediately, and a player once the room is waiting; empties the room when last to leave', async () => {
    const alice = connectClient();
    await waitForEvent(alice, 'connect');
    const aliceStates = collectEvents(alice, 'room:state');

    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'quit-room-1' });
    await waitUntil(() => aliceStates.length >= 1);

    expect(roomStore.has('quit-room-1')).toBe(true);
    alice.emit('player:quit');
    await waitUntil(() => !roomStore.has('quit-room-1'));
    expect(roomStore.has('quit-room-1')).toBe(false);
  });

  test('player:quit is rejected for a seated player while a round is in progress', async () => {
    const alice = connectClient();
    const bob = connectClient();
    await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);
    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');

    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'quit-room-2' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('auth', { token: signToken({ id: 'bob', username: 'bob' }, process.env.JWT_SECRET) });
    await waitForEvent(bob, 'auth:ok');
    bob.emit('room:join', { roomId: 'quit-room-2' });
    await waitUntil(() => bobStates.length >= 1);

    alice.emit('player:ready', { ready: true });
    bob.emit('player:ready', { ready: true });
    await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'in_progress');

    const errorPromise = waitForEvent(alice, 'room:error');
    alice.emit('player:quit');
    const error = await errorPromise;
    expect(error.message).toBe('Can only quit between rounds');
    expect(roomStore.get('quit-room-2').players).toHaveLength(2);
  });
});
