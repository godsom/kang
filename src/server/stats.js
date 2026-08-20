const { GAME_CONFIG } = require('../config');
const { calcHandScore } = require('../handScore');

function statsColumnForReason(reason) {
  if (reason === 'tong') return 'wins_tong';
  if (reason === 'flush' || reason === 'straight') return 'wins_flush_straight';
  return 'wins_instant_kaeng';
}

// Every loser pays every winner `multiplier` points (src/server/roundEnd.js),
// so a player's net baht for the round is derivable from just their win/loss
// status, the multiplier, and how many players are on each side.
function calcPotAmount(isWin, multiplier, winnerCount, loserCount) {
  const perOpponent = multiplier * GAME_CONFIG.BAHT_PER_POINT;
  return isWin ? perOpponent * loserCount : -(perOpponent * winnerCount);
}

async function recordMatchHistory(pool, { roomId, playerId, result, winType, multiplier, potAmount = 0, handScore }) {
  await pool.query(
    `INSERT INTO match_history (room_id, player_id, result, win_type, multiplier, pot_amount, hand_score)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [roomId, playerId, result, winType, multiplier, potAmount, handScore]
  );
}

async function updatePlayerStats(pool, playerId, { isWin, winType }) {
  const column = isWin ? statsColumnForReason(winType) : 'total_losses';
  // Defense in depth: even though statsColumnForReason only ever returns one
  // of these four fixed strings, verify it against a hardcoded whitelist
  // before interpolating it into the query string below. This column name
  // must never be derived from raw client/user input.
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
  const loserCount = room.players.length - winners.length;
  for (const player of room.players) {
    const isWin = winners.includes(player.userId);
    const handScore = calcHandScore(player.hand);
    const potAmount = calcPotAmount(isWin, multiplier, winners.length, loserCount);
    await recordMatchHistory(pool, {
      roomId: room.id,
      playerId: player.userId,
      result: isWin ? 'win' : 'lose',
      winType: isWin ? reason : null,
      multiplier: isWin ? multiplier : null,
      potAmount,
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
  calcPotAmount,
  recordMatchHistory,
  updatePlayerStats,
  recordWin,
  getLeaderboard,
  recordRoundOutcome,
};
