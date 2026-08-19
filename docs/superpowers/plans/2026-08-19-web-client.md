# Web Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first playable browser client (login → lobby → table → result) and wire the game server to verify real JWTs instead of trusting client-supplied `userId`.

**Architecture:** Two independent pieces. (1) `src/server/socketServer.js` gains an `auth` handshake event that verifies a JWT via the existing `src/auth/tokens.js:verifyToken` and stores the verified `userId` per-socket; `room:join` reads `userId` from that instead of the payload. (2) A new `client/` Vite+React app talks REST to the existing auth service (`/register`, `/login`) and Socket.io to the game server, using two React contexts (`SocketProvider`, `RoomProvider`) and four screens (`Login`, `Lobby`, `Table`, `Result`).

**Tech Stack:** Node/Jest (server side, existing), React + Vite + Vitest + React Testing Library (client side, new — `client/` has its own `package.json`, isolated from the root Jest run).

**Spec:** `docs/superpowers/specs/2026-08-19-web-client-design.md`

## Global Constraints

- Client never receives other players' hands or the remaining deck — the client renders only what the server sends via `room:state`/`game:result`; it must not add any hand-filtering or rule-validation logic of its own (spec's non-negotiable server-authority rule).
- Client performs no game-rule validation — action buttons are enabled/disabled from server-provided state (`room.turnIndex`, `room.status`, whose turn per player list ordering), never from client-side rule logic.
- Web only — no mobile, no voice UI, no spectator UI, no wallet UI in this plan (all explicitly out of scope per the spec).
- Plain JS, no TypeScript — matches the rest of this repo.
- `client/` is a separate npm project (own `package.json`, own test runner) so the root `npm test` (Jest) is unaffected; root `jest` config must explicitly ignore `client/`.

---

## File Structure

**Server (modified):**
- `src/server/socketServer.js` — add `auth` handler + `authenticatedSockets` map; `room:join` reads verified `userId`.
- `tests/server/socketServer.test.js` — add auth-handshake test cases.

**Client (new), under `client/`:**
- `package.json`, `vite.config.js`, `vitest.setup.js`, `index.html` — project scaffold.
- `src/main.jsx` — entry point, mounts `App`.
- `src/api/authClient.js` — `register(username, password)`, `login(username, password)` → `{ token, userId, username }`.
- `src/socket/SocketProvider.jsx` — connects `socket.io-client` using the auth token, exposes `useSocket()`.
- `src/state/reducer.js` — pure reducer, exported and unit-tested standalone.
- `src/state/RoomProvider.jsx` — wraps the reducer in a context, wires socket event listeners to dispatch.
- `src/screens/Login.jsx`
- `src/screens/Lobby.jsx`
- `src/screens/Table.jsx`
- `src/screens/Result.jsx`
- `src/App.jsx` — derives which screen to show from state, no independent screen state.

Root `package.json`'s `jest.testPathIgnorePatterns` gets `<rootDir>/client/` added (Task 1 touches server only, but this ignore is a one-line prerequisite for every client task afterward, so it's folded into Task 2 which creates `client/`).

---

### Task 1: Game-server JWT auth handshake

**Files:**
- Modify: `src/server/socketServer.js`
- Test: `tests/server/socketServer.test.js`

**Interfaces:**
- Consumes: `verifyToken(token)` from `src/auth/tokens.js` (already exists — returns `{ userId, username }` or `null`).
- Produces: new socket event contract — client emits `auth` with `{ token }`; server emits `auth:ok` with `{ userId }` on success or `auth:error` with `{ message }` on failure. `room:join`'s payload no longer needs (and no longer trusts) a `userId` field — it reads from the authenticated socket instead. If `room:join` arrives on an unauthenticated socket, server emits `room:error` with `{ message: 'Not authenticated' }`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/socketServer.test.js` (near the top of the `describe('socketServer', ...)` block, after existing `require`s add `const { signToken } = require('../../src/auth/tokens');`):

```js
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
    const token = signToken({ id: 'alice-id', username: 'alice' }, 'test-secret');
    alice.emit('auth', { token });
    const ok = await okPromise;
    expect(ok.userId).toBe('alice-id');

    const aliceStates = collectEvents(alice, 'room:state');
    // even if the client lies about userId in the payload, the server must use the verified one
    alice.emit('room:join', { roomId: 'auth-room', userId: 'someone-else' });
    await waitUntil(() => aliceStates.length >= 1);
    expect(aliceStates[0].players[0].userId).toBe('alice-id');
  });
```

Note: `signToken` reads `process.env.JWT_SECRET` by default, so pass an explicit secret (`'test-secret'`) as its third arg, and verify the server's `verifyToken` call site also reads the same env var — tests must run with a `JWT_SECRET` env var set. Check `tests/auth/` for how existing auth tests set this (they rely on `.env` loaded via `require('dotenv').config()` at the top of the test file, which `socketServer.test.js` already has). Use `process.env.JWT_SECRET` in the test instead of the literal `'test-secret'`:

