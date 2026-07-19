/**
 * Shared Y-axis scale for Productivity Analysis charts.
 * Domain endpoints land on the tick step so labels are evenly spaced
 * and compact formats (e.g. "14k") never stack as duplicates.
 */

function niceNumber(range: number, round: boolean): number {
  if (!(range > 0) || !Number.isFinite(range)) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}

function snapTick(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (Math.abs(v) < 1e-12) return 0;
  return Number(v.toPrecision(12));
}

/**
 * Snap a raw [min, max] extent onto a clean tick grid.
 * `tight` only for small integer ranges (avoids 7 → 10 overshoot).
 */
export function niceYDomain(
  rawMin: number,
  rawMax: number,
  opts?: { preferInteger?: boolean; maxTicks?: number; tight?: boolean }
): { yMin: number; yMax: number } {
  const maxTicks = Math.max(2, opts?.maxTicks ?? 4);
  let lo = Number.isFinite(rawMin) ? rawMin : 0;
  let hi = Number.isFinite(rawMax) ? rawMax : 1;
  if (hi <= lo) hi = lo + 1;

  const span0 = hi - lo;
  const preferInteger =
    opts?.preferInteger === true ||
    (Math.abs(lo - Math.round(lo)) < 1e-6 &&
      Math.abs(hi - Math.round(hi)) < 1e-6 &&
      span0 <= 1000);

  if (opts?.tight && preferInteger && span0 <= 24) {
    lo = Math.floor(lo);
    hi = Math.ceil(hi);
    if (hi <= lo) hi = lo + 1;
    const span = hi - lo;
    const step = Math.max(1, Math.ceil(span / maxTicks));
    hi = lo + step * Math.max(1, Math.ceil(span / step));
    return { yMin: lo, yMax: hi };
  }

  if (preferInteger) {
    lo = Math.floor(lo);
    hi = Math.ceil(hi);
    const span = Math.max(1, hi - lo);
    let step = Math.max(1, Math.round(niceNumber(span / maxTicks, true)));
    lo = Math.floor(lo / step) * step;
    if (lo > 0 && rawMin <= 0) lo = 0;
    hi = lo + step * Math.max(1, Math.ceil((Math.max(hi, rawMax) - lo) / step));
    if (hi < rawMax) hi += step;
    return { yMin: lo, yMax: hi };
  }

  const roughSpan = niceNumber(hi - lo, false);
  const step = niceNumber(roughSpan / maxTicks, true);
  lo = Math.floor(lo / step) * step;
  if (lo > 0 && rawMin <= 0) lo = 0;
  hi = Math.ceil(Math.max(hi, rawMax) / step) * step;
  if (hi <= lo) hi = lo + step;
  return { yMin: lo, yMax: hi };
}

/**
 * Evenly spaced ticks from yMin → yMax inclusive.
 * Expects a domain from niceYDomain (span divisible by a clean step).
 */
export function buildYTicks(yMin: number, yMax: number, preferredCount = 4): number[] {
  const span = yMax - yMin;
  if (!(span > 0) || !Number.isFinite(span)) {
    return [Number.isFinite(yMin) ? snapTick(yMin) : 0];
  }

  const targetIntervals = Math.max(2, preferredCount);
  let step = niceNumber(span / targetIntervals, true);
  let intervals = Math.max(1, Math.round(span / step));

  // Keep endpoints exact: use equal divisions of the domain.
  // When the domain was nice-aligned, step ≈ span/intervals and labels stay clean.
  if (Math.abs(intervals * step - span) > Math.max(step, span) * 1e-6) {
    intervals = targetIntervals;
  }
  step = span / intervals;

  const ticks: number[] = [];
  for (let i = 0; i <= intervals; i++) {
    ticks.push(snapTick(yMin + i * step));
  }
  return dedupeTicks(ticks, formatYTickLabel);
}

/** Drop ticks that would render as the same axis label (prevents stacked "14k"). */
function dedupeTicks(ticks: number[], format: (v: number) => string): number[] {
  if (ticks.length <= 1) return ticks;
  const out: number[] = [];
  let prevLabel: string | null = null;
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i]!;
    const isLast = i === ticks.length - 1;
    const label = format(t);
    if (label === prevLabel) {
      if (isLast && out.length > 0) out[out.length - 1] = t;
      continue;
    }
    out.push(t);
    prevLabel = label;
  }
  return out.length > 0 ? out : [ticks[ticks.length - 1]!];
}

export function formatYTickLabel(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (Math.abs(v - Math.round(v)) < 1e-6) {
    const rounded = Math.round(v);
    if (Math.abs(rounded) >= 1_000_000) {
      const n = rounded / 1_000_000;
      return `${Number.isInteger(n) ? n : n.toFixed(1)}M`;
    }
    if (Math.abs(rounded) >= 10_000) {
      return `${Math.round(rounded / 1000).toLocaleString()}k`;
    }
    if (Math.abs(rounded) >= 1000) {
      const n = rounded / 1000;
      return `${Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : n.toFixed(1)}k`;
    }
    return rounded.toLocaleString();
  }
  if (abs >= 1_000_000) {
    const n = v / 1_000_000;
    return `${n >= 10 || Number.isInteger(n) ? Math.round(n) : n.toFixed(1)}M`;
  }
  if (abs >= 10_000) {
    return `${Math.round(v / 1000).toLocaleString()}k`;
  }
  if (abs >= 1000) {
    const n = v / 1000;
    return `${n >= 10 || Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : n.toFixed(1)}k`;
  }
  if (abs >= 10) return Math.round(v).toLocaleString();
  return (+v.toFixed(1)).toLocaleString();
}
