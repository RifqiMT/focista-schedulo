import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import {
  exitBrowserFullscreenAll,
  getBrowserFullscreenElement,
  PST_TRUE_FULLSCREEN_CONTEXT_EVENT,
  requestHTMLElementFullscreen
} from "../fullscreenApi";
import {
  addProductivityAnalysisFullscreenListener,
  afterProductivityChartOverlayPaint,
  toastProductivityAnalysisFullscreenBusy
} from "../productivityAnalysisFullscreen";
import { apiUrl } from "../apiOrigin";

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
  activeProfileId: string | null;
  activeProfileName: string | null;
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
    title: "Completed tasks",
    description: "Tasks finished each period.",
    metricKey: "tasksCompleted",
    cumulative: false,
    yAxisLabel: "Tasks · per period"
  },
  {
    id: "tasksCompletedCumulative",
    title: "Total tasks",
    description: "Total completed so far.",
    metricKey: "tasksCompletedCumulative",
    cumulative: true,
    yAxisLabel: "Tasks · cumulative"
  },
  {
    id: "xpGained",
    title: "XP earned",
    description: "XP earned each period.",
    metricKey: "xpGained",
    cumulative: false,
    yAxisLabel: "XP · per period"
  },
  {
    id: "xpGainedCumulative",
    title: "Total XP",
    description: "Total XP so far.",
    metricKey: "xpGainedCumulative",
    cumulative: true,
    yAxisLabel: "XP · cumulative"
  },
  {
    id: "level",
    title: "Level",
    description: "Your level from total XP.",
    metricKey: "level",
    cumulative: true,
    yAxisLabel: "Level · cumulative"
  },
  {
    id: "badgesEarnedCumulative",
    title: "Badges",
    description: "Badges unlocked over time.",
    metricKey: "badgesEarnedCumulative",
    cumulative: true,
    yAxisLabel: "Badges · cumulative"
  }
];

