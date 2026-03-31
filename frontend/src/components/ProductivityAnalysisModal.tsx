import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Timeframe = "daily" | "weekly" | "monthly" | "quarterly" | "annually";

interface ProductivityRow {
  date: string;
  tasksCompleted: number;
  tasksCompletedCumulative: number;
  xpGained: number;
  xpGainedCumulative: number;
  level: number;
  badgesEarnedCumulative: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ChartConfig {
  id:
    | "tasksCompleted"
    | "tasksCompletedCumulative"
    | "xpGained"
    | "xpGainedCumulative"
    | "level"
    | "badgesEarnedCumulative";
  title: string;
  description: string;
  metricKey: keyof ProductivityRow;
  cumulative: boolean;
  yAxisLabel: string;
}

/** `0` = entire loaded history (all daily rows). */
const PA_RANGE_ALL = 0;

/** Daily window sizes for productivity charts (approx. calendar ranges where noted). */
const PA_RANGE_DAYS = [30, 60, 90, 183, 365, 730, 1095, 1825, PA_RANGE_ALL] as const;
type PaRangeDays = (typeof PA_RANGE_DAYS)[number];

const PA_RANGE_OPTIONS: { value: PaRangeDays; label: string }[] = [
  { value: 30, label: "Last 30 days" },
  { value: 60, label: "Last 60 days" },
  { value: 90, label: "Last 90 days" },
  { value: 183, label: "Last 6 months" },
  { value: 365, label: "Last 1 year" },
  { value: 730, label: "Last 2 years" },
  { value: 1095, label: "Last 3 years" },
  { value: 1825, label: "Last 5 years (~1825 days)" },
  { value: PA_RANGE_ALL, label: "All history" }
];

/** Default chart granularity for each range option (updated when Range changes). */
function defaultTimeframeForRange(days: PaRangeDays): Timeframe {
  if (days === PA_RANGE_ALL) return "annually";
  if (days <= 90) return "daily";
  if (days === 183) return "weekly";
  if (days === 365 || days === 730) return "monthly";
  if (days === 1095 || days === 1825) return "quarterly";
  return "daily";
}

function rollingAvgSpanDays(daysWindow: number): number {
  if (daysWindow <= 90) return Math.min(14, Math.max(3, Math.floor(daysWindow / 6)));
  if (daysWindow <= 183) return Math.min(21, Math.max(7, Math.floor(daysWindow / 10)));
  if (daysWindow <= 365) return Math.min(28, Math.max(10, Math.floor(daysWindow / 14)));
  return Math.min(45, Math.max(14, Math.floor(daysWindow / 24)));
}

function rangeStepDays(daysWindow: number): number {
  if (daysWindow === PA_RANGE_ALL) return 180;
  if (daysWindow <= 90) return 30;
  if (daysWindow <= 183) return 45;
  if (daysWindow <= 365) return 60;
  if (daysWindow <= 1095) return 90;
  return 120;
}

/** Bucket daily rows into calendar weeks/months/etc. Non-cumulative metrics are summed; cumulative take end-of-period snapshot. */
function aggregateRowsByTimeframe(
  rows: ProductivityRow[],
  timeframe: Timeframe
): ProductivityRow[] {
  if (timeframe === "daily" || rows.length === 0) return rows;

  const byKey = new Map<string, ProductivityRow[]>();
  for (const row of rows) {
    const { key } = bucketKeyFor(row.date, timeframe);
    const g = byKey.get(key);
    if (g) g.push(row);
    else byKey.set(key, [row]);
  }

  const keys = Array.from(byKey.keys()).sort((ka, kb) => {
    const a = byKey.get(ka)![0].date;
    const b = byKey.get(kb)![0].date;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const days = byKey.get(key)!;
    const last = days[days.length - 1];
    let tasksCompleted = 0;
    let xpGained = 0;
    for (const d of days) {
      tasksCompleted += d.tasksCompleted;
      xpGained += d.xpGained;
    }
    return {
      date: last.date,
      tasksCompleted,
      tasksCompletedCumulative: last.tasksCompletedCumulative,
      xpGained,
      xpGainedCumulative: last.xpGainedCumulative,
      level: last.level,
      badgesEarnedCumulative: last.badgesEarnedCumulative
    };
  });
}

/** Rolling-average window in number of *buckets* (not days) when timeframe is coarse. */
function rollingAvgSpanBuckets(
  timeframe: Timeframe,
  bucketCount: number,
  daysWindow: number
): number {
  if (timeframe === "daily") return rollingAvgSpanDays(daysWindow);
  if (bucketCount <= 3) return 1;
  const w = Math.max(2, Math.min(6, Math.floor(bucketCount / 4)));
  return Math.min(w, bucketCount - 1);
}

const CHARTS: ChartConfig[] = [
  {
    id: "tasksCompleted",
    title: "Tasks completed",
    description: "Tasks finished in each period.",
    metricKey: "tasksCompleted",
    cumulative: false,
    yAxisLabel: "Tasks · per period"
  },
  {
    id: "tasksCompletedCumulative",
    title: "Accumulated tasks",
    description: "Running total of completed tasks.",
    metricKey: "tasksCompletedCumulative",
    cumulative: true,
    yAxisLabel: "Tasks · cumulative"
  },
  {
    id: "xpGained",
    title: "Experience gained",
    description: "XP earned per period from task priorities.",
    metricKey: "xpGained",
    cumulative: false,
    yAxisLabel: "XP · per period"
  },
  {
    id: "xpGainedCumulative",
    title: "Accumulated XP",
    description: "Total XP gained over time.",
    metricKey: "xpGainedCumulative",
    cumulative: true,
    yAxisLabel: "XP · cumulative"
  },
  {
    id: "level",
    title: "Level",
    description: "Level based on cumulative XP.",
    metricKey: "level",
    cumulative: true,
    yAxisLabel: "Level · cumulative"
  },
  {
    id: "badgesEarnedCumulative",
    title: "Badges earned",
    description: "Cumulative badge milestones unlocked.",
    metricKey: "badgesEarnedCumulative",
    cumulative: true,
    yAxisLabel: "Badges · cumulative"
  }
];

type Point = { label: string; value: number; rawLabel: string };

function bucketKeyFor(dateIso: string, timeframe: Timeframe): { key: string; label: string } {
  const d = new Date(`${dateIso}T12:00:00`);
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();

  switch (timeframe) {
    case "daily": {
      return { key: dateIso, label: dateIso };
    }
    case "weekly": {
      const tmp = new Date(d.getTime());
      const dayOfWeek = (tmp.getDay() + 6) % 7;
      tmp.setDate(tmp.getDate() - dayOfWeek);
      const weekYear = tmp.getFullYear();
      const jan4 = new Date(weekYear, 0, 4);
      const diff = tmp.getTime() - jan4.getTime();
      const week = 1 + Math.floor(diff / (7 * 24 * 60 * 60 * 1000));
      const key = `${weekYear}-W${String(week).padStart(2, "0")}`;
      return { key, label: key };
    }
    case "monthly": {
      const key = `${y}-${String(m + 1).padStart(2, "0")}`;
      return { key, label: key };
    }
    case "quarterly": {
      const q = Math.floor(m / 3) + 1;
      const key = `${y}-Q${q}`;
      return { key, label: key };
    }
    case "annually": {
      const key = String(y);
      return { key, label: key };
    }
  }
}

function formatTimeframeLabel(tf: Timeframe): string {
  switch (tf) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    case "annually":
      return "Annually";
  }
}

