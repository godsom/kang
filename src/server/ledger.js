// Tracks in-session points owed between players ("who pays whom"), settled
// into a baht matrix on demand — replaces the never-wired-up wallet flow for
// per-table payout tracking.

function addLedgerPoints(room, fromUserId, toUserId, points) {
  if (fromUserId === toUserId || points <= 0) return;
  room.ledger = room.ledger || {};
  room.ledger[fromUserId] = room.ledger[fromUserId] || {};
  room.ledger[fromUserId][toUserId] = (room.ledger[fromUserId][toUserId] || 0) + points;
}

// Nets each pair's mutual debts down to a single directed amount, so A and B
// never both appear owing each other in the result.
function computeSettlement(room, bahtPerPoint) {
  const ledger = room.ledger || {};
  const userIds = new Set();
  Object.keys(ledger).forEach((from) => {
    userIds.add(from);
    Object.keys(ledger[from]).forEach((to) => userIds.add(to));
  });
  const ids = [...userIds];
  const settlements = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      const aOwesB = (ledger[a] && ledger[a][b]) || 0;
      const bOwesA = (ledger[b] && ledger[b][a]) || 0;
      const net = aOwesB - bOwesA;
      if (net > 0) {
        settlements.push({ from: a, to: b, points: net, baht: net * bahtPerPoint });
      } else if (net < 0) {
        settlements.push({ from: b, to: a, points: -net, baht: -net * bahtPerPoint });
      }
    }
  }
  return settlements;
}

function withUsernames(room, settlements) {
  const nameOf = (userId) => room.players.find(p => p.userId === userId)?.username || userId;
  return settlements.map(s => ({ ...s, fromUsername: nameOf(s.from), toUsername: nameOf(s.to) }));
}

module.exports = { addLedgerPoints, computeSettlement, withUsernames };
