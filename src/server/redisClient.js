const { createClient } = require('redis');

function createRedisClient(url = process.env.REDIS_URL) {
  return createClient({ url });
}

module.exports = { createRedisClient };
