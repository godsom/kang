import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import Lobby from './Lobby.jsx';

// Minimal fakes for the two contexts Lobby depends on, avoiding a real socket.
vi.mock('../socket/SocketProvider.jsx', () => ({
  useSocket: () => ({ socket: globalThis.__mockSocket, connected: true }),
}));
vi.mock('../state/RoomProvider.jsx', () => ({
  useRoom: () => ({ state: globalThis.__mockRoomState, dispatch: globalThis.__mockDispatch }),
}));

describe('Lobby screen', () => {
  beforeEach(() => {
    // Reset mocks state
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete globalThis.__mockSocket;
    delete globalThis.__mockRoomState;
    delete globalThis.__mockDispatch;
  });

  test('emits room:join with the typed table id as a number', () => {
    globalThis.__mockSocket = { emit: vi.fn() };
    globalThis.__mockRoomState = { room: null, error: null };
    render(<Lobby userId="alice" />);

    fireEvent.change(screen.getByLabelText('Table ID'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('room:join', { roomId: 42 });
  });

  test('renders the player list by username and a ready toggle once in a room', () => {
    globalThis.__mockSocket = { emit: vi.fn() };
    globalThis.__mockRoomState = {
      room: {
        status: 'waiting',
        players: [
          { userId: 'alice', username: 'Alice A.', ready: false, connected: true, isDealer: false, handCount: 0 },
          { userId: 'bob', username: 'Bobby', ready: true, connected: true, isDealer: false, handCount: 0 },
        ],
      },
      error: null,
    };
    render(<Lobby userId="alice" />);

    expect(screen.getByText('Alice A.')).toBeInTheDocument();
    expect(screen.getByText('Bobby')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ready' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('player:ready', { ready: true });
  });

  test('End session emits session:end', () => {
    globalThis.__mockSocket = { emit: vi.fn() };
    globalThis.__mockRoomState = {
      room: { status: 'waiting', players: [{ userId: 'alice', username: 'Alice A.', ready: false, connected: true, isDealer: false, handCount: 0 }] },
      error: null,
    };
    render(<Lobby userId="alice" />);
    fireEvent.click(screen.getByRole('button', { name: 'จบเซสชัน' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('session:end');
  });

  test('renders the final settlement after a session ends, and clears it on close', () => {
    globalThis.__mockSocket = { emit: vi.fn() };
    globalThis.__mockDispatch = vi.fn();
    globalThis.__mockRoomState = {
      room: { status: 'waiting', players: [{ userId: 'alice', username: 'Alice A.', ready: false, connected: true, isDealer: false, handCount: 0 }] },
      error: null,
      settlement: [{ from: 'alice', to: 'bob', points: 3, baht: 15, fromUsername: 'Alice A.', toUsername: 'Bobby' }],
    };
    render(<Lobby userId="alice" />);
    expect(screen.getByText(/Alice A\. จ่าย Bobby 15 บาท \(3 แต้ม\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }));
    expect(globalThis.__mockDispatch).toHaveBeenCalledWith({ type: 'CLEAR_SETTLEMENT' });
  });

  test('a seated player sees Stand and Quit, and Stand emits player:stand', () => {
    globalThis.__mockSocket = { emit: vi.fn() };
    globalThis.__mockRoomState = {
      room: { status: 'waiting', players: [{ userId: 'alice', username: 'Alice A.', ready: false, connected: true, isDealer: false, handCount: 0 }] },
      error: null,
    };
    render(<Lobby userId="alice" />);
    expect(screen.queryByRole('button', { name: 'นั่งเล่น' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'พัก' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('player:stand');
    fireEvent.click(screen.getByRole('button', { name: 'ออกจากห้อง' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('player:quit');
  });

  test('a spectator (standing player) sees Sit and Quit, and lists any pending sitters', () => {
    globalThis.__mockSocket = { emit: vi.fn() };
    globalThis.__mockRoomState = {
      room: {
        status: 'waiting',
        players: [{ userId: 'bob', username: 'Bobby', ready: false, connected: true, isDealer: false, handCount: 0 }],
        spectators: [{ userId: 'alice', username: 'Alice A.', pendingSit: false }, { userId: 'dan', username: 'Dan', pendingSit: true }],
      },
      error: null,
    };
    render(<Lobby userId="alice" />);
    expect(screen.getByText(/Alice A\./)).toBeInTheDocument();
    expect(screen.getByText(/Dan \(รอเข้ารอบหน้า\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'พัก' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'นั่งเล่น' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('player:sit');
    fireEvent.click(screen.getByRole('button', { name: 'ออกจากห้อง' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('player:quit');
  });
});
