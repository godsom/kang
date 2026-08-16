require('dotenv').config();
const { createRedisClient } = require('../../src/server/redisClient');

describe('createRedisClient', () => {
  let client;

  afterEach(async () => {
    if (client && client.isOpen) {
      await client.quit();
    }
  });

  test('connects to the real Redis instance and can round-trip a value', async () => {
    client = createRedisClient();
    await client.connect();
    await client.set('kaeng:test:redisClient', 'ok');
    const value = await client.get('kaeng:test:redisClient');
    expect(value).toBe('ok');
    await client.del('kaeng:test:redisClient');
  });
});
