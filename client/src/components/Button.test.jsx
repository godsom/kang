import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import Button from './Button.jsx';

describe('Button', () => {
  test('renders children and forwards onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Draw</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
    expect(onClick).toHaveBeenCalled();
  });

  test('forwards disabled', () => {
    render(<Button disabled>Discard</Button>);
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
  });
});
