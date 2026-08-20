// Groups a chronological discard pile into clusters of consecutive
// same-rank cards — each cluster is a "double" (a discard immediately eaten,
// or a chain of eats on the same rank) that should visually cling together,
// while different clusters fan out diagonally so nothing sits 100% overlapped.
function groupDiscardPile(pile) {
  const clusters = [];
  (pile || []).forEach((card) => {
    const last = clusters[clusters.length - 1];
    if (last && last[last.length - 1].rank === card.rank) {
      last.push(card);
    } else {
      clusters.push([card]);
    }
  });
  return clusters;
}

export { groupDiscardPile };
