const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

async function createUser(pool, username, password) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  // The user row and its zero-balance wallet must be created atomically: if the
  // wallets insert failed after the users insert committed on autocommit, the
  // account would be stuck in a broken state (login works, but every wallet
  // operation 500s forever, and re-registering the same username is blocked).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
      [username, passwordHash]
    );
    const user = result.rows[0];
    await client.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0)', [user.id]);

    await client.query('COMMIT');
    return user;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function verifyCredentials(pool, username, password) {
  const result = await pool.query(
    'SELECT id, username, password_hash FROM users WHERE username = $1',
    [username]
  );
  if (result.rows.length === 0) {
    return null;
  }
  const user = result.rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return null;
  }
  return { id: user.id, username: user.username };
}

module.exports = { createUser, verifyCredentials };
