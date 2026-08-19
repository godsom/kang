import { useState } from 'react';
import { useSocket } from '../socket/SocketProvider.jsx';
import { useRoom } from '../state/RoomProvider.jsx';
import PlayerBadge from '../components/PlayerBadge.jsx';
import Button from '../components/Button.jsx';

function Lobby({ userId }) {
  const { socket, connected } = useSocket();
  const { state, dispatch } = useRoom();
  const [roomId, setRoomId] = useState('');

  if (!state.room) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl bg-felt-900/80 border border-gold-500/30 shadow-card backdrop-blur-sm p-8">
          <h1 className="font-display text-4xl font-bold text-gold-400 text-center mb-8 tracking-wide">Join a Table</h1>

          <label className="block mb-6">
            <span className="block text-cream-50/70 text-sm mb-1">Table ID</span>
            <input
              type="number"
              className="w-full rounded-lg bg-white/5 border border-white/15 px-4 py-2.5 text-cream-50 text-center text-lg tracking-widest focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />
          </label>

          <Button
            className="w-full"
            disabled={!connected || !roomId}
            onClick={() => socket.emit('room:join', { roomId: Number(roomId) })}
          >
            Join
          </Button>

          {state.error && (
            <p role="alert" className="mt-4 text-center text-red-400 text-sm">
              {state.error}
            </p>
          )}
        </div>
      </div>
    );
  }

  const me = state.room.players.find((p) => p.userId === userId);
  const mySpectatorEntry = (state.room.spectators || []).find((s) => s.userId === userId);
  const isSpectating = !me && !!mySpectatorEntry;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 gap-8">
      <h2 className="font-display text-4xl font-bold text-gold-400 tracking-wide">Room</h2>

      <div className="flex flex-wrap justify-center gap-3">
        {state.room.players.map((p) => (
          <PlayerBadge key={p.userId} userId={p.username || p.userId} ready={p.ready} isDealer={p.isDealer} connected={p.connected} />
        ))}
      </div>

      {(state.room.spectators || []).length > 0 && (
        <p className="text-cream-50/70 text-sm text-center">
          Spectators: {state.room.spectators.map((s) => s.username + (s.pendingSit ? ' (รอเข้ารอบหน้า)' : '')).join(', ')}
        </p>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        {me && (
          <>
            <Button disabled={!connected} onClick={() => socket.emit('player:ready', { ready: !me.ready })}>
              {me.ready ? 'Unready' : 'Ready'}
            </Button>
            <Button variant="ghost" disabled={!connected} onClick={() => socket.emit('player:stand')}>พัก</Button>
          </>
        )}
        {isSpectating && (
          <Button disabled={!connected} onClick={() => socket.emit('player:sit')}>นั่งเล่น</Button>
        )}
        {(me || isSpectating) && (
          <Button variant="ghost" disabled={!connected} onClick={() => socket.emit('player:quit')}>ออกจากห้อง</Button>
        )}
        <Button variant="ghost" disabled={!connected} onClick={() => socket.emit('session:end')}>จบเซสชัน</Button>
      </div>

      {state.settlement && (
        <div className="w-full max-w-md text-cream-50/80 text-sm text-center">
          <h3 className="font-display text-gold-400 mb-1">สรุปยอด (5 บาท/แต้ม)</h3>
          {state.settlement.length === 0 && <p>ไม่มียอดค้างจ่าย</p>}
          <ul>
            {state.settlement.map((s, i) => (
              <li key={i}>
                {s.fromUsername} จ่าย {s.toUsername} {s.baht} บาท ({s.points} แต้ม)
              </li>
            ))}
          </ul>
          <Button variant="ghost" onClick={() => dispatch({ type: 'CLEAR_SETTLEMENT' })}>ปิด</Button>
        </div>
      )}

      {state.error && <p role="alert" className="text-red-400 text-sm">{state.error}</p>}
    </div>
  );
}

export default Lobby;
