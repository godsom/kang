# เกมไพ่ "แคง" (Kaeng) — Technical Spec สำหรับพัฒนา

> เอกสารนี้รวบรวมกติกาเกมและสถาปัตยกรรมระบบทั้งหมด สำหรับส่งต่อให้ Claude Code implement เป็นแอปจริง

---

## 1. ภาพรวมระบบ

Multiplayer online card game (คล้าย Rummy) รองรับ 2–5 คนต่อโต๊ะ พร้อมระบบ voice chat, ผู้ชม, และ leaderboard/สถิติ

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

**Stack แนะนำ:** Node.js + Socket.io (game server), Redis (state/cache), PostgreSQL (persistent data), LiveKit หรือ mediasoup (voice SFU)

---

## 2. กติกาเกม (Game Rules)

### 2.1 ผู้เล่นและอุปกรณ์
- ผู้เล่น: 2–5 คนต่อโต๊ะ
- ไพ่: สำรับเดียว 52 ใบ (ไม่มีโจ๊กเกอร์)
- แจกไพ่: คนละ **5 ใบ คงที่** ทุกจำนวนผู้เล่น
- ทิศทางการเล่น: เลือกก่อนเริ่มเกม — `alternating` (สลับซ้าย-ขวา) หรือ `one_way` (วนทางเดียว)

### 2.2 ค่าไพ่
| ไพ่ | แต้ม |
|---|---|
| A | 1 (เสมอ ไม่มีกรณีสูง) |
| 2–10 | ตามหน้าไพ่ |
| J, Q, K | 10 |

**กรณีจับชุดได้ (ตอง/Flush/Straight):**
- ผู้เล่นคนเดียวทำชุดได้ → **ชนะทันที**
- มากกว่า 1 คนทำชุดได้ → เทียบ **หน้าไพ่สูงสุดของชุด** ใครสูงกว่าชนะ

**เงื่อนไข "แคงด่วน" (แก้ไข — ผูกกับไพ่แต่ละใบ ไม่ใช่ผลรวม):**
- ต้องประกาศใน **เทิร์นแรก** ของเกมเท่านั้น (ก่อนมีการทิ้ง/กินไพ่ใด ๆ) โดยประเมินจาก **มือเริ่มต้น 5 ใบที่แจกมา** (`HAND_SIZE`) — ไม่ใช่มือหลังจั่วเพิ่ม
- ต้อง**ไม่มีไพ่ใบใดในมือมีแต้ม ≥ 8** เลย (กล่าวคือทุกใบต้องมีแต้ม < 8 ตาม `RANK_VALUE`)
- ถ้ามีผู้เล่นเข้าเงื่อนไขมากกว่า 1 คน → แต้มรวมต่ำสุดชนะ; แต้มรวมเท่ากัน → เทียบชุดไพ่ (ตอง/Flush/Straight) หากมี ไม่งั้นแบ่งเงินกองกลาง (split pot)

### 2.3 ชุดไพ่ที่นับได้ (Meld)
| ชุด | เงื่อนไข |
|---|---|
| ตอง | เลขเดียวกัน 3–4 ใบ ต่างดอก |
| Flush (สีสัญลักษณ์เดียวกัน) | ดอกเดียวกัน 5 ใบ ไม่ต้องเรียง |
| Straight (เรียงตัวเลข) | ดอกเดียวกันเรียงติดกัน 5 ใบ, A อยู่ต้น (A-2-3-4-5) หรือท้าย (10-J-Q-K-A) ได้ ห้ามวนข้าม (K-A-2-3-4 ใช้ไม่ได้) |

**ลำดับความสำคัญ tie-break:** ตอง > Straight Flush > Flush > Straight

### 2.4 การหาคนเริ่มเกม
- เกมแรกสุด: แจกคนละ 1 ใบ → **แต้มต่ำสุดเป็นผู้เริ่ม**
- เกมถัดไป: **ผู้ชนะเกมก่อนหน้าเป็นผู้เริ่ม**

### 2.5 โหมดการเล่น (เลือกก่อนเริ่มเกม)
- **โหมด A — กินวน (chain_eat):** ผู้เล่นคนถัดไปทิ้งไพ่ทับ "กินเงิน" ได้ทันทีถ้ามีไพ่ตรงกับที่ทิ้งไว้ โดยไม่ต้องจั่ว (วนไปเรื่อยจนสุดคิว)
- **โหมด B — ทิ้งต่อ (sequential_beat):** ตีกินได้เฉพาะไพ่ของคนก่อนหน้าตัวเองเท่านั้น ถ้าไม่มีไพ่ตรง ต้องจั่วก่อนจึงทิ้งต่อได้ แล้วคนถัดไปมีสิทธิ์กินเงินจากไพ่ที่เพิ่งทิ้ง

