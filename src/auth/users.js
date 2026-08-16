const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

async function createUser(pool, username, password) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await pool.query(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
    [username, passwordHash]
  );
  const user = result.rows[0];
  await pool.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0)', [user.id]);
  return user;
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
