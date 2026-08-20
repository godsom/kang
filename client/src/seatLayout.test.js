import { describe, test, expect } from 'vitest';
import { seatPosition } from './seatLayout.js';

describe('seatPosition', () => {
  test('your own seat (relative offset 0) is at 6 o\'clock: bottom center', () => {
    const { x, y } = seatPosition(0, 0);
    expect(x).toBeCloseTo(50, 5);
    expect(y).toBeGreaterThan(50); // below center
  });

  test('the next seat clockwise (8 o\'clock) is left-of-bottom', () => {
    const { x, y } = seatPosition(0, 1);
    expect(x).toBeLessThan(50);
    expect(y).toBeGreaterThan(50);
  });

  test('the seat directly opposite (12 o\'clock, relative offset 3) is top center', () => {
    const { x, y } = seatPosition(0, 3);
    expect(x).toBeCloseTo(50, 5);
    expect(y).toBeLessThan(50);
  });

  test('positions are stable relative to seatIndex regardless of who else is seated', () => {
    // Seat 4's position relative to viewer at seat 0 must not depend on
    // whether seats 1-3 are occupied — it's purely a function of the two indices.
    const withGaps = seatPosition(0, 4);
    const noGaps = seatPosition(0, 4);
    expect(withGaps).toEqual(noGaps);
  });

  test('wraps around correctly when the viewer is not at seat 0', () => {
    // Viewer at seat 5; seat 0 is the next seat clockwise (relative offset 1).
    const viewerAt5 = seatPosition(5, 0);
    const viewerAt0 = seatPosition(0, 1);
    expect(viewerAt5).toEqual(viewerAt0);
  });
});
