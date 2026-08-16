require('dotenv').config();
const jwt = require('jsonwebtoken');
const { createVoiceToken } = require('../../src/voice/tokens');

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

describe('createVoiceToken', () => {
  test('produces a JWT signed with apiSecret, decodable with jsonwebtoken', async () => {
    const token = await createVoiceToken({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      roomName: 'room1',
      identity: 'alice',
      canPublish: true,
      canSubscribe: true,
    });
    const payload = jwt.verify(token, API_SECRET);
    expect(payload.sub).toBe('alice');
    expect(payload.iss).toBe(API_KEY);
  });

  test('grants canPublish/canSubscribe and the target room exactly as requested', async () => {
    const token = await createVoiceToken({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      roomName: 'room42',
      identity: 'bob',
      canPublish: false,
      canSubscribe: true,
    });
    const payload = jwt.verify(token, API_SECRET);
    expect(payload.video).toMatchObject({
      room: 'room42',
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
    });
  });

  test('a token signed with the wrong secret fails verification', async () => {
    const token = await createVoiceToken({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      roomName: 'room1',
      identity: 'carol',
      canPublish: true,
      canSubscribe: true,
    });
    expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
  });
});
