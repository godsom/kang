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
});
