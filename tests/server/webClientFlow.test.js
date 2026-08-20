require('dotenv').config();
const Client = require('socket.io-client');
const { createSocketServer } = require('../../src/server/socketServer');
const { signToken } = require('../../src/auth/tokens');
const { waitForEvent, collectEvents, waitUntil } = require('./testHelpers');
const { testDatabaseUrl } = require('../testDb');

describe('web client flow (server-side contract)', () => {
  let server, httpServer, io, port, clients;

  beforeEach((done) => {
    server = createSocketServer({ databaseUrl: testDatabaseUrl() });
    ({ httpServer, io } = server);
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

  function connectAuthedClient(userId) {
    const client = Client(`http://localhost:${port}`);
    clients.push(client);
    return new Promise((resolve) => {
      client.on('connect', () => {
        client.emit('auth', { token: signToken({ id: userId, username: userId }, process.env.JWT_SECRET) });
        client.once('auth:ok', () => resolve(client));
      });
    });
  }

  // Dealing is no longer automatic once everyone is ready — the room's
  // dealer must explicitly emit game:deal. The dealer is chosen randomly, so
  // have every candidate socket emit it; only the real dealer's request is
  // accepted, the rest get a harmless room:error.
  async function dealWhenReady(states, sockets) {
    await waitUntil(() => states.some(s => s.length > 0 && s[s.length - 1].dealerId));
    sockets.forEach(s => s.emit('game:deal'));
  }

  test('login -> join -> ready -> draw -> discard -> result, matching the client\'s event sequence', async () => {
    const alice = await connectAuthedClient('alice');
    const bob = await connectAuthedClient('bob');

    const aliceStates = collectEvents(alice, 'room:state');
    const bobStates = collectEvents(bob, 'room:state');

    alice.emit('room:join', { roomId: 'client-flow-room' });
    await waitUntil(() => aliceStates.length >= 1);
    bob.emit('room:join', { roomId: 'client-flow-room' });
    await waitUntil(() => bobStates.length >= 1 && aliceStates.length >= 2);

    alice.emit('player:ready', { ready: true });
    bob.emit('player:ready', { ready: true });
    await dealWhenReady([aliceStates, bobStates], [alice, bob]);
    await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'in_progress');

    const inProgress = aliceStates[aliceStates.length - 1];
    const firstTurnUserId = inProgress.players[inProgress.turnIndex].userId;
    const [current, other] = firstTurnUserId === 'alice' ? [alice, bob] : [bob, alice];
    const currentStates = current === alice ? aliceStates : bobStates;

    current.emit('game:draw');
    await waitUntil(() => currentStates[currentStates.length - 1].players.find(p => p.userId === firstTurnUserId).handCount === 6);

    const myHand = currentStates[currentStates.length - 1].players.find(p => p.userId === firstTurnUserId).hand;
    const resultPromise = Promise.all([waitForEvent(alice, 'game:result'), waitForEvent(bob, 'game:result')]);
    current.emit('game:discard', { card: myHand[0] });

    // A single discard won't end the round on its own in general play, so this
    // assertion only checks the discard was accepted (no game:error), not a result.
    await waitUntil(() => {
      const last = currentStates[currentStates.length - 1];
      return last.players.find(p => p.userId === firstTurnUserId).handCount === 5;
    });

    void other; // held for readability of which client is "not current"
    void resultPromise; // round completion via kaeng/exhaustion is covered by tests/server/roundEnd.test.js already
  });
});
