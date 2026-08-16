const Client = require('socket.io-client');
const { createSocketServer } = require('../../src/server/socketServer');
const { waitForEvent, collectEvents, waitUntil } = require('./testHelpers');

describe('socketServer', () => {
  let httpServer, io, port, clients;

  beforeEach((done) => {
    ({ httpServer, io } = createSocketServer());
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
});
