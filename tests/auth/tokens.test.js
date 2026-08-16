require('dotenv').config();
const { signToken, verifyToken } = require('../../src/auth/tokens');

const user = { id: 'user-123', username: 'alice' };

describe('signToken / verifyToken', () => {
  test('a signed token verifies back to the original user info', () => {
    const token = signToken(user);
    const result = verifyToken(token);
    expect(result).toEqual({ userId: 'user-123', username: 'alice' });
  });

  test('returns null for a malformed token', () => {
    expect(verifyToken('not-a-real-token')).toBeNull();
  });

  test('returns null for a token signed with a different secret', () => {
    const token = signToken(user, 'a-different-secret');
    expect(verifyToken(token)).toBeNull();
  });

  test('returns null for an expired token', () => {
    const token = signToken(user, process.env.JWT_SECRET, '-10s'); // already expired
    expect(verifyToken(token)).toBeNull();
  });
});
