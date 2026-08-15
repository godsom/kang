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
