// Six fixed clock positions around the table. Your own seat always renders
// at 6 o'clock (bottom); the server assigns everyone a stable seatIndex
// (0..5, src/server/room.js's assignSeatIndex) that only changes when they
// actually leave their seat — so when someone else stands up, only their
// spot goes empty; nobody else's position shifts.
const SEAT_COUNT = 6;

function seatPosition(mySeatIndex, otherSeatIndex) {
  const relative = ((otherSeatIndex - mySeatIndex) % SEAT_COUNT + SEAT_COUNT) % SEAT_COUNT;
  const clockHour = (6 + relative * 2) % 12; // 6, 8, 10, 12, 2, 4 o'clock
  const angleDeg = clockHour * 30;
  const rad = (angleDeg * Math.PI) / 180;
  const x = 50 + 46 * Math.sin(rad);
  const y = 50 - 42 * Math.cos(rad);
  return { x, y };
}

export { seatPosition };
