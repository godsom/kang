function PlayerBadge({ userId, active = false, ready, isDealer, pendingStand = false, connected = true, className = '' }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full px-4 py-2 bg-felt-900/70 backdrop-blur-sm border transition-shadow ${
        active ? 'border-gold-400 shadow-gold animate-turn-pulse' : 'border-white/10'
      } ${connected ? '' : 'opacity-40'} ${className}`}
    >
      <span className="font-display font-bold text-cream-50 text-base">{userId}</span>
      {isDealer && <span className="text-gold-400 text-xs uppercase tracking-wide">Dealer</span>}
      {ready === true && <span className="text-felt-600 text-xs">●</span>}
      {ready === false && <span className="text-white/30 text-xs">○</span>}
      {pendingStand && <span className="text-red-400 text-xs uppercase tracking-wide">พักรอบหน้า</span>}
    </div>
  );
}

export default PlayerBadge;
