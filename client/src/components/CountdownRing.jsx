const SIZE = 88;
const STROKE = 7;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// total must match the server's turn duration (src/server/turnTimer.js's
// TURN_DURATION_MS, currently 30s) — it's only used to size the ring, not to
// enforce anything client-side.
function CountdownRing({ remaining, total = 30 }) {
  const fraction = Math.max(0, Math.min(1, remaining / total));
  const dashoffset = CIRCUMFERENCE * (1 - fraction);
  const urgent = fraction <= 0.3;

  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }} data-testid="countdown-ring">
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={urgent ? '#ef4444' : '#facc15'}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashoffset}
          style={{ transition: 'stroke-dashoffset 0.25s linear' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display font-bold text-3xl text-cream-50">
        {remaining}
      </span>
    </div>
  );
}

export default CountdownRing;
