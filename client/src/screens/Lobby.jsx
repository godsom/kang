import { useState } from 'react';
import { useSocket } from '../socket/SocketProvider.jsx';
import { useRoom } from '../state/RoomProvider.jsx';

function Lobby({ userId }) {
  const { socket, connected } = useSocket();
  const { state, dispatch } = useRoom();
  const [roomId, setRoomId] = useState('');

  if (!state.room) {
    return (
      <div>
        <label>
          Table ID
          <input type="number" value={roomId} onChange={(e) => setRoomId(e.target.value)} />
        </label>
        <button
          disabled={!connected || !roomId}
          onClick={() => socket.emit('room:join', { roomId: Number(roomId) })}
        >
          Join
        </button>
        {state.error && <p role="alert">{state.error}</p>}
      </div>
    );
  }

  const me = state.room.players.find((p) => p.userId === userId);
  const mySpectatorEntry = (state.room.spectators || []).find((s) => s.userId === userId);
  const isSpectating = !me && !!mySpectatorEntry;

  return (
    <div>
      <h2>Room</h2>
      <ul>
        {state.room.players.map((p) => (
          <li key={p.userId}>
            {p.username || p.userId}
            {p.ready && <span> (ready)</span>}
            {p.isDealer && <span> (dealer)</span>}
          </li>
        ))}
      </ul>
      {(state.room.spectators || []).length > 0 && (
        <p>
          Spectators: {state.room.spectators.map((s) => s.username + (s.pendingSit ? ' (รอเข้ารอบหน้า)' : '')).join(', ')}
        </p>
      )}

      {me && (
        <>
          <button disabled={!connected} onClick={() => socket.emit('player:ready', { ready: !me.ready })}>
            {me.ready ? 'Unready' : 'Ready'}
          </button>
          <button disabled={!connected} onClick={() => socket.emit('player:stand')}>พัก</button>
        </>
      )}
      {isSpectating && (
        <button disabled={!connected} onClick={() => socket.emit('player:sit')}>นั่งเล่น</button>
      )}
      {(me || isSpectating) && (
        <button disabled={!connected} onClick={() => socket.emit('player:quit')}>ออกจากห้อง</button>
      )}

      <button disabled={!connected} onClick={() => socket.emit('session:end')}>จบเซสชัน</button>

      {state.settlement && (
        <div>
          <h3>สรุปยอด (5 บาท/แต้ม)</h3>
          {state.settlement.length === 0 && <p>ไม่มียอดค้างจ่าย</p>}
          <ul>
            {state.settlement.map((s, i) => (
              <li key={i}>
                {s.fromUsername} จ่าย {s.toUsername} {s.baht} บาท ({s.points} แต้ม)
              </li>
            ))}
          </ul>
          <button onClick={() => dispatch({ type: 'CLEAR_SETTLEMENT' })}>ปิด</button>
        </div>
      )}

      {state.error && <p role="alert">{state.error}</p>}
    </div>
  );
}

export default Lobby;
