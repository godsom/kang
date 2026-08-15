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
