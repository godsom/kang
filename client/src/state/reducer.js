const initialState = {
  room: null,
  result: null,
  error: null,
};

function roomReducer(state, action) {
  switch (action.type) {
    case 'ROOM_STATE':
      return { ...state, room: action.room, error: null };
    case 'GAME_RESULT':
      return { ...state, result: action.result };
    case 'CLEAR_RESULT':
      return { ...state, result: null };
    case 'ERROR':
      return { ...state, error: action.message };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

export { roomReducer, initialState };
