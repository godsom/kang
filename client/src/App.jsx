import { useState } from 'react';
import { SocketProvider, useSocket } from './socket/SocketProvider.jsx';
import { RoomProvider, useRoom } from './state/RoomProvider.jsx';
import Login from './screens/Login.jsx';
import Lobby from './screens/Lobby.jsx';
import Table from './screens/Table.jsx';
import Result from './screens/Result.jsx';

const AUTH_STORAGE_KEY = 'kaeng-auth';

function readStoredAuth() {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function Screens({ userId }) {
  const { state } = useRoom();
  if (state.result) return <Result />;
  if (state.room && state.room.status === 'in_progress') return <Table userId={userId} />;
  return <Lobby userId={userId} />;
}

function AuthedApp({ auth }) {
  const { socket } = useSocket();
  return (
    <RoomProvider socket={socket}>
      <Screens userId={auth.userId} />
    </RoomProvider>
  );
}

function App() {
  const [auth, setAuth] = useState(readStoredAuth);

  const handleAuthenticated = (newAuth) => {
    try {
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(newAuth));
    } catch {
      // sessionStorage unavailable (e.g. private browsing); auth still works in-memory.
    }
    setAuth(newAuth);
  };

  if (!auth) {
    return <Login onAuthenticated={handleAuthenticated} />;
  }

  return (
    <SocketProvider auth={auth}>
      <AuthedApp auth={auth} />
    </SocketProvider>
  );
}

export default App;
