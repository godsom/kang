import Card from './Card.jsx';

// Manually opened overlay: shows each player's single "who deals first" draw,
// highlighting the winner. Purely presentational — the caller controls when
// it's shown (a button click) and closes it (onClose), no auto-show/auto-hide
// of its own, so it can never pop open on its own.
function DealerReveal({ draws, dealerId, onClose }) {
  if (!draws) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-felt-950/90 backdrop-blur-sm cursor-pointer"
      onClick={onClose}
    >
      <p className="font-display text-2xl font-bold text-gold-400 tracking-wide">จั่วไพ่หาเจ้ามือ</p>
      <div className="flex flex-wrap justify-center gap-4">
        {draws.map((d) => (
          <div key={d.userId} className="flex flex-col items-center gap-2">
            <Card card={d.card} size="md" selected={d.userId === dealerId} />
            <span className={`font-display font-bold ${d.userId === dealerId ? 'text-gold-400' : 'text-cream-50/70'}`}>
              {d.username}
            </span>
            {d.userId === dealerId && <span className="text-gold-400 text-xs uppercase tracking-wide">เจ้ามือ</span>}
          </div>
        ))}
      </div>
      <p className="text-cream-50/50 text-xs">แตะเพื่อปิด</p>
    </div>
  );
}

export default DealerReveal;
