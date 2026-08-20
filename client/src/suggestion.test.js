import { describe, test, expect } from 'vitest';
import { calcHandScore } from './suggestion.js';

const c = (rank, suit) => ({ rank, suit });

describe('calcHandScore', () => {
  test('sums rank values, with face cards worth 10', () => {
    expect(calcHandScore([c('A', 's'), c('2', 'h'), c('K', 'd'), c('J', 'c'), c('7', 's')])).toBe(1 + 2 + 10 + 10 + 7);
  });

  test('an empty or missing hand scores 0', () => {
    expect(calcHandScore([])).toBe(0);
    expect(calcHandScore(undefined)).toBe(0);
  });
});