/** Short, readable x-axis text (avoids crowded raw keys). */
function formatAxisLabel(timeframe: Timeframe, raw: string): string {
  if (timeframe === "annually") return raw;

  if (timeframe === "quarterly") {
    const m = raw.match(/^(\d{4})-Q(\d)$/);
    if (m) return `Q${Number(m[2])} ’${m[1].slice(2)}`;
  }

  if (timeframe === "monthly") {
    const m = raw.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      const d0 = new Date(Number(m[1]), Number(m[2]) - 1, 1);
      if (!Number.isNaN(d0.getTime())) {
        return d0.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
      }
    }
  }

  if (timeframe === "weekly") {
    const m = raw.match(/^(\d{4})-W(\d{2})$/);
    if (m) return `W${Number(m[2])} ’${m[1].slice(2)}`;
  }

  if (timeframe === "daily") {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const d0 = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!Number.isNaN(d0.getTime())) {
        const nowY = new Date().getFullYear();
        return d0.toLocaleDateString(
          undefined,
          d0.getFullYear() !== nowY
            ? { month: "short", day: "numeric", year: "2-digit" }
            : { month: "short", day: "numeric" }
        );
      }
    }
  }

  return raw;
}

/** Indices to show on x-axis (always include first and last). */
function xTickIndices(count: number, maxTicks: number): number[] {
  if (count <= 0) return [];
  if (count <= maxTicks) return Array.from({ length: count }, (_, i) => i);
  const idx = new Set<number>([0, count - 1]);
  const inner = maxTicks - 2;
  if (inner > 0) {
    for (let k = 1; k <= inner; k++) {
      const i = Math.round((k * (count - 1)) / (inner + 1));
      idx.add(Math.min(count - 1, Math.max(0, i)));
    }
  }
  return Array.from(idx).sort((a, b) => a - b);
}

const PAD_L = 0;
const PAD_R = 0;
const PAD_T = 2;
const PAD_B = 2;
const VB_W = 100;
const VB_H = 48;
const BASE_Y = VB_H - PAD_B;