type FsAnyChart =
  | { kind: "single"; id: string; title: string; description: string; yAxisLabel: string; chart: ChartConfig }
  | {
      kind: "project";
      id: "tasksCompletedByProject" | "xpGainedByProject";
      title: string;
      description: string;
      yAxisLabel: string;
    };

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
    title: "Tasks by project",
    description: "Completed tasks each period, split by project.",
    yAxisLabel: "Tasks · per period"
  },
  {
    kind: "project" as const,
    id: "xpGainedByProject",
    title: "XP by project",
    description: "XP earned each period, split by project.",
    yAxisLabel: "XP · per period"
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
  // IMPORTANT:
  // `dateIso` is a *calendar day* string (YYYY-MM-DD). We must bucket deterministically without
  // local-timezone drift (DST) or ambiguous parsing. Prefer ISO-string math and UTC-based dates.
  const m = dateIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const y = m ? Number(m[1]) : NaN;
  const mo = m ? Number(m[2]) : NaN; // 1..12
  const da = m ? Number(m[3]) : NaN; // 1..31

  switch (timeframe) {
    case "daily": {
      return { key: dateIso, label: dateIso };
    }
    case "weekly": {
      if (!m || !Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) {
        return { key: dateIso, label: dateIso };
      }
      // ISO week via UTC, to avoid timezone/DST shifts.
      const d = new Date(Date.UTC(y, mo - 1, da, 12, 0, 0, 0));
      // Move to Thursday in current ISO week.
      const weekdayMon0 = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
      d.setUTCDate(d.getUTCDate() - weekdayMon0 + 3);
      const weekYear = d.getUTCFullYear();
      // ISO week 1 is the week containing Jan 4 (Thursday-based year assignment).
      const jan4 = new Date(Date.UTC(weekYear, 0, 4, 12, 0, 0, 0));
      const jan4WeekdayMon0 = (jan4.getUTCDay() + 6) % 7;
      jan4.setUTCDate(jan4.getUTCDate() - jan4WeekdayMon0 + 3);
      const diffWeeks = Math.round(
        (d.getTime() - jan4.getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      const week = 1 + diffWeeks;
      const key = `${weekYear}-W${String(Math.max(1, week)).padStart(2, "0")}`;
      return { key, label: key };
    }
    case "monthly": {
      if (!m || !Number.isFinite(y) || !Number.isFinite(mo)) return { key: dateIso, label: dateIso };
      const key = `${String(y)}-${String(mo).padStart(2, "0")}`;
      return { key, label: key };
    }
    case "quarterly": {
      if (!m || !Number.isFinite(y) || !Number.isFinite(mo)) return { key: dateIso, label: dateIso };
      const q = Math.floor((mo - 1) / 3) + 1;
      const key = `${String(y)}-Q${q}`;
      return { key, label: key };
    }
    case "annually": {
      if (!m || !Number.isFinite(y)) return { key: dateIso, label: dateIso };
      const key = String(y);
      return { key, label: key };
    }
  }
}

function parseIsoYmd(dateIso: string): { y: number; m: number; d: number } | null {
  const m = dateIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, m: mo, d };
}

function isoFromUtcDate(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addUtcDays(dt: Date, days: number): Date {
  const x = new Date(dt.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function bucketKeysInRange(startIso: string, endIso: string, timeframe: Timeframe): string[] {
  // Deterministic bucket timeline for a shown window.
  // This avoids accidental missing/merged buckets and keeps project series perfectly aligned.
  if (startIso > endIso) return [];
  if (timeframe === "daily") {
    const ps = parseIsoYmd(startIso);
    const pe = parseIsoYmd(endIso);
    if (!ps || !pe) return [];
    let cur = new Date(Date.UTC(ps.y, ps.m - 1, ps.d, 12, 0, 0, 0));
    const end = new Date(Date.UTC(pe.y, pe.m - 1, pe.d, 12, 0, 0, 0));
    const out: string[] = [];
    while (cur.getTime() <= end.getTime() && out.length < 5000) {
      out.push(isoFromUtcDate(cur));
      cur = addUtcDays(cur, 1);
    }
    return out;
  }

  if (timeframe === "weekly") {
    const ps = parseIsoYmd(startIso);
    const pe = parseIsoYmd(endIso);
    if (!ps || !pe) return [];
    let cur = new Date(Date.UTC(ps.y, ps.m - 1, ps.d, 12, 0, 0, 0));
    const end = new Date(Date.UTC(pe.y, pe.m - 1, pe.d, 12, 0, 0, 0));
    // Move to Monday of the current ISO week (UTC).
    const weekdayMon0 = (cur.getUTCDay() + 6) % 7;
    cur = addUtcDays(cur, -weekdayMon0);
    const out: string[] = [];
    while (cur.getTime() <= end.getTime() && out.length < 2000) {
      out.push(bucketKeyFor(isoFromUtcDate(cur), "weekly").key);
      cur = addUtcDays(cur, 7);
    }
    return out;
  }

  if (timeframe === "monthly") {
    const ps = parseIsoYmd(startIso);
    const pe = parseIsoYmd(endIso);
    if (!ps || !pe) return [];
    let y = ps.y;
    let m = ps.m;
    const endY = pe.y;
    const endM = pe.m;
    const out: string[] = [];
    while ((y < endY || (y === endY && m <= endM)) && out.length < 2000) {
      out.push(`${String(y)}-${String(m).padStart(2, "0")}`);
      m += 1;
      if (m === 13) {
        m = 1;
        y += 1;
      }
    }
    return out;
  }

  if (timeframe === "quarterly") {
    const ps = parseIsoYmd(startIso);
    const pe = parseIsoYmd(endIso);
    if (!ps || !pe) return [];
    let y = ps.y;
    let q = Math.floor((ps.m - 1) / 3) + 1;
    const endY = pe.y;
    const endQ = Math.floor((pe.m - 1) / 3) + 1;
    const out: string[] = [];
    while ((y < endY || (y === endY && q <= endQ)) && out.length < 2000) {
      out.push(`${String(y)}-Q${q}`);
      q += 1;
      if (q === 5) {
        q = 1;
        y += 1;
      }
    }
    return out;
  }

  // annually
  const ps = parseIsoYmd(startIso);
  const pe = parseIsoYmd(endIso);
  if (!ps || !pe) return [];
  const out: string[] = [];
  for (let y = ps.y; y <= pe.y && out.length < 1000; y += 1) out.push(String(y));
  return out;
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
        return `${dayName} - ${dayPart}`;
      }
    }
  }

  return raw;
}

/** Tooltip-friendly period labels (always include year when derivable). */
function formatAxisLabelWithYear(timeframe: Timeframe, raw: string): string {
  if (timeframe === "annually") return raw;

  if (timeframe === "quarterly") {
    const m = raw.match(/^(\d{4})-Q(\d)$/);
    if (m) return `Q${Number(m[2])} ${m[1]}`;
  }

  if (timeframe === "monthly") {
    const m = raw.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      const d0 = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1, 12, 0, 0, 0));
      if (!Number.isNaN(d0.getTime())) {
        const month = d0.toLocaleDateString(undefined, { month: "short" });
        return `${month} ${m[1]}`;
      }
    }
  }

  if (timeframe === "weekly") {
    const m = raw.match(/^(\d{4})-W(\d{2})$/);
    if (m) return `W${Number(m[2])} ${m[1]}`;
  }

  if (timeframe === "daily") {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const d0 = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0));
      if (!Number.isNaN(d0.getTime())) {
        const dayName = d0.toLocaleDateString(undefined, { weekday: "short" });
        const dayPart = d0.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
        return `${dayName} - ${dayPart}`;
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

function peakPoint(points: Point[]): { value: number; rawLabel: string } | null {
  if (points.length === 0) return null;
  let best = points[0];
  for (const p of points) if (p.value > best.value) best = p;
  return { value: best.value, rawLabel: best.rawLabel };
}

/** Display for pill stats; averages may be fractional. */
function formatPillValue(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const r = Math.round(v * 100) / 100;
  if (Math.abs(r - Math.round(r)) < 1e-6) return Math.round(r).toLocaleString();
  return r.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Raster scale: output pixels = viewBox user units × scale (uniform).
 * Was 16 (~1.9k px wide); 160 is 10× linear (= 100× pixels) for print / high-DPI slides.
 * SVG root width/height are set to the final pixel size before decode so the bitmap is not tiny-then-upscaled.
 */
const PA_PNG_EXPORT_SCALE = 160;

const PA_EXPORT_PAD_X = 9;
const PA_EXPORT_HEADER_Y0 = 1.8;
const PA_EXPORT_TITLE_FS = 3.45;
const PA_EXPORT_CAPTION_FS = 2.05;
const PA_EXPORT_AXIS_NOTE_FS = 1.8;
const PA_EXPORT_CHART_Y0 = 12.8;
/** Vertical space below plot bottom for rotated date labels + “Date” caption + legend gap. */
const PA_EXPORT_X_TICK_PIVOT_Y = 1.05;
const PA_EXPORT_X_TICK_FONT = 1.56;
const PA_EXPORT_X_LABEL_INSET = 5.25;
const PA_EXPORT_X_ROT_DEG = -38;
const PA_EXPORT_X_AXIS_DEPTH = 15.2;
const PA_EXPORT_X_LEGEND_GAP = 3.35;
const PA_EXPORT_BOTTOM_PAD = 3.6;
const PA_EXPORT_COLOR_PRIMARY = "rgb(206, 17, 38)";
const PA_EXPORT_COLOR_OVERLAY = "rgb(180, 83, 9)";

type PaChartSvgRegistry = Map<string, SVGSVGElement>;

function escapeCsvCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function downloadBlobFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadCsvRows(filename: string, rows: string[][]) {
  const text = rows.map((row) => row.map((c) => escapeCsvCell(String(c))).join(",")).join("\n");
  downloadBlobFile(filename, new Blob(["\ufeff", text], { type: "text/csv;charset=utf-8" }));
}

function productivityExportFilenameStem(chartKey: string, timeframe: Timeframe): string {
  const tf = timeframe;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safe = chartKey.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "chart";
  return `productivity-${safe}-${tf}-${stamp}`;
}

function buildSingleMetricTableCsvRows(
  timeframe: Timeframe,
  points: Point[],
  overlay: Point[] | null,
  showAvg: boolean,
  valueHeader: string
): string[][] {
  const hasAvg =
    Boolean(overlay && overlay.length === points.length && showAvg && points.length > 0);
  const header = ["Period", valueHeader];
  if (hasAvg) header.push("Rolling avg");
  const rows: string[][] = [header];
  for (let i = 0; i < points.length; i++) {
    const row = [
      formatAxisLabelWithYear(timeframe, points[i]!.rawLabel),
      formatPillValue(points[i]!.value)
    ];
    if (hasAvg) row.push(formatPillValue(overlay![i]!.value));
    rows.push(row);
  }
  return rows;
}

function buildProjectSeriesTableCsvRows(
  timeframe: Timeframe,
  seriesList: MultiSeries[],
  visibleIds: Set<string>
): string[][] {
  const visible = seriesList.filter((s) => visibleIds.has(s.id));
  if (visible.length === 0) return [["Message"], ["No visible series — enable projects in the legend."]];
  const n = visible[0]!.points.length;
  const header = ["Period", ...visible.map((s) => s.name)];
  const rows: string[][] = [header];
  for (let i = 0; i < n; i++) {
    const row = [formatAxisLabelWithYear(timeframe, visible[0]!.points[i]!.rawLabel)];
    for (const s of visible) row.push(formatPillValue(s.points[i]?.value ?? 0));
    rows.push(row);
  }
  return rows;
}

function formatYTickForExport(v: number, integerYAxis: boolean): string {
  if (!Number.isFinite(v)) return "—";
  if (integerYAxis) return Math.round(v).toLocaleString();
  const rounded = Math.round(v);
  if (Math.abs(v - rounded) < 1e-6 || Math.abs(v) >= 100) {
    return rounded.toLocaleString();
  }
  return (+v.toFixed(2)).toLocaleString();
}

/** Map computed CSS strokes (px) to thin user-space widths so high-DPI PNG stays sharp, not blocky. */
function normalizePaExportSvgForRasterization(svgRoot: SVGSVGElement) {
  svgRoot.setAttribute("shape-rendering", "geometricPrecision");
  svgRoot.setAttribute("text-rendering", "optimizeLegibility");
  const walk = (el: Element) => {
    if (el instanceof SVGElement) {
      el.removeAttribute("vector-effect");
      el.removeAttribute("filter");
    }
    const tag = el.tagName.toLowerCase();
    if (el instanceof SVGGraphicsElement) {
      const cls = el.getAttribute("class") ?? "";
      if (tag === "line" && cls.includes("pa-chart-grid")) {
        el.setAttribute("stroke-width", "0.07");
      } else if (tag === "path") {
        if (cls.includes("pa-chart-grid")) {
          el.setAttribute("stroke-width", "0.07");
        } else if (cls.includes("pa-chart-line-overlay")) {
          el.setAttribute("stroke-width", "0.38");
        } else if (cls.includes("pa-chart-line")) {
          el.setAttribute("stroke-width", "0.34");
        } else if (
          el.getAttribute("fill") === "none" &&
          el.getAttribute("stroke") &&
          el.getAttribute("stroke") !== "none"
        ) {
          el.setAttribute("stroke-width", "0.36");
        }
      }
    }
    for (const c of el.children) walk(c);
  };
  walk(svgRoot);
}

/** Compact axis strings so rotated X labels do not collide (export only). */
function formatAxisLabelForExport(timeframe: Timeframe, raw: string): string {
  if (timeframe === "daily") {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const d0 = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!Number.isNaN(d0.getTime())) {
        return d0.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      }
    }
  }
  if (timeframe === "weekly") {
    const m = raw.match(/^(\d{4})-W(\d{2})$/);
    if (m) return `W${Number(m[2])} ’${m[1].slice(2)}`;
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
  if (timeframe === "quarterly") {
    const m = raw.match(/^(\d{4})-Q(\d)$/);
    if (m) return `Q${Number(m[2])} ’${m[1].slice(2)}`;
  }
  return formatAxisLabel(timeframe, raw);
}

/** Fewer X ticks on export than on screen — rotated labels need horizontal clearance. */
function paExportXTickIndices(pointsLength: number, chartLayoutMode: InsightChartMode): number[] {
  if (pointsLength <= 0) return [];
  const maxTicks = chartLayoutMode === "fullscreen" ? 7 : 5;
  return xTickIndices(pointsLength, maxTicks);
}

function normalizePaExportLineDasharrays(svgRoot: SVGSVGElement) {
  svgRoot.querySelectorAll("path").forEach((p) => {
    const dash = p.getAttribute("stroke-dasharray");
    if (!dash || dash === "none") return;
    const cls = p.getAttribute("class") ?? "";
    if (!cls.includes("pa-chart-line")) return;
    p.setAttribute("stroke-dasharray", "1.12 1.22");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
  });
}

function softenPaExportAreaGradientToTransparent(svgRoot: SVGSVGElement) {
  svgRoot.querySelectorAll("linearGradient stop").forEach((stop) => {
    const c = (stop.getAttribute("stop-color") ?? "").replace(/\s/g, "").toLowerCase();
    if (c === "rgb(255,255,255)" || c === "#ffffff" || c === "#fff") {
      stop.setAttribute("stop-opacity", "0");
    }
  });
}

function inlineSvgComputedRasterStyles(sourceRoot: SVGElement, destRoot: SVGElement) {
  const skip = new Set([
    "defs",
    "clippath",
    "lineargradient",
    "radialgradient",
    "stop",
    "mask",
    "filter"
  ]);
  const walk = (src: Element, dest: Element) => {
    const tag = src.tagName.toLowerCase();
    if (
      !skip.has(tag) &&
      src instanceof SVGGraphicsElement &&
      dest instanceof SVGGraphicsElement
    ) {
      const cs = getComputedStyle(src);
      if (tag === "path" || tag === "line") {
        const strokeAttr = src.getAttribute("stroke");
        const fillAttr = src.getAttribute("fill");
        if (!strokeAttr || strokeAttr === "currentColor") {
          const st = cs.stroke;
          if (st && st !== "none") dest.setAttribute("stroke", st);
        }
        if (cs.strokeWidth && cs.strokeWidth !== "0px") {
          dest.setAttribute("stroke-width", cs.strokeWidth);
        }
        if (cs.strokeLinecap) dest.setAttribute("stroke-linecap", cs.strokeLinecap);
        if (cs.strokeLinejoin) dest.setAttribute("stroke-linejoin", cs.strokeLinejoin);
        const dash = cs.strokeDasharray;
        if (dash && dash !== "none") dest.setAttribute("stroke-dasharray", dash);
        if (tag === "path") {
          if (fillAttr && fillAttr.startsWith("url(")) {
            /* keep gradient fill */
          } else if (!fillAttr || fillAttr === "none") {
            /* no fill */
          } else {
            const f = cs.fill;
            if (f && f !== "none") dest.setAttribute("fill", f);
          }
        }
      }
      const op = cs.opacity;
      if (op && op !== "1") dest.setAttribute("opacity", op);
    }
    const sc = src.children;
    const dc = dest.children;
    const len = Math.min(sc.length, dc.length);
    for (let i = 0; i < len; i++) walk(sc[i]!, dc[i]!);
  };
  walk(sourceRoot, destRoot);
}

type PaChartPngExportMeta = {
  points: Point[];
  timeframe: Timeframe;
  yMin: number;
  yMax: number;
  chartLayoutMode: InsightChartMode;
  chartTitle: string;
  caption: string;
  xAxisLabel: string;
  yAxisLabel: string;
  /** Whole-number Y ticks (tasks / discrete counts) for clearer export labels. */
  integerYAxis?: boolean;
  legend:
    | {
        kind: "single";
        showRaw: boolean;
        showAvg: boolean;
        hasOverlay: boolean;
        cumulative: boolean;
        primaryLabel: string;
      }
    | { kind: "multi"; entries: { name: string; color: string }[] };
};

function paExportPreferIntegerYAxis(chartId: string): boolean {
  return (
    chartId !== "xpGained" &&
    chartId !== "xpGainedCumulative" &&
    chartId !== "xpGainedByProject"
  );
}

function buildPaExportCaption(timeframe: Timeframe, points: Point[]): string {
  if (points.length === 0) return formatTimeframeLabel(timeframe);
  const a = formatAxisLabel(timeframe, points[0]!.rawLabel);
  const b = formatAxisLabel(timeframe, points[points.length - 1]!.rawLabel);
  return `${formatTimeframeLabel(timeframe)} · ${a} — ${b} · ${points.length} ${points.length === 1 ? "point" : "points"}`;
}

function paExportContentWidth(): number {
  return VB_W + PA_EXPORT_PAD_X * 2;
}

function paExportLegendBlockHeight(legend: PaChartPngExportMeta["legend"]): number {
  if (legend.kind === "single") {
    const hasLine =
      legend.showRaw || (legend.hasOverlay && legend.showAvg);
    if (!hasLine) return 2;
    return 5.8;
  }
  const n = legend.entries.length;
  if (n === 0) return 3.8;
  const rows = Math.ceil(n / 2);
  return 2.8 + rows * 3.65 + 0.6;
}

function wrapSvgChildrenInTranslatedGroup(svg: SVGSVGElement, tx: number, ty: number): SVGGElement {
  const ns = "http://www.w3.org/2000/svg";
  const g = document.createElementNS(ns, "g");
  g.setAttribute("transform", `translate(${tx},${ty})`);
  while (svg.firstChild) g.appendChild(svg.firstChild);
  svg.appendChild(g);
  return g;
}

/** Y-axis tick value labels in chart coordinate space (inside translated group). */
function appendPaChartExportAxisValueLabels(
  parent: SVGElement,
  meta: Pick<PaChartPngExportMeta, "yMin" | "yMax" | "integerYAxis">
) {
  const ns = "http://www.w3.org/2000/svg";
  const yTicks = 4;
  const ySpan = meta.yMax - meta.yMin;
  const intY = Boolean(meta.integerYAxis);
  for (let i = 0; i <= yTicks; i++) {
    /* Match on-screen Y-rail: i=0 is bottom of plot → yMin; top → yMax. */
    const value = meta.yMin + (i / yTicks) * ySpan;
    const y = BASE_Y - ((BASE_Y - PAD_T) * i) / yTicks;
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", "0.35");
    text.setAttribute("y", String(y + 1.1));
    text.setAttribute("font-size", "2.05");
    text.setAttribute("font-family", "system-ui, -apple-system, Segoe UI, sans-serif");
    text.setAttribute("fill", "#64748b");
    text.textContent = formatYTickForExport(value, intY);
    parent.appendChild(text);
  }
}

/**
 * X-axis: compact labels, rotated, inset from edges — avoids overlap with each other and with the
 * axis title placed below this band.
 */
function appendPaExportXAxisLayer(svg: SVGSVGElement, meta: PaChartPngExportMeta, vbW: number) {
  const ns = "http://www.w3.org/2000/svg";
  const n = meta.points.length;
  if (n === 0) return;
  const tickIndices = paExportXTickIndices(n, meta.chartLayoutMode);
  const plotLeft = PA_EXPORT_PAD_X + PA_EXPORT_X_LABEL_INSET;
  const plotRight = PA_EXPORT_PAD_X + VB_W - PA_EXPORT_X_LABEL_INSET;
  const spanX = Math.max(1e-9, plotRight - plotLeft);
  const pivotY = PA_EXPORT_CHART_Y0 + VB_H + PA_EXPORT_X_TICK_PIVOT_Y;

  for (let tpos = 0; tpos < tickIndices.length; tpos++) {
    const i = tickIndices[tpos]!;
    const t = n <= 1 ? 0.5 : i / (n - 1);
    const tickX = plotLeft + t * spanX;
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", String(tickX));
    label.setAttribute("y", String(pivotY));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("font-size", String(PA_EXPORT_X_TICK_FONT));
    label.setAttribute("font-family", "system-ui, -apple-system, Segoe UI, sans-serif");
    label.setAttribute("fill", "#64748b");
    label.setAttribute("transform", `rotate(${PA_EXPORT_X_ROT_DEG} ${tickX} ${pivotY})`);
    label.textContent = formatAxisLabelForExport(meta.timeframe, meta.points[i]!.rawLabel);
    svg.appendChild(label);
  }

  const cx = vbW / 2;
  const xTitleY = PA_EXPORT_CHART_Y0 + VB_H + PA_EXPORT_X_AXIS_DEPTH;
  const xLab = document.createElementNS(ns, "text");
  xLab.setAttribute("x", String(cx));
  xLab.setAttribute("y", String(xTitleY));
  xLab.setAttribute("text-anchor", "middle");
  xLab.setAttribute("font-size", String(PA_EXPORT_AXIS_NOTE_FS));
  xLab.setAttribute("font-weight", "650");
  xLab.setAttribute("font-family", "system-ui, -apple-system, Segoe UI, sans-serif");
  xLab.setAttribute("fill", "#64748b");
  xLab.textContent = meta.xAxisLabel;
  svg.appendChild(xLab);
}

function appendPaExportHeaderAndFootNotes(svg: SVGSVGElement, meta: PaChartPngExportMeta, vbW: number) {
  const ns = "http://www.w3.org/2000/svg";
  const cx = vbW / 2;
  const title = document.createElementNS(ns, "text");
  title.setAttribute("x", String(cx));
  title.setAttribute("y", String(PA_EXPORT_HEADER_Y0 + 3.1));
  title.setAttribute("text-anchor", "middle");
  title.setAttribute("font-size", String(PA_EXPORT_TITLE_FS));
  title.setAttribute("font-weight", "700");
  title.setAttribute("font-family", "system-ui, -apple-system, Segoe UI, sans-serif");
  title.setAttribute("fill", "#0f172a");
  title.textContent = meta.chartTitle;
  svg.appendChild(title);

  const cap = document.createElementNS(ns, "text");
  cap.setAttribute("x", String(cx));
  cap.setAttribute("y", String(PA_EXPORT_HEADER_Y0 + 7));
  cap.setAttribute("text-anchor", "middle");
  cap.setAttribute("font-size", String(PA_EXPORT_CAPTION_FS));
  cap.setAttribute("font-family", "system-ui, -apple-system, Segoe UI, sans-serif");
  cap.setAttribute("fill", "#475569");
  cap.textContent = meta.caption;
  svg.appendChild(cap);

  const yLab = document.createElementNS(ns, "text");
  yLab.setAttribute("x", String(PA_EXPORT_PAD_X));
  yLab.setAttribute("y", String(PA_EXPORT_CHART_Y0 - 0.85));
  yLab.setAttribute("font-size", String(PA_EXPORT_AXIS_NOTE_FS));
  yLab.setAttribute("font-family", "system-ui, -apple-system, Segoe UI, sans-serif");
  yLab.setAttribute("fill", "#64748b");
  yLab.textContent = meta.yAxisLabel;
  svg.appendChild(yLab);
}

function appendPaExportLegendSvg(svg: SVGSVGElement, meta: PaChartPngExportMeta, legendTopY: number, vbW: number) {
  const ns = "http://www.w3.org/2000/svg";
  const leg = meta.legend;
  if (leg.kind === "single") {
    const hasAny = leg.showRaw || (leg.hasOverlay && leg.showAvg);
    if (!hasAny) return;
    let x = PA_EXPORT_PAD_X;
    const yMid = legendTopY + 2.8;
    if (leg.showRaw) {
      if (leg.cumulative) {
        const area = document.createElementNS(ns, "rect");
        area.setAttribute("x", String(x));
        area.setAttribute("y", String(yMid - 2.1));
        area.setAttribute("width", "8");
        area.setAttribute("height", "3.2");
        area.setAttribute("rx", "0.5");
        area.setAttribute("fill", "rgba(206, 17, 38, 0.2)");
        area.setAttribute("stroke", PA_EXPORT_COLOR_PRIMARY);
        area.setAttribute("stroke-width", "0.35");
        svg.appendChild(area);
      }
      const ln = document.createElementNS(ns, "line");
      ln.setAttribute("x1", String(x));
      ln.setAttribute("y1", String(yMid));
      ln.setAttribute("x2", String(x + (leg.cumulative ? 8 : 7)));
      ln.setAttribute("y2", String(yMid));
      ln.setAttribute("stroke", PA_EXPORT_COLOR_PRIMARY);
      ln.setAttribute("stroke-width", "0.42");
      ln.setAttribute("stroke-linecap", "round");
      if (leg.hasOverlay) ln.setAttribute("stroke-dasharray", "1.12 1.22");
      svg.appendChild(ln);
      const tx = document.createElementNS(ns, "text");
      tx.setAttribute("x", String(x + (leg.cumulative ? 10 : 9)));
      tx.setAttribute("y", String(yMid + 1));
      tx.setAttribute("font-size", "2.05");
      tx.setAttribute("font-family", "system-ui, -apple-system, Segoe UI, sans-serif");
      tx.setAttribute("fill", "#1e293b");
      tx.textContent = leg.primaryLabel;
      svg.appendChild(tx);
      x += 52;
    }
    if (leg.hasOverlay && leg.showAvg) {
      const ln = document.createElementNS(ns, "line");
      ln.setAttribute("x1", String(x));
      ln.setAttribute("y1", String(yMid));
      ln.setAttribute("x2", String(x + 7));
      ln.setAttribute("y2", String(yMid));
      ln.setAttribute("stroke", PA_EXPORT_COLOR_OVERLAY);
      ln.setAttribute("stroke-width", "0.45");
      ln.setAttribute("stroke-linecap", "round");
      svg.appendChild(ln);
      const tx = document.createElementNS(ns, "text");
      tx.setAttribute("x", String(x + 9));
      tx.setAttribute("y", String(yMid + 1));
      tx.setAttribute("font-size", "2.05");
      tx.setAttribute("font-family", "system-ui, -apple-system, Segoe UI, sans-serif");
      tx.setAttribute("fill", "#1e293b");
      tx.textContent = "Rolling average";
      svg.appendChild(tx);
    }
    return;
  }

  const heading = document.createElementNS(ns, "text");
  heading.setAttribute("x", String(PA_EXPORT_PAD_X));
  heading.setAttribute("y", String(legendTopY + 2));
  heading.setAttribute("font-size", "1.95");
  heading.setAttribute("font-weight", "650");
  heading.setAttribute("font-family", "system-ui, -apple-system, Segoe UI, sans-serif");
  heading.setAttribute("fill", "#475569");
  heading.textContent = "Legend — visible projects";
  svg.appendChild(heading);

  const colW = (vbW - PA_EXPORT_PAD_X * 2) / 2;
  leg.entries.forEach((ent, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const lx = PA_EXPORT_PAD_X + col * colW;
    const ly = legendTopY + 4.2 + row * 3.65;
    const dot = document.createElementNS(ns, "rect");
    dot.setAttribute("x", String(lx));
    dot.setAttribute("y", String(ly - 1.6));
    dot.setAttribute("width", "3.1");
    dot.setAttribute("height", "3.1");
    dot.setAttribute("rx", "0.65");
    dot.setAttribute("fill", ent.color);
    svg.appendChild(dot);
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", String(lx + 4.8));
    label.setAttribute("y", String(ly + 0.95));
    label.setAttribute("font-size", "1.95");
    label.setAttribute("font-family", "system-ui, -apple-system, Segoe UI, sans-serif");
    label.setAttribute("fill", "#1e293b");
    const nm = ent.name.length > 30 ? `${ent.name.slice(0, 28)}…` : ent.name;
    label.textContent = nm;
    svg.appendChild(label);
  });
}

async function rasterizePaSvgToPngBlob(svg: SVGSVGElement, scale: number): Promise<Blob> {
  if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const vb = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number) ?? [];
  const vw = vb.length === 4 && vb.every((n) => Number.isFinite(n)) ? vb[2]! : VB_W;
  const vh = vb.length === 4 && vb.every((n) => Number.isFinite(n)) ? vb[3]! : VB_H;
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));
  /* Request full-size rasterization when the SVG is decoded (avoids blurry upscale from a small intermediate bitmap). */
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));

  const xml = new XMLSerializer().serializeToString(svg);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;

  const img = new Image();
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
  if (!loaded) throw new Error("Could not rasterize chart SVG.");

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Canvas not available.");
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);

  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG encoding failed."))),
      "image/png",
      1
    );
  });
}

