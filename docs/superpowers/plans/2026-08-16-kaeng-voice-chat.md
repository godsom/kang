# Kaeng Voice Chat (Milestone 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issue scoped LiveKit access tokens to legitimate room members so a (future) client can join the room's voice channel — the `voice:join` socket event from spec §6, backed by the real dockerized LiveKit dev server.

**Architecture:** A tiny wrapper module (`src/voice/tokens.js`) over `livekit-server-sdk`'s `AccessToken`, plus one new Socket.io handler in the existing game server (`src/server/socketServer.js`). No client exists in this project yet (no browser/mobile UI was ever built — the actual audio capture/playback is inherently client-side WebRTC work), so this milestone is scoped strictly to what the server can meaningfully do: verify a caller is a real room member and hand back a correctly-scoped LiveKit JWT. Actually joining and speaking in the LiveKit room is out of reach without a client and is explicitly deferred.

**Tech Stack:** Node.js (CommonJS), `livekit-server-sdk`, Jest, `socket.io-client` for integration tests, real dockerized LiveKit (dev mode) for token verification.

## Global Constraints

- **Scoped to players only.** Spec §6's `voice:join` payload allows `role: 'player'|'spectator'`, but no spectator concept exists in the `Room`/`Player` model yet (Milestone 2 explicitly deferred spectators to Milestone 6, not yet built). This milestone only issues tokens for `role: 'player'`; a `role: 'spectator'` request is rejected with `voice:error` until Milestone 6 adds spectator room membership. This is the natural, minimal scope — building spectator voice grants now would mean guessing at a data model this project doesn't have yet.
- **Server-side role verification, not client-trust.** The caller's actual room membership (via the existing `findPlayer`/socket-index lookup already used by every other game-server handler) determines the token's grants — the client-supplied `role` field is checked against reality, not trusted blindly, matching this project's established "server validates, client never dictates game state" principle (spec §8).
- **`VOICE_CONFIG` (Milestone 1's `src/config.js`) governs the grant shape:** `canPublish: true, canSubscribe: true` for a verified player (matching `maxPublishers: 5` — since a room can never have more than `GAME_CONFIG.MAX_PLAYERS` (5) players, and only players can publish, the publisher cap is already satisfied by the existing room-membership cap with no extra enforcement needed). `pushToTalk` is echoed back in the token response for the client to read — it's a client-side UI concern (always-on mic vs. push-to-talk), not something the server enforces.
- **`voice:token` (server→client) is a new, documented response event** (not in spec §6's table, which only lists `voice:join` client→server) — a deliberate addition, same pattern as Milestone 2's `player:ready`. Payload: `{token, url, pushToTalk}`.
- **The game server's `index.js` needs `dotenv` loaded now** (it didn't need any env vars before this milestone). Milestone 4's final review caught this exact bug in the auth service's entrypoint (`src/auth/index.js` read `process.env` without loading `.env` first) — this plan applies that lesson proactively to `src/server/index.js` rather than repeating the mistake.
- Reuses Milestone 2's `findPlayer`, `getRoomForSocket`-style lookup pattern (established across Milestones 2-3's `player:ready`/`game:*` handlers) exactly as already written — no changes to room/player data model.

---

## File Structure

- `src/voice/tokens.js` — `createVoiceToken({apiKey, apiSecret, roomName, identity, canPublish, canSubscribe})` → `Promise<string>` (a signed LiveKit JWT).
- `src/server/socketServer.js` (**modify**) — add a `voice:join` handler.
- `src/server/index.js` (**modify**) — add `require('dotenv').config()` as the first line (was missing; needed now that `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`/`LIVEKIT_URL` must be read from the environment).

---

### Task 1: LiveKit token generation

**Files:**
- Create: `src/voice/tokens.js`
- Test: `tests/voice/tokens.test.js`

