const jwt = require('jsonwebtoken');

const DEFAULT_EXPIRES_IN = '24h';

function signToken(user, secret = process.env.JWT_SECRET, expiresIn = DEFAULT_EXPIRES_IN) {
  return jwt.sign({ sub: user.id, username: user.username }, secret, { expiresIn });
}

function verifyToken(token, secret = process.env.JWT_SECRET) {
  try {
    const payload = jwt.verify(token, secret);
    return { userId: payload.sub, username: payload.username };
  } catch (err) {
    return null;
  }
}

module.exports = { signToken, verifyToken };
