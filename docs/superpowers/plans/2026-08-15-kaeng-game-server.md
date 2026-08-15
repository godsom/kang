# Kaeng Game Server (Milestone 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Socket.io game server's room management, state synchronization, and reconnect handling — per spec §7's Milestone 2 scope exactly ("Game server + Socket.io — room management, state sync, reconnect handling"). Players can join a room, ready up, have a round dealt automatically via the Milestone 1 engine, and reconnect after a dropped connection without losing their hand.

**Architecture:** Small pure functions operating on a plain `Room` object (mirrors the Milestone 1 style: mutate-and-return, no classes), composed by a thin Socket.io wiring layer. Room state lives in an in-memory `Map` behind a `roomStore` interface — no Redis in this milestone (see Global Constraints). The pure room-logic modules are unit-tested directly; the Socket.io wiring is integration-tested with a real `http` server and `socket.io-client`.

**Tech Stack:** Node.js (CommonJS), `socket.io` (server), `socket.io-client` (dev dependency, tests only), Jest.

## Global Constraints

- **In-memory room state, no Redis.** This is a deliberate scope decision for this milestone (confirmed with the project owner) — the spec's architecture diagram backs room state with Redis for multi-instance scaling, but that's not needed for a single-instance dev server. Room state lives behind `src/server/roomStore.js`'s `createRoomStore()` interface so swapping in Redis later is a contained change.
- **Gameplay actions (`game:draw`, `game:discard`, `game:eat`, `game:kaeng`) are OUT OF SCOPE for this milestone.** Spec §7 explicitly scopes Milestone 2 to "room management, state sync, reconnect handling" — not gameplay mechanics. Those events, and the resulting dealer-rotation rule ("ผู้ชนะเกมก่อนหน้าเป็นผู้เริ่ม", spec §2.4), depend on knowing a round's outcome, which requires the gameplay-action handlers. They are a separate follow-up plan.
- **Round-start trigger is an explicit ready-up flow (confirmed with the project owner), not spec's socket table.** A new client→server event `player:ready` (payload `{ ready: boolean }`) — not present in spec §6's table, a deliberate documented addition — toggles a player's ready flag. A round starts automatically once `room.players.length >= GAME_CONFIG.MIN_PLAYERS && room.players.every(p => p.ready)`.
- **Room creation defaults.** Spec doesn't define how a room's `direction`/`eatMode` get chosen. This milestone defaults every newly-created room to `direction: GAME_CONFIG.DIRECTION.ONE_WAY`, `eatMode: GAME_CONFIG.EAT_MODE.CHAIN`. A room-configuration UI/event is future scope.
- **First-round dealer only.** `startRound` determines the dealer via spec §2.4's one-card draw (`determineFirstDealer` from Milestone 1) only for a room's first-ever round (`room.dealerId` is falsy). "Previous round's winner becomes dealer" (spec §2.4, subsequent rounds) is out of scope per the gameplay-actions exclusion above.
- **State filtering is non-negotiable (spec §8).** `getPlayerView(room, userId)` must expose a player's own `hand` in full, but only `handCount` (not `hand`) for every other player, and only `deckCount` (not deck contents) for the draw pile. No code path may leak another player's cards or the deck's contents to a client.
- **Disconnect handling has no timers.** While `room.status === 'waiting'`, a disconnecting player is removed from the room outright (freeing their seat; the room is deleted from the store if it becomes empty). While `room.status === 'in_progress'`, a disconnecting player is marked `connected: false` and keeps their hand; reconnecting via `room:join` with the same `userId` rebinds their socket. No auto-kick/timeout logic in this milestone.
- Reuses Milestone 1's `GAME_CONFIG`, `buildDeck`/`shuffle`/`drawCard`, `dealCards`/`determineFirstDealer` exactly as those modules already export them — no changes to `src/config.js`, `src/deck.js`, or `src/dealing.js` in this plan.

---

## File Structure

