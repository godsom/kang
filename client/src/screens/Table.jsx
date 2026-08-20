import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../socket/SocketProvider.jsx';
import { useRoom } from '../state/RoomProvider.jsx';
import { MELD_LABEL, detectMeldHint, isInstantKaengEligible, pickSuggestedDiscard, sameCard, sortHand, calcHandScore } from '../suggestion.js';
import { groupDiscardPile } from '../discardCascade.js';
import { seatPosition } from '../seatLayout.js';
import Card from '../components/Card.jsx';
import PlayerBadge from '../components/PlayerBadge.jsx';
import Button from '../components/Button.jsx';
import Nav from '../components/Nav.jsx';
import CountdownRing from '../components/CountdownRing.jsx';
import DealerReveal from '../components/DealerReveal.jsx';
import FlyingCard from '../components/FlyingCard.jsx';

const HAND_SIZE = 5;
const DEAL_STEP_MS = 130;

function usernameFor(room, userId) {
  return room.players.find((p) => p.userId === userId)?.username || userId;
}

function cardId(c) {
  return `${c.rank}-${c.suit}`;
}

// Animates the deal one card at a time, dealer first, round-robin by seat,
// until everyone has HAND_SIZE cards — triggered by the room actually going
// waiting -> in_progress (i.e. a real fresh deal), never by routine updates.
function useDealAnimation(room) {
  const prevStatusRef = useRef(room.status);
  const timersRef = useRef([]);
  const [revealed, setRevealed] = useState(null);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = room.status;
    if (prevStatus === room.status || room.status !== 'in_progress') return undefined;

    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    const seated = [...room.players].sort((a, b) => a.seatIndex - b.seatIndex);
    if (seated.length === 0) return undefined;
    const dealerIdx = Math.max(0, seated.findIndex((p) => p.userId === room.dealerId));
    const order = [...seated.slice(dealerIdx), ...seated.slice(0, dealerIdx)];

    const initial = {};
    seated.forEach((p) => { initial[p.userId] = 0; });
    setRevealed(initial);

    const steps = [];
    for (let round = 0; round < HAND_SIZE; round++) {
      order.forEach((p) => steps.push(p.userId));
    }
    steps.forEach((uid, i) => {
      const timer = setTimeout(() => {
        setRevealed((prev) => (prev ? { ...prev, [uid]: (prev[uid] || 0) + 1 } : prev));
        if (i === steps.length - 1) {
          timersRef.current.push(setTimeout(() => setRevealed(null), 250));
        }
      }, i * DEAL_STEP_MS);
      timersRef.current.push(timer);
    });

    return undefined;
  }, [room.status]);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  return revealed;
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
  const { state, dispatch } = useRoom();
  const [selectedCards, setSelectedCards] = useState([]);
  const [activeCard, setActiveCard] = useState(null);
  const [showDealerReveal, setShowDealerReveal] = useState(false);
  const [flyingCards, setFlyingCards] = useState([]);
  const [pendingRemoval, setPendingRemoval] = useState([]);
  const handCardRefs = useRef({});
  const discardPileRef = useRef(null);

  const { room } = state;
  const inProgress = room.status === 'in_progress';
  const me = room.players.find((p) => p.userId === userId);
  const mySpectatorEntry = (room.spectators || []).find((s) => s.userId === userId);
  const isSpectating = !me && !!mySpectatorEntry;
  const turnUserId = room.players[room.turnIndex]?.userId;
  const opponents = room.players.filter((p) => p.userId !== userId);
  const mySeatIndex = me?.seatIndex ?? 0;
  const isMyTurn = inProgress && turnUserId === userId;
  const remaining = useCountdown(room.turnDeadline);
  const dealAnimation = useDealAnimation(room);

  const meldHint = detectMeldHint(me?.hand);
  const instantEligible = room.isFirstTurn && isInstantKaengEligible(me?.hand);
  const suggestedDiscard = pickSuggestedDiscard(me?.hand);
  const sortedHand = sortHand(me?.hand);
  const myRevealedCount = dealAnimation ? (dealAnimation[userId] || 0) : sortedHand.length;
  const displayedHand = sortedHand.slice(0, myRevealedCount).filter((c) => !pendingRemoval.includes(cardId(c)));
  const handScore = calcHandScore(me?.hand);
  const discardClusters = groupDiscardPile(room.discardPile);
  const isMultiSelect = selectedCards.length >= 2 && selectedCards.every((x) => x.rank === selectedCards[0].rank);
  const canDiscard = isMultiSelect || !!activeCard;
  const canEatMulti = isMultiSelect && room.discardTop && selectedCards[0].rank === room.discardTop.rank;
  const canEat = canEatMulti || (!!activeCard && !!room.discardTop);

  // Sends each card flying from its current hand position to the discard
  // pile, and hides it from the hand immediately (pendingRemoval) so it
  // doesn't sit there twice while the real server round-trip is in flight.
  function flyCardsToDiscard(cards) {
    const toEl = discardPileRef.current;
    if (!toEl) return;
    const toRect = toEl.getBoundingClientRect();
    const centerX = toRect.left + toRect.width / 2;
    const centerY = toRect.top + toRect.height / 2;
    const flights = [];
    cards.forEach((c, i) => {
      const el = handCardRefs.current[cardId(c)];
      if (!el) return;
      const fromRect = el.getBoundingClientRect();
      const offset = (i - (cards.length - 1) / 2) * 14;
      flights.push({
        key: `${cardId(c)}-${Date.now()}-${i}`,
        card: c,
        fromRect,
        toRect: {
          left: centerX - fromRect.width / 2 + offset,
          top: centerY - fromRect.height / 2,
        },
        delay: i * 70,
        rotate: offset,
      });
    });
    setFlyingCards((prev) => [...prev, ...flights]);
    setPendingRemoval((prev) => [...prev, ...cards.map(cardId)]);
  }

  function emitDiscard() {
    flyCardsToDiscard(isMultiSelect ? selectedCards : [activeCard]);
    if (isMultiSelect) socket.emit('game:discard', { cards: selectedCards });
    else socket.emit('game:discard', { card: activeCard });
    setSelectedCards([]);
    setActiveCard(null);
  }

  function emitEat() {
    flyCardsToDiscard(canEatMulti ? selectedCards : [activeCard]);
    if (canEatMulti) socket.emit('game:eat', { cards: selectedCards });
    else socket.emit('game:eat', { card: activeCard });
    setSelectedCards([]);
    setActiveCard(null);
  }

  function toggleCard(c) {
    setActiveCard(c);
    setSelectedCards((prev) => (
      prev.some((x) => sameCard(x, c)) ? prev.filter((x) => !sameCard(x, c)) : [...prev, c]
    ));
  }

  // Once the server confirms the card is really gone from the hand, drop it
  // from pendingRemoval — self-healing, no explicit "success" event needed.
  useEffect(() => {
    setPendingRemoval((prev) => prev.filter((id) => (me?.hand || []).some((c) => cardId(c) === id)));
  }, [me?.hand]);

  // A rejected action (e.g. a stale selection after the turn already moved
  // on) must un-hide the card and cancel its flight instead of losing it.
  useEffect(() => {
    if (!state.error) return;
    setPendingRemoval([]);
    setFlyingCards([]);
  }, [state.error]);

  // Hotkeys: D=จั่ว, E=กิน, K=แคง, F=ทิ้ง — each mirrors its button's own
  // enabled condition, so a keypress can never do more than the button could.
  useEffect(() => {
    function onKeyDown(e) {
      if (!isMyTurn || !connected || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (!room.awaitingDiscard) {
        if (key === 'd') socket.emit('game:draw');
        else if (key === 'e' && canEat) emitEat();
        else if (key === 'k') socket.emit('game:kaeng');
      } else if (key === 'f' && canDiscard) {
        emitDiscard();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMyTurn, connected, room.awaitingDiscard, room.discardTop, activeCard, canDiscard, canEat, socket]);

  return (
    <div className="min-h-screen flex flex-col md:flex-row gap-2 px-3 py-2">
      {showDealerReveal && (
        <DealerReveal
          draws={room.firstDealerDraws}
          dealerId={room.dealerId}
          onClose={() => setShowDealerReveal(false)}
        />
      )}
      <aside className="w-full md:w-40 md:sticky md:top-2 md:self-start order-first">
        <Nav active="table" vertical />
      </aside>

      <div className="flex-1 flex flex-col items-center justify-between gap-2">
        <p className="font-display text-gold-400/80 text-xs tracking-widest uppercase">Table #{room.roomId}</p>
        {room.firstDealerDraws && (
          <Button variant="ghost" onClick={() => setShowDealerReveal(true)}>จั่วหาเจ้ามือ</Button>
        )}

        <div className="relative w-full max-w-xl aspect-[3/2]" data-testid="table-seating">
          {/* Felt table surface — always shown, whether or not a round is
              currently in progress, so the table is visible the moment
              you're seated. */}
          <div className="absolute inset-[13%] rounded-[50%] bg-radial-[at_center] from-felt-700 to-felt-950 shadow-2xl flex flex-col items-center justify-center gap-2 border-4 border-felt-900/60">
            {inProgress ? (
              <>
                <p className="font-display text-xl font-bold text-gold-400 tracking-wide">{usernameFor(room, turnUserId)}'s turn</p>
                {isMyTurn && remaining !== null && <CountdownRing remaining={remaining} />}
                <p className="text-cream-50/60 text-xs" data-testid="deck-count">เหลือในสำรับ: {room.deckCount} ใบ</p>
                <div ref={discardPileRef} className="relative min-w-40 min-h-28" data-testid="discard-cascade">
                  {discardClusters.length === 0 && <Card size="lg" />}
                  {discardClusters.map((cluster, ci) => {
                    const mid = (discardClusters.length - 1) / 2;
                    const step = ci - mid;
                    return (
                      <div
                        key={ci}
                        className="absolute top-1/2 left-1/2"
                        style={{
                          transform: `translate(-50%, -50%) translate(${step * 18}px, ${step * 11}px) rotate(${step * 6}deg)`,
                        }}
                      >
                        <div className="relative">
                          {cluster.map((c, i) => (
                            <div key={i} className="absolute" style={{ left: `${i * 5}px`, top: `${i * 3}px` }}>
                              <Card card={c} size="lg" />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="font-display text-lg font-bold text-gold-400/80 tracking-wide text-center px-4">
                {room.readyToDeal
                  ? `รอ ${usernameFor(room, room.dealerId)} (เจ้ามือ) แจกไพ่`
                  : room.dealerId
                    ? `${usernameFor(room, room.dealerId)} เป็นเจ้ามือ — รอทุกคนพร้อม`
                    : 'รอผู้เล่นพร้อม'}
              </p>
            )}
          </div>

          {/* Opponents at their fixed clock seats (8/10/12/2/4 o'clock,
              relative to your own seat at 6 o'clock) — a seat's position
              never shifts just because someone else's seat empties out. */}
          {opponents.map((p) => {
            const { x, y } = seatPosition(mySeatIndex, p.seatIndex);
            const revealedCount = dealAnimation ? (dealAnimation[p.userId] || 0) : (p.handCount ?? 0);
            return (
              <div
                key={p.userId}
                className="absolute flex flex-col items-center gap-1"
                style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
              >
                <PlayerBadge
                  userId={p.username || p.userId}
                  active={inProgress && p.userId === turnUserId}
                  ready={inProgress ? undefined : p.ready}
                  isDealer={p.isDealer}
                  pendingStand={p.pendingStand}
                  connected={p.connected}
                />
                <div className="flex -space-x-6">
                  {Array.from({ length: revealedCount }).map((_, ci) => (
                    <Card key={ci} faceDown size="sm" animate />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {(room.spectators || []).length > 0 && (
          <p className="text-cream-50/70 text-sm text-center">
            Spectators: {room.spectators.map((s) => s.username + (s.pendingSit ? ' (รอเข้ารอบหน้า)' : '')).join(', ')}
          </p>
        )}

        {meldHint && <p role="status" className="text-gold-400 font-display font-bold">แนะนำ: แคง! ({MELD_LABEL[meldHint]})</p>}
        {!meldHint && instantEligible && <p role="status" className="text-gold-400 font-display font-bold">แนะนำ: แคง! (ต่ำ 8)</p>}

        <div className="flex flex-col items-center gap-2 w-full">
          {me && sortedHand.length > 0 && (
            <div
              className="rounded-lg bg-white/5 border border-gold-500/30 px-4 py-1.5 text-center"
              data-testid="hand-score"
            >
              <span className="text-cream-50/60 text-xs uppercase tracking-wide mr-2">แต้มไพ่ในมือ</span>
              <span className="text-gold-400 font-display font-bold text-lg">{handScore}</span>
            </div>
          )}
          <div className="flex justify-center -space-x-6" data-testid="hand">
            {displayedHand.map((c, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <button
                  ref={(el) => { if (el) handCardRefs.current[cardId(c)] = el; }}
                  className="focus:outline-none"
                  onClick={() => toggleCard(c)}
                  aria-pressed={selectedCards.some((x) => sameCard(x, c))}
                >
                  <Card card={c} size="lg" animate selected={selectedCards.some((x) => sameCard(x, c))} />
                </button>
                {!meldHint && !instantEligible && sameCard(c, suggestedDiscard) && (
                  <span className="text-gold-400 text-xs">แนะนำทิ้ง</span>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            {me && !inProgress && (
              <Button disabled={!connected} onClick={() => socket.emit('player:ready', { ready: !me.ready })}>
                {me.ready ? 'Unready' : 'Ready'}
              </Button>
            )}
            {me && !inProgress && room.readyToDeal && room.dealerId === userId && (
              <Button disabled={!connected} onClick={() => socket.emit('game:deal')}>แจกไพ่</Button>
            )}
            {me && (
              <Button
                variant="ghost"
                disabled={!connected || me.pendingStand}
                onClick={() => socket.emit('player:stand')}
              >
                {me.pendingStand ? 'พัก (รอบหน้า)' : 'พัก'}
              </Button>
            )}
            {isSpectating && (
              <Button disabled={!connected} onClick={() => socket.emit('player:sit')}>นั่งเล่น</Button>
            )}
            {((me && !inProgress) || isSpectating) && (
              <Button variant="ghost" disabled={!connected} onClick={() => socket.emit('player:quit')}>ออกจากห้อง</Button>
            )}
          </div>

          {isMyTurn && !dealAnimation && (
            <div className="flex flex-wrap justify-center gap-3">
              {!room.awaitingDiscard && (
                <>
                  <Button disabled={!connected} onClick={() => socket.emit('game:draw')}>จั่ว</Button>
                  {room.discardTop && (
                    <Button
                      disabled={!connected || !canEat}
                      onClick={emitEat}
                    >
                      {canEatMulti ? `กิน (${selectedCards.length} ใบ, x${selectedCards.length})` : 'กิน'}
                    </Button>
                  )}
                  <Button variant="ghost" disabled={!connected} onClick={() => socket.emit('game:kaeng')}>แคง</Button>
                </>
              )}
              {room.awaitingDiscard && (
                <Button
                  disabled={!connected || !canDiscard}
                  onClick={emitDiscard}
                >
                  {isMultiSelect ? `ทิ้ง (${selectedCards.length} ใบ)` : 'ทิ้ง'}
                </Button>
              )}
            </div>
          )}
          {isMyTurn && (
            <p className="text-cream-50/40 text-xs">
              คีย์ลัด: {!room.awaitingDiscard ? 'D จั่ว · E กิน · K แคง' : 'F ทิ้ง'}
            </p>
          )}

          {state.error && <p role="alert" className="text-red-400 text-sm">{state.error}</p>}
        </div>
      </div>

      <aside className="w-full md:w-72 md:sticky md:top-6 md:self-start rounded-2xl bg-felt-900/80 border border-gold-500/30 shadow-card p-4 text-cream-50/80 text-sm">
        <h3 className="font-display text-gold-400 text-center mb-2">ยอดสะสม (5 บาท/แต้ม)</h3>
        {(room.settlement || []).length === 0 && <p className="text-center">ไม่มียอดค้างจ่าย</p>}
        {(room.settlement || []).length > 0 && (
          <table className="w-full text-left">
            <thead>
              <tr className="text-cream-50/50 text-xs uppercase">
                <th className="font-normal pb-1">ยอดที่ต้องจ่าย</th>
                <th className="font-normal pb-1">ผู้รับเงิน</th>
                <th className="font-normal pb-1"></th>
              </tr>
            </thead>
            <tbody>
              {(room.settlement || []).map((s, i) => (
                <tr key={i}>
                  <td className="py-1">{s.baht} บาท</td>
                  <td className="py-1">{s.toUsername}</td>
                  <td className="py-1 text-right">
                    {s.to === userId && (
                      <button
                        className="text-gold-400 text-xs underline"
                        disabled={!connected}
                        onClick={() => socket.emit('settlement:clear', { from: s.from })}
                      >
                        ปิดยอด
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Button
          variant="ghost"
          className="w-full mt-4"
          disabled={!connected}
          onClick={() => socket.emit('session:end')}
        >
          จบเซสชัน
        </Button>

        {state.settlement && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <h3 className="font-display text-gold-400 text-center mb-1">สรุปยอด (5 บาท/แต้ม)</h3>
            {state.settlement.length === 0 && <p className="text-center">ไม่มียอดค้างจ่าย</p>}
            <ul className="text-center">
              {state.settlement.map((s, i) => (
                <li key={i}>
                  {s.fromUsername} จ่าย {s.toUsername} {s.baht} บาท ({s.points} แต้ม)
                </li>
              ))}
            </ul>
            <Button variant="ghost" className="w-full mt-2" onClick={() => dispatch({ type: 'CLEAR_SETTLEMENT' })}>ปิด</Button>
          </div>
        )}
      </aside>

      {flyingCards.map((f) => (
        <FlyingCard
          key={f.key}
          card={f.card}
          fromRect={f.fromRect}
          toRect={f.toRect}
          delay={f.delay}
          rotate={f.rotate}
          onDone={() => setFlyingCards((prev) => prev.filter((x) => x.key !== f.key))}
        />
      ))}
    </div>
  );
}

export default Table;
