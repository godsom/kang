import { useState } from 'react';
import { useSocket } from '../socket/SocketProvider.jsx';
import { useRoom } from '../state/RoomProvider.jsx';

function cardLabel(c) {
  return `${c.rank} of ${c.suit}`;
}

function Table({ userId }) {
  const { socket } = useSocket();
  const { state } = useRoom();
  const [selectedCard, setSelectedCard] = useState(null);

  const { room } = state;
  const me = room.players.find((p) => p.userId === userId);
  const turnUserId = room.players[room.turnIndex]?.userId;

  return (
    <div>
      <p>Turn: {turnUserId}</p>
      <p>Discard: {room.discardTop ? cardLabel(room.discardTop) : 'empty'}</p>

      <h3>Your hand</h3>
      <ul>
        {(me?.hand || []).map((c, i) => (
          <li key={i}>
            <button
              onClick={() => setSelectedCard(c)}
              aria-pressed={selectedCard === c}
            >
              {cardLabel(c)}
            </button>
          </li>
        ))}
      </ul>

      <button onClick={() => socket.emit('game:draw')}>Draw</button>
      <button
        disabled={!selectedCard}
        onClick={() => socket.emit('game:discard', { card: selectedCard })}
      >
        Discard
      </button>
      {room.discardTop && (
        <button onClick={() => socket.emit('game:eat', { card: room.discardTop })}>Eat</button>
      )}
      <button onClick={() => socket.emit('game:kaeng')}>Kaeng</button>

      {state.error && <p role="alert">{state.error}</p>}
    </div>
  );
}

export default Table;
