export function companyHistoryStats(history) {
  let wins = 0;
  let wonAmount = 0;
  for (const entry of history) {
    if (!entry.won) continue;
    wins++;
    wonAmount += entry.contractAmount ?? (entry.rank === 1 ? entry.bidAmount : 0) ?? 0;
  }
  return { bids: history.length, wins, wonAmount };
}