async function exportPaChartPngFromRegistry(
  registry: PaChartSvgRegistry,
  registryKey: string,
  meta: PaChartPngExportMeta
) {
  const source = registry.get(registryKey);
  if (!source) throw new Error("Chart graphic is not available — try chart view or wait for data to load.");

  const clone = source.cloneNode(true) as SVGSVGElement;
  inlineSvgComputedRasterStyles(source, clone);
  normalizePaExportLineDasharrays(clone);
  softenPaExportAreaGradientToTransparent(clone);
  normalizePaExportSvgForRasterization(clone);

  const chartGroup = wrapSvgChildrenInTranslatedGroup(clone, PA_EXPORT_PAD_X, PA_EXPORT_CHART_Y0);
  appendPaChartExportAxisValueLabels(chartGroup, meta);

  const vbW = paExportContentWidth();
  const legendTopY =
    PA_EXPORT_CHART_Y0 + VB_H + PA_EXPORT_X_AXIS_DEPTH + PA_EXPORT_X_LEGEND_GAP;
  appendPaExportHeaderAndFootNotes(clone, meta, vbW);
  appendPaExportXAxisLayer(clone, meta, vbW);
  appendPaExportLegendSvg(clone, meta, legendTopY, vbW);

  const totalH = legendTopY + paExportLegendBlockHeight(meta.legend) + PA_EXPORT_BOTTOM_PAD;
  clone.setAttribute("viewBox", `0 0 ${vbW} ${totalH}`);
  clone.setAttribute("width", String(vbW));
  clone.setAttribute("height", String(totalH));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  return rasterizePaSvgToPngBlob(clone, PA_PNG_EXPORT_SCALE);
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

function minPoint(points: Point[]): { value: number; rawLabel: string } | null {
  if (points.length === 0) return null;
  let best = points[0];
  for (const p of points) if (p.value < best.value) best = p;
  return { value: best.value, rawLabel: best.rawLabel };
}

function projectSeriesTotals(
  series: MultiSeries[],
  visibleIds: Set<string>
): {
  latest: number;
  latestLabel: string;
  previous: number | null;
  previousLabel: string | null;
  peak: number;
  peakLabel: string;
} | null {
  if (series.length === 0) return null;
  const len = series[0]?.points.length ?? 0;
  if (len === 0) {
    return { latest: 0, latestLabel: "", previous: null, previousLabel: null, peak: 0, peakLabel: "" };
  }
  if (visibleIds.size === 0) return null;
  let peak = 0;
  let peakIdx = 0;
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (const s of series) {
      if (!visibleIds.has(s.id)) continue;
      sum += s.points[i]?.value ?? 0;
    }
    if (sum >= peak) {
      peak = sum;
      peakIdx = i;
    }
  }
  let latest = 0;
  const i = len - 1;
  for (const s of series) {
    if (!visibleIds.has(s.id)) continue;
    latest += s.points[i]?.value ?? 0;
  }
  const latestLabel = series[0]?.points[i]?.rawLabel ?? "";
  let previous: number | null = null;
  let previousLabel: string | null = null;
  if (len >= 2) {
    const j = len - 2;
    let prevSum = 0;
    for (const s of series) {
      if (!visibleIds.has(s.id)) continue;
      prevSum += s.points[j]?.value ?? 0;
    }
    previous = prevSum;
    previousLabel = series[0]?.points[j]?.rawLabel ?? null;
  }
  const peakLabel = series[0]?.points[peakIdx]?.rawLabel ?? "";
  return { latest, latestLabel, previous, previousLabel, peak, peakLabel };
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
  showAvg = true,
  onRegisterSvg,
  exportSvgKey,
  fullscreenTooltipMount
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
  onRegisterSvg?: (key: string, el: SVGSVGElement | null) => void;
  /** Defaults to `${chartId}${idSuffix}` when omitted; use for stable keys across duplicate mounts. */
  exportSvgKey?: string;
  /** In-productivity fullscreen: portal target so hover tooltips stay visible under element fullscreen. */
  fullscreenTooltipMount?: HTMLElement | null;
}) {
  const [hover, setHover] = useState<{ idx: number; px: number; py: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [chartContainerW, setChartContainerW] = useState(0);
  const gradId = `pa-fill-${chartId}${idSuffix}`;
  const clipId = `pa-clip-${chartId}${idSuffix}`;
  const resolvedExportKey = exportSvgKey ?? `${chartId}${idSuffix}`;
  const overlayLen = overlayPoints?.length ?? 0;

  useLayoutEffect(() => {
    if (!onRegisterSvg) return;
    onRegisterSvg(resolvedExportKey, svgRef.current);
    return () => onRegisterSvg(resolvedExportKey, null);
  }, [
    onRegisterSvg,
    resolvedExportKey,
    points.length,
    showRaw,
    showAvg,
    showArea,
    overlayLen
  ]);

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

  const tooltipPortalParent: HTMLElement | null =
    mode === "fullscreen"
      ? fullscreenTooltipMount ?? null
      : typeof document !== "undefined"
        ? document.body
        : null;

  const tooltipPortal =
    hover !== null &&
    points[hover.idx] &&
    tooltipPortalParent
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
          tooltipPortalParent
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
  onToggleSeries,
  onRegisterSvg,
  exportSvgKey,
  fullscreenTooltipMount
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
  onRegisterSvg?: (key: string, el: SVGSVGElement | null) => void;
  exportSvgKey?: string;
  fullscreenTooltipMount?: HTMLElement | null;
}) {
  const pointsLen = series[0]?.points.length ?? 0;
  const [hover, setHover] = useState<{ idx: number; px: number; py: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [chartContainerW, setChartContainerW] = useState(0);
  const clipId = `pa-clip-${chartId}${idSuffix}`;
  const resolvedExportKey = exportSvgKey ?? `${chartId}${idSuffix}`;
  const visibilitySig = useMemo(() => [...visibleSeriesIds].sort().join(","), [visibleSeriesIds]);

  useLayoutEffect(() => {
    if (!onRegisterSvg) return;
    onRegisterSvg(resolvedExportKey, svgRef.current);
    return () => onRegisterSvg(resolvedExportKey, null);
  }, [onRegisterSvg, resolvedExportKey, pointsLen, visibilitySig]);

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

  const tooltipPortalParent: HTMLElement | null =
    mode === "fullscreen"
      ? fullscreenTooltipMount ?? null
      : typeof document !== "undefined"
        ? document.body
        : null;

  const tooltipPortal =
    hover !== null && hasVisibleData && tooltipPortalParent
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
          tooltipPortalParent
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
            const isSolo = on && visibleSeriesIds.size === 1;
            return (
              <button
                key={s.id}
                type="button"
                className={`pa-legend-chip pa-legend-chip--project ${on ? "is-on" : "is-off"}`}
                aria-pressed={on}
                onClick={(e) => {
                  // Shift-click = Solo (zoom): show only this project, auto-rescales y-axis.
                  // Shift-click again when solo = restore all.
                  if ((e as any).shiftKey) {
                    e.preventDefault();
                    if (isSolo) {
                      for (const other of series) {
                        if (!visibleSeriesIds.has(other.id)) onToggleSeries(other.id);
                      }
                      return;
                    }
                    if (!on) onToggleSeries(s.id);
                    for (const other of series) {
                      if (other.id !== s.id && visibleSeriesIds.has(other.id)) {
                        onToggleSeries(other.id);
                      }
                    }
                    return;
                  }
                  onToggleSeries(s.id);
                }}
                title={
                  on
                    ? `Hide ${s.name}. Shift-click to Solo.`
                    : `Show ${s.name}. Shift-click to Solo.`
                }
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

type PaViewMode = "chart" | "table";

function PaViewChartGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 18V6M4 14l3.5-3.5 3.5 4 3.5-9 3.5 3"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M3 19h18"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function PaViewTableGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5h16v13H4v-13Z"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M4 10h16M12 5.5v13"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function ProductivityViewToggle({
  mode,
  onChange,
  compact
}: {
  mode: PaViewMode;
  onChange: (m: PaViewMode) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`pa-view-toggle${compact ? " pa-view-toggle--compact" : ""}`}
      role="group"
      aria-label="Switch between chart and table"
    >
      <button
        type="button"
        className={`pa-view-toggle-btn${mode === "chart" ? " is-active" : ""}`}
        aria-pressed={mode === "chart"}
        aria-label="Chart view"
        title="Chart view: trend line for this metric (best for spotting patterns)."
        onClick={() => onChange("chart")}
      >
        <PaViewChartGlyph />
      </button>
      <button
        type="button"
        className={`pa-view-toggle-btn${mode === "table" ? " is-active" : ""}`}
        aria-pressed={mode === "table"}
        aria-label="Table view"
        title="Table view: exact values by period (best for precise numbers and scanning rows)."
        onClick={() => onChange("table")}
      >
        <PaViewTableGlyph />
      </button>
    </div>
  );
}

function PaExportCsvGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8.5 4.25h9.25a1 1 0 0 1 1 1v14.5a1 1 0 0 1-1 1H6.25a1 1 0 0 1-1-1v-11L8.5 4.25Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M8.5 4.25v3.5H5M9 12.25h6M9 15.75h6M9 9.25h3.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function PaExportPngGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.25 17.25h15.5a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-3.12l-1.66-1.66a1 1 0 0 0-.7-.29h-6a1 1 0 0 0-.7.29L5.37 6.25H4.25a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M12 15.25a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z"
        stroke="currentColor"
        strokeWidth="1.75"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function ProductivityExportButtons({
  viewMode,
  onCsv,
  onPng,
  busy,
  compact
}: {
  viewMode: PaViewMode;
  onCsv: () => void;
  onPng: () => void;
  busy?: boolean;
  compact?: boolean;
}) {
  const showCsv = viewMode === "table";
  const showPng = viewMode === "chart";

  return (
    <div
      className={`pa-export-actions${compact ? " pa-export-actions--compact" : ""}`}
      role="group"
      aria-label={
        showCsv
          ? "Export table data (CSV)"
          : "Export chart image (PNG)"
      }
    >
      {showCsv ? (
        <button
          type="button"
          className={`pa-export-icon-btn${compact ? " pa-export-icon-btn--compact" : ""}`}
          onClick={onCsv}
          aria-label="Download CSV: table data for this chart (UTF-8, Excel-friendly)."
          title="Download CSV: exports the same columns as the table (periods and values). Opens in Excel or Sheets."
        >
          <PaExportCsvGlyph />
        </button>
      ) : null}
      {showPng ? (
        <button
          type="button"
          className={`pa-export-icon-btn${compact ? " pa-export-icon-btn--compact" : ""}`}
          onClick={onPng}
          disabled={busy}
          aria-busy={busy}
          aria-label="Download PNG: high-resolution chart image with title, axes, and legend; transparent background."
          title="Download PNG: large transparent image (title, timeframe range, axes, and legend) for slides or docs — compositing-friendly."
        >
          <PaExportPngGlyph />
        </button>
      ) : null}
    </div>
  );
}

function PaSingleMetricTable({
  timeframe,
  points,
  overlay,
  showAvg,
  valueHeader
}: {
  timeframe: Timeframe;
  points: Point[];
  overlay: Point[] | null;
  showAvg: boolean;
  valueHeader: string;
}) {
  const hasAvg =
    Boolean(overlay && overlay.length === points.length && showAvg && points.length > 0);
  return (
    <div className="pa-table-scroll" role="region" aria-label="Values table for this chart">
      <table className="pa-data-table">
        <thead>
          <tr>
            <th scope="col" title="Time period for this row (matches the chart horizontal axis).">
              Period
            </th>
            <th
              scope="col"
              title={`${valueHeader} — same values as the main series in the chart.`}
            >
              {valueHeader}
            </th>
            {hasAvg && (
              <th
                scope="col"
                title="Rolling average for each period (shown when the rolling average series is visible in the chart)."
              >
                Rolling avg
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={`${p.rawLabel}-${i}`}>
              <td>{formatAxisLabelWithYear(timeframe, p.rawLabel)}</td>
              <td className="pa-data-table-num">{formatPillValue(p.value)}</td>
              {hasAvg && (
                <td className="pa-data-table-num">{formatPillValue(overlay![i]!.value)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaProjectSeriesTable({
  timeframe,
  seriesList,
  visibleIds
}: {
  timeframe: Timeframe;
  seriesList: MultiSeries[];
  visibleIds: Set<string>;
}) {
  const visible = seriesList.filter((s) => visibleIds.has(s.id));
  if (visible.length === 0) {
    return <div className="muted small pa-no-data">No visible series — use the legend to show projects.</div>;
  }
  const n = visible[0]!.points.length;
  return (
    <div className="pa-table-scroll" role="region" aria-label="Project breakdown table">
      <table className="pa-data-table">
        <thead>
          <tr>
            <th scope="col" title="Time bucket for this row.">
              Period
            </th>
            {visible.map((s) => (
              <th key={s.id} scope="col" title={`${s.name} — amount for this project in this period.`}>
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: n }, (_, i) => (
            <tr key={`${visible[0]!.points[i]!.rawLabel}-${i}`}>
              <td>{formatAxisLabelWithYear(timeframe, visible[0]!.points[i]!.rawLabel)}</td>
              {visible.map((s) => (
                <td key={s.id} className="pa-data-table-num">
                  {formatPillValue(s.points[i]?.value ?? 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProductivityAnalysisModal({
  open,
  onClose,
  activeProfileId,
  activeProfileName
}: Props) {
  const [data, setData] = useState<ProductivityRow[] | null>(null);
  const [projectBreakdown, setProjectBreakdown] = useState<ProjectBreakdownPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("daily");
  const [projectTimeframe, setProjectTimeframe] = useState<Timeframe>("daily");
  const [fullscreenChartId, setFullscreenChartId] = useState<string | null>(null);
  const [daysWindow, setDaysWindow] = useState<PaRangeDays>(60);
  const [windowStart, setWindowStart] = useState(0);
  const [seriesVisibility, setSeriesVisibility] = useState<
    Record<string, { raw: boolean; avg: boolean }>
  >({});
  const [projectSeriesVisibility, setProjectSeriesVisibility] = useState<Record<string, boolean>>(
    {}
  );
  const [paSectionViewMode, setPaSectionViewMode] = useState<Record<string, PaViewMode>>({});
  const paView = (sectionId: string): PaViewMode => paSectionViewMode[sectionId] ?? "chart";
  const setPaView = (sectionId: string, m: PaViewMode) =>
    setPaSectionViewMode((prev) => ({ ...prev, [sectionId]: m }));
  useEffect(() => {
    if (open) return;
    setPaSectionViewMode({});
  }, [open]);
  const chartSvgRegistry = useRef<PaChartSvgRegistry>(new Map());
  const registerChartSvg = useCallback((key: string, el: SVGSVGElement | null) => {
    const m = chartSvgRegistry.current;
    if (el) m.set(key, el);
    else m.delete(key);
  }, []);
  const [exportBusyKey, setExportBusyKey] = useState<string | null>(null);
  const showExportError = useCallback((message: string) => {
    window.dispatchEvent(
      new CustomEvent("pst:toast", {
        detail: {
          kind: "error",
          title: "Export failed",
          message,
          durationMs: 4500
        }
      })
    );
  }, []);
  const showExportSuccess = useCallback((title: string, filename: string, durationMs?: number) => {
    window.dispatchEvent(
      new CustomEvent("pst:toast", {
        detail: {
          kind: "success",
          title,
          message: filename,
          ...(typeof durationMs === "number" && Number.isFinite(durationMs) ? { durationMs } : {})
        }
      })
    );
  }, []);
  const windowStep = useMemo(() => rangeStepDays(daysWindow), [daysWindow]);

  const annuallyTimeframeDisabled =
    daysWindow !== PA_RANGE_ALL && daysWindow <= 365;

  /** Native fullscreen on the chart overlay (not `documentElement`) so the chart layer actually fills the display. */
  const requestPaChartBrowserFullscreen = async () => {
    const host = paFsOverlayRef.current;
    if (!host) return;
    const fsNow = getBrowserFullscreenElement();
    if (fsNow && fsNow !== host) {
      toastProductivityAnalysisFullscreenBusy();
      return;
    }
    if (fsNow === host) return;
    const ok = await requestHTMLElementFullscreen(host);
    if (!ok) {
      window.dispatchEvent(
        new CustomEvent("pst:toast", {
          detail: {
            kind: "info",
            title: "Fullscreen not available",
            message: "Your browser blocked fullscreen. The chart stays open in expanded view — try again or allow full screen.",
            durationMs: 2800
          }
        })
      );
    }
  };

  const openFullscreenChart = (chartId: string) => {
    setFullscreenChartId(chartId);
    afterProductivityChartOverlayPaint(() => {
      void requestPaChartBrowserFullscreen();
    });
  };

  const closeFullscreenChart = () => {
    void exitBrowserFullscreenAll();
    setFullscreenChartId(null);
  };

  const fsChromeRef = useRef<HTMLDivElement | null>(null);
  const paFsOverlayRef = useRef<HTMLDivElement | null>(null);
  /** Tooltips must portal inside this node during element fullscreen (body portaled nodes are not shown). */
  const [paFsTooltipMountEl, setPaFsTooltipMountEl] = useState<HTMLDivElement | null>(null);
  const fsCloseBtnRef = useRef<HTMLButtonElement | null>(null);
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);
  const fullscreenChartIdRef = useRef<string | null>(null);

  useEffect(() => {
    fullscreenChartIdRef.current = fullscreenChartId;
    window.dispatchEvent(new Event(PST_TRUE_FULLSCREEN_CONTEXT_EVENT));
  }, [fullscreenChartId]);


  useEffect(() => {
    if (!open) return;
    setTimeframe(defaultTimeframeForRange(daysWindow));
  }, [open, daysWindow]);

  useEffect(() => {
    // Keep project chart timeframe in sync with the global timeframe.
    setProjectTimeframe(timeframe);
  }, [timeframe]);

  useEffect(() => {
    if (!open) return;
    if (annuallyTimeframeDisabled && timeframe === "annually") {
      setTimeframe(defaultTimeframeForRange(daysWindow));
    }
  }, [open, annuallyTimeframeDisabled, timeframe, daysWindow]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let refreshDebounceTimer: number | null = null;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      const started = performance.now();
      try {
        const url = new URL(apiUrl("/api/productivity-insights"));
        if (activeProfileId) url.searchParams.set("profileId", activeProfileId);
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`);
        }
        const requestedProfileId = activeProfileId ?? null;
        const body: {
          profileId?: string | null;
          rows: ProductivityRow[];
          projectBreakdown?: ProjectBreakdownPayload;
        } =
          await res.json();
        if (!cancelled) {
          const responseProfileId = body.profileId ?? null;
          if (responseProfileId !== requestedProfileId) return;
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

    const onDataChanged = () => {
      if (refreshDebounceTimer) window.clearTimeout(refreshDebounceTimer);
      refreshDebounceTimer = window.setTimeout(() => {
        refreshDebounceTimer = null;
        void fetchData();
      }, 220);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void fetchData();
    };
    const onFocus = () => {
      void fetchData();
    };

    window.addEventListener("pst:tasks-changed", onDataChanged);
    window.addEventListener("pst:projects-changed", onDataChanged);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      if (refreshDebounceTimer) {
        window.clearTimeout(refreshDebounceTimer);
        refreshDebounceTimer = null;
      }
      window.removeEventListener("pst:tasks-changed", onDataChanged);
      window.removeEventListener("pst:projects-changed", onDataChanged);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [open, activeProfileId]);

  useEffect(() => {
    // Reset chart payload on scope changes to avoid visual bleed across profiles.
    setData(null);
    setProjectBreakdown(null);
  }, [activeProfileId]);

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

    const onFsChange = () => {
      const fs = getBrowserFullscreenElement();
      const host = paFsOverlayRef.current;
      const overlayIsFs = Boolean(host && fs === host);
      setIsBrowserFullscreen(overlayIsFs);
      if (!fs && fullscreenChartIdRef.current) {
        setFullscreenChartId(null);
      }
    };

    onFsChange();
    return addProductivityAnalysisFullscreenListener(onFsChange);
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

  const projectChartRows = useMemo(
    () => aggregateRowsByTimeframe(windowRows, projectTimeframe),
    [windowRows, projectTimeframe]
  );

  const projectTasksSeries = useMemo((): MultiSeries[] => {
    if (!projectBreakdown?.rows?.length || !projectBreakdown.projects?.length) return [];
    if (!windowRows.length) return [];

    // IMPORTANT: keep the project breakdown aligned to the *visible window*.
    // Otherwise, coarse buckets like YYYY / YYYY-Qn / YYYY-MM can silently include completions
    // outside the shown range, which distorts trends and flattens/warps fluctuations.
    const windowStartIso = windowRows[0]!.date;
    const windowEndIso = windowRows[windowRows.length - 1]!.date;

    // Bucket daily breakdown rows into the selected timeframe by summing counts per project.
    const byKey = new Map<string, { rawLabel: string; byProject: Map<string, number> }>();

    for (const r of projectBreakdown.rows) {
      if (r.date < windowStartIso || r.date > windowEndIso) continue;
      const { key } = bucketKeyFor(r.date, projectTimeframe);
      const existing = byKey.get(key);
      const bucket = existing ?? { rawLabel: key, byProject: new Map<string, number>() };
      for (const [pid, n] of Object.entries(r.tasksCompletedByProject ?? {})) {
        bucket.byProject.set(pid, (bucket.byProject.get(pid) ?? 0) + (Number(n) || 0));
      }
      byKey.set(key, bucket);
    }

    // Preserve chronological order using a deterministic bucket timeline for the shown window.
    const keysInOrder = bucketKeysInRange(
      windowStartIso,
      windowEndIso,
      projectTimeframe
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
  }, [projectBreakdown, projectChartRows, projectTimeframe, windowRows]);

  const projectXpSeries = useMemo((): MultiSeries[] => {
    if (!projectBreakdown?.rows?.length || !projectBreakdown.projects?.length) return [];
    if (!windowRows.length) return [];

    const windowStartIso = windowRows[0]!.date;
    const windowEndIso = windowRows[windowRows.length - 1]!.date;

    const byKey = new Map<string, { rawLabel: string; byProject: Map<string, number> }>();
    for (const r of projectBreakdown.rows) {
      if (r.date < windowStartIso || r.date > windowEndIso) continue;
      const { key } = bucketKeyFor(r.date, projectTimeframe);
      const existing = byKey.get(key);
      const bucket = existing ?? { rawLabel: key, byProject: new Map<string, number>() };
      for (const [pid, n] of Object.entries(r.xpGainedByProject ?? {})) {
        bucket.byProject.set(pid, (bucket.byProject.get(pid) ?? 0) + (Number(n) || 0));
      }
      byKey.set(key, bucket);
    }

    const keysInOrder = bucketKeysInRange(windowStartIso, windowEndIso, projectTimeframe);

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
  }, [projectBreakdown, projectTimeframe, windowRows]);

  const visibleProjectTaskSeriesIds = useMemo(() => {
    const ids = new Set<string>();
    if (!projectTasksSeries.length) return ids;
    // Default: all on until the user toggles.
    const hasAny = Object.keys(projectSeriesVisibility).length > 0;
    for (const s of projectTasksSeries) {
      if (!hasAny || projectSeriesVisibility[s.id] !== false) ids.add(s.id);
    }
    return ids;
  }, [projectTasksSeries, projectSeriesVisibility]);

  const visibleProjectXpSeriesIds = useMemo(() => {
    const ids = new Set<string>();
    if (!projectXpSeries.length) return ids;
    const hasAny = Object.keys(projectSeriesVisibility).length > 0;
    for (const s of projectXpSeries) {
      if (!hasAny || projectSeriesVisibility[s.id] !== false) ids.add(s.id);
    }
    return ids;
  }, [projectXpSeries, projectSeriesVisibility]);

  const projectTasksYDomain = useMemo(() => {
    if (!projectTasksSeries.length) return { yMin: 0, yMax: 1 };
    const vals: number[] = [];
    const visible = projectTasksSeries.filter((s) => visibleProjectTaskSeriesIds.has(s.id));
    for (const s of visible) {
      for (const p of s.points) vals.push(p.value);
    }
    if (vals.length === 0) return { yMin: 0, yMax: 1 };
    const vMax = Math.max(...vals, 1);
    const vMin = Math.min(...vals);
    const padTop = Math.max(vMax * 0.14, 0.5);

    // When a single project is visible (Solo), zoom the y-axis to reveal real fluctuations
    // instead of flattening them against a 0-baseline.
    if (visible.length === 1) {
      const span = Math.max(1e-6, vMax - vMin);
      const pad = Math.max(span * 0.22, vMax * 0.04, 0.5);
      const yMin = Math.max(0, vMin - pad);
      const yMax = vMax + Math.max(pad * 0.75, padTop * 0.6);
      return { yMin, yMax };
    }

    // Multi-series: keep a 0-baseline for honest comparisons between projects.
    return { yMin: 0, yMax: vMax + padTop };
  }, [projectTasksSeries, visibleProjectTaskSeriesIds]);

  const projectXpYDomain = useMemo(() => {
    if (!projectXpSeries.length) return { yMin: 0, yMax: 1 };
    const vals: number[] = [];
    const visible = projectXpSeries.filter((s) => visibleProjectXpSeriesIds.has(s.id));
    for (const s of visible) {
      for (const p of s.points) vals.push(p.value);
    }
    if (vals.length === 0) return { yMin: 0, yMax: 1 };
    const vMax = Math.max(...vals, 1);
    const padTop = Math.max(vMax * 0.14, 0.5);
    return { yMin: 0, yMax: vMax + padTop };
  }, [projectXpSeries, visibleProjectXpSeriesIds]);

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

  /* Summary aligns to selected timeframe + shown range. */
  const windowSummary = useMemo(() => {
    const tasks: Point[] =
      timeframe === "daily"
        ? windowRows.map((r) => ({
            label: r.date,
            rawLabel: r.date,
            value: r.tasksCompleted
          }))
        : chartRows.map((r) => ({
            label: bucketKeyFor(r.date, timeframe).key,
            rawLabel: bucketKeyFor(r.date, timeframe).key,
            value: r.tasksCompleted
          }));
    const xp: Point[] =
      timeframe === "daily"
        ? windowRows.map((r) => ({
            label: r.date,
            rawLabel: r.date,
            value: r.xpGained
          }))
        : chartRows.map((r) => ({
            label: bucketKeyFor(r.date, timeframe).key,
            rawLabel: bucketKeyFor(r.date, timeframe).key,
            value: r.xpGained
          }));
    const totalTasks = sumPoints(tasks);
    const totalXp = sumPoints(xp);
    const n = tasks.length;
    const avgTasks = n ? totalTasks / n : 0;
    const avgXp = n ? totalXp / n : 0;
    const bestTasks = maxPoint(tasks);
    const bestXp = maxPoint(xp);
    const worstTasks = minPoint(tasks);
    const worstXp = minPoint(xp);
    return {
      totalTasks,
      totalXp,
      avgTasks,
      avgXp,
      bestTasks,
      bestXp,
      worstTasks,
      worstXp
    };
  }, [windowRows, chartRows, timeframe]);

  const inlineProjectTotals = useMemo(() => {
    if (projectTasksSeries.length === 0) {
      return {
        latest: 0,
        latestLabel: "",
        previous: null as number | null,
        previousLabel: null as string | null,
        peak: 0,
        peakLabel: "",
        hasVisible: false
      };
    }
    const totals = projectSeriesTotals(projectTasksSeries, visibleProjectTaskSeriesIds);
    if (!totals) {
      return {
        latest: 0,
        latestLabel: "",
        previous: null as number | null,
        previousLabel: null as string | null,
        peak: 0,
        peakLabel: "",
        hasVisible: false
      };
    }
    return { ...totals, hasVisible: true };
  }, [projectTasksSeries, visibleProjectTaskSeriesIds]);

  const inlineProjectXpTotals = useMemo(() => {
    if (projectXpSeries.length === 0) {
      return {
        latest: 0,
        latestLabel: "",
        previous: null as number | null,
        previousLabel: null as string | null,
        peak: 0,
        peakLabel: "",
        hasVisible: false
      };
    }
    const totals = projectSeriesTotals(projectXpSeries, visibleProjectXpSeriesIds);
    if (!totals) {
      return {
        latest: 0,
        latestLabel: "",
        previous: null as number | null,
        previousLabel: null as string | null,
        peak: 0,
        peakLabel: "",
        hasVisible: false
      };
    }
    return { ...totals, hasVisible: true };
  }, [projectXpSeries, visibleProjectXpSeriesIds]);

  /** Must run every render (even when modal closed) — hooks cannot follow `if (!open) return null`. */
  const fsProjectTotals = useMemo(() => {
    const fsIsTasks = fullscreenChartId === "tasksCompletedByProject";
    const fsIsXp = fullscreenChartId === "xpGainedByProject";
    if ((!fsIsTasks && !fsIsXp) || (fsIsTasks && projectTasksSeries.length === 0) || (fsIsXp && projectXpSeries.length === 0)) {
      return { latest: 0, latestLabel: "", previous: null as number | null, previousLabel: null as string | null, peak: 0, peakLabel: "" };
    }
    const totals = projectSeriesTotals(
      fsIsXp ? projectXpSeries : projectTasksSeries,
      fsIsXp ? visibleProjectXpSeriesIds : visibleProjectTaskSeriesIds
    );
    return totals ?? { latest: 0, latestLabel: "", previous: null as number | null, previousLabel: null as string | null, peak: 0, peakLabel: "" };
  }, [
    fullscreenChartId,
    projectTasksSeries,
    projectXpSeries,
    visibleProjectTaskSeriesIds,
    visibleProjectXpSeriesIds
  ]);

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
  const fsPrevVal =
    fsChart && fsPoints.length >= 2 ? fsPoints[fsPoints.length - 2]!.value : null;
  const fsLatestLabel = fsPoints.length ? fsPoints[fsPoints.length - 1]!.rawLabel : "";
  const fsPrevLabel = fsPoints.length >= 2 ? fsPoints[fsPoints.length - 2]!.rawLabel : null;
  const fsPeak = peakPoint(fsPoints);
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
    {!fullscreenChartId ? (
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
              <div className="badge-modal-sub pa-subtitle">
                Profile: {activeProfileId ? (activeProfileName ?? "Selected profile") : "All profiles"}
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
            <div className="pa-summary" aria-label="Shown range summary">
              <div className="pa-summary-card">
                <div className="pa-summary-label">Tasks (shown)</div>
                <div className="pa-summary-value">{Math.round(windowSummary.totalTasks).toLocaleString()}</div>
                <div className="pa-summary-sub">
                  Avg/{timeframe === "daily" ? "day" : "period"}: {Math.round(windowSummary.avgTasks * 10) / 10}
                </div>
              </div>
              <div className="pa-summary-card">
                <div className="pa-summary-label">XP (shown)</div>
                <div className="pa-summary-value">{Math.round(windowSummary.totalXp).toLocaleString()}</div>
                <div className="pa-summary-sub">
                  Avg/{timeframe === "daily" ? "day" : "period"}: {Math.round(windowSummary.avgXp * 10) / 10}
                </div>
              </div>
              <div className="pa-summary-card">
                <div className="pa-summary-label">Best tasks {timeframe === "daily" ? "day" : "period"}</div>
                <div className="pa-summary-value">
                  {windowSummary.bestTasks ? Math.round(windowSummary.bestTasks.value).toLocaleString() : "—"}
                </div>
                <div className="pa-summary-sub">
                  {windowSummary.bestTasks ? formatAxisLabel(timeframe, windowSummary.bestTasks.rawLabel) : ""}
                </div>
              </div>
              <div className="pa-summary-card">
                <div className="pa-summary-label">Best XP {timeframe === "daily" ? "day" : "period"}</div>
                <div className="pa-summary-value">
                  {windowSummary.bestXp ? Math.round(windowSummary.bestXp.value).toLocaleString() : "—"}
                </div>
                <div className="pa-summary-sub">
                  {windowSummary.bestXp ? formatAxisLabel(timeframe, windowSummary.bestXp.rawLabel) : ""}
                </div>
              </div>
              <div className="pa-summary-card">
                <div className="pa-summary-label">Worst tasks {timeframe === "daily" ? "day" : "period"}</div>
                <div className="pa-summary-value">
                  {windowSummary.worstTasks ? Math.round(windowSummary.worstTasks.value).toLocaleString() : "—"}
                </div>
                <div className="pa-summary-sub">
                  {windowSummary.worstTasks ? formatAxisLabel(timeframe, windowSummary.worstTasks.rawLabel) : ""}
                </div>
              </div>
              <div className="pa-summary-card">
                <div className="pa-summary-label">Worst XP {timeframe === "daily" ? "day" : "period"}</div>
                <div className="pa-summary-value">
                  {windowSummary.worstXp ? Math.round(windowSummary.worstXp.value).toLocaleString() : "—"}
                </div>
                <div className="pa-summary-sub">
                  {windowSummary.worstXp ? formatAxisLabel(timeframe, windowSummary.worstXp.rawLabel) : ""}
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
                  const prevVal = points.length >= 2 ? points[points.length - 2]!.value : null;
                  const latestLabel = points.length ? points[points.length - 1]!.rawLabel : "";
                  const prevLabel = points.length >= 2 ? points[points.length - 2]!.rawLabel : null;
                  const peak = peakPoint(points);

                  return (
                    <article key={chart.id} className="pa-card">
                      <div className="pa-card-top">
                        <div className="pa-card-head pa-card-head-row">
                          <div className="pa-card-head-text">
                            <h3 className="pa-card-title">{chart.title}</h3>
                            <p className="pa-card-desc">{chart.description}</p>
                          </div>
                        </div>
                        {points.length > 0 && (
                          <div className="pa-stat-pills">
                            <div
                              className="pa-pill"
                              title={
                                chart.cumulative
                                  ? prevLabel && latestLabel
                                    ? `Vs prior period: net change in cumulative total from end of ${formatAxisLabelWithYear(timeframe, prevLabel)} to end of ${formatAxisLabelWithYear(timeframe, latestLabel)}.`
                                    : latestLabel
                                      ? `Vs prior period: net change in cumulative total for ${formatAxisLabelWithYear(timeframe, latestLabel)} (vs prior period or visible window baseline when only one bucket is shown).`
                                      : "Vs prior period: net change in cumulative total for the latest shown period vs the prior period."
                                  : latestLabel
                                    ? `Latest: value in ${formatAxisLabelWithYear(timeframe, latestLabel)}.`
                                    : "Latest: value in the most recent period on the chart."
                              }
                            >
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
                                title={
                                  prevLabel
                                    ? `Growth %: percent change from ${formatAxisLabelWithYear(timeframe, prevLabel)} to ${formatAxisLabelWithYear(timeframe, latestLabel)}.`
                                    : "Growth %: percent change vs the prior period."
                                }
                              >
                                <span className="pa-pill-label">Growth %</span>
                                <span className="pa-pill-value pa-pill-value-growth">
                                  {formatGrowthPercent(cumulativeGrowthPct)}
                                </span>
                              </div>
                            )}
                            <div
                              className="pa-pill pa-pill-muted"
                              title={
                                chart.cumulative
                                  ? prevLabel
                                    ? `Previous: cumulative level at end of ${formatAxisLabelWithYear(timeframe, prevLabel)}.`
                                    : "Previous: cumulative level at end of the prior period."
                                  : prevLabel
                                    ? `Previous: value in ${formatAxisLabelWithYear(timeframe, prevLabel)}.`
                                    : "Previous: value in the period immediately before Latest."
                              }
                            >
                              <span className="pa-pill-label">Previous</span>
                              <span className="pa-pill-value">
                                {prevVal !== null ? formatPillValue(prevVal) : "—"}
                              </span>
                            </div>
                            <div
                              className="pa-pill pa-pill-muted"
                              title={
                                peak?.rawLabel
                                  ? `Peak: highest value in the shown range (at ${formatAxisLabelWithYear(timeframe, peak.rawLabel)}).`
                                  : "Peak: highest value in the shown range."
                              }
                            >
                              <span className="pa-pill-label">Peak</span>
                              <span className="pa-pill-value">
                                {formatPillValue(rawPeak)}
                              </span>
                            </div>
                            {avgLatest !== null && avgPeak !== null && (
                              <>
                                <div
                                  className="pa-pill pa-pill-avg"
                                  title={
                                    latestLabel
                                      ? `Avg · latest: rolling average value at ${formatAxisLabelWithYear(timeframe, latestLabel)}.`
                                      : "Avg · latest: rolling average at the latest period."
                                  }
                                >
                                  <span className="pa-pill-label">Avg · latest</span>
                                  <span className="pa-pill-value">
                                    {formatPillValue(avgLatest)}
                                  </span>
                                </div>
                                <div
                                  className="pa-pill pa-pill-avg-muted"
                                  title="Avg · peak: highest rolling average value in the shown range."
                                >
                                  <span className="pa-pill-label">Avg · peak</span>
                                  <span className="pa-pill-value">
                                    {formatPillValue(avgPeak)}
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                        {points.length > 0 && (
                          <div className="pa-card-actions">
                            <ProductivityViewToggle
                              mode={paView(chart.id)}
                              onChange={(m) => setPaView(chart.id, m)}
                            />
                            <ProductivityExportButtons
                              viewMode={paView(chart.id)}
                              busy={exportBusyKey === `png-inline-${chart.id}`}
                              onCsv={() => {
                                const fn = `${productivityExportFilenameStem(chart.id, timeframe)}.csv`;
                                downloadCsvRows(
                                  fn,
                                  buildSingleMetricTableCsvRows(
                                    timeframe,
                                    points,
                                    overlay,
                                    getSeriesVis(chart.id, Boolean(overlay)).avg,
                                    chart.yAxisLabel
                                  )
                                );
                                showExportSuccess("CSV exported", fn);
                              }}
                              onPng={() => {
                                const busyKey = `png-inline-${chart.id}`;
                                void (async () => {
                                  const started = performance.now();
                                  setExportBusyKey(busyKey);
                                  try {
                                    const visPng = getSeriesVis(chart.id, Boolean(overlay));
                                    const blob = await exportPaChartPngFromRegistry(
                                      chartSvgRegistry.current,
                                      chart.id,
                                      {
                                        points,
                                        timeframe,
                                        yMin: yDom.yMin,
                                        yMax: yDom.yMax,
                                        chartLayoutMode: "inline",
                                        chartTitle: chart.title,
                                        caption: buildPaExportCaption(timeframe, points),
                                        xAxisLabel: timeframe === "daily" ? "Date" : "Period",
                                        yAxisLabel: chart.yAxisLabel,
                                        integerYAxis: paExportPreferIntegerYAxis(chart.id),
                                        legend: {
                                          kind: "single",
                                          showRaw: visPng.raw,
                                          showAvg: visPng.avg,
                                          hasOverlay: Boolean(
                                            overlay && overlay.length === points.length
                                          ),
                                          cumulative: chart.cumulative,
                                          primaryLabel: chart.yAxisLabel
                                        }
                                      }
                                    );
                                    const pngFn = `${productivityExportFilenameStem(chart.id, timeframe)}.png`;
                                    downloadBlobFile(pngFn, blob);
                                    const elapsed = performance.now() - started;
                                    showExportSuccess(
                                      "PNG exported",
                                      pngFn,
                                      elapsed >= 400 ? elapsed : undefined
                                    );
                                  } catch (e) {
                                    showExportError(
                                      e instanceof Error ? e.message : "PNG export failed."
                                    );
                                  } finally {
                                    setExportBusyKey((k) => (k === busyKey ? null : k));
                                  }
                                })();
                              }}
                            />
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
                            {paView(chart.id) === "table" ? (
                              <PaSingleMetricTable
                                timeframe={timeframe}
                                points={points}
                                overlay={overlay}
                                showAvg={vis.avg}
                                valueHeader={chart.yAxisLabel}
                              />
                            ) : (
                              <>
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
                                  onRegisterSvg={registerChartSvg}
                                  exportSvgKey={chart.id}
                                />
                              </>
                            )}
                            {paView(chart.id) === "table" && (
                              <div className="pa-chart-offscreen-portal" aria-hidden="true">
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
                                  onRegisterSvg={registerChartSvg}
                                  exportSvgKey={chart.id}
                                />
                              </div>
                            )}
                          </>
                            );
                          })()
                        )}
                      </div>
                    </article>
                  );
                })}

                {projectTasksSeries.length > 0 && (
                  <article key="tasksCompletedByProject" className="pa-card">
                    <div className="pa-card-top">
                      <div className="pa-card-head pa-card-head-row">
                        <div className="pa-card-head-text">
                          <h3 className="pa-card-title">Tasks by project</h3>
                          <p className="pa-card-desc">
                            Completed tasks each period, split by project.
                          </p>
                        </div>
                      </div>
                      <div className="pa-stat-pills" aria-label="Project chart quick stats">
                        <div
                          className="pa-pill"
                          title={
                            inlineProjectTotals.latestLabel
                              ? `Latest: total tasks completed across visible projects in ${formatAxisLabelWithYear(projectTimeframe, inlineProjectTotals.latestLabel)}.`
                              : "Latest: total tasks completed across visible projects in the most recent shown period."
                          }
                        >
                          <span className="pa-pill-label">Latest</span>
                          <span className="pa-pill-value">
                            {inlineProjectTotals.hasVisible ? formatPillValue(inlineProjectTotals.latest) : "—"}
                          </span>
                        </div>
                        <div
                          className="pa-pill pa-pill-muted"
                          title={
                            inlineProjectTotals.previousLabel
                              ? `Previous: total tasks completed across visible projects in ${formatAxisLabelWithYear(projectTimeframe, inlineProjectTotals.previousLabel)}.`
                              : "Previous: total tasks completed across visible projects in the period immediately before Latest."
                          }
                        >
                          <span className="pa-pill-label">Previous</span>
                          <span className="pa-pill-value">
                            {inlineProjectTotals.hasVisible && inlineProjectTotals.previous !== null
                              ? formatPillValue(inlineProjectTotals.previous)
                              : "—"}
                          </span>
                        </div>
                        <div
                          className="pa-pill pa-pill-muted"
                          title={
                            inlineProjectTotals.peakLabel
                              ? `Peak: highest total tasks completed across visible projects (at ${formatAxisLabelWithYear(projectTimeframe, inlineProjectTotals.peakLabel)}).`
                              : "Peak: highest total tasks completed across visible projects in any shown period."
                          }
                        >
                          <span className="pa-pill-label">Peak</span>
                          <span className="pa-pill-value">
                            {inlineProjectTotals.hasVisible ? formatPillValue(inlineProjectTotals.peak) : "—"}
                          </span>
                        </div>
                        <div
                          className="pa-pill pa-pill-avg-muted"
                          title="Series: number of visible project lines (projects) currently plotted."
                        >
                          <span className="pa-pill-label">Series</span>
                          <span className="pa-pill-value">{visibleProjectTaskSeriesIds.size}</span>
                        </div>
                      </div>
                      <div className="pa-card-actions">
                        <ProductivityViewToggle
                          mode={paView("tasksCompletedByProject")}
                          onChange={(m) => setPaView("tasksCompletedByProject", m)}
                        />
                        <ProductivityExportButtons
                          viewMode={paView("tasksCompletedByProject")}
                          busy={exportBusyKey === "png-inline-tasksCompletedByProject"}
                          onCsv={() => {
                            const fn = `${productivityExportFilenameStem("tasks-by-project-tasks", projectTimeframe)}.csv`;
                            downloadCsvRows(
                              fn,
                              buildProjectSeriesTableCsvRows(
                                projectTimeframe,
                                projectTasksSeries,
                                visibleProjectTaskSeriesIds
                              )
                            );
                            showExportSuccess("CSV exported", fn);
                          }}
                          onPng={() => {
                            const busyKey = "png-inline-tasksCompletedByProject";
                            void (async () => {
                              const started = performance.now();
                              setExportBusyKey(busyKey);
                              try {
                                const anchor = projectTasksSeries[0]!.points;
                                const blob = await exportPaChartPngFromRegistry(
                                  chartSvgRegistry.current,
                                  "tasksCompletedByProject",
                                  {
                                    points: anchor,
                                    timeframe: projectTimeframe,
                                    yMin: projectTasksYDomain.yMin,
                                    yMax: projectTasksYDomain.yMax,
                                    chartLayoutMode: "inline",
                                    chartTitle: "Tasks by project",
                                    caption: buildPaExportCaption(projectTimeframe, anchor),
                                    xAxisLabel: projectTimeframe === "daily" ? "Date" : "Period",
                                    yAxisLabel: "Tasks · per period",
                                    integerYAxis: true,
                                    legend: {
                                      kind: "multi",
                                      entries: projectTasksSeries
                                        .filter((s) => visibleProjectTaskSeriesIds.has(s.id))
                                        .map((s) => ({ name: s.name, color: s.color }))
                                    }
                                  }
                                );
                                const pngFn = `${productivityExportFilenameStem("tasks-by-project-tasks", projectTimeframe)}.png`;
                                downloadBlobFile(pngFn, blob);
                                const elapsed = performance.now() - started;
                                showExportSuccess(
                                  "PNG exported",
                                  pngFn,
                                  elapsed >= 400 ? elapsed : undefined
                                );
                              } catch (e) {
                                showExportError(
                                  e instanceof Error ? e.message : "PNG export failed."
                                );
                              } finally {
                                setExportBusyKey((k) => (k === busyKey ? null : k));
                              }
                            })();
                          }}
                        />
                        <button
                          type="button"
                          className="pa-expand-chart-btn"
                          aria-label="Open full screen for Tasks by project. Same range and timeframe. Press Escape to close."
                          title="Open full screen: Tasks by project. Keeps your current range and timeframe. Press Esc or Exit to return."
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
                    </div>

                    <div className="pa-chart-panel">
                      <div className="pa-chart-window-caption" aria-label="Visible period">
                        <span className="pa-chart-window-caption-label">Shown</span>
                        <span className="pa-chart-window-caption-range">
                          {formatAxisLabel(projectTimeframe, projectTasksSeries[0]!.points[0]!.rawLabel)}
                          <span className="pa-chart-window-caption-sep" aria-hidden="true">
                            —
                          </span>
                          {formatAxisLabel(
                            projectTimeframe,
                            projectTasksSeries[0]!.points[projectTasksSeries[0]!.points.length - 1]!.rawLabel
                          )}
                        </span>
                        <span className="pa-chart-window-caption-meta">
                          {projectTasksSeries[0]!.points.length}{" "}
                          {projectTasksSeries[0]!.points.length === 1 ? "point" : "points"}
                        </span>
                      </div>
                      {paView("tasksCompletedByProject") === "table" ? (
                        <PaProjectSeriesTable
                          timeframe={projectTimeframe}
                          seriesList={projectTasksSeries}
                          visibleIds={visibleProjectTaskSeriesIds}
                        />
                      ) : (
                        <MultiLineChart
                          chartId="tasksCompletedByProject"
                          series={projectTasksSeries}
                          yMin={projectTasksYDomain.yMin}
                          yMax={projectTasksYDomain.yMax}
                          timeframe={projectTimeframe}
                          xAxisLabel={projectTimeframe === "daily" ? "Date" : "Period"}
                          yAxisLabel="Tasks · per period"
                          mode="inline"
                          visibleSeriesIds={visibleProjectTaskSeriesIds}
                          onToggleSeries={toggleProjectSeries}
                          onRegisterSvg={registerChartSvg}
                          exportSvgKey="tasksCompletedByProject"
                        />
                      )}
                      {paView("tasksCompletedByProject") === "table" && (
                        <div className="pa-chart-offscreen-portal" aria-hidden="true">
                          <MultiLineChart
                            chartId="tasksCompletedByProject"
                            series={projectTasksSeries}
                            yMin={projectTasksYDomain.yMin}
                            yMax={projectTasksYDomain.yMax}
                            timeframe={projectTimeframe}
                            xAxisLabel={projectTimeframe === "daily" ? "Date" : "Period"}
                            yAxisLabel="Tasks · per period"
                            mode="inline"
                            visibleSeriesIds={visibleProjectTaskSeriesIds}
                            onToggleSeries={toggleProjectSeries}
                            onRegisterSvg={registerChartSvg}
                            exportSvgKey="tasksCompletedByProject"
                          />
                        </div>
                      )}
                    </div>
                  </article>
                )}

                {projectXpSeries.length > 0 && (
                  <article key="xpGainedByProject" className="pa-card">
                    <div className="pa-card-top">
                      <div className="pa-card-head pa-card-head-row">
                        <div className="pa-card-head-text">
                          <h3 className="pa-card-title">XP by project</h3>
                          <p className="pa-card-desc">
                            XP earned each period, split by project.
                          </p>
                        </div>
                      </div>
                      <div className="pa-stat-pills" aria-label="Project XP chart quick stats">
                        <div
                          className="pa-pill"
                          title={
                            inlineProjectXpTotals.latestLabel
                              ? `Latest: total XP gained across visible projects in ${formatAxisLabelWithYear(projectTimeframe, inlineProjectXpTotals.latestLabel)}.`
                              : "Latest: total XP gained across visible projects in the most recent shown period."
                          }
                        >
                          <span className="pa-pill-label">Latest</span>
                          <span className="pa-pill-value">
                            {inlineProjectXpTotals.hasVisible ? formatPillValue(inlineProjectXpTotals.latest) : "—"}
                          </span>
                        </div>
                        <div
                          className="pa-pill pa-pill-muted"
                          title={
                            inlineProjectXpTotals.previousLabel
                              ? `Previous: total XP gained across visible projects in ${formatAxisLabelWithYear(projectTimeframe, inlineProjectXpTotals.previousLabel)}.`
                              : "Previous: total XP gained across visible projects in the period immediately before Latest."
                          }
                        >
                          <span className="pa-pill-label">Previous</span>
                          <span className="pa-pill-value">
                            {inlineProjectXpTotals.hasVisible && inlineProjectXpTotals.previous !== null
                              ? formatPillValue(inlineProjectXpTotals.previous)
                              : "—"}
                          </span>
                        </div>
                        <div
                          className="pa-pill pa-pill-muted"
                          title={
                            inlineProjectXpTotals.peakLabel
                              ? `Peak: highest total XP gained across visible projects (at ${formatAxisLabelWithYear(projectTimeframe, inlineProjectXpTotals.peakLabel)}).`
                              : "Peak: highest total XP gained across visible projects in any shown period."
                          }
                        >
                          <span className="pa-pill-label">Peak</span>
                          <span className="pa-pill-value">
                            {inlineProjectXpTotals.hasVisible ? formatPillValue(inlineProjectXpTotals.peak) : "—"}
                          </span>
                        </div>
                        <div
                          className="pa-pill pa-pill-avg-muted"
                          title="Series: number of visible project lines (projects) currently plotted in this chart."
                        >
                          <span className="pa-pill-label">Series</span>
                          <span className="pa-pill-value">{visibleProjectXpSeriesIds.size}</span>
                        </div>
                      </div>
                      <div className="pa-card-actions">
                        <ProductivityViewToggle
                          mode={paView("xpGainedByProject")}
                          onChange={(m) => setPaView("xpGainedByProject", m)}
                        />
                        <ProductivityExportButtons
                          viewMode={paView("xpGainedByProject")}
                          busy={exportBusyKey === "png-inline-xpGainedByProject"}
                          onCsv={() => {
                            const fn = `${productivityExportFilenameStem("tasks-by-project-xp", projectTimeframe)}.csv`;
                            downloadCsvRows(
                              fn,
                              buildProjectSeriesTableCsvRows(
                                projectTimeframe,
                                projectXpSeries,
                                visibleProjectXpSeriesIds
                              )
                            );
                            showExportSuccess("CSV exported", fn);
                          }}
                          onPng={() => {
                            const busyKey = "png-inline-xpGainedByProject";
                            void (async () => {
                              const started = performance.now();
                              setExportBusyKey(busyKey);
                              try {
                                const anchor = projectXpSeries[0]!.points;
                                const blob = await exportPaChartPngFromRegistry(
                                  chartSvgRegistry.current,
                                  "xpGainedByProject",
                                  {
                                    points: anchor,
                                    timeframe: projectTimeframe,
                                    yMin: projectXpYDomain.yMin,
                                    yMax: projectXpYDomain.yMax,
                                    chartLayoutMode: "inline",
                                    chartTitle: "XP by project",
                                    caption: buildPaExportCaption(projectTimeframe, anchor),
                                    xAxisLabel: projectTimeframe === "daily" ? "Date" : "Period",
                                    yAxisLabel: "XP · per period",
                                    integerYAxis: false,
                                    legend: {
                                      kind: "multi",
                                      entries: projectXpSeries
                                        .filter((s) => visibleProjectXpSeriesIds.has(s.id))
                                        .map((s) => ({ name: s.name, color: s.color }))
                                    }
                                  }
                                );
                                const pngFn = `${productivityExportFilenameStem("tasks-by-project-xp", projectTimeframe)}.png`;
                                downloadBlobFile(pngFn, blob);
                                const elapsed = performance.now() - started;
                                showExportSuccess(
                                  "PNG exported",
                                  pngFn,
                                  elapsed >= 400 ? elapsed : undefined
                                );
                              } catch (e) {
                                showExportError(
                                  e instanceof Error ? e.message : "PNG export failed."
                                );
                              } finally {
                                setExportBusyKey((k) => (k === busyKey ? null : k));
                              }
                            })();
                          }}
                        />
                        <button
                          type="button"
                          className="pa-expand-chart-btn"
                          aria-label="Open full screen for XP by project. Same range and timeframe. Press Escape to close."
                          title="Open full screen: XP by project. Keeps your current range and timeframe. Press Esc or Exit to return."
                          onClick={() => openFullscreenChart("xpGainedByProject")}
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
                    </div>

                    <div className="pa-chart-panel">
                      <div className="pa-chart-window-caption" aria-label="Visible period">
                        <span className="pa-chart-window-caption-label">Shown</span>
                        <span className="pa-chart-window-caption-range">
                          {formatAxisLabel(projectTimeframe, projectXpSeries[0]!.points[0]!.rawLabel)}
                          <span className="pa-chart-window-caption-sep" aria-hidden="true">
                            —
                          </span>
                          {formatAxisLabel(
                            projectTimeframe,
                            projectXpSeries[0]!.points[projectXpSeries[0]!.points.length - 1]!.rawLabel
                          )}
                        </span>
                        <span className="pa-chart-window-caption-meta">
                          {projectXpSeries[0]!.points.length}{" "}
                          {projectXpSeries[0]!.points.length === 1 ? "point" : "points"}
                        </span>
                      </div>
                      {paView("xpGainedByProject") === "table" ? (
                        <PaProjectSeriesTable
                          timeframe={projectTimeframe}
                          seriesList={projectXpSeries}
                          visibleIds={visibleProjectXpSeriesIds}
                        />
                      ) : (
                        <MultiLineChart
                          chartId="xpGainedByProject"
                          series={projectXpSeries}
                          yMin={projectXpYDomain.yMin}
                          yMax={projectXpYDomain.yMax}
                          timeframe={projectTimeframe}
                          xAxisLabel={projectTimeframe === "daily" ? "Date" : "Period"}
                          yAxisLabel="XP · per period"
                          mode="inline"
                          visibleSeriesIds={visibleProjectXpSeriesIds}
                          onToggleSeries={toggleProjectSeries}
                          onRegisterSvg={registerChartSvg}
                          exportSvgKey="xpGainedByProject"
                        />
                      )}
                      {paView("xpGainedByProject") === "table" && (
                        <div className="pa-chart-offscreen-portal" aria-hidden="true">
                          <MultiLineChart
                            chartId="xpGainedByProject"
                            series={projectXpSeries}
                            yMin={projectXpYDomain.yMin}
                            yMax={projectXpYDomain.yMax}
                            timeframe={projectTimeframe}
                            xAxisLabel={projectTimeframe === "daily" ? "Date" : "Period"}
                            yAxisLabel="XP · per period"
                            mode="inline"
                            visibleSeriesIds={visibleProjectXpSeriesIds}
                            onToggleSeries={toggleProjectSeries}
                            onRegisterSvg={registerChartSvg}
                            exportSvgKey="xpGainedByProject"
                          />
                        </div>
                      )}
                    </div>
                  </article>
                )}

              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    ) : null}

    {fsAnyChart &&
      createPortal(
        <div
          ref={paFsOverlayRef}
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
                  onClick={() => void requestPaChartBrowserFullscreen()}
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
              {fsIsProject ? (fullscreenChartId === "xpGainedByProject" ? projectXpSeries : projectTasksSeries).length === 0 ? (
                <div className="muted pa-no-data pa-no-data-fs" role="alert">
                  No project breakdown data is available for this range.
                </div>
              ) : (
                <>
                  <div className="pa-fs-pills">
                    <div className="pa-fs-pills-inner">
                      <div
                        className="pa-pill"
                        title={
                          fullscreenChartId === "xpGainedByProject"
                            ? fsProjectTotals.latestLabel
                              ? `Latest: total XP gained across visible projects in ${formatAxisLabelWithYear(projectTimeframe, fsProjectTotals.latestLabel)}.`
                              : "Latest: total XP gained across visible projects in the most recent shown period."
                            : fsProjectTotals.latestLabel
                              ? `Latest: total tasks completed across visible projects in ${formatAxisLabelWithYear(projectTimeframe, fsProjectTotals.latestLabel)}.`
                              : "Latest: total tasks completed across visible projects in the most recent shown period."
                        }
                      >
                        <span className="pa-pill-label">Latest</span>
                        <span className="pa-pill-value">{formatPillValue(fsProjectTotals.latest)}</span>
                      </div>
                      <div
                        className="pa-pill pa-pill-muted"
                        title={
                          fullscreenChartId === "xpGainedByProject"
                            ? fsProjectTotals.previousLabel
                              ? `Previous: total XP gained across visible projects in ${formatAxisLabelWithYear(projectTimeframe, fsProjectTotals.previousLabel)}.`
                              : "Previous: total XP gained across visible projects in the period immediately before Latest."
                            : fsProjectTotals.previousLabel
                              ? `Previous: total tasks completed across visible projects in ${formatAxisLabelWithYear(projectTimeframe, fsProjectTotals.previousLabel)}.`
                              : "Previous: total tasks completed across visible projects in the period immediately before Latest."
                        }
                      >
                        <span className="pa-pill-label">Previous</span>
                        <span className="pa-pill-value">
                          {fsProjectTotals.previous !== null ? formatPillValue(fsProjectTotals.previous) : "—"}
                        </span>
                      </div>
                      <div
                        className="pa-pill pa-pill-muted"
                        title={
                          fullscreenChartId === "xpGainedByProject"
                            ? fsProjectTotals.peakLabel
                              ? `Peak: highest total XP gained across visible projects (at ${formatAxisLabelWithYear(projectTimeframe, fsProjectTotals.peakLabel)}).`
                              : "Peak: highest total XP gained across visible projects in any shown period."
                            : fsProjectTotals.peakLabel
                              ? `Peak: highest total tasks completed across visible projects (at ${formatAxisLabelWithYear(projectTimeframe, fsProjectTotals.peakLabel)}).`
                              : "Peak: highest total tasks completed across visible projects in any shown period."
                        }
                      >
                        <span className="pa-pill-label">Peak</span>
                        <span className="pa-pill-value">{formatPillValue(fsProjectTotals.peak)}</span>
                      </div>
                      <div
                        className="pa-pill pa-pill-avg-muted"
                        title="Series: number of visible project lines (projects) currently plotted."
                      >
                        <span className="pa-pill-label">Series</span>
                        <span className="pa-pill-value">
                          {fullscreenChartId === "xpGainedByProject"
                            ? visibleProjectXpSeriesIds.size
                            : visibleProjectTaskSeriesIds.size}
                        </span>
                      </div>
                    </div>
                    {fullscreenChartId ? (
                      <>
                        <ProductivityViewToggle
                          compact
                          mode={paView(fullscreenChartId)}
                          onChange={(m) => setPaView(fullscreenChartId!, m)}
                        />
                        <ProductivityExportButtons
                          compact
                          viewMode={paView(fullscreenChartId)}
                          busy={exportBusyKey === `png-fs-${fullscreenChartId}`}
                          onCsv={() => {
                            if (!fullscreenChartId) return;
                            const rows =
                              fullscreenChartId === "xpGainedByProject"
                                ? buildProjectSeriesTableCsvRows(
                                    projectTimeframe,
                                    projectXpSeries,
                                    visibleProjectXpSeriesIds
                                  )
                                : buildProjectSeriesTableCsvRows(
                                    projectTimeframe,
                                    projectTasksSeries,
                                    visibleProjectTaskSeriesIds
                                  );
                            const fn = `${productivityExportFilenameStem(fullscreenChartId, projectTimeframe)}.csv`;
                            downloadCsvRows(fn, rows);
                            showExportSuccess("CSV exported", fn);
                          }}
                          onPng={() => {
                            if (!fullscreenChartId) return;
                            const busyKey = `png-fs-${fullscreenChartId}`;
                            void (async () => {
                              const started = performance.now();
                              setExportBusyKey(busyKey);
                              try {
                                const isXp = fullscreenChartId === "xpGainedByProject";
                                const anchor = (isXp ? projectXpSeries[0] : projectTasksSeries[0])!.points;
                                const yMin = isXp ? projectXpYDomain.yMin : projectTasksYDomain.yMin;
                                const yMax = isXp ? projectXpYDomain.yMax : projectTasksYDomain.yMax;
                                const regKey = `${fullscreenChartId}-fs`;
                                const blob = await exportPaChartPngFromRegistry(
                                  chartSvgRegistry.current,
                                  regKey,
                                  {
                                    points: anchor,
                                    timeframe: projectTimeframe,
                                    yMin,
                                    yMax,
                                    chartLayoutMode: "fullscreen",
                                    chartTitle: isXp ? "XP by project" : "Tasks by project",
                                    caption: buildPaExportCaption(projectTimeframe, anchor),
                                    xAxisLabel: projectTimeframe === "daily" ? "Date" : "Period",
                                    yAxisLabel: isXp ? "XP · per period" : "Tasks · per period",
                                    integerYAxis: !isXp,
                                    legend: {
                                      kind: "multi",
                                      entries: (isXp ? projectXpSeries : projectTasksSeries)
                                        .filter((s) =>
                                          isXp
                                            ? visibleProjectXpSeriesIds.has(s.id)
                                            : visibleProjectTaskSeriesIds.has(s.id)
                                        )
                                        .map((s) => ({ name: s.name, color: s.color }))
                                    }
                                  }
                                );
                                const pngFn = `${productivityExportFilenameStem(fullscreenChartId, projectTimeframe)}.png`;
                                downloadBlobFile(pngFn, blob);
                                const elapsed = performance.now() - started;
                                showExportSuccess(
                                  "PNG exported",
                                  pngFn,
                                  elapsed >= 400 ? elapsed : undefined
                                );
                              } catch (e) {
                                showExportError(
                                  e instanceof Error ? e.message : "PNG export failed."
                                );
                              } finally {
                                setExportBusyKey((k) => (k === busyKey ? null : k));
                              }
                            })();
                          }}
                        />
                      </>
                    ) : null}
                  </div>
                  <>
                    {fullscreenChartId && paView(fullscreenChartId) === "table" ? (
                      <div className="pa-fs-table-host">
                        <PaProjectSeriesTable
                          timeframe={projectTimeframe}
                          seriesList={
                            fullscreenChartId === "xpGainedByProject" ? projectXpSeries : projectTasksSeries
                          }
                          visibleIds={
                            fullscreenChartId === "xpGainedByProject"
                              ? visibleProjectXpSeriesIds
                              : visibleProjectTaskSeriesIds
                          }
                        />
                      </div>
                    ) : (
                      <MultiLineChart
                        chartId={fullscreenChartId ?? "tasksCompletedByProject"}
                        series={fullscreenChartId === "xpGainedByProject" ? projectXpSeries : projectTasksSeries}
                        yMin={
                          fullscreenChartId === "xpGainedByProject"
                            ? projectXpYDomain.yMin
                            : projectTasksYDomain.yMin
                        }
                        yMax={
                          fullscreenChartId === "xpGainedByProject"
                            ? projectXpYDomain.yMax
                            : projectTasksYDomain.yMax
                        }
                        timeframe={projectTimeframe}
                        xAxisLabel={projectTimeframe === "daily" ? "Date" : "Period"}
                        yAxisLabel={
                          fullscreenChartId === "xpGainedByProject"
                            ? "XP · per period"
                            : "Tasks · per period"
                        }
                        mode="fullscreen"
                        idSuffix="-fs"
                        visibleSeriesIds={
                          fullscreenChartId === "xpGainedByProject"
                            ? visibleProjectXpSeriesIds
                            : visibleProjectTaskSeriesIds
                        }
                        onToggleSeries={toggleProjectSeries}
                        onRegisterSvg={registerChartSvg}
                        exportSvgKey={`${fullscreenChartId}-fs`}
                        fullscreenTooltipMount={paFsTooltipMountEl}
                      />
                    )}
                    {fullscreenChartId && paView(fullscreenChartId) === "table" && (
                      <div
                        className="pa-chart-offscreen-portal pa-chart-offscreen-portal--fs"
                        aria-hidden="true"
                      >
                        <MultiLineChart
                          chartId={fullscreenChartId ?? "tasksCompletedByProject"}
                          series={
                            fullscreenChartId === "xpGainedByProject"
                              ? projectXpSeries
                              : projectTasksSeries
                          }
                          yMin={
                            fullscreenChartId === "xpGainedByProject"
                              ? projectXpYDomain.yMin
                              : projectTasksYDomain.yMin
                          }
                          yMax={
                            fullscreenChartId === "xpGainedByProject"
                              ? projectXpYDomain.yMax
                              : projectTasksYDomain.yMax
                          }
                          timeframe={projectTimeframe}
                          xAxisLabel={projectTimeframe === "daily" ? "Date" : "Period"}
                          yAxisLabel={
                            fullscreenChartId === "xpGainedByProject"
                              ? "XP · per period"
                              : "Tasks · per period"
                          }
                          mode="fullscreen"
                          idSuffix="-fs"
                          visibleSeriesIds={
                            fullscreenChartId === "xpGainedByProject"
                              ? visibleProjectXpSeriesIds
                              : visibleProjectTaskSeriesIds
                          }
                          onToggleSeries={toggleProjectSeries}
                          onRegisterSvg={registerChartSvg}
                          exportSvgKey={`${fullscreenChartId}-fs`}
                          fullscreenTooltipMount={paFsTooltipMountEl}
                        />
                      </div>
                    )}
                  </>
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
                    <div className="pa-fs-pills-inner">
                      <div
                      className="pa-pill"
                      title={
                        fsChart.cumulative
                          ? fsPrevLabel && fsLatestLabel
                            ? `Vs prior period: net change in cumulative total from end of ${formatAxisLabelWithYear(timeframe, fsPrevLabel)} to end of ${formatAxisLabelWithYear(timeframe, fsLatestLabel)}.`
                            : fsLatestLabel
                              ? `Vs prior period: net change in cumulative total for ${formatAxisLabelWithYear(timeframe, fsLatestLabel)} (vs prior period or visible window baseline when only one bucket is shown).`
                              : "Vs prior period: net change in cumulative total for the latest shown period vs the prior period."
                          : fsLatestLabel
                            ? `Latest: value in ${formatAxisLabelWithYear(timeframe, fsLatestLabel)}.`
                            : "Latest: value in the most recent period on the chart."
                      }
                    >
                      <span className="pa-pill-label">
                        {fsChart.cumulative ? "Vs prior period" : "Latest"}
                      </span>
                      <span className="pa-pill-value">{formatPillValue(fsLatestVal)}</span>
                      </div>
                      {fsChart.cumulative && (
                      <div
                        className="pa-pill pa-pill-growth"
                        title={
                          fsPrevLabel
                            ? `Growth %: percent change from ${formatAxisLabelWithYear(timeframe, fsPrevLabel)} to ${formatAxisLabelWithYear(timeframe, fsLatestLabel)}.`
                            : "Growth %: percent change vs the prior period."
                        }
                      >
                        <span className="pa-pill-label">Growth %</span>
                        <span className="pa-pill-value pa-pill-value-growth">
                          {formatGrowthPercent(fsCumulativeGrowthPct)}
                        </span>
                      </div>
                      )}
                      <div
                      className="pa-pill pa-pill-muted"
                      title={
                        fsChart.cumulative
                          ? fsPrevLabel
                            ? `Previous: cumulative level at end of ${formatAxisLabelWithYear(timeframe, fsPrevLabel)}.`
                            : "Previous: cumulative level at end of the prior period."
                          : fsPrevLabel
                            ? `Previous: value in ${formatAxisLabelWithYear(timeframe, fsPrevLabel)}.`
                            : "Previous: value in the period immediately before Latest."
                      }
                      >
                      <span className="pa-pill-label">Previous</span>
                      <span className="pa-pill-value">
                        {fsPrevVal !== null ? formatPillValue(fsPrevVal) : "—"}
                      </span>
                      </div>
                      <div
                      className="pa-pill pa-pill-muted"
                      title={
                        fsPeak?.rawLabel
                          ? `Peak: highest value in the shown range (at ${formatAxisLabelWithYear(timeframe, fsPeak.rawLabel)}).`
                          : "Peak: highest value in the shown range."
                      }
                      >
                      <span className="pa-pill-label">Peak</span>
                      <span className="pa-pill-value">{formatPillValue(fsRawPeak)}</span>
                      </div>
                      {fsOverlayLatest !== null && fsOverlayPeak !== null && (
                      <>
                        <div
                          className="pa-pill pa-pill-avg"
                          title={
                            fsLatestLabel
                              ? `Avg · latest: rolling average value at ${formatAxisLabelWithYear(timeframe, fsLatestLabel)}.`
                              : "Avg · latest: rolling average at the latest period."
                          }
                        >
                          <span className="pa-pill-label">Avg · latest</span>
                          <span className="pa-pill-value">{formatPillValue(fsOverlayLatest)}</span>
                        </div>
                        <div
                          className="pa-pill pa-pill-avg-muted"
                          title="Avg · peak: highest rolling average value in the shown range."
                        >
                          <span className="pa-pill-label">Avg · peak</span>
                          <span className="pa-pill-value">{formatPillValue(fsOverlayPeak)}</span>
                        </div>
                      </>
                      )}
                    </div>
                    {fullscreenChartId ? (
                      <>
                        <ProductivityViewToggle
                          compact
                          mode={paView(fullscreenChartId)}
                          onChange={(m) => setPaView(fullscreenChartId!, m)}
                        />
                        <ProductivityExportButtons
                          compact
                          viewMode={paView(fullscreenChartId)}
                          busy={exportBusyKey === `png-fs-${fsChart.id}`}
                          onCsv={() => {
                            const fn = `${productivityExportFilenameStem(fsChart.id, timeframe)}.csv`;
                            downloadCsvRows(
                              fn,
                              buildSingleMetricTableCsvRows(
                                timeframe,
                                fsPoints,
                                fsOverlay,
                                getSeriesVis(fsChart.id, Boolean(fsOverlay)).avg,
                                fsChart.yAxisLabel
                              )
                            );
                            showExportSuccess("CSV exported", fn);
                          }}
                          onPng={() => {
                            const busyKey = `png-fs-${fsChart.id}`;
                            void (async () => {
                              const started = performance.now();
                              setExportBusyKey(busyKey);
                              try {
                                const visFs = getSeriesVis(fsChart.id, Boolean(fsOverlay));
                                const blob = await exportPaChartPngFromRegistry(
                                  chartSvgRegistry.current,
                                  `${fsChart.id}-fs`,
                                  {
                                    points: fsPoints,
                                    timeframe,
                                    yMin: fsYDomain.yMin,
                                    yMax: fsYDomain.yMax,
                                    chartLayoutMode: "fullscreen",
                                    chartTitle: fsChart.title,
                                    caption: buildPaExportCaption(timeframe, fsPoints),
                                    xAxisLabel: timeframe === "daily" ? "Date" : "Period",
                                    yAxisLabel: fsChart.yAxisLabel,
                                    integerYAxis: paExportPreferIntegerYAxis(fsChart.id),
                                    legend: {
                                      kind: "single",
                                      showRaw: visFs.raw,
                                      showAvg: visFs.avg,
                                      hasOverlay: Boolean(
                                        fsOverlay && fsOverlay.length === fsPoints.length
                                      ),
                                      cumulative: fsChart.cumulative,
                                      primaryLabel: fsChart.yAxisLabel
                                    }
                                  }
                                );
                                const pngFn = `${productivityExportFilenameStem(fsChart.id, timeframe)}.png`;
                                downloadBlobFile(pngFn, blob);
                                const elapsed = performance.now() - started;
                                showExportSuccess(
                                  "PNG exported",
                                  pngFn,
                                  elapsed >= 400 ? elapsed : undefined
                                );
                              } catch (e) {
                                showExportError(
                                  e instanceof Error ? e.message : "PNG export failed."
                                );
                              } finally {
                                setExportBusyKey((k) => (k === busyKey ? null : k));
                              }
                            })();
                          }}
                        />
                      </>
                    ) : null}
                  </div>
                  {(() => {
                    const vis = getSeriesVis(fsChart.id, Boolean(fsOverlay));
                    const isFsTable = Boolean(
                      fullscreenChartId && paView(fullscreenChartId) === "table"
                    );
                    return (
                      <>
                        {isFsTable ? (
                          <div className="pa-fs-table-host">
                            <PaSingleMetricTable
                              timeframe={timeframe}
                              points={fsPoints}
                              overlay={fsOverlay}
                              showAvg={vis.avg}
                              valueHeader={fsChart.yAxisLabel}
                            />
                          </div>
                        ) : (
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
                              onRegisterSvg={registerChartSvg}
                              exportSvgKey={`${fsChart.id}-fs`}
                              fullscreenTooltipMount={paFsTooltipMountEl}
                            />
                          </>
                        )}
                        {isFsTable && (
                          <div
                            className="pa-chart-offscreen-portal pa-chart-offscreen-portal--fs"
                            aria-hidden="true"
                          >
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
                              onRegisterSvg={registerChartSvg}
                              exportSvgKey={`${fsChart.id}-fs`}
                              fullscreenTooltipMount={paFsTooltipMountEl}
                            />
                          </div>
                        )}
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
        <div
          ref={setPaFsTooltipMountEl}
          className="pa-fs-chart-tooltip-mount"
          aria-hidden="true"
        />
      </div>
      , document.body)
    }
    </>
  );
}
