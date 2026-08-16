const { createPool } = require('./db');
const { createAuthApp } = require('./server');

const PORT = process.env.AUTH_PORT || 4000;
const pool = createPool();
const app = createAuthApp(pool);
app.listen(PORT, () => {
  console.log(`Kaeng auth/wallet service listening on port ${PORT}`);
});
