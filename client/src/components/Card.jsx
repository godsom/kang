const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const RED_SUITS = new Set(['hearts', 'diamonds']);

const SIZE_CLASSES = {
  sm: 'w-8 h-11 text-[9px] p-0.5',
  md: 'w-14 h-20 text-xs p-1',
  lg: 'w-20 h-28 text-lg p-1.5',
};

function cardLabel(card) {
  return `${card.rank} of ${card.suit}`;
}

function Card({ card, faceDown = false, size = 'md', selected = false, animate = false, className = '' }) {
  const sizeClasses = SIZE_CLASSES[size];

  if (faceDown || !card) {
    return (
      <div
        aria-hidden="true"
        className={`${sizeClasses} rounded-lg bg-gradient-to-br from-felt-700 to-felt-900 border-2 border-gold-500/40 shadow-card ${className}`}
      />
    );
  }

  const symbol = SUIT_SYMBOLS[card.suit];
  const isRed = RED_SUITS.has(card.suit);

  return (
    <div
      className={`${sizeClasses} rounded-lg bg-cream-50 font-display flex flex-col justify-between transition-all duration-200 ${
        selected ? 'border-2 border-gold-400 shadow-gold -translate-y-3' : 'border-2 border-black/10 shadow-card'
      } ${animate ? 'animate-deal-in' : ''} ${className}`}
    >
      <span className={`font-bold leading-none ${isRed ? 'text-red-600' : 'text-slate-900'}`}>{card.rank}</span>
      <span className={`self-center text-[1.6em] leading-none ${isRed ? 'text-red-600' : 'text-slate-900'}`}>{symbol}</span>
      <span className={`self-end font-bold leading-none rotate-180 ${isRed ? 'text-red-600' : 'text-slate-900'}`}>{card.rank}</span>
      <span className="sr-only">{cardLabel(card)}</span>
    </div>
  );
}

export default Card;
export { cardLabel };
