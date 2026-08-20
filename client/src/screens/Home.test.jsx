import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import Home from './Home.jsx';

vi.mock('../socket/SocketProvider.jsx', () => ({
  useSocket: () => ({ socket: globalThis.__mockSocket, connected: true }),
}));
vi.mock('../state/RoomProvider.jsx', () => ({
  useRoom: () => ({ state: globalThis.__mockRoomState, dispatch: globalThis.__mockDispatch }),
}));

function makeMockSocket() {
  const handlers = {};
  return {
    handlers,
    emit: vi.fn(),
    on: vi.fn((event, cb) => { handlers[event] = cb; }),
    off: vi.fn(),
  };
}

describe('Home screen', () => {
  beforeEach(() => {
    globalThis.__mockSocket = makeMockSocket();
    globalThis.__mockRoomState = { room: null, error: null };
    globalThis.__mockDispatch = vi.fn();
  });

  afterEach(() => {
    delete globalThis.__mockSocket;
    delete globalThis.__mockRoomState;
    delete globalThis.__mockDispatch;
  });

  test('requests rooms:list on mount', () => {
    render(<Home />);
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('rooms:list');
  });

  test('always shows exactly the two fixed tables, even before rooms:list responds', () => {
    render(<Home />);
    expect(screen.getByText('Table #1')).toBeInTheDocument();
    expect(screen.getByText('Table #2')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'เข้าร่วม' })).toHaveLength(2);
  });

  test('fills in live status, player count, and player names once rooms:list responds', () => {
    render(<Home />);
    act(() => {
      globalThis.__mockSocket.handlers['rooms:list']({
        rooms: [{ roomId: 1, status: 'in_progress', playerCount: 2, players: ['alice', 'bob'] }],
      });
    });

    expect(screen.getByText(/กำลังเล่น/)).toBeInTheDocument();
    expect(screen.getByText(/2 คน/)).toBeInTheDocument();
    expect(screen.getByText(/alice, bob/)).toBeInTheDocument();
  });

  test('joining always emits room:join as a spectator, whether the table is waiting or already playing', () => {
    render(<Home />);
    act(() => {
      globalThis.__mockSocket.handlers['rooms:list']({
        rooms: [{ roomId: 1, status: 'in_progress', playerCount: 2, players: ['alice', 'bob'] }],
      });
    });

    const joinButtons = screen.getAllByRole('button', { name: 'เข้าร่วม' });
    expect(joinButtons).toHaveLength(2);
    fireEvent.click(joinButtons[0]);
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('room:join', { roomId: 1, asSpectator: true });
    fireEvent.click(joinButtons[1]);
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('room:join', { roomId: 2, asSpectator: true });
  });

  test('refresh button re-requests rooms:list', () => {
    render(<Home />);
    globalThis.__mockSocket.emit.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'รีเฟรช' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('rooms:list');
  });

  test('shows a way back to your table only when you are already seated somewhere', () => {
    render(<Home />);
    expect(screen.queryByRole('button', { name: 'กลับไปที่โต๊ะของคุณ' })).not.toBeInTheDocument();

    globalThis.__mockRoomState = { room: { roomId: 1, status: 'waiting' }, error: null };
    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: 'กลับไปที่โต๊ะของคุณ' }));
    expect(globalThis.__mockDispatch).toHaveBeenCalledWith({ type: 'HIDE_HOME' });
  });
});
