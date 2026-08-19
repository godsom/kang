import { useState } from 'react';
import { useSocket } from '../socket/SocketProvider.jsx';
import { useRoom } from '../state/RoomProvider.jsx';
import PlayerBadge from '../components/PlayerBadge.jsx';
import Button from '../components/Button.jsx';

function Lobby({ userId }) {
  const { socket, connected } = useSocket();
  const { state } = useRoom();
  const [roomId, setRoomId] = useState('');

  if (!state.room) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl bg-felt-900/80 border border-gold-500/30 shadow-card backdrop-blur-sm p-8">
          <h1 className="font-display text-4xl font-bold text-gold-400 text-center mb-8 tracking-wide">Join a Table</h1>

          <label className="block mb-6">
            <span className="block text-cream-50/70 text-sm mb-1">Room ID</span>
            <input
              className="w-full rounded-lg bg-white/5 border border-white/15 px-4 py-2.5 text-cream-50 text-center text-lg tracking-widest focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />
          </label>

          <Button className="w-full" disabled={!connected} onClick={() => socket.emit('room:join', { roomId })}>
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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 gap-8">
      <h2 className="font-display text-4xl font-bold text-gold-400 tracking-wide">Room</h2>

      <div className="flex flex-wrap justify-center gap-3">
        {state.room.players.map((p) => (
          <PlayerBadge key={p.userId} userId={p.userId} ready={p.ready} isDealer={p.isDealer} connected={p.connected} />
        ))}
      </div>

      <Button disabled={!connected} onClick={() => socket.emit('player:ready', { ready: !me?.ready })}>
        {me?.ready ? 'Unready' : 'Ready'}
      </Button>

      {state.error && <p role="alert" className="text-red-400 text-sm">{state.error}</p>}
    </div>
  );
}

export default Lobby;
