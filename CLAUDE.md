# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Milestone 1 (per the spec's §7 build order) is implemented: the core game engine — deck, dealing, hand scoring, meld validation, turn-direction logic, and win/payout resolution — lives in `src/` as pure functions with no networking or DB dependency. Each module has a matching test file under `tests/` (55/55 passing via Jest).

- `src/config.js` — game config constants (rank values, thresholds, payout multipliers).
- `src/deck.js` — deck construction/shuffle.
- `src/handScore.js` — hand scoring.
- `src/meld.js` — meld validation (ตอง/Flush/Straight) and rank ordering.
- `src/dealing.js` — dealing logic.
- `src/turn.js` — turn-direction / play-mode logic.
- `src/win.js` — win-condition and payout resolution.

Milestone 2's game server — room management, state sync, and reconnect handling (Socket.io) — is also implemented, in `src/server/`:

- `src/server/room.js` — room/player creation, join/leave, `findPlayer`.
- `src/server/roomStore.js` — in-memory room storage (stand-in for the spec's Redis room state).
- `src/server/roomLifecycle.js` — ready-up and round-start logic.
- `src/server/playerView.js` — per-player/spectator state filtering (`getPlayerView`).
- `src/server/roomConnection.js` — disconnect/reconnect handling (`disconnectPlayer`).
- `src/server/socketServer.js` — Socket.io wiring: `room:join`, `player:ready`, `disconnect` handlers and broadcast.
- `src/server/index.js` — server entry point.

Milestone 3's gameplay actions — `game:draw`, `game:discard`, `game:eat`, `game:kaeng`, round resolution, and dealer rotation — are also implemented now, in:

- `src/server/turnActions.js` — turn gating (`isPlayersTurn`), draw/discard/eat logic.
- `src/server/roundEnd.js` — kaeng declaration handling, deck-exhausted resolution, round finish/dealer rotation.

These are wired into `src/server/socketServer.js`'s `game:draw`, `game:discard`, `game:eat`, and `game:kaeng` handlers. The game is now fully playable end-to-end: join → ready → deal → draw/discard/eat/kaeng → round result → back to waiting.

Milestone 4's Auth/Wallet REST service is also implemented now, in `src/auth/`:

- `src/auth/db.js` — Postgres pool creation (`createPool`, reads `DATABASE_URL`).
- `src/auth/users.js` — user registration (`createUser`, bcrypt-hashed passwords, transactional user+wallet creation) and login (`verifyCredentials`).
- `src/auth/tokens.js` — JWT signing/verification (`signToken`, `verifyToken`, reads `JWT_SECRET`).
- `src/auth/wallet.js` — wallet balance reads and transactional balance adjustments (`getBalance`, `adjustBalance`).
- `src/auth/server.js` — Express app wiring: `POST /register`, `POST /login`, `GET /wallet/me`, `POST /wallet/adjust`.
- `src/auth/index.js` — service entry point; loads `.env` and runs as its own process on `AUTH_PORT` (`npm run start:auth`).

It's backed by real PostgreSQL (see `docker-compose.yml`; run migrations via `scripts/migrate.js`) and is an internal ledger only — there is no real payment gateway. It is **not yet integrated** with the Socket.io game server: the game server still trusts client-supplied `userId` unverified, and wiring the game server up to validate JWTs issued by this service is deferred to future work.

Milestone 5's voice-chat token issuance is also implemented now, in `src/voice/`:

- `src/voice/tokens.js` — `createVoiceToken`, wraps `livekit-server-sdk` to produce a signed LiveKit JWT scoped to a room/identity with `canPublish`/`canSubscribe` grants.

Wired into `src/server/socketServer.js`'s new `voice:join` handler: verifies the caller's real room membership (via the existing `getRoomForSocket` lookup, same pattern as every other handler) before issuing a token, rejecting with `voice:error` if the caller isn't a member of the requested room or if `role !== 'player'` (spectator voice access is deferred to Milestone 6, since spectator room membership doesn't exist yet). No client exists in this project (no browser/mobile UI has been built in any milestone), so this milestone is scoped to what a server can do — issuing a correctly-scoped credential — not actual WebRTC audio join/publish, which is inherently client-side work.

