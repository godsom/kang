import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import Table from './Table.jsx';

vi.mock('../socket/SocketProvider.jsx', () => ({
  useSocket: () => ({ socket: globalThis.__mockSocket, connected: true }),
}));
vi.mock('../state/RoomProvider.jsx', () => ({
  useRoom: () => ({ state: globalThis.__mockRoomState }),
}));

function card(rank, suit) {
  return { rank, suit };
}

describe('Table screen', () => {
  beforeEach(() => {
    globalThis.__mockSocket = { emit: vi.fn() };
    globalThis.__mockRoomState = {
      room: {
        status: 'in_progress',
        turnIndex: 0,
        discardTop: card(5, 'hearts'),
        players: [
          { userId: 'alice', hand: [card(2, 'clubs'), card(9, 'spades')], handCount: 2 },
          { userId: 'bob', handCount: 5 },
        ],
      },
      error: null,
    };
  });

  test('shows whose turn it is and the discard pile top', () => {
    render(<Table userId="alice" />);
    expect(screen.getByText(/alice/)).toBeInTheDocument();
    expect(screen.getByText(/5 of hearts/)).toBeInTheDocument();
  });

  test('Draw emits game:draw', () => {
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:draw');
  });

  test('selecting a card then Discard emits game:discard with that card', () => {
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByText('2 of clubs'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:discard', { card: card(2, 'clubs') });
  });

  test('Eat is disabled until a hand card is selected', () => {
    render(<Table userId="alice" />);
    expect(screen.getByRole('button', { name: 'Eat' })).toBeDisabled();
  });

  test('selecting a card then Eat emits game:eat with the selected hand card', () => {
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByText('2 of clubs'));
    fireEvent.click(screen.getByRole('button', { name: 'Eat' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:eat', { card: card(2, 'clubs') });
  });

  test('Kaeng emits game:kaeng', () => {
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByRole('button', { name: 'Kaeng' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:kaeng');
  });
});
