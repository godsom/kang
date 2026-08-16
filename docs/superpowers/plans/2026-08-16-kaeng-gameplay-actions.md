# Kaeng Gameplay Actions (Milestone 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `game:draw`, `game:discard`, `game:eat`, and `game:kaeng` socket events into the turn loop deferred from Milestone 2, completing a playable round: draw/discard, the eat mechanic (mode-dependent), kaeng declaration (instant-kaeng and meld-based), deck-exhaustion fallback (lowest score wins), payout multiplier, and dealer rotation to the previous round's winner.

**Architecture:** Two new pure modules over the Milestone 2 `Room`/`Player` shapes (`src/server/turnActions.js` for in-turn actions, `src/server/roundEnd.js` for round resolution), a small additive change to Milestone 1's `src/win.js` (one new payout reason) and Milestone 2's `src/server/roomLifecycle.js` (two new turn-state fields), and new Socket.io handlers wired into the existing `src/server/socketServer.js`.

**Tech Stack:** Node.js (CommonJS), Jest, `socket.io-client` for integration tests (already a dependency from Milestone 2).

## Global Constraints

- **No per-eat payout (confirmed with the project owner).** `game:eat` is purely a card-flow/turn mechanic — it removes the matched pair of cards from circulation and advances the turn. All money settles once, at round end, via `getPayoutMultiplier(reason) × pot`. No wallet/currency wiring in this milestone (that's Milestone 4, not started); `game:result` broadcasts `{winners, reason, multiplier}` for a future wallet system to consume.
- **Eat-mode semantics (documented interpretation of an ambiguous spec passage, §2.5):** on a player's turn, if the top of the discard pile matches their card's rank, they may eat it instead of drawing (`game:eat` — no prior draw required). The distinguishing rule between the two modes is whether eating can chain:
  - `chain_eat`: eating is always allowed on your turn regardless of how the current top-of-discard got there (even if it was itself placed by the previous player's eat) — an unbounded chain of eats can occur before anyone draws.
  - `sequential_beat`: eating is only allowed on a discard that was placed by a genuine draw-and-discard turn — you cannot eat a card that was itself placed via an eat (capping the chain at one hop; the next player after an eat must draw).
  Both modes: "matching" means same `rank`, any suit. This is tracked via a new `room.lastDiscardWasEat` flag.
- **Kaeng declaration timing (resolves a spec self-contradiction, see Milestone 1's spec fix in §2.2):** `game:kaeng` is only valid at the START of a player's turn, before they've drawn (`!room.awaitingDiscard`) — same gate as eating. This makes "hand at declare time" always equal "hand before this turn's draw," which for the very first turn of the round is exactly the original 5-card dealt hand (satisfying §2.2's "evaluated from the initial hand" rule) without needing a separate frozen-hand snapshot field.
- **`declaredKaeng` is single-actor in this milestone.** Milestone 1's `checkKaengWin` supports multiple simultaneous claimants (for tie-breaking) because it models the general rule; in this turn-based online implementation only one player can act at a time, so `applyKaengDeclaration` sets `declaredKaeng` on exactly the calling player, calls `checkKaengWin`, and always resets the flag afterward (success or failure) so it never leaks into a later, unrelated check.
- **An invalid kaeng declaration is rejected, not silently accepted.** If `checkKaengWin` returns `null` (the caller had neither an instant-kaeng-eligible hand on the first turn nor a valid meld), `applyKaengDeclaration` throws `'Invalid kaeng declaration'`. The round continues; the caller must still draw and discard normally on their turn.
- **Deck exhaustion (spec §2.6 step 4) ends the round via lowest score, not an error.** When `game:draw` is attempted with an empty deck, `applyDraw` returns `{deckExhausted: true}` instead of throwing; the caller (`socketServer.js`) resolves the round via `resolveDeckExhaustedWinner` (ties split the win, same as the engine's other tie handling) with `reason: 'deck_exhausted'`, mapped to `PAYOUT.instantKaeng` (×1) — the weakest win condition, matching a low-score-only win with no meld.
- **Dealer rotation on multiple winners (tie/split-pot) picks `winners[0]`** as the next round's dealer — an explicit, documented tiebreak for an edge case the spec doesn't address.
- Reuses Milestone 1's `RANK_VALUE`/`calcHandScore`/`checkKaengWin`/`getPayoutMultiplier`/`getNextTurn`/`drawCard` and Milestone 2's `ROOM_STATUS`/`findPlayer`/`getPlayerView` exactly as those modules already export them.

---

## File Structure

- `src/win.js` (Milestone 1, **modify**) — add one payout reason: `'deck_exhausted'` → `PAYOUT.instantKaeng`.
- `src/server/roomLifecycle.js` (Milestone 2, **modify**) — `startRound` additionally initializes `room.awaitingDiscard = false` and `room.lastDiscardWasEat = false`.
- `src/server/turnActions.js` (**new**) — `isPlayersTurn`, `applyDraw`, `applyDiscard`, `canEat`, `applyEat`.
- `src/server/roundEnd.js` (**new**) — `resolveDeckExhaustedWinner`, `applyKaengDeclaration`, `finishRound`.
- `src/server/socketServer.js` (Milestone 2, **modify**) — add `game:draw`, `game:discard`, `game:eat`, `game:kaeng` handlers; add `game:result` broadcast.

---

### Task 1: Extend payout resolution for deck-exhaustion

**Files:**
- Modify: `src/win.js`
- Modify: `tests/win.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getPayoutMultiplier('deck_exhausted')` → `GAME_CONFIG.PAYOUT.instantKaeng` (1). Consumed by `src/server/roundEnd.js` (Task 3, via `finishRound`).

- [ ] **Step 1: Write the failing test**

Read `tests/win.test.js` first to find the `describe('getPayoutMultiplier', ...)` block. Add this test inside it, alongside the existing `test('maps reasons to configured multipliers', ...)` and `test('throws on an unknown reason', ...)` cases:

```javascript
test('deck_exhausted maps to the instantKaeng multiplier', () => {
  expect(getPayoutMultiplier('deck_exhausted')).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/win.test.js -t "deck_exhausted"`
Expected: FAIL — `getPayoutMultiplier` throws `Unknown win reason: deck_exhausted` instead of returning `1`.

- [ ] **Step 3: Write the implementation**

Read `src/win.js` first to find `getPayoutMultiplier`. Add one line before the final `throw`:

```javascript
function getPayoutMultiplier(reason) {
  const { PAYOUT } = GAME_CONFIG;
  if (reason === 'instant_kaeng' || reason === 'instant_kaeng_lowest' || reason === 'split_pot') {
    return PAYOUT.instantKaeng;
  }
  if (reason === 'tong') return PAYOUT.tong;
  if (reason === 'flush' || reason === 'straight') return PAYOUT.flushOrStraight;
  if (reason === 'deck_exhausted') return PAYOUT.instantKaeng;
  throw new Error(`Unknown win reason: ${reason}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/win.test.js`
Expected: PASS, all win.test.js tests including the new one (13 total, up from 12).

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: PASS, 94 tests total (up from 93).

- [ ] **Step 6: Commit**

```bash
git add src/win.js tests/win.test.js
git commit -m "feat: map deck-exhaustion win to the instant-kaeng payout tier"
```

---

### Task 2: Turn actions — draw, discard, eat

**Files:**
- Modify: `src/server/roomLifecycle.js`
- Modify: `tests/server/roomLifecycle.test.js`
- Create: `src/server/turnActions.js`
- Create: `tests/server/turnActions.test.js`

**Interfaces:**
- Consumes: `GAME_CONFIG` from `src/config.js`, `drawCard` from `src/deck.js`, `getNextTurn` from `src/turn.js` (all Milestone 1); `ROOM_STATUS`, `findPlayer` from `src/server/room.js` (Milestone 2).
- Produces: `isPlayersTurn(room, userId)` → `boolean`. `applyDraw(room, userId)` → `{deckExhausted: boolean, card?}` — throws `'Round is not in progress'`, `'Not your turn'`, or `'Already drawn this turn'`; if `room.deck.length === 0`, returns `{deckExhausted: true}` WITHOUT mutating hand/`awaitingDiscard` (no draw is possible); otherwise draws one card into the player's hand and sets `room.awaitingDiscard = true`. `applyDiscard(room, userId, card)` → `{discarded}` — throws `'Round is not in progress'`, `'Not your turn'`, `'Must draw before discarding'` (if `!room.awaitingDiscard`), or `'Card not in hand'`; removes the card from hand, pushes it to `room.discardPile`, sets `room.awaitingDiscard = false`, `room.lastDiscardWasEat = false`, `room.isFirstTurn = false`, and advances `room.turnIndex`/`room.directionSign` via `getNextTurn`. `canEat(room, userId, card)` → `boolean` (true only if: room in progress, it's the caller's turn, `!room.awaitingDiscard`, discard pile non-empty, `card.rank` matches the top discard's rank, and — for `sequential_beat` only — `!room.lastDiscardWasEat`). `applyEat(room, userId, card)` → `{eaten}` — throws `'Cannot eat this card'` if `canEat` is false; otherwise removes the card from hand, pushes to `room.discardPile`, sets `room.lastDiscardWasEat = true`, `room.isFirstTurn = false`, advances the turn. Consumed by `src/server/socketServer.js` (Task 4).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/server/turnActions.test.js
const { createRoom, addPlayer, ROOM_STATUS } = require('../../src/server/room');
const { isPlayersTurn, applyDraw, applyDiscard, canEat, applyEat } = require('../../src/server/turnActions');

const c = (rank, suit) => ({ rank, suit });

function setupRoom({ eatMode = 'chain_eat' } = {}) {
  const room = createRoom('room1', 'one_way', eatMode);
  addPlayer(room, 'alice', 's1');
  addPlayer(room, 'bob', 's2');
  room.status = ROOM_STATUS.IN_PROGRESS;
  room.turnIndex = 0;
  room.directionSign = 1;
  room.awaitingDiscard = false;
  room.lastDiscardWasEat = false;
  room.isFirstTurn = true;
  room.discardPile = [];
  room.players[0].hand = [c('2', 'spades'), c('5', 'hearts')];
  room.players[1].hand = [c('2', 'clubs'), c('9', 'diamonds')];
  room.deck = [c('K', 'spades'), c('7', 'hearts')]; // last element is drawn first
  return room;
}

describe('isPlayersTurn', () => {
  test('true for the active player, false otherwise', () => {
    const room = setupRoom();
    expect(isPlayersTurn(room, 'alice')).toBe(true);
    expect(isPlayersTurn(room, 'bob')).toBe(false);
  });
});

describe('applyDraw', () => {
  test('draws a card into the active player\'s hand and sets awaitingDiscard', () => {
    const room = setupRoom();
    const result = applyDraw(room, 'alice');
    expect(result.deckExhausted).toBe(false);
    expect(room.players[0].hand).toHaveLength(3);
    expect(room.awaitingDiscard).toBe(true);
    expect(room.deck).toHaveLength(1);
  });

  test('throws if it is not the caller\'s turn', () => {
    const room = setupRoom();
    expect(() => applyDraw(room, 'bob')).toThrow('Not your turn');
  });

  test('throws if already drawn this turn', () => {
    const room = setupRoom();
    applyDraw(room, 'alice');
    expect(() => applyDraw(room, 'alice')).toThrow('Already drawn this turn');
  });

  test('signals deckExhausted instead of throwing when the deck is empty', () => {
    const room = setupRoom();
    room.deck = [];
    const result = applyDraw(room, 'alice');
    expect(result.deckExhausted).toBe(true);
    expect(room.players[0].hand).toHaveLength(2);
    expect(room.awaitingDiscard).toBe(false);
  });
});

describe('applyDiscard', () => {
  test('discards a card, advances the turn, and closes the first-turn window', () => {
    const room = setupRoom();
    applyDraw(room, 'alice');
    const drawnCard = room.players[0].hand[room.players[0].hand.length - 1];
    applyDiscard(room, 'alice', drawnCard);
    expect(room.discardPile).toEqual([drawnCard]);
    expect(room.awaitingDiscard).toBe(false);
    expect(room.isFirstTurn).toBe(false);
    expect(room.turnIndex).toBe(1);
  });

  test('throws if discarding before drawing', () => {
    const room = setupRoom();
    expect(() => applyDiscard(room, 'alice', room.players[0].hand[0])).toThrow('Must draw before discarding');
  });

  test('throws if the card is not in hand', () => {
    const room = setupRoom();
    applyDraw(room, 'alice');
    expect(() => applyDiscard(room, 'alice', c('K', 'clubs'))).toThrow('Card not in hand');
  });
});

describe('canEat / applyEat', () => {
  test('eating is allowed on your turn with a matching-rank card, without drawing first', () => {
    const room = setupRoom();
    room.discardPile = [c('2', 'diamonds')];
    expect(canEat(room, 'alice', c('2', 'spades'))).toBe(true);
    const result = applyEat(room, 'alice', c('2', 'spades'));
    expect(result.eaten).toEqual(c('2', 'spades'));
    expect(room.discardPile).toEqual([c('2', 'diamonds'), c('2', 'spades')]);
    expect(room.players[0].hand).toEqual([c('5', 'hearts')]);
    expect(room.turnIndex).toBe(1);
    expect(room.lastDiscardWasEat).toBe(true);
  });

  test('cannot eat a non-matching rank', () => {
    const room = setupRoom();
    room.discardPile = [c('9', 'diamonds')];
    expect(canEat(room, 'alice', c('2', 'spades'))).toBe(false);
    expect(() => applyEat(room, 'alice', c('2', 'spades'))).toThrow('Cannot eat this card');
  });

  test('cannot eat after already drawing this turn', () => {
    const room = setupRoom();
    room.discardPile = [c('2', 'diamonds')];
    applyDraw(room, 'alice');
    expect(canEat(room, 'alice', c('2', 'spades'))).toBe(false);
  });

  test('sequential_beat forbids eating a discard that was itself placed by an eat', () => {
    const room = setupRoom({ eatMode: 'sequential_beat' });
    room.discardPile = [c('2', 'diamonds')];
    applyEat(room, 'alice', c('2', 'spades')); // bob is now active, lastDiscardWasEat=true
    expect(room.turnIndex).toBe(1);
    expect(canEat(room, 'bob', c('2', 'clubs'))).toBe(false);
  });

  test('chain_eat allows eating a discard that was itself placed by an eat', () => {
    const room = setupRoom({ eatMode: 'chain_eat' });
    room.discardPile = [c('2', 'diamonds')];
    applyEat(room, 'alice', c('2', 'spades')); // bob is now active, lastDiscardWasEat=true
    expect(canEat(room, 'bob', c('2', 'clubs'))).toBe(true);
  });
});
```

Also add this test to the existing `describe('startRound', ...)` block in `tests/server/roomLifecycle.test.js`:

```javascript
test('resets turn-action flags for the new round', () => {
  const room = createRoom('room1');
  addPlayer(room, 'alice', 's1');
  addPlayer(room, 'bob', 's2');
  startRound(room);
  expect(room.awaitingDiscard).toBe(false);
  expect(room.lastDiscardWasEat).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/server/turnActions.test.js tests/server/roomLifecycle.test.js`
Expected: FAIL — "Cannot find module '../../src/server/turnActions'"; the new `roomLifecycle` test fails with `expect(undefined).toBe(false)`.

- [ ] **Step 3: Write the implementation**

Read `src/server/roomLifecycle.js` first. Add two lines to `startRound`, alongside the other reset fields (`room.isFirstTurn = true;` etc.):

```javascript
  room.isFirstTurn = true;
  room.awaitingDiscard = false;
  room.lastDiscardWasEat = false;
  room.status = ROOM_STATUS.IN_PROGRESS;
```

Create `src/server/turnActions.js`:

```javascript
const { GAME_CONFIG } = require('../config');
const { drawCard } = require('../deck');
const { getNextTurn } = require('../turn');
const { ROOM_STATUS, findPlayer } = require('./room');

function activePlayer(room) {
  return room.players[room.turnIndex];
}

function isPlayersTurn(room, userId) {
  const player = activePlayer(room);
  return !!player && player.userId === userId;
}

function advanceTurn(room) {
  const next = getNextTurn(room.turnIndex, room.directionSign, room.players.length, room.direction);
  room.turnIndex = next.turnIndex;
  room.directionSign = next.directionSign;
}

function removeCardFromHand(player, card) {
  const index = player.hand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
  if (index === -1) {
    throw new Error('Card not in hand');
  }
  return player.hand.splice(index, 1)[0];
}

function applyDraw(room, userId) {
  if (room.status !== ROOM_STATUS.IN_PROGRESS) {
    throw new Error('Round is not in progress');
  }
  if (!isPlayersTurn(room, userId)) {
    throw new Error('Not your turn');
  }
  if (room.awaitingDiscard) {
    throw new Error('Already drawn this turn');
  }
  if (room.deck.length === 0) {
    return { deckExhausted: true };
  }
  const player = findPlayer(room, userId);
  const card = drawCard(room.deck);
  player.hand.push(card);
  room.awaitingDiscard = true;
  return { deckExhausted: false, card };
}

function applyDiscard(room, userId, card) {
  if (room.status !== ROOM_STATUS.IN_PROGRESS) {
    throw new Error('Round is not in progress');
  }
  if (!isPlayersTurn(room, userId)) {
    throw new Error('Not your turn');
  }
  if (!room.awaitingDiscard) {
    throw new Error('Must draw before discarding');
  }
  const player = findPlayer(room, userId);
  const discarded = removeCardFromHand(player, card);
  room.discardPile.push(discarded);
  room.awaitingDiscard = false;
  room.lastDiscardWasEat = false;
  room.isFirstTurn = false;
  advanceTurn(room);
  return { discarded };
}

function canEat(room, userId, card) {
  if (room.status !== ROOM_STATUS.IN_PROGRESS) return false;
  if (!isPlayersTurn(room, userId)) return false;
  if (room.awaitingDiscard) return false;
  if (room.discardPile.length === 0) return false;
  if (room.eatMode === GAME_CONFIG.EAT_MODE.SEQUENTIAL && room.lastDiscardWasEat) return false;
  const topCard = room.discardPile[room.discardPile.length - 1];
  return card.rank === topCard.rank;
}

function applyEat(room, userId, card) {
  if (!canEat(room, userId, card)) {
    throw new Error('Cannot eat this card');
  }
  const player = findPlayer(room, userId);
  const eaten = removeCardFromHand(player, card);
  room.discardPile.push(eaten);
  room.lastDiscardWasEat = true;
  room.isFirstTurn = false;
  advanceTurn(room);
  return { eaten };
}

module.exports = { isPlayersTurn, applyDraw, applyDiscard, canEat, applyEat };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/server/turnActions.test.js tests/server/roomLifecycle.test.js`
Expected: PASS (1 + 4 + 3 + 5 = 13 tests in turnActions.test.js; roomLifecycle.test.js now 10, up from 9)

- [ ] **Step 5: Commit**

```bash
git add src/server/roomLifecycle.js tests/server/roomLifecycle.test.js src/server/turnActions.js tests/server/turnActions.test.js
git commit -m "feat: add turn actions (draw, discard, eat)"
```

---

### Task 3: Round resolution — kaeng declaration, deck exhaustion, dealer rotation

**Files:**
- Create: `src/server/roundEnd.js`
- Create: `tests/server/roundEnd.test.js`

**Interfaces:**
- Consumes: `calcHandScore`, `checkKaengWin`, `getPayoutMultiplier` from `src/handScore.js`/`src/win.js` (Milestone 1, plus Task 1's addition), `ROOM_STATUS`, `findPlayer` from `src/server/room.js` (Milestone 2).
- Produces: `resolveDeckExhaustedWinner(players)` → `{winners: userId[], reason: 'deck_exhausted'}` (lowest `calcHandScore` wins; ties split). `applyKaengDeclaration(room, userId)` → the result object from `checkKaengWin` (e.g. `{winners, reason}`) — throws `'Round is not in progress'`, `'Player not in room'`, `'Cannot declare kaeng after drawing this turn'` (if `room.awaitingDiscard`), or `'Invalid kaeng declaration'` (if `checkKaengWin` returns `null`); always resets the caller's `declaredKaeng` back to `false` before returning or throwing. `finishRound(room, result)` → `{...result, multiplier}` — applies `getPayoutMultiplier(result.reason)`, sets `room.status = ROOM_STATUS.WAITING`, sets `room.dealerId = result.winners[0]`, resets every player's `ready` and `declaredKaeng` to `false`. Consumed by `src/server/socketServer.js` (Task 4).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/server/roundEnd.test.js
const { createRoom, addPlayer, ROOM_STATUS } = require('../../src/server/room');
const { resolveDeckExhaustedWinner, applyKaengDeclaration, finishRound } = require('../../src/server/roundEnd');

const c = (rank, suit) => ({ rank, suit });

function setupRoom() {
  const room = createRoom('room1');
  addPlayer(room, 'alice', 's1');
  addPlayer(room, 'bob', 's2');
  room.status = ROOM_STATUS.IN_PROGRESS;
  room.turnIndex = 0;
  room.awaitingDiscard = false;
  room.isFirstTurn = true;
  return room;
}

describe('resolveDeckExhaustedWinner', () => {
  test('lowest total hand score wins', () => {
    const room = setupRoom();
    room.players[0].hand = [c('A', 'spades'), c('2', 'hearts')]; // 3
    room.players[1].hand = [c('9', 'clubs'), c('K', 'diamonds')]; // 19
    const result = resolveDeckExhaustedWinner(room.players);
    expect(result).toEqual({ winners: ['alice'], reason: 'deck_exhausted' });
  });

  test('ties split between all lowest-scoring players', () => {
    const room = setupRoom();
    room.players[0].hand = [c('5', 'spades')];
    room.players[1].hand = [c('5', 'clubs')];
    const result = resolveDeckExhaustedWinner(room.players);
    expect(result.winners.sort()).toEqual(['alice', 'bob']);
  });
});

describe('applyKaengDeclaration', () => {
  test('an instant-kaeng-eligible hand on the first turn wins', () => {
    const room = setupRoom();
    room.players[0].hand = [c('A', 'spades'), c('2', 'hearts'), c('3', 'clubs'), c('A', 'diamonds'), c('2', 'clubs')];
    const result = applyKaengDeclaration(room, 'alice');
    expect(result).toEqual({ winners: ['alice'], reason: 'instant_kaeng' });
    expect(room.players[0].declaredKaeng).toBe(false);
  });

  test('a valid meld wins on any turn', () => {
    const room = setupRoom();
    room.isFirstTurn = false;
    room.players[0].hand = [c('7', 'spades'), c('7', 'hearts'), c('7', 'clubs')];
    const result = applyKaengDeclaration(room, 'alice');
    expect(result).toEqual({ winners: ['alice'], reason: 'tong' });
  });

  test('throws for an invalid declaration and clears the flag', () => {
    const room = setupRoom();
    room.isFirstTurn = false;
    room.players[0].hand = [c('K', 'spades'), c('Q', 'hearts'), c('J', 'clubs'), c('9', 'diamonds'), c('8', 'spades')];
    expect(() => applyKaengDeclaration(room, 'alice')).toThrow('Invalid kaeng declaration');
    expect(room.players[0].declaredKaeng).toBe(false);
  });

  test('throws if the caller already drew this turn', () => {
    const room = setupRoom();
    room.awaitingDiscard = true;
    expect(() => applyKaengDeclaration(room, 'alice')).toThrow('Cannot declare kaeng after drawing this turn');
  });
});

describe('finishRound', () => {
  test('applies the payout multiplier, resets the room to waiting, and rotates the dealer to the winner', () => {
    const room = setupRoom();
    room.players.forEach(p => { p.ready = true; p.declaredKaeng = true; });
    const outcome = finishRound(room, { winners: ['bob'], reason: 'tong' });
    expect(outcome).toEqual({ winners: ['bob'], reason: 'tong', multiplier: 2 });
    expect(room.status).toBe('waiting');
    expect(room.dealerId).toBe('bob');
    room.players.forEach(p => {
      expect(p.ready).toBe(false);
      expect(p.declaredKaeng).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/server/roundEnd.test.js`
Expected: FAIL with "Cannot find module '../../src/server/roundEnd'"

- [ ] **Step 3: Write the implementation**

```javascript
// src/server/roundEnd.js
const { calcHandScore } = require('../handScore');
const { checkKaengWin, getPayoutMultiplier } = require('../win');
const { ROOM_STATUS, findPlayer } = require('./room');

function resolveDeckExhaustedWinner(players) {
  const scored = players.map(p => ({ userId: p.userId, score: calcHandScore(p.hand) }));
  const minScore = Math.min(...scored.map(p => p.score));
  const winners = scored.filter(p => p.score === minScore).map(p => p.userId);
  return { winners, reason: 'deck_exhausted' };
}

function applyKaengDeclaration(room, userId) {
  if (room.status !== ROOM_STATUS.IN_PROGRESS) {
    throw new Error('Round is not in progress');
  }
  const player = findPlayer(room, userId);
  if (!player) {
    throw new Error('Player not in room');
  }
  if (room.awaitingDiscard) {
    throw new Error('Cannot declare kaeng after drawing this turn');
  }

  player.declaredKaeng = true;
  const result = checkKaengWin(room.players, room.isFirstTurn);
  player.declaredKaeng = false;

  if (!result) {
    throw new Error('Invalid kaeng declaration');
  }
  return result;
}

function finishRound(room, result) {
  const multiplier = getPayoutMultiplier(result.reason);
  room.status = ROOM_STATUS.WAITING;
  room.dealerId = result.winners[0];
  room.players.forEach(p => {
    p.ready = false;
    p.declaredKaeng = false;
  });
  return { ...result, multiplier };
}

module.exports = { resolveDeckExhaustedWinner, applyKaengDeclaration, finishRound };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/server/roundEnd.test.js`
Expected: PASS (2 + 4 + 1 = 7 tests)

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: PASS, 115 tests total (94 after Task 1 + 13 turnActions + 1 roomLifecycle addition + 7 roundEnd). Confirm the exact count from the actual run rather than trusting this arithmetic — cross-check against `Tests: N passed, N total` in the output.

- [ ] **Step 6: Commit**

```bash
git add src/server/roundEnd.js tests/server/roundEnd.test.js
git commit -m "feat: add round resolution (kaeng declaration, deck exhaustion, dealer rotation)"
```

---

### Task 4: Socket wiring for gameplay actions

**Files:**
- Modify: `src/server/socketServer.js`
- Modify: `tests/server/socketServer.test.js`

**Interfaces:**
- Consumes: `applyDraw`, `applyDiscard`, `applyEat` from `src/server/turnActions.js` (Task 2); `resolveDeckExhaustedWinner`, `applyKaengDeclaration`, `finishRound` from `src/server/roundEnd.js` (Task 3).
- Produces: four new Socket.io handlers on `createSocketServer()`'s `io` instance:
  - `game:draw` (client→server, no payload): calls `applyDraw`; on thrown error, emits `game:error` (`{message}`) to the caller only; if `deckExhausted`, ends the round via `resolveDeckExhaustedWinner` + `finishRound`, broadcasting `game:result` then `room:state`; otherwise broadcasts `room:state`.
  - `game:discard` (client→server, `{card}`): calls `applyDiscard`; on thrown error, emits `game:error` to the caller only; otherwise broadcasts `room:state`.
  - `game:eat` (client→server, `{card}`): calls `applyEat`; on thrown error, emits `game:error` to the caller only; otherwise broadcasts `room:state`.
  - `game:kaeng` (client→server, no payload): calls `applyKaengDeclaration`; on thrown error, emits `game:error` to the caller only; on success, ends the round via `finishRound`, broadcasting `game:result` then `room:state`.
  - `game:result` (server→client): broadcast individually to every connected player (same per-socket pattern as `room:state`), payload is exactly `finishRound`'s return value (`{winners, reason, multiplier}`).

- [ ] **Step 1: Write the failing tests**

Read `tests/server/socketServer.test.js` first. Add these two tests inside the existing `describe('socketServer', ...)` block, after the existing tests (do not modify the existing tests):

```javascript
test('a full turn: draw then discard advances to the next player', async () => {
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

  const dealtState = aliceStates[aliceStates.length - 1];
  const activeUserId = dealtState.players[dealtState.turnIndex].userId;
  const activeClient = activeUserId === 'alice' ? alice : bob;
  const activeStates = activeUserId === 'alice' ? aliceStates : bobStates;
  const otherStates = activeUserId === 'alice' ? bobStates : aliceStates;

  activeClient.emit('game:draw');
  await waitUntil(() => {
    const last = activeStates[activeStates.length - 1];
    const me = last.players.find(p => p.userId === activeUserId);
    return me.handCount === 6;
  });

  const myHand = activeStates[activeStates.length - 1].players.find(p => p.userId === activeUserId).hand;
  activeClient.emit('game:discard', { card: myHand[0] });
  await waitUntil(() => {
    const last = otherStates[otherStates.length - 1];
    return last.discardTop && last.discardTop.rank === myHand[0].rank && last.discardTop.suit === myHand[0].suit;
  });

  const finalState = otherStates[otherStates.length - 1];
  const newActiveUserId = finalState.players[finalState.turnIndex].userId;
  expect(newActiveUserId).not.toBe(activeUserId);
});

test('an invalid action emits game:error and does not change room state', async () => {
  const alice = connectClient();
  const bob = connectClient();
  await Promise.all([waitForEvent(alice, 'connect'), waitForEvent(bob, 'connect')]);

  const aliceStates = collectEvents(alice, 'room:state');
  const bobStates = collectEvents(bob, 'room:state');

  alice.emit('room:join', { roomId: 'room5', userId: 'alice' });
  await waitUntil(() => aliceStates.length >= 1);
  bob.emit('room:join', { roomId: 'room5', userId: 'bob' });
  await waitUntil(() => bobStates.length >= 1);

  alice.emit('player:ready', { ready: true });
  bob.emit('player:ready', { ready: true });
  await waitUntil(() => aliceStates[aliceStates.length - 1].status === 'in_progress');

  const dealtState = aliceStates[aliceStates.length - 1];
  const inactiveUserId = dealtState.players[(dealtState.turnIndex + 1) % 2].userId;
  const inactiveClient = inactiveUserId === 'alice' ? alice : bob;

  const errorPromise = waitForEvent(inactiveClient, 'game:error');
  inactiveClient.emit('game:draw'); // not their turn
  const error = await errorPromise;
  expect(error.message).toBe('Not your turn');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/server/socketServer.test.js -t "a full turn|an invalid action"`
Expected: FAIL — the client emits `game:draw`/`game:discard`, but no handler exists yet, so `waitUntil` times out (`Error: waitUntil timed out`).

- [ ] **Step 3: Write the implementation**

Read `src/server/socketServer.js` first — it currently has `room:join`, `player:ready`, and `disconnect` handlers (from Milestone 2, including a stale-socket disconnect guard). Add the four new `require`s at the top, a `broadcastGameResult`/`endRound`/`getRoomForSocket` helper, and four new handlers inside `io.on('connection', ...)`, alongside the existing ones:

```javascript
const { applyDraw, applyDiscard, applyEat } = require('./turnActions');
const { resolveDeckExhaustedWinner, applyKaengDeclaration, finishRound } = require('./roundEnd');
```

```javascript
  function broadcastGameResult(room, outcome) {
    room.players.forEach(player => {
      const socket = io.sockets.sockets.get(player.socketId);
      if (socket) {
        socket.emit('game:result', outcome);
      }
    });
  }

  function endRound(room, result) {
    const outcome = finishRound(room, result);
    broadcastGameResult(room, outcome);
    broadcastRoomState(room);
  }

  function getRoomForSocket(socket) {
    const entry = socketIndex.get(socket.id);
    if (!entry) return null;
    const room = roomStore.get(entry.roomId);
    if (!room) return null;
    return { room, userId: entry.userId };
  }
```

Add these handlers inside `io.on('connection', (socket) => { ... })`, alongside `room:join`/`player:ready`/`disconnect` (leave those three exactly as they are):

```javascript
    socket.on('game:draw', () => {
      const ctx = getRoomForSocket(socket);
      if (!ctx) return;
      let result;
      try {
        result = applyDraw(ctx.room, ctx.userId);
      } catch (err) {
        socket.emit('game:error', { message: err.message });
        return;
      }
      if (result.deckExhausted) {
        endRound(ctx.room, resolveDeckExhaustedWinner(ctx.room.players));
        return;
      }
      broadcastRoomState(ctx.room);
    });

    socket.on('game:discard', ({ card }) => {
      const ctx = getRoomForSocket(socket);
      if (!ctx) return;
      try {
        applyDiscard(ctx.room, ctx.userId, card);
      } catch (err) {
        socket.emit('game:error', { message: err.message });
        return;
      }
      broadcastRoomState(ctx.room);
    });

    socket.on('game:eat', ({ card }) => {
      const ctx = getRoomForSocket(socket);
      if (!ctx) return;
      try {
        applyEat(ctx.room, ctx.userId, card);
      } catch (err) {
        socket.emit('game:error', { message: err.message });
        return;
      }
      broadcastRoomState(ctx.room);
    });

    socket.on('game:kaeng', () => {
      const ctx = getRoomForSocket(socket);
      if (!ctx) return;
      let result;
      try {
        result = applyKaengDeclaration(ctx.room, ctx.userId);
      } catch (err) {
        socket.emit('game:error', { message: err.message });
        return;
      }
      endRound(ctx.room, result);
    });
```

You may optionally refactor the existing `player:ready` handler to use the new `getRoomForSocket` helper (it currently does the same `socketIndex.get`/`roomStore.get` lookup inline) — this is a reasonable DRY cleanup since four new handlers now share that exact pattern. Leave `room:join` and `disconnect` as-is; their lookup shapes differ (join doesn't have an existing entry yet, disconnect needs the entry even when the room lookup fails, for `socketIndex` cleanup).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/server/socketServer.test.js`
Expected: PASS, all tests in the file (7, up from 5).

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: PASS. Read the actual `Tests: N passed, N total` line and confirm N matches Task 3's count plus 2 (the two new socketServer tests) — do not hand-compute; report the real number in your task report.

- [ ] **Step 6: Commit**

```bash
git add src/server/socketServer.js tests/server/socketServer.test.js
git commit -m "feat: wire game:draw/discard/eat/kaeng socket handlers"
```

---

## Self-Review Notes

- **Spec coverage:** §2.6 (turn sequence: draw→discard-or-kaeng, eat opportunity, direction-based advancement) → Tasks 2 and 4. §2.5 (chain_eat vs sequential_beat) → Task 2's `canEat`, per the documented interpretation in Global Constraints. §2.4 (dealer rotation to previous winner) → Task 3's `finishRound`, completing the piece explicitly deferred in Milestone 2's plan. §2.2/corrected instant-kaeng rule → Task 3's `applyKaengDeclaration`, via the "declare before drawing" gate that makes the current-hand-at-declare-time equal the pre-draw hand. §2.6 step 4 (deck exhaustion → lowest score) → Task 3's `resolveDeckExhaustedWinner`, Task 1's payout mapping. §2.7 (payout multipliers) → already fully covered by Milestone 1's `getPayoutMultiplier`; Task 1 only adds the one new reason this milestone introduces. §6 (`game:draw`/`game:discard`/`game:eat`/`game:kaeng`/`game:result`) → Task 4. `voice:join`/`chat:message`/`leaderboard:get` remain out of scope (Milestones 5-7).
- **Placeholder scan:** No TBD/TODO markers. Task 3's Step 5 test-count arithmetic is deliberately left as "confirm from actual output" rather than a possibly-wrong hand-computed number, given Milestone 2's Task 1 already had one such arithmetic slip — this is a guardrail, not a placeholder.
- **Type consistency:** `Room`/`Player` shapes are unchanged from Milestone 2 except for the two new fields (`awaitingDiscard`, `lastDiscardWasEat`) added once, in Task 2, and consumed identically by Tasks 2-4. `Card { suit, rank }` matches Milestone 1's shape throughout. Reason strings (`'instant_kaeng'`, `'tong'`, `'flush'`, `'straight'`, `'split_pot'`, `'deck_exhausted'`) are produced only by Milestone 1's `win.js` and Task 1/3's additions, and consumed only by `getPayoutMultiplier` and `game:result`'s payload — no new reason string is invented outside these two producers.
