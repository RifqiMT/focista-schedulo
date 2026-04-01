import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

type ProjectRef = { id: string; name: string };
type ProjectBreakdownRow = {
  date: string;
  tasksCompletedByProject: Record<string, number>;
  xpGainedByProject: Record<string, number>;
};
type ProjectBreakdownPayload = {
  projects: ProjectRef[];
  rows: ProjectBreakdownRow[];
};

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

type FsAnyChart =
  | { kind: "single"; id: string; title: string; description: string; yAxisLabel: string; chart: ChartConfig }
  | { kind: "project"; id: "tasksCompletedByProject"; title: string; description: string; yAxisLabel: string };

const FS_ALL: ReadonlyArray<FsAnyChart> = [
  ...CHARTS.map((c) => ({
    kind: "single" as const,
    id: c.id,
    title: c.title,
    description: c.description,
    yAxisLabel: c.yAxisLabel,
    chart: c
  })),
  {
    kind: "project" as const,
    id: "tasksCompletedByProject",
    title: "Tasks completed by project",
    description: "Tasks finished per period, split by project (top projects in the selected range).",
    yAxisLabel: "Tasks · per period"
  }
];

type Point = { label: string; value: number; rawLabel: string };

type MultiSeries = {
  id: string;
  name: string;
  color: string;
  points: Point[];
};

function seriesPaletteColor(idx: number): string {
  // Distinct, high-contrast colors that read well on light surfaces.
  const colors = [
    "#ce1126", // brand red
    "#0f766e", // teal
    "#7c3aed", // purple
    "#2563eb", // blue
    "#ea580c", // orange
    "#16a34a", // green
    "#0ea5e9", // sky
    "#9333ea", // violet
    "#7f1d1d" // deep red
  ];
  return colors[idx % colors.length]!;
}

function bucketKeyFor(dateIso: string, timeframe: Timeframe): { key: string; label: string } {
  const d = new Date(`${dateIso}T12:00:00`);
  const y = d.getFullYear();
  const m = d.getMonth();

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
        const dayName = d0.toLocaleDateString(undefined, { weekday: "short" });
        const dayPart = d0.toLocaleDateString(
          undefined,
          d0.getFullYear() !== nowY
            ? { month: "short", day: "numeric", year: "2-digit" }
            : { month: "short", day: "numeric" }
        );
        return `${dayName}, ${dayPart}`;
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

function projectSeriesTotals(
  series: MultiSeries[],
  visibleIds: Set<string>
): { latest: number; peak: number } | null {
  if (series.length === 0) return null;
  const len = series[0]?.points.length ?? 0;
  if (len === 0) return { latest: 0, peak: 0 };
  if (visibleIds.size === 0) return null;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (const s of series) {
      if (!visibleIds.has(s.id)) continue;
      sum += s.points[i]?.value ?? 0;
    }
    peak = Math.max(peak, sum);
  }
  let latest = 0;
  const i = len - 1;
  for (const s of series) {
    if (!visibleIds.has(s.id)) continue;
    latest += s.points[i]?.value ?? 0;
  }
  return { latest, peak };
}

/** Inline + fullscreen: explicit dual-series legend with show/hide toggles. */
function PaDualSeriesLegend({
  fullscreen,
  showRaw,
  showAvg,
  onToggleRaw,
  onToggleAvg
}: {
  fullscreen?: boolean;
  showRaw: boolean;
  showAvg: boolean;
  onToggleRaw: () => void;
  onToggleAvg: () => void;
}) {
  const allOn = showRaw && showAvg;
  const noneOn = !showRaw && !showAvg;
  const setAll = (on: boolean) => {
    if (on) {
      if (!showRaw) onToggleRaw();
      if (!showAvg) onToggleAvg();
      return;
    }
    if (showRaw) onToggleRaw();
    if (showAvg) onToggleAvg();
  };

  return (
    <div
      className={`pa-legend pa-legend--toggles${fullscreen ? " pa-legend--fs" : ""}`}
      aria-label="Chart legend (toggle series)"
    >
      <div className="pa-legend-bar">
        <div className="pa-legend-bar-left">
          <span className="pa-legend-bar-title">Series</span>
          <span className="pa-legend-bar-meta" aria-label="Visible series count">
            {(showRaw ? 1 : 0) + (showAvg ? 1 : 0)}/2 visible
          </span>
        </div>
        <div className="pa-legend-bar-actions" role="group" aria-label="Legend actions">
          {noneOn ? (
            <button
              type="button"
              className="ghost-button small"
              onClick={() => setAll(true)}
              title="Show all series"
            >
              Show all
            </button>
          ) : allOn ? (
            <button
              type="button"
              className="ghost-button small"
              onClick={() => setAll(false)}
              title="Hide all series"
            >
              Hide all
            </button>
          ) : (
            <>
              <button
                type="button"
                className="ghost-button small"
                onClick={() => setAll(false)}
                title="Hide all series"
              >
                Hide all
              </button>
              <button
                type="button"
                className="ghost-button small"
                onClick={() => setAll(true)}
                title="Show all series"
              >
                Show all
              </button>
            </>
          )}
        </div>
      </div>

      <div className="pa-legend-row" role="group" aria-label="Toggle series visibility">
        <button
          type="button"
          className={`pa-legend-chip pa-legend-chip--raw ${showRaw ? "is-on" : "is-off"}`}
          aria-pressed={showRaw}
          onClick={onToggleRaw}
          title={showRaw ? "Hide raw series (dashed brand red)" : "Show raw series (dashed brand red)"}
        >
          <div className="pa-legend-swatch-col" aria-hidden="true">
            <span className="pa-legend-swatch raw" />
          </div>
          <div className="pa-legend-copy">
            <span className="pa-legend-chip-title">Raw</span>
            <span className="pa-legend-chip-sub">Per period (unsmoothed)</span>
          </div>
        </button>
        <button
          type="button"
          className={`pa-legend-chip pa-legend-chip--avg ${showAvg ? "is-on" : "is-off"}`}
          aria-pressed={showAvg}
          onClick={onToggleAvg}
          title={showAvg ? "Hide rolling average (solid gold)" : "Show rolling average (solid gold)"}
        >
          <div className="pa-legend-swatch-col" aria-hidden="true">
            <span className="pa-legend-swatch avg" />
          </div>
          <div className="pa-legend-copy">
            <span className="pa-legend-chip-title">Rolling average</span>
            <span className="pa-legend-chip-sub">Smoothed trend</span>
          </div>
        </button>
      </div>
    </div>
  );
}

