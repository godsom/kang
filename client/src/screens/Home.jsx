import { useEffect, useState } from 'react';
import { useSocket } from '../socket/SocketProvider.jsx';
import { useRoom } from '../state/RoomProvider.jsx';
import Button from '../components/Button.jsx';
import Nav from '../components/Nav.jsx';

const STATUS_LABEL = { waiting: 'รอผู้เล่น', in_progress: 'กำลังเล่น' };
const TABLE_IDS = [1, 2]; // only two tables exist in this deployment

function Home() {
  const { socket, connected } = useSocket();
  const { state, dispatch } = useRoom();
  const [roomsById, setRoomsById] = useState({});

  useEffect(() => {
    if (!socket) return undefined;
    const onRoomsList = ({ rooms }) => {
      setRoomsById(Object.fromEntries(rooms.map((r) => [r.roomId, r])));
    };
    socket.on('rooms:list', onRoomsList);
    if (connected) socket.emit('rooms:list');
    return () => socket.off('rooms:list', onRoomsList);
  }, [socket, connected]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-lg rounded-2xl bg-felt-900/80 border border-gold-500/30 shadow-card backdrop-blur-sm p-8">
        <Nav active="home" />
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display text-3xl font-bold text-gold-400 tracking-wide">Tables</h1>
          <Button variant="ghost" disabled={!connected} onClick={() => socket.emit('rooms:list')}>รีเฟรช</Button>
        </div>

        <ul className="space-y-2 mb-6">
          {TABLE_IDS.map((roomId) => {
            const r = roomsById[roomId] || { status: 'waiting', playerCount: 0, players: [] };
            return (
              <li key={roomId} className="flex items-center justify-between rounded-lg bg-white/5 border border-white/10 px-4 py-2.5">
                <div>
                  <p className="text-cream-50 font-display font-bold">Table #{roomId}</p>
                  <p className="text-cream-50/60 text-xs">
                    {STATUS_LABEL[r.status] || r.status} · {r.playerCount} คน
                    {r.players.length > 0 && ` · ${r.players.join(', ')}`}
                  </p>
                </div>
                {/* Everyone joins as a spectator first, regardless of table
                    status — sitting down to actually play is a separate,
                    explicit นั่งเล่น step (see Lobby/Table). This is also why
                    a table can hold more than 6 people at once: the spectator
                    cap (50) is what limits joining, not the player cap. */}
                <Button
                  disabled={!connected}
                  onClick={() => socket.emit('room:join', { roomId, asSpectator: true })}
                >
                  เข้าร่วม
                </Button>
              </li>
            );
          })}
        </ul>

        {state.room && (
          <Button variant="ghost" className="w-full" onClick={() => dispatch({ type: 'HIDE_HOME' })}>
            กลับไปที่โต๊ะของคุณ
          </Button>
        )}

        {state.error && (
          <p role="alert" className="mt-4 text-center text-red-400 text-sm">
            {state.error}
          </p>
        )}
      </div>
    </div>
  );
}

export default Home;
