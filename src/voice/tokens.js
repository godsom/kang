const { AccessToken } = require('livekit-server-sdk');

async function createVoiceToken({ apiKey, apiSecret, roomName, identity, canPublish, canSubscribe }) {
  const at = new AccessToken(apiKey, apiSecret, { identity });
  at.addGrant({ room: roomName, roomJoin: true, canPublish, canSubscribe });
  return at.toJwt();
}

module.exports = { createVoiceToken };
