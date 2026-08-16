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
