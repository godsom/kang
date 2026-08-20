import { createContext, useContext, useEffect, useReducer, useRef } from 'react';
import { roomReducer, initialState } from './reducer.js';

const RoomContext = createContext(null);

function RoomProvider({ socket, children }) {
  const [state, dispatch] = useReducer(roomReducer, initialState);
  const lastRoomIdRef = useRef(null);
  const hasConnectedOnceRef = useRef(false);

  useEffect(() => {
    if (!socket) return;
    const onRoomState = (room) => {
      // Track the last room so a reconnect can rejoin it — but a null room
      // (e.g. after an explicit player:quit) means there's nothing to
      // rejoin, so clear it rather than leaving the previous id behind.
      lastRoomIdRef.current = room && room.roomId ? room.roomId : null;
      dispatch({ type: 'ROOM_STATE', room });
    };
    const onGameResult = (result) => dispatch({ type: 'GAME_RESULT', result });
    const onSessionSettlement = ({ settlements }) => dispatch({ type: 'SESSION_SETTLEMENT', settlements });
    const onRoomError = ({ message }) => dispatch({ type: 'ERROR', message });
    const onGameError = ({ message }) => dispatch({ type: 'ERROR', message });
    const onAuthError = ({ message }) => dispatch({ type: 'ERROR', message });
    const onConnect = () => {
      if (!hasConnectedOnceRef.current) {
        hasConnectedOnceRef.current = true;
        return;
      }
      if (lastRoomIdRef.current) {
        socket.emit('room:join', { roomId: lastRoomIdRef.current });
      }
    };

    socket.on('room:state', onRoomState);
    socket.on('game:result', onGameResult);
    socket.on('session:settlement', onSessionSettlement);
    socket.on('room:error', onRoomError);
    socket.on('game:error', onGameError);
    socket.on('auth:error', onAuthError);
    socket.on('connect', onConnect);

    return () => {
      socket.off('room:state', onRoomState);
      socket.off('game:result', onGameResult);
      socket.off('session:settlement', onSessionSettlement);
      socket.off('room:error', onRoomError);
      socket.off('game:error', onGameError);
      socket.off('auth:error', onAuthError);
      socket.off('connect', onConnect);
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