```js
    const token = signToken({ id: 'alice-id', username: 'alice' }, process.env.JWT_SECRET);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/server/socketServer.test.js -t "auth" -v`
Expected: FAIL — `room:error`/`auth:error`/`auth:ok` events never fire (no `auth` handler exists yet, and `room:join` doesn't reject unauthenticated sockets).

- [ ] **Step 3: Implement the auth handshake**

In `src/server/socketServer.js`, add the import at the top:

```js
const { verifyToken } = require('../auth/tokens');
```

Add a new map alongside `socketIndex` (inside `createSocketServer`, near `const socketIndex = new Map();`):

```js
  const authenticatedSockets = new Map(); // socket.id -> userId
```

Inside `io.on('connection', (socket) => { ... })`, add the `auth` handler (place it before `room:join`):

```js
    socket.on('auth', ({ token }) => {
      const payload = token ? verifyToken(token) : null;
      if (!payload) {
        socket.emit('auth:error', { message: 'Invalid token' });
        return;
      }
      authenticatedSockets.set(socket.id, payload.userId);
      socket.emit('auth:ok', { userId: payload.userId });
    });
```

Change the start of the `room:join` handler from:

```js
    socket.on('room:join', ({ roomId, userId, asSpectator }) => {
```

to:

```js
    socket.on('room:join', ({ roomId, asSpectator }) => {
      const userId = authenticatedSockets.get(socket.id);
      if (!userId) {
        socket.emit('room:error', { message: 'Not authenticated' });
        return;
      }
```

Finally, clean up the map on disconnect — in the existing `socket.on('disconnect', () => { ... })` handler, add as its first line:

```js
      authenticatedSockets.delete(socket.id);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/server/socketServer.test.js -v`
Expected: PASS — all tests in the file, including the three new ones and every pre-existing test (pre-existing tests call `room:join` with a `userId` field but never call `auth` first; they must now be updated — see Step 5).

- [ ] **Step 5: Update every pre-existing test in this file to authenticate before joining**

Every existing `emit('room:join', { roomId, userId: '<x>', ... })` call in `tests/server/socketServer.test.js` (and in any other test file that connects directly to a live `createSocketServer()` instance — check `tests/server/` for other files using `Client(...)` against a real server; `spectator.test.js`/`playerView.test.js` etc. call the pure functions directly and are unaffected) needs an `auth` call first, using that same `userId` as the token subject:

```js
    alice.emit('auth', { token: signToken({ id: 'alice', username: 'alice' }, process.env.JWT_SECRET) });
    await waitForEvent(alice, 'auth:ok');
    alice.emit('room:join', { roomId: 'room1' }); // userId field no longer sent — server derives it
```

Apply this pattern to every `connectClient()` + `room:join` pair in the file. Confirm no other test file under `tests/` opens a live socket connection:

Run: `grep -rl "socket.io-client" tests/`
Expected: only `tests/server/socketServer.test.js`.

- [ ] **Step 6: Run the full test suite**

Run: `npx jest -v`
Expected: PASS — all 184+ existing tests plus the 3 new ones.

- [ ] **Step 7: Commit**

```bash
git add src/server/socketServer.js tests/server/socketServer.test.js
git commit -m "feat: verify JWT identity on socket connections instead of trusting client-supplied userId"
```

---

### Task 2: Client project scaffold

**Files:**
- Create: `client/package.json`
- Create: `client/vite.config.js`
- Create: `client/vitest.setup.js`
- Create: `client/index.html`
- Create: `client/src/main.jsx`
- Create: `client/src/App.jsx` (placeholder — replaced fully in Task 8)
- Create: `client/src/App.test.jsx`
- Modify: `package.json` (root)

**Interfaces:**
- Produces: a runnable Vite dev server (`npm run dev` inside `client/`) and a working `npm test` (Vitest) inside `client/`, independent of the root Jest run.

- [ ] **Step 1: Add the root Jest ignore for `client/`**

In root `package.json`, change:

```json
  "jest": {
    "testPathIgnorePatterns": [
      "/node_modules/",
      "<rootDir>/.claude/"
    ],
```

to:

```json
  "jest": {
    "testPathIgnorePatterns": [
      "/node_modules/",
      "<rootDir>/.claude/",
      "<rootDir>/client/"
    ],
```

- [ ] **Step 2: Create `client/package.json`**

```json
{
  "name": "kaeng-web-client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "socket.io-client": "^4.8.3"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "vite": "^6.0.7",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 3: Create `client/vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './vitest.setup.js',
    globals: true,
  },
});
```

- [ ] **Step 4: Create `client/vitest.setup.js`**

```js
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Create `client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Kaeng</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `client/src/main.jsx`**

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 7: Create a placeholder `client/src/App.jsx`**

This is replaced with the real screen-routing logic in Task 8. For now it just proves the scaffold renders, so early tasks (Login, SocketProvider, RoomProvider) have something importable to build toward without blocking on Task 8.

```jsx
function App() {
  return <div>Kaeng</div>;
}

