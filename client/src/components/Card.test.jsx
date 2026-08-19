import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import Card, { cardLabel } from './Card.jsx';

describe('Card', () => {
  test('cardLabel formats rank and suit', () => {
    expect(cardLabel({ rank: 2, suit: 'clubs' })).toBe('2 of clubs');
  });

  test('renders rank and suit visually, plus an accessible label', () => {
    render(<Card card={{ rank: 'K', suit: 'hearts' }} />);
    expect(screen.getAllByText('K')).toHaveLength(2);
    expect(screen.getByText('♥')).toBeInTheDocument();
    expect(screen.getByText('K of hearts')).toBeInTheDocument();
  });

  test('face-down card has no rank/suit text, only an aria-hidden back', () => {
    render(<Card faceDown />);
    expect(screen.queryByText(/of/)).not.toBeInTheDocument();
  });

  test('no card and not faceDown also renders a card back', () => {
    const { container } = render(<Card />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});
