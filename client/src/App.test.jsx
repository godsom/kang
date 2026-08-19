import { render, screen } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';

const mockRoomState = { room: null, result: null, error: null };
vi.mock('./socket/SocketProvider.jsx', () => ({
  SocketProvider: ({ children }) => <div>{children}</div>,
  useSocket: () => ({ socket: { emit: vi.fn() }, connected: true }),
}));
vi.mock('./state/RoomProvider.jsx', () => ({
  RoomProvider: ({ children }) => <div>{children}</div>,
  useRoom: () => ({ state: mockRoomState, dispatch: vi.fn() }),
}));

import App from './App.jsx';

describe('App screen routing', () => {
  test('shows Login when there is no auth', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });
});
