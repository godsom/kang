require('dotenv').config();
const { createPool } = require('../../src/auth/db');
const { createUser, verifyCredentials } = require('../../src/auth/users');

describe('users', () => {
  let pool;

  beforeAll(() => {
    pool = createPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE transactions, wallets, users RESTART IDENTITY CASCADE');
  });

  describe('createUser', () => {
    test('creates a user and a zero-balance wallet', async () => {
      const user = await createUser(pool, 'alice', 'hunter2');
      expect(user.username).toBe('alice');
      expect(user.id).toBeDefined();

      const walletResult = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [user.id]);
      expect(Number(walletResult.rows[0].balance)).toBe(0);
    });

    test('does not store the plaintext password', async () => {
      const user = await createUser(pool, 'bob', 'hunter2');
      const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
      expect(result.rows[0].password_hash).not.toBe('hunter2');
    });

    test('rejects a duplicate username', async () => {
      await createUser(pool, 'carol', 'password1');
      await expect(createUser(pool, 'carol', 'password2')).rejects.toMatchObject({ code: '23505' });
    });
  });

  describe('verifyCredentials', () => {
    test('returns the user for correct credentials', async () => {
      await createUser(pool, 'dave', 'correcthorse');
      const result = await verifyCredentials(pool, 'dave', 'correcthorse');
      expect(result).toMatchObject({ username: 'dave' });
    });

    test('returns null for an incorrect password', async () => {
      await createUser(pool, 'erin', 'correcthorse');
      const result = await verifyCredentials(pool, 'erin', 'wrongpassword');
      expect(result).toBeNull();
    });

    test('returns null for an unknown username', async () => {
      const result = await verifyCredentials(pool, 'nobody', 'whatever');
      expect(result).toBeNull();
    });
  });
});