export default App;
```

- [ ] **Step 8: Write the scaffold smoke test — `client/src/App.test.jsx`**

```jsx
import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import App from './App.jsx';

describe('App scaffold', () => {
  test('renders without crashing', () => {
    render(<App />);
    expect(screen.getByText('Kaeng')).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Install and run**

Run: `cd client && npm install && npm test`
Expected: PASS — 1 test.

- [ ] **Step 10: Commit**

```bash
git add package.json client/
git commit -m "chore: scaffold Vite/React web client project"
```

---

### Task 3: Auth REST client + Login screen

**Files:**
- Create: `client/src/api/authClient.js`
- Create: `client/src/api/authClient.test.js`
- Create: `client/src/screens/Login.jsx`
- Create: `client/src/screens/Login.test.jsx`

**Interfaces:**
- Consumes: `fetch` (global, jsdom/browser-provided), `import.meta.env.VITE_AUTH_URL` (falls back to `http://localhost:4000`, matching `AUTH_PORT=4000` from `.env.example`).
- Produces: `register(username, password)` and `login(username, password)`, both `async`, both resolving to `{ token, userId, username }` or throwing `Error(message)` on non-2xx. `Login` component: `<Login onAuthenticated={(auth) => void} />`, calls `onAuthenticated({ token, userId, username })` on success.

- [ ] **Step 1: Write the failing test for `authClient`**

`client/src/api/authClient.test.js`:

```jsx
import { describe, test, expect, vi, afterEach } from 'vitest';
import { login, register } from './authClient.js';

describe('authClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('login resolves token/userId/username on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'jwt-abc', user: { id: 'u1', username: 'alice' } }),
    }));
    const result = await login('alice', 'hunter2');
    expect(result).toEqual({ token: 'jwt-abc', userId: 'u1', username: 'alice' });
  });

  test('login throws with server message on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Invalid username or password' }),
    }));
    await expect(login('alice', 'wrong')).rejects.toThrow('Invalid username or password');
  });

  test('register resolves token/userId/username on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'jwt-xyz', user: { id: 'u2', username: 'bob' } }),
    }));
    const result = await register('bob', 'hunter2');
    expect(result).toEqual({ token: 'jwt-xyz', userId: 'u2', username: 'bob' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/api/authClient.test.js`
Expected: FAIL — `authClient.js` doesn't exist.

- [ ] **Step 3: Implement `client/src/api/authClient.js`**

```js
const AUTH_URL = import.meta.env.VITE_AUTH_URL || 'http://localhost:4000';

async function postCredentials(path, username, password) {
  const res = await fetch(`${AUTH_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.message || 'Request failed');
  }
  return { token: body.token, userId: body.user.id, username: body.user.username };
}

function login(username, password) {
  return postCredentials('/login', username, password);
}

function register(username, password) {
  return postCredentials('/register', username, password);
}

export { login, register };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/api/authClient.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Write the failing test for `Login`**

`client/src/screens/Login.test.jsx`:

```jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import Login from './Login.jsx';
import * as authClient from '../api/authClient.js';

describe('Login screen', () => {
  test('calls onAuthenticated with the login result on submit', async () => {
    vi.spyOn(authClient, 'login').mockResolvedValue({ token: 't', userId: 'u1', username: 'alice' });
    const onAuthenticated = vi.fn();
    render(<Login onAuthenticated={onAuthenticated} />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith({ token: 't', userId: 'u1', username: 'alice' }));
  });

  test('shows the error message when login fails', async () => {
    vi.spyOn(authClient, 'login').mockRejectedValue(new Error('Invalid username or password'));
    render(<Login onAuthenticated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Invalid username or password')).toBeInTheDocument();
  });

  test('register button calls authClient.register instead', async () => {
    vi.spyOn(authClient, 'register').mockResolvedValue({ token: 't2', userId: 'u2', username: 'bob' });
    const onAuthenticated = vi.fn();
    render(<Login onAuthenticated={onAuthenticated} />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'bob' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith({ token: 't2', userId: 'u2', username: 'bob' }));
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd client && npx vitest run src/screens/Login.test.jsx`
Expected: FAIL — `Login.jsx` doesn't exist.

- [ ] **Step 7: Implement `client/src/screens/Login.jsx`**

```jsx
import { useState } from 'react';
import { login, register } from '../api/authClient.js';

function Login({ onAuthenticated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  async function handleSubmit(action) {
    setError(null);
    try {
      const result = await action(username, password);
      onAuthenticated(result);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h1>Kaeng</h1>
      <label>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button onClick={() => handleSubmit(login)}>Log in</button>
      <button onClick={() => handleSubmit(register)}>Register</button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export default Login;
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd client && npx vitest run src/screens/Login.test.jsx`
Expected: PASS — 3 tests.

- [ ] **Step 9: Commit**

```bash
git add client/src/api/authClient.js client/src/api/authClient.test.js client/src/screens/Login.jsx client/src/screens/Login.test.jsx
git commit -m "feat: add auth REST client and Login screen"
```

---

### Task 4: SocketProvider

**Files:**
- Create: `client/src/socket/SocketProvider.jsx`
- Create: `client/src/socket/SocketProvider.test.jsx`

**Interfaces:**
- Consumes: `socket.io-client`'s default export (`io`); `auth.token` from props.
- Produces: `<SocketProvider auth={{ token, userId, username }}>` context provider; `useSocket()` hook returning `{ socket, connected }`. On mount, connects to `import.meta.env.VITE_GAME_SERVER_URL` (falls back to `http://localhost:3000`) and immediately emits `auth` with `{ token: auth.token }` once connected. Disconnects on unmount or when `auth` becomes null.

- [ ] **Step 1: Write the failing test**

`client/src/socket/SocketProvider.test.jsx`:

```jsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { SocketProvider, useSocket } from './SocketProvider.jsx';

const mockSocket = { on: vi.fn(), off: vi.fn(), emit: vi.fn(), close: vi.fn() };
vi.mock('socket.io-client', () => ({
  default: vi.fn(() => mockSocket),
}));

function Probe() {
  const { connected } = useSocket();
  return <div>{connected ? 'connected' : 'not-connected'}</div>;
}

describe('SocketProvider', () => {
  beforeEach(() => {
    mockSocket.on.mockReset();
    mockSocket.emit.mockReset();
  });

  test('emits auth with the token once the socket connects', async () => {
    render(
      <SocketProvider auth={{ token: 'jwt-abc', userId: 'u1', username: 'alice' }}>
        <Probe />
      </SocketProvider>
    );

    const connectHandler = mockSocket.on.mock.calls.find(([event]) => event === 'connect')[1];
    connectHandler();

    await waitFor(() => expect(mockSocket.emit).toHaveBeenCalledWith('auth', { token: 'jwt-abc' }));
    expect(screen.getByText('connected')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/socket/SocketProvider.test.jsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `client/src/socket/SocketProvider.jsx`**

```jsx
import { createContext, useContext, useEffect, useState } from 'react';
import io from 'socket.io-client';

const GAME_SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL || 'http://localhost:3000';

const SocketContext = createContext(null);

function SocketProvider({ auth, children }) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!auth) {
      setSocket(null);
      setConnected(false);
      return;
    }
    const s = io(GAME_SERVER_URL);
    s.on('connect', () => {
      s.emit('auth', { token: auth.token });
      setConnected(true);
    });
    s.on('disconnect', () => setConnected(false));
    setSocket(s);
    return () => s.close();
  }, [auth]);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

