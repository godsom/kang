import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import Table from './Table.jsx';

vi.mock('../socket/SocketProvider.jsx', () => ({
  useSocket: () => ({ socket: globalThis.__mockSocket, connected: true }),
}));
vi.mock('../state/RoomProvider.jsx', () => ({
  useRoom: () => ({ state: globalThis.__mockRoomState, dispatch: globalThis.__mockDispatch }),
}));

function card(rank, suit) {
  return { rank, suit };
}

function baseRoom(overrides = {}) {
  return {
    roomId: 42,
    status: 'in_progress',
    turnIndex: 0,
    awaitingDiscard: false,
    isFirstTurn: false,
    turnDeadline: null,
    discardTop: card(5, 'hearts'),
    settlement: [],
    spectators: [],
    players: [
      { userId: 'alice', username: 'Alice A.', hand: [card(2, 'clubs'), card(9, 'spades')], handCount: 2 },
      { userId: 'bob', username: 'Bobby', handCount: 5 },
    ],
    ...overrides,
  };
}

describe('Table screen', () => {
  beforeEach(() => {
    globalThis.__mockSocket = { emit: vi.fn() };
    globalThis.__mockRoomState = { room: baseRoom(), error: null };
    globalThis.__mockDispatch = vi.fn();
  });

  test('shows the table id, whose turn it is (by username), and the discard pile top', () => {
    render(<Table userId="alice" />);
    expect(screen.getByText('Table #42')).toBeInTheDocument();
    expect(screen.getByText(/Alice A\./)).toBeInTheDocument();
    expect(screen.getByText(/5 of hearts/)).toBeInTheDocument();
  });

  test('Draw emits game:draw', () => {
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByRole('button', { name: 'จั่ว' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:draw');
  });

  test('selecting a card then Discard emits game:discard with that card', () => {
    globalThis.__mockRoomState = { room: baseRoom({ awaitingDiscard: true }), error: null };
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByText('2 of clubs'));
    fireEvent.click(screen.getByRole('button', { name: 'ทิ้ง' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:discard', { card: card(2, 'clubs') });
  });

  test('Eat is disabled until a hand card is selected', () => {
    render(<Table userId="alice" />);
    expect(screen.getByRole('button', { name: 'กิน' })).toBeDisabled();
  });

  test('selecting a card then Eat emits game:eat with the selected hand card', () => {
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByText('2 of clubs'));
    fireEvent.click(screen.getByRole('button', { name: 'กิน' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:eat', { card: card(2, 'clubs') });
  });

  test('Kaeng emits game:kaeng', () => {
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByRole('button', { name: 'แคง' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:kaeng');
  });

  test('hides all action buttons when it is not your turn', () => {
    globalThis.__mockRoomState = { room: baseRoom({ turnIndex: 1 }), error: null };
    render(<Table userId="alice" />);
    expect(screen.queryByRole('button', { name: 'จั่ว' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ทิ้ง' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'กิน' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'แคง' })).not.toBeInTheDocument();
  });

  test('shows only Discard (not Draw/Eat/Kaeng) once already drawn this turn', () => {
    globalThis.__mockRoomState = { room: baseRoom({ awaitingDiscard: true }), error: null };
    render(<Table userId="alice" />);
    expect(screen.queryByRole('button', { name: 'จั่ว' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'กิน' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'แคง' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ทิ้ง' })).toBeInTheDocument();
  });

  test('shows a live countdown derived from turnDeadline', () => {
    const now = Date.now();
    globalThis.__mockRoomState = { room: baseRoom({ turnDeadline: now + 7000 }), error: null };
    render(<Table userId="alice" />);
    expect(screen.getByText(/Time left: \ds/)).toBeInTheDocument();
  });

  test('suggests declaring kaeng when the hand contains a tong', () => {
    globalThis.__mockRoomState = {
      room: baseRoom({
        players: [
          {
            userId: 'alice',
            username: 'Alice A.',
            hand: [card('9', 'clubs'), card('9', 'spades'), card('9', 'hearts'), card('2', 'clubs'), card('4', 'diamonds')],
            handCount: 5,
          },
          { userId: 'bob', username: 'Bobby', handCount: 5 },
        ],
      }),
      error: null,
    };
    render(<Table userId="alice" />);
    expect(screen.getByText(/แนะนำ: แคง! \(ตอง\)/)).toBeInTheDocument();
  });

  test('suggests discarding the highest non-paired card otherwise', () => {
    globalThis.__mockRoomState = {
      room: baseRoom({
        players: [
          {
            userId: 'alice',
            username: 'Alice A.',
            hand: [card('2', 'clubs'), card('2', 'hearts'), card('K', 'spades'), card('7', 'diamonds'), card('3', 'clubs')],
            handCount: 5,
          },
          { userId: 'bob', username: 'Bobby', handCount: 5 },
        ],
      }),
      error: null,
    };
    render(<Table userId="alice" />);
    expect(screen.getByText('K of spades')).toBeInTheDocument();
    expect(screen.getByText('แนะนำทิ้ง')).toBeInTheDocument();
  });

  test('End session emits session:end', () => {
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByRole('button', { name: 'จบเซสชัน' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('session:end');
  });

  test('shows a live payout matrix reflecting the room state, updating as it changes', () => {
    globalThis.__mockRoomState = {
      room: baseRoom({
        settlement: [{ from: 'alice', to: 'bob', points: 3, baht: 15, fromUsername: 'Alice A.', toUsername: 'Bobby' }],
      }),
      error: null,
    };
    render(<Table userId="alice" />);
    expect(screen.getByText(/Alice A\. จ่าย Bobby 15 บาท \(3 แต้ม\)/)).toBeInTheDocument();
  });

  test('shows a no-debt message when the live matrix is empty', () => {
    render(<Table userId="alice" />);
    expect(screen.getByText('ไม่มียอดค้างจ่าย')).toBeInTheDocument();
  });

  test('a spectator watching an in-progress round sees Sit/Quit, not the play buttons', () => {
    render(<Table userId="carol" />);
    expect(screen.getByRole('button', { name: 'นั่งเล่น' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ออกจากห้อง' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'จั่ว' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ทิ้ง' })).not.toBeInTheDocument();
  });

  test('a seated player does not see Sit/Quit', () => {
    render(<Table userId="alice" />);
    expect(screen.queryByRole('button', { name: 'นั่งเล่น' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ออกจากห้อง' })).not.toBeInTheDocument();
  });

  test('Sit emits player:sit and Quit emits player:quit', () => {
    render(<Table userId="carol" />);
    fireEvent.click(screen.getByRole('button', { name: 'นั่งเล่น' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('player:sit');
    fireEvent.click(screen.getByRole('button', { name: 'ออกจากห้อง' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('player:quit');
  });
});
