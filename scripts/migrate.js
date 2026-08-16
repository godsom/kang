require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createPool } = require('../src/auth/db');

async function migrate() {
  const pool = createPool();
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.end();
  console.log('Migration applied.');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
