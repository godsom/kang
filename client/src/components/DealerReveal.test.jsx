import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import DealerReveal from './DealerReveal.jsx';

const draws = [
  { userId: 'alice', username: 'Alice A.', card: { rank: 'K', suit: 'spades' } },
  { userId: 'bob', username: 'Bobby', card: { rank: '2', suit: 'hearts' } },
];

describe('DealerReveal', () => {
  test('renders nothing when there are no draws', () => {
    const { container } = render(<DealerReveal draws={null} dealerId={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('shows every player\'s draw and highlights the dealer', () => {
    render(<DealerReveal draws={draws} dealerId="alice" onClose={vi.fn()} />);
    expect(screen.getByText('Alice A.')).toBeInTheDocument();
    expect(screen.getByText('Bobby')).toBeInTheDocument();
    expect(screen.getByText('เจ้ามือ')).toBeInTheDocument();
  });

  test('clicking calls onClose — it never dismisses or reopens on its own', () => {
    const onClose = vi.fn();
    render(<DealerReveal draws={draws} dealerId="alice" onClose={onClose} />);
    fireEvent.click(screen.getByText('Alice A.'));
    expect(onClose).toHaveBeenCalled();
  });
});
