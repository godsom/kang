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

Wired into `src/server/socketServer.js`'s new `voice:join` handler: verifies the caller's real room membership (via the existing `getRoomForSocket` lookup, same pattern as every other handler) before issuing a token, rejecting with `voice:error` if the caller isn't a member of the requested room. Both players and spectators can obtain a voice token — spectators get a subscribe-only token (no `canPublish`), players get full publish/subscribe. At the time this milestone was built, no client existed in this project, so it was scoped to what a server can do — issuing a correctly-scoped credential — not actual WebRTC audio join/publish, which is inherently client-side work. (A browser client was added later, per the client section below, but it does not yet call `voice:join` or join a LiveKit room — voice remains server-only in practice.)

Milestone 6's spectator system is also implemented now, in `src/server/spectator.js`:

- `src/server/spectator.js` — `findSpectator`, `addSpectator` (rejects a join if the `userId` is already a player in the room, and vice versa in `room.js`'s `addPlayer` — a `userId` can never be simultaneously a player and a spectator in the same room), `removeSpectator`.
- `getSpectatorView` in `src/server/playerView.js` — filtered room state for spectators; never exposes any player's hand.
- `src/server/socketServer.js` — `room:join`'s `asSpectator` flag routes to `addSpectator`/`removeSpectator` instead of `addPlayer`/`removePlayer`; `disconnect` and `voice:join` handlers were updated to account for spectator sockets.

Spectators can join a room regardless of its status (`waiting`/`in_progress`/`finished`) or current player count. A previously latent bug where a room was wrongly deleted when the last player disconnected — even if spectators were still present — is now fixed; a room is only torn down once it has no players and no spectators.

Milestone 7's leaderboard/stats persistence is also implemented now, extending `db/schema.sql` (Milestone 4's schema file) with two new tables, plus a new `src/server/stats.js` and `src/server/redisClient.js`:

- `db/schema.sql` — adds `match_history` (one row per player per finished round: result, win type, multiplier, hand score) and `player_stats` (running totals: games played, wins by type, losses, current/best streak). Neither table has a foreign key to the `users` table — `player_id` is a plain string, matching the game server's existing unauthenticated `userId` model (the game server still doesn't integrate with the Auth service, per Milestone 4's note above).
- `src/server/redisClient.js` — `createRedisClient`, this project's first actual use of the Redis container `docker-compose.yml` has provisioned since Milestone 0.
- `src/server/stats.js` — `recordRoundOutcome(pool, redisClient, room, outcome)` is the integration point: for every player in a finished round, records a `match_history` row and updates their `player_stats` (win-type bucketing reuses `src/win.js`'s existing payout-tier grouping); for each winner, increments a Redis sorted set (`leaderboard:wins`) via `recordWin`. `getLeaderboard(redisClient, type, limit)` reads ONLY from Redis, never Postgres, per the spec's non-negotiable rule below.
- `src/server/socketServer.js` — `endRound` now calls `recordRoundOutcome` after broadcasting `game:result`/`room:state` (a persistence failure is caught and logged, never blocks or corrupts the broadcast); a new `leaderboard:get` handler reads the Redis-cached standings.

**Important, honest scope note:** `net_profit`/`pot_amount` are always recorded as `0`. No real stake/payout amount is computed anywhere in this codebase — that requires the wallet integration Milestones 3 and 4 both explicitly deferred (the game server has never called the Auth/Wallet service). The leaderboard therefore ranks by win count (`leaderboard:wins`), not profit — spec §5.5's `leaderboard:profit` design would be meaningless when profit is always zero. Wiring a real payout amount into round outcomes, and switching the leaderboard to rank by actual profit, is future work once the game server and Auth service are integrated.

A browser client now exists under `client/` (a separate Vite/React/Vitest project, with its own `package.json` and dependencies from the repo root's Node/Jest project). It implements build-order item #3 — login, lobby, table gameplay, and round results:

- `client/src/api/authClient.js` — REST client for the Milestone 4 Auth service (`/register`, `/login`), reading `VITE_AUTH_URL`.
- `client/src/socket/SocketProvider.jsx` — owns the Socket.io connection to the game server (`VITE_GAME_SERVER_URL`), emits `auth` with the JWT on every `connect` (including reconnects).
- `client/src/state/RoomProvider.jsx` / `client/src/state/reducer.js` — a React context + reducer that folds `room:state`, `game:result`, `room:error`, `game:error`, and `auth:error` socket events into state; also remembers the last-joined `roomId` and re-emits `room:join` on reconnect (a new socket id after a drop otherwise leaves the server with no room mapping for that socket).
- `client/src/screens/Login.jsx`, `Lobby.jsx`, `Table.jsx`, `Result.jsx` — the four screens `client/src/App.jsx` routes between based on room/result state; `App.jsx` also persists `{token, userId, username}` to `sessionStorage` so a page refresh mid-session doesn't force a re-login.
- Run its tests with `cd client && npm test` (Vitest); it has its own dependency install (`cd client && npm install`) separate from the repo root.

**Project status: all 7 milestones from the spec's §7 build order are implemented, plus build-order item #3 (basic client UI). Only #8 (anti-cheat audit pass) remains outstanding.** Milestones 2 through 7 remain server-only and are tested via `socket.io-client`/`supertest` integration tests; the client above is the first and only browser UI in this project, tested via Vitest/`@testing-library/react`. `kaeng-game-spec.md` remains the source of truth for game rules, architecture, data models, and event contracts for any future client or audit work.

**Running tests:**
```
npm install
npm test        # or: npx jest
npx jest tests/<name>.test.js   # run a single test file, e.g. tests/win.test.js
```
Tests require the dockerized dev stack running (`docker compose up -d` — Postgres, Redis, and LiveKit; see `docker-compose.yml` and `.env.example`) and a migrated schema (`node scripts/migrate.js`). All tests currently pass (184/184 via Jest), covering the Milestone 1 game engine, the Milestone 2 game server, the Milestone 3 gameplay actions, the Milestone 4 Auth/Wallet service, the Milestone 5 voice-chat token issuance, the Milestone 6 spectator system, and the Milestone 7 leaderboard/stats persistence.

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

1. ✅ Core game engine (deck, dealing, meld validation, turn logic) — unit test before integrating with networking.
2. ✅ Game server + Socket.io (room management, state sync, reconnect handling).
3. ✅ Basic client UI (table, hand, draw/discard/kaeng actions) — a Vite/React/Vitest browser client under `client/`, covering login, lobby, table gameplay, and round results.
4. ✅ Wallet/Auth service as a separate service with transaction-safe PostgreSQL access — built, but not yet integrated with the game server.
5. ✅ Voice chat (SFU) — token issuance only; no client to actually publish/subscribe audio.
6. ✅ Spectator system with filtered state.
7. ✅ Leaderboard/stats — match_history, player_stats, Redis cache (no cron job for streak recalculation — streaks are updated inline per round in `updatePlayerStats`, not via a background job).
8. ❌ Anti-cheat audit pass — **not done**; this is a process/audit step, not a code deliverable, and hasn't been performed.
