# Kaeng Core Game Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, server-side core game engine for the "แคง" (Kaeng) card game — deck management, dealing, hand scoring, meld validation, win/payout resolution, and turn-direction logic — as unit-tested, networking-free modules per `kaeng-game-spec.md`.

**Architecture:** A set of small CommonJS modules under `src/`, each with one responsibility (config, deck, hand score, meld validation, dealing, turn order, win resolution). No I/O, no Socket.io, no DB — these modules will later be called by the game server (Milestone 2, separate plan). All functions are pure and take/return plain objects (`Card { suit, rank }`, `Player`-shaped objects with `userId` and `hand`), matching the shapes in spec §4.1.

**Tech Stack:** Node.js (CommonJS), Jest for testing.

## Global Constraints

- Single 52-card deck, no jokers (spec §2.1).
- Hand size is always 5 cards regardless of player count (spec §2.1, `GAME_CONFIG.HAND_SIZE`).
- A is always low (value 1) for scoring/comparison purposes — no high-A value case (spec §2.2).
- Meld validation, shuffle, and hand scoring must be pure/deterministic functions with no client trust assumptions — this is what makes them safe to later run server-side only (spec §8).
- Straight requires same suit and consecutive ranks; A may sit at the low end (A-2-3-4-5) or high end (10-J-Q-K-A), but wraparound (K-A-2-3-4) is invalid (spec §2.3).
- Config values must match `GAME_CONFIG` in spec §3 exactly (key names, thresholds, payout multipliers).
- **Instant kaeng ("แคงด่วน") eligibility is per-card, not a hand total, and only valid on the first turn:** a player is eligible only if the kaeng is declared on the game's first turn AND every card in their hand has `RANK_VALUE < INSTANT_KAENG_THRESHOLD` (i.e. no single card is worth 8 or more). This overrides the naive reading of spec §2.7 ("แต้มรวม < 8"); see the corrected rule in spec §2.2. "First turn" means the initial dealt hand of `HAND_SIZE` (5) cards, evaluated before any draw — `checkKaengWin` trusts the caller to pass the correct pre-draw hand and `isFirstTurn` flag; it does not itself validate hand length.

---

## File Structure

- `package.json` — project manifest, Jest as the only dependency.
- `src/config.js` — `GAME_CONFIG`, `VOICE_CONFIG`, `SPECTATOR_CONFIG` constants (spec §3).
- `src/deck.js` — `SUITS`, `RANKS`, `buildDeck`, `shuffle`, `drawCard`.
- `src/handScore.js` — `calcHandScore`.
- `src/meld.js` — `RANK_ORDER`, `MELD_PRIORITY`, `isTong`, `isFlush`, `isStraight`, `validateMeld`.
- `src/dealing.js` — `dealCards`, `determineFirstDealer`.
- `src/turn.js` — `getNextTurn` (direction-aware turn cursor for `alternating` / `one_way`).
- `src/win.js` — `checkKaengWin`, `checkMeldBasedWin`, `resolveMeldWin`, `resolveTie`, `getPayoutMultiplier`.

Each module has a matching test file under `tests/` (e.g. `tests/deck.test.js`).

---

### Task 1: Project scaffold + config constants

**Files:**
- Create: `package.json`
- Create: `src/config.js`
- Test: `tests/config.test.js`

