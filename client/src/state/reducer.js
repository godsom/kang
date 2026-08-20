const initialState = {
  room: null,
  result: null,
  error: null,
  settlement: null,
  showPayout: false,
  viewHome: false,
};

function roomReducer(state, action) {
  switch (action.type) {
    case 'ROOM_STATE': {
      // A same-room refresh (e.g. an opponent's move) shouldn't yank the
      // user out of browsing the table list back to their own table — only
      // an actual switch to a different (or no) room resets that.
      const sameRoom = !!action.room && !!state.room && action.room.roomId === state.room.roomId;
      return {
        ...state,
        room: action.room,
        error: null,
        viewHome: sameRoom ? state.viewHome : false,
        result: action.room && action.room.status === 'in_progress' ? null : state.result,
      };
    }
    case 'GAME_RESULT':
      return { ...state, result: action.result };
    case 'CLEAR_RESULT':
      return { ...state, result: null };
    case 'SESSION_SETTLEMENT':
      return { ...state, settlement: action.settlements };
    case 'CLEAR_SETTLEMENT':
      return { ...state, settlement: null };
    case 'SHOW_PAYOUT':
      return { ...state, showPayout: true };
    case 'HIDE_PAYOUT':
      return { ...state, showPayout: false };
    case 'SHOW_HOME':
      return { ...state, viewHome: true, showPayout: false };
    case 'HIDE_HOME':
      return { ...state, viewHome: false };
    case 'ERROR':
      return { ...state, error: action.message };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

export { roomReducer, initialState };
