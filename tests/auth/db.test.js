require('dotenv').config();
const { createPool } = require('../../src/auth/db');

describe('createPool', () => {
  let pool;

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test('connects to the real database and can query it', async () => {
    pool = createPool();
    const result = await pool.query('SELECT 1 AS ok');
    expect(result.rows[0].ok).toBe(1);
  });

  test('the migrated schema has the expected tables', async () => {
    const result = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    const tableNames = result.rows.map(r => r.table_name);
    expect(tableNames).toEqual(expect.arrayContaining(['users', 'wallets', 'transactions']));
  });
});
