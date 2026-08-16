require('dotenv').config();
const { createPool } = require('../../src/auth/db');
const { createUser } = require('../../src/auth/users');
const { getBalance, adjustBalance } = require('../../src/auth/wallet');

describe('wallet', () => {
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

  describe('getBalance', () => {
    test('a fresh wallet starts at 0', async () => {
      const user = await createUser(pool, 'alice', 'password1');
      const balance = await getBalance(pool, user.id);
      expect(balance).toBe(0);
    });

    test('throws for an unknown user', async () => {
      await expect(getBalance(pool, '00000000-0000-0000-0000-000000000000')).rejects.toThrow('Wallet not found');
    });
  });

  describe('adjustBalance', () => {
    test('a positive adjustment increases the balance and records a transaction', async () => {
      const user = await createUser(pool, 'bob', 'password1');
      const newBalance = await adjustBalance(pool, user.id, 100, 'deposit');
      expect(newBalance).toBe(100);
      expect(await getBalance(pool, user.id)).toBe(100);

      const txResult = await pool.query('SELECT amount, type FROM transactions WHERE user_id = $1', [user.id]);
      expect(txResult.rows).toHaveLength(1);
      expect(Number(txResult.rows[0].amount)).toBe(100);
      expect(txResult.rows[0].type).toBe('deposit');
    });

    test('a negative adjustment within balance succeeds', async () => {
      const user = await createUser(pool, 'carol', 'password1');
      await adjustBalance(pool, user.id, 100, 'deposit');
      const newBalance = await adjustBalance(pool, user.id, -40, 'payout');
      expect(newBalance).toBe(60);
    });

    test('an adjustment that would go negative is rejected and rolls back completely', async () => {
      const user = await createUser(pool, 'dave', 'password1');
      await adjustBalance(pool, user.id, 50, 'deposit');

      await expect(adjustBalance(pool, user.id, -100, 'payout')).rejects.toThrow('Insufficient balance');

      expect(await getBalance(pool, user.id)).toBe(50); // unchanged
      const txResult = await pool.query('SELECT * FROM transactions WHERE user_id = $1', [user.id]);
      expect(txResult.rows).toHaveLength(1); // only the original deposit, no failed-payout row
    });
  });
});
