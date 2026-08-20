import { useState } from 'react';
import { SocketProvider, useSocket } from './socket/SocketProvider.jsx';
import { RoomProvider, useRoom } from './state/RoomProvider.jsx';
import { AuthContext } from './state/AuthContext.js';
import Login from './screens/Login.jsx';
import Home from './screens/Home.jsx';
import Table from './screens/Table.jsx';
import Result from './screens/Result.jsx';
import Payout from './screens/Payout.jsx';

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
  if (state.showPayout && state.room) return <Payout userId={userId} />;
  if (state.viewHome) return <Home />;
  if (state.room) {
    // The round result is a popup over the table, not a page swap — the
    // table stays mounted underneath so closing it doesn't lose your seat.
    return (
      <>
        <Table userId={userId} />
        {state.result && <Result />}
      </>
    );
  }
  if (state.result) return <Result />;
  return <Home />;
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

  const handleLogout = () => {
    try {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      // sessionStorage unavailable — auth was in-memory only anyway.
    }
    setAuth(null);
  };

  if (!auth) {
    return <Login onAuthenticated={handleAuthenticated} />;
  }

  return (
    <AuthContext.Provider value={{ logout: handleLogout }}>
      <SocketProvider auth={auth}>
        <AuthedApp auth={auth} />
      </SocketProvider>
    </AuthContext.Provider>
  );
}

export default App;
