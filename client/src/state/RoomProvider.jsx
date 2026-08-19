import { createContext, useContext, useEffect, useReducer } from 'react';
import { roomReducer, initialState } from './reducer.js';

const RoomContext = createContext(null);

function RoomProvider({ socket, children }) {
  const [state, dispatch] = useReducer(roomReducer, initialState);

  useEffect(() => {
    if (!socket) return;
    const onRoomState = (room) => dispatch({ type: 'ROOM_STATE', room });
    const onGameResult = (result) => dispatch({ type: 'GAME_RESULT', result });
    const onRoomError = ({ message }) => dispatch({ type: 'ERROR', message });
    const onGameError = ({ message }) => dispatch({ type: 'ERROR', message });

    socket.on('room:state', onRoomState);
    socket.on('game:result', onGameResult);
    socket.on('room:error', onRoomError);
    socket.on('game:error', onGameError);

    return () => {
      socket.off('room:state', onRoomState);
      socket.off('game:result', onGameResult);
      socket.off('room:error', onRoomError);
      socket.off('game:error', onGameError);
    };
  }, [socket]);

  return (
    <RoomContext.Provider value={{ state, dispatch }}>
      {children}
    </RoomContext.Provider>
  );
}

function useRoom() {
  return useContext(RoomContext);
}

export { RoomProvider, useRoom };
