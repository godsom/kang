import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import CountdownRing from './CountdownRing.jsx';

describe('CountdownRing', () => {
  test('shows the remaining seconds as large text', () => {
    render(<CountdownRing remaining={7} total={10} />);
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  test('renders a ring (svg with two circles: track + progress)', () => {
    const { container } = render(<CountdownRing remaining={5} total={10} />);
    expect(container.querySelectorAll('circle')).toHaveLength(2);
  });

  test('the progress circle shrinks its dash offset as time runs out', () => {
    const { container: full } = render(<CountdownRing remaining={10} total={10} />);
    const { container: empty } = render(<CountdownRing remaining={0} total={10} />);
    const fullOffset = Number(full.querySelectorAll('circle')[1].getAttribute('stroke-dashoffset'));
    const emptyOffset = Number(empty.querySelectorAll('circle')[1].getAttribute('stroke-dashoffset'));
    expect(fullOffset).toBeCloseTo(0, 1);
    expect(emptyOffset).toBeGreaterThan(fullOffset);
  });
});