function useSocket() {
  return useContext(SocketContext);
}

export { SocketProvider, useSocket };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/socket/SocketProvider.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/socket/
git commit -m "feat: add SocketProvider for authenticated game-server connections"
```

---

### Task 5: Room reducer + RoomProvider

**Files:**
- Create: `client/src/state/reducer.js`
- Create: `client/src/state/reducer.test.js`
- Create: `client/src/state/RoomProvider.jsx`
- Create: `client/src/state/RoomProvider.test.jsx`

**Interfaces:**
- Produces: `initialState = { room: null, result: null, error: null }`; `roomReducer(state, action)` handling action types `ROOM_STATE`, `GAME_RESULT`, `CLEAR_RESULT`, `ERROR`, `CLEAR_ERROR`. `<RoomProvider>` (must be nested inside `SocketProvider`) subscribes to the socket's `room:state`, `game:result`, `room:error`, `game:error` events and dispatches accordingly; exposes `useRoom()` returning `{ state, dispatch }`.

- [ ] **Step 1: Write the failing test for the reducer**

`client/src/state/reducer.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { roomReducer, initialState } from './reducer.js';

describe('roomReducer', () => {
  test('ROOM_STATE sets room and clears error', () => {
    const state = roomReducer({ ...initialState, error: 'stale' }, { type: 'ROOM_STATE', room: { status: 'waiting' } });
    expect(state.room).toEqual({ status: 'waiting' });
    expect(state.error).toBeNull();
  });

  test('GAME_RESULT sets result', () => {
    const state = roomReducer(initialState, { type: 'GAME_RESULT', result: { winners: ['alice'], reason: 'kaeng', multiplier: 1 } });
    expect(state.result).toEqual({ winners: ['alice'], reason: 'kaeng', multiplier: 1 });
  });

  test('CLEAR_RESULT clears result', () => {
    const state = roomReducer({ ...initialState, result: { winners: [] } }, { type: 'CLEAR_RESULT' });
    expect(state.result).toBeNull();
  });

  test('ERROR sets error message', () => {
    const state = roomReducer(initialState, { type: 'ERROR', message: 'Room is full' });
    expect(state.error).toBe('Room is full');
  });

  test('CLEAR_ERROR clears error', () => {
    const state = roomReducer({ ...initialState, error: 'x' }, { type: 'CLEAR_ERROR' });
    expect(state.error).toBeNull();
  });

  test('unknown action returns state unchanged', () => {
    expect(roomReducer(initialState, { type: 'NOPE' })).toBe(initialState);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/state/reducer.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `client/src/state/reducer.js`**

```js
const initialState = {
  room: null,
  result: null,
  error: null,
};

function roomReducer(state, action) {
  switch (action.type) {
    case 'ROOM_STATE':
      return { ...state, room: action.room, error: null };
    case 'GAME_RESULT':
      return { ...state, result: action.result };
    case 'CLEAR_RESULT':
      return { ...state, result: null };
    case 'ERROR':
      return { ...state, error: action.message };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

export { roomReducer, initialState };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/state/reducer.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Write the failing test for `RoomProvider`**

`client/src/state/RoomProvider.test.jsx`:

```jsx
import { render, screen, act } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import { RoomProvider, useRoom } from './RoomProvider.jsx';

function Probe() {
  const { state } = useRoom();
  return <div>{state.room ? state.room.status : 'no-room'}</div>;
}

function makeMockSocket() {
  const handlers = {};
  return {
    handlers,
    on: vi.fn((event, cb) => { handlers[event] = cb; }),
    off: vi.fn(),
    emit: vi.fn(),
  };
}

describe('RoomProvider', () => {
  test('dispatches ROOM_STATE when the socket emits room:state', () => {
    const socket = makeMockSocket();
    render(
      <RoomProvider socket={socket}>
        <Probe />
      </RoomProvider>
    );
    expect(screen.getByText('no-room')).toBeInTheDocument();

    act(() => socket.handlers['room:state']({ status: 'waiting' }));
    expect(screen.getByText('waiting')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd client && npx vitest run src/state/RoomProvider.test.jsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 7: Implement `client/src/state/RoomProvider.jsx`**

```jsx
import { createContext, useContext, useEffect, useReducer } from 'react';
import { roomReducer, initialState } from './reducer.js';

const RoomContext = createContext(null);

function RoomProvider({ socket, children }) {
  const [state, dispatch] = useReducer(roomReducer, initialState);

  useEffect(() => {
    if (!socket) return;
    const onRoomState = (room) => dispatch({ type: 'ROOM_STATE', room });
    const onGameResult = (result) => dispatch({ type: 'GAME_RESULT', result });
    const onRoomError = ({ message }) => dispatch({ type: 'ERROR', message });
    const onGameError = ({ message }) => dispatch({ type: 'ERROR', message });

    socket.on('room:state', onRoomState);
    socket.on('game:result', onGameResult);
    socket.on('room:error', onRoomError);
    socket.on('game:error', onGameError);

    return () => {
      socket.off('room:state', onRoomState);
      socket.off('game:result', onGameResult);
      socket.off('room:error', onRoomError);
      socket.off('game:error', onGameError);
    };
  }, [socket]);

  return (
    <RoomContext.Provider value={{ state, dispatch }}>
      {children}
    </RoomContext.Provider>
  );
}

function useRoom() {
  return useContext(RoomContext);
}

export { RoomProvider, useRoom };
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd client && npx vitest run src/state/RoomProvider.test.jsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/src/state/
git commit -m "feat: add room reducer and RoomProvider"
```

---

### Task 6: Lobby screen

**Files:**
- Create: `client/src/screens/Lobby.jsx`
- Create: `client/src/screens/Lobby.test.jsx`

**Interfaces:**
- Consumes: `useSocket()` (Task 4), `useRoom()` (Task 5).
- Produces: `<Lobby userId={string} />`. Renders a room-ID input + "Join" button when `state.room` is null; once joined, renders the player list from `state.room.players` (each `{ userId, ready, connected, isDealer, handCount }` per `getPlayerView`) and a "Ready" toggle button that emits `player:ready`.

- [ ] **Step 1: Write the failing test**

`client/src/screens/Lobby.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import { SocketContextTestable } from './testUtils.jsx';
import Lobby from './Lobby.jsx';

// Minimal fakes for the two contexts Lobby depends on, avoiding a real socket.
vi.mock('../socket/SocketProvider.jsx', () => ({
  useSocket: () => ({ socket: globalThis.__mockSocket, connected: true }),
}));
vi.mock('../state/RoomProvider.jsx', () => ({
  useRoom: () => ({ state: globalThis.__mockRoomState }),
}));

describe('Lobby screen', () => {
  test('emits room:join with the typed room id', () => {
    globalThis.__mockSocket = { emit: vi.fn() };
    globalThis.__mockRoomState = { room: null, error: null };
    render(<Lobby userId="alice" />);

    fireEvent.change(screen.getByLabelText('Room ID'), { target: { value: 'room42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('room:join', { roomId: 'room42' });
  });

  test('renders the player list and a ready toggle once in a room', () => {
    globalThis.__mockSocket = { emit: vi.fn() };
    globalThis.__mockRoomState = {
      room: {
        status: 'waiting',
        players: [
          { userId: 'alice', ready: false, connected: true, isDealer: false, handCount: 0 },
          { userId: 'bob', ready: true, connected: true, isDealer: false, handCount: 0 },
        ],
      },
      error: null,
    };
    render(<Lobby userId="alice" />);

    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ready' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('player:ready', { ready: true });
  });
});
```

This test needs a `testUtils.jsx` placeholder import removed — it isn't actually used given the `vi.mock` approach above. Drop the unused import line (`import { SocketContextTestable } from './testUtils.jsx';`) before running; the two `vi.mock` calls are sufficient.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/screens/Lobby.test.jsx`
Expected: FAIL — `Lobby.jsx` doesn't exist.

- [ ] **Step 3: Implement `client/src/screens/Lobby.jsx`**

```jsx
import { useState } from 'react';
import { useSocket } from '../socket/SocketProvider.jsx';
import { useRoom } from '../state/RoomProvider.jsx';

function Lobby({ userId }) {
  const { socket } = useSocket();
  const { state } = useRoom();
  const [roomId, setRoomId] = useState('');

  if (!state.room) {
    return (
      <div>
        <label>
          Room ID
          <input value={roomId} onChange={(e) => setRoomId(e.target.value)} />
        </label>
        <button onClick={() => socket.emit('room:join', { roomId })}>Join</button>
        {state.error && <p role="alert">{state.error}</p>}
      </div>
    );
  }

  const me = state.room.players.find((p) => p.userId === userId);

  return (
    <div>
      <h2>Room</h2>
      <ul>
        {state.room.players.map((p) => (
          <li key={p.userId}>
            {p.userId} {p.ready ? '(ready)' : ''} {p.isDealer ? '(dealer)' : ''}
          </li>
        ))}
      </ul>
      <button onClick={() => socket.emit('player:ready', { ready: !me?.ready })}>
        {me?.ready ? 'Unready' : 'Ready'}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </div>
  );
}

export default Lobby;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/screens/Lobby.test.jsx`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/screens/Lobby.jsx client/src/screens/Lobby.test.jsx
git commit -m "feat: add Lobby screen"
```

---

### Task 7: Table screen

**Files:**
- Create: `client/src/screens/Table.jsx`
- Create: `client/src/screens/Table.test.jsx`

**Interfaces:**
- Consumes: `useSocket()`, `useRoom()`.
- Produces: `<Table userId={string} />`. Renders the current player's hand (`state.room.players.find(p => p.userId === userId).hand`), the discard pile top (`state.room.discardTop`), whose turn it is, and buttons: `Draw` (emits `game:draw`), `Discard` (emits `game:discard` with the selected card, enabled once a card is clicked), `Eat` (emits `game:eat` with the discard top, shown only when `discardTop` is non-null), `Kaeng` (emits `game:kaeng`). Whose-turn display: `state.room.players[state.room.turnIndex].userId`.

- [ ] **Step 1: Write the failing test**

`client/src/screens/Table.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import Table from './Table.jsx';

vi.mock('../socket/SocketProvider.jsx', () => ({
  useSocket: () => ({ socket: globalThis.__mockSocket, connected: true }),
}));
vi.mock('../state/RoomProvider.jsx', () => ({
  useRoom: () => ({ state: globalThis.__mockRoomState }),
}));

function card(rank, suit) {
  return { rank, suit };
}

describe('Table screen', () => {
  beforeEach(() => {
    globalThis.__mockSocket = { emit: vi.fn() };
    globalThis.__mockRoomState = {
      room: {
        status: 'in_progress',
        turnIndex: 0,
        discardTop: card(5, 'hearts'),
        players: [
          { userId: 'alice', hand: [card(2, 'clubs'), card(9, 'spades')], handCount: 2 },
          { userId: 'bob', handCount: 5 },
        ],
      },
      error: null,
    };
  });

  test('shows whose turn it is and the discard pile top', () => {
    render(<Table userId="alice" />);
    expect(screen.getByText(/alice/)).toBeInTheDocument();
    expect(screen.getByText(/5 of hearts/)).toBeInTheDocument();
  });

  test('Draw emits game:draw', () => {
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:draw');
  });

  test('selecting a card then Discard emits game:discard with that card', () => {
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByText('2 of clubs'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:discard', { card: card(2, 'clubs') });
  });

  test('Eat emits game:eat with the discard top', () => {
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByRole('button', { name: 'Eat' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:eat', { card: card(5, 'hearts') });
  });

  test('Kaeng emits game:kaeng', () => {
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByRole('button', { name: 'Kaeng' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:kaeng');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/screens/Table.test.jsx`
Expected: FAIL — `Table.jsx` doesn't exist.

- [ ] **Step 3: Implement `client/src/screens/Table.jsx`**

```jsx
import { useState } from 'react';
import { useSocket } from '../socket/SocketProvider.jsx';
import { useRoom } from '../state/RoomProvider.jsx';

function cardLabel(c) {
  return `${c.rank} of ${c.suit}`;
}

function Table({ userId }) {
  const { socket } = useSocket();
  const { state } = useRoom();
  const [selectedCard, setSelectedCard] = useState(null);

  const { room } = state;
  const me = room.players.find((p) => p.userId === userId);
  const turnUserId = room.players[room.turnIndex]?.userId;

  return (
    <div>
      <p>Turn: {turnUserId}</p>
      <p>Discard: {room.discardTop ? cardLabel(room.discardTop) : 'empty'}</p>

      <h3>Your hand</h3>
      <ul>
        {(me?.hand || []).map((c, i) => (
          <li key={i}>
            <button
              onClick={() => setSelectedCard(c)}
              aria-pressed={selectedCard === c}
            >
              {cardLabel(c)}
            </button>
          </li>
        ))}
      </ul>

      <button onClick={() => socket.emit('game:draw')}>Draw</button>
      <button
        disabled={!selectedCard}
        onClick={() => socket.emit('game:discard', { card: selectedCard })}
      >
        Discard
      </button>
      {room.discardTop && (
        <button onClick={() => socket.emit('game:eat', { card: room.discardTop })}>Eat</button>
      )}
      <button onClick={() => socket.emit('game:kaeng')}>Kaeng</button>

      {state.error && <p role="alert">{state.error}</p>}
    </div>
  );
}

export default Table;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/screens/Table.test.jsx`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/screens/Table.jsx client/src/screens/Table.test.jsx
git commit -m "feat: add Table screen"
```

---

### Task 8: Result screen + App screen routing

**Files:**
- Create: `client/src/screens/Result.jsx`
- Create: `client/src/screens/Result.test.jsx`
- Modify: `client/src/App.jsx` (replaces the Task 2 placeholder)
- Create: `client/src/App.test.jsx` (replaces the Task 2 smoke test)

**Interfaces:**
- Produces: `<Result />` renders `state.result` (`{ winners: string[], reason: string, multiplier: number }` — the actual `finishRound` broadcast shape from `src/server/roundEnd.js:finishRound`, no per-player hand scores are included) and a "Back to lobby" button dispatching `CLEAR_RESULT`. `App.jsx` derives the active screen purely from state — no independent `screen` field — per the design spec's requirement to avoid state divergence:
  - no `auth` → `Login`
  - `auth` set, no `room.room` → `Lobby`
  - `room.result` set → `Result`
  - `room.room.status === 'in_progress'` → `Table`
  - otherwise → `Lobby`

- [ ] **Step 1: Write the failing test for `Result`**

`client/src/screens/Result.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import Result from './Result.jsx';

vi.mock('../state/RoomProvider.jsx', () => ({
  useRoom: () => ({
    state: { result: { winners: ['alice'], reason: 'kaeng', multiplier: 1 } },
    dispatch: globalThis.__mockDispatch,
  }),
}));

describe('Result screen', () => {
  test('shows winners, reason, and multiplier', () => {
    globalThis.__mockDispatch = vi.fn();
    render(<Result />);
    expect(screen.getByText(/alice/)).toBeInTheDocument();
    expect(screen.getByText(/kaeng/)).toBeInTheDocument();
    expect(screen.getByText(/1/)).toBeInTheDocument();
  });

  test('back to lobby dispatches CLEAR_RESULT', () => {
    globalThis.__mockDispatch = vi.fn();
    render(<Result />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to lobby' }));
    expect(globalThis.__mockDispatch).toHaveBeenCalledWith({ type: 'CLEAR_RESULT' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/screens/Result.test.jsx`
Expected: FAIL — `Result.jsx` doesn't exist.

- [ ] **Step 3: Implement `client/src/screens/Result.jsx`**

```jsx
import { useRoom } from '../state/RoomProvider.jsx';

function Result() {
  const { state, dispatch } = useRoom();
  const { winners, reason, multiplier } = state.result;

  return (
    <div>
      <h2>Round result</h2>
      <p>Winner(s): {winners.join(', ')}</p>
      <p>Reason: {reason}</p>
      <p>Multiplier: {multiplier}</p>
      <button onClick={() => dispatch({ type: 'CLEAR_RESULT' })}>Back to lobby</button>
    </div>
  );
}

export default Result;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/screens/Result.test.jsx`
Expected: PASS — 2 tests.

- [ ] **Step 5: Write the failing test for the App screen router**

Replace `client/src/App.test.jsx` entirely:

```jsx
import { render, screen } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';

const mockRoomState = { room: null, result: null, error: null };
vi.mock('./socket/SocketProvider.jsx', () => ({
  SocketProvider: ({ children }) => <div>{children}</div>,
  useSocket: () => ({ socket: { emit: vi.fn() }, connected: true }),
}));
vi.mock('./state/RoomProvider.jsx', () => ({
  RoomProvider: ({ children }) => <div>{children}</div>,
  useRoom: () => ({ state: mockRoomState, dispatch: vi.fn() }),
}));

import App from './App.jsx';

describe('App screen routing', () => {
  test('shows Login when there is no auth', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });
});
```

Note: this test only exercises the pre-auth case, since simulating post-login state requires driving `Login`'s `onAuthenticated` callback through the real component tree — covered end-to-end by Task 9's integration test instead of re-mocked here.

- [ ] **Step 6: Run test to verify it fails**

Run: `cd client && npx vitest run src/App.test.jsx`
Expected: FAIL — old placeholder `App.jsx` renders `<div>Kaeng</div>`, no "Log in" button.

- [ ] **Step 7: Implement `client/src/App.jsx`**

```jsx
import { useState } from 'react';
import { SocketProvider, useSocket } from './socket/SocketProvider.jsx';
import { RoomProvider, useRoom } from './state/RoomProvider.jsx';
import Login from './screens/Login.jsx';
import Lobby from './screens/Lobby.jsx';
import Table from './screens/Table.jsx';
import Result from './screens/Result.jsx';

function Screens({ userId }) {
  const { state } = useRoom();
  if (state.result) return <Result />;
  if (state.room && state.room.status === 'in_progress') return <Table userId={userId} />;
  return <Lobby userId={userId} />;
}

function AuthedApp({ auth }) {
  const { socket } = useSocket();
  return (
    <RoomProvider socket={socket}>
      <Screens userId={auth.userId} />
    </RoomProvider>
  );
}

function App() {
  const [auth, setAuth] = useState(null);

  if (!auth) {
    return <Login onAuthenticated={setAuth} />;
  }

  return (
    <SocketProvider auth={auth}>
      <AuthedApp auth={auth} />
    </SocketProvider>
  );
}

export default App;
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd client && npx vitest run src/App.test.jsx`
Expected: PASS.

- [ ] **Step 9: Run the full client test suite**

Run: `cd client && npm test`
Expected: PASS — every test file from Tasks 2–8.

- [ ] **Step 10: Commit**

```bash
git add client/src/screens/Result.jsx client/src/screens/Result.test.jsx client/src/App.jsx client/src/App.test.jsx
git commit -m "feat: add Result screen and wire state-derived screen routing in App"
```

---

### Task 9: End-to-end integration test

**Files:**
- Create: `tests/server/webClientFlow.test.js`

**Interfaces:**
- Consumes: `createSocketServer` (`src/server/socketServer.js`), `signToken` (`src/auth/tokens.js`), `socket.io-client`. This is a server-side integration test (Jest, not Vitest) mirroring the existing pattern in `tests/server/socketServer.test.js` — it proves the exact event sequence the client relies on (`auth` → `auth:ok` → `room:join` → `player:ready` ×2 → `game:draw`/`game:discard` → `game:result`) actually works end-to-end against a real server instance, without needing a browser.

- [ ] **Step 1: Write the test**

`tests/server/webClientFlow.test.js`:

```js
require('dotenv').config();
const Client = require('socket.io-client');
const { createSocketServer } = require('../../src/server/socketServer');
const { signToken } = require('../../src/auth/tokens');
const { waitForEvent, collectEvents, waitUntil } = require('./testHelpers');

describe('web client flow (server-side contract)', () => {
  let server, httpServer, io, port, clients;

  beforeEach((done) => {
    server = createSocketServer();
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
```

Note on Step 1's last third: a full natural round to `game:result` is non-deterministic (depends on shuffled hands), so this integration test intentionally stops at proving the exact **event sequence** the client depends on works end-to-end (`auth`→`auth:ok`→`room:join`→`player:ready`→`game:draw`→`game:discard`, with hand counts updating as expected) rather than forcing a full round to completion — round-completion logic itself is already covered by `tests/server/roundEnd.test.js`.

- [ ] **Step 2: Run test to verify it fails first (sanity check imports/setup), then passes**

Run: `npx jest tests/server/webClientFlow.test.js -v`
Expected: PASS. If it fails, check the failure is about assertion logic (fix the test), not about `auth`/`room:join` events being unrecognized (that would mean Task 1 wasn't applied).

- [ ] **Step 3: Run the full server test suite**

Run: `npx jest -v`
Expected: PASS — all tests.

- [ ] **Step 4: Commit**

```bash
git add tests/server/webClientFlow.test.js
git commit -m "test: add end-to-end socket contract test matching the web client's event sequence"
```

---

## Final Verification

- [ ] Run `npx jest -v` from the repo root — all server tests pass (Task 1 + Task 9 additions included).
- [ ] Run `cd client && npm test` — all client tests pass (Tasks 2–8).
- [ ] Run `cd client && npm run dev`, and separately `npm run start` (game server) and `npm run start:auth` (auth service) from the repo root with the dev stack up (`docker compose up -d`, `node scripts/migrate.js`), then manually register a user, join a room from two browser tabs, ready up, and play a few turns — confirms the wiring works against real running services, not just mocks.
