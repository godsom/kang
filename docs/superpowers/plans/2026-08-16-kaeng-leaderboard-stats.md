# Kaeng Leaderboard & Stats (Milestone 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every finished round to `match_history`, keep `player_stats` (wins by type, losses, streaks) up to date, and serve a Redis-cached leaderboard — closing out the last milestone in the spec's build order.

**Architecture:** Two new Postgres tables (extending the schema Milestone 4 established), a Redis sorted set for the leaderboard, a pure-ish `src/server/stats.js` module (real Postgres/Redis calls, no business logic duplication), and one integration point in the game server: `finishRound`'s outcome now also gets persisted, and a new `leaderboard:get` socket handler reads the Redis cache.

**Tech Stack:** Node.js (CommonJS), `pg` (already a dependency, reused from Milestone 4's `src/auth/db.js`), `redis` (official Node client, new dependency), Jest, real dockerized Postgres + Redis for tests (this project's established pattern — no mocking of infra).

## Global Constraints

- **`net_profit`/`pot_amount` are recorded as `0` in this milestone — an honest, documented gap, not an oversight.** No real stake/pot amount is computed anywhere in this codebase yet (Milestones 3 and 4 both explicitly deferred wallet integration — the game server still doesn't call the Auth/Wallet service at all). Wiring a real payout amount into round outcomes needs that integration first. The `pot_amount`/`net_profit` columns exist per spec §4.2's schema and are ready for that future work, but this milestone cannot honestly populate them with anything but `0`.
- **The leaderboard tracks win count, not profit, for the same reason.** Spec §5.5's pseudocode keys the sorted set as `leaderboard:profit`; since profit is always `0` here, that would produce a leaderboard where everyone ties at zero — not useful and not honest about what this milestone delivers. This plan uses `leaderboard:wins` instead (one Redis `ZINCRBY` per win), matching `leaderboard:${type}`'s parameterized design from spec §5.5's `getLeaderboard(type, limit)` so a `'profit'` type can be added later without an API change.
- **`player_id`/`match_history.player_id` are plain strings, NOT foreign keys into Milestone 4's `users` table.** The game server's `userId` (Milestones 2-3-5-6) is an unauthenticated, client-supplied string with no relationship to the Auth service's UUID `users.id` — this is already true everywhere in this project and this milestone doesn't change it. Adding an FK here would break for any player who never registered with the auth service (which is everyone, today, since the two services still aren't integrated).
- **Win-type bucketing reuses the existing payout-tier grouping**, not a new classification: `reason === 'tong'` → `wins_tong`; `reason === 'flush'`/`'straight'` → `wins_flush_straight`; everything else (`instant_kaeng`, `split_pot`, `deck_exhausted`) → `wins_instant_kaeng`. This mirrors `src/win.js`'s existing `getPayoutMultiplier` tiering (all three of those reasons already map to the same `instantKaeng` payout multiplier) rather than inventing a new, unrelated grouping.
- **A stats-recording failure must never break the game.** `endRound`'s broadcasts (`game:result`, `room:state`) already happen before stats recording is attempted; recording runs in a `try/catch` that only logs on failure. A database hiccup must not prevent players from seeing their round result.
- **`createSocketServer()` keeps its existing no-argument call signature** (used by 19+ existing tests and `src/server/index.js`) — it now additionally creates a `pool` (reusing `src/auth/db.js`'s generic `createPool`, zero auth-specific coupling) and a Redis client internally, connecting the Redis client lazily on first actual use (not at server startup) so tests that never touch stats/leaderboard incur zero connection overhead. Both are returned alongside the existing `{httpServer, io, roomStore}` so tests that DO exercise stats can clean them up.
- Reuses Milestone 1's `calcHandScore`, Milestone 4's `createPool`/migration pattern (`db/schema.sql`, `scripts/migrate.js`) exactly as already established — no changes to any Milestone 1-6 file's *behavior*, only additive schema/module changes plus the one `endRound`/`leaderboard:get` integration point in `socketServer.js`.

---

## File Structure

- `db/schema.sql` (**modify**) — add `match_history` and `player_stats` tables (idempotent, matching the existing `CREATE TABLE IF NOT EXISTS` style).
- `src/server/redisClient.js` (**new**) — `createRedisClient(url?)`, thin wrapper over the `redis` package's `createClient`.
- `src/server/stats.js` (**new**) — `statsColumnForReason`, `recordMatchHistory`, `updatePlayerStats`, `recordWin`, `getLeaderboard`, `recordRoundOutcome`.
- `src/server/socketServer.js` (**modify**) — `endRound` now also calls `recordRoundOutcome`; new `leaderboard:get` handler; return value gains `pool`/`redisClient`.

---

### Task 1: Schema extension and Redis client

**Files:**
- Modify: `db/schema.sql`
- Modify: `tests/auth/db.test.js`
- Create: `src/server/redisClient.js`
- Test: `tests/server/redisClient.test.js`

**Interfaces:**
- Produces: two new tables (`match_history`, `player_stats`, exact columns below). `createRedisClient(url = process.env.REDIS_URL)` → a `redis` package client instance (NOT auto-connected — the caller must call `.connect()`). Consumed by `src/server/stats.js` (Task 2) and `src/server/socketServer.js` (Task 3).

- [ ] **Step 1: Add the dependency**

```bash
npm install redis
```

- [ ] **Step 2: Extend the schema**

Read `db/schema.sql` first. Add these two tables at the end (after the existing `transactions` table):

```sql
CREATE TABLE IF NOT EXISTS match_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id VARCHAR(100),
  player_id VARCHAR(100) NOT NULL,
  result VARCHAR(10) NOT NULL,
  win_type VARCHAR(20),
  multiplier INT,
  pot_amount NUMERIC DEFAULT 0,
  hand_score INT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS player_stats (
  player_id VARCHAR(100) PRIMARY KEY,
  total_games INT NOT NULL DEFAULT 0,
  wins_instant_kaeng INT NOT NULL DEFAULT 0,
  wins_tong INT NOT NULL DEFAULT 0,
  wins_flush_straight INT NOT NULL DEFAULT 0,
  total_losses INT NOT NULL DEFAULT 0,
  net_profit NUMERIC NOT NULL DEFAULT 0,
  current_streak INT NOT NULL DEFAULT 0,
  best_streak INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

- [ ] **Step 3: Add a test confirming the new tables exist**

Add this test inside the existing `describe('createPool', ...)` block in `tests/auth/db.test.js`, alongside the existing "the migrated schema has the expected tables" test — extend that SAME test's assertion rather than adding a new test, since it already queries `information_schema.tables`:

```javascript
// change the existing assertion from:
//   expect(tableNames).toEqual(expect.arrayContaining(['users', 'wallets', 'transactions']));
// to:
  expect(tableNames).toEqual(expect.arrayContaining(['users', 'wallets', 'transactions', 'match_history', 'player_stats']));
```

- [ ] **Step 4: Apply the migration**

Run: `node scripts/migrate.js`
Expected: `Migration applied.` with no errors (requires `docker compose up -d postgres` if not already running).

- [ ] **Step 5: Run the updated test**

Run: `npx jest tests/auth/db.test.js`
Expected: PASS (2 tests, same count as before — this only changed an existing assertion's expected array, not the test count).

- [ ] **Step 6: Write the failing test for the Redis client**

```javascript
// tests/server/redisClient.test.js
require('dotenv').config();
const { createRedisClient } = require('../../src/server/redisClient');

describe('createRedisClient', () => {
  let client;

  afterEach(async () => {
    if (client && client.isOpen) {
      await client.quit();
    }
  });

  test('connects to the real Redis instance and can round-trip a value', async () => {
    client = createRedisClient();
    await client.connect();
    await client.set('kaeng:test:redisClient', 'ok');
    const value = await client.get('kaeng:test:redisClient');
    expect(value).toBe('ok');
    await client.del('kaeng:test:redisClient');
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx jest tests/server/redisClient.test.js`
Expected: FAIL with "Cannot find module '../../src/server/redisClient'"

- [ ] **Step 8: Write the implementation**

```javascript
// src/server/redisClient.js
const { createClient } = require('redis');

function createRedisClient(url = process.env.REDIS_URL) {
  return createClient({ url });
}

module.exports = { createRedisClient };
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx jest tests/server/redisClient.test.js`
Expected: PASS (1 test) — requires `docker compose up -d redis` if not already running.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json db/schema.sql tests/auth/db.test.js src/server/redisClient.js tests/server/redisClient.test.js
git commit -m "feat: add leaderboard/stats schema and Redis client"
```

---

### Task 2: Stats and leaderboard recording

**Files:**
- Create: `src/server/stats.js`
- Test: `tests/server/stats.test.js`

**Interfaces:**
- Consumes: `calcHandScore` from `src/handScore.js` (Milestone 1); a `pg.Pool` (Task 1's schema, via `src/auth/db.js`'s `createPool`); a connected `redis` client (Task 1's `createRedisClient`).
- Produces: `statsColumnForReason(reason)` → `'wins_tong' | 'wins_flush_straight' | 'wins_instant_kaeng'`. `recordMatchHistory(pool, {roomId, playerId, result, winType, multiplier, handScore})` → inserts one `match_history` row (`pot_amount` always `0`). `updatePlayerStats(pool, playerId, {isWin, winType})` → upserts `player_stats`: increments `total_games` always; increments `statsColumnForReason(winType)` if `isWin`, else `total_losses`; resets `current_streak` to 0 on a loss, increments on a win; `best_streak` tracks the max ever seen. `recordWin(redisClient, playerId)` → `ZINCRBY leaderboard:wins 1 <playerId>`. `getLeaderboard(redisClient, type = 'wins', limit = 100)` → `Promise<{playerId, score}[]>`, highest score first. `recordRoundOutcome(pool, redisClient, room, outcome)` → for every player in `room.players`, records their match history and updates their stats (win or loss based on `outcome.winners.includes(player.userId)`), and calls `recordWin` for each winner. Consumed by `src/server/socketServer.js` (Task 3).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/server/stats.test.js
require('dotenv').config();
const { createPool } = require('../../src/auth/db');
const { createRedisClient } = require('../../src/server/redisClient');
const {
  statsColumnForReason,
  recordMatchHistory,
  updatePlayerStats,
  recordWin,
  getLeaderboard,
  recordRoundOutcome,
} = require('../../src/server/stats');

const c = (rank, suit) => ({ rank, suit });

describe('stats', () => {
  let pool;
  let redisClient;

  beforeAll(async () => {
    pool = createPool();
    redisClient = createRedisClient();
    await redisClient.connect();
  });

  afterAll(async () => {
    await pool.end();
    await redisClient.quit();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE match_history, player_stats RESTART IDENTITY CASCADE');
    await redisClient.del('leaderboard:wins');
  });

  describe('statsColumnForReason', () => {
    test('maps tong, flush/straight, and everything else correctly', () => {
      expect(statsColumnForReason('tong')).toBe('wins_tong');
      expect(statsColumnForReason('flush')).toBe('wins_flush_straight');
      expect(statsColumnForReason('straight')).toBe('wins_flush_straight');
      expect(statsColumnForReason('instant_kaeng')).toBe('wins_instant_kaeng');
      expect(statsColumnForReason('split_pot')).toBe('wins_instant_kaeng');
      expect(statsColumnForReason('deck_exhausted')).toBe('wins_instant_kaeng');
    });
  });

  describe('recordMatchHistory', () => {
    test('inserts a row with pot_amount always 0', async () => {
      await recordMatchHistory(pool, {
        roomId: 'room1', playerId: 'alice', result: 'win', winType: 'tong', multiplier: 2, handScore: 21,
      });
      const result = await pool.query('SELECT * FROM match_history WHERE player_id = $1', ['alice']);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        room_id: 'room1', player_id: 'alice', result: 'win', win_type: 'tong', multiplier: 2, hand_score: 21,
      });
      expect(Number(result.rows[0].pot_amount)).toBe(0);
    });
  });

  describe('updatePlayerStats', () => {
    test('a first win creates the row with the right bucket and streak of 1', async () => {
      await updatePlayerStats(pool, 'alice', { isWin: true, winType: 'tong' });
      const result = await pool.query('SELECT * FROM player_stats WHERE player_id = $1', ['alice']);
      expect(result.rows[0]).toMatchObject({
        total_games: 1, wins_tong: 1, total_losses: 0, current_streak: 1, best_streak: 1,
      });
    });

    test('a loss increments total_games and total_losses, resets current_streak', async () => {
      await updatePlayerStats(pool, 'bob', { isWin: true, winType: 'flush' });
      await updatePlayerStats(pool, 'bob', { isWin: false, winType: null });
      const result = await pool.query('SELECT * FROM player_stats WHERE player_id = $1', ['bob']);
      expect(result.rows[0]).toMatchObject({
        total_games: 2, wins_flush_straight: 1, total_losses: 1, current_streak: 0, best_streak: 1,
      });
    });

    test('best_streak tracks the maximum even after the streak later resets', async () => {
      await updatePlayerStats(pool, 'carol', { isWin: true, winType: 'tong' });
      await updatePlayerStats(pool, 'carol', { isWin: true, winType: 'tong' });
      await updatePlayerStats(pool, 'carol', { isWin: false, winType: null });
      const result = await pool.query('SELECT * FROM player_stats WHERE player_id = $1', ['carol']);
      expect(result.rows[0]).toMatchObject({ current_streak: 0, best_streak: 2 });
    });
  });

  describe('recordWin / getLeaderboard', () => {
    test('leaderboard ranks players by win count, highest first', async () => {
      await recordWin(redisClient, 'alice');
      await recordWin(redisClient, 'alice');
      await recordWin(redisClient, 'bob');
      const leaderboard = await getLeaderboard(redisClient, 'wins', 10);
      expect(leaderboard).toEqual([
        { playerId: 'alice', score: 2 },
        { playerId: 'bob', score: 1 },
      ]);
    });
  });

  describe('recordRoundOutcome', () => {
    test('records match history and stats for every player, and a leaderboard win for the winner', async () => {
      const room = {
        id: 'room1',
        players: [
          { userId: 'alice', hand: [c('7', 'spades'), c('7', 'hearts'), c('7', 'clubs')] },
          { userId: 'bob', hand: [c('K', 'spades'), c('Q', 'hearts')] },
        ],
      };
      const outcome = { winners: ['alice'], reason: 'tong', multiplier: 2 };

      await recordRoundOutcome(pool, redisClient, room, outcome);

      const history = await pool.query('SELECT player_id, result, win_type FROM match_history ORDER BY player_id');
      expect(history.rows).toEqual([
        { player_id: 'alice', result: 'win', win_type: 'tong' },
        { player_id: 'bob', result: 'lose', win_type: null },
      ]);

      const aliceStats = await pool.query('SELECT wins_tong, total_games FROM player_stats WHERE player_id = $1', ['alice']);
      expect(aliceStats.rows[0]).toMatchObject({ wins_tong: 1, total_games: 1 });
      const bobStats = await pool.query('SELECT total_losses, total_games FROM player_stats WHERE player_id = $1', ['bob']);
      expect(bobStats.rows[0]).toMatchObject({ total_losses: 1, total_games: 1 });

      const leaderboard = await getLeaderboard(redisClient, 'wins', 10);
      expect(leaderboard).toEqual([{ playerId: 'alice', score: 1 }]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/server/stats.test.js`
Expected: FAIL with "Cannot find module '../../src/server/stats'"

- [ ] **Step 3: Write the implementation**

```javascript
// src/server/stats.js
const { calcHandScore } = require('../handScore');

function statsColumnForReason(reason) {
  if (reason === 'tong') return 'wins_tong';
  if (reason === 'flush' || reason === 'straight') return 'wins_flush_straight';
  return 'wins_instant_kaeng';
}

async function recordMatchHistory(pool, { roomId, playerId, result, winType, multiplier, handScore }) {
  await pool.query(
    `INSERT INTO match_history (room_id, player_id, result, win_type, multiplier, pot_amount, hand_score)
     VALUES ($1, $2, $3, $4, $5, 0, $6)`,
    [roomId, playerId, result, winType, multiplier, handScore]
  );
}

async function updatePlayerStats(pool, playerId, { isWin, winType }) {
  const column = isWin ? statsColumnForReason(winType) : 'total_losses';
  const allowed = ['wins_instant_kaeng', 'wins_tong', 'wins_flush_straight', 'total_losses'];
  if (!allowed.includes(column)) {
    throw new Error(`Invalid stats column: ${column}`);
  }
  await pool.query(
    `INSERT INTO player_stats (player_id, total_games, ${column}, current_streak, best_streak, updated_at)
     VALUES ($1, 1, 1, $2, $2, NOW())
     ON CONFLICT (player_id) DO UPDATE SET
       total_games = player_stats.total_games + 1,
       ${column} = player_stats.${column} + 1,
       current_streak = CASE WHEN $3 THEN player_stats.current_streak + 1 ELSE 0 END,
       best_streak = GREATEST(player_stats.best_streak, CASE WHEN $3 THEN player_stats.current_streak + 1 ELSE 0 END),
       updated_at = NOW()`,
    [playerId, isWin ? 1 : 0, isWin]
  );
}

async function recordWin(redisClient, playerId) {
  await redisClient.zIncrBy('leaderboard:wins', 1, playerId);
}

async function getLeaderboard(redisClient, type = 'wins', limit = 100) {
  const raw = await redisClient.zRangeWithScores(`leaderboard:${type}`, 0, limit - 1, { REV: true });
  return raw.map(({ value, score }) => ({ playerId: value, score }));
}

async function recordRoundOutcome(pool, redisClient, room, outcome) {
  const { winners, reason, multiplier } = outcome;
  for (const player of room.players) {
    const isWin = winners.includes(player.userId);
    const handScore = calcHandScore(player.hand);
    await recordMatchHistory(pool, {
      roomId: room.id,
      playerId: player.userId,
      result: isWin ? 'win' : 'lose',
      winType: isWin ? reason : null,
      multiplier: isWin ? multiplier : null,
      handScore,
    });
    await updatePlayerStats(pool, player.userId, { isWin, winType: reason });
    if (isWin) {
      await recordWin(redisClient, player.userId);
    }
  }
}

module.exports = {
  statsColumnForReason,
  recordMatchHistory,
  updatePlayerStats,
  recordWin,
  getLeaderboard,
  recordRoundOutcome,
};
```

If the installed `redis` package's actual method names for `ZINCRBY`/`ZRANGE ... REV WITHSCORES` differ from `zIncrBy`/`zRangeWithScores` shown here (client library APIs do drift between versions), check the installed package's type definitions or README and adapt — but keep the exact same function signatures and return shapes the tests above check for.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/server/stats.test.js`
Expected: PASS (1 + 1 + 3 + 1 + 1 = 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/stats.js tests/server/stats.test.js
git commit -m "feat: add match history, player stats, and leaderboard recording"
```

---

### Task 3: Socket wiring — persist round outcomes, serve the leaderboard

**Files:**
- Modify: `src/server/socketServer.js`
- Modify: `tests/server/socketServer.test.js`
- Modify: `tests/server/testHelpers.js`

**Interfaces:**
- Consumes: `recordRoundOutcome`, `getLeaderboard` from `src/server/stats.js` (Task 2); `createRedisClient` from `src/server/redisClient.js` (Task 1); `createPool` from `src/auth/db.js` (Milestone 4).
- Produces: `createSocketServer()` (unchanged call signature) now also creates `pool` and `redisClient` internally and returns them (`{httpServer, io, roomStore, pool, redisClient}`). `endRound(room, result)` (existing internal helper) now also calls `recordRoundOutcome` in a `try/catch` after broadcasting, connecting the Redis client lazily on first use (a cached connect-promise, not reconnecting on every round). New `leaderboard:get` handler (client→server, `{type, limit}`): connects Redis lazily if needed, calls `getLeaderboard`, emits `leaderboard:result {type, entries}` to the caller; on failure, emits `leaderboard:error {message: 'Failed to fetch leaderboard'}`.

- [ ] **Step 1: Write the failing tests**

Read `tests/server/socketServer.test.js` first. Find the shared `afterEach` hook (used by every test in the file) and extend it to also close the pool/redis client:

```javascript
// change the existing afterEach from:
//   afterEach((done) => {
//     clients.forEach(c => c.close());
//     io.close();
//     httpServer.close(done);
//   });
// to:
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
```

You'll also need to update the `beforeEach` that currently destructures `({ httpServer, io } = createSocketServer())` to capture the full return value (e.g. `server = createSocketServer(); ({ httpServer, io } = server);`) so `afterEach` can reach `server.pool`/`server.redisClient` — read the existing `beforeEach` first and adapt it minimally; declare `let server;` alongside the existing `let httpServer, io, port, clients;` declaration.

Then add these tests to the end of the `describe('socketServer', ...)` block:

```javascript
test('a finished round is persisted to match history and the winner appears on the leaderboard', async () => {
  const alice = connectClient();
  const bob = connectClient();
  await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);

  const aliceStates = collectEvents(alice, 'room:state');
  const bobStates = collectEvents(bob, 'room:state');

  alice.emit('room:join', { roomId: 'stats-room-1', userId: 'stats-alice' });
  await waitUntil(() => aliceStates.length >= 1);
  bob.emit('room:join', { roomId: 'stats-room-1', userId: 'stats-bob' });
  await waitUntil(() => bobStates.length >= 1);

  alice.emit('player:ready', { ready: true });
  bob.emit('player:ready', { ready: true });
  await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'in_progress');

  // Stack the active player's hand with a guaranteed-winning instant-kaeng hand.
  const dealtState = aliceStates[aliceStates.length - 1];
  const activeUserId = dealtState.players[dealtState.turnIndex].userId;
  const activeClient = activeUserId === 'stats-alice' ? alice : bob;
  const room = server.roomStore.get('stats-room-1');
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

  const history = await server.pool.query('SELECT result, win_type FROM match_history WHERE player_id = $1', [activeUserId]);
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
```

**`waitUntil` needs a small, backward-compatible fix first.** Read `tests/server/testHelpers.js` — its current `waitUntil` calls `conditionFn()` and checks the return value with a bare `if (conditionFn())`. A Promise object is always truthy, so passing an async condition function (as the test above does) would incorrectly resolve on the very first check, before the database write actually lands — this is a real bug, not a style nit. Fix `waitUntil` to `await` its condition:

```javascript
// tests/server/testHelpers.js — change waitUntil to:
function waitUntil(conditionFn, { timeout = 2000, interval = 20 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = async () => {
      if (await conditionFn()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('waitUntil timed out'));
      setTimeout(check, interval);
    };
    check();
  });
}
```

This is backward-compatible: every existing call site passes a synchronous function returning a boolean, and `await`ing a non-Promise value just resolves to that same value immediately — none of the 15+ existing `waitUntil` call sites across `tests/server/*.test.js` change behavior. Make this change, then the async `match_history` polling test above will work correctly.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/server/socketServer.test.js -t "match history|leaderboard:get"`
Expected: FAIL — no `leaderboard:get` handler exists yet and `recordRoundOutcome` isn't wired into `endRound`, so these tests time out or find no rows.

- [ ] **Step 3: Write the implementation**

Read `src/server/socketServer.js` first. Add to the requires:

```javascript
const { createPool } = require('../auth/db');
const { createRedisClient } = require('./redisClient');
const { recordRoundOutcome, getLeaderboard } = require('./stats');
```

Inside `createSocketServer()`, alongside the existing `const roomStore = createRoomStore();`:

```javascript
  const pool = createPool();
  const redisClient = createRedisClient();
  let redisConnectPromise = null;

  function ensureRedisConnected() {
    if (!redisConnectPromise) {
      redisConnectPromise = redisClient.connect();
    }
    return redisConnectPromise;
  }
```

Update `endRound`:

```javascript
  async function endRound(room, result) {
    const outcome = finishRound(room, result);
    broadcastGameResult(room, outcome);
    broadcastRoomState(room);
    try {
      await ensureRedisConnected();
      await recordRoundOutcome(pool, redisClient, room, outcome);
    } catch (err) {
      console.error('Failed to record round outcome:', err.message);
    }
  }
```

Add the new handler inside `io.on('connection', (socket) => { ... })`:

```javascript
    socket.on('leaderboard:get', async ({ type, limit }) => {
      try {
        await ensureRedisConnected();
        const entries = await getLeaderboard(redisClient, type, limit);
        socket.emit('leaderboard:result', { type: type || 'wins', entries });
      } catch (err) {
        socket.emit('leaderboard:error', { message: 'Failed to fetch leaderboard' });
      }
    });
```

Update the function's return statement:

```javascript
  return { httpServer, io, roomStore, pool, redisClient };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/server/socketServer.test.js`
Expected: PASS, all tests in the file. Read the actual `Tests:` count from the run rather than hand-computing — this plan's own arithmetic has been wrong in nearly every prior milestone's plan.

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: PASS. This milestone adds: db.test.js (no new test, 1 assertion changed) + redisClient.test.js (1) + stats.test.js (7) + socketServer.test.js (2 new) = 10 new tests on top of Milestone 6's 174, i.e. 184 total. Cross-check against the real `Tests: N passed, N total` line.

- [ ] **Step 6: Verify the game server actually boots with the new dependencies**

Run: `npm run start` in the background briefly, confirm "Kaeng game server listening on port ..." with no error (this proves `createPool`/`createRedisClient` being called eagerly at server construction doesn't itself require a live connection — only actual use does), then stop it.

- [ ] **Step 7: Commit**

```bash
git add src/server/socketServer.js tests/server/socketServer.test.js tests/server/testHelpers.js
git commit -m "feat: persist round outcomes to stats and serve the leaderboard over sockets"
```

---

## Self-Review Notes

- **Spec coverage:** §4.2 `match_history`/`player_stats` tables → Task 1. §5.5 `updatePlayerStats`/`getLeaderboard` pseudocode → Task 2's `updatePlayerStats`/`getLeaderboard`, adapted per the documented `net_profit`-is-always-0 and `leaderboard:wins`-not-`profit` constraints. §6 `leaderboard:get` event → Task 3. §8 ("Leaderboard ควร cache ผ่าน Redis ไม่ query PostgreSQL สดทุกครั้ง" — leaderboard reads must go through Redis, never live Postgres) → `getLeaderboard` reads exclusively from Redis's sorted set, never queries `player_stats` directly for ranking. This is the last milestone in spec §7's build order; §7.8 ("Anti-cheat audit pass") is a process/audit step, not a code deliverable, and out of scope for this plan.
- **Placeholder scan:** No TBD/TODO markers. The `net_profit`/`pot_amount`-always-0 decision is a documented, deliberate scope boundary (explained in Global Constraints and in the code's own data), not a placeholder standing in for missing work.
- **Type consistency:** `playerId`/`player.userId` is the same loose string identifier used throughout Milestones 2-6 — no new identity model introduced. `outcome` (`{winners, reason, multiplier}`) is exactly `finishRound`'s existing return shape from Milestone 3 — `recordRoundOutcome` consumes it as-is, no reshaping. Redis sorted-set entries (`{playerId, score}`) match `getLeaderboard`'s own return shape consistently between `stats.js` and the `leaderboard:result` socket payload.