- `src/server/room.js` — `ROOM_STATUS`, `createRoom`, `findPlayer`, `addPlayer`, `removePlayer`.
- `src/server/roomStore.js` — `createRoomStore()`, an in-memory `Map`-backed room store.
- `src/server/roomLifecycle.js` — `setPlayerReady`, `canStart`, `startRound` (uses Milestone 1's deck/dealing functions).
- `src/server/playerView.js` — `getPlayerView` (state filtering).
- `src/server/roomConnection.js` — `disconnectPlayer`.
- `src/server/socketServer.js` — `createSocketServer()`: wires Socket.io events (`room:join`, `player:ready`, `disconnect`) to the modules above and broadcasts filtered `room:state`.
- `src/server/index.js` — thin process entrypoint that starts `createSocketServer()` on `process.env.PORT || 3001`. Not unit-tested directly (4-line bootstrap over an already-tested function).

Each module (except `index.js`) has a matching test file under `tests/server/`.

---

### Task 1: Room model + in-memory store

**Files:**
- Create: `src/server/room.js`
- Create: `src/server/roomStore.js`
- Test: `tests/server/room.test.js`
- Test: `tests/server/roomStore.test.js`

**Interfaces:**
- Consumes: `GAME_CONFIG` from `src/config.js` (Milestone 1) for `MAX_PLAYERS`.
- Produces: `ROOM_STATUS` (`{WAITING:'waiting', IN_PROGRESS:'in_progress', FINISHED:'finished'}`), `createRoom(id, direction?, eatMode?)` → `Room` object (`{id, players:[], direction, eatMode, deck:[], discardPile:[], turnIndex:0, directionSign:1, dealerId:null, pot:0, status:'waiting', isFirstTurn:true}`), `findPlayer(room, userId)` → `Player | null`, `addPlayer(room, userId, socketId)` → `{room, player, reconnected}` (mutates `room.players` in place; if `userId` already present, rebinds `socketId`/`connected` and returns `reconnected:true` without checking capacity/status; otherwise throws `'Room is full'` if at `MAX_PLAYERS`, throws `'Room is not accepting new players'` if `room.status !== ROOM_STATUS.WAITING`, else pushes a new `Player {userId, socketId, hand:[], ready:false, connected:true, handScore:0, declaredKaeng:false}`), `removePlayer(room, userId)` → `room` (filters out the player). `createRoomStore()` → `{get(id), set(id, room), delete(id), has(id)}` backed by a private `Map`. Consumed by every later task in this plan.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/server/room.test.js
const { ROOM_STATUS, createRoom, findPlayer, addPlayer, removePlayer } = require('../../src/server/room');

describe('createRoom', () => {
  test('creates a room with sensible defaults', () => {
    const room = createRoom('room1');
    expect(room).toMatchObject({
      id: 'room1',
      players: [],
      direction: 'one_way',
      eatMode: 'chain_eat',
      deck: [],
      discardPile: [],
      turnIndex: 0,
      directionSign: 1,
      dealerId: null,
      pot: 0,
      status: ROOM_STATUS.WAITING,
      isFirstTurn: true,
    });
  });

  test('accepts explicit direction and eatMode', () => {
    const room = createRoom('room1', 'alternating', 'sequential_beat');
    expect(room.direction).toBe('alternating');
    expect(room.eatMode).toBe('sequential_beat');
  });
});

describe('addPlayer', () => {
  test('adds a new player to a waiting room', () => {
    const room = createRoom('room1');
    const { player, reconnected } = addPlayer(room, 'alice', 'socket-1');
    expect(reconnected).toBe(false);
    expect(player).toMatchObject({ userId: 'alice', socketId: 'socket-1', hand: [], ready: false, connected: true });
    expect(room.players).toHaveLength(1);
    expect(findPlayer(room, 'alice')).toBe(player);
  });

  test('rejoining with the same userId rebinds the socket instead of duplicating', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 'socket-1');
    const { player, reconnected } = addPlayer(room, 'alice', 'socket-2');
    expect(reconnected).toBe(true);
    expect(player.socketId).toBe('socket-2');
    expect(player.connected).toBe(true);
    expect(room.players).toHaveLength(1);
  });

  test('rejects a new player once the room is full', () => {
    const room = createRoom('room1');
    for (let i = 0; i < 5; i++) addPlayer(room, `p${i}`, `s${i}`);
    expect(() => addPlayer(room, 'newcomer', 'socket-x')).toThrow('Room is full');
  });

  test('rejects a new player once the room is no longer waiting', () => {
    const room = createRoom('room1');
    room.status = ROOM_STATUS.IN_PROGRESS;
    expect(() => addPlayer(room, 'alice', 'socket-1')).toThrow('Room is not accepting new players');
  });

  test('a reconnect is allowed even when the room is in progress or full', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 'socket-1');
    room.status = ROOM_STATUS.IN_PROGRESS;
    const { reconnected } = addPlayer(room, 'alice', 'socket-2');
    expect(reconnected).toBe(true);
  });
});

