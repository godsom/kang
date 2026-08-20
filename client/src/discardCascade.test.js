import { describe, test, expect } from 'vitest';
import { groupDiscardPile } from './discardCascade.js';

const c = (rank, suit) => ({ rank, suit });

describe('groupDiscardPile', () => {
  test('groups consecutive same-rank cards (a double) into one cluster', () => {
    const pile = [c('5', 'clubs'), c('5', 'hearts'), c('9', 'spades')];
    expect(groupDiscardPile(pile)).toEqual([
      [c('5', 'clubs'), c('5', 'hearts')],
      [c('9', 'spades')],
    ]);
  });

  test('does not merge same-rank cards separated by a different rank', () => {
    const pile = [c('5', 'clubs'), c('9', 'spades'), c('5', 'hearts')];
    expect(groupDiscardPile(pile)).toEqual([
      [c('5', 'clubs')],
      [c('9', 'spades')],
      [c('5', 'hearts')],
    ]);
  });

  test('handles an empty or missing pile', () => {
    expect(groupDiscardPile([])).toEqual([]);
    expect(groupDiscardPile(undefined)).toEqual([]);
  });

  test('a chain of eats on the same rank forms one cluster', () => {
    const pile = [c('K', 'clubs'), c('K', 'hearts'), c('K', 'spades')];
    expect(groupDiscardPile(pile)).toEqual([[c('K', 'clubs'), c('K', 'hearts'), c('K', 'spades')]]);
  });
});
