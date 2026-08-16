# Kaeng Wallet/Auth Service (Milestone 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone Auth/Wallet REST service (spec §1: "Auth/Wallet Service (REST, PostgreSQL)") — user registration/login with JWT tokens, and a transaction-safe internal wallet ledger (balance + transaction history), running as its own process on its own port, backed by the real dockerized Postgres.

**Architecture:** A small Express app (`src/auth/server.js`) over three pure-ish data-access modules (`users.js`, `tokens.js`, `wallet.js`) that take a `pg` connection pool as an explicit parameter (no module-level singleton pool, for testability). Tests run against the real dockerized Postgres (`docker-compose.yml`'s `postgres` service) — no mocking of the database, matching this project's established "integration tests against real I/O" approach from the Socket.io game server.

**Tech Stack:** Node.js (CommonJS), Express, `pg` (PostgreSQL client), `bcryptjs` (password hashing — pure JS, no native build step), `jsonwebtoken` (JWT), `supertest` (dev dependency, HTTP integration tests), Jest.

## Global Constraints

- **This is an internal ledger only — no real payment processing.** `POST /wallet/adjust` directly credits/debits a user's balance; there is no payment gateway, KYC, or real-money rail integration anywhere in this milestone. Wiring a real payment processor is explicitly out of scope and would need its own dedicated design (compliance, fraud, chargebacks) — not attempted here. `/wallet/adjust` exists so the wallet ledger is testable and usable by other services (e.g. a future settlement step after `game:result`), not as a consumer-facing deposit/withdraw feature.
- **Balance can never go negative.** `adjustBalance` runs the balance update and the transaction-history insert in a single Postgres transaction (`BEGIN`/`COMMIT`/`ROLLBACK`); if the resulting balance would be negative, the whole transaction rolls back (no balance change, no transaction-history row) and the caller gets an error.
- **Password hashing uses `bcryptjs`**, not native `bcrypt` — avoids a native compile step in CI/dev environments, at a minor performance cost that's irrelevant at this project's scale.
- **This service is its own process** (`src/auth/index.js`, listens on `process.env.AUTH_PORT`), separate from the Socket.io game server (`src/server/index.js`) — matching the spec's architecture diagram. It shares this repo's `package.json`/`node_modules` (a pragmatic single-package layout, not a full workspace/monorepo) but runs independently at runtime.
- **No integration with the Socket.io game server in this milestone.** The game server currently trusts a client-supplied `userId` with no verification (Milestone 2). Wiring the game server to require/verify a JWT issued by this service is a natural follow-up, explicitly deferred — this milestone only builds the auth/wallet service itself.
- **Schema additions beyond spec §4.2.** The spec's `transactions` table is used as-is (`id, user_id, room_id, amount, type, created_at`). The spec doesn't define a `users` table (it assumes user identity exists elsewhere) — this milestone adds one (`id, username, password_hash, created_at`) plus a `wallets` table (`user_id, balance, updated_at`, one row per user, created automatically at registration) since nothing in the spec provides these and auth cannot function without them.
- **Tests run against the real dockerized Postgres**, not an in-memory substitute — `DATABASE_URL` (from `.env`) must point at the `docker-compose.yml` `postgres` service. Each test file truncates all three tables in `beforeEach` for isolation; the schema uses `CREATE TABLE IF NOT EXISTS` so re-running migration is idempotent.

---

## File Structure

- `db/schema.sql` — table definitions (`users`, `wallets`, `transactions`), idempotent (`CREATE TABLE IF NOT EXISTS`).
- `scripts/migrate.js` — tiny script that reads `db/schema.sql` and executes it against `DATABASE_URL`.
- `src/auth/db.js` — `createPool(connectionString?)`, thin wrapper over `pg.Pool`.
- `src/auth/users.js` — `createUser(pool, username, password)`, `verifyCredentials(pool, username, password)`.
- `src/auth/tokens.js` — `signToken(user, secret?, expiresIn?)`, `verifyToken(token, secret?)`.
- `src/auth/wallet.js` — `getBalance(pool, userId)`, `adjustBalance(pool, userId, amount, type, roomId?)`.
- `src/auth/server.js` — `createAuthApp(pool)` → Express app with `/register`, `/login`, `/wallet/me`, `/wallet/adjust`.
- `src/auth/index.js` — process entrypoint; not unit-tested directly (thin bootstrap over `createPool`/`createAuthApp`).

Each module (except `index.js`) has a matching test file under `tests/auth/`.

---

### Task 1: Database schema and connection pool

**Files:**
- Create: `db/schema.sql`
- Create: `scripts/migrate.js`
- Create: `src/auth/db.js`
- Test: `tests/auth/db.test.js`

**Interfaces:**
- Produces: `createPool(connectionString = process.env.DATABASE_URL)` → a `pg.Pool` instance. `scripts/migrate.js` is a standalone script (run via `node scripts/migrate.js`), not a module export — it applies `db/schema.sql` to whatever `DATABASE_URL` points at. Consumed by every later task in this plan (each task's tests call `createPool()` and rely on `db/schema.sql` having been applied).

- [ ] **Step 1: Add dependencies**

```bash
npm install pg bcryptjs jsonwebtoken express
npm install --save-dev supertest
```

- [ ] **Step 2: Write the schema**

```sql
-- db/schema.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  balance NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  room_id UUID,
  amount NUMERIC NOT NULL,
  type VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

- [ ] **Step 3: Write the migration script**

```javascript
// scripts/migrate.js
const fs = require('fs');
const path = require('path');
const { createPool } = require('../src/auth/db');

async function migrate() {
  const pool = createPool();
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.end();
  console.log('Migration applied.');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Write the connection pool module**

```javascript
// src/auth/db.js
const { Pool } = require('pg');

function createPool(connectionString = process.env.DATABASE_URL) {
  return new Pool({ connectionString });
}

module.exports = { createPool };
```

- [ ] **Step 5: Apply the migration against the real dockerized Postgres**

Run: `docker compose up -d postgres` (if not already running), then `node scripts/migrate.js`
Expected: `Migration applied.` printed, no errors. (If this fails with a connection error, confirm `.env`'s `DATABASE_URL` matches `docker-compose.yml` and the `postgres` container is healthy: `docker compose ps`.)

- [ ] **Step 6: Write the failing test**

```javascript
// tests/auth/db.test.js
require('dotenv').config();
const { createPool } = require('../../src/auth/db');

describe('createPool', () => {
  let pool;

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test('connects to the real database and can query it', async () => {
    pool = createPool();
    const result = await pool.query('SELECT 1 AS ok');
    expect(result.rows[0].ok).toBe(1);
  });

  test('the migrated schema has the expected tables', async () => {
    const result = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    const tableNames = result.rows.map(r => r.table_name);
    expect(tableNames).toEqual(expect.arrayContaining(['users', 'wallets', 'transactions']));
  });
});
```

You'll need the `dotenv` package to load `.env` in tests: `npm install --save-dev dotenv`.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest tests/auth/db.test.js`
Expected: PASS (2 tests) — requires Postgres running and migrated (Step 5).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json db/schema.sql scripts/migrate.js src/auth/db.js tests/auth/db.test.js
git commit -m "feat: add auth/wallet database schema, migration script, and connection pool"
```

---

### Task 2: User registration and credential verification

**Files:**
- Create: `src/auth/users.js`
- Test: `tests/auth/users.test.js`

**Interfaces:**
- Consumes: `createPool` from `src/auth/db.js` (Task 1).
- Produces: `createUser(pool, username, password)` → `Promise<{id, username, created_at}>` — hashes `password` with `bcryptjs` (10 salt rounds), inserts into `users`, then inserts a `wallets` row for that user with `balance: 0`; rejects (lets the Postgres unique-constraint error propagate, code `'23505'`) if `username` already exists. `verifyCredentials(pool, username, password)` → `Promise<{id, username} | null>` — looks up the user by username, compares the password against the stored hash with `bcryptjs.compare`, returns `null` if the user doesn't exist or the password doesn't match. Consumed by `src/auth/server.js` (Task 5).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/auth/users.test.js
require('dotenv').config();
const { createPool } = require('../../src/auth/db');
const { createUser, verifyCredentials } = require('../../src/auth/users');

describe('users', () => {
  let pool;

  beforeAll(() => {
    pool = createPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE transactions, wallets, users RESTART IDENTITY CASCADE');
  });

  describe('createUser', () => {
    test('creates a user and a zero-balance wallet', async () => {
      const user = await createUser(pool, 'alice', 'hunter2');
      expect(user.username).toBe('alice');
      expect(user.id).toBeDefined();

      const walletResult = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [user.id]);
      expect(Number(walletResult.rows[0].balance)).toBe(0);
    });

    test('does not store the plaintext password', async () => {
      const user = await createUser(pool, 'bob', 'hunter2');
      const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
      expect(result.rows[0].password_hash).not.toBe('hunter2');
    });

    test('rejects a duplicate username', async () => {
      await createUser(pool, 'carol', 'password1');
      await expect(createUser(pool, 'carol', 'password2')).rejects.toMatchObject({ code: '23505' });
    });
  });

  describe('verifyCredentials', () => {
    test('returns the user for correct credentials', async () => {
      await createUser(pool, 'dave', 'correcthorse');
      const result = await verifyCredentials(pool, 'dave', 'correcthorse');
      expect(result).toMatchObject({ username: 'dave' });
    });

    test('returns null for an incorrect password', async () => {
      await createUser(pool, 'erin', 'correcthorse');
      const result = await verifyCredentials(pool, 'erin', 'wrongpassword');
      expect(result).toBeNull();
    });

    test('returns null for an unknown username', async () => {
      const result = await verifyCredentials(pool, 'nobody', 'whatever');
      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/auth/users.test.js`
Expected: FAIL with "Cannot find module '../../src/auth/users'"

- [ ] **Step 3: Write the implementation**

```javascript
// src/auth/users.js
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

async function createUser(pool, username, password) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await pool.query(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
    [username, passwordHash]
  );
  const user = result.rows[0];
  await pool.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0)', [user.id]);
  return user;
}

async function verifyCredentials(pool, username, password) {
  const result = await pool.query(
    'SELECT id, username, password_hash FROM users WHERE username = $1',
    [username]
  );
  if (result.rows.length === 0) {
    return null;
  }
  const user = result.rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return null;
  }
  return { id: user.id, username: user.username };
}

module.exports = { createUser, verifyCredentials };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/auth/users.test.js`
Expected: PASS (3 + 3 = 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/auth/users.js tests/auth/users.test.js
git commit -m "feat: add user registration and credential verification"
```

---

### Task 3: JWT tokens

**Files:**
- Create: `src/auth/tokens.js`
- Test: `tests/auth/tokens.test.js`

**Interfaces:**
- Consumes: `process.env.JWT_SECRET` (default parameter).
- Produces: `signToken(user, secret = process.env.JWT_SECRET, expiresIn = '24h')` → a JWT string encoding `{sub: user.id, username: user.username}`. `verifyToken(token, secret = process.env.JWT_SECRET)` → `{userId, username} | null` — returns `null` (never throws) for an invalid, malformed, expired, or wrong-secret token. Consumed by `src/auth/server.js` (Task 5).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/auth/tokens.test.js
require('dotenv').config();
const { signToken, verifyToken } = require('../../src/auth/tokens');

const user = { id: 'user-123', username: 'alice' };

describe('signToken / verifyToken', () => {
  test('a signed token verifies back to the original user info', () => {
    const token = signToken(user);
    const result = verifyToken(token);
    expect(result).toEqual({ userId: 'user-123', username: 'alice' });
  });

  test('returns null for a malformed token', () => {
    expect(verifyToken('not-a-real-token')).toBeNull();
  });

  test('returns null for a token signed with a different secret', () => {
    const token = signToken(user, 'a-different-secret');
    expect(verifyToken(token)).toBeNull();
  });

  test('returns null for an expired token', () => {
    const token = signToken(user, process.env.JWT_SECRET, '-10s'); // already expired
    expect(verifyToken(token)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/auth/tokens.test.js`
Expected: FAIL with "Cannot find module '../../src/auth/tokens'"

- [ ] **Step 3: Write the implementation**

```javascript
// src/auth/tokens.js
const jwt = require('jsonwebtoken');

const DEFAULT_EXPIRES_IN = '24h';

function signToken(user, secret = process.env.JWT_SECRET, expiresIn = DEFAULT_EXPIRES_IN) {
  return jwt.sign({ sub: user.id, username: user.username }, secret, { expiresIn });
}

function verifyToken(token, secret = process.env.JWT_SECRET) {
  try {
    const payload = jwt.verify(token, secret);
    return { userId: payload.sub, username: payload.username };
  } catch (err) {
    return null;
  }
}

module.exports = { signToken, verifyToken };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/auth/tokens.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/auth/tokens.js tests/auth/tokens.test.js
git commit -m "feat: add JWT token signing and verification"
```

---

### Task 4: Wallet ledger

**Files:**
- Create: `src/auth/wallet.js`
- Test: `tests/auth/wallet.test.js`

**Interfaces:**
- Consumes: `createPool` from `src/auth/db.js`, `createUser` from `src/auth/users.js` (Task 2, used only in test setup).
- Produces: `getBalance(pool, userId)` → `Promise<number>` — throws `'Wallet not found'` if no wallet row exists for `userId`. `adjustBalance(pool, userId, amount, type, roomId = null)` → `Promise<number>` (the new balance) — runs the balance update and a `transactions` insert in a single DB transaction; throws `'Wallet not found'` if the wallet doesn't exist, or `'Insufficient balance'` if the resulting balance would be negative — in EITHER throw case, the transaction rolls back (no partial state change: balance unchanged, no transaction row inserted). Consumed by `src/auth/server.js` (Task 5).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/auth/wallet.test.js
require('dotenv').config();
const { createPool } = require('../../src/auth/db');
const { createUser } = require('../../src/auth/users');
const { getBalance, adjustBalance } = require('../../src/auth/wallet');

describe('wallet', () => {
  let pool;

  beforeAll(() => {
    pool = createPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE transactions, wallets, users RESTART IDENTITY CASCADE');
  });

  describe('getBalance', () => {
    test('a fresh wallet starts at 0', async () => {
      const user = await createUser(pool, 'alice', 'password1');
      const balance = await getBalance(pool, user.id);
      expect(balance).toBe(0);
    });

    test('throws for an unknown user', async () => {
      await expect(getBalance(pool, '00000000-0000-0000-0000-000000000000')).rejects.toThrow('Wallet not found');
    });
  });

  describe('adjustBalance', () => {
    test('a positive adjustment increases the balance and records a transaction', async () => {
      const user = await createUser(pool, 'bob', 'password1');
      const newBalance = await adjustBalance(pool, user.id, 100, 'deposit');
      expect(newBalance).toBe(100);
      expect(await getBalance(pool, user.id)).toBe(100);

      const txResult = await pool.query('SELECT amount, type FROM transactions WHERE user_id = $1', [user.id]);
      expect(txResult.rows).toHaveLength(1);
      expect(Number(txResult.rows[0].amount)).toBe(100);
      expect(txResult.rows[0].type).toBe('deposit');
    });

    test('a negative adjustment within balance succeeds', async () => {
      const user = await createUser(pool, 'carol', 'password1');
      await adjustBalance(pool, user.id, 100, 'deposit');
      const newBalance = await adjustBalance(pool, user.id, -40, 'payout');
      expect(newBalance).toBe(60);
    });

    test('an adjustment that would go negative is rejected and rolls back completely', async () => {
      const user = await createUser(pool, 'dave', 'password1');
      await adjustBalance(pool, user.id, 50, 'deposit');

      await expect(adjustBalance(pool, user.id, -100, 'payout')).rejects.toThrow('Insufficient balance');

      expect(await getBalance(pool, user.id)).toBe(50); // unchanged
      const txResult = await pool.query('SELECT * FROM transactions WHERE user_id = $1', [user.id]);
      expect(txResult.rows).toHaveLength(1); // only the original deposit, no failed-payout row
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/auth/wallet.test.js`
Expected: FAIL with "Cannot find module '../../src/auth/wallet'"

- [ ] **Step 3: Write the implementation**

```javascript
// src/auth/wallet.js
async function getBalance(pool, userId) {
  const result = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
  if (result.rows.length === 0) {
    throw new Error('Wallet not found');
  }
  return Number(result.rows[0].balance);
}

async function adjustBalance(pool, userId, amount, type, roomId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const walletResult = await client.query(
      'UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2 RETURNING balance',
      [amount, userId]
    );
    if (walletResult.rows.length === 0) {
      throw new Error('Wallet not found');
    }

    const newBalance = Number(walletResult.rows[0].balance);
    if (newBalance < 0) {
      throw new Error('Insufficient balance');
    }

    await client.query(
      'INSERT INTO transactions (user_id, room_id, amount, type) VALUES ($1, $2, $3, $4)',
      [userId, roomId, amount, type]
    );

    await client.query('COMMIT');
    return newBalance;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getBalance, adjustBalance };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/auth/wallet.test.js`
Expected: PASS (2 + 3 = 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/auth/wallet.js tests/auth/wallet.test.js
git commit -m "feat: add transaction-safe wallet ledger"
```

---

### Task 5: Express server wiring

**Files:**
- Create: `src/auth/server.js`
- Create: `src/auth/index.js`
- Test: `tests/auth/server.test.js`

**Interfaces:**
- Consumes: `createUser`, `verifyCredentials` from `src/auth/users.js` (Task 2); `signToken`, `verifyToken` from `src/auth/tokens.js` (Task 3); `getBalance`, `adjustBalance` from `src/auth/wallet.js` (Task 4); `createPool` from `src/auth/db.js` (Task 1).
- Produces: `createAuthApp(pool)` → an Express `app` (not started — the caller calls `.listen()`). Routes:
  - `POST /register` `{username, password}` → `201 {token, user: {id, username}}`; `400` if either field is missing; `409 {message: 'Username already taken'}` on a duplicate username.
  - `POST /login` `{username, password}` → `200 {token, user: {id, username}}`; `400` if either field is missing; `401 {message: 'Invalid username or password'}` on bad credentials.
  - `GET /wallet/me` (requires `Authorization: Bearer <token>`) → `200 {balance}`; `401` if the token is missing/invalid.
  - `POST /wallet/adjust` (requires auth) `{amount, type}` → `200 {balance}`; `400` if `amount`/`type` missing or the adjustment would go negative; `401` if unauthenticated.
  `src/auth/index.js` — process entrypoint, `createPool()` + `createAuthApp(pool).listen(process.env.AUTH_PORT || 4000)`. Not unit-tested directly.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/auth/server.test.js
require('dotenv').config();
const request = require('supertest');
const { createPool } = require('../../src/auth/db');
const { createAuthApp } = require('../../src/auth/server');

describe('auth server', () => {
  let pool;
  let app;

  beforeAll(() => {
    pool = createPool();
    app = createAuthApp(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE transactions, wallets, users RESTART IDENTITY CASCADE');
  });

  describe('POST /register', () => {
    test('registers a new user and returns a token', async () => {
      const res = await request(app).post('/register').send({ username: 'alice', password: 'hunter2' });
      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.username).toBe('alice');
    });

    test('400 when password is missing', async () => {
      const res = await request(app).post('/register').send({ username: 'alice' });
      expect(res.status).toBe(400);
    });

    test('409 on duplicate username', async () => {
      await request(app).post('/register').send({ username: 'bob', password: 'password1' });
      const res = await request(app).post('/register').send({ username: 'bob', password: 'password2' });
      expect(res.status).toBe(409);
    });
  });

  describe('POST /login', () => {
    test('logs in with correct credentials', async () => {
      await request(app).post('/register').send({ username: 'carol', password: 'correcthorse' });
      const res = await request(app).post('/login').send({ username: 'carol', password: 'correcthorse' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
    });

    test('401 on wrong password', async () => {
      await request(app).post('/register').send({ username: 'dave', password: 'correcthorse' });
      const res = await request(app).post('/login').send({ username: 'dave', password: 'wrong' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /wallet/me', () => {
    test('returns the balance for an authenticated user', async () => {
      const registerRes = await request(app).post('/register').send({ username: 'erin', password: 'password1' });
      const res = await request(app).get('/wallet/me').set('Authorization', `Bearer ${registerRes.body.token}`);
      expect(res.status).toBe(200);
      expect(res.body.balance).toBe(0);
    });

    test('401 without a token', async () => {
      const res = await request(app).get('/wallet/me');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /wallet/adjust', () => {
    test('adjusts and returns the new balance', async () => {
      const registerRes = await request(app).post('/register').send({ username: 'frank', password: 'password1' });
      const token = registerRes.body.token;
      const res = await request(app)
        .post('/wallet/adjust')
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: 50, type: 'deposit' });
      expect(res.status).toBe(200);
      expect(res.body.balance).toBe(50);
    });

    test('400 when the adjustment would go negative', async () => {
      const registerRes = await request(app).post('/register').send({ username: 'grace', password: 'password1' });
      const token = registerRes.body.token;
      const res = await request(app)
        .post('/wallet/adjust')
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: -10, type: 'payout' });
      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/auth/server.test.js`
Expected: FAIL with "Cannot find module '../../src/auth/server'"

- [ ] **Step 3: Write the implementation**

```javascript
// src/auth/server.js
const express = require('express');
const { createUser, verifyCredentials } = require('./users');
const { signToken, verifyToken } = require('./tokens');
const { getBalance, adjustBalance } = require('./wallet');

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  req.userId = payload.userId;
  next();
}

function createAuthApp(pool) {
  const app = express();
  app.use(express.json());

  app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'username and password are required' });
    }
    try {
      const user = await createUser(pool, username, password);
      const token = signToken(user);
      res.status(201).json({ token, user: { id: user.id, username: user.username } });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ message: 'Username already taken' });
      }
      res.status(500).json({ message: 'Registration failed' });
    }
  });

  app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'username and password are required' });
    }
    const user = await verifyCredentials(pool, username, password);
    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    const token = signToken(user);
    res.json({ token, user: { id: user.id, username: user.username } });
  });

  app.get('/wallet/me', requireAuth, async (req, res) => {
    const balance = await getBalance(pool, req.userId);
    res.json({ balance });
  });

  app.post('/wallet/adjust', requireAuth, async (req, res) => {
    const { amount, type } = req.body;
    if (typeof amount !== 'number' || !type) {
      return res.status(400).json({ message: 'amount (number) and type are required' });
    }
    try {
      const balance = await adjustBalance(pool, req.userId, amount, type);
      res.json({ balance });
    } catch (err) {
      if (err.message === 'Insufficient balance') {
        return res.status(400).json({ message: 'Insufficient balance' });
      }
      res.status(500).json({ message: 'Adjustment failed' });
    }
  });

  return app;
}

module.exports = { createAuthApp, requireAuth };
```

```javascript
// src/auth/index.js
const { createPool } = require('./db');
const { createAuthApp } = require('./server');

const PORT = process.env.AUTH_PORT || 4000;
const pool = createPool();
const app = createAuthApp(pool);
app.listen(PORT, () => {
  console.log(`Kaeng auth/wallet service listening on port ${PORT}`);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/auth/server.test.js`
Expected: PASS (3 + 2 + 2 + 2 = 9 tests)

- [ ] **Step 5: Add a `start:auth` script and run the full suite**

Add to `package.json`'s `"scripts"`: `"start:auth": "node src/auth/index.js"`, `"migrate": "node scripts/migrate.js"`.

Run: `npx jest`
Expected: PASS. Confirm the exact total from `Tests: N passed, N total` in the output — this milestone adds Task 1 (2) + Task 2 (6) + Task 3 (4) + Task 4 (5) + Task 5 (9) = 26 tests on top of Milestone 3's 121, i.e. 147 total. Cross-check against the real run rather than trusting this arithmetic.

- [ ] **Step 6: Commit**

```bash
git add package.json src/auth/server.js src/auth/index.js tests/auth/server.test.js
git commit -m "feat: wire auth/wallet Express server (register, login, wallet endpoints)"
```

---

## Self-Review Notes

- **Spec coverage:** §1 (separate Auth/Wallet service) → all 5 tasks. §4.2 `transactions` table → Task 1's schema, used exactly as spec'd. §8 ("Wallet/Auth service — แยก service, PostgreSQL transaction-safe") → Task 4's single-DB-transaction `adjustBalance`. `users`/`wallets` tables are a necessary, documented addition beyond spec §4.2 (Global Constraints). Payment-gateway integration, and wiring the game server to require these JWTs, are both explicitly out of scope and documented as deliberate deferrals, not gaps.
- **Placeholder scan:** No TBD/TODO markers. Task 5's Step 5 test-count arithmetic is shown but explicitly flagged to cross-check against real output, per the guardrail established in Milestone 3's plan (which had two such arithmetic slips that didn't affect the actual work, only the plan's own predicted numbers).
- **Type consistency:** `pool` (a `pg.Pool`) is threaded explicitly through every function in `users.js`/`wallet.js`/`server.js` rather than a module-level singleton — consistent across all tasks, and this is what makes each module trivially testable against a real, disposable connection. `user.id` (a UUID string) is the consistent identifier from `createUser` through `signToken`'s `sub` claim through `verifyToken`'s `userId` through `requireAuth`'s `req.userId` through `getBalance`/`adjustBalance`'s `userId` parameter — no renaming or reshaping across the chain.
