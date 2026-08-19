import { describe, test, expect, vi, afterEach } from 'vitest';
import { login, register } from './authClient.js';

describe('authClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('login resolves token/userId/username on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'jwt-abc', user: { id: 'u1', username: 'alice' } }),
    }));
    const result = await login('alice', 'hunter2');
    expect(result).toEqual({ token: 'jwt-abc', userId: 'u1', username: 'alice' });
  });

  test('login throws with server message on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Invalid username or password' }),
    }));
    await expect(login('alice', 'wrong')).rejects.toThrow('Invalid username or password');
  });

  test('register resolves token/userId/username on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'jwt-xyz', user: { id: 'u2', username: 'bob' } }),
    }));
    const result = await register('bob', 'hunter2');
    expect(result).toEqual({ token: 'jwt-xyz', userId: 'u2', username: 'bob' });
  });
});