/** Straight segments — spline curves overshoot on dense daily data and look like noise. */
function linearLinePath(coords: { x: number; y: number }[]): string {
  if (coords.length === 0) return "";
  return coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`)
    .join(" ");
}

function chartYDomain(
  points: { value: number }[],
  cumulative: boolean
): { yMin: number; yMax: number } {
  if (points.length === 0) return { yMin: 0, yMax: 1 };
  const vals = points.map((p) => p.value);
  const vMin = Math.min(...vals);
  const vMax = Math.max(...vals, 1);
  if (!cumulative) {
    const padTop = Math.max(vMax * 0.14, 0.5);
    return { yMin: 0, yMax: vMax + padTop };
  }
  const span = Math.max(vMax - vMin, 1e-9);
  /* Widen cumulative domain so small day-to-day wiggles are not visually amplified. */
  const pad = Math.max(span * 0.14, vMax * 0.03, 1);
  const yLo = Math.max(0, vMin - pad * 0.95);
  const yHi = vMax + pad * 0.55;
  const minHeight = span * 1.35;
  if (yHi - yLo < minHeight) {
    const mid = (vMin + vMax) / 2;
    const half = minHeight / 2;
    const yMin2 = Math.max(0, mid - half);
    const yMax2 = Math.max(mid + half, vMax + pad * 0.2);
    return { yMin: yMin2, yMax: yMax2 };
  }
  return { yMin: yLo, yMax: yHi };
}

function formatYTick(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const rounded = Math.round(v);
  if (Math.abs(v - rounded) < 1e-6 || Math.abs(v) >= 100) {
    return rounded.toLocaleString();
  }
  return (+v.toFixed(2)).toLocaleString();
}

type InsightChartMode = "inline" | "fullscreen";

/** Target minimum width for readable point spacing (may be capped to the chart container). */
function chartIdealMinWidthPx(pointCount: number, mode: InsightChartMode): number {
  if (pointCount <= 1) return 320;
  const per =
    mode === "fullscreen"
      ? pointCount > 500
        ? 10
        : pointCount > 200
          ? 12
          : 16
      : pointCount > 500
        ? 5.5
        : pointCount > 200
          ? 6.5
          : pointCount > 80
            ? 7.5
            : 9;
  return Math.max(320, Math.round(pointCount * per));
}

function chartTrackMinWidthPx(
  pointCount: number,
  mode: InsightChartMode,
  containerWidth?: number
): number {
  const ideal = chartIdealMinWidthPx(pointCount, mode);
  if (mode !== "inline") return ideal;
  const w =
    containerWidth && containerWidth > 0
      ? containerWidth
      : typeof globalThis !== "undefined" && globalThis.window
        ? globalThis.window.innerWidth
        : 1100;
  const cap = Math.min(1320, Math.max(280, Math.floor(w * 0.99)));
  return Math.min(ideal, cap);
}

function rollingAverage(points: Point[], window: number): Point[] {
  const w = Math.max(1, Math.floor(window));
  if (w <= 1) return points;
  const out: Point[] = [];
  let sum = 0;
  const q: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const v = points[i].value;
    q.push(v);
    sum += v;
    if (q.length > w) sum -= q.shift() ?? 0;
    out.push({ ...points[i], value: sum / q.length });
  }
  return out;
}

function sumPoints(points: Point[]): number {
  return points.reduce((s, p) => s + (Number.isFinite(p.value) ? p.value : 0), 0);
}

/** True max in the visible series (no artificial floor). */
function peakInSeries(points: Point[]): number {
  if (points.length === 0) return 0;
  return Math.max(...points.map((p) => p.value));
}

/** Display for pill stats; averages may be fractional. */
function formatPillValue(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const r = Math.round(v * 100) / 100;
  if (Math.abs(r - Math.round(r)) < 1e-6) return Math.round(r).toLocaleString();
  return r.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * For cumulative series: change from the previous chart period to the latest (matches timeframe
 * buckets). Falls back to growth since start of visible window when only one bucket is shown.
 */
function cumulativeLatestDelta(
  points: Point[],
  metricKey: keyof ProductivityRow,
  data: ProductivityRow[] | null,
  windowStart: number,
  windowRows: ProductivityRow[]
): number {
  if (points.length === 0) return 0;
  const last = points[points.length - 1]!.value;
  if (points.length >= 2) {
    return last - points[points.length - 2]!.value;
  }
  if (!data?.length) return last;
  if (windowStart > 0) {
    const prev = data[windowStart - 1]!;
    const prevV = Number(prev[metricKey]);
    return Number.isFinite(prevV) ? last - prevV : last;
  }
  if (windowRows.length === 0) return last;
  const startRow = windowRows[0]!;
  let baseline = 0;
  switch (metricKey) {
    case "tasksCompletedCumulative":
      baseline = startRow.tasksCompletedCumulative - startRow.tasksCompleted;
      break;
    case "xpGainedCumulative":
      baseline = startRow.xpGainedCumulative - startRow.xpGained;
      break;
    case "level": {
      const xpBefore = startRow.xpGainedCumulative - startRow.xpGained;
      baseline = 1 + Math.floor(xpBefore / 50);
      break;
    }
    case "badgesEarnedCumulative":
      baseline = 0;
      break;
    default:
      baseline = 0;
  }
  return last - baseline;
}

/**
 * Period-over-period growth of cumulative total: (Δ / prior level) × 100,
 * where prior level is cumulative at end of previous period (= latest − Δ).
 */
function cumulativePopGrowthPercent(
  points: Point[],
  deltaVsPrior: number
): number | null {
  if (points.length === 0 || !Number.isFinite(deltaVsPrior)) return null;
  const last = points[points.length - 1]!.value;
  const prior = last - deltaVsPrior;
  if (!Number.isFinite(prior) || prior < 0) return null;
  if (prior === 0) {
    if (deltaVsPrior === 0) return 0;
    return null;
  }
  return (deltaVsPrior / prior) * 100;
}

function formatGrowthPercent(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) return "0%";
  const sign = rounded > 0 ? "+" : "";
  const abs = Math.abs(rounded);
  const numStr =
    abs % 1 === 0
      ? abs.toLocaleString()
      : abs.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return `${sign}${rounded < 0 ? "-" : ""}${numStr}%`;
}

function maxPoint(points: Point[]): { value: number; rawLabel: string } | null {
  if (points.length === 0) return null;
  let best = points[0];
  for (const p of points) if (p.value > best.value) best = p;
  return { value: best.value, rawLabel: best.rawLabel };
}

/** Inline + fullscreen: explicit dual-series legend (red dashed raw vs gold solid average). */
function PaDualSeriesLegend({ fullscreen }: { fullscreen?: boolean }) {
  return (
    <div
      className={`pa-legend${fullscreen ? " pa-legend--fs" : ""}`}
      role="list"
      aria-label="Chart lines: raw values and rolling average"
    >
      <div className="pa-legend-chip pa-legend-chip--raw" role="listitem">
        <div className="pa-legend-swatch-col" aria-hidden="true">
          <span className="pa-legend-swatch raw" />
        </div>
        <div className="pa-legend-copy">
          <span className="pa-legend-chip-title">Raw</span>
          <span className="pa-legend-chip-meta">
            Dashed line, <strong className="pa-legend-em-red">brand red</strong> — unsmoothed per period
          </span>
        </div>
      </div>
      <div className="pa-legend-chip pa-legend-chip--avg" role="listitem">
        <div className="pa-legend-swatch-col" aria-hidden="true">
          <span className="pa-legend-swatch avg" />
        </div>
        <div className="pa-legend-copy">
          <span className="pa-legend-chip-title">Rolling average</span>
          <span className="pa-legend-chip-meta">
            Solid line, <strong className="pa-legend-em-gold">gold</strong> — smoothed moving average
          </span>
        </div>
      </div>
    </div>
  );
}

function InsightChart({
  chartId,
  points,
  overlayPoints,
  yMin,
  yMax,
  timeframe,
  xAxisLabel = "Date",
  yAxisLabel,
  mode = "inline",
  idSuffix = "",
  showArea = false
}: {
  chartId: string;
  points: Point[];
  overlayPoints?: Point[] | null;
  yMin: number;
  yMax: number;
  timeframe: Timeframe;
  xAxisLabel?: string;
  yAxisLabel: string;
  mode?: InsightChartMode;
  /** Avoid duplicate SVG gradient ids when inline + fullscreen both mount */
  idSuffix?: string;
  /** Area under line reads well for cumulative series; hides clutter on per-day counts. */
  showArea?: boolean;
}) {
  const [hover, setHover] = useState<{ idx: number; px: number; py: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [chartContainerW, setChartContainerW] = useState(0);
  const gradId = `pa-fill-${chartId}${idSuffix}`;
  const clipId = `pa-clip-${chartId}${idSuffix}`;

  useLayoutEffect(() => {
    if (mode !== "inline") {
      setChartContainerW(0);
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setChartContainerW(Math.max(0, Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, chartId, points.length]);

  const coords = useMemo(() => {
    const n = points.length;
    const plotW = VB_W - PAD_L - PAD_R;
    const plotH = BASE_Y - PAD_T;
    const span = yMax - yMin;
    const xAt = (i: number) => {
      if (n <= 1) return PAD_L + plotW / 2;
      return PAD_L + (i / (n - 1)) * plotW;
    };
    const yAt = (v: number) => {
      const norm = span <= 0 ? 0 : (v - yMin) / span;
      const clamped = Math.max(0, Math.min(1, norm));
      return BASE_Y - clamped * plotH;
    };
    return points.map((p, i) => ({ x: xAt(i), y: yAt(p.value), ...p }));
  }, [points, yMin, yMax]);

  const overlayCoords = useMemo(() => {
    if (!overlayPoints || overlayPoints.length !== points.length) return null;
    const n = overlayPoints.length;
    const plotW = VB_W - PAD_L - PAD_R;
    const plotH = BASE_Y - PAD_T;
    const span = yMax - yMin;
    const xAt = (i: number) => {
      if (n <= 1) return PAD_L + plotW / 2;
      return PAD_L + (i / (n - 1)) * plotW;
    };
    const yAt = (v: number) => {
      const norm = span <= 0 ? 0 : (v - yMin) / span;
      const clamped = Math.max(0, Math.min(1, norm));
      return BASE_Y - clamped * plotH;
    };
    return overlayPoints.map((p, i) => ({ x: xAt(i), y: yAt(p.value), ...p }));
  }, [overlayPoints, points.length, yMin, yMax]);

  useLayoutEffect(() => {
    if (!hover) return;
    const tip = tooltipRef.current;
    const svg = svgRef.current;
    if (!tip || !svg) return;
    const r = svg.getBoundingClientRect();
    tip.style.left = `${r.left + (hover.px / VB_W) * r.width}px`;
    tip.style.top = `${r.top + (hover.py / VB_H) * r.height}px`;
  }, [hover]);

  useEffect(() => {
    if (!hover) return;
    let raf = 0;
    const tick = () => {
      const tip = tooltipRef.current;
      const svg = svgRef.current;
      if (tip && svg) {
        const r = svg.getBoundingClientRect();
        tip.style.left = `${r.left + (hover.px / VB_W) * r.width}px`;
        tip.style.top = `${r.top + (hover.py / VB_H) * r.height}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hover]);

  if (coords.length === 0) return null;

  const setHoverIdx = (idx: number) => {
    const clamped = Math.max(0, Math.min(coords.length - 1, idx));
    const c = coords[clamped];
    setHover({ idx: clamped, px: c.x, py: c.y });
  };

  const linePathD = linearLinePath(coords);
  const overlayLineD = overlayCoords ? linearLinePath(overlayCoords) : "";
  const areaPathD =
    showArea && linePathD && coords.length > 0
      ? `${linePathD} L ${coords[coords.length - 1].x} ${BASE_Y} L ${coords[0].x} ${BASE_Y} Z`
      : "";

  const yTicks = 4;
  const ySpan = yMax - yMin;
  const tickIndices = xTickIndices(
    points.length,
    mode === "fullscreen" ? 14 : Math.min(11, Math.max(7, Math.ceil(points.length / 25)))
  );
  const hasOverlay = Boolean(overlayLineD);
  /* Single scrubber only — same for cumulative and non-cumulative (no per-point dots). */
  const strokeW = points.length > 450 ? 1.05 : points.length > 200 ? 1.35 : 1.75;

  const updateHoverFromClientX = (clientX: number) => {
    const el = svgRef.current;
    if (!el || coords.length === 0) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const plotW = VB_W - PAD_L - PAD_R;
    const xSvg = ((clientX - rect.left) / rect.width) * VB_W;
    const n = coords.length;
    let idx: number;
    if (n <= 1) idx = 0;
    else {
      const t = (xSvg - PAD_L) / plotW;
      idx = Math.round(Math.max(0, Math.min(1, t)) * (n - 1));
    }
    const c = coords[idx];
    setHover({ idx, px: c.x, py: c.y });
  };
  const minPx = chartTrackMinWidthPx(
    points.length,
    mode,
    chartContainerW > 0 ? chartContainerW : undefined
  );
  const idealW = chartIdealMinWidthPx(points.length, mode);
  const chartCompressedInline =
    mode === "inline" && chartContainerW > 0 && idealW > minPx + 6;
  const trackSize = `max(100%, ${minPx}px)`;

  const tooltipPortal =
    hover !== null &&
    points[hover.idx] &&
    typeof document !== "undefined"
      ? createPortal(
          (() => {
            const hi = hover.idx;
            const pt = points[hi]!;
            const ov = overlayPoints?.[hi];
            const pyRatio = hover.py / VB_H;
            const tooltipY = pyRatio < 0.34 ? "below" : "above";
            return (
              <div
                ref={tooltipRef}
                className={`pa-chart-tooltip pa-chart-tooltip--portal pa-chart-tooltip--y-${tooltipY}${
                  hasOverlay ? " pa-chart-tooltip--dual" : ""
                }`}
                role="tooltip"
              >
                <div className="pa-chart-tooltip-card">
                  <header className="pa-chart-tooltip-head">
                    <span className="pa-chart-tooltip-head-k">{xAxisLabel}</span>
                    <span className="pa-chart-tooltip-head-v">
                      {formatAxisLabel(timeframe, pt.rawLabel)}
                    </span>
                  </header>
                  <div
                    className={`pa-chart-tooltip-metrics${hasOverlay ? "" : " pa-chart-tooltip-metrics--solo"}`}
                  >
                    {hasOverlay ? (
                      <>
                        <section
                          className="pa-chart-tooltip-metric pa-chart-tooltip-metric--raw"
                          aria-label={`Raw: ${formatPillValue(pt.value)}. ${yAxisLabel}. Dashed red line on chart.`}
                        >
                          <div className="pa-chart-tooltip-metric-top">
                            <span className="pa-chart-tooltip-dot pa-chart-tooltip-dot--raw" aria-hidden />
                            <div className="pa-chart-tooltip-metric-body">
                              <div className="pa-chart-tooltip-metric-line">
                                <span className="pa-chart-tooltip-metric-name">Raw</span>
                                <span className="pa-chart-tooltip-metric-fig pa-chart-tooltip-metric-fig--inline">
                                  {formatPillValue(pt.value)}
                                </span>
                                <span className="pa-chart-tooltip-chip pa-chart-tooltip-chip--raw">
                                  Dashed red
                                </span>
                              </div>
                              <p className="pa-chart-tooltip-metric-unit">{yAxisLabel}</p>
                            </div>
                          </div>
                        </section>
                        {ov && (
                          <section
                            className="pa-chart-tooltip-metric pa-chart-tooltip-metric--avg"
                            aria-label={`Rolling average: ${formatPillValue(ov.value)}. ${yAxisLabel}. Solid gold line.`}
                          >
                            <div className="pa-chart-tooltip-metric-top">
                              <span
                                className="pa-chart-tooltip-dot pa-chart-tooltip-dot--avg"
                                aria-hidden
                              />
                              <div className="pa-chart-tooltip-metric-body">
                                <div className="pa-chart-tooltip-metric-line">
                                  <span className="pa-chart-tooltip-metric-name">Rolling avg</span>
                                  <span className="pa-chart-tooltip-metric-fig pa-chart-tooltip-metric-fig--inline">
                                    {formatPillValue(ov.value)}
                                  </span>
                                  <span className="pa-chart-tooltip-chip pa-chart-tooltip-chip--avg">
                                    Smoothed
                                  </span>
                                </div>
                                <p className="pa-chart-tooltip-metric-unit">{yAxisLabel}</p>
                              </div>
                            </div>
                          </section>
                        )}
                      </>
                    ) : (
                      <section
                        className="pa-chart-tooltip-metric pa-chart-tooltip-metric--raw pa-chart-tooltip-metric--solo"
                        aria-label={`${formatPillValue(pt.value)}. ${yAxisLabel}.`}
                      >
                        <div className="pa-chart-tooltip-metric-top">
                          <span className="pa-chart-tooltip-dot pa-chart-tooltip-dot--raw" aria-hidden />
                          <div className="pa-chart-tooltip-metric-body">
                            <div className="pa-chart-tooltip-metric-line pa-chart-tooltip-metric-line--solo">
                              <span className="pa-chart-tooltip-metric-fig pa-chart-tooltip-metric-fig--solo">
                                {formatPillValue(pt.value)}
                              </span>
                            </div>
                            <p className="pa-chart-tooltip-metric-unit">{yAxisLabel}</p>
                          </div>
                        </div>
                      </section>
                    )}
                  </div>
                </div>
                <span className="pa-chart-tooltip-caret" aria-hidden />
              </div>
            );
          })(),
          document.body
        )
      : null;

  const shell = (
    <div
      className={`pa-chart-shell ${mode === "fullscreen" ? "pa-chart-shell--fs" : ""}`}
      style={{ minWidth: `${minPx}px` }}
    >
      <div className="pa-chart-y-rail-wrap" aria-hidden="true">
        <div className="pa-axis-legend pa-axis-legend-y">{yAxisLabel}</div>
        <div className="pa-chart-y-rail">
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const t = i / yTicks;
          const value = yMax - t * ySpan;
          return (
            <span key={i} className="pa-chart-y-tick">
              {formatYTick(value)}
            </span>
          );
        })}
        </div>
      </div>
      <div className={`pa-chart-main ${mode === "fullscreen" ? "pa-chart-main--fs" : ""}`}>
        <div
          className="pa-chart-plot"
          onMouseMove={(e) => updateHoverFromClientX(e.clientX)}
          onMouseLeave={() => setHover(null)}
          onTouchStart={(e) => {
            const t = e.touches[0];
            if (t) updateHoverFromClientX(t.clientX);
          }}
          onTouchMove={(e) => {
            const t = e.touches[0];
            if (t) updateHoverFromClientX(t.clientX);
          }}
        >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className={`pa-chart-svg ${mode === "fullscreen" ? "pa-chart-svg--fs" : ""}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Line chart of values over time"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(206, 17, 38)" stopOpacity="0.12" />
              <stop offset="55%" stopColor="rgb(254, 226, 226)" stopOpacity="0.08" />
              <stop offset="100%" stopColor="rgb(255, 255, 255)" stopOpacity="0" />
            </linearGradient>
            <clipPath id={clipId}>
              <rect x={PAD_L} y={PAD_T} width={VB_W - PAD_L - PAD_R} height={BASE_Y - PAD_T + 1} />
            </clipPath>
          </defs>

          {Array.from({ length: yTicks + 1 }).map((_, i) => {
            const y = BASE_Y - ((BASE_Y - PAD_T) * i) / yTicks;
            return (
              <line
                key={i}
                x1={PAD_L}
                x2={VB_W - PAD_R}
                y1={y}
                y2={y}
                className="pa-chart-grid"
              />
            );
          })}

          <g clipPath={`url(#${clipId})`}>
            {areaPathD && (
              <path d={areaPathD} className="pa-chart-area" fill={`url(#${gradId})`} />
            )}
            {overlayLineD && (
              <path
                d={overlayLineD}
                fill="none"
                className="pa-chart-line pa-chart-line-overlay"
                stroke="currentColor"
                strokeWidth={Math.max(1.55, strokeW * 1.35)}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                opacity={0.98}
              />
            )}
            {linePathD && (
              <path
                d={linePathD}
                fill="none"
                className={`pa-chart-line pa-chart-line-primary ${hasOverlay ? "pa-chart-line-primary--muted" : ""}`}
                stroke="currentColor"
                strokeWidth={hasOverlay ? Math.max(1.2, strokeW * 0.9) : strokeW}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                strokeDasharray={hasOverlay ? "3 3.5" : undefined}
                opacity={hasOverlay ? 0.92 : 1}
              />
            )}

          </g>
        </svg>
          {hover !== null && coords[hover.idx] && (
            <div className="pa-chart-hover-layer" aria-hidden="true">
              <div
                className="pa-chart-v-rule"
                style={{ left: `${(hover.px / VB_W) * 100}%` }}
              />
              <div
                className={`pa-chart-scrubber ${hasOverlay ? "pa-chart-scrubber--dual" : "pa-chart-scrubber--single"}`}
                style={{
                  left: `${(hover.px / VB_W) * 100}%`,
                  top: `${(hover.py / VB_H) * 100}%`
                }}
              />
            </div>
          )}
        </div>

        <div
          className={`pa-chart-xaxis pa-chart-xaxis--pos ${
            mode === "fullscreen" ? "pa-chart-xaxis--fs" : ""
          }`}
        >
          {tickIndices.map((i, tpos) => {
            const leftPct = points.length <= 1 ? 50 : (i / (points.length - 1)) * 100;
            const isSingleton = tickIndices.length === 1;
            const isFirst = !isSingleton && tpos === 0;
            const isLast = !isSingleton && tpos === tickIndices.length - 1;
            return (
              <span
                key={`x-${points[i].rawLabel}-${i}`}
                className={`pa-chart-xcell ${isSingleton ? "is-singleton" : ""} ${isFirst ? "is-first" : ""} ${isLast ? "is-last" : ""}`}
                style={{ left: `${leftPct}%` }}
              >
                {formatAxisLabel(timeframe, points[i].rawLabel)}
              </span>
            );
          })}
        </div>
        <div className="pa-axis-legend pa-axis-legend-x" aria-hidden="true">
          {xAxisLabel}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div
        ref={scrollRef}
        className={`pa-chart-h-scroll ${mode === "fullscreen" ? "pa-chart-h-scroll--fs" : ""}`}
        role="region"
        aria-label={
          mode === "fullscreen"
            ? "Chart — scroll horizontally if needed"
            : "Chart area — scroll sideways when the timeline is wide"
        }
        tabIndex={0}
        onFocus={() => {
          if (!hover) setHoverIdx(coords.length - 1);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            setHoverIdx((hover?.idx ?? coords.length - 1) - 1);
            return;
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            setHoverIdx((hover?.idx ?? -1) + 1);
            return;
          }
          if (e.key === "Home") {
            e.preventDefault();
            setHoverIdx(0);
            return;
          }
          if (e.key === "End") {
            e.preventDefault();
            setHoverIdx(coords.length - 1);
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setHover(null);
          }
        }}
      >
        <div
          className={`pa-chart-h-track ${mode === "fullscreen" ? "pa-chart-h-track--fs" : ""}`}
          style={{
            width: trackSize,
            minWidth: trackSize
          }}
        >
          {shell}
        </div>
      </div>
      {mode === "inline" && chartCompressedInline && points.length > 24 && (
        <p className="pa-scroll-hint">
          <span className="pa-scroll-hint-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 12h16M9 7l-5 5 5 5M15 7l5 5-5 5"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>
            Timeline is scaled to fit this card. Drag horizontally or use full screen for more
            spacing. Hover or drag along the line for values.
          </span>
        </p>
      )}
      {tooltipPortal}
    </>
  );
}