### 2.6 ลำดับการเล่นในแต่ละตา
1. คนแรกจั่วไพ่ 1 ใบ → เลือกทิ้งไพ่ หรือประกาศ "แคง" ทันทีเพื่อเทียบค่าไพ่ (ตามข้อ 2.2)
2. คนที่สอง ถ้ามีไพ่ตรงกับที่คนแรกทิ้ง ทิ้งทับ "กินเงิน" ได้
3. คนถัดไปเล่นตามกติกาโหมดที่เลือก (ข้อ 2.5)
4. เล่นวนตามทิศทางที่เลือก (ข้อ 2.1) จนกองจั่วหมด → นับแต้มไพ่คงเหลือทุกคน (ต่ำสุดชนะ)

### 2.7 ตัวคูณเดิมพัน (Payout Multiplier)
| เงื่อนไขชนะ | ตัวคูณ |
|---|---|
| แคงด่วน (แต้มรวม < 8) | ×1 |
| ตอง | ×2 |
| Flush / Straight | ×3 |

---

## 3. Config Constants

```javascript
const GAME_CONFIG = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 5,
  HAND_SIZE: 5,
  DECK_COUNT: 1,
  INSTANT_KAENG_THRESHOLD: 8,
  DIRECTION: { ALTERNATING: "alternating", ONE_WAY: "one_way" },
  EAT_MODE: { CHAIN: "chain_eat", SEQUENTIAL: "sequential_beat" },
  RANK_VALUE: { A:1, 2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10, J:10, Q:10, K:10 },
  PAYOUT: { instantKaeng: 1, tong: 2, flushOrStraight: 3 }
};

const VOICE_CONFIG = {
  provider: "livekit",
  maxPublishers: 5,        // เฉพาะผู้เล่น
  spectatorMode: "subscribe_only",
  pushToTalk: false
};

const SPECTATOR_CONFIG = {
  maxPerRoom: 50,
  canSeeHands: false,
  canChat: true,
  canHearVoice: true
};
```

---

## 4. Data Models

### 4.1 Room / Game State (Redis)
```javascript
Room {
  id, players: Player[], spectators: Spectator[],
  deck: Card[], discardPile: Card[],
  direction, eatMode, turnIndex, dealerId,
  pot, status  // 'waiting' | 'in_progress' | 'finished'
}

Player { userId, socketId, hand: Card[], handScore, isDealer, declaredKaeng }
Spectator { userId, socketId }
Card { suit, rank }
```

### 4.2 PostgreSQL Schema
```sql
CREATE TABLE match_history (
  id UUID PRIMARY KEY,
  room_id UUID,
  player_id UUID,
  result VARCHAR(10),          -- 'win' | 'lose'
  win_type VARCHAR(20),        -- 'instant_kaeng' | 'tong' | 'flush' | 'straight'
  multiplier INT,
  pot_amount NUMERIC,
  hand_score INT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE player_stats (
  player_id UUID PRIMARY KEY,
  total_games INT DEFAULT 0,
  wins_instant_kaeng INT DEFAULT 0,
  wins_tong INT DEFAULT 0,
  wins_flush_straight INT DEFAULT 0,
  total_losses INT DEFAULT 0,
  net_profit NUMERIC DEFAULT 0,
  current_streak INT DEFAULT 0,
  best_streak INT DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY,
  user_id UUID,
  room_id UUID,
  amount NUMERIC,
  type VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 5. Core Logic Pseudocode

### 5.1 เริ่มเกม / หาคนเริ่ม
```javascript
function determineFirstDealer(players) {
  const draws = players.map(p => ({ p, card: drawCard() }));
  return draws.reduce((min, d) =>
    RANK_VALUE[d.card.rank] < RANK_VALUE[min.card.rank] ? d : min
  ).p;
}

