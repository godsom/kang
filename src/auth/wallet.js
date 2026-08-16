async function getBalance(pool, userId) {
  const result = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
  if (result.rows.length === 0) {
    throw new Error('Wallet not found');
  }
  return Number(result.rows[0].balance);
}

async function adjustBalance(pool, userId, amount, type, roomId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const walletResult = await client.query(
      'UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2 RETURNING balance',
      [amount, userId]
    );
    if (walletResult.rows.length === 0) {
      throw new Error('Wallet not found');
    }

    const newBalance = Number(walletResult.rows[0].balance);
    if (newBalance < 0) {
      throw new Error('Insufficient balance');
    }

    await client.query(
      'INSERT INTO transactions (user_id, room_id, amount, type) VALUES ($1, $2, $3, $4)',
      [userId, roomId, amount, type]
    );

    await client.query('COMMIT');
    return newBalance;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getBalance, adjustBalance };
