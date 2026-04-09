export function capMilestoneBadges(values: number[], maxBadges: number): number[] {
  const uniqSorted = Array.from(new Set(values)).sort((a, b) => a - b);
  if (uniqSorted.length === 0) return uniqSorted;

  // If the source list is shorter, pad it so each section can show up to `maxBadges` tiers.
  // This keeps the UI consistent (e.g. always "…/150") while still respecting the max cap.
  if (uniqSorted.length < maxBadges) {
    const padded = uniqSorted.slice();
    const last = padded[padded.length - 1]!;
    const prev = padded.length >= 2 ? padded[padded.length - 2]! : last;
    const rawStep = last - prev;
    const step = rawStep > 0 ? rawStep : 1;
    while (padded.length < maxBadges) {
      padded.push(padded[padded.length - 1]! + step);
    }
    return padded;
  }

  if (uniqSorted.length === maxBadges) return uniqSorted;

  // Keep early milestones dense, then down-sample the long tail (always include the last milestone).
  const keepHead = Math.min(100, Math.max(50, Math.floor(maxBadges * 0.66)));
  const head = uniqSorted.slice(0, keepHead);
  const tail = uniqSorted.slice(keepHead);
  const remaining = maxBadges - head.length;
  if (remaining <= 0) return head.slice(0, maxBadges);

  if (tail.length <= remaining) return head.concat(tail);

  const step = Math.ceil(tail.length / remaining);
  const sampledTail: number[] = [];
  for (let i = 0; i < tail.length && sampledTail.length < remaining; i += step) {
    sampledTail.push(tail[i]!);
  }
  const last = tail[tail.length - 1]!;
  if (sampledTail[sampledTail.length - 1] !== last) {
    sampledTail[sampledTail.length - 1] = last;
  }
  return head.concat(sampledTail).slice(0, maxBadges);
}

