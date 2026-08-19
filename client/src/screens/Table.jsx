import { useState } from 'react';
import { useSocket } from '../socket/SocketProvider.jsx';
import { useRoom } from '../state/RoomProvider.jsx';
import Card from '../components/Card.jsx';
import PlayerBadge from '../components/PlayerBadge.jsx';
import Button from '../components/Button.jsx';

function Table({ userId }) {
  const { socket, connected } = useSocket();
  const { state } = useRoom();
  const [selectedCard, setSelectedCard] = useState(null);

  const { room } = state;
  const me = room.players.find((p) => p.userId === userId);
  const turnUserId = room.players[room.turnIndex]?.userId;
  const opponents = room.players.filter((p) => p.userId !== userId);

  return (
    <div className="min-h-screen flex flex-col items-center justify-between px-4 py-6 gap-6">
      <div className="flex flex-wrap justify-center gap-3">
        {opponents.map((p) => (
          <div key={p.userId} className="flex flex-col items-center gap-1">
            <PlayerBadge userId={p.userId} active={p.userId === turnUserId} ready={p.ready} isDealer={p.isDealer} connected={p.connected} />
            <div className="flex -space-x-6">
              {Array.from({ length: p.handCount ?? 0 }).map((_, i) => (
                <Card key={i} faceDown size="sm" />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="w-full max-w-2xl aspect-[2/1] rounded-[50%] bg-radial-[at_center] from-felt-700 to-felt-950 shadow-2xl flex flex-col items-center justify-center gap-3 border-4 border-felt-900/60">
        <p className="font-display text-3xl font-bold text-gold-400 tracking-wide">{turnUserId}'s turn</p>
        <Card card={room.discardTop} size="lg" />
      </div>

      <div className="flex flex-col items-center gap-4 w-full">
        <div className="flex justify-center -space-x-6">
          {(me?.hand || []).map((c, i) => (
            <button
              key={i}
              className="focus:outline-none"
              onClick={() => setSelectedCard(c)}
              aria-pressed={selectedCard === c}
            >
              <Card card={c} selected={selectedCard === c} />
            </button>
          ))}
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <Button disabled={!connected} onClick={() => socket.emit('game:draw')}>
            Draw
          </Button>
          <Button
            disabled={!connected || !selectedCard}
            onClick={() => socket.emit('game:discard', { card: selectedCard })}
          >
            Discard
          </Button>
          {room.discardTop && (
            <Button
              disabled={!connected || !selectedCard}
              onClick={() => socket.emit('game:eat', { card: selectedCard })}
            >
              Eat
            </Button>
          )}
          <Button variant="ghost" disabled={!connected} onClick={() => socket.emit('game:kaeng')}>
            Kaeng
          </Button>
        </div>

        {state.error && <p role="alert" className="text-red-400 text-sm">{state.error}</p>}
      </div>
    </div>
  );
}

export default Table;
