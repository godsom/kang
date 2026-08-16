# Kaeng Spectator System (Milestone 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people watch a room without playing in it — join as a spectator (regardless of player count or round status), receive a filtered `room:state` that never contains any player's hand, and (closing a piece deliberately deferred in Milestone 5) get a subscribe-only voice token.

**Architecture:** A new `Room.spectators` array (finally landing the field Milestone 2 explicitly deferred), a small `src/server/spectator.js` module mirroring `room.js`'s player functions, a `getSpectatorView` alongside the existing `getPlayerView`, and socket wiring extended to branch on membership type.

**Tech Stack:** Node.js (CommonJS), Jest, `socket.io-client` for integration tests.

## Global Constraints

- **`room:join` gains an optional `asSpectator: boolean` payload field** (default `false`, all existing behavior unchanged when omitted) — a deliberate, documented addition (spec §6's table doesn't disambiguate player vs. spectator joins; this project has added such fields before — Milestone 2's `player:ready`, Milestone 5's `voice:join` `role`). When `true`, the caller is never routed through `addPlayer`; they join `room.spectators` instead, capped at `SPECTATOR_CONFIG.maxPerRoom` (50), regardless of `room.status` or player count — a spectator can watch a room that's `waiting`, full, or already `in_progress`.
- **Spectators can never receive any player's hand — structurally, not by convention.** `getSpectatorView(room)` never includes a `hand` key on any player entry, for anyone, including the caller — there is no "self" for a spectator the way there is for `getPlayerView`. This is spec §8's non-negotiable rule ("ผู้ชมห้ามเห็นไพ่ในมือผู้เล่นเด็ดขาด" — spectators must never see any player's hand under any circumstance).
- **Gameplay handlers need no new guards — verified, not assumed.** `game:draw`/`game:discard`/`game:eat`/`game:kaeng`/`player:ready` already resolve the caller's identity via `findPlayer(room, userId)` or `isPlayersTurn`, both of which only match `room.players` — a spectator's `userId` was never added there, so these handlers already reject a spectator's attempt with their existing "not your turn"/"player not in room" errors. No changes needed to `turnActions.js`/`roundEnd.js`/`roomLifecycle.js` for this milestone.
- **Empty-room deletion must account for spectators too.** Milestone 2's `disconnect` handler currently deletes a room from the store when `room.players.length === 0`; that's now wrong — a room with 0 players but spectators still watching must NOT be deleted. This is a real correctness fix this milestone must make, not new functionality.
- **Closing Milestone 5's deferred spectator-voice piece.** Milestone 5's `voice:join` handler currently rejects `role: 'spectator'` unconditionally with a fixed message, since spectators didn't exist yet. This milestone makes that check real: the caller's actual membership type (player vs. spectator, resolved server-side, never client-declared) must match the requested `role`, and a verified spectator gets `canPublish: false, canSubscribe: true` (matching `VOICE_CONFIG.spectatorMode: 'subscribe_only'`) — never `canPublish: true`. This means updating one existing Milestone 5 test's expected error message (the underlying behavior is intentionally evolving, documented here, not an arbitrary test change).
- Reuses Milestone 2's `ROOM_STATUS`, `createRoom`'s existing fields, and the established `getRoomForSocket`/`socketIndex` pattern from Milestones 2-3-5 exactly — `socketIndex` entries gain one new field (`isSpectator: boolean`), additive only.

---

## File Structure

- `src/server/room.js` (**modify**) — `createRoom` gains a `spectators: []` field.
- `src/server/spectator.js` (**new**) — `findSpectator`, `addSpectator`, `removeSpectator`.
- `src/server/playerView.js` (**modify**) — add `getSpectatorView(room)`.
- `src/server/socketServer.js` (**modify**) — `room:join` branches on `asSpectator`; `disconnect` branches on spectator vs. player and fixes the empty-room check; `broadcastRoomState`/`broadcastGameResult` also reach spectators; `voice:join` resolves the real membership type instead of a fixed rejection.

---

### Task 1: Spectator room membership

**Files:**
- Modify: `src/server/room.js`
- Modify: `tests/server/room.test.js`
- Create: `src/server/spectator.js`
- Test: `tests/server/spectator.test.js`

**Interfaces:**
- Consumes: `SPECTATOR_CONFIG` from `src/config.js` (Milestone 1).
- Produces: `createRoom` now returns `{..., spectators: []}` (in addition to its existing fields). `findSpectator(room, userId)` → `Spectator | null`. `addSpectator(room, userId, socketId)` → `{room, spectator, reconnected}` — if `userId` already present, rebinds `socketId` and returns `reconnected: true` (no capacity check on reconnect, same pattern as `addPlayer`); otherwise throws `'Room is full of spectators'` at `SPECTATOR_CONFIG.maxPerRoom`, else pushes `{userId, socketId}`. No `room.status` check anywhere — spectators can join regardless of round state. `removeSpectator(room, userId)` → `room` (filters out the spectator). Consumed by `src/server/socketServer.js` (Task 3).

- [ ] **Step 1: Write the failing tests**

Add this test to the existing `describe('createRoom', ...)` block in `tests/server/room.test.js`:

```javascript
test('includes an empty spectators array', () => {
  const room = createRoom('room1');
  expect(room.spectators).toEqual([]);
});
```

```javascript
// tests/server/spectator.test.js
const { createRoom, addPlayer, ROOM_STATUS } = require('../../src/server/room');
const { findSpectator, addSpectator, removeSpectator } = require('../../src/server/spectator');

describe('addSpectator', () => {
  test('adds a new spectator to the room', () => {
    const room = createRoom('room1');
    const { spectator, reconnected } = addSpectator(room, 'alice', 's1');
    expect(reconnected).toBe(false);
    expect(spectator).toEqual({ userId: 'alice', socketId: 's1' });
    expect(room.spectators).toHaveLength(1);
    expect(findSpectator(room, 'alice')).toBe(spectator);
  });

  test('rejoining with the same userId rebinds the socket instead of duplicating', () => {
    const room = createRoom('room1');
    addSpectator(room, 'alice', 's1');
    const { spectator, reconnected } = addSpectator(room, 'alice', 's2');
    expect(reconnected).toBe(true);
    expect(spectator.socketId).toBe('s2');
    expect(room.spectators).toHaveLength(1);
  });

  test('rejects a new spectator once the room hits maxPerRoom', () => {
    const room = createRoom('room1');
    for (let i = 0; i < 50; i++) addSpectator(room, `s${i}`, `sock${i}`);
    expect(() => addSpectator(room, 'newcomer', 'sockX')).toThrow('Room is full of spectators');
  });

  test('a spectator can join regardless of room status or player count', () => {
    const room = createRoom('room1');
    addPlayer(room, 'p1', 'ps1');
    room.status = ROOM_STATUS.IN_PROGRESS;
    const { reconnected } = addSpectator(room, 'watcher', 'ws1');
    expect(reconnected).toBe(false);
    expect(room.spectators).toHaveLength(1);
  });
});

describe('removeSpectator', () => {
  test('removes a spectator from the room', () => {
    const room = createRoom('room1');
    addSpectator(room, 'alice', 's1');
    addSpectator(room, 'bob', 's2');
    removeSpectator(room, 'alice');
    expect(room.spectators).toHaveLength(1);
    expect(findSpectator(room, 'alice')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/server/room.test.js tests/server/spectator.test.js`
Expected: FAIL — the new `room.test.js` assertion fails (`room.spectators` is `undefined`), and `tests/server/spectator.test.js` fails with "Cannot find module '../../src/server/spectator'".

- [ ] **Step 3: Write the implementation**

Read `src/server/room.js` first. Add `spectators: [],` to `createRoom`'s returned object, alongside `players: []`.

```javascript
// src/server/spectator.js
const { SPECTATOR_CONFIG } = require('../config');

function findSpectator(room, userId) {
  return room.spectators.find(s => s.userId === userId) || null;
}

function addSpectator(room, userId, socketId) {
  const existing = findSpectator(room, userId);
  if (existing) {
    existing.socketId = socketId;
    return { room, spectator: existing, reconnected: true };
  }
  if (room.spectators.length >= SPECTATOR_CONFIG.maxPerRoom) {
    throw new Error('Room is full of spectators');
  }
  const spectator = { userId, socketId };
  room.spectators.push(spectator);
  return { room, spectator, reconnected: false };
}

function removeSpectator(room, userId) {
  room.spectators = room.spectators.filter(s => s.userId !== userId);
  return room;
}

module.exports = { findSpectator, addSpectator, removeSpectator };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/server/room.test.js tests/server/spectator.test.js`
Expected: PASS (room.test.js now has one more passing test; spectator.test.js: 4 + 1 = 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/room.js tests/server/room.test.js src/server/spectator.js tests/server/spectator.test.js
git commit -m "feat: add spectator room membership"
```

---

### Task 2: Spectator state view

**Files:**
- Modify: `src/server/playerView.js`
- Modify: `tests/server/playerView.test.js`

**Interfaces:**
- Consumes: nothing new — same `Room`/`Player` shapes `getPlayerView` already reads, plus Task 1's `room.spectators`.
- Produces: `getSpectatorView(room)` → `{roomId, status, direction, eatMode, dealerId, turnIndex, pot, deckCount, discardTop, players}`, identical room-level fields to `getPlayerView`, but every `players` entry is `{userId, ready, connected, isDealer, handCount}` — the `hand` key is structurally absent for EVERY player, with no exception (unlike `getPlayerView`, there is no "viewer's own hand" case here). Consumed by `src/server/socketServer.js` (Task 3).

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/playerView.test.js`, using the same `setup()` helper already defined in that file:

```javascript
const { getSpectatorView } = require('../../src/server/playerView'); // add to existing require line

describe('getSpectatorView', () => {
  test('never exposes any player\'s hand, not even structurally', () => {
    const room = setup();
    const view = getSpectatorView(room);
    view.players.forEach(p => {
      expect('hand' in p).toBe(false);
    });
    expect(view.players.find(p => p.userId === 'alice').handCount).toBe(2);
    expect(view.players.find(p => p.userId === 'bob').handCount).toBe(1);
  });

  test('never exposes deck contents, only deckCount', () => {
    const room = setup();
    const view = getSpectatorView(room);
    expect(view.deckCount).toBe(2);
    expect(view.deck).toBeUndefined();
  });

  test('exposes only the top discard card and room-level fields', () => {
    const room = setup();
    const view = getSpectatorView(room);
    expect(view.discardTop).toEqual({ suit: 'spades', rank: '9' });
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

  test('marks isDealer correctly per player', () => {
    const room = setup();
    const view = getSpectatorView(room);
    expect(view.players.find(p => p.userId === 'alice').isDealer).toBe(true);
    expect(view.players.find(p => p.userId === 'bob').isDealer).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/server/playerView.test.js`
Expected: FAIL — "getSpectatorView is not a function" (or similar) once the new `describe` block runs.

- [ ] **Step 3: Write the implementation**

Read `src/server/playerView.js` first. Add this function alongside `getPlayerView`, exporting both:

```javascript
function getSpectatorView(room) {
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
    })),
  };
}
```

Update the `module.exports` line to `module.exports = { getPlayerView, getSpectatorView };`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/server/playerView.test.js`
Expected: PASS (existing 7 `getPlayerView` tests + 4 new `getSpectatorView` tests = 11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/playerView.js tests/server/playerView.test.js
git commit -m "feat: add spectator state view (never exposes any hand)"
```

---

### Task 3: Socket wiring for spectator join, disconnect, and voice

**Files:**
- Modify: `src/server/socketServer.js`
- Modify: `tests/server/socketServer.test.js`

**Interfaces:**
- Consumes: `addSpectator`, `removeSpectator` from `src/server/spectator.js` (Task 1); `getSpectatorView` from `src/server/playerView.js` (Task 2).
- Produces (all modifications to existing handlers/helpers in `socketServer.js`):
  - `room:join` `{roomId, userId, asSpectator}`: when `asSpectator` is truthy, calls `addSpectator` instead of `addPlayer` (skips the room-full/in-progress checks entirely — spectators aren't subject to them), records `{roomId, userId, isSpectator: true}` in `socketIndex`, broadcasts.
  - `getRoomForSocket(socket)` now also returns `isSpectator` (from the `socketIndex` entry) alongside the existing `room`/`userId`.
  - `broadcastRoomState(room)` now also emits to every spectator, using `getSpectatorView(room)` computed ONCE per broadcast (not per spectator — the view is identical for all of them, unlike each player's own filtered view).
  - `broadcastGameResult(room, outcome)` now also emits `game:result` to every spectator (the payload carries no card data, safe to share).
  - `disconnect`: branches on `entry.isSpectator` — if true, calls `removeSpectator` (always removes immediately, no waiting/in_progress distinction — spectators have no hand state to preserve); the empty-room deletion check becomes `room.players.length === 0 && room.spectators.length === 0` (fixing the pre-existing bug where a spectator-only room would be wrongly kept alive... actually the FIX is the reverse: a player-empty-but-spectator-populated room must NOT be deleted, so this AND condition is the correction over the old `players.length === 0`-only check). Applies to both the spectator branch and the existing player-disconnect branch.
  - `voice:join` `{roomId, role}`: resolves `expectedRole = ctx.isSpectator ? 'spectator' : 'player'`; if `role !== expectedRole`, emits `voice:error {message: `Only ${expectedRole} voice access is available for this membership`}` (replacing Milestone 5's fixed rejection message); otherwise issues a token with `canPublish: !ctx.isSpectator, canSubscribe: true`.

- [ ] **Step 1: Write the failing tests**

Read `tests/server/socketServer.test.js` first — find the existing test titled something like `'voice:join rejects an unsupported role'` (from Milestone 5) and update ONLY its final assertion:

```javascript
// change the existing assertion from:
//   expect(error.message).toBe('Only player voice access is supported currently');
// to:
  expect(error.message).toBe('Only player voice access is available for this membership');
```

Leave the rest of that test (the setup, the `role: 'spectator'` emit) unchanged — the caller in that test is a genuine player, so requesting `role: 'spectator'` is still correctly rejected, just with the new membership-aware message.

Then add these tests to the end of the `describe('socketServer', ...)` block:

```javascript
test('a spectator can join a room and receives a filtered room:state with no hands', async () => {
  const alice = connectClient();
  const bob = connectClient();
  const spectator = connectClient();
  await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect'), waitForEvent(spectator, 'connect')]);

  const aliceStates = collectEvents(alice, 'room:state');
  const bobStates = collectEvents(bob, 'room:state');
  const specStates = collectEvents(spectator, 'room:state');

  alice.emit('room:join', { roomId: 'spec-room-1', userId: 'alice' });
  await waitUntil(() => aliceStates.length >= 1);
  bob.emit('room:join', { roomId: 'spec-room-1', userId: 'bob' });
  await waitUntil(() => bobStates.length >= 1);
  spectator.emit('room:join', { roomId: 'spec-room-1', userId: 'watcher', asSpectator: true });
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
    c.emit('room:join', { roomId: 'spec-room-2', userId: `p${i}` });
    await waitUntil(() => states.length >= 1);
    clients.push(c);
  }

  const spectator = connectClient();
  await waitForEvent(spectator, 'connect');
  const specStates = collectEvents(spectator, 'room:state');
  spectator.emit('room:join', { roomId: 'spec-room-2', userId: 'watcher', asSpectator: true });
  await waitUntil(() => specStates.length >= 1);

  expect(specStates[0].players).toHaveLength(5);
});

test('a room with a departed player but a remaining spectator is not deleted', async () => {
  const alice = connectClient();
  const spectator = connectClient();
  await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(spectator, 'connect')]);

  const aliceStates = collectEvents(alice, 'room:state');
  alice.emit('room:join', { roomId: 'spec-room-3', userId: 'alice' });
  await waitUntil(() => aliceStates.length >= 1);

  const specStates = collectEvents(spectator, 'room:state');
  spectator.emit('room:join', { roomId: 'spec-room-3', userId: 'watcher', asSpectator: true });
  await waitUntil(() => specStates.length >= 1);

  alice.close(); // room is 'waiting', so this removes alice outright (Milestone 2 behavior) — 0 players, 1 spectator
  await waitUntil(() => specStates[specStates.length - 1].players.length === 0);

  // If the room had been deleted from the store, a fresh join would create a brand-new empty room;
  // instead it must still be the SAME room the spectator is watching, reflected via a normal broadcast.
  const bob = connectClient();
  await waitForEvent(bob, 'connect');
  const bobStates = collectEvents(bob, 'room:state');
  bob.emit('room:join', { roomId: 'spec-room-3', userId: 'bob' });
  await waitUntil(() => specStates.length >= 3); // spectator gets a broadcast when bob joins the (still-alive) room
  await waitUntil(() => bobStates.length >= 1);
  expect(bobStates[0].players.map(p => p.userId)).toEqual(['bob']);
});

test('a spectator gets a subscribe-only voice token', async () => {
  const alice = connectClient();
  const spectator = connectClient();
  await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(spectator, 'connect')]);

  const aliceStates = collectEvents(alice, 'room:state');
  alice.emit('room:join', { roomId: 'spec-voice-1', userId: 'alice' });
  await waitUntil(() => aliceStates.length >= 1);

  const specStates = collectEvents(spectator, 'room:state');
  spectator.emit('room:join', { roomId: 'spec-voice-1', userId: 'watcher', asSpectator: true });
  await waitUntil(() => specStates.length >= 1);

  const tokenPromise = waitForEvent(spectator, 'voice:token');
  spectator.emit('voice:join', { roomId: 'spec-voice-1', role: 'spectator' });
  const payload = await tokenPromise;

  const jwt = require('jsonwebtoken');
  const decoded = jwt.verify(payload.token, process.env.LIVEKIT_API_SECRET);
  expect(decoded.video.canPublish).toBe(false);
  expect(decoded.video.canSubscribe).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/server/socketServer.test.js -t "spectator"`
Expected: FAIL — `asSpectator` isn't handled yet, so these tests time out waiting for `room:state`/`voice:token`.

- [ ] **Step 3: Write the implementation**

Read `src/server/socketServer.js` first. Add to the requires:

```javascript
const { addSpectator, removeSpectator } = require('./spectator');
const { getPlayerView, getSpectatorView } = require('./playerView'); // extend the existing getPlayerView import line
```

Update `getRoomForSocket`:

```javascript
function getRoomForSocket(socket) {
  const entry = socketIndex.get(socket.id);
  if (!entry) return null;
  const room = roomStore.get(entry.roomId);
  if (!room) return null;
  return { room, userId: entry.userId, isSpectator: entry.isSpectator };
}
```

Update `broadcastRoomState`:

```javascript
function broadcastRoomState(room) {
  room.players.forEach(player => {
    const socket = io.sockets.sockets.get(player.socketId);
    if (socket) {
      socket.emit('room:state', getPlayerView(room, player.userId));
    }
  });
  if (room.spectators.length > 0) {
    const spectatorView = getSpectatorView(room);
    room.spectators.forEach(spectator => {
      const socket = io.sockets.sockets.get(spectator.socketId);
      if (socket) {
        socket.emit('room:state', spectatorView);
      }
    });
  }
}
```

Update `broadcastGameResult`:

```javascript
function broadcastGameResult(room, outcome) {
  room.players.forEach(player => {
    const socket = io.sockets.sockets.get(player.socketId);
    if (socket) {
      socket.emit('game:result', outcome);
    }
  });
  room.spectators.forEach(spectator => {
    const socket = io.sockets.sockets.get(spectator.socketId);
    if (socket) {
      socket.emit('game:result', outcome);
    }
  });
}
```

Update the `room:join` handler:

```javascript
    socket.on('room:join', ({ roomId, userId, asSpectator }) => {
      let room = roomStore.get(roomId);
      if (!room) {
        room = createRoom(roomId);
        roomStore.set(roomId, room);
      }
      if (asSpectator) {
        try {
          addSpectator(room, userId, socket.id);
        } catch (err) {
          socket.emit('room:error', { message: err.message });
          return;
        }
        socketIndex.set(socket.id, { roomId, userId, isSpectator: true });
        broadcastRoomState(room);
        return;
      }
      try {
        addPlayer(room, userId, socket.id);
      } catch (err) {
        socket.emit('room:error', { message: err.message });
        return;
      }
      socketIndex.set(socket.id, { roomId, userId, isSpectator: false });
      broadcastRoomState(room);
    });
```

Update the `disconnect` handler:

```javascript
    socket.on('disconnect', () => {
      const entry = socketIndex.get(socket.id);
      if (!entry) return;
      socketIndex.delete(socket.id);
      const room = roomStore.get(entry.roomId);
      if (!room) return;

      if (entry.isSpectator) {
        removeSpectator(room, entry.userId);
        if (room.players.length === 0 && room.spectators.length === 0) {
          roomStore.delete(entry.roomId);
          return;
        }
        broadcastRoomState(room);
        return;
      }

      const player = findPlayer(room, entry.userId);
      if (!player || player.socketId !== socket.id) return;
      const { room: updatedRoom } = disconnectPlayer(room, entry.userId);
      if (updatedRoom.players.length === 0 && updatedRoom.spectators.length === 0) {
        roomStore.delete(entry.roomId);
        return;
      }
      broadcastRoomState(updatedRoom);
    });
```

Update the `voice:join` handler:

```javascript
    socket.on('voice:join', async ({ roomId, role }) => {
      const ctx = getRoomForSocket(socket);
      if (!ctx || ctx.room.id !== roomId) {
        socket.emit('voice:error', { message: 'Not a member of this room' });
        return;
      }
      const expectedRole = ctx.isSpectator ? 'spectator' : 'player';
      if (role !== expectedRole) {
        socket.emit('voice:error', { message: `Only ${expectedRole} voice access is available for this membership` });
        return;
      }
      try {
        const token = await createVoiceToken({
          apiKey: process.env.LIVEKIT_API_KEY,
          apiSecret: process.env.LIVEKIT_API_SECRET,
          roomName: ctx.room.id,
          identity: ctx.userId,
          canPublish: !ctx.isSpectator,
          canSubscribe: true,
        });
        socket.emit('voice:token', {
          token,
          url: process.env.LIVEKIT_URL,
          pushToTalk: VOICE_CONFIG.pushToTalk,
        });
      } catch (err) {
        socket.emit('voice:error', { message: 'Failed to issue voice token' });
      }
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/server/socketServer.test.js`
Expected: PASS, all tests in the file. Read the actual `Tests:` count from the run — do not hand-compute; this plan's own arithmetic has been wrong before (Milestones 2, 3, and 5 each had a plan-side count slip caught during review).

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: PASS. This milestone adds: room.test.js +1, spectator.test.js 5, playerView.test.js +4, socketServer.test.js +4 new (the 5th change is a modification to an existing test, not a new one) = 14 new tests on top of Milestone 5's 157, i.e. 171 total. Cross-check against the real `Tests: N passed, N total` line.

- [ ] **Step 6: Commit**

```bash
git add src/server/socketServer.js tests/server/socketServer.test.js
git commit -m "feat: wire spectator join/disconnect/voice and fix empty-room deletion"
```

---

## Self-Review Notes

- **Spec coverage:** §3 `SPECTATOR_CONFIG` (already landed Milestone 1) → Task 1's `maxPerRoom` enforcement. §4.1 `Room.spectators`/`Spectator{userId,socketId}` → Task 1, finally landing the field Milestone 2 explicitly deferred. §5.4 `getSpectatorView` → Task 2. §8 ("spectators must never see any player's hand, filtered server-side") → Task 2's structural (not conventional) hand omission. Milestone 5's deferred spectator-voice piece → Task 3's `voice:join` update, closing that loop as documented at the time.
- **Placeholder scan:** No TBD/TODO markers. Task 3's Step 5 total is shown but explicitly flagged to cross-check against the real run, per the guardrail this project has needed in three of the last four milestones.
- **Type consistency:** `Spectator {userId, socketId}` mirrors `Player`'s identifier fields exactly (no `hand`/`ready`/`declaredKaeng` — spectators don't have game state). `socketIndex` entries gain `isSpectator` additively; every existing consumer of `getRoomForSocket`'s return value (`player:ready`, `game:*` handlers) destructures only `{room, userId}` and is unaffected by the new field being present but unused.
