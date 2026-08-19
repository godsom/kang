import { useState } from 'react';
import { useSocket } from '../socket/SocketProvider.jsx';
import { useRoom } from '../state/RoomProvider.jsx';

function Lobby({ userId }) {
  const { socket, connected } = useSocket();
  const { state } = useRoom();
  const [roomId, setRoomId] = useState('');

  if (!state.room) {
    return (
      <div>
        <label>
          Room ID
          <input value={roomId} onChange={(e) => setRoomId(e.target.value)} />
        </label>
        <button disabled={!connected} onClick={() => socket.emit('room:join', { roomId })}>Join</button>
        {state.error && <p role="alert">{state.error}</p>}
      </div>
    );
  }

  const me = state.room.players.find((p) => p.userId === userId);

  return (
    <div>
      <h2>Room</h2>
      <ul>
        {state.room.players.map((p) => (
          <li key={p.userId}>
            {p.userId}
            {p.ready && <span> (ready)</span>}
            {p.isDealer && <span> (dealer)</span>}
          </li>
        ))}
      </ul>
      <button disabled={!connected} onClick={() => socket.emit('player:ready', { ready: !me?.ready })}>
        {me?.ready ? 'Unready' : 'Ready'}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </div>
  );
}

export default Lobby;
