import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import Lobby from './Lobby.jsx';

// Minimal fakes for the two contexts Lobby depends on, avoiding a real socket.
vi.mock('../socket/SocketProvider.jsx', () => ({
  useSocket: () => ({ socket: globalThis.__mockSocket, connected: true }),
}));
vi.mock('../state/RoomProvider.jsx', () => ({
  useRoom: () => ({ state: globalThis.__mockRoomState }),
}));

describe('Lobby screen', () => {
  beforeEach(() => {
    // Reset mocks state
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete globalThis.__mockSocket;
    delete globalThis.__mockRoomState;
  });

  test('emits room:join with the typed room id', () => {
    globalThis.__mockSocket = { emit: vi.fn() };
    globalThis.__mockRoomState = { room: null, error: null };
    render(<Lobby userId="alice" />);

    fireEvent.change(screen.getByLabelText('Room ID'), { target: { value: 'room42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('room:join', { roomId: 'room42' });
  });

  test('renders the player list and a ready toggle once in a room', () => {
    globalThis.__mockSocket = { emit: vi.fn() };
    globalThis.__mockRoomState = {
      room: {
        status: 'waiting',
        players: [
          { userId: 'alice', ready: false, connected: true, isDealer: false, handCount: 0 },
          { userId: 'bob', ready: true, connected: true, isDealer: false, handCount: 0 },
        ],
      },
      error: null,
    };
    render(<Lobby userId="alice" />);

    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ready' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('player:ready', { ready: true });
  });
});