class PaErrorBoundary extends React.Component<
  { title: string; onClose: () => void; onRecover?: () => void; children: any },
  { hasError: boolean; message: string }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(err: unknown) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    return { hasError: true, message: msg };
  }
  componentDidCatch() {
    // Intentionally no console spam here; we render a recovery UI instead.
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="pa-no-data pa-no-data-fs" role="alert">
        <div className="muted" style={{ marginBottom: "0.5rem" }}>
          {this.props.title}
        </div>
        <div style={{ fontWeight: 750, marginBottom: "0.5rem" }}>
          Something went wrong while rendering this view.
        </div>
        <div className="muted small" style={{ marginBottom: "0.85rem" }}>
          {this.state.message}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {this.props.onRecover ? (
            <button type="button" className="ghost-button small" onClick={this.props.onRecover}>
              Try again
            </button>
          ) : null}
          <button type="button" className="ghost-button small" onClick={this.props.onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }
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
  showArea = false,
  showRaw = true,
  showAvg = true
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
  /** Show/hide the raw (primary) series. */
  showRaw?: boolean;
  /** Show/hide the rolling average overlay series. */
  showAvg?: boolean;
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
    const desiredX = r.left + (hover.px / VB_W) * r.width;
    const desiredY = r.top + (hover.py / VB_H) * r.height;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 10;
    const tipRect = tip.getBoundingClientRect();
    const halfW = Math.max(20, tipRect.width / 2);
    const clampedX = Math.max(pad + halfW, Math.min(vw - pad - halfW, desiredX));
    const clampedY = Math.max(pad, Math.min(vh - pad, desiredY));

    tip.style.left = `${clampedX}px`;
    tip.style.top = `${clampedY}px`;
  }, [hover]);

  useEffect(() => {
    if (!hover) return;
    let raf = 0;
    const tick = () => {
      const tip = tooltipRef.current;
      const svg = svgRef.current;
      if (tip && svg) {
        const r = svg.getBoundingClientRect();
        const desiredX = r.left + (hover.px / VB_W) * r.width;
        const desiredY = r.top + (hover.py / VB_H) * r.height;

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const pad = 10;
        const tipRect = tip.getBoundingClientRect();
        const halfW = Math.max(20, tipRect.width / 2);
        const clampedX = Math.max(pad + halfW, Math.min(vw - pad - halfW, desiredX));
        const clampedY = Math.max(pad, Math.min(vh - pad, desiredY));

        tip.style.left = `${clampedX}px`;
        tip.style.top = `${clampedY}px`;
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
  const overlayPresent = Boolean(overlayLineD);
  const overlayVisible = overlayPresent && showAvg;
  const dualVisible = overlayVisible && showRaw;
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
            const prevPt = hi > 0 ? points[hi - 1]! : null;
            const ov = overlayVisible ? overlayPoints?.[hi] : null;
            const prevOv = overlayVisible && hi > 0 ? overlayPoints?.[hi - 1] ?? null : null;
            const pyRatio = hover.py / VB_H;
            const tooltipY = pyRatio < 0.34 ? "below" : "above";

            const growthChip = (current: number, prev: number | null) => {
              if (prev == null) return null;
              if (prev === 0) {
                if (current === 0) {
                  return { text: "0%", kind: "flat" as const, aria: "0% vs previous period" };
                }
                return { text: "—", kind: "na" as const, aria: "No previous baseline (previous period is 0)" };
              }
              const pct = ((current - prev) / Math.abs(prev)) * 100;
              const rounded = Math.round(pct * 10) / 10;
              const text = `${rounded >= 0 ? "+" : ""}${String(rounded).replace(/\\.0$/, "")}%`;
              return {
                text,
                kind: rounded > 0 ? ("up" as const) : rounded < 0 ? ("down" as const) : ("flat" as const),
                aria: `${text} vs previous period`
              };
            };

            const rawGrowth = showRaw ? growthChip(pt.value, prevPt ? prevPt.value : null) : null;
            const avgGrowth = ov ? growthChip(ov.value, prevOv ? prevOv.value : null) : null;
            const rawName = showArea ? "Cumulative" : "Raw";
            const rawStyleChip = overlayPresent ? "Dashed red" : showArea ? "Solid red" : "Solid red";
            return (
              <div
                ref={tooltipRef}
                className={`pa-chart-tooltip pa-chart-tooltip--portal pa-chart-tooltip--y-${tooltipY}${
                  dualVisible ? " pa-chart-tooltip--dual" : ""
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
                    className={`pa-chart-tooltip-metrics${dualVisible ? "" : " pa-chart-tooltip-metrics--solo"}`}
                  >
                    {dualVisible ? (
                      <>
                        <section
                          className="pa-chart-tooltip-metric pa-chart-tooltip-metric--raw"
                          aria-label={`${rawName}: ${formatPillValue(pt.value)}. ${rawStyleChip} line on chart.`}
                        >
                          <div className="pa-chart-tooltip-metric-top">
                            <span className="pa-chart-tooltip-dot pa-chart-tooltip-dot--raw" aria-hidden />
                            <div className="pa-chart-tooltip-metric-body">
                              <div className="pa-chart-tooltip-metric-line">
                                <span className="pa-chart-tooltip-metric-name">{rawName}</span>
                                <span className="pa-chart-tooltip-metric-fig pa-chart-tooltip-metric-fig--inline">
                                  {formatPillValue(pt.value)}
                                </span>
                                {rawGrowth ? (
                                  <span
                                    className={`pa-chart-tooltip-chip pa-chart-tooltip-chip--growth pa-chart-tooltip-chip--growth-${rawGrowth.kind}`}
                                    aria-label={rawGrowth.aria}
                                  >
                                    {rawGrowth.text}
                                  </span>
                                ) : null}
                                <span className="pa-chart-tooltip-chip pa-chart-tooltip-chip--raw">
                                  {rawStyleChip}
                                </span>
                              </div>
                            </div>
                          </div>
                        </section>
                        {ov && (
                          <section
                            className="pa-chart-tooltip-metric pa-chart-tooltip-metric--avg"
                            aria-label={`Rolling average: ${formatPillValue(ov.value)}. Solid gold line.`}
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
                                  {avgGrowth ? (
                                    <span
                                      className={`pa-chart-tooltip-chip pa-chart-tooltip-chip--growth pa-chart-tooltip-chip--growth-${avgGrowth.kind}`}
                                      aria-label={avgGrowth.aria}
                                    >
                                      {avgGrowth.text}
                                    </span>
                                  ) : null}
                                  <span className="pa-chart-tooltip-chip pa-chart-tooltip-chip--avg">
                                    Smoothed
                                  </span>
                                </div>
                              </div>
                            </div>
                          </section>
                        )}
                      </>
                    ) : showRaw ? (
                      <section
                        className="pa-chart-tooltip-metric pa-chart-tooltip-metric--raw pa-chart-tooltip-metric--solo"
                        aria-label={`${rawName}: ${formatPillValue(pt.value)}.`}
                      >
                        <div className="pa-chart-tooltip-metric-top">
                          <span className="pa-chart-tooltip-dot pa-chart-tooltip-dot--raw" aria-hidden />
                          <div className="pa-chart-tooltip-metric-body">
                            <div className="pa-chart-tooltip-metric-line">
                              <span className="pa-chart-tooltip-metric-name">{rawName}</span>
                              <span className="pa-chart-tooltip-metric-fig pa-chart-tooltip-metric-fig--inline">
                                {formatPillValue(pt.value)}
                              </span>
                              {rawGrowth ? (
                                <span
                                  className={`pa-chart-tooltip-chip pa-chart-tooltip-chip--growth pa-chart-tooltip-chip--growth-${rawGrowth.kind}`}
                                  aria-label={rawGrowth.aria}
                                >
                                  {rawGrowth.text}
                                </span>
                              ) : null}
                              <span className="pa-chart-tooltip-chip pa-chart-tooltip-chip--raw">
                                {rawStyleChip}
                              </span>
                            </div>
                          </div>
                        </div>
                      </section>
                    ) : ov ? (
                      <section
                        className="pa-chart-tooltip-metric pa-chart-tooltip-metric--avg pa-chart-tooltip-metric--solo"
                        aria-label={`Rolling average: ${formatPillValue(ov.value)}.`}
                      >
                        <div className="pa-chart-tooltip-metric-top">
                          <span className="pa-chart-tooltip-dot pa-chart-tooltip-dot--avg" aria-hidden />
                          <div className="pa-chart-tooltip-metric-body">
                            <div className="pa-chart-tooltip-metric-line pa-chart-tooltip-metric-line--solo">
                              <span className="pa-chart-tooltip-metric-fig pa-chart-tooltip-metric-fig--solo">
                                {formatPillValue(ov.value)}
                              </span>
                              {avgGrowth ? (
                                <span
                                  className={`pa-chart-tooltip-chip pa-chart-tooltip-chip--growth pa-chart-tooltip-chip--growth-${avgGrowth.kind}`}
                                  aria-label={avgGrowth.aria}
                                >
                                  {avgGrowth.text}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </section>
                    ) : null}
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
            {showRaw && areaPathD && (
              <path d={areaPathD} className="pa-chart-area" fill={`url(#${gradId})`} />
            )}
            {showAvg && overlayLineD && (
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
            {showRaw && linePathD && (
              <path
                d={linePathD}
                fill="none"
                className={`pa-chart-line pa-chart-line-primary ${overlayVisible ? "pa-chart-line-primary--muted" : ""}`}
                stroke="currentColor"
                strokeWidth={overlayVisible ? Math.max(1.2, strokeW * 0.9) : strokeW}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                strokeDasharray={overlayPresent ? "3 3.5" : undefined}
                opacity={overlayVisible ? 0.92 : 1}
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
                className={`pa-chart-scrubber ${dualVisible ? "pa-chart-scrubber--dual" : "pa-chart-scrubber--single"}`}
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

function MultiLineChart({
  chartId,
  series,
  yMin,
  yMax,
  timeframe,
  xAxisLabel = "Date",
  yAxisLabel,
  mode = "inline",
  idSuffix = "",
  visibleSeriesIds,
  onToggleSeries
}: {
  chartId: string;
  series: MultiSeries[];
  yMin: number;
  yMax: number;
  timeframe: Timeframe;
  xAxisLabel?: string;
  yAxisLabel: string;
  mode?: InsightChartMode;
  idSuffix?: string;
  visibleSeriesIds: Set<string>;
  onToggleSeries: (id: string) => void;
}) {
  const pointsLen = series[0]?.points.length ?? 0;
  const [hover, setHover] = useState<{ idx: number; px: number; py: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [chartContainerW, setChartContainerW] = useState(0);
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
  }, [mode, chartId, pointsLen]);

  useLayoutEffect(() => {
    if (!hover) return;
    const tip = tooltipRef.current;
    const svg = svgRef.current;
    if (!tip || !svg) return;

    const r = svg.getBoundingClientRect();
    const desiredX = r.left + (hover.px / VB_W) * r.width;
    const desiredY = r.top + (hover.py / VB_H) * r.height;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 10;
    const tipRect = tip.getBoundingClientRect();
    const halfW = Math.max(20, tipRect.width / 2);
    const clampedX = Math.max(pad + halfW, Math.min(vw - pad - halfW, desiredX));
    const clampedY = Math.max(pad, Math.min(vh - pad, desiredY));

    tip.style.left = `${clampedX}px`;
    tip.style.top = `${clampedY}px`;
  }, [hover]);

  useEffect(() => {
    if (!hover) return;
    let raf = 0;
    const tick = () => {
      const tip = tooltipRef.current;
      const svg = svgRef.current;
      if (tip && svg) {
        const r = svg.getBoundingClientRect();
        const desiredX = r.left + (hover.px / VB_W) * r.width;
        const desiredY = r.top + (hover.py / VB_H) * r.height;

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const pad = 10;
        const tipRect = tip.getBoundingClientRect();
        const halfW = Math.max(20, tipRect.width / 2);
        const clampedX = Math.max(pad + halfW, Math.min(vw - pad - halfW, desiredX));
        const clampedY = Math.max(pad, Math.min(vh - pad, desiredY));

        tip.style.left = `${clampedX}px`;
        tip.style.top = `${clampedY}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hover]);

  const xAt = useMemo(() => {
    const n = Math.max(pointsLen, 1);
    const plotW = VB_W - PAD_L - PAD_R;
    return (i: number) => {
      if (n <= 1) return PAD_L + plotW / 2;
      return PAD_L + (i / (n - 1)) * plotW;
    };
  }, [pointsLen]);

  const yAt = useMemo(() => {
    const plotH = BASE_Y - PAD_T;
    const span = yMax - yMin;
    return (v: number) => {
      const norm = span <= 0 ? 0 : (v - yMin) / span;
      const clamped = Math.max(0, Math.min(1, norm));
      return BASE_Y - clamped * plotH;
    };
  }, [yMin, yMax]);

  const visibleSeries = useMemo(
    () => series.filter((s) => visibleSeriesIds.has(s.id)),
    [series, visibleSeriesIds]
  );

  const allVisible = visibleSeriesIds.size >= series.length && series.length > 0;
  const noneVisible = visibleSeriesIds.size === 0;
  const hasVisibleData = visibleSeries.length > 0;

  const seriesPaths = useMemo(() => {
    return visibleSeries.map((s) => {
      const coords = s.points.map((p, i) => ({ x: xAt(i), y: yAt(p.value) }));
      return { id: s.id, name: s.name, color: s.color, d: linearLinePath(coords), coords };
    });
  }, [visibleSeries, xAt, yAt]);

  if (pointsLen === 0) return null;

  const setHoverIdx = (idx: number) => {
    const clamped = Math.max(0, Math.min(pointsLen - 1, idx));
    // Anchor tooltip to the highest visible series at that index (or the first).
    const anchor =
      seriesPaths
        .map((p) => p.coords[clamped])
        .filter(Boolean)
        .sort((a, b) => a.y - b.y)[0] ?? { x: xAt(clamped), y: yAt(0) };
    setHover({ idx: clamped, px: anchor.x, py: anchor.y });
  };

  const yTicks = 4;
  const ySpan = yMax - yMin;
  const tickIndices = xTickIndices(
    pointsLen,
    mode === "fullscreen" ? 14 : Math.min(11, Math.max(7, Math.ceil(pointsLen / 25)))
  );
  const strokeW = pointsLen > 450 ? 1.05 : pointsLen > 200 ? 1.35 : 1.75;

  const updateHoverFromClientX = (clientX: number) => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const plotW = VB_W - PAD_L - PAD_R;
    const xSvg = ((clientX - rect.left) / rect.width) * VB_W;
    const n = Math.max(pointsLen, 1);
    let idx: number;
    if (n <= 1) idx = 0;
    else {
      const t = (xSvg - PAD_L) / plotW;
      idx = Math.round(Math.max(0, Math.min(1, t)) * (n - 1));
    }
    setHoverIdx(idx);
  };

  const minPx = chartTrackMinWidthPx(pointsLen, mode, chartContainerW > 0 ? chartContainerW : undefined);
  const idealW = chartIdealMinWidthPx(pointsLen, mode);
  const chartCompressedInline = mode === "inline" && chartContainerW > 0 && idealW > minPx + 6;
  const trackSize = `max(100%, ${minPx}px)`;

  const tooltipPortal =
    hover !== null && hasVisibleData && typeof document !== "undefined"
      ? createPortal(
          (() => {
            const hi = hover.idx;
            const label = series[0]?.points[hi]?.rawLabel ?? "";
            const tooltipY = hover.py / VB_H < 0.34 ? "below" : "above";
            const growthChip = (current: number, prev: number | null) => {
              if (prev == null) return null;
              if (prev === 0) {
                if (current === 0) {
                  return { text: "0%", kind: "flat" as const, aria: "0% vs previous period" };
                }
                return { text: "—", kind: "na" as const, aria: "No previous baseline (previous period is 0)" };
              }
              const pct = ((current - prev) / Math.abs(prev)) * 100;
              const rounded = Math.round(pct * 10) / 10;
              const text = `${rounded >= 0 ? "+" : ""}${String(rounded).replace(/\\.0$/, "")}%`;
              return {
                text,
                kind: rounded > 0 ? ("up" as const) : rounded < 0 ? ("down" as const) : ("flat" as const),
                aria: `${text} vs previous period`
              };
            };
            const dual = visibleSeries.length > 1;
            return (
              <div
                ref={tooltipRef}
                className={`pa-chart-tooltip pa-chart-tooltip--portal pa-chart-tooltip--y-${tooltipY}${
                  dual ? " pa-chart-tooltip--dual" : ""
                }`}
                role="tooltip"
              >
                <div className="pa-chart-tooltip-card">
                  <header className="pa-chart-tooltip-head">
                    <span className="pa-chart-tooltip-head-k">{xAxisLabel}</span>
                    <span className="pa-chart-tooltip-head-v">
                      {formatAxisLabel(timeframe, label)}
                    </span>
                  </header>
                  <div className="pa-chart-tooltip-metrics pa-chart-tooltip-metrics--solo">
                    {visibleSeries.map((s) => {
                      const v = s.points[hi]?.value ?? 0;
                      const prev = hi > 0 ? s.points[hi - 1]?.value ?? null : null;
                      const g = growthChip(v, prev);
                      return (
                        <section
                          key={s.id}
                          className="pa-chart-tooltip-metric pa-chart-tooltip-metric--solo"
                          aria-label={`${s.name}: ${formatPillValue(v)}${g ? `. ${g.aria}.` : "."}`}
                        >
                          <div className="pa-chart-tooltip-metric-top">
                            <span
                              className="pa-chart-tooltip-dot"
                              aria-hidden
                              style={{ background: s.color }}
                            />
                            <div className="pa-chart-tooltip-metric-body">
                              <div className="pa-chart-tooltip-metric-line">
                                <span className="pa-chart-tooltip-metric-name">{s.name}</span>
                                <span className="pa-chart-tooltip-metric-fig pa-chart-tooltip-metric-fig--inline">
                                  {formatPillValue(v)}
                                </span>
                                {g ? (
                                  <span
                                    className={`pa-chart-tooltip-chip pa-chart-tooltip-chip--growth pa-chart-tooltip-chip--growth-${g.kind}`}
                                    aria-label={g.aria}
                                  >
                                    {g.text}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </div>
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
        <div className="pa-axis-legend pa-axis-legend-y">
          {hasVisibleData ? yAxisLabel : "No projects selected"}
        </div>
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
          onMouseMove={(e) => {
            if (!hasVisibleData) return;
            updateHoverFromClientX(e.clientX);
          }}
          onMouseLeave={() => setHover(null)}
          onTouchStart={(e) => {
            if (!hasVisibleData) return;
            const t = e.touches[0];
            if (t) updateHoverFromClientX(t.clientX);
          }}
          onTouchMove={(e) => {
            if (!hasVisibleData) return;
            const t = e.touches[0];
            if (t) updateHoverFromClientX(t.clientX);
          }}
          onTouchEnd={() => setHover(null)}
        >
          <svg
            ref={svgRef}
            className={`pa-chart-svg ${mode === "fullscreen" ? "pa-chart-svg--fs" : ""}`}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${chartId} chart`}
          >
            <defs>
              <clipPath id={clipId}>
                <rect
                  x={PAD_L}
                  y={PAD_T}
                  width={VB_W - PAD_L - PAD_R}
                  height={BASE_Y - PAD_T + 1}
                />
              </clipPath>
            </defs>

            {Array.from({ length: yTicks + 1 }, (_, i) => {
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
              {hasVisibleData
                ? seriesPaths.map((p) => (
                    <path
                      key={p.id}
                      d={p.d}
                      fill="none"
                      stroke={p.color}
                      strokeWidth={strokeW}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      opacity={visibleSeries.length > 6 ? 0.92 : 1}
                    />
                  ))
                : null}
            </g>
          </svg>

          {!hasVisibleData ? (
            <div
              className="pa-no-data"
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                pointerEvents: "none",
                padding: "0.75rem",
                textAlign: "center"
              }}
              aria-label="No series selected"
            >
              <div className="muted small">
                No projects selected. Use <strong>Show all</strong> or toggle projects above.
              </div>
            </div>
          ) : null}

          {hover !== null && hasVisibleData && (
            <div className="pa-chart-hover-layer" aria-hidden="true">
              <div
                className="pa-chart-v-rule"
                style={{ left: `${(hover.px / VB_W) * 100}%` }}
              />
              <div
                className="pa-chart-scrubber pa-chart-scrubber--single"
                style={{
                  left: `${(hover.px / VB_W) * 100}%`,
                  top: `${(hover.py / VB_H) * 100}%`
                }}
              />
            </div>
          )}
        </div>

        <div
          className={`pa-chart-xaxis pa-chart-xaxis--pos ${mode === "fullscreen" ? "pa-chart-xaxis--fs" : ""}`}
        >
          {tickIndices.map((i, tpos) => {
            const leftPct = pointsLen <= 1 ? 50 : (i / (pointsLen - 1)) * 100;
            const isSingleton = tickIndices.length === 1;
            const isFirst = !isSingleton && tpos === 0;
            const isLast = !isSingleton && tpos === tickIndices.length - 1;
            const raw = series[0]!.points[i]!.rawLabel;
            return (
              <span
                key={`x-${raw}-${i}`}
                className={`pa-chart-xcell ${isSingleton ? "is-singleton" : ""} ${isFirst ? "is-first" : ""} ${isLast ? "is-last" : ""}`}
                style={{ left: `${leftPct}%` }}
              >
                {formatAxisLabel(timeframe, raw)}
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
        className={`pa-legend pa-legend--projects${mode === "fullscreen" ? " pa-legend--fs" : ""}`}
        aria-label="Project series legend"
      >
        <div className="pa-legend-bar">
          <div className="pa-legend-bar-left">
            <span className="pa-legend-bar-title">Projects</span>
            <span className="pa-legend-bar-meta" aria-label="Visible series count">
              {visibleSeriesIds.size}/{series.length} visible
            </span>
          </div>
          <div className="pa-legend-bar-actions" role="group" aria-label="Legend actions">
            {noneVisible ? (
              <button
                type="button"
                className="ghost-button small"
                onClick={() => {
                  for (const s of series) {
                    if (!visibleSeriesIds.has(s.id)) onToggleSeries(s.id);
                  }
                }}
                title="Show all projects"
              >
                Show all
              </button>
            ) : allVisible ? (
              <button
                type="button"
                className="ghost-button small"
                onClick={() => {
                  for (const s of series) {
                    if (visibleSeriesIds.has(s.id)) onToggleSeries(s.id);
                  }
                }}
                title="Hide all projects"
              >
                Hide all
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="ghost-button small"
                  onClick={() => {
                    for (const s of series) {
                      if (visibleSeriesIds.has(s.id)) onToggleSeries(s.id);
                    }
                  }}
                  title="Hide all projects"
                >
                  Hide all
                </button>
                <button
                  type="button"
                  className="ghost-button small"
                  onClick={() => {
                    for (const s of series) {
                      if (!visibleSeriesIds.has(s.id)) onToggleSeries(s.id);
                    }
                  }}
                  title="Show all projects"
                >
                  Show all
                </button>
              </>
            )}
          </div>
        </div>

        <div className="pa-legend-row" role="group" aria-label="Toggle project series visibility">
          {series.map((s) => {
            const on = visibleSeriesIds.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                className={`pa-legend-chip pa-legend-chip--project ${on ? "is-on" : "is-off"}`}
                aria-pressed={on}
                onClick={() => onToggleSeries(s.id)}
                title={on ? `Hide ${s.name}` : `Show ${s.name}`}
              >
                <span className="pa-legend-swatch-col" aria-hidden="true">
                  <span className="pa-legend-swatch" style={{ background: s.color }} />
                </span>
                <span className="pa-legend-copy">
                  <span className="pa-legend-chip-title">{s.name}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        ref={scrollRef}
        className={`pa-chart-h-scroll ${mode === "fullscreen" ? "pa-chart-h-scroll--fs" : ""}`}
        role="region"
        aria-label={`${chartId} scroll area`}
        tabIndex={0}
        onFocus={() => {
          if (!hover) setHoverIdx(pointsLen - 1);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            setHoverIdx((hover?.idx ?? pointsLen - 1) - 1);
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
            setHoverIdx(pointsLen - 1);
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setHover(null);
          }
        }}
        onPointerDown={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest(".pa-legend")) return;
          updateHoverFromClientX((e as any).clientX);
        }}
        onPointerMove={(e) => {
          if ((e as any).buttons !== 1) return;
          updateHoverFromClientX((e as any).clientX);
        }}
      >
        <div
          className={`pa-chart-h-track ${mode === "fullscreen" ? "pa-chart-h-track--fs" : ""}`}
          style={{ width: trackSize, minWidth: trackSize }}
        >
          {shell}
        </div>
      </div>

      {mode === "inline" && chartCompressedInline && pointsLen > 24 && (
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
            Timeline is scaled to fit this card. Drag horizontally or use full screen for more spacing.
            Hover or drag along the line for values.
          </span>
        </p>
      )}
      {tooltipPortal}
    </>
  );
}

export function ProductivityAnalysisModal({ open, onClose }: Props) {
  const [data, setData] = useState<ProductivityRow[] | null>(null);
  const [projectBreakdown, setProjectBreakdown] = useState<ProjectBreakdownPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("daily");
  const [fullscreenChartId, setFullscreenChartId] = useState<string | null>(null);
  const [daysWindow, setDaysWindow] = useState<PaRangeDays>(60);
  const [windowStart, setWindowStart] = useState(0);
  const [seriesVisibility, setSeriesVisibility] = useState<
    Record<string, { raw: boolean; avg: boolean }>
  >({});
  const [projectSeriesVisibility, setProjectSeriesVisibility] = useState<Record<string, boolean>>(
    {}
  );
  const windowStep = useMemo(() => rangeStepDays(daysWindow), [daysWindow]);

  const annuallyTimeframeDisabled =
    daysWindow !== PA_RANGE_ALL && daysWindow <= 365;

  const requestBrowserFullscreen = async () => {
    if (typeof document === "undefined") return;
    const docAny = document as unknown as {
      fullscreenElement?: Element | null;
      webkitFullscreenElement?: Element | null;
      exitFullscreen?: () => Promise<void>;
      webkitExitFullscreen?: () => Promise<void>;
      documentElement: HTMLElement & { requestFullscreen?: () => Promise<void>; webkitRequestFullscreen?: () => Promise<void> };
    };

    const already =
      Boolean(docAny.fullscreenElement) || Boolean(docAny.webkitFullscreenElement);
    if (already) return;

    const el = docAny.documentElement;
    const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
    if (!req) return;
    try {
      await req.call(el);
    } catch {
      // If the browser blocks fullscreen (non-user gesture / permissions), fall back to in-app overlay only.
      window.dispatchEvent(
        new CustomEvent("pst:toast", {
          detail: {
            kind: "info",
            title: "Fullscreen not available",
            message: "Your browser blocked fullscreen. The chart is still open in an in-app full screen view.",
            durationMs: 2800
          }
        })
      );
    }
  };

  const exitBrowserFullscreen = async () => {
    if (typeof document === "undefined") return;
    const docAny = document as unknown as {
      fullscreenElement?: Element | null;
      webkitFullscreenElement?: Element | null;
      exitFullscreen?: () => Promise<void>;
      webkitExitFullscreen?: () => Promise<void>;
    };
    const active =
      Boolean(docAny.fullscreenElement) || Boolean(docAny.webkitFullscreenElement);
    if (!active) return;
    const exit = docAny.exitFullscreen ?? docAny.webkitExitFullscreen;
    if (!exit) return;
    try {
      await exit.call(document);
    } catch {
      // ignore
    }
  };

  const openFullscreenChart = (chartId: string) => {
    // Best effort: enter *true* browser fullscreen from the user's click.
    void requestBrowserFullscreen();
    setFullscreenChartId(chartId);
  };

  const closeFullscreenChart = () => {
    void exitBrowserFullscreen();
    setFullscreenChartId(null);
  };

  const fsChromeRef = useRef<HTMLDivElement | null>(null);
  const fsCloseBtnRef = useRef<HTMLButtonElement | null>(null);
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);
  const fullscreenChartIdRef = useRef<string | null>(null);

  useEffect(() => {
    fullscreenChartIdRef.current = fullscreenChartId;
  }, [fullscreenChartId]);


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
      const started = performance.now();
      try {
        const res = await fetch("/api/productivity-insights");
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`);
        }
        const body: { rows: ProductivityRow[]; projectBreakdown?: ProjectBreakdownPayload } =
          await res.json();
        if (!cancelled) {
          setData(body.rows ?? []);
          setProjectBreakdown(body.projectBreakdown ?? null);
          const elapsed = performance.now() - started;
          if (elapsed >= 900) {
            window.dispatchEvent(
              new CustomEvent("pst:toast", {
                detail: {
                  kind: "info",
                  title: "Charts loaded",
                  message: `${(body.rows ?? []).length} data point(s).`,
                  durationMs: elapsed
                }
              })
            );
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load productivity insights."
          );
          const elapsed = performance.now() - started;
          window.dispatchEvent(
            new CustomEvent("pst:toast", {
              detail: {
                kind: "error",
                title: "Chart load failed",
                message: err instanceof Error ? err.message : "Unable to load productivity insights.",
                durationMs: elapsed
              }
            })
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
      closeFullscreenChart();
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
        const ALL = [...FS_ALL.map((c) => c.id)];
        const idx = ALL.findIndex((id) => id === fullscreenChartId);
        if (e.key === "ArrowLeft" && idx > 0) {
          e.preventDefault();
          setFullscreenChartId(ALL[idx - 1]!);
          return;
        }
        if (e.key === "ArrowRight" && idx >= 0 && idx < ALL.length - 1) {
          e.preventDefault();
          setFullscreenChartId(ALL[idx + 1]!);
          return;
        }
      }

      if (e.key !== "Escape") return;
      if (fullscreenChartId) {
        e.preventDefault();
        closeFullscreenChart();
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

  useEffect(() => {
    if (typeof document === "undefined") return;
    const docAny = document as unknown as {
      fullscreenElement?: Element | null;
      webkitFullscreenElement?: Element | null;
    };
    const compute = () =>
      Boolean(docAny.fullscreenElement) || Boolean(docAny.webkitFullscreenElement);

    const onFsChange = () => {
      const active = compute();
      setIsBrowserFullscreen(active);
      // If the browser exits fullscreen (often via Esc), also close the in-app fullscreen overlay.
      if (!active && fullscreenChartIdRef.current) {
        setFullscreenChartId(null);
      }
    };

    onFsChange();
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange" as any, onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange" as any, onFsChange);
    };
  }, []);

  useEffect(() => {
    if (!fullscreenChartId) return;
    // Focus the close button for an app-like modal feel.
    const t = window.setTimeout(() => {
      fsCloseBtnRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
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

  const projectTasksSeries = useMemo((): MultiSeries[] => {
    if (!projectBreakdown?.rows?.length || !projectBreakdown.projects?.length) return [];

    // Bucket daily breakdown rows into the selected timeframe by summing counts per project.
    const byKey = new Map<
      string,
      { rawLabel: string; byProject: Map<string, number> }
    >();

    for (const r of projectBreakdown.rows) {
      const { key } = bucketKeyFor(r.date, timeframe);
      const existing = byKey.get(key);
      const bucket = existing ?? { rawLabel: key, byProject: new Map<string, number>() };
      for (const [pid, n] of Object.entries(r.tasksCompletedByProject ?? {})) {
        bucket.byProject.set(pid, (bucket.byProject.get(pid) ?? 0) + (Number(n) || 0));
      }
      byKey.set(key, bucket);
    }

    // Preserve chronological order using chartRows buckets (so it aligns with other charts).
    const keysInOrder = chartRows.map((row) =>
      timeframe === "daily" ? row.date : bucketKeyFor(row.date, timeframe).key
    );

    // Totals per project in current window (for top-N selection).
    const totals = new Map<string, number>();
    for (const key of keysInOrder) {
      const bucket = byKey.get(key);
      if (!bucket) continue;
      for (const [pid, n] of bucket.byProject.entries()) {
        totals.set(pid, (totals.get(pid) ?? 0) + n);
      }
    }

    const projectsById = new Map(projectBreakdown.projects.map((p) => [p.id, p.name] as const));

    const sortedPids = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([pid]) => pid);

    const TOP_N = 8;
    const keep = new Set(sortedPids.slice(0, TOP_N));
    const hasOther = sortedPids.length > TOP_N;

    const buildPoints = (pid: string | null): Point[] => {
      return keysInOrder.map((key) => {
        const bucket = byKey.get(key);
        let v = 0;
        if (bucket) {
          if (pid) {
            v = bucket.byProject.get(pid) ?? 0;
          } else {
            // Other = sum of all non-top projects.
            let sum = 0;
            for (const [p, n] of bucket.byProject.entries()) {
              if (!keep.has(p)) sum += n;
            }
            v = sum;
          }
        }
        return { label: key, rawLabel: key, value: v };
      });
    };

    const seriesOut: MultiSeries[] = [];
    let idx = 0;
    for (const pid of sortedPids.slice(0, TOP_N)) {
      seriesOut.push({
        id: pid,
        name: projectsById.get(pid) ?? pid,
        color: seriesPaletteColor(idx++),
        points: buildPoints(pid)
      });
    }
    if (hasOther) {
      seriesOut.push({
        id: "__other__",
        name: "Other",
        color: seriesPaletteColor(idx++),
        points: buildPoints(null)
      });
    }

    return seriesOut;
  }, [projectBreakdown, chartRows, timeframe]);

  const projectTasksYDomain = useMemo(() => {
    if (!projectTasksSeries.length) return { yMin: 0, yMax: 1 };
    const vals: number[] = [];
    for (const s of projectTasksSeries) {
      if (!projectSeriesVisibility[s.id] && Object.keys(projectSeriesVisibility).length) continue;
      for (const p of s.points) vals.push(p.value);
    }
    if (vals.length === 0) return { yMin: 0, yMax: 1 };
    const vMax = Math.max(...vals, 1);
    const padTop = Math.max(vMax * 0.14, 0.5);
    return { yMin: 0, yMax: vMax + padTop };
  }, [projectTasksSeries, projectSeriesVisibility]);

  const visibleProjectSeriesIds = useMemo(() => {
    const ids = new Set<string>();
    if (!projectTasksSeries.length) return ids;
    // Default: all on until the user toggles.
    const hasAny = Object.keys(projectSeriesVisibility).length > 0;
    for (const s of projectTasksSeries) {
      if (!hasAny || projectSeriesVisibility[s.id] !== false) ids.add(s.id);
    }
    return ids;
  }, [projectTasksSeries, projectSeriesVisibility]);

  const toggleProjectSeries = (id: string) => {
    setProjectSeriesVisibility((prev) => {
      const next = { ...prev };
      const current = prev[id];
      const hasAny = Object.keys(prev).length > 0;
      const isOn = !hasAny || current !== false;
      next[id] = isOn ? false : true;
      return next;
    });
  };

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

  const inlineProjectTotals = useMemo(() => {
    if (projectTasksSeries.length === 0) return { latest: 0, peak: 0, hasVisible: false };
    const totals = projectSeriesTotals(projectTasksSeries, visibleProjectSeriesIds);
    if (!totals) return { latest: 0, peak: 0, hasVisible: false };
    return { ...totals, hasVisible: true };
  }, [projectTasksSeries, visibleProjectSeriesIds]);

  /** Must run every render (even when modal closed) — hooks cannot follow `if (!open) return null`. */
  const fsProjectTotals = useMemo(() => {
    const fsIsProject = fullscreenChartId === "tasksCompletedByProject";
    if (!fsIsProject || projectTasksSeries.length === 0) {
      return { latest: 0, peak: 0 };
    }
    const totals = projectSeriesTotals(projectTasksSeries, visibleProjectSeriesIds);
    return totals ?? { latest: 0, peak: 0 };
  }, [fullscreenChartId, projectTasksSeries, visibleProjectSeriesIds]);

  if (!open) return null;

  const fsAnyChart: FsAnyChart | null = fullscreenChartId
    ? (FS_ALL.find((c) => c.id === fullscreenChartId) ?? null)
    : null;
  const fsIsProject = fsAnyChart?.kind === "project";
  const fsChart = fsAnyChart?.kind === "single" ? fsAnyChart.chart : null;

  const getSeriesVis = (chartId: string, hasOverlay: boolean): { raw: boolean; avg: boolean } => {
    const v = seriesVisibility[chartId];
    if (!v) return { raw: true, avg: hasOverlay };
    return { raw: v.raw, avg: hasOverlay ? v.avg : false };
  };

  const toggleSeries = (chartId: string, key: "raw" | "avg", hasOverlay: boolean) => {
    setSeriesVisibility((prev) => {
      const current = prev[chartId] ?? { raw: true, avg: hasOverlay };
      const next = { ...current, [key]: !current[key] };
      // If this chart doesn't have overlay, avg is always false.
      if (!hasOverlay) next.avg = false;
      return { ...prev, [chartId]: next };
    });
  };
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

  const fsChartIndex = fsAnyChart ? FS_ALL.findIndex((c) => c.id === fsAnyChart.id) : -1;
  const fsPrevChart = fsChartIndex > 0 ? FS_ALL[fsChartIndex - 1]! : null;
  const fsNextChart =
    fsChartIndex >= 0 && fsChartIndex < FS_ALL.length - 1 ? FS_ALL[fsChartIndex + 1]! : null;

  const windowDailyFrom = windowRows.length > 0 ? windowRows[0]!.date : null;
  const windowDailyTo = windowRows.length > 0 ? windowRows[windowRows.length - 1]!.date : null;

  const rangeControlsEl = (
    <div className="pa-range-controls" role="group" aria-label="Chart range and timeframe">
      <div className="pa-range-left">
        <button
          type="button"
          className="ghost-button small"
          onClick={() => setWindowStart((s) => Math.max(0, s - windowStep))}
          disabled={windowMeta.start <= 0}
          title="Shift the visible window to older history."
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
          title="Shift the visible window to newer history."
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
          title="Choose how to aggregate the timeline (daily/weekly/monthly/quarterly/annual)."
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
          title="Choose how many days of history to include."
        >
          {PA_RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="pa-range-meta" aria-label="Visible range">
        <span className="pa-range-meta-label">Shown</span>{" "}
        {windowDailyFrom && windowDailyTo ? (
          <>
            <span className="pa-range-meta-strong">{formatAxisLabel("daily", windowDailyFrom)}</span>
            <span className="pa-range-meta-sep" aria-hidden="true">
              —
            </span>
            <span className="pa-range-meta-strong">{formatAxisLabel("daily", windowDailyTo)}</span>
          </>
        ) : (
          <span className="pa-range-meta-strong">—</span>
        )}
        <span className="pa-range-meta-buckets">
          {" "}
          · {windowRows.length} {windowRows.length === 1 ? "day" : "days"}
        </span>
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
              <div className="pa-grid">
                {projectTasksSeries.length > 0 && (
                  <article key="tasksCompletedByProject" className="pa-card">
                    <div className="pa-card-top">
                      <div className="pa-card-head pa-card-head-row">
                        <div className="pa-card-head-text">
                          <h3 className="pa-card-title">
                            Tasks completed by project
                          </h3>
                          <p className="pa-card-desc">
                            Tasks finished per period, split by project (top projects in the selected range).
                          </p>
                        </div>
                        <button
                          type="button"
                          className="pa-expand-chart-btn"
                          aria-label="Open full screen for Tasks completed by project. Same range and timeframe. Press Escape to close."
                          title="Open full screen: Tasks completed by project. Keeps your current range and timeframe. Press Esc or Exit to return."
                          onClick={() => openFullscreenChart("tasksCompletedByProject")}
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
                          <span className="pa-expand-text">Fullscreen</span>
                        </button>
                      </div>
                      <div className="pa-stat-pills" aria-label="Project chart quick stats">
                        <div className="pa-pill">
                          <span className="pa-pill-label">Latest</span>
                          <span className="pa-pill-value">
                            {inlineProjectTotals.hasVisible
                              ? formatPillValue(inlineProjectTotals.latest)
                              : "—"}
                          </span>
                        </div>
                        <div className="pa-pill pa-pill-muted">
                          <span className="pa-pill-label">Peak</span>
                          <span className="pa-pill-value">
                            {inlineProjectTotals.hasVisible
                              ? formatPillValue(inlineProjectTotals.peak)
                              : "—"}
                          </span>
                        </div>
                        <div
                          className="pa-pill pa-pill-avg-muted"
                          title="Number of visible project series"
                        >
                          <span className="pa-pill-label">Series</span>
                          <span className="pa-pill-value">{visibleProjectSeriesIds.size}</span>
                        </div>
                      </div>
                    </div>

                    <div className="pa-chart-panel">
                      <div className="pa-chart-window-caption" aria-label="Visible period">
                        <span className="pa-chart-window-caption-label">Shown</span>
                        <span className="pa-chart-window-caption-range">
                          {formatAxisLabel(timeframe, projectTasksSeries[0]!.points[0]!.rawLabel)}
                          <span className="pa-chart-window-caption-sep" aria-hidden="true">
                            —
                          </span>
                          {formatAxisLabel(
                            timeframe,
                            projectTasksSeries[0]!.points[projectTasksSeries[0]!.points.length - 1]!
                              .rawLabel
                          )}
                        </span>
                        <span className="pa-chart-window-caption-meta">
                          {projectTasksSeries[0]!.points.length}{" "}
                          {projectTasksSeries[0]!.points.length === 1 ? "point" : "points"}
                        </span>
                      </div>
                      <MultiLineChart
                        chartId="tasksCompletedByProject"
                        series={projectTasksSeries}
                        yMin={projectTasksYDomain.yMin}
                        yMax={projectTasksYDomain.yMax}
                        timeframe={timeframe}
                        xAxisLabel={timeframe === "daily" ? "Date" : "Period"}
                        yAxisLabel="Tasks · per period"
                        mode="inline"
                        visibleSeriesIds={visibleProjectSeriesIds}
                        onToggleSeries={toggleProjectSeries}
                      />
                    </div>
                  </article>
                )}
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
                    <article key={chart.id} className="pa-card">
                      <div className="pa-card-top">
                        <div className="pa-card-head pa-card-head-row">
                          <div className="pa-card-head-text">
                            <h3 className="pa-card-title">{chart.title}</h3>
                            <p className="pa-card-desc">{chart.description}</p>
                          </div>
                          {points.length > 0 && (
                            <button
                              type="button"
                              className="pa-expand-chart-btn"
                              aria-label={`Open full screen for ${chart.title}. Same range and timeframe. Press Escape to close.`}
                              title={`Open full screen: ${chart.title}. Keeps your current range and timeframe. Press Esc or Exit to return.`}
                              onClick={() => openFullscreenChart(chart.id)}
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
                              <span className="pa-expand-text">Fullscreen</span>
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

                      <div className="pa-chart-panel">
                        {points.length === 0 ? (
                          <div className="muted small pa-no-data">No data for this timeframe.</div>
                        ) : (
                          (() => {
                            const vis = getSeriesVis(chart.id, Boolean(overlay));
                            return (
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
                            {overlay && (
                              <PaDualSeriesLegend
                                showRaw={vis.raw}
                                showAvg={vis.avg}
                                onToggleRaw={() => toggleSeries(chart.id, "raw", true)}
                                onToggleAvg={() => toggleSeries(chart.id, "avg", true)}
                              />
                            )}
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
                            showRaw={vis.raw}
                            showAvg={vis.avg}
                          />
                          </>
                            );
                          })()
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

    {fsAnyChart && (
      <div
        className="pa-fs-overlay pa-pro-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pa-fs-title"
        aria-describedby="pa-fs-desc"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeFullscreenChart();
        }}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const host = fsChromeRef.current;
          if (!host) return;
          const focusables = Array.from(
            host.querySelectorAll<HTMLElement>(
              'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
            )
          ).filter((el) => !el.hasAttribute("disabled") && !el.getAttribute("aria-hidden"));
          if (focusables.length === 0) return;
          const first = focusables[0]!;
          const last = focusables[focusables.length - 1]!;
          const active = document.activeElement as HTMLElement | null;
          if (e.shiftKey) {
            if (!active || active === first || !host.contains(active)) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (active === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div
          ref={fsChromeRef}
          className="pa-fs-chrome"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="pa-fs-header">
            <div className="pa-fs-header-main">
              <h2 id="pa-fs-title" className="pa-fs-title">
                {fsAnyChart.title}
              </h2>
              <p id="pa-fs-desc" className="pa-fs-desc">
                {fsAnyChart.description}
              </p>
            </div>
            <div className="pa-fs-actions">
              {!isBrowserFullscreen && (
                <button
                  type="button"
                  className="ghost-button small"
                  onClick={() => void requestBrowserFullscreen()}
                  title="Enter true browser full screen mode"
                >
                  Enter fullscreen
                </button>
              )}
              <button
                ref={fsCloseBtnRef}
                type="button"
                className="ghost-button small"
                onClick={closeFullscreenChart}
                title="Close this chart full screen view"
              >
                Close
              </button>
            </div>
          </header>

          <div className="pa-fs-range-bar">
            {rangeControlsEl}
            <p className="pa-fs-scroll-hint muted small">
              Scroll this chart horizontally if the timeline is wider than the screen.
            </p>
          </div>
          <div className="pa-fs-chart-host">
            <PaErrorBoundary
              title="Full screen view failed"
              onClose={closeFullscreenChart}
              onRecover={() => {
                // Simple recover: close + reopen same chart id.
                const id = fullscreenChartId;
                closeFullscreenChart();
                if (id) openFullscreenChart(id);
              }}
            >
              {fsIsProject ? projectTasksSeries.length === 0 ? (
                <div className="muted pa-no-data pa-no-data-fs" role="alert">
                  No project breakdown data is available for this range.
                </div>
              ) : (
                <>
                  <div className="pa-fs-pills">
                    <div className="pa-pill">
                      <span className="pa-pill-label">Latest</span>
                      <span className="pa-pill-value">{formatPillValue(fsProjectTotals.latest)}</span>
                    </div>
                    <div className="pa-pill pa-pill-muted">
                      <span className="pa-pill-label">Peak</span>
                      <span className="pa-pill-value">{formatPillValue(fsProjectTotals.peak)}</span>
                    </div>
                    <div className="pa-pill pa-pill-avg-muted" title="Number of visible project series">
                      <span className="pa-pill-label">Series</span>
                      <span className="pa-pill-value">{visibleProjectSeriesIds.size}</span>
                    </div>
                  </div>
                  <MultiLineChart
                    chartId="tasksCompletedByProject"
                    series={projectTasksSeries}
                    yMin={projectTasksYDomain.yMin}
                    yMax={projectTasksYDomain.yMax}
                    timeframe={timeframe}
                    xAxisLabel={timeframe === "daily" ? "Date" : "Period"}
                    yAxisLabel="Tasks · per period"
                    mode="fullscreen"
                    idSuffix="-fs"
                    visibleSeriesIds={visibleProjectSeriesIds}
                    onToggleSeries={toggleProjectSeries}
                  />
                </>
              ) : !fsChart ? (
                <div className="muted pa-no-data pa-no-data-fs" role="alert">
                  Full screen chart could not be shown (missing chart config). Close and try again.
                </div>
              ) : fsPoints.length === 0 ? (
                <div className="muted pa-no-data pa-no-data-fs">No data for this timeframe.</div>
              ) : (
                <>
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
                  {(() => {
                    const vis = getSeriesVis(fsChart.id, Boolean(fsOverlay));
                    return (
                      <>
                        {fsOverlay && (
                          <PaDualSeriesLegend
                            fullscreen
                            showRaw={vis.raw}
                            showAvg={vis.avg}
                            onToggleRaw={() => toggleSeries(fsChart.id, "raw", true)}
                            onToggleAvg={() => toggleSeries(fsChart.id, "avg", true)}
                          />
                        )}
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
                          showRaw={vis.raw}
                          showAvg={vis.avg}
                        />
                      </>
                    );
                  })()}
                </>
              )}
            </PaErrorBoundary>
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
                  Chart {fsChartIndex + 1} of {FS_ALL.length}
                </span>
                <span className="pa-fs-chart-nav-keys-hint muted small">
                  Keys <kbd className="pa-kbd">←</kbd> <kbd className="pa-kbd">→</kbd>
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
