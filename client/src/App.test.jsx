import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockRoomState = { room: null, result: null, error: null };
vi.mock('./socket/SocketProvider.jsx', () => ({
  SocketProvider: ({ children }) => <div>{children}</div>,
  useSocket: () => ({ socket: { emit: vi.fn() }, connected: true }),
}));
vi.mock('./state/RoomProvider.jsx', () => ({
  RoomProvider: ({ children }) => <div>{children}</div>,
  useRoom: () => ({ state: mockRoomState, dispatch: vi.fn() }),
}));
vi.mock('./api/authClient.js', () => ({
  login: vi.fn(() => Promise.resolve({ token: 'jwt-xyz', userId: 'u2', username: 'bob' })),
  register: vi.fn(),
}));

import App from './App.jsx';

const AUTH_STORAGE_KEY = 'kaeng-auth';

describe('App screen routing', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  test('shows Login when there is no auth', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });

  test('successful login persists auth to sessionStorage', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'bob' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => {
      expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).not.toBeNull();
    });
    expect(JSON.parse(sessionStorage.getItem(AUTH_STORAGE_KEY))).toEqual({
      token: 'jwt-xyz',
      userId: 'u2',
      username: 'bob',
    });
  });

  test('mounting with pre-existing sessionStorage auth skips the Login screen', () => {
    sessionStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({ token: 'jwt-abc', userId: 'u1', username: 'alice' })
    );
    render(<App />);
    expect(screen.queryByRole('button', { name: 'Log in' })).not.toBeInTheDocument();
  });
});
