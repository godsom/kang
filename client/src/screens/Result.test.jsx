import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import Result from './Result.jsx';

vi.mock('../state/RoomProvider.jsx', () => ({
  useRoom: () => ({
    state: { result: { winners: ['alice'], reason: 'kaeng', multiplier: 1 } },
    dispatch: globalThis.__mockDispatch,
  }),
}));

describe('Result screen', () => {
  test('shows winners, reason, and multiplier', () => {
    globalThis.__mockDispatch = vi.fn();
    render(<Result />);
    expect(screen.getByText(/alice/)).toBeInTheDocument();
    expect(screen.getByText(/kaeng/)).toBeInTheDocument();
    expect(screen.getByText(/1/)).toBeInTheDocument();
  });

  test('back to lobby dispatches CLEAR_RESULT', () => {
    globalThis.__mockDispatch = vi.fn();
    render(<Result />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to lobby' }));
    expect(globalThis.__mockDispatch).toHaveBeenCalledWith({ type: 'CLEAR_RESULT' });
  });
});
