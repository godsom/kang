const { Pool } = require('pg');

function createPool(connectionString = process.env.DATABASE_URL) {
  return new Pool({ connectionString });
}

module.exports = { createPool };
