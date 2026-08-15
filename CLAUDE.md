# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

No code exists yet. The repository currently contains only `kaeng-game-spec.md`, the full technical spec for a multiplayer card game called "แคง" (Kaeng, similar to Rummy) that this project is meant to implement. Treat that file as the source of truth for game rules, architecture, data models, and event contracts — read it before implementing anything. Once a build system exists, update this file with actual build/lint/test commands.

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
- Payout multipliers: instant kaeng (hand total < 8) ×1, ตอง ×2, Flush/Straight ×3.

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
