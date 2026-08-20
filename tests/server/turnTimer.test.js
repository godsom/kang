const { pickAutoDiscardCard, createTurnTimerManager, TURN_DURATION_MS } = require('../../src/server/turnTimer');
const { ROOM_STATUS } = require('../../src/server/room');

describe('pickAutoDiscardCard', () => {
  test('prefers discarding the highest-value card that is not part of a pair', () => {
    const hand = [
      { rank: '2', suit: 'clubs' },
      { rank: '2', suit: 'hearts' },
      { rank: 'K', suit: 'spades' },
      { rank: '7', suit: 'diamonds' },
      { rank: '3', suit: 'clubs' },
    ];
    expect(pickAutoDiscardCard(hand)).toEqual({ rank: 'K', suit: 'spades' });
  });

  test('falls back to the highest-value card overall when everything is paired', () => {
    const hand = [
      { rank: '2', suit: 'clubs' },
      { rank: '2', suit: 'hearts' },
      { rank: 'K', suit: 'spades' },
      { rank: 'K', suit: 'diamonds' },
    ];
    expect(pickAutoDiscardCard(hand)).toEqual({ rank: 'K', suit: 'spades' });
  });
});

describe('createTurnTimerManager', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('fires onTimeout after TURN_DURATION_MS and sets turnDeadline', () => {
    const onTimeout = jest.fn();
    const { schedule } = createTurnTimerManager({ onTimeout });
    const room = { id: 'room1', status: ROOM_STATUS.IN_PROGRESS };
    schedule(room);
    expect(room.turnDeadline).toBeGreaterThan(Date.now() - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    jest.advanceTimersByTime(TURN_DURATION_MS);
    expect(onTimeout).toHaveBeenCalledWith('room1');
  });

  test('clear cancels a pending timer', () => {
    const onTimeout = jest.fn();
    const { schedule, clear } = createTurnTimerManager({ onTimeout });
    const room = { id: 'room1', status: ROOM_STATUS.IN_PROGRESS };
    schedule(room);
    clear('room1');
    jest.advanceTimersByTime(TURN_DURATION_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  test('scheduling for a non-in-progress room does not start a timer', () => {
    const onTimeout = jest.fn();
    const { schedule } = createTurnTimerManager({ onTimeout });
    const room = { id: 'room1', status: ROOM_STATUS.WAITING };
    schedule(room);
    expect(room.turnDeadline).toBeNull();
    jest.advanceTimersByTime(TURN_DURATION_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  test('re-scheduling replaces the previous timer', () => {
    const onTimeout = jest.fn();
    const { schedule } = createTurnTimerManager({ onTimeout });
    const room = { id: 'room1', status: ROOM_STATUS.IN_PROGRESS };
    const half = TURN_DURATION_MS / 2;
    schedule(room);
    jest.advanceTimersByTime(half);
    schedule(room);
    jest.advanceTimersByTime(half);
    expect(onTimeout).not.toHaveBeenCalled();
    jest.advanceTimersByTime(half);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});