**Interfaces:**
- Consumes: `livekit-server-sdk`'s `AccessToken`.
- Produces: `createVoiceToken({apiKey, apiSecret, roomName, identity, canPublish, canSubscribe})` → `Promise<string>` — a JWT signed with `apiSecret` (HS256, matching LiveKit's own token format), whose payload includes `sub: identity` and a `video` grant object with `room: roomName`, `roomJoin: true`, `canPublish`, `canSubscribe` set exactly as passed in. Consumed by `src/server/socketServer.js` (Task 2).

- [ ] **Step 1: Add the dependency**

```bash
npm install livekit-server-sdk
```

- [ ] **Step 2: Write the failing tests**

```javascript
// tests/voice/tokens.test.js
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { createVoiceToken } = require('../../src/voice/tokens');

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

describe('createVoiceToken', () => {
  test('produces a JWT signed with apiSecret, decodable with jsonwebtoken', async () => {
    const token = await createVoiceToken({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      roomName: 'room1',
      identity: 'alice',
      canPublish: true,
      canSubscribe: true,
    });
    const payload = jwt.verify(token, API_SECRET);
    expect(payload.sub).toBe('alice');
    expect(payload.iss).toBe(API_KEY);
  });

  test('grants canPublish/canSubscribe and the target room exactly as requested', async () => {
    const token = await createVoiceToken({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      roomName: 'room42',
      identity: 'bob',
      canPublish: false,
      canSubscribe: true,
    });
    const payload = jwt.verify(token, API_SECRET);
    expect(payload.video).toMatchObject({
      room: 'room42',
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
    });
  });

  test('a token signed with the wrong secret fails verification', async () => {
    const token = await createVoiceToken({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      roomName: 'room1',
      identity: 'carol',
      canPublish: true,
      canSubscribe: true,
    });
    expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/voice/tokens.test.js`
Expected: FAIL with "Cannot find module '../../src/voice/tokens'"

- [ ] **Step 4: Write the implementation**

```javascript
// src/voice/tokens.js
const { AccessToken } = require('livekit-server-sdk');

async function createVoiceToken({ apiKey, apiSecret, roomName, identity, canPublish, canSubscribe }) {
  const at = new AccessToken(apiKey, apiSecret, { identity });
  at.addGrant({ room: roomName, roomJoin: true, canPublish, canSubscribe });
  return at.toJwt();
}

module.exports = { createVoiceToken };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/voice/tokens.test.js`
Expected: PASS (3 tests) — requires `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` in `.env` (already present from Milestone 0's infra setup: `devkey`/`secret`, matching the dockerized LiveKit dev server).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/voice/tokens.js tests/voice/tokens.test.js
git commit -m "feat: add LiveKit voice token generation"
```

---

### Task 2: Socket wiring for voice:join

**Files:**
- Modify: `src/server/socketServer.js`
- Modify: `src/server/index.js`
- Modify: `tests/server/socketServer.test.js`

**Interfaces:**
- Consumes: `createVoiceToken` from `src/voice/tokens.js` (Task 1); `VOICE_CONFIG` from `src/config.js` (Milestone 1); the existing `getRoomForSocket`/`findPlayer` lookup pattern already present in `socketServer.js`.
- Produces: `voice:join` handler (client→server, `{roomId, role}`): looks up the caller's actual room membership; if the caller isn't a member of `roomId` (mismatch or not found), emits `voice:error {message: 'Not a member of this room'}`; if `role !== 'player'`, emits `voice:error {message: 'Only player voice access is supported currently'}`; otherwise calls `createVoiceToken` with `canPublish: true, canSubscribe: true, roomName: roomId, identity: <caller's userId>`, using `process.env.LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`, and emits `voice:token {token, url: process.env.LIVEKIT_URL, pushToTalk: VOICE_CONFIG.pushToTalk}` to the caller only.

- [ ] **Step 1: Write the failing tests**

Read `tests/server/socketServer.test.js` first. Add these three tests inside the existing `describe('socketServer', ...)` block, after the existing tests (do not modify existing tests):

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/server/socketServer.test.js -t "voice:join"`
Expected: FAIL — the client emits `voice:join`, but no handler exists yet, so `waitForEvent`/`waitUntil` time out.

- [ ] **Step 3: Write the implementation**

Read `src/server/socketServer.js` and `src/server/index.js` first.

Add to `src/server/index.js`, as the literal first line (before any other `require`):

```javascript
require('dotenv').config();
```

Add to `src/server/socketServer.js`'s requires:

```javascript
const { VOICE_CONFIG } = require('../config');
const { createVoiceToken } = require('../voice/tokens');
```

Add this handler inside `io.on('connection', (socket) => { ... })`, alongside the existing handlers (leave `room:join`/`player:ready`/`game:*`/`disconnect` exactly as they are):

```javascript
    socket.on('voice:join', async ({ roomId, role }) => {
      const ctx = getRoomForSocket(socket);
      if (!ctx || ctx.room.id !== roomId) {
        socket.emit('voice:error', { message: 'Not a member of this room' });
        return;
      }
      if (role !== 'player') {
        socket.emit('voice:error', { message: 'Only player voice access is supported currently' });
        return;
      }
      const token = await createVoiceToken({
        apiKey: process.env.LIVEKIT_API_KEY,
        apiSecret: process.env.LIVEKIT_API_SECRET,
        roomName: ctx.room.id,
        identity: ctx.userId,
        canPublish: true,
        canSubscribe: true,
      });
      socket.emit('voice:token', {
        token,
        url: process.env.LIVEKIT_URL,
        pushToTalk: VOICE_CONFIG.pushToTalk,
      });
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/server/socketServer.test.js`
Expected: PASS, all tests in the file (14, up from 11 — confirm the exact pre-existing count from your own read of the file in Step 1, this plan's own count may be off, cross-check against the real diff rather than trusting this arithmetic).

- [ ] **Step 5: Verify `src/server/index.js` actually boots with the dotenv fix**

Run: `npm run start` in the background briefly, confirm it prints "Kaeng game server listening on port ..." with no error, then stop it. This directly tests the lesson from Milestone 4's entrypoint bug — don't just trust the code looks right.

- [ ] **Step 6: Run the full suite**

Run: `npx jest`
Expected: PASS. Read the actual `Tests: N passed, N total` line — this milestone adds 3 (Task 1) + 3 (Task 2) = 6 tests on top of Milestone 4's 150, i.e. 156 total. This plan's own predicted socketServer.test.js baseline (11 existing tests) should also be cross-checked against the real file, not trusted blindly.

- [ ] **Step 7: Commit**

```bash
git add src/server/socketServer.js src/server/index.js tests/server/socketServer.test.js
git commit -m "feat: wire voice:join socket handler for LiveKit token issuance"
```

---

## Self-Review Notes

- **Spec coverage:** §1 (voice SFU via LiveKit), §3 (`VOICE_CONFIG`, already landed in Milestone 1, consumed here), §6 (`voice:join` event) → both tasks. `role: 'spectator'` support is explicitly deferred to Milestone 6 (documented in Global Constraints), not a gap. Actual audio join/publish/subscribe (the client-side WebRTC work) is out of scope — no client exists in this project to do it, and building one is not part of any milestone's spec scope so far.
- **Placeholder scan:** No TBD/TODO markers. Step 4's test-count line is flagged to cross-check against the real pre-existing count rather than trusted blindly, per the guardrail established after two prior milestones' plan-arithmetic slips.
- **Type consistency:** `roomId`/`ctx.room.id` and `ctx.userId` reuse the exact same fields already established by `getRoomForSocket` in Milestones 2-3 — no new identifier shape introduced. The LiveKit JWT's `video` grant shape (`room`, `roomJoin`, `canPublish`, `canSubscribe`) matches `livekit-server-sdk`'s own `VideoGrant` type, not a project-invented shape.
