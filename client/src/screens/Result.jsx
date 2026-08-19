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
};

function Result() {
  const { state, dispatch } = useRoom();
  const { winners, reason, multiplier } = state.result;
  const isBigWin = multiplier >= 2;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 gap-6 text-center">
      <p className={`font-display font-bold tracking-widest ${isBigWin ? 'text-6xl animate-jackpot-blink animate-jackpot-pop' : 'text-4xl text-gold-400'}`}>
        {isBigWin ? 'JACKPOT!' : 'Round Result'}
      </p>

      <p className="font-display text-3xl font-bold text-cream-50">{winners.join(', ')} wins!</p>

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

      <Button onClick={() => dispatch({ type: 'CLEAR_RESULT' })}>Back to lobby</Button>
    </div>
  );
}

export default Result;
