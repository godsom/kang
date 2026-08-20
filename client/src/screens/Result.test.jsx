import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import Result from './Result.jsx';

vi.mock('../state/RoomProvider.jsx', () => ({
  useRoom: () => ({ state: globalThis.__mockState, dispatch: globalThis.__mockDispatch }),
}));

describe('Result screen', () => {
  beforeEach(() => {
    globalThis.__mockDispatch = vi.fn();
    globalThis.__mockState = { result: { winners: ['alice'], reason: 'kaeng', multiplier: 1 } };
  });

  test('shows winners, reason, and multiplier', () => {
    render(<Result />);
    expect(screen.getByText(/alice/)).toBeInTheDocument();
    expect(screen.getByText(/kaeng/)).toBeInTheDocument();
    expect(screen.getByText(/1/)).toBeInTheDocument();
  });

  test('the close button dispatches CLEAR_RESULT', () => {
    render(<Result />);
    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }));
    expect(globalThis.__mockDispatch).toHaveBeenCalledWith({ type: 'CLEAR_RESULT' });
  });

  test('clicking the backdrop also dispatches CLEAR_RESULT (popup, not a page)', () => {
    render(<Result />);
    fireEvent.click(screen.getByText(/wins!/).closest('div.fixed'));
    expect(globalThis.__mockDispatch).toHaveBeenCalledWith({ type: 'CLEAR_RESULT' });
  });

  test('clicking inside the result panel itself does not close it', () => {
    render(<Result />);
    fireEvent.click(screen.getByText(/wins!/));
    expect(globalThis.__mockDispatch).not.toHaveBeenCalled();
  });

  test('shows the winner by username and a floating +baht amount, and losers a floating -baht amount', () => {
    globalThis.__mockState = {
      result: { winners: ['alice'], reason: 'tong', multiplier: 2 },
      room: {
        players: [
          { userId: 'alice', username: 'Alice A.' },
          { userId: 'bob', username: 'Bobby' },
          { userId: 'carol', username: 'Carol C.' },
        ],
      },
    };
    render(<Result />);
    expect(screen.getByText(/Alice A\. wins!/)).toBeInTheDocument();
    // winner: +2 * 5 baht/point * 2 losers = +20
    expect(screen.getByText('+20')).toBeInTheDocument();
    // each loser: -2 * 5 baht/point * 1 winner = -10
    expect(screen.getAllByText('-10')).toHaveLength(2);
  });

  test('shows each player\'s remaining hand score from the roster snapshot, to explain why they won or lost', () => {
    globalThis.__mockState = {
      result: {
        winners: ['bob'],
        reason: 'kaeng_call_win',
        multiplier: 1,
        roster: [
          { userId: 'alice', username: 'Alice A.', handScore: 33 },
          { userId: 'bob', username: 'Bobby', handScore: 9 },
        ],
      },
    };
    render(<Result />);
    expect(screen.getByText('แต้มไพ่เหลือ 33')).toBeInTheDocument();
    expect(screen.getByText('แต้มไพ่เหลือ 9')).toBeInTheDocument();
  });

  test('does not show a hand-score line when the roster (or its handScore) is missing (older cached result)', () => {
    globalThis.__mockState = {
      result: { winners: ['alice'], reason: 'tong', multiplier: 2 },
      room: { players: [{ userId: 'alice', username: 'Alice A.' }] },
    };
    render(<Result />);
    expect(screen.queryByTestId('result-hand-score')).not.toBeInTheDocument();
  });

  test('a kaeng_call_loss shows the caller with a negative amount and everyone else positive', () => {
    globalThis.__mockState = {
      result: { winners: ['bob', 'carol'], reason: 'kaeng_call_loss', multiplier: 1 },
      room: {
        players: [
          { userId: 'alice', username: 'Alice A.' },
          { userId: 'bob', username: 'Bobby' },
          { userId: 'carol', username: 'Carol C.' },
        ],
      },
    };
    render(<Result />);
    // caller (alice, the only loser) pays each of the 2 winners 1*5 = owes 10 total
    expect(screen.getByText('-10')).toBeInTheDocument();
    // each winner only collects from the single loser: +5
    expect(screen.getAllByText('+5')).toHaveLength(2);
  });

  test('a kaeng_call_loss with a real lowest-score winner uses the server points map to double their share', () => {
    globalThis.__mockState = {
      result: {
        winners: ['bob', 'carol'],
        reason: 'kaeng_call_loss',
        multiplier: 1,
        points: { alice: -3, bob: 2, carol: 1 },
      },
      room: {
        players: [
          { userId: 'alice', username: 'Alice A.' },
          { userId: 'bob', username: 'Bobby' },
          { userId: 'carol', username: 'Carol C.' },
        ],
      },
    };
    render(<Result />);
    expect(screen.getByText('-15')).toBeInTheDocument(); // alice: -3 points * 5 baht
    expect(screen.getByText('+10')).toBeInTheDocument(); // bob (the real lowest score): +2 * 5, doubled
    expect(screen.getByText('+5')).toBeInTheDocument(); // carol: +1 * 5, plain rate
  });
});
