import { render, screen, fireEvent, within, act } from '@testing-library/react';
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
    discardPile: [card(5, 'hearts')],
    settlement: [],
    spectators: [{ userId: 'carol', username: 'Carol C.', pendingSit: false }],
    players: [
      { userId: 'alice', username: 'Alice A.', hand: [card(2, 'clubs'), card(9, 'spades')], handCount: 2, seatIndex: 0 },
      { userId: 'bob', username: 'Bobby', handCount: 5, seatIndex: 1 },
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

  test('shows the current hand score for a seated player, not for a spectator', () => {
    render(<Table userId="alice" />);
    // alice's hand: card(2, 'clubs'), card(9, 'spades') -> score 11
    expect(within(screen.getByTestId('hand-score')).getByText('11')).toBeInTheDocument();
  });

  test('shows no hand-score box for a spectator', () => {
    render(<Table userId="carol" />);
    expect(screen.queryByTestId('hand-score')).not.toBeInTheDocument();
  });

  test('seats each opponent around the table, positioned rather than stacked in a row', () => {
    globalThis.__mockRoomState = {
      room: baseRoom({
        players: [
          { userId: 'alice', username: 'Alice A.', hand: [card(2, 'clubs')], handCount: 1, seatIndex: 0 },
          { userId: 'bob', username: 'Bobby', handCount: 5, seatIndex: 1 },
          { userId: 'carol', username: 'Carol C.', handCount: 5, seatIndex: 3 },
        ],
      }),
      error: null,
    };
    render(<Table userId="alice" />);
    const seating = screen.getByTestId('table-seating');
    const bobby = within(seating).getByText('Bobby').closest('div[style]');
    const carol = within(seating).getByText('Carol C.').closest('div[style]');
    expect(bobby.className).toContain('absolute');
    expect(carol.className).toContain('absolute');
    expect(bobby.getAttribute('style')).not.toBe(carol.getAttribute('style'));
  });

  test('renders the discard cascade with each recent card visible, not fully overlapped', () => {
    globalThis.__mockRoomState = {
      room: baseRoom({ discardPile: [card('5', 'clubs'), card('5', 'hearts'), card('9', 'spades')] }),
      error: null,
    };
    render(<Table userId="alice" />);
    const cascade = screen.getByTestId('discard-cascade');
    expect(within(cascade).getByText('5 of clubs')).toBeInTheDocument();
    expect(within(cascade).getByText('5 of hearts')).toBeInTheDocument();
    expect(within(cascade).getByText('9 of spades')).toBeInTheDocument();
  });

  test('Draw emits game:draw', () => {
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByRole('button', { name: 'จั่ว' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:draw');
  });

  test('shows the remaining deck count', () => {
    globalThis.__mockRoomState = { room: baseRoom({ deckCount: 17 }), error: null };
    render(<Table userId="alice" />);
    expect(screen.getByTestId('deck-count')).toHaveTextContent('17');
  });

  describe('hotkeys', () => {
    test('D draws, K declares kaeng, and E eats the active card — only on your turn, before drawing', () => {
      render(<Table userId="alice" />);
      fireEvent.keyDown(window, { key: 'd' });
      expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:draw');

      fireEvent.click(screen.getByText('2 of clubs')); // select active card
      fireEvent.keyDown(window, { key: 'e' });
      expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:eat', { card: card(2, 'clubs') });

      fireEvent.keyDown(window, { key: 'k' });
      expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:kaeng');
    });

    test('F discards the active card, only after drawing', () => {
      globalThis.__mockRoomState = { room: baseRoom({ awaitingDiscard: true }), error: null };
      render(<Table userId="alice" />);
      fireEvent.click(screen.getByText('2 of clubs'));
      fireEvent.keyDown(window, { key: 'f' });
      expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:discard', { card: card(2, 'clubs') });
    });

    test('D does nothing once already drawn this turn (awaitingDiscard)', () => {
      globalThis.__mockRoomState = { room: baseRoom({ awaitingDiscard: true }), error: null };
      render(<Table userId="alice" />);
      fireEvent.keyDown(window, { key: 'd' });
      expect(globalThis.__mockSocket.emit).not.toHaveBeenCalledWith('game:draw');
    });

    test('hotkeys do nothing when it is not your turn', () => {
      globalThis.__mockRoomState = { room: baseRoom({ turnIndex: 1 }), error: null };
      render(<Table userId="alice" />);
      fireEvent.keyDown(window, { key: 'd' });
      fireEvent.keyDown(window, { key: 'k' });
      expect(globalThis.__mockSocket.emit).not.toHaveBeenCalled();
    });
  });

  test('selecting a card then Discard emits game:discard with that card', () => {
    globalThis.__mockRoomState = { room: baseRoom({ awaitingDiscard: true }), error: null };
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByText('2 of clubs'));
    fireEvent.click(screen.getByRole('button', { name: 'ทิ้ง' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:discard', { card: card(2, 'clubs') });
  });

  test('discarding hides the card from hand right away instead of waiting for the server round-trip', () => {
    globalThis.__mockRoomState = { room: baseRoom({ awaitingDiscard: true }), error: null };
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByText('2 of clubs'));
    fireEvent.click(screen.getByRole('button', { name: 'ทิ้ง' }));
    expect(within(screen.getByTestId('hand')).queryByText('2 of clubs')).not.toBeInTheDocument();
  });

  test('a rejected action (game:error) un-hides the card again', () => {
    globalThis.__mockRoomState = { room: baseRoom({ awaitingDiscard: true }), error: null };
    const { rerender } = render(<Table userId="alice" />);
    fireEvent.click(screen.getByText('2 of clubs'));
    fireEvent.click(screen.getByRole('button', { name: 'ทิ้ง' }));
    expect(within(screen.getByTestId('hand')).queryByText('2 of clubs')).not.toBeInTheDocument();

    globalThis.__mockRoomState = { room: baseRoom({ awaitingDiscard: true }), error: 'Not your turn' };
    rerender(<Table userId="alice" />);
    expect(within(screen.getByTestId('hand')).getByText('2 of clubs')).toBeInTheDocument();
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

  test('selecting a matching-rank pair then Eat emits game:eat with both cards, labeled x2', () => {
    globalThis.__mockRoomState = {
      room: baseRoom({
        discardTop: card(2, 'hearts'),
        discardPile: [card(2, 'hearts')],
        players: [
          { userId: 'alice', username: 'Alice A.', hand: [card(2, 'clubs'), card(2, 'diamonds'), card(9, 'spades')], handCount: 3, seatIndex: 0 },
          { userId: 'bob', username: 'Bobby', handCount: 5, seatIndex: 1 },
        ],
      }),
      error: null,
    };
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByText('2 of clubs'));
    fireEvent.click(screen.getByText('2 of diamonds'));
    fireEvent.click(screen.getByRole('button', { name: 'กิน (2 ใบ, x2)' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:eat', { cards: [card(2, 'clubs'), card(2, 'diamonds')] });
  });

  test('a matching-rank pair that does not match the discard top falls back to single-card Eat', () => {
    render(<Table userId="alice" />);
    // default baseRoom discard top is 5 of hearts; alice has no 5s selected here
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

  test('shows a live countdown ring derived from turnDeadline', () => {
    const now = Date.now();
    globalThis.__mockRoomState = { room: baseRoom({ turnDeadline: now + 7000 }), error: null };
    render(<Table userId="alice" />);
    const ring = screen.getByTestId('countdown-ring');
    expect(within(ring).getByText(/^\d$/)).toBeInTheDocument();
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

  test('shows a live payout matrix as a table (amount, payee), updating as it changes', () => {
    globalThis.__mockRoomState = {
      room: baseRoom({
        settlement: [{ from: 'alice', to: 'bob', points: 3, baht: 15, fromUsername: 'Alice A.', toUsername: 'Bobby' }],
      }),
      error: null,
    };
    render(<Table userId="alice" />);
    expect(within(screen.getByRole('table')).getByText('15 บาท')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Bobby')).toBeInTheDocument();
  });

  test('shows a no-debt message when the live matrix is empty', () => {
    render(<Table userId="alice" />);
    expect(screen.getByText('ไม่มียอดค้างจ่าย')).toBeInTheDocument();
  });

  test('shows a ปิดยอด button only on rows where the viewer is the creditor, and it clears that debtor\'s debt', () => {
    globalThis.__mockRoomState = {
      room: baseRoom({
        settlement: [
          { from: 'alice', to: 'bob', points: 3, baht: 15, fromUsername: 'Alice A.', toUsername: 'Bobby' },
          { from: 'bob', to: 'alice', points: 1, baht: 5, fromUsername: 'Bobby', toUsername: 'Alice A.' },
        ],
      }),
      error: null,
    };
    render(<Table userId="alice" />);
    const closeButtons = screen.getAllByRole('button', { name: 'ปิดยอด' });
    expect(closeButtons).toHaveLength(1);
    fireEvent.click(closeButtons[0]);
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('settlement:clear', { from: 'bob' });
  });

  test('the nav ยอดจ่าย link dispatches SHOW_PAYOUT, and หน้าหลัก dispatches SHOW_HOME', () => {
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByRole('button', { name: 'ยอดจ่าย' }));
    expect(globalThis.__mockDispatch).toHaveBeenCalledWith({ type: 'SHOW_PAYOUT' });
    fireEvent.click(screen.getByRole('button', { name: 'หน้าหลัก' }));
    expect(globalThis.__mockDispatch).toHaveBeenCalledWith({ type: 'SHOW_HOME' });
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

  test('clicking two matching-rank cards keeps both selected and discards them together as a multi-discard', () => {
    globalThis.__mockRoomState = {
      room: baseRoom({
        awaitingDiscard: true,
        players: [
          { userId: 'alice', username: 'Alice A.', hand: [card(2, 'clubs'), card(2, 'hearts'), card(9, 'spades')], handCount: 3 },
          { userId: 'bob', username: 'Bobby', handCount: 5 },
        ],
      }),
      error: null,
    };
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByText('2 of clubs'));
    fireEvent.click(screen.getByText('2 of hearts'));
    expect(screen.getByText('2 of clubs').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('2 of hearts').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('9 of spades').closest('button')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'ทิ้ง (2 ใบ)' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:discard', { cards: [card(2, 'clubs'), card(2, 'hearts')] });
  });

  test('clicking two different-rank cards only discards the last-clicked one (single discard)', () => {
    globalThis.__mockRoomState = {
      room: baseRoom({ awaitingDiscard: true }),
      error: null,
    };
    render(<Table userId="alice" />);
    fireEvent.click(screen.getByText('2 of clubs'));
    fireEvent.click(screen.getByText('9 of spades'));
    fireEvent.click(screen.getByRole('button', { name: 'ทิ้ง' }));
    expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:discard', { card: card(9, 'spades') });
  });

  test('clicking an already-selected card deselects it', () => {
    render(<Table userId="alice" />);
    const button = screen.getByText('2 of clubs').closest('button');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  test('hand is displayed sorted by rank', () => {
    globalThis.__mockRoomState = {
      room: baseRoom({
        players: [
          { userId: 'alice', username: 'Alice A.', hand: [card('K', 'spades'), card('2', 'clubs'), card('9', 'hearts')], handCount: 3 },
          { userId: 'bob', username: 'Bobby', handCount: 5 },
        ],
      }),
      error: null,
    };
    render(<Table userId="alice" />);
    const labels = within(screen.getByTestId('hand')).getAllByText(/ of /).map((el) => el.textContent);
    expect(labels).toEqual(['2 of clubs', '9 of hearts', 'K of spades']);
  });

  describe('waiting room (before a round has started)', () => {
    function waitingRoom(overrides = {}) {
      return baseRoom({
        status: 'waiting',
        players: [
          { userId: 'alice', username: 'Alice A.', ready: false, connected: true, isDealer: false, handCount: 0, pendingStand: false },
          { userId: 'bob', username: 'Bobby', ready: true, connected: true, isDealer: false, handCount: 0, pendingStand: false },
        ],
        discardTop: null,
        discardPile: [],
        firstDealerDraws: null,
        ...overrides,
      });
    }

    test('shows the table (seating) immediately, with a Ready toggle, no hand, and no play buttons', () => {
      globalThis.__mockRoomState = { room: waitingRoom(), error: null };
      render(<Table userId="alice" />);
      expect(screen.getByTestId('table-seating')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Ready' })).toBeInTheDocument();
      expect(screen.queryByTestId('hand-score')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'จั่ว' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('discard-cascade')).not.toBeInTheDocument();
    });

    test('Ready toggles player:ready', () => {
      globalThis.__mockRoomState = { room: waitingRoom(), error: null };
      render(<Table userId="alice" />);
      fireEvent.click(screen.getByRole('button', { name: 'Ready' }));
      expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('player:ready', { ready: true });
    });

    test('no แจกไพ่ button while not everyone is ready yet', () => {
      globalThis.__mockRoomState = { room: waitingRoom({ readyToDeal: false, dealerId: 'alice' }), error: null };
      render(<Table userId="alice" />);
      expect(screen.queryByRole('button', { name: 'แจกไพ่' })).not.toBeInTheDocument();
    });

    test('the dealer sees a แจกไพ่ button once everyone is ready, and it emits game:deal', () => {
      globalThis.__mockRoomState = { room: waitingRoom({ readyToDeal: true, dealerId: 'alice' }), error: null };
      render(<Table userId="alice" />);
      fireEvent.click(screen.getByRole('button', { name: 'แจกไพ่' }));
      expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('game:deal');
    });

    test('a non-dealer does not see the แจกไพ่ button even once everyone is ready', () => {
      globalThis.__mockRoomState = { room: waitingRoom({ readyToDeal: true, dealerId: 'bob' }), error: null };
      render(<Table userId="alice" />);
      expect(screen.queryByRole('button', { name: 'แจกไพ่' })).not.toBeInTheDocument();
    });

    test('พัก is always visible for a seated player, and ออกจากห้อง only while waiting', () => {
      globalThis.__mockRoomState = { room: waitingRoom(), error: null };
      render(<Table userId="alice" />);
      expect(screen.getByRole('button', { name: 'พัก' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'ออกจากห้อง' })).toBeInTheDocument();
    });

    test('clicking พัก mid-round (in_progress) still emits player:stand, and relabels once pending', () => {
      render(<Table userId="alice" />); // baseRoom default status is in_progress
      fireEvent.click(screen.getByRole('button', { name: 'พัก' }));
      expect(globalThis.__mockSocket.emit).toHaveBeenCalledWith('player:stand');

      globalThis.__mockRoomState = {
        room: baseRoom({
          players: [
            { userId: 'alice', username: 'Alice A.', hand: [card(2, 'clubs')], handCount: 1, pendingStand: true },
            { userId: 'bob', username: 'Bobby', handCount: 5 },
          ],
        }),
        error: null,
      };
      render(<Table userId="alice" />);
      expect(screen.getByRole('button', { name: 'พัก (รอบหน้า)' })).toBeDisabled();
    });

    test('no ออกจากห้อง button for a seated player mid-round (server would reject it)', () => {
      render(<Table userId="alice" />); // in_progress
      expect(screen.queryByRole('button', { name: 'ออกจากห้อง' })).not.toBeInTheDocument();
    });

    test('shows who is dealer once determined, otherwise a generic waiting message', () => {
      globalThis.__mockRoomState = { room: waitingRoom(), error: null };
      render(<Table userId="alice" />);
      expect(screen.getByText('รอผู้เล่นพร้อม')).toBeInTheDocument();

      globalThis.__mockRoomState = { room: waitingRoom({ dealerId: 'bob' }), error: null };
      render(<Table userId="alice" />);
      expect(screen.getByText(/Bobby เป็นเจ้ามือ/)).toBeInTheDocument();
    });
  });

  test('the first-dealer reveal is manual: hidden until you click จั่วหาเจ้ามือ, and never appears on its own', () => {
    globalThis.__mockRoomState = {
      room: baseRoom({
        firstDealerDraws: [
          { userId: 'alice', username: 'Alice A.', card: card('K', 'spades') },
          { userId: 'bob', username: 'Bobby', card: card('2', 'hearts') },
        ],
        dealerId: 'alice',
      }),
      error: null,
    };
    render(<Table userId="alice" />);
    expect(screen.queryByText('เจ้ามือ')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'จั่วหาเจ้ามือ' }));
    expect(screen.getByText('เจ้ามือ')).toBeInTheDocument();
  });

  test('no จั่วหาเจ้ามือ button before a dealer has ever been determined', () => {
    render(<Table userId="alice" />); // baseRoom has no firstDealerDraws
    expect(screen.queryByRole('button', { name: 'จั่วหาเจ้ามือ' })).not.toBeInTheDocument();
  });

  describe('deal animation', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function seatedPlayers(withHands) {
      return [
        {
          userId: 'alice', username: 'Alice A.', ready: true, connected: true, isDealer: false,
          seatIndex: 0, handCount: withHands ? 5 : 0,
          ...(withHands ? { hand: [card('2', 'clubs'), card('3', 'clubs'), card('4', 'clubs'), card('5', 'clubs'), card('6', 'clubs')] } : {}),
        },
        { userId: 'bob', username: 'Bobby', ready: true, connected: true, isDealer: true, seatIndex: 1, handCount: withHands ? 5 : 0 },
      ];
    }

    test('cards appear one at a time when the room goes from waiting to in_progress, not all at once', () => {
      globalThis.__mockRoomState = {
        room: baseRoom({ status: 'waiting', dealerId: 'bob', players: seatedPlayers(false), discardTop: null, discardPile: [] }),
        error: null,
      };
      const { rerender } = render(<Table userId="alice" />);

      globalThis.__mockRoomState = {
        room: baseRoom({ status: 'in_progress', dealerId: 'bob', turnIndex: 1, players: seatedPlayers(true) }),
        error: null,
      };
      rerender(<Table userId="alice" />);

      const immediately = within(screen.getByTestId('hand')).queryAllByText(/ of /);
      expect(immediately.length).toBeLessThan(5);

      act(() => vi.advanceTimersByTime(2000));
      const afterDealing = within(screen.getByTestId('hand')).queryAllByText(/ of /);
      expect(afterDealing).toHaveLength(5);
    });

    test('action buttons are hidden until the deal animation finishes, even on your turn', () => {
      globalThis.__mockRoomState = {
        room: baseRoom({ status: 'waiting', dealerId: 'alice', players: seatedPlayers(false), discardTop: null, discardPile: [] }),
        error: null,
      };
      const { rerender } = render(<Table userId="alice" />);

      globalThis.__mockRoomState = {
        room: baseRoom({ status: 'in_progress', dealerId: 'alice', turnIndex: 0, players: seatedPlayers(true) }),
        error: null,
      };
      rerender(<Table userId="alice" />);
      expect(screen.queryByRole('button', { name: 'จั่ว' })).not.toBeInTheDocument();

      act(() => vi.advanceTimersByTime(2000));
      expect(screen.getByRole('button', { name: 'จั่ว' })).toBeInTheDocument();
    });
  });
});
