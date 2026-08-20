import { useRoom } from '../state/RoomProvider.jsx';
import Button from '../components/Button.jsx';

const REASON_LABELS = {
  instant_kaeng: 'instant kaeng',
  instant_kaeng_lowest: 'instant kaeng',
  split_pot: 'split pot',
  tong: 'ตอง',
  flush: 'flush',
  straight: 'straight',
  deck_exhausted: 'deck exhausted',
  kaeng_call_win: 'แคง (ชนะ)',
  kaeng_call_loss: 'แคง (แพ้)',
};

const BAHT_PER_POINT = 5; // mirrors GAME_CONFIG.BAHT_PER_POINT server-side

// Every loser pays every winner `multiplier` points (src/server/roundEnd.js),
// so each player's net baht change for this round is derivable client-side
// from just the winners list, the multiplier, and the full player roster.
function payoutDeltas(players, winners, multiplier) {
  const loserCount = players.length - winners.length;
  return players.map((p) => {
    const isWinner = winners.includes(p.userId);
    const baht = isWinner
      ? multiplier * BAHT_PER_POINT * loserCount
      : -(multiplier * BAHT_PER_POINT * winners.length);
    return { userId: p.userId, username: p.username || p.userId, handScore: p.handScore, baht, isWinner };
  });
}

function Result() {
  const { state, dispatch } = useRoom();
  const { winners, reason, multiplier, roster } = state.result;
  const isBigWin = multiplier >= 2;
  // The server snapshots who was actually in the round (roster) before any
  // post-round promote/demote can move a player to/from spectator — prefer
  // that over the live room.players, which may have already changed by the
  // time this renders. Older cached results without a roster fall back to
  // room.players + room.spectators.
  const players = roster || state.room?.players || [];
  const spectators = state.room?.spectators || [];
  const nameOf = (id) => (
    players.find((p) => p.userId === id)?.username
    || spectators.find((s) => s.userId === id)?.username
    || id
  );
  const deltas = payoutDeltas(players, winners, multiplier);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-felt-950/90 backdrop-blur-sm px-4 text-center overflow-y-auto py-6"
      onClick={() => dispatch({ type: 'CLEAR_RESULT' })}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-felt-900/90 border border-gold-500/30 shadow-card p-8 flex flex-col items-center gap-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p className={`font-display font-bold tracking-widest ${isBigWin ? 'text-6xl animate-jackpot-blink animate-jackpot-pop' : 'text-4xl text-gold-400'}`}>
          {isBigWin ? 'JACKPOT!' : 'Round Result'}
        </p>

        <p className="font-display text-3xl font-bold text-cream-50">{winners.map(nameOf).join(', ')} wins!</p>

        <div className="flex gap-6 text-cream-50/80">
          <p>
            <span className="block text-xs uppercase tracking-wide text-cream-50/50">Reason</span>
            <span className="text-lg">{REASON_LABELS[reason] ?? reason}</span>
          </p>
          <p>
            <span className="block text-xs uppercase tracking-wide text-cream-50/50">Multiplier</span>
            <span className="text-lg text-gold-400 font-bold">×{multiplier}</span>
          </p>
        </div>

        {deltas.length > 0 && (
          <div className="flex flex-wrap justify-center gap-4">
            {deltas.map((d) => (
              <div key={d.userId} className="flex flex-col items-center gap-1">
                <span className="text-cream-50/80 text-sm">{d.username}</span>
                {d.handScore !== undefined && (
                  <span className="text-cream-50/50 text-xs" data-testid="result-hand-score">
                    แต้มไพ่เหลือ {d.handScore}
                  </span>
                )}
                <span
                  className={`font-display font-bold text-2xl animate-float-fade ${d.isWinner ? 'text-gold-400' : 'text-red-400'}`}
                >
                  {d.baht >= 0 ? `+${d.baht}` : d.baht}
                </span>
              </div>
            ))}
          </div>
        )}

        <Button onClick={() => dispatch({ type: 'CLEAR_RESULT' })}>ปิด</Button>
      </div>
    </div>
  );
}

export default Result;
