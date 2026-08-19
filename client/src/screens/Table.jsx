import { useEffect, useState } from 'react';
import { useSocket } from '../socket/SocketProvider.jsx';
import { useRoom } from '../state/RoomProvider.jsx';
import { MELD_LABEL, detectMeldHint, isInstantKaengEligible, pickSuggestedDiscard, sameCard } from '../suggestion.js';
import Card from '../components/Card.jsx';
import PlayerBadge from '../components/PlayerBadge.jsx';
import Button from '../components/Button.jsx';

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
  const turnUserId = room.players[room.turnIndex]?.userId;
  const opponents = room.players.filter((p) => p.userId !== userId);
  const isMyTurn = turnUserId === userId;
  const remaining = useCountdown(room.turnDeadline);

  const meldHint = detectMeldHint(me?.hand);
  const instantEligible = room.isFirstTurn && isInstantKaengEligible(me?.hand);
  const suggestedDiscard = pickSuggestedDiscard(me?.hand);

  return (
    <div className="min-h-screen flex flex-col items-center justify-between px-4 py-6 gap-6">
      <p className="font-display text-gold-400/80 text-sm tracking-widest uppercase">Table #{room.roomId}</p>

      <div className="flex flex-wrap justify-center gap-3">
        {opponents.map((p) => (
          <div key={p.userId} className="flex flex-col items-center gap-1">
            <PlayerBadge userId={p.username || p.userId} active={p.userId === turnUserId} ready={p.ready} isDealer={p.isDealer} connected={p.connected} />
            <div className="flex -space-x-6">
              {Array.from({ length: p.handCount ?? 0 }).map((_, i) => (
                <Card key={i} faceDown size="sm" />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="w-full max-w-2xl aspect-[2/1] rounded-[50%] bg-radial-[at_center] from-felt-700 to-felt-950 shadow-2xl flex flex-col items-center justify-center gap-3 border-4 border-felt-900/60">
        <p className="font-display text-3xl font-bold text-gold-400 tracking-wide">{usernameFor(room, turnUserId)}'s turn</p>
        {isMyTurn && remaining !== null && <p className="text-cream-50/80 text-sm">Time left: {remaining}s</p>}
        <Card card={room.discardTop} size="lg" />
      </div>

      {meldHint && <p role="status" className="text-gold-400 font-display font-bold">แนะนำ: แคง! ({MELD_LABEL[meldHint]})</p>}
      {!meldHint && instantEligible && <p role="status" className="text-gold-400 font-display font-bold">แนะนำ: แคง! (ต่ำ 8)</p>}

      <div className="flex flex-col items-center gap-4 w-full">
        <div className="flex justify-center -space-x-6">
          {(me?.hand || []).map((c, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <button
                className="focus:outline-none"
                onClick={() => setSelectedCard(c)}
                aria-pressed={selectedCard === c}
              >
                <Card card={c} selected={selectedCard === c} />
              </button>
              {!meldHint && !instantEligible && sameCard(c, suggestedDiscard) && (
                <span className="text-gold-400 text-xs">แนะนำทิ้ง</span>
              )}
            </div>
          ))}
        </div>

        {!me && (
          <div className="flex flex-wrap justify-center gap-3">
            <Button disabled={!connected} onClick={() => socket.emit('player:sit')}>นั่งเล่น</Button>
            <Button variant="ghost" disabled={!connected} onClick={() => socket.emit('player:quit')}>ออกจากห้อง</Button>
          </div>
        )}

        {isMyTurn && (
          <div className="flex flex-wrap justify-center gap-3">
            {!room.awaitingDiscard && (
              <>
                <Button disabled={!connected} onClick={() => socket.emit('game:draw')}>จั่ว</Button>
                {room.discardTop && (
                  <Button
                    disabled={!connected || !selectedCard}
                    onClick={() => socket.emit('game:eat', { card: selectedCard })}
                  >
                    กิน
                  </Button>
                )}
                <Button variant="ghost" disabled={!connected} onClick={() => socket.emit('game:kaeng')}>แคง</Button>
              </>
            )}
            {room.awaitingDiscard && (
              <Button
                disabled={!connected || !selectedCard}
                onClick={() => socket.emit('game:discard', { card: selectedCard })}
              >
                ทิ้ง
              </Button>
            )}
          </div>
        )}

        <div className="w-full max-w-md text-cream-50/80 text-sm">
          <h3 className="font-display text-gold-400 text-center mb-1">ยอดสะสม (5 บาท/แต้ม)</h3>
          {(room.settlement || []).length === 0 && <p className="text-center">ไม่มียอดค้างจ่าย</p>}
          <ul className="text-center">
            {(room.settlement || []).map((s, i) => (
              <li key={i}>
                {s.fromUsername} จ่าย {s.toUsername} {s.baht} บาท ({s.points} แต้ม)
              </li>
            ))}
          </ul>
        </div>

        <Button variant="ghost" disabled={!connected} onClick={() => socket.emit('session:end')}>จบเซสชัน</Button>

        {state.error && <p role="alert" className="text-red-400 text-sm">{state.error}</p>}
      </div>
    </div>
  );
}

export default Table;
