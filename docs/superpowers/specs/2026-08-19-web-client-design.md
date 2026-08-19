# Web Client Design (Milestone 3)

**Status:** approved for implementation
**Scope:** browser client only. Mobile client is a separate future project reusing this design's event contract.

## Goal

Build the first playable client UI for the game, fulfilling spec build-order item #3 ("basic client UI"). Also closes part of the Auth/Wallet integration gap noted in `CLAUDE.md`: the game server currently trusts a client-supplied `userId` unverified; this project wires real JWT-based identity through to the socket layer.

## Out of scope

- Mobile client (React Native or similar) — future project.
- Voice chat UI (LiveKit join/publish in-browser) — future project.
- Spectator view and leaderboard UI — future project; server-side support already exists (`getSpectatorView`, `leaderboard:get`) and is unaffected by this work.
- Wallet UI (`/wallet/me`, `/wallet/adjust`) — not needed to play a round; the game server still doesn't call into wallet balances (per CLAUDE.md's Milestone 4 note), so there's nothing to display yet.

## 1. Game-server auth wiring

**Problem:** `src/server/socketServer.js` handlers (`room:join`, `game:draw`, etc.) currently take `userId` directly from the client-supplied event payload — unverified. `src/auth/tokens.js` already has a pure, HTTP-free `verifyToken(token)` (JWT verify, no DB call) that the auth service uses for `requireAuth`. This can be reused directly by the game server process since both run from the same repo and share `JWT_SECRET`.

**Design:**

- New socket event `auth` (client → server), payload `{ token }`, sent once immediately after `socket.connect()` and before any other event.
- Server handler: `const payload = verifyToken(token)`. If invalid/missing, emit `auth:error` and do not process further events from this socket. If valid, store `{ userId: payload.userId }` in a new `authenticatedSockets: Map<socketId, userId>` (parallel to the existing `socketIndex` map), and emit `auth:ok`.
- `room:join`'s payload drops the client-supplied `userId` field; the handler reads `userId` from `authenticatedSockets.get(socket.id)` instead. Reject with `room:error` if the socket hasn't authenticated yet.
- All other handlers already resolve `userId` via `getRoomForSocket(socket)` → `socketIndex`, which is populated at `room:join` time from the now-verified `userId` — no further changes needed there.
- No change to `src/auth/tokens.js`, `src/auth/server.js`, or the REST auth endpoints — this only adds a consumer.

**Testing:** extend the existing `socket.io-client`-based integration tests (matching current test style in `tests/`) to cover: connecting without `auth` and attempting `room:join` (rejected), authenticating with a valid token then joining (accepted, `userId` matches token subject), and authenticating with a garbage token (rejected via `auth:error`).

## 2. Web client app

New top-level `client/` directory: Vite + React app, plain JS (matching the rest of the repo, which is not TypeScript).

### Screens

1. **Login** — username/password form. Calls `POST /register` or `POST /login` on the auth service (`AUTH_PORT`). On success, stores `{ token, userId, username }` in memory (React state) + `sessionStorage` (survives refresh, cleared on tab close — no long-lived credential storage beyond the JWT's own 24h expiry).
2. **Lobby** — text field for room ID (join existing or create new by typing a fresh ID — matches server's `room:join` semantics of creating the room if it doesn't exist), a "spectate" checkbox is *not* included (out of scope), a "ready" toggle once in a room, and a live player list from `room:state`.
3. **Table** — the active game screen: own hand (from `room:state`'s player-filtered view), discard pile top card, whose turn it is, and action buttons (`Draw`, `Discard <selected card>`, `Eat <discard>`, `Kaeng`) enabled/disabled based on turn state and game rules already enforced server-side (client only reflects state, never re-validates rules).
4. **Result** — shown on `game:result`: winner, win type, multiplier, per-player hand scores; a "Back to lobby" action re-arms ready-up for the next round (room stays open per existing server round-rotation behavior).

### State management

- `SocketProvider` (React context): owns the `socket.io-client` instance, connects using the stored JWT, immediately emits `auth`, exposes `emit`/`on` helpers and connection status.
- `RoomProvider` (React context + `useReducer`): subscribes to `room:state`, `game:result`, `room:error`, `game:error`, `auth:error` and folds them into a single `{ room, lastResult, error, screen }` state shape. Screen transitions (`login` → `lobby` → `table` → `result` → `lobby`) are derived from room/result state, not tracked independently, to avoid divergence.
- No Redux/Zustand — scope is one active room at a time, context+reducer is sufficient per YAGNI.

### File layout

```
client/
  src/
    api/authClient.js        # fetch wrappers for /register, /login
    socket/SocketProvider.jsx
    state/RoomProvider.jsx (+ reducer.js)
    screens/Login.jsx
    screens/Lobby.jsx
    screens/Table.jsx
    screens/Result.jsx
    App.jsx
  vite.config.js
  package.json
```

### Testing

- Vitest + React Testing Library for the reducer (pure, easy to unit test) and each screen's rendering/interaction (mocked socket/auth clients).
- One end-to-end-ish integration test (Vitest, real `socket.io-client` against a real `createSocketServer()` instance spun up in-process, matching the existing pattern in `tests/`) covering: login → join → ready(x2 players) → draw → discard → result.

## Non-negotiables carried over

- Client never receives other players' hands or the remaining deck — enforced already by `getPlayerView`; the client only ever renders what the server sends, no client-side filtering logic is added.
- Client performs no game-rule validation (meld/win/turn logic) — it only reflects server state and disables buttons based on server-provided turn/state flags, per the spec's server-authority rule.
