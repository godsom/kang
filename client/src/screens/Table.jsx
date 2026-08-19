import { useEffect, useState } from 'react';
import { useSocket } from '../socket/SocketProvider.jsx';
import { useRoom } from '../state/RoomProvider.jsx';
import { MELD_LABEL, detectMeldHint, isInstantKaengEligible, pickSuggestedDiscard, sameCard } from '../suggestion.js';

function cardLabel(c) {
  return `${c.rank} of ${c.suit}`;
}

function usernameFor(room, userId) {
  return room.players.find((p) => p.userId === userId)?.username || userId;
}

function useCountdown(turnDeadline) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (!turnDeadline) {
      setRemaining(null);
      return undefined;
    }
    const tick = () => setRemaining(Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [turnDeadline]);

  return remaining;
}

function Table({ userId }) {
  const { socket, connected } = useSocket();
  const { state } = useRoom();
  const [selectedCard, setSelectedCard] = useState(null);

  const { room } = state;
  const me = room.players.find((p) => p.userId === userId);
  const isMyTurn = room.players[room.turnIndex]?.userId === userId;
  const remaining = useCountdown(room.turnDeadline);

  const meldHint = detectMeldHint(me?.hand);
  const instantEligible = room.isFirstTurn && isInstantKaengEligible(me?.hand);
  const suggestedDiscard = pickSuggestedDiscard(me?.hand);

  return (
    <div>
      <h2>Table #{room.roomId}</h2>
      <p>Turn: {usernameFor(room, room.players[room.turnIndex]?.userId)}</p>
      {isMyTurn && remaining !== null && <p>Time left: {remaining}s</p>}
      <p>Discard: {room.discardTop ? cardLabel(room.discardTop) : 'empty'}</p>

      {meldHint && <p role="status">แนะนำ: แคง! ({MELD_LABEL[meldHint]})</p>}
      {!meldHint && instantEligible && <p role="status">แนะนำ: แคง! (ต่ำ 8)</p>}

      <h3>Your hand</h3>
      <ul>
        {(me?.hand || []).map((c, i) => (
          <li key={i}>
            <button
              onClick={() => setSelectedCard(c)}
              aria-pressed={selectedCard === c}
            >
              {cardLabel(c)}
              {!meldHint && !instantEligible && sameCard(c, suggestedDiscard) && ' (แนะนำทิ้ง)'}
            </button>
          </li>
        ))}
      </ul>

      {!me && (
        <>
          <button disabled={!connected} onClick={() => socket.emit('player:sit')}>นั่งเล่น</button>
          <button disabled={!connected} onClick={() => socket.emit('player:quit')}>ออกจากห้อง</button>
        </>
      )}

      {isMyTurn && (
        <>
          {!room.awaitingDiscard && (
            <>
              <button disabled={!connected} onClick={() => socket.emit('game:draw')}>จั่ว</button>
              {room.discardTop && (
                <button
                  disabled={!connected || !selectedCard}
                  onClick={() => socket.emit('game:eat', { card: selectedCard })}
                >
                  กิน
                </button>
              )}
              <button disabled={!connected} onClick={() => socket.emit('game:kaeng')}>แคง</button>
            </>
          )}
          {room.awaitingDiscard && (
            <button
              disabled={!connected || !selectedCard}
              onClick={() => socket.emit('game:discard', { card: selectedCard })}
            >
              ทิ้ง
            </button>
          )}
        </>
      )}

      <h3>ยอดสะสม (5 บาท/แต้ม)</h3>
      {(room.settlement || []).length === 0 && <p>ไม่มียอดค้างจ่าย</p>}
      <ul>
        {(room.settlement || []).map((s, i) => (
          <li key={i}>
            {s.fromUsername} จ่าย {s.toUsername} {s.baht} บาท ({s.points} แต้ม)
          </li>
        ))}
      </ul>

      <button disabled={!connected} onClick={() => socket.emit('session:end')}>จบเซสชัน</button>

      {state.error && <p role="alert">{state.error}</p>}
    </div>
  );
}

export default Table;
