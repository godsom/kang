import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import PlayerBadge from './PlayerBadge.jsx';

describe('PlayerBadge', () => {
  test('renders the userId as its own exact text node', () => {
    render(<PlayerBadge userId="alice" ready={false} isDealer={false} />);
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  test('shows a Dealer tag when isDealer is true', () => {
    render(<PlayerBadge userId="bob" ready={true} isDealer={true} />);
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText('Dealer')).toBeInTheDocument();
  });

  test('shows a pending-stand tag only when pendingStand is true', () => {
    const { rerender } = render(<PlayerBadge userId="carol" pendingStand={false} />);
    expect(screen.queryByText('พักรอบหน้า')).not.toBeInTheDocument();
    rerender(<PlayerBadge userId="carol" pendingStand={true} />);
    expect(screen.getByText('พักรอบหน้า')).toBeInTheDocument();
  });
});
