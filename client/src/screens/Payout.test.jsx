import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import Payout from './Payout.jsx';

vi.mock('../socket/SocketProvider.jsx', () => ({
  useSocket: () => ({ socket: globalThis.__mockSocket, connected: true }),
}));
vi.mock('../state/RoomProvider.jsx', () => ({
  useRoom: () => ({ state: globalThis.__mockRoomState, dispatch: globalThis.__mockDispatch }),
}));

describe('Payout screen', () => {
  beforeEach(() => {
    globalThis.__mockSocket = { emit: vi.fn() };
    globalThis.__mockDispatch = vi.fn();
  });

  test('splits debts into what you owe (read-only) and what is owed to you (with ปิดยอด)', () => {
    globalThis.__mockRoomState = {
      room: {
        settlement: [
          { from: 'alice', to: 'bob', points: 3, baht: 15, fromUsername: 'Alice A.', toUsername: 'Bobby' },
          { from: 'carol', to: 'alice', points: 1, baht: 5, fromUsername: 'Carol C.', toUsername: 'Alice A.' },
        ],
      },
    };
    render(<Payout userId="alice" />);

    expect(screen.getByText('15 บาท')).toBeInTheDocument();
    expect(screen.getByText('Bobby')).toBeInTheDocument();
    expect(screen.getByText('5 บาท')).toBeInTheDocument();
    expect(screen.getByText('Carol C.')).toBeInTheDocument();

    const closeButtons = screen.getAllByRole('button', { name: 'ปิดยอด' });
    expect(closeButtons).toHaveLength(1);
    fireEvent.click(closeButtons[0]);
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('settlement:clear', { from: 'carol' });
  });

  test('shows placeholder text when a section is empty', () => {
    globalThis.__mockRoomState = { room: { settlement: [] } };
    render(<Payout userId="alice" />);
    expect(screen.getByText('ไม่มียอดที่ต้องจ่าย')).toBeInTheDocument();
    expect(screen.getByText('ไม่มียอดที่ต้องได้รับ')).toBeInTheDocument();
  });

  test('Back dispatches HIDE_PAYOUT', () => {
    globalThis.__mockRoomState = { room: { settlement: [] } };
    render(<Payout userId="alice" />);
    fireEvent.click(screen.getByRole('button', { name: 'กลับ' }));
    expect(globalThis.__mockDispatch).toHaveBeenCalledWith({ type: 'HIDE_PAYOUT' });
  });
});
