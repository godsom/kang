import { useEffect, useState } from 'react';
import Card from './Card.jsx';

const FLIGHT_MS = 380;

// A card that visibly travels from one screen position to another — used so
// discarding/eating feels like throwing a real card onto the pile instead of
// it just vanishing from the hand and reappearing in the discard stack.
function FlyingCard({ card, fromRect, toRect, delay = 0, rotate = 0, onDone }) {
  const [style, setStyle] = useState({
    position: 'fixed',
    left: fromRect.left,
    top: fromRect.top,
    zIndex: 50,
    pointerEvents: 'none',
    transition: 'none',
    transform: 'rotate(0deg) scale(1)',
  });

  useEffect(() => {
    const startTimer = setTimeout(() => {
      requestAnimationFrame(() => {
        setStyle((s) => ({
          ...s,
          left: toRect.left,
          top: toRect.top,
          transform: `rotate(${rotate}deg) scale(0.94)`,
          transition: `left ${FLIGHT_MS}ms cubic-bezier(.22,1,.36,1), top ${FLIGHT_MS}ms cubic-bezier(.22,1,.36,1), transform ${FLIGHT_MS}ms`,
        }));
      });
    }, delay);
    const doneTimer = setTimeout(onDone, delay + FLIGHT_MS + 20);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(doneTimer);
    };
    // Runs once per mount — this component is remounted (new key) per flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={style}>
      <Card card={card} size="lg" />
    </div>
  );
}

export default FlyingCard;
export { FLIGHT_MS };