Milestones 6+ (spectator system, leaderboard) are **not built yet** — see "Suggested build order" below. `kaeng-game-spec.md` remains the source of truth for game rules, architecture, data models, and event contracts for all future work.

**Running tests:**
```
npm install
npm test        # or: npx jest
npx jest tests/<name>.test.js   # run a single test file, e.g. tests/win.test.js
```
All tests currently pass (157/157 via Jest), covering the Milestone 1 game engine, the Milestone 2 game server, the Milestone 3 gameplay actions, the Milestone 4 Auth/Wallet service, and the Milestone 5 voice-chat token issuance.

## Intended architecture (per spec)

```
Client (Mobile/Web)
   │
   ├──WebSocket/REST──▶ API Gateway
   │                        │
   │              ┌─────────┴─────────┐
   │         Game Server         Auth/Wallet Service
   │        (Socket.io, stateful)   (REST, PostgreSQL)
   │              │
   ├──WebRTC──▶ SFU Server (Voice: LiveKit/mediasoup)
   │
   ▼
Redis (room state, leaderboard cache, pub/sub)
   │
   ▼
PostgreSQL (match_history, player_stats, wallet, transactions)
   │
   ▼
Background Worker (cron/queue) — leaderboard, streak recalculation
```

Recommended stack: Node.js + Socket.io (game server), Redis (room state/cache), PostgreSQL (persistent data), LiveKit or mediasoup (voice SFU).

## Non-negotiable rules from the spec

- **Meld validation, deck shuffle, hand scoring, and win-condition resolution must run server-side only.** Clients must never receive other players' hands or the remaining draw pile.
- Spectators must never see any player's hand — state sent to spectators must be filtered server-side (`getSpectatorView` vs `getPlayerView`), never filtered client-side.
- Leaderboard reads should go through Redis cache (`leaderboard:*` sorted sets), not live PostgreSQL queries.
- Log RNG seed for shuffles to support anti-cheat audits.

## Game rules summary (see spec §2 for full detail)

- 2–5 players per table, single 52-card deck (no jokers), 5 cards dealt per player regardless of player count.
- Card values: A=1 (always low), 2–10 face value, J/Q/K=10.
- Melds: ตอง (3–4 of a kind), Flush (5 same suit), Straight (5 sequential same suit, A can be low or high but no wraparound e.g. K-A-2-3-4 is invalid). Tie-break priority: ตอง > Straight Flush > Flush > Straight.
- Two play modes selected before game start: `chain_eat` (anyone next in queue can eat a matching discard without drawing) vs `sequential_beat` (only the immediately-next player can beat the prior discard; must draw first if no match).
- Play direction is also configurable: `alternating` vs `one_way`.
- Payout multipliers: instant kaeng (per-card, corrected rule — every card in the initial 5-card hand < 8, declared on the first turn only) ×1, ตอง ×2, Flush/Straight ×3.

## Key data model shapes (spec §4)

- Redis: `Room { id, players, spectators, deck, discardPile, direction, eatMode, turnIndex, dealerId, pot, status }`, `Player { userId, socketId, hand, handScore, isDealer, declaredKaeng }`.
- PostgreSQL tables: `match_history`, `player_stats`, `transactions` — see spec §4.2 for exact columns.

## Socket event contract (spec §6)

`room:join`, `room:state`, `game:draw`, `game:discard`, `game:eat`, `game:kaeng`, `game:result`, `voice:join`, `chat:message`, `leaderboard:get`. Keep client↔server payload shapes consistent with the table in the spec when implementing handlers.

## Suggested build order (spec §7)

1. Core game engine (deck, dealing, meld validation, turn logic) — unit test before integrating with networking.
2. Game server + Socket.io (room management, state sync, reconnect handling).
3. Basic client UI (table, hand, draw/discard/kaeng actions).
4. Wallet/Auth service as a separate service with transaction-safe PostgreSQL access.
5. Voice chat (SFU) — publish/subscribe, mute controls.
6. Spectator system with filtered state.
7. Leaderboard/stats — match_history, player_stats, cron job, Redis cache.
8. Anti-cheat audit pass — confirm all validation is server-side, RNG seeds logged.