function initRoom(players, direction, eatMode) {
  const deck = shuffle(buildDeck(GAME_CONFIG.DECK_COUNT));
  dealCards(players, deck, GAME_CONFIG.HAND_SIZE);
  return { direction, eatMode, dealerId: determineFirstDealer(players) };
}
```

### 5.2 ตรวจสอบชุดไพ่ (Meld Validation) — server-side เท่านั้น
```javascript
function validateMeld(cards) {
  if (isTong(cards)) return cards.length in [3,4] && sameRank(cards);
  if (isFlush(cards)) return cards.length === 5 && sameSuit(cards);
  if (isStraight(cards)) {
    return cards.length === 5
      && sameSuit(cards)
      && (isSequential(cards) || isAceLowSeq(cards) || isAceHighSeq(cards))
      && !isWrapAround(cards); // ห้าม K-A-2-3-4
  }
  return false;
}
```

### 5.3 ตรวจสอบผู้ชนะเมื่อแคง
```javascript
function checkKaengWin(players, isFirstTurn) {
  const claimants = players.filter(p => p.declaredKaeng);
  if (claimants.length === 0) return null;

  claimants.forEach(p => p.handScore = calcHandScore(p.hand));
  // "แคงด่วน" requires: declared on the first turn AND every card in hand < 8 (no single card >= 8)
  const eligible = isFirstTurn
    ? claimants.filter(p => p.hand.every(card => GAME_CONFIG.RANK_VALUE[card.rank] < GAME_CONFIG.INSTANT_KAENG_THRESHOLD))
    : [];

  if (eligible.length === 0) return checkMeldBasedWin(claimants);
  if (eligible.length === 1) return { winner: eligible[0], reason: "instant_kaeng" };

  const minScore = Math.min(...eligible.map(p => p.handScore));
  const winners = eligible.filter(p => p.handScore === minScore);
  return winners.length === 1
    ? { winner: winners[0], reason: "instant_kaeng_lowest" }
    : resolveTie(winners); // tie-break ตามลำดับชุด หรือ split pot
}

function resolveMeldWin(claimants) {
  if (claimants.length === 1) return { winner: claimants[0] };
  const maxRank = Math.max(...claimants.map(c => RANK_VALUE[c.topCard.rank]));
  return { winners: claimants.filter(c => RANK_VALUE[c.topCard.rank] === maxRank) };
}
```

### 5.4 State broadcast (แยก view ผู้เล่น/ผู้ชม)
```javascript
function broadcastGameState(room) {
  room.players.forEach(p =>
    p.socket.emit('state', getPlayerView(room, p.id)) // เห็นไพ่ตัวเอง
  );
  room.spectators.forEach(s =>
    s.socket.emit('state', getSpectatorView(room)) // ไม่เห็นไพ่ใคร
  );
}
```

### 5.5 อัปเดตสถิติหลังจบเกม
```javascript
async function updatePlayerStats(playerId, result) {
  await db.query(`
    UPDATE player_stats SET
      total_games = total_games + 1,
      wins_${result.winType} = wins_${result.winType} + 1,
      net_profit = net_profit + $2,
      current_streak = CASE WHEN $3 THEN current_streak + 1 ELSE 0 END,
      best_streak = GREATEST(best_streak, current_streak),
      updated_at = NOW()
    WHERE player_id = $1
  `, [playerId, result.potChange, result.isWin]);

  await redis.zadd('leaderboard:profit', result.newTotal, playerId);
}

async function getLeaderboard(type = 'profit', limit = 100) {
  return redis.zrevrange(`leaderboard:${type}`, 0, limit - 1, 'WITHSCORES');
}
```

---

## 6. Socket Events (แนะนำ)

| Event | ทิศทาง | Payload |
|---|---|---|
| `room:join` | client→server | `{ roomId, userId }` |
| `room:state` | server→client | `PlayerView / SpectatorView` |
| `game:draw` | client→server | `{}` |
| `game:discard` | client→server | `{ card }` |
| `game:eat` | client→server | `{ card }` |
| `game:kaeng` | client→server | `{}` |
| `game:result` | server→client | `{ winner, reason, payout }` |
| `voice:join` | client→server | `{ roomId, role: 'player'|'spectator' }` |
| `chat:message` | client↔server | `{ text }` |
| `leaderboard:get` | client→server | `{ type, limit }` |

---

## 7. Milestones สำหรับพัฒนา (แนะนำลำดับ)

1. **Core game engine** — deck, dealing, meld validation, turn logic (unit test ก่อน integrate)
2. **Game server + Socket.io** — room management, state sync, reconnect handling
3. **Client UI พื้นฐาน** — โต๊ะ, มือไพ่, การจั่ว/ทิ้ง/แคง
4. **Wallet/Auth service** — แยก service, PostgreSQL transaction-safe
5. **Voice chat (SFU)** — publish/subscribe, mute controls
6. **ระบบผู้ชม** — spectator view, filtered state
7. **Leaderboard/สถิติ** — match_history, player_stats, cron job, Redis cache
8. **Anti-cheat audit** — ตรวจทุก validation อยู่ server-side, log RNG seed

---

## 8. หลักการสำคัญ (ต้องยึดตลอดการพัฒนา)
- **Meld validation, shuffle, hand score, win condition ต้องทำฝั่ง server เท่านั้น** — client ห้ามรู้ไพ่คนอื่น/กองจั่วที่เหลือ
- ผู้ชมห้ามเห็นไพ่ในมือผู้เล่นเด็ดขาด (filter state ฝั่ง server ก่อนส่ง)
- Leaderboard ควร cache ผ่าน Redis ไม่ query PostgreSQL สดทุกครั้ง
