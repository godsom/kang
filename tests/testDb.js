// Guards against tests silently truncating the real dev database — several
// test files TRUNCATE users/wallets/transactions/match_history between
// tests, which previously ran against DATABASE_URL and wiped real accounts.
function testDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. See .env.example — tests must not run against DATABASE_URL, which they TRUNCATE.'
    );
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must not equal DATABASE_URL — tests TRUNCATE this database.');
  }
  return url;
}

module.exports = { testDatabaseUrl };