**Interfaces:**
- Produces: `GAME_CONFIG` (object with `MIN_PLAYERS`, `MAX_PLAYERS`, `HAND_SIZE`, `DECK_COUNT`, `INSTANT_KAENG_THRESHOLD`, `DIRECTION: {ALTERNATING, ONE_WAY}`, `EAT_MODE: {CHAIN, SEQUENTIAL}`, `RANK_VALUE`, `PAYOUT: {instantKaeng, tong, flushOrStraight}`), `VOICE_CONFIG`, `SPECTATOR_CONFIG` — all consumed by every later task.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "kaeng-game-engine",
  "version": "0.1.0",
  "private": true,
  "description": "Core game engine for the Kaeng multiplayer card game",
  "main": "src/index.js",
  "scripts": {
    "test": "jest"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` written, no errors.

- [ ] **Step 3: Write the failing test**

```javascript
// tests/config.test.js
const { GAME_CONFIG, VOICE_CONFIG, SPECTATOR_CONFIG } = require('../src/config');

describe('GAME_CONFIG', () => {
  test('has correct player and hand limits', () => {
    expect(GAME_CONFIG.MIN_PLAYERS).toBe(2);
    expect(GAME_CONFIG.MAX_PLAYERS).toBe(5);
    expect(GAME_CONFIG.HAND_SIZE).toBe(5);
    expect(GAME_CONFIG.DECK_COUNT).toBe(1);
    expect(GAME_CONFIG.INSTANT_KAENG_THRESHOLD).toBe(8);
  });

  test('has direction and eat mode enums', () => {
    expect(GAME_CONFIG.DIRECTION).toEqual({ ALTERNATING: 'alternating', ONE_WAY: 'one_way' });
    expect(GAME_CONFIG.EAT_MODE).toEqual({ CHAIN: 'chain_eat', SEQUENTIAL: 'sequential_beat' });
  });

  test('has correct rank values with A always low and face cards at 10', () => {
    expect(GAME_CONFIG.RANK_VALUE.A).toBe(1);
    expect(GAME_CONFIG.RANK_VALUE['10']).toBe(10);
    expect(GAME_CONFIG.RANK_VALUE.J).toBe(10);
    expect(GAME_CONFIG.RANK_VALUE.Q).toBe(10);
    expect(GAME_CONFIG.RANK_VALUE.K).toBe(10);
  });

  test('has correct payout multipliers', () => {
    expect(GAME_CONFIG.PAYOUT).toEqual({ instantKaeng: 1, tong: 2, flushOrStraight: 3 });
  });
});

describe('VOICE_CONFIG', () => {
  test('has livekit provider and player-only publishing', () => {
    expect(VOICE_CONFIG.provider).toBe('livekit');
    expect(VOICE_CONFIG.maxPublishers).toBe(5);
    expect(VOICE_CONFIG.spectatorMode).toBe('subscribe_only');
  });
});

describe('SPECTATOR_CONFIG', () => {
  test('spectators cannot see hands', () => {
    expect(SPECTATOR_CONFIG.canSeeHands).toBe(false);
    expect(SPECTATOR_CONFIG.maxPerRoom).toBe(50);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest tests/config.test.js`
Expected: FAIL with "Cannot find module '../src/config'"

- [ ] **Step 5: Write the implementation**

```javascript
// src/config.js
const GAME_CONFIG = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 5,
  HAND_SIZE: 5,
  DECK_COUNT: 1,
  INSTANT_KAENG_THRESHOLD: 8,
  DIRECTION: { ALTERNATING: 'alternating', ONE_WAY: 'one_way' },
  EAT_MODE: { CHAIN: 'chain_eat', SEQUENTIAL: 'sequential_beat' },
  RANK_VALUE: {
    A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
    J: 10, Q: 10, K: 10,
  },
  PAYOUT: { instantKaeng: 1, tong: 2, flushOrStraight: 3 },
};

const VOICE_CONFIG = {
  provider: 'livekit',
  maxPublishers: 5,
  spectatorMode: 'subscribe_only',
  pushToTalk: false,
};

const SPECTATOR_CONFIG = {
  maxPerRoom: 50,
  canSeeHands: false,
  canChat: true,
  canHearVoice: true,
};

module.exports = { GAME_CONFIG, VOICE_CONFIG, SPECTATOR_CONFIG };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/config.test.js`
Expected: PASS (4 + 1 + 1 = 6 tests)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/config.js tests/config.test.js
git commit -m "feat: add project scaffold and GAME_CONFIG constants"
```

---

### Task 2: Deck — build, shuffle, draw

**Files:**
- Create: `src/deck.js`
- Test: `tests/deck.test.js`

**Interfaces:**
- Consumes: `GAME_CONFIG` from `src/config.js` (Task 1).
- Produces: `SUITS` (array of 4 strings), `RANKS` (array of 13 strings, `'A'` through `'K'`), `buildDeck(deckCount?)` → `Card[]` where `Card = { suit, rank }`, `shuffle(deck, rng?)` → new shuffled `Card[]` (does not mutate input), `drawCard(deck)` → `Card` (mutates `deck` by removing the last card; throws on empty deck). Consumed by `src/dealing.js` (Task 5).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/deck.test.js
const { SUITS, RANKS, buildDeck, shuffle, drawCard } = require('../src/deck');

describe('buildDeck', () => {
  test('builds a standard 52-card deck with no duplicates', () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(52);
    const keys = new Set(deck.map(c => `${c.suit}-${c.rank}`));
    expect(keys.size).toBe(52);
  });

  test('contains all 4 suits and 13 ranks', () => {
    const deck = buildDeck();
    expect(new Set(deck.map(c => c.suit)).size).toBe(4);
    expect(new Set(deck.map(c => c.rank)).size).toBe(13);
    expect(SUITS).toHaveLength(4);
    expect(RANKS).toHaveLength(13);
  });

  test('scales with deckCount', () => {
    expect(buildDeck(2)).toHaveLength(104);
  });
});

describe('shuffle', () => {
  test('preserves length and card multiset without mutating input', () => {
    const deck = buildDeck();
    const original = [...deck];
    const shuffled = shuffle(deck);
    expect(shuffled).toHaveLength(52);
    expect(deck).toEqual(original); // input untouched
    const sortKey = c => `${c.suit}-${c.rank}`;
    expect(shuffled.map(sortKey).sort()).toEqual(original.map(sortKey).sort());
  });

  test('is deterministic given a fixed rng (Fisher-Yates with rng always 0)', () => {
    const deck = [{ suit: 's', rank: '1' }, { suit: 's', rank: '2' }, { suit: 's', rank: '3' }];
    const rng = () => 0;
    // Fisher-Yates from i=2..1 with rng=0 always swaps index i with index 0
    // i=2: swap(2,0) -> [3,2,1]; i=1: swap(1,0) -> [2,3,1]
    const result = shuffle(deck, rng);
    expect(result.map(c => c.rank)).toEqual(['2', '3', '1']);
  });
});

describe('drawCard', () => {
  test('removes and returns the last card, mutating the deck', () => {
    const deck = [{ suit: 's', rank: 'A' }, { suit: 'h', rank: 'K' }];
    const card = drawCard(deck);
    expect(card).toEqual({ suit: 'h', rank: 'K' });
    expect(deck).toHaveLength(1);
  });

  test('throws when the deck is empty', () => {
    expect(() => drawCard([])).toThrow('Cannot draw from an empty deck');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/deck.test.js`
Expected: FAIL with "Cannot find module '../src/deck'"

- [ ] **Step 3: Write the implementation**

```javascript
// src/deck.js
const { GAME_CONFIG } = require('./config');

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function buildDeck(deckCount = GAME_CONFIG.DECK_COUNT) {
  const deck = [];
  for (let i = 0; i < deckCount; i++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank });
      }
    }
  }
  return deck;
}

function shuffle(deck, rng = Math.random) {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function drawCard(deck) {
  if (deck.length === 0) {
    throw new Error('Cannot draw from an empty deck');
  }
  return deck.pop();
}

module.exports = { SUITS, RANKS, buildDeck, shuffle, drawCard };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/deck.test.js`
Expected: PASS (3 + 2 + 2 = 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/deck.js tests/deck.test.js
git commit -m "feat: add deck build/shuffle/draw"
```

---

### Task 3: Hand scoring

**Files:**
- Create: `src/handScore.js`
- Test: `tests/handScore.test.js`

**Interfaces:**
- Consumes: `GAME_CONFIG.RANK_VALUE` from `src/config.js` (Task 1).
- Produces: `calcHandScore(hand)` → `number`, where `hand` is `Card[]`. Consumed by `src/win.js` (Task 7).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/handScore.test.js
const { calcHandScore } = require('../src/handScore');

describe('calcHandScore', () => {
  test('sums face-value ranks', () => {
    const hand = [{ suit: 's', rank: '2' }, { suit: 'h', rank: '5' }, { suit: 'd', rank: '9' }];
    expect(calcHandScore(hand)).toBe(16);
  });

  test('treats A as 1', () => {
    const hand = [{ suit: 's', rank: 'A' }, { suit: 'h', rank: 'A' }];
    expect(calcHandScore(hand)).toBe(2);
  });

  test('treats J, Q, K as 10', () => {
    const hand = [{ suit: 's', rank: 'J' }, { suit: 'h', rank: 'Q' }, { suit: 'd', rank: 'K' }];
    expect(calcHandScore(hand)).toBe(30);
  });

  test('returns 0 for an empty hand', () => {
    expect(calcHandScore([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/handScore.test.js`
Expected: FAIL with "Cannot find module '../src/handScore'"

- [ ] **Step 3: Write the implementation**

```javascript
// src/handScore.js
const { GAME_CONFIG } = require('./config');

function calcHandScore(hand) {
  return hand.reduce((sum, card) => sum + GAME_CONFIG.RANK_VALUE[card.rank], 0);
}

module.exports = { calcHandScore };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/handScore.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/handScore.js tests/handScore.test.js
git commit -m "feat: add hand score calculation"
```

---

### Task 4: Meld validation

**Files:**
- Create: `src/meld.js`
- Test: `tests/meld.test.js`

**Interfaces:**
- Consumes: nothing (self-contained rank ordering).
- Produces: `RANK_ORDER` (object, `A: 1` through `K: 13`, A always low), `MELD_PRIORITY` (object, `{ tong: 3, straight: 2, flush: 1 }`), `isTong(cards)` → `boolean`, `isFlush(cards)` → `boolean`, `isStraight(cards)` → `boolean`, `validateMeld(cards)` → `{ valid: boolean, type: 'tong'|'straight'|'flush'|null }`. Consumed by `src/win.js` (Task 7).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/meld.test.js
const { isTong, isFlush, isStraight, validateMeld, MELD_PRIORITY, RANK_ORDER } = require('../src/meld');

const c = (rank, suit) => ({ rank, suit });

describe('isTong', () => {
  test('true for 3 same rank, different suits', () => {
    expect(isTong([c('7', 's'), c('7', 'h'), c('7', 'd')])).toBe(true);
  });

  test('true for 4 same rank', () => {
    expect(isTong([c('7', 's'), c('7', 'h'), c('7', 'd'), c('7', 'c')])).toBe(true);
  });

  test('false for 2 or 5 cards, or mismatched ranks', () => {
    expect(isTong([c('7', 's'), c('7', 'h')])).toBe(false);
    expect(isTong([c('7', 's'), c('7', 'h'), c('8', 'd')])).toBe(false);
  });
});

describe('isFlush', () => {
  test('true for 5 same-suit cards, any ranks', () => {
    expect(isFlush([c('2', 's'), c('5', 's'), c('9', 's'), c('K', 's'), c('A', 's')])).toBe(true);
  });

  test('false if suits differ or length != 5', () => {
    expect(isFlush([c('2', 's'), c('5', 'h'), c('9', 's'), c('K', 's'), c('A', 's')])).toBe(false);
    expect(isFlush([c('2', 's'), c('5', 's')])).toBe(false);
  });
});

describe('isStraight', () => {
  test('true for a same-suit sequential run', () => {
    expect(isStraight([c('5', 's'), c('6', 's'), c('7', 's'), c('8', 's'), c('9', 's')])).toBe(true);
  });

  test('true for ace-low (A-2-3-4-5)', () => {
    expect(isStraight([c('A', 'h'), c('2', 'h'), c('3', 'h'), c('4', 'h'), c('5', 'h')])).toBe(true);
  });

  test('true for ace-high (10-J-Q-K-A)', () => {
    expect(isStraight([c('10', 'd'), c('J', 'd'), c('Q', 'd'), c('K', 'd'), c('A', 'd')])).toBe(true);
  });

  test('false for wraparound (K-A-2-3-4)', () => {
    expect(isStraight([c('K', 'c'), c('A', 'c'), c('2', 'c'), c('3', 'c'), c('4', 'c')])).toBe(false);
  });

  test('false if suits differ', () => {
    expect(isStraight([c('5', 's'), c('6', 'h'), c('7', 's'), c('8', 's'), c('9', 's')])).toBe(false);
  });
});

describe('validateMeld', () => {
  test('classifies tong', () => {
    expect(validateMeld([c('7', 's'), c('7', 'h'), c('7', 'd')])).toEqual({ valid: true, type: 'tong' });
  });

  test('classifies straight over flush when both suit-uniform and sequential', () => {
    expect(validateMeld([c('5', 's'), c('6', 's'), c('7', 's'), c('8', 's'), c('9', 's')]))
      .toEqual({ valid: true, type: 'straight' });
  });

  test('classifies flush when same-suit but not sequential', () => {
    expect(validateMeld([c('2', 's'), c('5', 's'), c('9', 's'), c('K', 's'), c('A', 's')]))
      .toEqual({ valid: true, type: 'flush' });
  });

  test('invalid for a non-meld hand', () => {
    expect(validateMeld([c('2', 's'), c('5', 'h'), c('9', 'd'), c('K', 'c'), c('3', 's')]))
      .toEqual({ valid: false, type: null });
  });
});

describe('MELD_PRIORITY and RANK_ORDER', () => {
  test('tong outranks straight outranks flush', () => {
    expect(MELD_PRIORITY.tong).toBeGreaterThan(MELD_PRIORITY.straight);
    expect(MELD_PRIORITY.straight).toBeGreaterThan(MELD_PRIORITY.flush);
  });

  test('RANK_ORDER keeps A low and orders face cards J < Q < K', () => {
    expect(RANK_ORDER.A).toBe(1);
    expect(RANK_ORDER.J).toBeLessThan(RANK_ORDER.Q);
    expect(RANK_ORDER.Q).toBeLessThan(RANK_ORDER.K);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/meld.test.js`
Expected: FAIL with "Cannot find module '../src/meld'"

- [ ] **Step 3: Write the implementation**

```javascript
// src/meld.js
const RANK_ORDER = {
  A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
  J: 11, Q: 12, K: 13,
};

const MELD_PRIORITY = { tong: 3, straight: 2, flush: 1 };

function sameRank(cards) {
  return cards.every(card => card.rank === cards[0].rank);
}

function sameSuit(cards) {
  return cards.every(card => card.suit === cards[0].suit);
}

function isTong(cards) {
  return (cards.length === 3 || cards.length === 4) && sameRank(cards);
}

function isFlush(cards) {
  return cards.length === 5 && sameSuit(cards);
}

function isSequential(orders) {
  const sorted = [...orders].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  }
  return true;
}

function isStraight(cards) {
  if (cards.length !== 5 || !sameSuit(cards)) return false;

  const orders = cards.map(card => RANK_ORDER[card.rank]);
  if (isSequential(orders)) return true;

  if (orders.includes(1)) {
    const aceHighOrders = orders.map(order => (order === 1 ? 14 : order));
    if (isSequential(aceHighOrders)) return true;
  }

  return false;
}

function validateMeld(cards) {
  if (isTong(cards)) return { valid: true, type: 'tong' };
  if (isStraight(cards)) return { valid: true, type: 'straight' };
  if (isFlush(cards)) return { valid: true, type: 'flush' };
  return { valid: false, type: null };
}

module.exports = { RANK_ORDER, MELD_PRIORITY, isTong, isFlush, isStraight, validateMeld };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/meld.test.js`
Expected: PASS (3 + 2 + 5 + 4 + 2 = 16 tests)

- [ ] **Step 5: Commit**

```bash
git add src/meld.js tests/meld.test.js
git commit -m "feat: add meld validation (tong, flush, straight)"
```

---

### Task 5: Dealing and first-dealer determination

**Files:**
- Create: `src/dealing.js`
- Test: `tests/dealing.test.js`

**Interfaces:**
- Consumes: `GAME_CONFIG` from `src/config.js` (Task 1), `drawCard` from `src/deck.js` (Task 2).
- Produces: `dealCards(players, deck, handSize?)` → mutates each `player.hand` in place to a `Card[]` of length `handSize` (default `GAME_CONFIG.HAND_SIZE`), drawing round-robin from `deck` (top of deck = end of array, matching `drawCard`'s `pop()`); returns `players`. `determineFirstDealer(players, deck)` → `userId` of the player who drew the lowest `GAME_CONFIG.RANK_VALUE` card, drawing exactly one card per player from `deck`. `players` here is `{ userId, hand? }[]`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/dealing.test.js
const { dealCards, determineFirstDealer } = require('../src/dealing');

describe('dealCards', () => {
  test('deals HAND_SIZE cards to every player regardless of player count', () => {
    const deck = Array.from({ length: 30 }, (_, i) => ({ suit: 's', rank: '2', id: i }));
    const players = [{ userId: 'p1' }, { userId: 'p2' }, { userId: 'p3' }];
    dealCards(players, deck);
    players.forEach(p => expect(p.hand).toHaveLength(5));
  });

  test('respects a custom hand size and removes dealt cards from the deck', () => {
    const deck = Array.from({ length: 10 }, (_, i) => ({ suit: 's', rank: '2', id: i }));
    const players = [{ userId: 'p1' }, { userId: 'p2' }];
    dealCards(players, deck, 3);
    expect(players[0].hand).toHaveLength(3);
    expect(players[1].hand).toHaveLength(3);
    expect(deck).toHaveLength(4);
  });
});

describe('determineFirstDealer', () => {
  test('returns the userId of the player who drew the lowest-value card', () => {
    // drawCard pops from the end, so build the deck so p1 gets K, p2 gets A
    const deck = [{ suit: 's', rank: 'K' }, { suit: 'h', rank: 'A' }];
    const players = [{ userId: 'p1' }, { userId: 'p2' }];
    expect(determineFirstDealer(players, deck)).toBe('p2');
  });

  test('consumes exactly one card per player from the deck', () => {
    const deck = [{ suit: 's', rank: '5' }, { suit: 'h', rank: '2' }, { suit: 'd', rank: '9' }];
    const players = [{ userId: 'p1' }, { userId: 'p2' }];
    determineFirstDealer(players, deck);
    expect(deck).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/dealing.test.js`
Expected: FAIL with "Cannot find module '../src/dealing'"

- [ ] **Step 3: Write the implementation**

```javascript
// src/dealing.js
const { GAME_CONFIG } = require('./config');
const { drawCard } = require('./deck');

function dealCards(players, deck, handSize = GAME_CONFIG.HAND_SIZE) {
  players.forEach(player => { player.hand = []; });
  for (let i = 0; i < handSize; i++) {
    players.forEach(player => { player.hand.push(drawCard(deck)); });
  }
  return players;
}

function determineFirstDealer(players, deck) {
  const draws = players.map(player => ({ userId: player.userId, card: drawCard(deck) }));
  const lowest = draws.reduce((min, draw) =>
    GAME_CONFIG.RANK_VALUE[draw.card.rank] < GAME_CONFIG.RANK_VALUE[min.card.rank] ? draw : min
  );
  return lowest.userId;
}

module.exports = { dealCards, determineFirstDealer };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/dealing.test.js`
Expected: PASS (2 + 2 = 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/dealing.js tests/dealing.test.js
git commit -m "feat: add dealing and first-dealer determination"
```

---

### Task 6: Turn-direction cursor

**Files:**
- Create: `src/turn.js`
- Test: `tests/turn.test.js`

**Interfaces:**
- Consumes: `GAME_CONFIG.DIRECTION` from `src/config.js` (Task 1).
- Produces: `getNextTurn(turnIndex, directionSign, playerCount, direction)` → `{ turnIndex: number, directionSign: 1|-1 }`. For `GAME_CONFIG.DIRECTION.ONE_WAY`, advances `turnIndex` forward and wraps to `0`; `directionSign` is always returned as `1`. For `GAME_CONFIG.DIRECTION.ALTERNATING`, bounces `turnIndex` back and forth between `0` and `playerCount - 1` (e.g. for 4 players: `0,1,2,3,2,1,0,1,2,...`), flipping `directionSign` at each end. This will be consumed by the game server's turn loop (Milestone 2, separate plan).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/turn.test.js
const { getNextTurn } = require('../src/turn');
const { GAME_CONFIG } = require('../src/config');

describe('getNextTurn — one_way', () => {
  test('advances forward and wraps around', () => {
    let state = { turnIndex: 0, directionSign: 1 };
    const seq = [];
    for (let i = 0; i < 5; i++) {
      state = getNextTurn(state.turnIndex, state.directionSign, 3, GAME_CONFIG.DIRECTION.ONE_WAY);
      seq.push(state.turnIndex);
    }
    expect(seq).toEqual([1, 2, 0, 1, 2]);
  });
});

describe('getNextTurn — alternating', () => {
  test('bounces back and forth between 0 and playerCount - 1', () => {
    let state = { turnIndex: 0, directionSign: 1 };
    const seq = [];
    for (let i = 0; i < 8; i++) {
      state = getNextTurn(state.turnIndex, state.directionSign, 4, GAME_CONFIG.DIRECTION.ALTERNATING);
      seq.push(state.turnIndex);
    }
    expect(seq).toEqual([1, 2, 3, 2, 1, 0, 1, 2]);
  });

  test('works for the minimum table size of 2 players', () => {
    let state = { turnIndex: 0, directionSign: 1 };
    const seq = [];
    for (let i = 0; i < 4; i++) {
      state = getNextTurn(state.turnIndex, state.directionSign, 2, GAME_CONFIG.DIRECTION.ALTERNATING);
      seq.push(state.turnIndex);
    }
    expect(seq).toEqual([1, 0, 1, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/turn.test.js`
Expected: FAIL with "Cannot find module '../src/turn'"

- [ ] **Step 3: Write the implementation**

```javascript
// src/turn.js
const { GAME_CONFIG } = require('./config');

function getNextTurn(turnIndex, directionSign, playerCount, direction) {
  if (direction === GAME_CONFIG.DIRECTION.ONE_WAY) {
    return { turnIndex: (turnIndex + 1) % playerCount, directionSign: 1 };
  }

  let nextIndex = turnIndex + directionSign;
  let nextSign = directionSign;
  if (nextIndex >= playerCount || nextIndex < 0) {
    nextSign = -directionSign;
    nextIndex = turnIndex + nextSign;
  }
  return { turnIndex: nextIndex, directionSign: nextSign };
}

module.exports = { getNextTurn };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/turn.test.js`
Expected: PASS (1 + 2 = 3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/turn.js tests/turn.test.js
git commit -m "feat: add direction-aware turn cursor"
```

---

### Task 7: Win resolution and payout

**Files:**
- Create: `src/win.js`
- Test: `tests/win.test.js`

**Interfaces:**
- Consumes: `GAME_CONFIG` from `src/config.js` (Task 1), `calcHandScore` from `src/handScore.js` (Task 3), `validateMeld`/`MELD_PRIORITY`/`RANK_ORDER` from `src/meld.js` (Task 4).
- Produces:
  - `checkKaengWin(players, isFirstTurn)` → `{ winners: userId[], reason: string } | null`, where `players` is `{ userId, hand, declaredKaeng }[]` and `isFirstTurn` is a `boolean`. Mutates each claimant with a `handScore` field as a side effect (matches spec §5.3 pseudocode). A claimant is instant-kaeng eligible only if `isFirstTurn` is `true` AND every card in their hand has `RANK_VALUE < GAME_CONFIG.INSTANT_KAENG_THRESHOLD` (no single card worth 8+ — not a hand-total check). Returns `null` if no one declared kaeng, or if declared but no claimant is either instant-kaeng eligible or holding a valid meld (invalid declaration).
  - `checkMeldBasedWin(claimants)` → `{ winners: userId[], reason: 'tong'|'straight'|'flush' } | null`.
  - `resolveMeldWin(claimants)` → `{ winners: userId[], reason: string }`, where `claimants` is `{ playerId, valid, type, meldCards }[]` (as produced internally from `validateMeld` output plus `playerId`/`meldCards`).
  - `resolveTie(winners)` → `{ winners: userId[], reason: string }`, where `winners` is `{ userId, hand, handScore }[]`.
  - `getPayoutMultiplier(reason)` → `number`, per `GAME_CONFIG.PAYOUT` (`instant_kaeng`/`instant_kaeng_lowest`/`split_pot` → `instantKaeng`; `tong` → `tong`; `flush`/`straight` → `flushOrStraight`); throws on an unrecognized reason.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/win.test.js
const { checkKaengWin, resolveMeldWin, getPayoutMultiplier } = require('../src/win');

const c = (rank, suit) => ({ rank, suit });
const player = (userId, hand, declaredKaeng = false) => ({ userId, hand, declaredKaeng });

describe('checkKaengWin', () => {
  test('returns null if nobody declared kaeng', () => {
    const players = [player('p1', [c('2', 's'), c('3', 'h')], false)];
    expect(checkKaengWin(players, true)).toBeNull();
  });

  test('single eligible claimant (every card < 8, first turn) wins instantly', () => {
    const players = [
      player('p1', [c('A', 's'), c('A', 'h'), c('2', 'd'), c('2', 'c'), c('7', 'd')], true), // all cards < 8
      player('p2', [c('2', 's'), c('3', 'h'), c('A', 'd'), c('A', 'c'), c('9', 's')], false), // has a 9, and didn't declare
    ];
    const result = checkKaengWin(players, true);
    expect(result).toEqual({ winners: ['p1'], reason: 'instant_kaeng' });
  });

  test('a claimant with any single card worth 8+ is not eligible, even with a low total', () => {
    const players = [
      // total = 1+1+1+1+8 = 12, but the 8 disqualifies this hand card-by-card
      player('p1', [c('A', 's'), c('A', 'h'), c('A', 'd'), c('A', 'c'), c('8', 's')], true),
    ];
    expect(checkKaengWin(players, true)).toBeNull();
  });

  test('not eligible on any turn after the first, even if all cards are < 8', () => {
    const players = [
      player('p1', [c('A', 's'), c('A', 'h'), c('2', 'd'), c('2', 'c'), c('7', 'd')], true),
    ];
    expect(checkKaengWin(players, false)).toBeNull();
  });

  test('two eligible claimants, lowest total score wins', () => {
    const players = [
      player('p1', [c('A', 's'), c('A', 'h'), c('2', 'd'), c('2', 'c'), c('2', 's')], true), // 1+1+2+2+2=8, all cards < 8
      player('p2', [c('A', 's'), c('A', 'h'), c('A', 'd'), c('2', 'c'), c('2', 's')], true), // 1+1+1+2+2=7, all cards < 8
    ];
    const result = checkKaengWin(players, true);
    expect(result).toEqual({ winners: ['p2'], reason: 'instant_kaeng' });
  });

  test('tie on lowest score with no meld splits the pot', () => {
    const players = [
      player('p1', [c('A', 's'), c('2', 'h'), c('2', 'd'), c('A', 'c'), c('A', 'h')], true), // 1+2+2+1+1=7
      player('p2', [c('A', 'd'), c('2', 's'), c('2', 'c'), c('A', 'h'), c('A', 'c')], true), // 7, no meld
    ];
    const result = checkKaengWin(players, true);
    expect(result.reason).toBe('split_pot');
    expect(result.winners.sort()).toEqual(['p1', 'p2']);
  });

  test('falls back to meld comparison when no claimant is instant-kaeng eligible', () => {
    const players = [
      player('p1', [c('9', 's'), c('9', 'h'), c('9', 'd')], true), // tong, has a 9 (>= 8), not instant-eligible
      player('p2', [c('K', 'c'), c('K', 'd'), c('K', 's')], true), // tong, has Ks (>= 8), not instant-eligible, higher rank
    ];
    const result = checkKaengWin(players, true);
    expect(result).toEqual({ winners: ['p2'], reason: 'tong' });
  });

  test('returns null for an invalid declaration (not eligible, no meld)', () => {
    const players = [player('p1', [c('K', 's'), c('Q', 'h'), c('J', 'd'), c('9', 'c'), c('8', 's')], true)];
    expect(checkKaengWin(players, true)).toBeNull();
  });
});

describe('resolveMeldWin', () => {
  test('tong beats flush', () => {
    const claimants = [
      { playerId: 'p1', valid: true, type: 'flush', meldCards: [c('2', 's'), c('5', 's'), c('9', 's'), c('K', 's'), c('A', 's')] },
      { playerId: 'p2', valid: true, type: 'tong', meldCards: [c('3', 'h'), c('3', 'd'), c('3', 'c')] },
    ];
    expect(resolveMeldWin(claimants)).toEqual({ winners: ['p2'], reason: 'tong' });
  });

  test('same meld type breaks tie by highest card', () => {
    const claimants = [
      { playerId: 'p1', valid: true, type: 'flush', meldCards: [c('2', 's'), c('5', 's'), c('9', 's'), c('K', 's'), c('7', 's')] },
      { playerId: 'p2', valid: true, type: 'flush', meldCards: [c('2', 'h'), c('5', 'h'), c('9', 'h'), c('A', 'h'), c('7', 'h')] },
    ];
    // both have K/A as top card by face value, but A is always low (RANK_ORDER.A = 1) -> p1's K wins
    expect(resolveMeldWin(claimants)).toEqual({ winners: ['p1'], reason: 'flush' });
  });
});

describe('getPayoutMultiplier', () => {
  test('maps reasons to configured multipliers', () => {
    expect(getPayoutMultiplier('instant_kaeng')).toBe(1);
    expect(getPayoutMultiplier('instant_kaeng_lowest')).toBe(1);
    expect(getPayoutMultiplier('split_pot')).toBe(1);
    expect(getPayoutMultiplier('tong')).toBe(2);
    expect(getPayoutMultiplier('flush')).toBe(3);
    expect(getPayoutMultiplier('straight')).toBe(3);
  });

  test('throws on an unknown reason', () => {
    expect(() => getPayoutMultiplier('nonsense')).toThrow('Unknown win reason: nonsense');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/win.test.js`
Expected: FAIL with "Cannot find module '../src/win'"

- [ ] **Step 3: Write the implementation**

```javascript
// src/win.js
const { GAME_CONFIG } = require('./config');
const { calcHandScore } = require('./handScore');
const { validateMeld, MELD_PRIORITY, RANK_ORDER } = require('./meld');

function getMeldTopCardOrder(cards, type) {
  if (type === 'tong') return RANK_ORDER[cards[0].rank];
  return Math.max(...cards.map(card => RANK_ORDER[card.rank]));
}

function toMeldClaimants(players) {
  return players
    .map(player => ({ playerId: player.userId, ...validateMeld(player.hand), meldCards: player.hand }))
    .filter(claimant => claimant.valid);
}

function resolveMeldWin(claimants) {
  const maxPriority = Math.max(...claimants.map(c => MELD_PRIORITY[c.type]));
  const topTier = claimants.filter(c => MELD_PRIORITY[c.type] === maxPriority);

  const maxOrder = Math.max(...topTier.map(c => getMeldTopCardOrder(c.meldCards, c.type)));
  const winners = topTier.filter(c => getMeldTopCardOrder(c.meldCards, c.type) === maxOrder);

  return { winners: winners.map(w => w.playerId), reason: winners[0].type };
}

function checkMeldBasedWin(claimants) {
  const meldClaimants = toMeldClaimants(claimants);
  if (meldClaimants.length === 0) return null;
  return resolveMeldWin(meldClaimants);
}

function resolveTie(winners) {
  const meldClaimants = toMeldClaimants(winners);
  if (meldClaimants.length > 0) return resolveMeldWin(meldClaimants);
  return { winners: winners.map(p => p.userId), reason: 'split_pot' };
}

function isInstantKaengEligible(player) {
  return player.hand.every(card => GAME_CONFIG.RANK_VALUE[card.rank] < GAME_CONFIG.INSTANT_KAENG_THRESHOLD);
}

function checkKaengWin(players, isFirstTurn) {
  const claimants = players.filter(p => p.declaredKaeng);
  if (claimants.length === 0) return null;

  claimants.forEach(p => { p.handScore = calcHandScore(p.hand); });
  const eligible = isFirstTurn ? claimants.filter(isInstantKaengEligible) : [];

  if (eligible.length === 0) return checkMeldBasedWin(claimants);
  if (eligible.length === 1) return { winners: [eligible[0].userId], reason: 'instant_kaeng' };

  const minScore = Math.min(...eligible.map(p => p.handScore));
  const winners = eligible.filter(p => p.handScore === minScore);
  return winners.length === 1
    ? { winners: [winners[0].userId], reason: 'instant_kaeng' }
    : resolveTie(winners);
}

function getPayoutMultiplier(reason) {
  const { PAYOUT } = GAME_CONFIG;
  if (reason === 'instant_kaeng' || reason === 'instant_kaeng_lowest' || reason === 'split_pot') {
    return PAYOUT.instantKaeng;
  }
  if (reason === 'tong') return PAYOUT.tong;
  if (reason === 'flush' || reason === 'straight') return PAYOUT.flushOrStraight;
  throw new Error(`Unknown win reason: ${reason}`);
}

module.exports = { checkKaengWin, checkMeldBasedWin, resolveMeldWin, resolveTie, getPayoutMultiplier };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/win.test.js`
Expected: PASS (8 + 2 + 2 = 12 tests)

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: PASS, all 7 test files, 48 tests total.

- [ ] **Step 6: Commit**

```bash
git add src/win.js tests/win.test.js
git commit -m "feat: add kaeng win resolution and payout multiplier"
```

---

## Self-Review Notes

- **Spec coverage:** §2.1 (hand size 5 regardless of player count) → Task 5. §2.2 (rank values, A always low) → Task 1, Task 3. §2.3 (meld types, wraparound rule) → Task 4. §2.4 (first dealer) → Task 5. §2.5/§2.1 (direction/eat mode enums, alternating vs one_way) → Task 1 (config), Task 6 (turn cursor); eat-mode discard/eat state machine is explicitly deferred to the Milestone 2 (game server) plan since it requires room/discard-pile state. §2.7 (payout multipliers) → Task 7. §3 (all config constants) → Task 1. §5.1–§5.3 pseudocode → Tasks 5–7, matching function names and behavior. §5.4 (state broadcast) and §5.5 (stats/leaderboard) are server/DB concerns, out of scope for this engine-only plan — deferred to later milestones.
- **Placeholder scan:** No TBD/TODO markers; every step has runnable code.
- **Type consistency:** `userId` is the consistent player identifier across `dealing.js`, `win.js` inputs/outputs (matches spec §4.1 `Player { userId, ... }`). `Card { suit, rank }` shape is consistent across `deck.js`, `meld.js`, `handScore.js`, `win.js`.
