import { describe, test, expect } from 'vitest';
import { roomReducer, initialState } from './reducer.js';

describe('roomReducer', () => {
  test('ROOM_STATE sets room and clears error', () => {
    const state = roomReducer({ ...initialState, error: 'stale' }, { type: 'ROOM_STATE', room: { status: 'waiting' } });
    expect(state.room).toEqual({ status: 'waiting' });
    expect(state.error).toBeNull();
  });

  test('ROOM_STATE clears a stale result when the new room is in_progress', () => {
    const state = roomReducer(
      { ...initialState, result: { winners: ['alice'], reason: 'kaeng', multiplier: 1 } },
      { type: 'ROOM_STATE', room: { status: 'in_progress' } }
    );
    expect(state.result).toBeNull();
    expect(state.room).toEqual({ status: 'in_progress' });
  });

  test('ROOM_STATE preserves an existing result when the new room is not in_progress', () => {
    const state = roomReducer(
      { ...initialState, result: { winners: ['alice'], reason: 'kaeng', multiplier: 1 } },
      { type: 'ROOM_STATE', room: { status: 'waiting' } }
    );
    expect(state.result).toEqual({ winners: ['alice'], reason: 'kaeng', multiplier: 1 });
  });

  test('GAME_RESULT sets result', () => {
    const state = roomReducer(initialState, { type: 'GAME_RESULT', result: { winners: ['alice'], reason: 'kaeng', multiplier: 1 } });
    expect(state.result).toEqual({ winners: ['alice'], reason: 'kaeng', multiplier: 1 });
  });

  test('CLEAR_RESULT clears result', () => {
    const state = roomReducer({ ...initialState, result: { winners: [] } }, { type: 'CLEAR_RESULT' });
    expect(state.result).toBeNull();
  });

  test('ERROR sets error message', () => {
    const state = roomReducer(initialState, { type: 'ERROR', message: 'Room is full' });
    expect(state.error).toBe('Room is full');
  });

  test('CLEAR_ERROR clears error', () => {
    const state = roomReducer({ ...initialState, error: 'x' }, { type: 'CLEAR_ERROR' });
    expect(state.error).toBeNull();
  });

  test('SESSION_SETTLEMENT sets settlement', () => {
    const settlements = [{ from: 'a', to: 'b', points: 1, baht: 5 }];
    const state = roomReducer(initialState, { type: 'SESSION_SETTLEMENT', settlements });
    expect(state.settlement).toEqual(settlements);
  });

  test('CLEAR_SETTLEMENT clears settlement', () => {
    const state = roomReducer({ ...initialState, settlement: [{ from: 'a', to: 'b' }] }, { type: 'CLEAR_SETTLEMENT' });
    expect(state.settlement).toBeNull();
  });

  test('unknown action returns state unchanged', () => {
    expect(roomReducer(initialState, { type: 'NOPE' })).toBe(initialState);
  });
});
