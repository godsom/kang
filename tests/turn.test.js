const { getNextTurn } = require('../src/turn');
const { GAME_CONFIG } = require('../src/config');

describe('getNextTurn — one_way', () => {
  test('advances forward and wraps around', () => {
    let state = { turnIndex: 0, directionSign: 1 };
    const seq = [];
    for (let i = 0; i < 5; i++) {
      state = getNextTurn(state.turnIndex, state.directionSign, 3, GAME_CONFIG.DIRECTION.ONE_WAY);
      seq.push(state.turnIndex);
    }
    expect(seq).toEqual([1, 2, 0, 1, 2]);
  });
});

describe('getNextTurn — alternating', () => {
  test('bounces back and forth between 0 and playerCount - 1', () => {
    let state = { turnIndex: 0, directionSign: 1 };
    const seq = [];
    for (let i = 0; i < 8; i++) {
      state = getNextTurn(state.turnIndex, state.directionSign, 4, GAME_CONFIG.DIRECTION.ALTERNATING);
      seq.push(state.turnIndex);
    }
    expect(seq).toEqual([1, 2, 3, 2, 1, 0, 1, 2]);
  });

  test('works for the minimum table size of 2 players', () => {
    let state = { turnIndex: 0, directionSign: 1 };
    const seq = [];
    for (let i = 0; i < 4; i++) {
      state = getNextTurn(state.turnIndex, state.directionSign, 2, GAME_CONFIG.DIRECTION.ALTERNATING);
      seq.push(state.turnIndex);
    }
    expect(seq).toEqual([1, 0, 1, 0]);
  });
});