describe('removePlayer', () => {
  test('removes a player from the room', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 'socket-1');
    addPlayer(room, 'bob', 'socket-2');
    removePlayer(room, 'alice');
    expect(room.players).toHaveLength(1);
    expect(findPlayer(room, 'alice')).toBeNull();
    expect(findPlayer(room, 'bob')).not.toBeNull();
  });
});
```

```javascript
// tests/server/roomStore.test.js
const { createRoomStore } = require('../../src/server/roomStore');

describe('createRoomStore', () => {
  test('stores and retrieves a room by id', () => {
    const store = createRoomStore();
    const room = { id: 'room1' };
    store.set('room1', room);
    expect(store.get('room1')).toBe(room);
  });

  test('get returns null for an unknown room', () => {
    const store = createRoomStore();
    expect(store.get('missing')).toBeNull();
  });

  test('has reflects presence, delete removes the room', () => {
    const store = createRoomStore();
    store.set('room1', { id: 'room1' });
    expect(store.has('room1')).toBe(true);
    store.delete('room1');
    expect(store.has('room1')).toBe(false);
    expect(store.get('room1')).toBeNull();
  });

  test('two stores are independent', () => {
    const storeA = createRoomStore();
    const storeB = createRoomStore();
    storeA.set('room1', { id: 'room1' });
    expect(storeB.has('room1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/server/room.test.js tests/server/roomStore.test.js`
Expected: FAIL with "Cannot find module '../../src/server/room'" and "Cannot find module '../../src/server/roomStore'"

- [ ] **Step 3: Write the implementation**

```javascript
// src/server/room.js
const { GAME_CONFIG } = require('../config');

const ROOM_STATUS = { WAITING: 'waiting', IN_PROGRESS: 'in_progress', FINISHED: 'finished' };

function createRoom(id, direction = GAME_CONFIG.DIRECTION.ONE_WAY, eatMode = GAME_CONFIG.EAT_MODE.CHAIN) {
  return {
    id,
    players: [],
    direction,
    eatMode,
    deck: [],
    discardPile: [],
    turnIndex: 0,
    directionSign: 1,
    dealerId: null,
    pot: 0,
    status: ROOM_STATUS.WAITING,
    isFirstTurn: true,
  };
}

function findPlayer(room, userId) {
  return room.players.find(p => p.userId === userId) || null;
}

function addPlayer(room, userId, socketId) {
  const existing = findPlayer(room, userId);
  if (existing) {
    existing.socketId = socketId;
    existing.connected = true;
    return { room, player: existing, reconnected: true };
  }
  if (room.status !== ROOM_STATUS.WAITING) {
    throw new Error('Room is not accepting new players');
  }
  if (room.players.length >= GAME_CONFIG.MAX_PLAYERS) {
    throw new Error('Room is full');
  }
  const player = {
    userId,
    socketId,
    hand: [],
    ready: false,
    connected: true,
    handScore: 0,
    declaredKaeng: false,
  };
  room.players.push(player);
  return { room, player, reconnected: false };
}

function removePlayer(room, userId) {
  room.players = room.players.filter(p => p.userId !== userId);
  return room;
}

module.exports = { ROOM_STATUS, createRoom, findPlayer, addPlayer, removePlayer };
```

```javascript
// src/server/roomStore.js
function createRoomStore() {
  const rooms = new Map();
  return {
    get(roomId) {
      return rooms.get(roomId) || null;
    },
    set(roomId, room) {
      rooms.set(roomId, room);
      return room;
    },
    delete(roomId) {
      rooms.delete(roomId);
    },
    has(roomId) {
      return rooms.has(roomId);
    },
  };
}

module.exports = { createRoomStore };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/server/room.test.js tests/server/roomStore.test.js`
Expected: PASS (8 + 4 = 12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/room.js src/server/roomStore.js tests/server/room.test.js tests/server/roomStore.test.js
git commit -m "feat: add room model and in-memory room store"
```

---

### Task 2: Ready-up and round start

**Files:**
- Create: `src/server/roomLifecycle.js`
- Test: `tests/server/roomLifecycle.test.js`

**Interfaces:**
- Consumes: `GAME_CONFIG` from `src/config.js`, `findPlayer` from `src/server/room.js` (Task 1), `buildDeck`/`shuffle` from `src/deck.js`, `dealCards`/`determineFirstDealer` from `src/dealing.js` (all Milestone 1).
- Produces: `setPlayerReady(room, userId, ready)` → `room` (throws `'Player not in room'` if `userId` isn't a room member), `canStart(room)` → `boolean` (`room.status === 'waiting' && room.players.length >= GAME_CONFIG.MIN_PLAYERS && room.players.every(p => p.ready)`), `startRound(room)` → `room` (mutates: if `!room.dealerId`, draws one card per player from a throwaway shuffled deck via `determineFirstDealer` to set `room.dealerId`; deals a fresh shuffled deck to all players via `dealCards`; sets `room.deck`, resets `room.discardPile = []`, sets `room.turnIndex` to the dealer's index in `room.players`, resets `room.directionSign = 1`, `room.isFirstTurn = true`, `room.status = ROOM_STATUS.IN_PROGRESS`). Consumed by `src/server/socketServer.js` (Task 5).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/server/roomLifecycle.test.js
const { createRoom, addPlayer } = require('../../src/server/room');
const { setPlayerReady, canStart, startRound } = require('../../src/server/roomLifecycle');

describe('setPlayerReady', () => {
  test('toggles a player\'s ready flag', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    setPlayerReady(room, 'alice', true);
    expect(room.players[0].ready).toBe(true);
    setPlayerReady(room, 'alice', false);
    expect(room.players[0].ready).toBe(false);
  });

  test('throws for an unknown player', () => {
    const room = createRoom('room1');
    expect(() => setPlayerReady(room, 'ghost', true)).toThrow('Player not in room');
  });
});

describe('canStart', () => {
  test('false below MIN_PLAYERS even if the lone player is ready', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    setPlayerReady(room, 'alice', true);
    expect(canStart(room)).toBe(false);
  });

  test('false if any player is not ready', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    addPlayer(room, 'bob', 's2');
    setPlayerReady(room, 'alice', true);
    expect(canStart(room)).toBe(false);
  });

  test('true once player count >= MIN_PLAYERS and everyone is ready', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    addPlayer(room, 'bob', 's2');
    setPlayerReady(room, 'alice', true);
    setPlayerReady(room, 'bob', true);
    expect(canStart(room)).toBe(true);
  });

  test('false once the room is already in progress', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    addPlayer(room, 'bob', 's2');
    setPlayerReady(room, 'alice', true);
    setPlayerReady(room, 'bob', true);
    startRound(room);
    expect(canStart(room)).toBe(false);
  });
});

describe('startRound', () => {
  test('deals HAND_SIZE cards to every player and marks the room in progress', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    addPlayer(room, 'bob', 's2');
    startRound(room);
    expect(room.status).toBe('in_progress');
    room.players.forEach(p => expect(p.hand).toHaveLength(5));
    expect(room.discardPile).toEqual([]);
    expect(room.isFirstTurn).toBe(true);
  });

  test('sets a dealer and turnIndex pointing at the dealer', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    addPlayer(room, 'bob', 's2');
    startRound(room);
    expect(room.dealerId).not.toBeNull();
    expect(room.players[room.turnIndex].userId).toBe(room.dealerId);
  });

  test('does not re-determine the dealer on a room that already has one', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    addPlayer(room, 'bob', 's2');
    room.dealerId = 'alice';
    startRound(room);
    expect(room.dealerId).toBe('alice');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/server/roomLifecycle.test.js`
Expected: FAIL with "Cannot find module '../../src/server/roomLifecycle'"

- [ ] **Step 3: Write the implementation**

```javascript
// src/server/roomLifecycle.js
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

function startRound(room) {
  if (!room.dealerId) {
    const drawDeck = shuffle(buildDeck());
    room.dealerId = determineFirstDealer(room.players, drawDeck);
  }
  const deck = shuffle(buildDeck());
  dealCards(room.players, deck, GAME_CONFIG.HAND_SIZE);
  room.deck = deck;
  room.discardPile = [];
  room.turnIndex = room.players.findIndex(p => p.userId === room.dealerId);
  room.directionSign = 1;
  room.isFirstTurn = true;
  room.status = ROOM_STATUS.IN_PROGRESS;
  return room;
}

module.exports = { setPlayerReady, canStart, startRound };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/server/roomLifecycle.test.js`
Expected: PASS (2 + 4 + 3 = 9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/roomLifecycle.js tests/server/roomLifecycle.test.js
git commit -m "feat: add ready-up and round-start lifecycle"
```

---

### Task 3: Player view filtering

**Files:**
- Create: `src/server/playerView.js`
- Test: `tests/server/playerView.test.js`

**Interfaces:**
- Consumes: nothing beyond the `Room`/`Player` shapes already established by Tasks 1-2.
- Produces: `getPlayerView(room, userId)` → a plain object: `{roomId, status, direction, eatMode, dealerId, turnIndex, pot, deckCount, discardTop, players}`, where `discardTop` is the last card of `room.discardPile` or `null` if empty, and `players` is `room.players.map(...)` with each entry `{userId, ready, connected, isDealer, handCount}` plus a `hand` field (the player's real, unfiltered hand array) **only** when that entry's `userId === userId` (the viewer). No other player's `hand` key is present at all (not even redacted) in the output. Consumed by `src/server/socketServer.js` (Task 5).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/server/playerView.test.js
const { createRoom, addPlayer } = require('../../src/server/room');
const { getPlayerView } = require('../../src/server/playerView');

function setup() {
  const room = createRoom('room1');
  addPlayer(room, 'alice', 's1');
  addPlayer(room, 'bob', 's2');
  room.players[0].hand = [{ suit: 'spades', rank: 'A' }, { suit: 'hearts', rank: 'K' }];
  room.players[1].hand = [{ suit: 'clubs', rank: '2' }];
  room.deck = [{ suit: 'diamonds', rank: '5' }, { suit: 'diamonds', rank: '6' }];
  room.discardPile = [{ suit: 'spades', rank: '9' }];
  room.dealerId = 'alice';
  room.turnIndex = 0;
  return room;
}

describe('getPlayerView', () => {
  test('exposes the viewer\'s own hand in full', () => {
    const room = setup();
    const view = getPlayerView(room, 'alice');
    const aliceEntry = view.players.find(p => p.userId === 'alice');
    expect(aliceEntry.hand).toEqual(room.players[0].hand);
    expect(aliceEntry.handCount).toBe(2);
  });

  test('never exposes another player\'s hand, only their count', () => {
    const room = setup();
    const view = getPlayerView(room, 'alice');
    const bobEntry = view.players.find(p => p.userId === 'bob');
    expect(bobEntry.hand).toBeUndefined();
    expect(bobEntry.handCount).toBe(1);
    expect('hand' in bobEntry).toBe(false);
  });

  test('never exposes deck contents, only deckCount', () => {
    const room = setup();
    const view = getPlayerView(room, 'alice');
    expect(view.deckCount).toBe(2);
    expect(view.deck).toBeUndefined();
  });

  test('exposes only the top discard card, not the whole pile', () => {
    const room = setup();
    const view = getPlayerView(room, 'alice');
    expect(view.discardTop).toEqual({ suit: 'spades', rank: '9' });
  });

  test('discardTop is null for an empty discard pile', () => {
    const room = setup();
    room.discardPile = [];
    const view = getPlayerView(room, 'alice');
    expect(view.discardTop).toBeNull();
  });

  test('marks isDealer correctly per player', () => {
    const room = setup();
    const view = getPlayerView(room, 'alice');
    expect(view.players.find(p => p.userId === 'alice').isDealer).toBe(true);
    expect(view.players.find(p => p.userId === 'bob').isDealer).toBe(false);
  });

  test('includes room-level fields', () => {
    const room = setup();
    const view = getPlayerView(room, 'bob');
    expect(view).toMatchObject({
      roomId: 'room1',
      status: 'waiting',
      direction: 'one_way',
      eatMode: 'chain_eat',
      dealerId: 'alice',
      turnIndex: 0,
      pot: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/server/playerView.test.js`
Expected: FAIL with "Cannot find module '../../src/server/playerView'"

- [ ] **Step 3: Write the implementation**

```javascript
// src/server/playerView.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/server/playerView.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/playerView.js tests/server/playerView.test.js
git commit -m "feat: add filtered player view (hides other hands and deck contents)"
```

---

### Task 4: Disconnect handling

**Files:**
- Create: `src/server/roomConnection.js`
- Test: `tests/server/roomConnection.test.js`

**Interfaces:**
- Consumes: `ROOM_STATUS`, `findPlayer`, `removePlayer` from `src/server/room.js` (Task 1).
- Produces: `disconnectPlayer(room, userId)` → `{room, removed: boolean}`. If `room.status === ROOM_STATUS.WAITING`, removes the player via `removePlayer` and returns `removed: true`. Otherwise, finds the player and sets `connected = false` (leaving their hand and all other fields intact) and returns `removed: false`. A no-op (returns `{room, removed: false}`) if `userId` isn't found. Consumed by `src/server/socketServer.js` (Task 5), which also handles deleting an emptied room from the store — that store-deletion behavior belongs to Task 5, not this module, since `roomConnection.js` has no dependency on `roomStore.js`.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/server/roomConnection.test.js
const { createRoom, addPlayer, ROOM_STATUS } = require('../../src/server/room');
const { disconnectPlayer } = require('../../src/server/roomConnection');

describe('disconnectPlayer', () => {
  test('removes the player outright while the room is waiting', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    addPlayer(room, 'bob', 's2');
    const { removed } = disconnectPlayer(room, 'alice');
    expect(removed).toBe(true);
    expect(room.players).toHaveLength(1);
    expect(room.players[0].userId).toBe('bob');
  });

  test('marks the player disconnected but keeps their hand while in progress', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    room.status = ROOM_STATUS.IN_PROGRESS;
    room.players[0].hand = [{ suit: 'spades', rank: 'A' }];
    const { removed } = disconnectPlayer(room, 'alice');
    expect(removed).toBe(false);
    expect(room.players).toHaveLength(1);
    expect(room.players[0].connected).toBe(false);
    expect(room.players[0].hand).toEqual([{ suit: 'spades', rank: 'A' }]);
  });

  test('is a no-op for an unknown userId', () => {
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    const { removed } = disconnectPlayer(room, 'ghost');
    expect(removed).toBe(false);
    expect(room.players).toHaveLength(1);
  });

  test('reconnecting after an in-progress disconnect restores connected status', () => {
    const { addPlayer: reAddPlayer } = require('../../src/server/room');
    const room = createRoom('room1');
    addPlayer(room, 'alice', 's1');
    room.status = ROOM_STATUS.IN_PROGRESS;
    disconnectPlayer(room, 'alice');
    expect(room.players[0].connected).toBe(false);
    const { reconnected } = reAddPlayer(room, 'alice', 's2');
    expect(reconnected).toBe(true);
    expect(room.players[0].connected).toBe(true);
    expect(room.players[0].socketId).toBe('s2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/server/roomConnection.test.js`
Expected: FAIL with "Cannot find module '../../src/server/roomConnection'"

- [ ] **Step 3: Write the implementation**

```javascript
// src/server/roomConnection.js
const { ROOM_STATUS, findPlayer, removePlayer } = require('./room');

function disconnectPlayer(room, userId) {
  if (room.status === ROOM_STATUS.WAITING) {
    return { room: removePlayer(room, userId), removed: true };
  }
  const player = findPlayer(room, userId);
  if (player) {
    player.connected = false;
  }
  return { room, removed: false };
}

module.exports = { disconnectPlayer };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/server/roomConnection.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/roomConnection.js tests/server/roomConnection.test.js
git commit -m "feat: add disconnect handling (remove while waiting, mark disconnected in progress)"
```

---

### Task 5: Socket.io server wiring

**Files:**
- Modify: `package.json` (add `socket.io` dependency, `socket.io-client` dev dependency, `"start"` script)
- Create: `src/server/socketServer.js`
- Create: `src/server/index.js`
- Create: `tests/server/testHelpers.js`
- Test: `tests/server/socketServer.test.js`

**Interfaces:**
- Consumes: `createRoomStore` (Task 1), `createRoom`, `addPlayer` (Task 1), `setPlayerReady`, `canStart`, `startRound` (Task 2), `getPlayerView` (Task 3), `disconnectPlayer` (Task 4).
- Produces: `createSocketServer()` → `{httpServer, io, roomStore}` (an unstarted `http.Server` with Socket.io attached; call `httpServer.listen(...)` to start it). Wires:
  - `room:join` (client→server, `{roomId, userId}`): creates the room if it doesn't exist (via `createRoom`, defaults per Global Constraints), calls `addPlayer`; on error emits `room:error` (`{message}`) to the joining socket only and does nothing else; on success records a `socket.id → {roomId, userId}` mapping, joins the Socket.io room, and broadcasts `room:state` (the per-player filtered view from `getPlayerView`) to every connected player in the room.
  - `player:ready` (client→server, `{ready}`): looks up the caller's room via the socket mapping, calls `setPlayerReady`, then `canStart`/`startRound` if eligible, then broadcasts `room:state` to everyone in the room.
  - `disconnect` (built-in Socket.io event): looks up the caller's room via the socket mapping, removes the mapping, calls `disconnectPlayer`; if the room is now empty, deletes it from the store; otherwise broadcasts `room:state` to the remaining players.
  - `room:state` (server→client): the payload is exactly `getPlayerView(room, <that recipient's userId>)` — each connected player gets their own filtered view, sent individually (not a single shared broadcast payload).

- [ ] **Step 1: Add dependencies**

```bash
npm install socket.io
npm install --save-dev socket.io-client
```

Then add to `package.json`'s `"scripts"`: `"start": "node src/server/index.js"`.

- [ ] **Step 2: Write the shared test helpers (not itself under TDD — plain test-support utilities)**

```javascript
// tests/server/testHelpers.js
function waitForEvent(socket, event) {
  return new Promise(resolve => socket.once(event, resolve));
}

function collectEvents(socket, event) {
  const events = [];
  socket.on(event, payload => events.push(payload));
  return events;
}

function waitUntil(conditionFn, { timeout = 2000, interval = 20 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (conditionFn()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('waitUntil timed out'));
      setTimeout(check, interval);
    };
    check();
  });
}

module.exports = { waitForEvent, collectEvents, waitUntil };
```

- [ ] **Step 3: Write the failing integration tests**

```javascript
// tests/server/socketServer.test.js
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
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx jest tests/server/socketServer.test.js`
Expected: FAIL with "Cannot find module '../../src/server/socketServer'"

- [ ] **Step 5: Write the implementation**

```javascript
// src/server/socketServer.js
const { createServer } = require('http');
const { Server } = require('socket.io');
const { createRoomStore } = require('./roomStore');
const { createRoom, addPlayer } = require('./room');
const { setPlayerReady, canStart, startRound } = require('./roomLifecycle');
const { getPlayerView } = require('./playerView');
const { disconnectPlayer } = require('./roomConnection');

function createSocketServer() {
  const httpServer = createServer();
  const io = new Server(httpServer, { cors: { origin: '*' } });
  const roomStore = createRoomStore();
  const socketIndex = new Map(); // socket.id -> { roomId, userId }

  function broadcastRoomState(room) {
    room.players.forEach(player => {
      const socket = io.sockets.sockets.get(player.socketId);
      if (socket) {
        socket.emit('room:state', getPlayerView(room, player.userId));
      }
    });
  }

  io.on('connection', (socket) => {
    socket.on('room:join', ({ roomId, userId }) => {
      let room = roomStore.get(roomId);
      if (!room) {
        room = createRoom(roomId);
        roomStore.set(roomId, room);
      }
      try {
        addPlayer(room, userId, socket.id);
      } catch (err) {
        socket.emit('room:error', { message: err.message });
        return;
      }
      socketIndex.set(socket.id, { roomId, userId });
      socket.join(roomId);
      broadcastRoomState(room);
    });

    socket.on('player:ready', ({ ready }) => {
      const entry = socketIndex.get(socket.id);
      if (!entry) return;
      const room = roomStore.get(entry.roomId);
      if (!room) return;
      setPlayerReady(room, entry.userId, ready);
      if (canStart(room)) {
        startRound(room);
      }
      broadcastRoomState(room);
    });

    socket.on('disconnect', () => {
      const entry = socketIndex.get(socket.id);
      if (!entry) return;
      socketIndex.delete(socket.id);
      const room = roomStore.get(entry.roomId);
      if (!room) return;
      const { room: updatedRoom } = disconnectPlayer(room, entry.userId);
      if (updatedRoom.players.length === 0) {
        roomStore.delete(entry.roomId);
        return;
      }
      broadcastRoomState(updatedRoom);
    });
  });

  return { httpServer, io, roomStore };
}

module.exports = { createSocketServer };
```

```javascript
// src/server/index.js
const { createSocketServer } = require('./socketServer');

const PORT = process.env.PORT || 3001;
const { httpServer } = createSocketServer();
httpServer.listen(PORT, () => {
  console.log(`Kaeng game server listening on port ${PORT}`);
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest tests/server/socketServer.test.js`
Expected: PASS (5 tests)

- [ ] **Step 7: Run the full suite**

Run: `npx jest`
Expected: PASS, all 12 test files (7 from Milestone 1 + 5 new), 55 + 12 + 9 + 7 + 4 + 5 = 92 tests total.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/server/socketServer.js src/server/index.js tests/server/testHelpers.js tests/server/socketServer.test.js
git commit -m "feat: wire Socket.io server (room:join, player:ready, disconnect)"
```

---

## Self-Review Notes

- **Spec coverage:** Spec §7 Milestone 2 ("room management, state sync, reconnect handling") → all 5 tasks. §6 socket event table: `room:join` and `room:state` implemented per the table's payload shapes (Task 5); `player:ready` is a documented deliberate addition (not in the table) per the confirmed ready-up design; `game:draw`/`game:discard`/`game:eat`/`game:kaeng`/`game:result`/`voice:join`/`chat:message`/`leaderboard:get` are explicitly out of scope (documented in Global Constraints, follow-up plan). §4.1 Room/Player shapes → `src/server/room.js` (Task 1), with `spectators` intentionally omitted (Milestone 6 concern). §2.4 first-round dealer → `startRound` (Task 2) via Milestone 1's `determineFirstDealer`; subsequent-round dealer rotation explicitly deferred (documented). §8 (server-side-only validation, hidden hands/deck) → `getPlayerView` (Task 3), enforced via `'hand' in bobEntry === false` test, not just `toBeUndefined()`.
- **Placeholder scan:** No TBD/TODO markers; every step has runnable code. `src/server/index.js` is intentionally untested (4-line bootstrap over `createSocketServer`, which is fully tested) — noted explicitly rather than silently skipped.
- **Type consistency:** `Room`/`Player` shapes from Task 1 (`createRoom`, `addPlayer`) are the same shapes read and mutated by Tasks 2-5 (`roomLifecycle.js`, `playerView.js`, `roomConnection.js`, `socketServer.js`) — no divergent field names. `ROOM_STATUS` is defined once (Task 1) and imported everywhere else that needs it (Tasks 2 and 4), never redefined.