export function ProductivityAnalysisModal({ open, onClose }: Props) {
  const [data, setData] = useState<ProductivityRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("daily");
  const [fullscreenChartId, setFullscreenChartId] = useState<string | null>(null);
  const [daysWindow, setDaysWindow] = useState<PaRangeDays>(60);
  const [windowStart, setWindowStart] = useState(0);
  const windowStep = useMemo(() => rangeStepDays(daysWindow), [daysWindow]);

  const annuallyTimeframeDisabled =
    daysWindow !== PA_RANGE_ALL && daysWindow <= 365;

  useEffect(() => {
    if (!open) return;
    setTimeframe(defaultTimeframeForRange(daysWindow));
  }, [open, daysWindow]);

  useEffect(() => {
    if (!open) return;
    if (annuallyTimeframeDisabled && timeframe === "annually") {
      setTimeframe(defaultTimeframeForRange(daysWindow));
    }
  }, [open, annuallyTimeframeDisabled, timeframe, daysWindow]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/productivity-insights");
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`);
        }
        const body: { rows: ProductivityRow[] } = await res.json();
        if (!cancelled) {
          setData(body.rows ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load productivity insights."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchData();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setFullscreenChartId(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const inField =
        tag === "INPUT" ||
        tag === "SELECT" ||
        tag === "TEXTAREA" ||
        target?.isContentEditable;

      if (fullscreenChartId && !e.repeat && !inField) {
        const idx = CHARTS.findIndex((c) => c.id === fullscreenChartId);
        if (e.key === "[" && idx > 0) {
          e.preventDefault();
          setFullscreenChartId(CHARTS[idx - 1]!.id);
          return;
        }
        if (e.key === "]" && idx >= 0 && idx < CHARTS.length - 1) {
          e.preventDefault();
          setFullscreenChartId(CHARTS[idx + 1]!.id);
          return;
        }
      }

      if (e.key !== "Escape") return;
      if (fullscreenChartId) {
        e.preventDefault();
        setFullscreenChartId(null);
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, fullscreenChartId]);

  useEffect(() => {
    if (!fullscreenChartId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreenChartId]);

  const windowMeta = useMemo(() => {
    if (!data || data.length === 0) return { start: 0, end: 0, count: 0 };
    const count = data.length;
    const span =
      daysWindow === PA_RANGE_ALL ? count : Math.min(daysWindow, count);
    const maxStart = Math.max(0, count - span);
    const clampedStart = Math.min(Math.max(0, windowStart), maxStart);
    const end = Math.min(count, clampedStart + span);
    const start = Math.max(0, end - span);
    return { start, end, count };
  }, [data, windowStart, daysWindow]);

  const visibleDaySpan = useMemo(
    () => Math.max(1, windowMeta.end - windowMeta.start),
    [windowMeta.end, windowMeta.start]
  );

  const windowRows = useMemo(() => {
    if (!data || data.length === 0) return [] as ProductivityRow[];
    return data.slice(windowMeta.start, windowMeta.end);
  }, [data, windowMeta.start, windowMeta.end]);

  const chartRows = useMemo(
    () => aggregateRowsByTimeframe(windowRows, timeframe),
    [windowRows, timeframe]
  );

  const byChart = useMemo(() => {
    const result: Record<string, Point[]> = {};
    for (const chart of CHARTS) {
      result[chart.id] = chartRows.map((row) => {
        const rawLabel =
          timeframe === "daily" ? row.date : bucketKeyFor(row.date, timeframe).key;
        return {
          label: rawLabel,
          rawLabel,
          value:
            typeof row[chart.metricKey] === "number"
              ? (row[chart.metricKey] as number)
              : 0
        };
      });
    }
    return result;
  }, [chartRows, timeframe]);

  useEffect(() => {
    if (!data || data.length === 0) return;
    const span =
      daysWindow === PA_RANGE_ALL ? data.length : Math.min(daysWindow, data.length);
    setWindowStart(Math.max(0, data.length - span));
  }, [open, data?.length, daysWindow]);

  const rangeHint = useMemo(() => {
    if (!data?.length) return null;
    const first = data[0]?.date;
    const last = data[data.length - 1]?.date;
    if (!first || !last) return null;
    const a = new Date(`${first}T12:00:00`);
    const b = new Date(`${last}T12:00:00`);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${first} → ${last}`;
    const opts: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "short",
      day: "numeric"
    };
    return `${a.toLocaleDateString(undefined, opts)} — ${b.toLocaleDateString(undefined, opts)}`;
  }, [data]);

  /* Summary always uses daily totals for the selected date window (not bucket counts). */
  const windowSummary = useMemo(() => {
    const tasks: Point[] = windowRows.map((r) => ({
      label: r.date,
      rawLabel: r.date,
      value: r.tasksCompleted
    }));
    const xp: Point[] = windowRows.map((r) => ({
      label: r.date,
      rawLabel: r.date,
      value: r.xpGained
    }));
    const totalTasks = sumPoints(tasks);
    const totalXp = sumPoints(xp);
    const nDays = windowRows.length;
    const avgTasks = nDays ? totalTasks / nDays : 0;
    const avgXp = nDays ? totalXp / nDays : 0;
    const bestTasks = maxPoint(tasks);
    const bestXp = maxPoint(xp);
    return {
      totalTasks,
      totalXp,
      avgTasks,
      avgXp,
      bestTasks,
      bestXp
    };
  }, [windowRows]);

  if (!open) return null;

  const fsChart = fullscreenChartId
    ? CHARTS.find((c) => c.id === fullscreenChartId)
    : null;
  const fsPointsAll = fsChart ? byChart[fsChart.id] ?? [] : [];
  // `byChart` is already windowed (daily range), so don't slice again.
  const fsPoints = fsPointsAll;
  const fsRawPeak = fsPoints.length > 0 ? peakInSeries(fsPoints) : 0;
  const fsYDomain =
    fsChart && fsPoints.length > 0 ? chartYDomain(fsPoints, fsChart.cumulative) : { yMin: 0, yMax: 1 };
  const fsLatestVal =
    fsChart && fsPoints.length > 0
      ? fsChart.cumulative
        ? cumulativeLatestDelta(
            fsPoints,
            fsChart.metricKey,
            data,
            windowMeta.start,
            windowRows
          )
        : fsPoints[fsPoints.length - 1]!.value
      : 0;
  const fsOverlay =
    fsChart && !fsChart.cumulative && fsPoints.length > 0
      ? rollingAverage(
          fsPoints,
          rollingAvgSpanBuckets(timeframe, fsPoints.length, visibleDaySpan)
        )
      : null;
  const fsOverlayLatest =
    fsOverlay && fsOverlay.length > 0 ? fsOverlay[fsOverlay.length - 1]!.value : null;
  const fsOverlayPeak =
    fsOverlay && fsOverlay.length > 0 ? peakInSeries(fsOverlay) : null;
  const fsCumulativeGrowthPct =
    fsChart?.cumulative && fsPoints.length > 0
      ? cumulativePopGrowthPercent(fsPoints, fsLatestVal)
      : null;

  const fsChartIndex = fsChart ? CHARTS.findIndex((c) => c.id === fsChart.id) : -1;
  const fsPrevChart =
    fsChartIndex > 0 ? CHARTS[fsChartIndex - 1]! : null;
  const fsNextChart =
    fsChartIndex >= 0 && fsChartIndex < CHARTS.length - 1
      ? CHARTS[fsChartIndex + 1]!
      : null;

  const rangeControlsEl = (
    <div className="pa-range-controls" role="group" aria-label="Chart range and timeframe">
      <div className="pa-range-left">
        <button
          type="button"
          className="ghost-button small"
          onClick={() => setWindowStart((s) => Math.max(0, s - windowStep))}
          disabled={windowMeta.start <= 0}
        >
          Older
        </button>
        <button
          type="button"
          className="ghost-button small"
          onClick={() =>
            setWindowStart((s) => {
              const count = data?.length ?? 0;
              const span =
                daysWindow === PA_RANGE_ALL ? count : Math.min(daysWindow, count);
              return Math.min(Math.max(0, count - span), s + windowStep);
            })
          }
          disabled={windowMeta.end >= windowMeta.count}
        >
          Newer
        </button>
      </div>
      <label className="pa-tf-label">
        <span className="pa-tf-label-text">Timeframe</span>
        <select
          className="pa-tf-select pa-tf-select--timeframe"
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value as Timeframe)}
          aria-label="Chart timeframe"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="annually" disabled={annuallyTimeframeDisabled}>
            Annually
          </option>
        </select>
      </label>
      <label className="pa-tf-label">
        <span className="pa-tf-label-text">Range</span>
        <select
          className="pa-tf-select"
          value={daysWindow}
          onChange={(e) => {
            const v = Number(e.target.value);
            if ((PA_RANGE_DAYS as readonly number[]).includes(v)) {
              setDaysWindow(v as PaRangeDays);
            }
          }}
        >
          {PA_RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="pa-range-meta" aria-label="Visible range">
        Days {windowMeta.start + 1}–{windowMeta.end} of {windowMeta.count}
        {daysWindow === PA_RANGE_ALL && windowMeta.count > 0 && (
          <span className="pa-range-meta-buckets"> (full timeline)</span>
        )}
        {timeframe !== "daily" && chartRows.length > 0 && (
          <span className="pa-range-meta-buckets">
            {" "}
            · {chartRows.length} {formatTimeframeLabel(timeframe).toLowerCase()} buckets
          </span>
        )}
      </div>
    </div>
  );

  return (
    <>
    <div
      className="badge-modal-backdrop pa-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Productivity analysis"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="badge-modal productivity-modal pa-pro-shell">
        <header className="badge-modal-head productivity-modal-head pa-header">
          <div className="pa-header-row">
            <div className="pa-header-copy">
              <div className="badge-modal-title pa-title">Productivity analysis</div>
              <div className="badge-modal-sub pa-subtitle">
                Explore trends with flexible timeframes. Rolling averages smooth day-to-day noise;
                shift the window with Older / Newer.
              </div>
              {rangeHint && (
                <div className="pa-range-pill" title="Data range in daily timeline">
                  <span className="pa-range-pill-label">Dataset</span>
                  <span className="pa-range-pill-value">{rangeHint}</span>
                </div>
              )}
            </div>
            <button
              type="button"
              className="pa-close-round"
              onClick={onClose}
              aria-label="Close productivity analysis"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className="pa-controls-strip" role="toolbar" aria-label="Chart filters">
            {rangeControlsEl}
          </div>
        </header>

        <div className="productivity-modal-body pa-body">
          {!loading && !error && data && data.length > 0 && (
            <div className="pa-summary" aria-label="Daily window summary">
              <div className="pa-summary-card">
                <div className="pa-summary-label">Tasks (window)</div>
                <div className="pa-summary-value">{Math.round(windowSummary.totalTasks).toLocaleString()}</div>
                <div className="pa-summary-sub">
                  Avg/day: {Math.round(windowSummary.avgTasks * 10) / 10}
                </div>
              </div>
              <div className="pa-summary-card">
                <div className="pa-summary-label">XP (window)</div>
                <div className="pa-summary-value">{Math.round(windowSummary.totalXp).toLocaleString()}</div>
                <div className="pa-summary-sub">
                  Avg/day: {Math.round(windowSummary.avgXp * 10) / 10}
                </div>
              </div>
              <div className="pa-summary-card">
                <div className="pa-summary-label">Best tasks day</div>
                <div className="pa-summary-value">
                  {windowSummary.bestTasks ? Math.round(windowSummary.bestTasks.value).toLocaleString() : "—"}
                </div>
                <div className="pa-summary-sub">
                  {windowSummary.bestTasks ? formatAxisLabel("daily", windowSummary.bestTasks.rawLabel) : ""}
                </div>
              </div>
              <div className="pa-summary-card">
                <div className="pa-summary-label">Best XP day</div>
                <div className="pa-summary-value">
                  {windowSummary.bestXp ? Math.round(windowSummary.bestXp.value).toLocaleString() : "—"}
                </div>
                <div className="pa-summary-sub">
                  {windowSummary.bestXp ? formatAxisLabel("daily", windowSummary.bestXp.rawLabel) : ""}
                </div>
              </div>
            </div>
          )}
          {loading && (
            <div className="pa-loading" aria-busy="true">
              <span className="pa-loading-dot" />
              <span className="pa-loading-dot" />
              <span className="pa-loading-dot" />
              <span className="pa-loading-text">Loading insights…</span>
            </div>
          )}
          {error && (
            <div className="error-text pa-error" role="alert">
              {error}
            </div>
          )}
          {!loading && !error && data && data.length === 0 && (
            <div className="pa-empty muted">
              Complete tasks to see trends here. Charts use your completion dates and XP from task
              priorities.
            </div>
          )}

          {!loading && !error && data && data.length > 0 && (
            <div
              className="productivity-charts-scroll pa-scroll"
              role="region"
              aria-label="Productivity charts"
              tabIndex={0}
            >
              <div className="productivity-grid pa-grid">
                {CHARTS.map((chart) => {
                  const pointsAll = byChart[chart.id] ?? [];
                  // `byChart` is already windowed (daily range), so don't slice again.
                  const points = pointsAll;
                  const rawPeak = points.length > 0 ? peakInSeries(points) : 0;
                  const rawLatestVal =
                    points.length > 0
                      ? chart.cumulative
                        ? cumulativeLatestDelta(
                            points,
                            chart.metricKey,
                            data,
                            windowMeta.start,
                            windowRows
                          )
                        : points[points.length - 1]!.value
                      : 0;
                  const yDom = chartYDomain(points, chart.cumulative);
                  const overlay =
                    !chart.cumulative
                      ? rollingAverage(
                          points,
                          rollingAvgSpanBuckets(timeframe, points.length, visibleDaySpan)
                        )
                      : null;
                  const avgLatest =
                    overlay && overlay.length > 0
                      ? overlay[overlay.length - 1]!.value
                      : null;
                  const avgPeak =
                    overlay && overlay.length > 0 ? peakInSeries(overlay) : null;
                  const cumulativeGrowthPct =
                    chart.cumulative && points.length > 0
                      ? cumulativePopGrowthPercent(points, rawLatestVal)
                      : null;

                  return (
                    <article key={chart.id} className="productivity-card pa-card">
                      <div className="pa-card-top">
                        <div className="productivity-card-head pa-card-head pa-card-head-row">
                          <div className="pa-card-head-text">
                            <h3 className="productivity-card-title pa-card-title">{chart.title}</h3>
                            <p className="productivity-card-sub pa-card-desc">{chart.description}</p>
                          </div>
                          {points.length > 0 && (
                            <button
                              type="button"
                              className="pa-expand-chart-btn"
                              aria-label={`Open full screen for ${chart.title}. Same range and timeframe. Press Escape to close.`}
                              title={`Open full screen: ${chart.title}. Keeps your current range and timeframe. Press Esc or Exit to return.`}
                              onClick={() => setFullscreenChartId(chart.id)}
                            >
                              <span className="pa-expand-icon" aria-hidden="true">
                                <svg
                                  className="pa-expand-svg"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path
                                    d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
                                    stroke="currentColor"
                                    strokeWidth="1.85"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    vectorEffect="non-scaling-stroke"
                                  />
                                </svg>
                              </span>
                            </button>
                          )}
                        </div>
                        {points.length > 0 && (
                          <div className="pa-stat-pills">
                            <div className="pa-pill">
                              <span className="pa-pill-label">
                                {chart.cumulative ? "Vs prior period" : "Latest"}
                              </span>
                              <span className="pa-pill-value">
                                {formatPillValue(rawLatestVal)}
                              </span>
                            </div>
                            {chart.cumulative && (
                              <div
                                className="pa-pill pa-pill-growth"
                                title="Change vs prior cumulative level, as a percent of that level"
                              >
                                <span className="pa-pill-label">Growth %</span>
                                <span className="pa-pill-value pa-pill-value-growth">
                                  {formatGrowthPercent(cumulativeGrowthPct)}
                                </span>
                              </div>
                            )}
                            <div className="pa-pill pa-pill-muted">
                              <span className="pa-pill-label">Peak</span>
                              <span className="pa-pill-value">
                                {formatPillValue(rawPeak)}
                              </span>
                            </div>
                            {avgLatest !== null && avgPeak !== null && (
                              <>
                                <div className="pa-pill pa-pill-avg">
                                  <span className="pa-pill-label">Avg · latest</span>
                                  <span className="pa-pill-value">
                                    {formatPillValue(avgLatest)}
                                  </span>
                                </div>
                                <div className="pa-pill pa-pill-avg-muted">
                                  <span className="pa-pill-label">Avg · peak</span>
                                  <span className="pa-pill-value">
                                    {formatPillValue(avgPeak)}
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="productivity-chart pa-chart-panel">
                        {points.length === 0 ? (
                          <div className="muted small pa-no-data">No data for this timeframe.</div>
                        ) : (
                          <>
                            <div className="pa-chart-window-caption" aria-label="Visible period">
                              <span className="pa-chart-window-caption-label">Shown</span>
                              <span className="pa-chart-window-caption-range">
                                {formatAxisLabel(timeframe, points[0]!.rawLabel)}
                                <span className="pa-chart-window-caption-sep" aria-hidden="true">
                                  —
                                </span>
                                {formatAxisLabel(
                                  timeframe,
                                  points[points.length - 1]!.rawLabel
                                )}
                              </span>
                              <span className="pa-chart-window-caption-meta">
                                {points.length} {points.length === 1 ? "point" : "points"}
                              </span>
                            </div>
                            {overlay && <PaDualSeriesLegend />}
                          <InsightChart
                            chartId={chart.id}
                            points={points}
                            overlayPoints={overlay}
                            yMin={yDom.yMin}
                            yMax={yDom.yMax}
                            timeframe={timeframe}
                            xAxisLabel={timeframe === "daily" ? "Date" : "Period"}
                            yAxisLabel={chart.yAxisLabel}
                            mode="inline"
                            showArea={chart.cumulative}
                          />
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    {fsChart && (
      <div
        className="pa-fs-overlay pa-pro-shell"
        role="dialog"
        aria-modal="true"
        aria-label={`${fsChart.title} — full screen`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setFullscreenChartId(null);
        }}
      >
        <div
          className="pa-fs-chrome"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="pa-fs-header">
            <div className="pa-fs-header-main">
              <h2 className="pa-fs-title">{fsChart.title}</h2>
              <p className="pa-fs-desc">{fsChart.description}</p>
            </div>
            <div className="pa-fs-actions">
              <button
                type="button"
                className="ghost-button small"
                onClick={() => setFullscreenChartId(null)}
              >
                Exit full screen
              </button>
            </div>
          </header>

          <div className="pa-fs-range-bar">
            {rangeControlsEl}
            <p className="pa-fs-scroll-hint muted small">
              Scroll this chart horizontally if the timeline is wider than the screen.
            </p>
          </div>
          {fsPoints.length > 0 && (
            <div className="pa-fs-pills">
              <div className="pa-pill">
                <span className="pa-pill-label">
                  {fsChart.cumulative ? "Vs prior period" : "Latest"}
                </span>
                <span className="pa-pill-value">{formatPillValue(fsLatestVal)}</span>
              </div>
              {fsChart.cumulative && (
                <div
                  className="pa-pill pa-pill-growth"
                  title="Change vs prior cumulative level, as a percent of that level"
                >
                  <span className="pa-pill-label">Growth %</span>
                  <span className="pa-pill-value pa-pill-value-growth">
                    {formatGrowthPercent(fsCumulativeGrowthPct)}
                  </span>
                </div>
              )}
              <div className="pa-pill pa-pill-muted">
                <span className="pa-pill-label">Peak</span>
                <span className="pa-pill-value">{formatPillValue(fsRawPeak)}</span>
              </div>
              {fsOverlayLatest !== null && fsOverlayPeak !== null && (
                <>
                  <div className="pa-pill pa-pill-avg">
                    <span className="pa-pill-label">Avg · latest</span>
                    <span className="pa-pill-value">{formatPillValue(fsOverlayLatest)}</span>
                  </div>
                  <div className="pa-pill pa-pill-avg-muted">
                    <span className="pa-pill-label">Avg · peak</span>
                    <span className="pa-pill-value">{formatPillValue(fsOverlayPeak)}</span>
                  </div>
                </>
              )}
            </div>
          )}
          <div className="pa-fs-chart-host">
            {fsPoints.length === 0 ? (
              <div className="muted pa-no-data pa-no-data-fs">No data for this timeframe.</div>
            ) : (
              <>
                {fsOverlay && <PaDualSeriesLegend fullscreen />}
                <InsightChart
                  chartId={fsChart.id}
                  points={fsPoints}
                  overlayPoints={fsOverlay}
                  yMin={fsYDomain.yMin}
                  yMax={fsYDomain.yMax}
                  timeframe={timeframe}
                  xAxisLabel={timeframe === "daily" ? "Date" : "Period"}
                  yAxisLabel={fsChart.yAxisLabel}
                  mode="fullscreen"
                  idSuffix="-fs"
                  showArea={fsChart.cumulative}
                />
              </>
            )}
            <nav
              className="pa-fs-chart-nav pa-fs-chart-nav--below-axis"
              aria-label="Switch productivity chart without leaving full screen"
            >
              <div className="pa-fs-chart-nav-side pa-fs-chart-nav-side--prev">
                <div id="pa-fs-prev-explainer" className="pa-fs-chart-nav-explainer">
                  {fsPrevChart ? (
                    <>
                      <span className="pa-fs-chart-nav-kicker">Go to previous chart</span>
                      <span className="pa-fs-chart-nav-title">{fsPrevChart.title}</span>
                      <span className="pa-fs-chart-nav-desc">{fsPrevChart.description}</span>
                    </>
                  ) : (
                    <span className="pa-fs-chart-nav-edge muted">First chart in this view.</span>
                  )}
                </div>
                <button
                  type="button"
                  className="pa-fs-chart-nav-btn pa-fs-chart-nav-btn--prev"
                  onClick={() => fsPrevChart && setFullscreenChartId(fsPrevChart.id)}
                  disabled={!fsPrevChart}
                  aria-describedby="pa-fs-prev-explainer"
                  aria-label={
                    fsPrevChart
                      ? `Previous chart: ${fsPrevChart.title}`
                      : "No previous chart"
                  }
                >
                  <span className="pa-fs-chart-nav-btn-arrow" aria-hidden="true">
                    ←
                  </span>
                  <span className="pa-fs-chart-nav-btn-text">Previous chart</span>
                </button>
              </div>

              <div className="pa-fs-chart-nav-center">
                <span className="pa-fs-chart-nav-counter">
                  Chart {fsChartIndex + 1} of {CHARTS.length}
                </span>
                <span className="pa-fs-chart-nav-keys-hint muted small">
                  Keys <kbd className="pa-kbd">[</kbd> <kbd className="pa-kbd">]</kbd>
                </span>
              </div>

              <div className="pa-fs-chart-nav-side pa-fs-chart-nav-side--next">
                <div id="pa-fs-next-explainer" className="pa-fs-chart-nav-explainer">
                  {fsNextChart ? (
                    <>
                      <span className="pa-fs-chart-nav-kicker">Go to next chart</span>
                      <span className="pa-fs-chart-nav-title">{fsNextChart.title}</span>
                      <span className="pa-fs-chart-nav-desc">{fsNextChart.description}</span>
                    </>
                  ) : (
                    <span className="pa-fs-chart-nav-edge muted">Last chart in this view.</span>
                  )}
                </div>
                <button
                  type="button"
                  className="pa-fs-chart-nav-btn pa-fs-chart-nav-btn--next"
                  onClick={() => fsNextChart && setFullscreenChartId(fsNextChart.id)}
                  disabled={!fsNextChart}
                  aria-describedby="pa-fs-next-explainer"
                  aria-label={
                    fsNextChart
                      ? `Next chart: ${fsNextChart.title}`
                      : "No next chart"
                  }
                >
                  <span className="pa-fs-chart-nav-btn-text">Next chart</span>
                  <span className="pa-fs-chart-nav-btn-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              </div>
            </nav>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
