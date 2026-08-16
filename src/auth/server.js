const express = require('express');
const { createUser, verifyCredentials } = require('./users');
const { signToken, verifyToken } = require('./tokens');
const { getBalance, adjustBalance } = require('./wallet');

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  req.userId = payload.userId;
  next();
}

function createAuthApp(pool) {
  const app = express();
  app.use(express.json());

  app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'username and password are required' });
    }
    try {
      const user = await createUser(pool, username, password);
      const token = signToken(user);
      res.status(201).json({ token, user: { id: user.id, username: user.username } });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ message: 'Username already taken' });
      }
      res.status(500).json({ message: 'Registration failed' });
    }
  });

  app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'username and password are required' });
    }
    const user = await verifyCredentials(pool, username, password);
    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    const token = signToken(user);
    res.json({ token, user: { id: user.id, username: user.username } });
  });

  app.get('/wallet/me', requireAuth, async (req, res) => {
    const balance = await getBalance(pool, req.userId);
    res.json({ balance });
  });

  app.post('/wallet/adjust', requireAuth, async (req, res) => {
    const { amount, type } = req.body;
    if (typeof amount !== 'number' || !type) {
      return res.status(400).json({ message: 'amount (number) and type are required' });
    }
    try {
      const balance = await adjustBalance(pool, req.userId, amount, type);
      res.json({ balance });
    } catch (err) {
      if (err.message === 'Insufficient balance') {
        return res.status(400).json({ message: 'Insufficient balance' });
      }
      res.status(500).json({ message: 'Adjustment failed' });
    }
  });

  return app;
}

module.exports = { createAuthApp, requireAuth };
