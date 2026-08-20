require('dotenv').config();
const request = require('supertest');
const { createPool } = require('../../src/auth/db');
const { testDatabaseUrl } = require('../testDb');
const { createAuthApp } = require('../../src/auth/server');

describe('auth server', () => {
  let pool;
  let app;

  beforeAll(() => {
    pool = createPool(testDatabaseUrl());
    app = createAuthApp(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE transactions, wallets, users RESTART IDENTITY CASCADE');
  });

  describe('POST /register', () => {
    test('registers a new user and returns a token', async () => {
      const res = await request(app).post('/register').send({ username: 'alice', password: 'hunter2' });
      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.username).toBe('alice');
    });

    test('400 when password is missing', async () => {
      const res = await request(app).post('/register').send({ username: 'alice' });
      expect(res.status).toBe(400);
    });

    test('409 on duplicate username', async () => {
      await request(app).post('/register').send({ username: 'bob', password: 'password1' });
      const res = await request(app).post('/register').send({ username: 'bob', password: 'password2' });
      expect(res.status).toBe(409);
    });
  });

  describe('POST /login', () => {
    test('logs in with correct credentials', async () => {
      await request(app).post('/register').send({ username: 'carol', password: 'correcthorse' });
      const res = await request(app).post('/login').send({ username: 'carol', password: 'correcthorse' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
    });

    test('401 on wrong password', async () => {
      await request(app).post('/register').send({ username: 'dave', password: 'correcthorse' });
      const res = await request(app).post('/login').send({ username: 'dave', password: 'wrong' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /wallet/me', () => {
    test('returns the balance for an authenticated user', async () => {
      const registerRes = await request(app).post('/register').send({ username: 'erin', password: 'password1' });
      const res = await request(app).get('/wallet/me').set('Authorization', `Bearer ${registerRes.body.token}`);
      expect(res.status).toBe(200);
      expect(res.body.balance).toBe(0);
    });

    test('401 without a token', async () => {
      const res = await request(app).get('/wallet/me');
      expect(res.status).toBe(401);
    });

    test('401 with a malformed Authorization header', async () => {
      const res = await request(app).get('/wallet/me').set('Authorization', 'NotBearer sometoken');
      expect(res.status).toBe(401);
    });

    test('401 with an invalid token', async () => {
      const res = await request(app).get('/wallet/me').set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /wallet/adjust', () => {
    test('adjusts and returns the new balance', async () => {
      const registerRes = await request(app).post('/register').send({ username: 'frank', password: 'password1' });
      const token = registerRes.body.token;
      const res = await request(app)
        .post('/wallet/adjust')
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: 50, type: 'deposit' });
      expect(res.status).toBe(200);
      expect(res.body.balance).toBe(50);
    });

    test('400 when the adjustment would go negative', async () => {
      const registerRes = await request(app).post('/register').send({ username: 'grace', password: 'password1' });
      const token = registerRes.body.token;
      const res = await request(app)
        .post('/wallet/adjust')
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: -10, type: 'payout' });
      expect(res.status).toBe(400);
    });
  });
});
