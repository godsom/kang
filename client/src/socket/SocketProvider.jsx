import { createContext, useContext, useEffect, useState } from 'react';
import io from 'socket.io-client';

const GAME_SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL || 'http://localhost:3001';

const SocketContext = createContext(null);

function SocketProvider({ auth, children }) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!auth) {
      setSocket(null);
      setConnected(false);
      return;
    }
    const s = io(GAME_SERVER_URL);
    s.on('connect', () => {
      s.emit('auth', { token: auth.token });
      setConnected(true);
    });
    s.on('disconnect', () => setConnected(false));
    setSocket(s);
    return () => s.close();
  }, [auth]);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

function useSocket() {
  return useContext(SocketContext);
}

export { SocketProvider, useSocket };
