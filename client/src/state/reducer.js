const initialState = {
  room: null,
  result: null,
  error: null,
  settlement: null,
};

function roomReducer(state, action) {
  switch (action.type) {
    case 'ROOM_STATE':
      return {
        ...state,
        room: action.room,
        error: null,
        result: action.room && action.room.status === 'in_progress' ? null : state.result,
      };
    case 'GAME_RESULT':
      return { ...state, result: action.result };
    case 'CLEAR_RESULT':
      return { ...state, result: null };
    case 'SESSION_SETTLEMENT':
      return { ...state, settlement: action.settlements };
    case 'CLEAR_SETTLEMENT':
      return { ...state, settlement: null };
    case 'ERROR':
      return { ...state, error: action.message };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

export { roomReducer, initialState };
