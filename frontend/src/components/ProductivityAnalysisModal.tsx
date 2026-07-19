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
import { apiFetch, apiUrl } from "../apiClient";
import { claimExclusiveTooltip } from "../uiExclusiveOverlay";
import {
  buildYTicks,
  formatYTickLabel,
  niceYDomain
} from "../utils/chartYAxis";

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

/** Plural bucket noun for insight strip headers. */
function timeframeBucketsLabel(tf: Timeframe): string {
  switch (tf) {
    case "daily":
      return "Days";
    case "weekly":
      return "Weeks";
    case "monthly":
      return "Months";
    case "quarterly":
      return "Quarters";
    case "annually":
      return "Years";
  }
}

/** Singular unit for “Best …” insight labels. */
function timeframeBestUnit(tf: Timeframe): string {
  switch (tf) {
    case "daily":
      return "day";
    case "weekly":
      return "week";
    case "monthly":
      return "month";
    case "quarterly":
      return "quarter";
    case "annually":
      return "year";
  }
}

/** Avg suffix aligned to the active timeframe bucket. */
function timeframeAvgSuffix(tf: Timeframe): string {
  switch (tf) {
    case "daily":
      return "day";
    case "weekly":
      return "wk";
    case "monthly":
      return "mo";
    case "quarterly":
      return "qtr";
    case "annually":
      return "yr";
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

/** Compact day label for dense UI (insight strip): "Jun 2" / "Jun 2 '25". */
function formatCompactDay(raw: string): string {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw;
  const y = Number(m[1]);
  const d0 = new Date(y, Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d0.getTime())) return raw;
  const month = d0.toLocaleDateString(undefined, { month: "short" });
  const day = d0.getDate();
  const nowY = new Date().getFullYear();
  return y !== nowY ? `${month} ${day} ’${String(y).slice(2)}` : `${month} ${day}`;
}

/** Short range for insight strip — prefers month+year when the span is long. */
function formatCompactRange(fromRaw: string, toRaw: string): string {
  const fm = fromRaw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = toRaw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!fm || !tm) return `${fromRaw} – ${toRaw}`;
  const from = new Date(Number(fm[1]), Number(fm[2]) - 1, Number(fm[3]));
  const to = new Date(Number(tm[1]), Number(tm[2]) - 1, Number(tm[3]));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return `${fromRaw} – ${toRaw}`;

  const spanDays = Math.round((to.getTime() - from.getTime()) / 86400000);
  const longSpan = spanDays > 120 || from.getFullYear() !== to.getFullYear();
  if (longSpan) {
    const opts: Intl.DateTimeFormatOptions = { month: "short", year: "2-digit" };
    return `${from.toLocaleDateString(undefined, opts)} – ${to.toLocaleDateString(undefined, opts)}`;
  }
  return `${formatCompactDay(fromRaw)} – ${formatCompactDay(toRaw)}`;
}

function formatInsightAvg(avg: number, timeframe: Timeframe): string {
  const rounded =
    Math.abs(avg) >= 100 ? Math.round(avg).toLocaleString() : String(Math.round(avg * 10) / 10);
  return `${rounded}/${timeframeAvgSuffix(timeframe)}`;
}

function formatInsightPeakWhen(timeframe: Timeframe, rawLabel: string): string {
  return timeframe === "daily" ? formatCompactDay(rawLabel) : formatAxisLabel(timeframe, rawLabel);
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

const PAD_L = 1.5;
const PAD_R = 2.8;
const PAD_T = 3.2;
const PAD_B = 2.4;
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

/** Map a data value to SVG Y, then to % of the plot height (for HTML y-rail labels). */
function yValueToTopPercent(value: number, yMin: number, yMax: number): number {
  const span = yMax - yMin;
  const ySvg =
    BASE_Y - (span <= 0 ? 0 : ((value - yMin) / span) * (BASE_Y - PAD_T));
  return (ySvg / VB_H) * 100;
}

/** Map a data index / svg X to % of plot width (for HTML x-axis labels). */
function xSvgToLeftPercent(xSvg: number): number {
  return (xSvg / VB_W) * 100;
}

/** Value-axis padding: min = dataMin − 20%·|dataMin|, max = dataMax + 20%·|dataMax|. */
const Y_AXIS_PAD_RATIO = 0.2;

/**
 * Build a raw [min, max] extent with 20% headroom from each extreme value.
 * Non-negative metrics clamp the floor at 0 so axes never go below zero.
 */
function paddedYExtent(
  values: number[],
  opts?: { clampMinZero?: boolean }
): { rawMin: number; rawMax: number; looksInteger: boolean } {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { rawMin: 0, rawMax: 1, looksInteger: true };
  const vMin = Math.min(...finite);
  const vMax = Math.max(...finite);
  const looksInteger = finite.every((v) => Math.abs(v - Math.round(v)) < 1e-6);
  // Prefer 20% of each extreme (as requested). When an extreme is ~0, fall back
  // to 20% of the data span so flat/near-zero series still get breathing room.
  const span = Math.max(vMax - vMin, 0);
  const spanPad = span > 1e-9 ? span * Y_AXIS_PAD_RATIO : 0;
  const minPad = Math.max(Math.abs(vMin) * Y_AXIS_PAD_RATIO, spanPad);
  const maxPad = Math.max(Math.abs(vMax) * Y_AXIS_PAD_RATIO, spanPad);
  let rawMin = vMin - minPad;
  let rawMax = vMax + maxPad;
  if (opts?.clampMinZero !== false) rawMin = Math.max(0, rawMin);
  if (rawMax <= rawMin) {
    const fallback = Math.max(
      Math.abs(vMax) * Y_AXIS_PAD_RATIO,
      spanPad,
      looksInteger ? 1 : 0.5
    );
    rawMax = rawMin + Math.max(fallback * 2, looksInteger ? 1 : 1);
  }
  return { rawMin, rawMax, looksInteger };
}

function chartYDomain(
  points: { value: number }[],
  _cumulative: boolean,
  extraPoints?: { value: number }[] | null
): { yMin: number; yMax: number } {
  const vals = [
    ...points.map((p) => p.value),
    ...(extraPoints?.map((p) => p.value) ?? [])
  ];
  if (vals.length === 0) return { yMin: 0, yMax: 1 };
  const { rawMin, rawMax, looksInteger } = paddedYExtent(vals, { clampMinZero: true });
  const span = rawMax - rawMin;
  // Tight only for small count charts; large XP ranges need a nice tick grid
  // so labels stay evenly spaced (no stacked "14k" / uneven 20k→21k gaps).
  const useTight = looksInteger && rawMax <= 24 && span <= 24;
  return niceYDomain(rawMin, rawMax, {
    preferInteger: looksInteger,
    tight: useTight,
    maxTicks: 4
  });
}

function formatYTick(v: number): string {
  return formatYTickLabel(v);
}

/** Compact labels for the chart x-axis (tooltips keep the fuller format). */
function formatChartTickLabel(timeframe: Timeframe, raw: string): string {
  if (timeframe === "annually") return raw;
  if (timeframe === "quarterly") {
    const m = raw.match(/^(\d{4})-Q(\d)$/);
    if (m) return `Q${m[2]}`;
  }
  if (timeframe === "monthly") {
    const m = raw.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      const d0 = new Date(Number(m[1]), Number(m[2]) - 1, 1);
      if (!Number.isNaN(d0.getTime())) {
        return d0.toLocaleDateString(undefined, { month: "short" });
      }
    }
  }
  if (timeframe === "weekly") {
    const m = raw.match(/^(\d{4})-W(\d{2})$/);
    if (m) return `W${Number(m[2])}`;
  }
  if (timeframe === "daily") {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const d0 = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!Number.isNaN(d0.getTime())) {
        return d0.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      }
    }
  }
  return formatAxisLabel(timeframe, raw);
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
const PA_EXPORT_COLOR_PRIMARY = "rgb(206, 17, 38)"; // Raw — brand red
const PA_EXPORT_COLOR_OVERLAY = "rgb(37, 99, 235)"; // Average — blue (matches legend)
const PA_CHART_COLOR_RAW = "#ce1126";
const PA_CHART_COLOR_AVG = "#2563eb";

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
type PaTipGrowth = {
  text: string;
  kind: "up" | "down" | "flat" | "na";
};

function paTipGrowth(current: number, prev: number | null): PaTipGrowth | null {
  if (prev == null) return null;
  if (prev === 0) {
    if (current === 0) return { text: "0%", kind: "flat" };
    return { text: "—", kind: "na" };
  }
  const pct = ((current - prev) / Math.abs(prev)) * 100;
  const rounded = Math.round(pct);
  if (rounded === 0 && Math.abs(pct) >= 0.05) {
    const fine = Math.round(pct * 10) / 10;
    return {
      text: `${fine >= 0 ? "+" : ""}${String(fine).replace(/\.0$/, "")}%`,
      kind: fine > 0 ? "up" : fine < 0 ? "down" : "flat"
    };
  }
  return {
    text: `${rounded >= 0 ? "+" : ""}${rounded}%`,
    kind: rounded > 0 ? "up" : rounded < 0 ? "down" : "flat"
  };
}

type PaTipRow = {
  id: string;
  name: string;
  value: number | null;
  color?: string;
  tone?: "raw" | "avg";
  growth?: PaTipGrowth | null;
};

function formatTipPeriod(timeframe: Timeframe, raw: string): string {
  if (timeframe === "daily") {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const d0 = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!Number.isNaN(d0.getTime())) {
        const nowY = new Date().getFullYear();
        const weekday = d0.toLocaleDateString(undefined, { weekday: "short" });
        const day = d0.toLocaleDateString(
          undefined,
          d0.getFullYear() !== nowY
            ? { month: "short", day: "numeric", year: "numeric" }
            : { month: "short", day: "numeric" }
        );
        return `${weekday}, ${day}`;
      }
    }
  }
  return formatAxisLabelWithYear(timeframe, raw);
}

function placePaChartTip(
  tip: HTMLElement,
  svg: SVGSVGElement,
  hover: { px: number; py: number }
): void {
  const r = svg.getBoundingClientRect();
  const anchorX = r.left + (hover.px / VB_W) * r.width;
  const anchorY = r.top + (hover.py / VB_H) * r.height;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 12;
  const gap = 12;
  const tipW = tip.offsetWidth || 168;
  const tipH = tip.offsetHeight || 64;

  let preferBelow = hover.py / VB_H < 0.38;
  let top = preferBelow ? anchorY + gap : anchorY - tipH - gap;
  if (!preferBelow && top < pad) {
    preferBelow = true;
    top = anchorY + gap;
  }
  if (preferBelow && top + tipH > vh - pad) {
    preferBelow = false;
    top = anchorY - tipH - gap;
  }
  top = Math.max(pad, Math.min(vh - tipH - pad, top));

  let left = anchorX - tipW / 2;
  left = Math.max(pad, Math.min(vw - tipW - pad, left));

  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  tip.classList.toggle("pa-tip--below", preferBelow);
  tip.classList.toggle("pa-tip--above", !preferBelow);
}

function PaChartTip({
  tipRef,
  periodLabel,
  rows
}: {
  tipRef: React.RefObject<HTMLDivElement | null>;
  periodLabel: string;
  rows: PaTipRow[];
}) {
  const hasGrowth = rows.some((r) => Boolean(r.growth));

  return (
    <div ref={tipRef} className="pa-tip pa-tip--above" role="tooltip">
      <div className="pa-tip-card">
        <div className="pa-tip-period">{periodLabel}</div>
        <ul className={`pa-tip-rows${hasGrowth ? " has-growth" : ""}`}>
          {rows.map((row) => (
            <li key={row.id} className={`pa-tip-row${row.value == null ? " is-meta" : ""}`}>
              <span
                className={`pa-tip-swatch${row.tone ? ` pa-tip-swatch--${row.tone}` : ""}${
                  row.value == null ? " is-empty" : ""
                }`}
                style={row.color ? { background: row.color } : undefined}
                aria-hidden="true"
              />
              <span className="pa-tip-name">{row.name}</span>
              <span className="pa-tip-value">
                {row.value == null ? "" : formatPillValue(row.value)}
              </span>
              {hasGrowth ? (
                row.growth ? (
                  <span className={`pa-tip-delta is-${row.growth.kind}`}>{row.growth.text}</span>
                ) : (
                  <span className="pa-tip-delta is-na" aria-hidden="true" />
                )
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

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
      className={`pa-series-seg${fullscreen ? " pa-series-seg--fs" : ""}`}
      aria-label="Chart legend (toggle series)"
    >
      <div className="pa-series-seg-track" role="group" aria-label="Toggle series visibility">
        <button
          type="button"
          className={`pa-series-seg-btn pa-series-seg-btn--raw ${showRaw ? "is-on" : "is-off"}`}
          aria-pressed={showRaw}
          onClick={onToggleRaw}
          title={showRaw ? "Hide raw series" : "Show raw series"}
        >
          <span className="pa-series-seg-dot pa-series-seg-dot--raw" aria-hidden="true" />
          Raw
        </button>
        <button
          type="button"
          className={`pa-series-seg-btn pa-series-seg-btn--avg ${showAvg ? "is-on" : "is-off"}`}
          aria-pressed={showAvg}
          onClick={onToggleAvg}
          title={showAvg ? "Hide rolling average" : "Show rolling average"}
        >
          <span className="pa-series-seg-dot pa-series-seg-dot--avg" aria-hidden="true" />
          Average
        </button>
      </div>
      {!fullscreen && (noneOn || !allOn) ? (
        <button
          type="button"
          className="pa-series-seg-reset"
          onClick={() => setAll(true)}
          title="Show both series"
        >
          Show both
        </button>
      ) : null}
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

  const hoverActive = hover != null;
  // App-wide: only one chart/task tooltip at a time (inline + fullscreen mounts included).
  useEffect(() => {
    if (!hoverActive) return;
    return claimExclusiveTooltip(() => setHover(null));
  }, [hoverActive, chartId, idSuffix]);

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
    placePaChartTip(tip, svg, hover);
  }, [hover]);

  useEffect(() => {
    if (!hover) return;
    let raf = 0;
    const tick = () => {
      const tip = tooltipRef.current;
      const svg = svgRef.current;
      if (tip && svg) placePaChartTip(tip, svg, hover);
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

  const yTicks = buildYTicks(yMin, yMax, 4);
  const ySpan = yMax - yMin;
  const tickIndices = xTickIndices(
    points.length,
    mode === "fullscreen" ? 10 : Math.min(6, Math.max(4, Math.ceil(points.length / 40)))
  );
  const overlayPresent = Boolean(overlayLineD);
  const overlayVisible = overlayPresent && showAvg;
  const strokeW = points.length > 450 ? 1.15 : points.length > 200 ? 1.45 : 1.85;

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
            const rows: PaTipRow[] = [];
            if (showRaw) {
              rows.push({
                id: "raw",
                name: showArea ? "Cumulative" : "Actual",
                value: pt.value,
                tone: "raw",
                growth: paTipGrowth(pt.value, prevPt ? prevPt.value : null)
              });
            }
            if (ov) {
              rows.push({
                id: "avg",
                name: "Average",
                value: ov.value,
                tone: "avg",
                growth: paTipGrowth(ov.value, prevOv ? prevOv.value : null)
              });
            }
            return (
              <PaChartTip
                tipRef={tooltipRef}
                periodLabel={formatTipPeriod(timeframe, pt.rawLabel)}
                rows={rows}
              />
            );
          })(),
          tooltipPortalParent
        )
      : null;

  const shell = (
    <div
      className={`pa-chart-shell pa-chart-shell--aligned ${mode === "fullscreen" ? "pa-chart-shell--fs" : ""}`}
      style={{ minWidth: `${minPx}px` }}
    >
      <div className="pa-axis-legend pa-axis-legend-y" aria-hidden="true">
        {yAxisLabel}
      </div>
      <div className="pa-chart-y-rail" aria-hidden="true">
        {yTicks.map((value) => (
          <span
            key={`yt-${value}`}
            className="pa-chart-y-tick"
            style={{ top: `${yValueToTopPercent(value, yMin, yMax)}%` }}
          >
            {formatYTick(value)}
          </span>
        ))}
      </div>
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
        style={{ touchAction: "none" }}
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
              <stop offset="0%" stopColor="rgb(206, 17, 38)" stopOpacity="0.22" />
              <stop offset="45%" stopColor="rgb(254, 226, 226)" stopOpacity="0.14" />
              <stop offset="100%" stopColor="rgb(255, 255, 255)" stopOpacity="0" />
            </linearGradient>
            <clipPath id={clipId}>
              <rect
                x={PAD_L}
                y={PAD_T}
                width={VB_W - PAD_L - PAD_R}
                height={BASE_Y - PAD_T + 1}
              />
            </clipPath>
          </defs>

          {yTicks.map((value) => {
            const y =
              BASE_Y - (ySpan <= 0 ? 0 : ((value - yMin) / ySpan) * (BASE_Y - PAD_T));
            return (
              <line
                key={`grid-${value}`}
                x1={PAD_L}
                x2={VB_W - PAD_R}
                y1={y}
                y2={y}
                className={`pa-chart-grid${value === yMin ? " pa-chart-grid--base" : ""}`}
              />
            );
          })}

          <line
            x1={PAD_L}
            x2={PAD_L}
            y1={PAD_T}
            y2={BASE_Y}
            className="pa-chart-axis-y"
          />
          <line
            x1={PAD_L}
            x2={VB_W - PAD_R}
            y1={BASE_Y}
            y2={BASE_Y}
            className="pa-chart-axis-x"
          />

          <g clipPath={`url(#${clipId})`}>
            {showRaw && areaPathD && (
              <path d={areaPathD} className="pa-chart-area" fill={`url(#${gradId})`} />
            )}
            {showRaw && linePathD && (
              <path
                d={linePathD}
                fill="none"
                className={`pa-chart-line pa-chart-line-primary${
                  overlayVisible ? " pa-chart-line-primary--muted" : ""
                }`}
                stroke={PA_CHART_COLOR_RAW}
                strokeWidth={overlayVisible ? Math.max(1.25, strokeW * 0.9) : strokeW}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={overlayVisible ? "5 4" : undefined}
                vectorEffect="non-scaling-stroke"
                opacity={overlayVisible ? 0.78 : 1}
              />
            )}
            {showAvg && overlayLineD && (
              <path
                d={overlayLineD}
                fill="none"
                className="pa-chart-line pa-chart-line-overlay"
                stroke={PA_CHART_COLOR_AVG}
                strokeWidth={Math.max(1.85, strokeW * 1.3)}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                opacity={1}
              />
            )}
          </g>
        </svg>
        {hover !== null && coords[hover.idx] && (
          <div className="pa-chart-hover-layer" aria-hidden="true">
            <div
              className="pa-chart-focus-band"
              style={{ left: `${xSvgToLeftPercent(hover.px)}%` }}
            />
            <div
              className="pa-chart-v-rule"
              style={{ left: `${xSvgToLeftPercent(hover.px)}%` }}
            />
            <div
              className="pa-chart-h-rule"
              style={{ top: `${(hover.py / VB_H) * 100}%` }}
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
          const leftPct =
            points.length <= 1 ? 50 : xSvgToLeftPercent(coords[i]!.x);
          const isSingleton = tickIndices.length === 1;
          const isFirst = !isSingleton && tpos === 0;
          const isLast = !isSingleton && tpos === tickIndices.length - 1;
          return (
            <span
              key={`x-${points[i].rawLabel}-${i}`}
              className={`pa-chart-xcell ${isSingleton ? "is-singleton" : ""} ${isFirst ? "is-first" : ""} ${isLast ? "is-last" : ""}`}
              style={{ left: `${leftPct}%` }}
            >
              {formatChartTickLabel(timeframe, points[i].rawLabel)}
            </span>
          );
        })}
      </div>
      <div className="pa-axis-legend pa-axis-legend-x" aria-hidden="true">
        {xAxisLabel}
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

  const hoverActive = hover != null;
  // App-wide: only one chart/task tooltip at a time (inline + fullscreen mounts included).
  useEffect(() => {
    if (!hoverActive) return;
    return claimExclusiveTooltip(() => setHover(null));
  }, [hoverActive, chartId, idSuffix]);

  useLayoutEffect(() => {
    if (!hover) return;
    const tip = tooltipRef.current;
    const svg = svgRef.current;
    if (!tip || !svg) return;
    placePaChartTip(tip, svg, hover);
  }, [hover]);

  useEffect(() => {
    if (!hover) return;
    let raf = 0;
    const tick = () => {
      const tip = tooltipRef.current;
      const svg = svgRef.current;
      if (tip && svg) placePaChartTip(tip, svg, hover);
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

  const yTicks = buildYTicks(yMin, yMax, 4);
  const ySpan = yMax - yMin;
  const tickIndices = xTickIndices(
    pointsLen,
    mode === "fullscreen" ? 10 : Math.min(6, Math.max(4, Math.ceil(pointsLen / 40)))
  );
  const strokeW = pointsLen > 450 ? 1.15 : pointsLen > 200 ? 1.45 : 1.85;

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
            const ranked = visibleSeries
              .map((s) => {
                const value = s.points[hi]?.value ?? 0;
                const prev = hi > 0 ? s.points[hi - 1]?.value ?? null : null;
                return {
                  id: s.id,
                  name: s.name,
                  value,
                  color: s.color,
                  growth: paTipGrowth(value, prev)
                } satisfies PaTipRow;
              })
              .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
            const maxRows = 5;
            const rows =
              ranked.length > maxRows
                ? [
                    ...ranked.slice(0, maxRows),
                    {
                      id: "_more",
                      name: `+${ranked.length - maxRows} more`,
                      value: null,
                      growth: null
                    } satisfies PaTipRow
                  ]
                : ranked;
            return (
              <PaChartTip
                tipRef={tooltipRef}
                periodLabel={formatTipPeriod(timeframe, label)}
                rows={rows}
              />
            );
          })(),
          tooltipPortalParent
        )
      : null;

  const shell = (
    <div
      className={`pa-chart-shell pa-chart-shell--aligned ${mode === "fullscreen" ? "pa-chart-shell--fs" : ""}`}
      style={{ minWidth: `${minPx}px` }}
    >
      <div className="pa-axis-legend pa-axis-legend-y" aria-hidden="true">
        {hasVisibleData ? yAxisLabel : "No projects selected"}
      </div>
      <div className="pa-chart-y-rail" aria-hidden="true">
        {yTicks.map((value) => (
          <span
            key={`yt-${value}`}
            className="pa-chart-y-tick"
            style={{ top: `${yValueToTopPercent(value, yMin, yMax)}%` }}
          >
            {formatYTick(value)}
          </span>
        ))}
      </div>
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
        style={{ touchAction: "none" }}
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

          {yTicks.map((value) => {
            const y =
              BASE_Y - (ySpan <= 0 ? 0 : ((value - yMin) / ySpan) * (BASE_Y - PAD_T));
            return (
              <line
                key={`grid-${value}`}
                x1={PAD_L}
                x2={VB_W - PAD_R}
                y1={y}
                y2={y}
                className={`pa-chart-grid${value === yMin ? " pa-chart-grid--base" : ""}`}
              />
            );
          })}

          <line
            x1={PAD_L}
            x2={PAD_L}
            y1={PAD_T}
            y2={BASE_Y}
            className="pa-chart-axis-y"
          />
          <line
            x1={PAD_L}
            x2={VB_W - PAD_R}
            y1={BASE_Y}
            y2={BASE_Y}
            className="pa-chart-axis-x"
          />

          <g clipPath={`url(#${clipId})`}>
            {hasVisibleData
              ? seriesPaths.map((p) => (
                  <path
                    key={p.id}
                    d={p.d}
                    fill="none"
                    className="pa-chart-line pa-chart-line-multi"
                    stroke={p.color}
                    strokeWidth={strokeW}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    opacity={visibleSeries.length > 6 ? 0.9 : 1}
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
              className="pa-chart-focus-band"
              style={{ left: `${xSvgToLeftPercent(hover.px)}%` }}
            />
            <div
              className="pa-chart-v-rule"
              style={{ left: `${xSvgToLeftPercent(hover.px)}%` }}
            />
            <div
              className="pa-chart-h-rule"
              style={{ top: `${(hover.py / VB_H) * 100}%` }}
            />
          </div>
        )}
      </div>

      <div
        className={`pa-chart-xaxis pa-chart-xaxis--pos ${mode === "fullscreen" ? "pa-chart-xaxis--fs" : ""}`}
      >
        {tickIndices.map((i, tpos) => {
          const leftPct = pointsLen <= 1 ? 50 : xSvgToLeftPercent(xAt(i));
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
              {formatChartTickLabel(timeframe, raw)}
            </span>
          );
        })}
      </div>
      <div className="pa-axis-legend pa-axis-legend-x" aria-hidden="true">
        {xAxisLabel}
      </div>
    </div>
  );

  return (
    <>
      <div
        className={`pa-series-seg pa-series-seg--projects${mode === "fullscreen" ? " pa-series-seg--fs" : ""}`}
        aria-label="Project series legend"
      >
        <div className="pa-series-seg-head">
          <div className="pa-series-seg-head-left">
            <span className="pa-series-seg-kicker">Projects</span>
            <span className="pa-series-seg-meta" aria-label="Visible series count">
              {visibleSeriesIds.size}/{series.length}
            </span>
          </div>
          <div className="pa-series-seg-head-actions" role="group" aria-label="Legend actions">
            {noneVisible ? (
              <button
                type="button"
                className="pa-series-seg-reset"
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
                className="pa-series-seg-reset"
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
                  className="pa-series-seg-reset"
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
                  className="pa-series-seg-reset"
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

        <div className="pa-series-seg-track pa-series-seg-track--wrap" role="group" aria-label="Toggle project series visibility">
          {series.map((s) => {
            const on = visibleSeriesIds.has(s.id);
            const isSolo = on && visibleSeriesIds.size === 1;
            return (
              <button
                key={s.id}
                type="button"
                className={`pa-series-seg-btn ${on ? "is-on" : "is-off"}`}
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
                <span
                  className="pa-series-seg-dot"
                  style={{ background: s.color }}
                  aria-hidden="true"
                />
                {s.name}
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
          if (target.closest(".pa-series-seg")) return;
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
      data-mode={mode}
      role="group"
      aria-label="Switch between chart and table"
    >
      <span className="pa-view-toggle-thumb" aria-hidden="true" />
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

function PaMiniSparkline({
  values,
  tone = "accent"
}: {
  values: number[];
  tone?: "accent" | "neutral";
}) {
  if (values.length < 2) return null;
  let min = values[0]!;
  let max = values[0]!;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  const w = 72;
  const h = 22;
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - 1.5 - ((v - min) / span) * (h - 3);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      className={`pa-table-spark pa-table-spark--${tone}`}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      aria-hidden="true"
    >
      <path d={d} className="pa-table-spark-line" fill="none" />
    </svg>
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
  const [newestFirst, setNewestFirst] = useState(true);
  const [compact, setCompact] = useState(true);
  const hasAvg =
    Boolean(overlay && overlay.length === points.length && showAvg && points.length > 0);
  const values = points.map((p) => p.value);
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = points.length ? sum / points.length : 0;
  const min = points.length ? Math.min(...values) : 0;
  const max = points.length ? Math.max(...values) : 0;
  const rowIndexes = Array.from({ length: points.length }, (_, i) =>
    newestFirst ? points.length - 1 - i : i
  );

  return (
    <div className={`pa-table-shell${compact ? " is-compact" : ""}`}>
      <div className="pa-table-toolbar">
        <div className="pa-table-toolbar-lead">
          <span className="pa-table-toolbar-title">Data</span>
          <PaMiniSparkline values={values} />
        </div>
        <div className="pa-table-toolbar-actions">
          <span className="pa-table-toolbar-meta">
            {points.length} {points.length === 1 ? "row" : "rows"}
          </span>
          <button
            type="button"
            className="pa-table-sort-btn"
            aria-pressed={compact}
            aria-label={compact ? "Use comfortable row height" : "Use compact row height"}
            title={compact ? "Compact rows — click for comfortable" : "Comfortable rows — click for compact"}
            onClick={() => setCompact((v) => !v)}
          >
            {compact ? "Compact" : "Comfort"}
          </button>
          <button
            type="button"
            className="pa-table-sort-btn"
            aria-pressed={newestFirst}
            aria-label={newestFirst ? "Sort oldest first" : "Sort newest first"}
            title={
              newestFirst
                ? "Showing newest first — click for oldest first"
                : "Showing oldest first — click for newest first"
            }
            onClick={() => setNewestFirst((v) => !v)}
          >
            {newestFirst ? "Newest" : "Oldest"}
          </button>
        </div>
      </div>

      {points.length > 1 ? (
        <div className="pa-table-summary" aria-label="Table summary">
          <div className="pa-table-summary-item">
            <span className="pa-table-summary-k">Avg</span>
            <span className="pa-table-summary-v">{formatPillValue(avg)}</span>
            <span className="pa-table-summary-unit">/{timeframeAvgSuffix(timeframe)}</span>
          </div>
          <div className="pa-table-summary-item">
            <span className="pa-table-summary-k">Min</span>
            <span className="pa-table-summary-v">{formatPillValue(min)}</span>
            <span className="pa-table-summary-sep" aria-hidden="true">
              –
            </span>
            <span className="pa-table-summary-k">Max</span>
            <span className="pa-table-summary-v pa-table-summary-v--peak">
              {formatPillValue(max)}
            </span>
          </div>
          <div className="pa-table-summary-item">
            <span className="pa-table-summary-k">Total</span>
            <span className="pa-table-summary-v">{formatPillValue(sum)}</span>
            <span className="pa-table-summary-unit">
              · {points.length} {timeframeBucketsLabel(timeframe).toLowerCase()}
            </span>
          </div>
        </div>
      ) : null}

      <div className="pa-table-scroll" role="region" aria-label="Values table for this chart">
        <table className="pa-data-table pa-data-table--metric">
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col" className="pa-data-table-num">
                {valueHeader}
              </th>
              <th scope="col" className="pa-data-table-num" title="Change vs previous period">
                Change
              </th>
              {hasAvg && (
                <th scope="col" className="pa-data-table-num pa-col-avg">
                  Avg
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rowIndexes.map((i) => {
              const p = points[i]!;
              const prev = i > 0 ? points[i - 1]!.value : null;
              const delta =
                prev != null && Number.isFinite(prev) ? p.value - prev : null;
              const deltaPct =
                prev != null && Number.isFinite(prev) && prev !== 0
                  ? ((p.value - prev) / Math.abs(prev)) * 100
                  : prev === 0 && p.value === 0
                    ? 0
                    : null;
              const isLatest = i === points.length - 1;
              const isPeak = p.value === max && points.length > 1;
              const tone =
                delta == null
                  ? "na"
                  : delta > 0
                    ? "up"
                    : delta < 0
                      ? "down"
                      : "flat";
              return (
                <tr
                  key={`${p.rawLabel}-${i}`}
                  className={[
                    isLatest ? "is-latest" : "",
                    isPeak ? "is-peak" : ""
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined}
                >
                  <td data-label="Period">
                    <span className="pa-table-period">
                      {formatAxisLabelWithYear(timeframe, p.rawLabel)}
                    </span>
                    {isLatest ? <span className="pa-table-badge">Latest</span> : null}
                    {isPeak && !isLatest ? (
                      <span className="pa-table-badge pa-table-badge--peak">Peak</span>
                    ) : null}
                  </td>
                  <td className="pa-data-table-num pa-data-table-num--strong" data-label={valueHeader}>
                    {formatPillValue(p.value)}
                  </td>
                  <td className="pa-data-table-num" data-label="Change">
                    {delta == null ? (
                      <span className="pa-table-delta is-na">—</span>
                    ) : (
                      <span className={`pa-table-change is-${tone}`}>
                        <span className="pa-table-delta">
                          {delta > 0 ? "+" : ""}
                          {formatPillValue(delta)}
                        </span>
                        {deltaPct != null ? (
                          <span className="pa-table-pct">{formatGrowthPercent(deltaPct)}</span>
                        ) : null}
                      </span>
                    )}
                  </td>
                  {hasAvg && (
                    <td className="pa-data-table-num pa-data-table-num--muted pa-col-avg" data-label="Avg">
                      {formatPillValue(overlay![i]!.value)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
  const [newestFirst, setNewestFirst] = useState(true);
  const [compact, setCompact] = useState(true);
  const visible = seriesList.filter((s) => visibleIds.has(s.id));
  if (visible.length === 0) {
    return (
      <div className="pa-table-empty" role="status">
        No visible series — turn projects on in the legend.
      </div>
    );
  }
  const n = visible[0]!.points.length;
  const rowIndexes = Array.from({ length: n }, (_, i) => (newestFirst ? n - 1 - i : i));
  const totals = visible.map((s) => s.points.reduce((acc, p) => acc + p.value, 0));

  return (
    <div className={`pa-table-shell${compact ? " is-compact" : ""}`}>
      <div className="pa-table-toolbar">
        <div className="pa-table-toolbar-lead">
          <span className="pa-table-toolbar-title">By project</span>
        </div>
        <div className="pa-table-toolbar-actions">
          <span className="pa-table-toolbar-meta">
            {visible.length} series · {n} {n === 1 ? "period" : "periods"}
          </span>
          <button
            type="button"
            className="pa-table-sort-btn"
            aria-pressed={compact}
            aria-label={compact ? "Use comfortable row height" : "Use compact row height"}
            title={compact ? "Compact rows — click for comfortable" : "Comfortable rows — click for compact"}
            onClick={() => setCompact((v) => !v)}
          >
            {compact ? "Compact" : "Comfort"}
          </button>
          <button
            type="button"
            className="pa-table-sort-btn"
            aria-pressed={newestFirst}
            aria-label={newestFirst ? "Sort oldest first" : "Sort newest first"}
            title={
              newestFirst
                ? "Showing newest first — click for oldest first"
                : "Showing oldest first — click for newest first"
            }
            onClick={() => setNewestFirst((v) => !v)}
          >
            {newestFirst ? "Newest" : "Oldest"}
          </button>
        </div>
      </div>

      {n > 1 ? (
        <div className="pa-table-summary pa-table-summary--projects" aria-label="Project totals">
          {visible.slice(0, 4).map((s, si) => (
            <div key={s.id} className="pa-table-summary-item">
              <span className="pa-table-summary-k">
                <span className="pa-table-swatch" style={{ background: s.color }} aria-hidden="true" />
                {s.name}
              </span>
              <span className="pa-table-summary-v">{formatPillValue(totals[si]!)}</span>
            </div>
          ))}
          {visible.length > 4 ? (
            <div className="pa-table-summary-item pa-table-summary-item--more">
              <span className="pa-table-summary-k">+{visible.length - 4} more</span>
              <span className="pa-table-summary-v">in table</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="pa-table-scroll" role="region" aria-label="Project breakdown table">
        <table className="pa-data-table pa-data-table--projects">
          <thead>
            <tr>
              <th scope="col" className="pa-data-table-sticky">
                Period
              </th>
              {visible.map((s) => (
                <th key={s.id} scope="col" className="pa-data-table-num" title={s.name}>
                  <span className="pa-table-colhead">
                    <span
                      className="pa-table-swatch"
                      style={{ background: s.color }}
                      aria-hidden="true"
                    />
                    <span className="pa-table-colname">{s.name}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowIndexes.map((i) => {
              const label = visible[0]!.points[i]!.rawLabel;
              const isLatest = i === n - 1;
              return (
                <tr key={`${label}-${i}`} className={isLatest ? "is-latest" : undefined}>
                  <td className="pa-data-table-sticky" data-label="Period">
                    <span className="pa-table-period">
                      {formatAxisLabelWithYear(timeframe, label)}
                    </span>
                    {isLatest ? <span className="pa-table-badge">Latest</span> : null}
                  </td>
                  {visible.map((s) => (
                    <td key={s.id} className="pa-data-table-num" data-label={s.name}>
                      {formatPillValue(s.points[i]?.value ?? 0)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
        const res = await apiFetch(`${url.pathname}${url.search}`, { cache: "no-store" });
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
    const { rawMin, rawMax, looksInteger } = paddedYExtent(vals, { clampMinZero: true });
    const span = rawMax - rawMin;
    return niceYDomain(rawMin, rawMax, {
      preferInteger: looksInteger,
      tight: looksInteger && rawMax <= 24 && span <= 24,
      maxTicks: 4
    });
  }, [projectTasksSeries, visibleProjectTaskSeriesIds]);

  const projectXpYDomain = useMemo(() => {
    if (!projectXpSeries.length) return { yMin: 0, yMax: 1 };
    const vals: number[] = [];
    const visible = projectXpSeries.filter((s) => visibleProjectXpSeriesIds.has(s.id));
    for (const s of visible) {
      for (const p of s.points) vals.push(p.value);
    }
    if (vals.length === 0) return { yMin: 0, yMax: 1 };
    const { rawMin, rawMax, looksInteger } = paddedYExtent(vals, { clampMinZero: true });
    const span = rawMax - rawMin;
    return niceYDomain(rawMin, rawMax, {
      preferInteger: looksInteger,
      tight: looksInteger && rawMax <= 24 && span <= 24,
      maxTicks: 4
    });
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
  const fsYDomain =
    fsChart && fsPoints.length > 0
      ? chartYDomain(fsPoints, fsChart.cumulative, fsOverlay)
      : { yMin: 0, yMax: 1 };
  const fsOverlayLatest =
    fsOverlay && fsOverlay.length > 0 ? fsOverlay[fsOverlay.length - 1]!.value : null;
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

  const rangeMetaEl = (
    <div className="pa-range-meta" aria-label="Visible range">
      <span className="pa-range-meta-label">Shown</span>
      {windowDailyFrom && windowDailyTo ? (
        <span className="pa-range-meta-dates">
          <span className="pa-range-meta-strong">{formatAxisLabel("daily", windowDailyFrom)}</span>
          <span className="pa-range-meta-sep" aria-hidden="true">
            –
          </span>
          <span className="pa-range-meta-strong">{formatAxisLabel("daily", windowDailyTo)}</span>
        </span>
      ) : (
        <span className="pa-range-meta-strong">—</span>
      )}
      <span className="pa-range-meta-buckets">
        {windowRows.length} {windowRows.length === 1 ? "day" : "days"}
        {daysWindow === PA_RANGE_ALL && windowMeta.count > 0 ? " · full" : ""}
        {timeframe !== "daily" && chartRows.length > 0
          ? ` · ${chartRows.length} ${formatTimeframeLabel(timeframe).toLowerCase()}`
          : ""}
      </span>
    </div>
  );

  const rangeControlsEl = (
    <div
      className="pa-range-controls pa-range-controls--toolbar"
      role="group"
      aria-label="Chart range and timeframe"
    >
      <div className="pa-range-left">
        <button
          type="button"
          className="pa-range-nav-btn"
          onClick={() => setWindowStart((s) => Math.max(0, s - windowStep))}
          disabled={windowMeta.start <= 0}
          title="Shift the visible window to older history."
          aria-label="Older history"
        >
          <span aria-hidden="true">←</span>
          <span className="pa-range-nav-btn-label">Older</span>
        </button>
        <button
          type="button"
          className="pa-range-nav-btn"
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
          aria-label="Newer history"
        >
          <span className="pa-range-nav-btn-label">Newer</span>
          <span aria-hidden="true">→</span>
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
          className="pa-tf-select pa-tf-select--range"
          value={daysWindow}
          onChange={(e) => {
            const v = Number(e.target.value);
            if ((PA_RANGE_DAYS as readonly number[]).includes(v)) {
              setDaysWindow(v as PaRangeDays);
            }
          }}
          aria-label="Chart history range"
          title="Choose how many days of history to include."
        >
          {PA_RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
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
                <span className="pa-subtitle-k">Profile</span>
                <span className="pa-subtitle-v">
                  {activeProfileId ? (activeProfileName ?? "Selected profile") : "All profiles"}
                </span>
                {rangeHint ? (
                  <>
                    <span className="pa-subtitle-sep" aria-hidden="true">
                      ·
                    </span>
                    <span className="pa-subtitle-k">Dataset</span>
                    <span className="pa-subtitle-v" title="Data range in daily timeline">
                      {rangeHint}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              className="pa-close-round"
              onClick={onClose}
              aria-label="Close productivity analysis"
              title="Close"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className="pa-controls-strip" role="toolbar" aria-label="Chart filters">
            {rangeControlsEl}
          </div>
        </header>

        <div className="productivity-modal-body pa-body">
          <div className="pa-insight-strip" aria-label="Shown range snapshot">
            {!loading && !error && data && data.length > 0 ? (
              <div className="pa-summary pa-summary--insight" aria-label="Shown range summary">
                <div
                  className="pa-summary-card pa-summary-card--range"
                  title={
                    windowDailyFrom && windowDailyTo
                      ? [
                          `${formatAxisLabel("daily", windowDailyFrom)} – ${formatAxisLabel("daily", windowDailyTo)}`,
                          timeframe === "daily"
                            ? `${windowRows.length.toLocaleString()} days`
                            : `${chartRows.length.toLocaleString()} ${timeframeBucketsLabel(timeframe).toLowerCase()} · ${windowRows.length.toLocaleString()} days`
                        ].join(" · ")
                      : undefined
                  }
                >
                  <div className="pa-summary-label">{timeframeBucketsLabel(timeframe)}</div>
                  <div className="pa-summary-value">
                    {(timeframe === "daily" ? windowRows.length : chartRows.length).toLocaleString()}
                  </div>
                  <div className="pa-summary-sub">
                    {windowDailyFrom && windowDailyTo
                      ? formatCompactRange(windowDailyFrom, windowDailyTo)
                      : "—"}
                  </div>
                </div>
                <div className="pa-summary-card">
                  <div className="pa-summary-label">Tasks</div>
                  <div className="pa-summary-value">
                    {Math.round(windowSummary.totalTasks).toLocaleString()}
                  </div>
                  <div className="pa-summary-sub">
                    {formatInsightAvg(windowSummary.avgTasks, timeframe)}
                  </div>
                </div>
                <div className="pa-summary-card">
                  <div className="pa-summary-label">XP</div>
                  <div className="pa-summary-value">
                    {Math.round(windowSummary.totalXp).toLocaleString()}
                  </div>
                  <div className="pa-summary-sub">
                    {formatInsightAvg(windowSummary.avgXp, timeframe)}
                  </div>
                </div>
                <div className="pa-summary-card pa-summary-card--accent">
                  <div className="pa-summary-label">Best {timeframeBestUnit(timeframe)}</div>
                  <div className="pa-summary-value">
                    {windowSummary.bestTasks
                      ? Math.round(windowSummary.bestTasks.value).toLocaleString()
                      : "—"}
                  </div>
                  <div className="pa-summary-sub">
                    {windowSummary.bestTasks
                      ? formatInsightPeakWhen(timeframe, windowSummary.bestTasks.rawLabel)
                      : "—"}
                  </div>
                </div>
                <div className="pa-summary-card">
                  <div className="pa-summary-label">Best XP</div>
                  <div className="pa-summary-value">
                    {windowSummary.bestXp
                      ? Math.round(windowSummary.bestXp.value).toLocaleString()
                      : "—"}
                  </div>
                  <div className="pa-summary-sub">
                    {windowSummary.bestXp
                      ? formatInsightPeakWhen(timeframe, windowSummary.bestXp.rawLabel)
                      : "—"}
                  </div>
                </div>
              </div>
            ) : (
              rangeMetaEl
            )}
          </div>
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
                  const overlay =
                    !chart.cumulative
                      ? rollingAverage(
                          points,
                          rollingAvgSpanBuckets(timeframe, points.length, visibleDaySpan)
                        )
                      : null;
                  const yDom = chartYDomain(points, chart.cumulative, overlay);
                  const avgLatest =
                    overlay && overlay.length > 0
                      ? overlay[overlay.length - 1]!.value
                      : null;
                  const cumulativeGrowthPct =
                    chart.cumulative && points.length > 0
                      ? cumulativePopGrowthPercent(points, rawLatestVal)
                      : null;
                  const prevPeriodVal =
                    !chart.cumulative && points.length >= 2
                      ? points[points.length - 2]!.value
                      : null;
                  const periodGrowthPct =
                    !chart.cumulative &&
                    prevPeriodVal != null &&
                    Number.isFinite(prevPeriodVal) &&
                    prevPeriodVal !== 0
                      ? ((rawLatestVal - prevPeriodVal) / Math.abs(prevPeriodVal)) * 100
                      : !chart.cumulative && prevPeriodVal === 0 && rawLatestVal !== 0
                        ? null
                        : !chart.cumulative && prevPeriodVal === 0 && rawLatestVal === 0
                          ? 0
                          : null;
                  const latestLabel = points.length ? points[points.length - 1]!.rawLabel : "";
                  const peak = peakPoint(points);

                  return (
                    <article key={chart.id} className="pa-graph pa-graph--pro">
                      <header className="pa-graph-head">
                        <div className="pa-graph-head-copy">
                          <h3 className="pa-graph-title" title={chart.description}>
                            {chart.title}
                          </h3>
                          <p className="pa-graph-unit">{chart.yAxisLabel}</p>
                        </div>
                          {points.length > 0 && (
                            <div className="pa-graph-tools">
                              <ProductivityViewToggle
                                mode={paView(chart.id)}
                                onChange={(m) => setPaView(chart.id, m)}
                                compact
                              />
                              <ProductivityExportButtons
                                viewMode={paView(chart.id)}
                                busy={exportBusyKey === `png-inline-${chart.id}`}
                                compact
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
                                className="pa-expand-chart-btn pa-expand-chart-btn--icon"
                                aria-label={`Open full screen for ${chart.title}. Same range and timeframe. Press Escape to close.`}
                                title={`Fullscreen: ${chart.title}`}
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
                              </button>
                            </div>
                          )}
                        </header>
                        {points.length > 0 && (
                          <div className="pa-graph-kpis" aria-label="Key metrics">
                            <div className="pa-graph-kpi">
                              <span className="pa-graph-kpi-label">
                                {chart.cumulative ? "Change" : "Latest"}
                              </span>
                              <div className="pa-graph-kpi-row">
                                <span className="pa-graph-kpi-value">
                                  {formatPillValue(rawLatestVal)}
                                </span>
                                {chart.cumulative && cumulativeGrowthPct != null ? (
                                  <span
                                    className={`pa-graph-kpi-delta ${
                                      cumulativeGrowthPct > 0
                                        ? "is-up"
                                        : cumulativeGrowthPct < 0
                                          ? "is-down"
                                          : "is-flat"
                                    }`}
                                  >
                                    {formatGrowthPercent(cumulativeGrowthPct)}
                                  </span>
                                ) : null}
                                {!chart.cumulative && periodGrowthPct != null ? (
                                  <span
                                    className={`pa-graph-kpi-delta ${
                                      periodGrowthPct > 0
                                        ? "is-up"
                                        : periodGrowthPct < 0
                                          ? "is-down"
                                          : "is-flat"
                                    }`}
                                  >
                                    {formatGrowthPercent(periodGrowthPct)}
                                  </span>
                                ) : null}
                              </div>
                              <span className="pa-graph-kpi-sub">
                                {latestLabel
                                  ? formatInsightPeakWhen(timeframe, latestLabel)
                                  : `This ${timeframeBestUnit(timeframe)}`}
                              </span>
                            </div>
                            <div className="pa-graph-kpi">
                              <span className="pa-graph-kpi-label">Peak</span>
                              <span className="pa-graph-kpi-value">
                                {formatPillValue(rawPeak)}
                              </span>
                              <span className="pa-graph-kpi-sub">
                                {peak?.rawLabel
                                  ? formatInsightPeakWhen(timeframe, peak.rawLabel)
                                  : "In range"}
                              </span>
                            </div>
                            {avgLatest !== null ? (
                              <div className="pa-graph-kpi">
                                <span className="pa-graph-kpi-label">Avg</span>
                                <span className="pa-graph-kpi-value">
                                  {formatPillValue(avgLatest)}
                                </span>
                                <span className="pa-graph-kpi-sub">
                                  Rolling · {timeframeBestUnit(timeframe)}
                                </span>
                              </div>
                            ) : (
                              <div className="pa-graph-kpi">
                                <span className="pa-graph-kpi-label">
                                  {timeframeBucketsLabel(timeframe)}
                                </span>
                                <span className="pa-graph-kpi-value">{points.length}</span>
                                <span className="pa-graph-kpi-sub">In view</span>
                              </div>
                            )}
                          </div>
                        )}

                      <div className="pa-graph-canvas">
                        {points.length === 0 ? (
                          <div className="muted small pa-no-data">No data for this timeframe.</div>
                        ) : (
                          (() => {
                            const vis = getSeriesVis(chart.id, Boolean(overlay));
                            return (
                          <>
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
                  <article key="tasksCompletedByProject" className="pa-graph pa-graph--pro">
                    <div className="pa-graph-body-top">
                      <div className="pa-graph-head">
                        <div className="pa-graph-head-copy">
                          <h3
                            className="pa-graph-title"
                            title="Completed tasks each period, split by project."
                          >
                            Tasks by project
                          </h3>
                          <p className="pa-graph-unit">Tasks · per period</p>
                        </div>
                          <div className="pa-graph-tools">
                        <ProductivityViewToggle
                          mode={paView("tasksCompletedByProject")}
                          onChange={(m) => setPaView("tasksCompletedByProject", m)}
                          compact
                        />
                        <ProductivityExportButtons
                          viewMode={paView("tasksCompletedByProject")}
                          busy={exportBusyKey === "png-inline-tasksCompletedByProject"}
                          compact
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
                          className="pa-expand-chart-btn pa-expand-chart-btn--icon"
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
                      <div className="pa-graph-kpis" aria-label="Project chart quick stats">
                        <div className="pa-graph-kpi">
                          <span className="pa-graph-kpi-label">Latest</span>
                          <span className="pa-graph-kpi-value">
                            {inlineProjectTotals.hasVisible
                              ? formatPillValue(inlineProjectTotals.latest)
                              : "—"}
                          </span>
                          <span className="pa-graph-kpi-sub">
                            {inlineProjectTotals.latestLabel
                              ? formatInsightPeakWhen(
                                  projectTimeframe,
                                  inlineProjectTotals.latestLabel
                                )
                              : "Visible projects"}
                          </span>
                        </div>
                        <div className="pa-graph-kpi">
                          <span className="pa-graph-kpi-label">Peak</span>
                          <span className="pa-graph-kpi-value">
                            {inlineProjectTotals.hasVisible
                              ? formatPillValue(inlineProjectTotals.peak)
                              : "—"}
                          </span>
                          <span className="pa-graph-kpi-sub">
                            {inlineProjectTotals.peakLabel
                              ? formatInsightPeakWhen(
                                  projectTimeframe,
                                  inlineProjectTotals.peakLabel
                                )
                              : "In range"}
                          </span>
                        </div>
                        <div className="pa-graph-kpi">
                          <span className="pa-graph-kpi-label">Series</span>
                          <span className="pa-graph-kpi-value">
                            {visibleProjectTaskSeriesIds.size}
                          </span>
                          <span className="pa-graph-kpi-sub">
                            {timeframeBucketsLabel(projectTimeframe)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="pa-graph-canvas">
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
                          yAxisLabel="Tasks"
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
                            yAxisLabel="Tasks"
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
                  <article key="xpGainedByProject" className="pa-graph pa-graph--pro">
                    <div className="pa-graph-body-top">
                      <div className="pa-graph-head">
                        <div className="pa-graph-head-copy">
                          <h3
                            className="pa-graph-title"
                            title="XP earned each period, split by project."
                          >
                            XP by project
                          </h3>
                          <p className="pa-graph-unit">XP · per period</p>
                        </div>
                          <div className="pa-graph-tools">
                        <ProductivityViewToggle
                          mode={paView("xpGainedByProject")}
                          onChange={(m) => setPaView("xpGainedByProject", m)}
                          compact
                        />
                        <ProductivityExportButtons
                          viewMode={paView("xpGainedByProject")}
                          busy={exportBusyKey === "png-inline-xpGainedByProject"}
                          compact
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
                          className="pa-expand-chart-btn pa-expand-chart-btn--icon"
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
                      <div className="pa-graph-kpis" aria-label="Project XP chart quick stats">
                        <div className="pa-graph-kpi">
                          <span className="pa-graph-kpi-label">Latest</span>
                          <span className="pa-graph-kpi-value">
                            {inlineProjectXpTotals.hasVisible
                              ? formatPillValue(inlineProjectXpTotals.latest)
                              : "—"}
                          </span>
                          <span className="pa-graph-kpi-sub">
                            {inlineProjectXpTotals.latestLabel
                              ? formatInsightPeakWhen(
                                  projectTimeframe,
                                  inlineProjectXpTotals.latestLabel
                                )
                              : "Visible projects"}
                          </span>
                        </div>
                        <div className="pa-graph-kpi">
                          <span className="pa-graph-kpi-label">Peak</span>
                          <span className="pa-graph-kpi-value">
                            {inlineProjectXpTotals.hasVisible
                              ? formatPillValue(inlineProjectXpTotals.peak)
                              : "—"}
                          </span>
                          <span className="pa-graph-kpi-sub">
                            {inlineProjectXpTotals.peakLabel
                              ? formatInsightPeakWhen(
                                  projectTimeframe,
                                  inlineProjectXpTotals.peakLabel
                                )
                              : "In range"}
                          </span>
                        </div>
                        <div className="pa-graph-kpi">
                          <span className="pa-graph-kpi-label">Series</span>
                          <span className="pa-graph-kpi-value">
                            {visibleProjectXpSeriesIds.size}
                          </span>
                          <span className="pa-graph-kpi-sub">
                            {timeframeBucketsLabel(projectTimeframe)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="pa-graph-canvas">
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
                          yAxisLabel="XP"
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
                            yAxisLabel="XP"
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
          className="pa-fs-chrome pa-fs-chrome--pro"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="pa-fs-header">
            <div className="pa-fs-header-main">
              <div className="pa-fs-header-line">
                <p className="pa-fs-eyebrow">
                  Analysis
                  {fsChartIndex >= 0 ? (
                    <span className="pa-fs-eyebrow-idx">
                      {" "}
                      · {fsChartIndex + 1}/{FS_ALL.length}
                    </span>
                  ) : null}
                </p>
                <h2 id="pa-fs-title" className="pa-fs-title">
                  {fsAnyChart.title}
                </h2>
                <p id="pa-fs-desc" className="pa-fs-desc">
                  {fsAnyChart.description}
                </p>
              </div>
            </div>
            <div className="pa-fs-actions">
              {!isBrowserFullscreen && (
                <button
                  type="button"
                  className="pa-fs-action-btn"
                  onClick={() => void requestPaChartBrowserFullscreen()}
                  title="Enter true browser full screen mode"
                >
                  Expand
                </button>
              )}
              <button
                ref={fsCloseBtnRef}
                type="button"
                className="pa-fs-close"
                onClick={closeFullscreenChart}
                title="Close fullscreen (Esc)"
                aria-label="Close fullscreen"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </header>

          <div className="pa-fs-range-bar">
            {rangeControlsEl}
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
              <div className="pa-fs-stage" key={fullscreenChartId ?? "none"}>
              {fsIsProject ? (fullscreenChartId === "xpGainedByProject" ? projectXpSeries : projectTasksSeries).length === 0 ? (
                <div className="muted pa-no-data pa-no-data-fs" role="alert">
                  No project breakdown data is available for this range.
                </div>
              ) : (
                <>
                  <div className="pa-fs-toolbar">
                    <div className="pa-fs-kpis" role="group" aria-label="Chart summary">
                      <div className="pa-fs-kpi">
                        <span className="pa-fs-kpi-label">Latest</span>
                        <span className="pa-fs-kpi-value">
                          {formatPillValue(fsProjectTotals.latest)}
                        </span>
                        <span className="pa-fs-kpi-sub">
                          {fsProjectTotals.latestLabel
                            ? formatInsightPeakWhen(
                                projectTimeframe,
                                fsProjectTotals.latestLabel
                              )
                            : "Visible projects"}
                        </span>
                      </div>
                      <div className="pa-fs-kpi">
                        <span className="pa-fs-kpi-label">Peak</span>
                        <span className="pa-fs-kpi-value pa-fs-kpi-value--peak">
                          {formatPillValue(fsProjectTotals.peak)}
                        </span>
                        <span className="pa-fs-kpi-sub">
                          {fsProjectTotals.peakLabel
                            ? formatInsightPeakWhen(
                                projectTimeframe,
                                fsProjectTotals.peakLabel
                              )
                            : "In range"}
                        </span>
                      </div>
                      <div className="pa-fs-kpi">
                        <span className="pa-fs-kpi-label">Series</span>
                        <span className="pa-fs-kpi-value">
                          {fullscreenChartId === "xpGainedByProject"
                            ? visibleProjectXpSeriesIds.size
                            : visibleProjectTaskSeriesIds.size}
                        </span>
                        <span className="pa-fs-kpi-sub">
                          {timeframeBucketsLabel(projectTimeframe)}
                        </span>
                      </div>
                    </div>
                    <div className="pa-fs-toolbar-actions">
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
                  </div>
                  <div className="pa-fs-canvas">
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
                          fullscreenChartId === "xpGainedByProject" ? "XP" : "Tasks"
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
                            fullscreenChartId === "xpGainedByProject" ? "XP" : "Tasks"
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
                  </div>
                </>
              ) : !fsChart ? (
                <div className="muted pa-no-data pa-no-data-fs" role="alert">
                  Full screen chart could not be shown (missing chart config). Close and try again.
                </div>
              ) : fsPoints.length === 0 ? (
                <div className="muted pa-no-data pa-no-data-fs">No data for this timeframe.</div>
              ) : (
                <>
                  <div className="pa-fs-toolbar">
                    <div className="pa-fs-kpis" role="group" aria-label="Chart summary">
                      <div className="pa-fs-kpi">
                        <span className="pa-fs-kpi-label">
                          {fsChart.cumulative ? "Change" : "Latest"}
                        </span>
                        <div className="pa-fs-kpi-row">
                          <span className="pa-fs-kpi-value">
                            {formatPillValue(fsLatestVal)}
                          </span>
                          {fsChart.cumulative && fsCumulativeGrowthPct != null ? (
                            <span
                              className={`pa-fs-kpi-delta ${
                                fsCumulativeGrowthPct > 0
                                  ? "is-up"
                                  : fsCumulativeGrowthPct < 0
                                    ? "is-down"
                                    : "is-flat"
                              }`}
                            >
                              {formatGrowthPercent(fsCumulativeGrowthPct)}
                            </span>
                          ) : null}
                        </div>
                        <span className="pa-fs-kpi-sub">
                          {fsLatestLabel
                            ? formatInsightPeakWhen(timeframe, fsLatestLabel)
                            : `This ${timeframeBestUnit(timeframe)}`}
                        </span>
                      </div>
                      <div className="pa-fs-kpi">
                        <span className="pa-fs-kpi-label">Peak</span>
                        <span className="pa-fs-kpi-value pa-fs-kpi-value--peak">
                          {formatPillValue(fsRawPeak)}
                        </span>
                        <span className="pa-fs-kpi-sub">
                          {fsPeak?.rawLabel
                            ? formatInsightPeakWhen(timeframe, fsPeak.rawLabel)
                            : "In range"}
                        </span>
                      </div>
                      {fsOverlayLatest !== null ? (
                        <div className="pa-fs-kpi">
                          <span className="pa-fs-kpi-label">Avg</span>
                          <span className="pa-fs-kpi-value">
                            {formatPillValue(fsOverlayLatest)}
                          </span>
                          <span className="pa-fs-kpi-sub">
                            Rolling · {timeframeBestUnit(timeframe)}
                          </span>
                        </div>
                      ) : (
                        <div className="pa-fs-kpi">
                          <span className="pa-fs-kpi-label">Prev</span>
                          <span className="pa-fs-kpi-value">
                            {fsPrevVal !== null ? formatPillValue(fsPrevVal) : "—"}
                          </span>
                          <span className="pa-fs-kpi-sub">
                            {fsPrevLabel
                              ? formatInsightPeakWhen(timeframe, fsPrevLabel)
                              : "Prior period"}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="pa-fs-toolbar-actions">
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
                  </div>
                  {(() => {
                    const vis = getSeriesVis(fsChart.id, Boolean(fsOverlay));
                    const isFsTable = Boolean(
                      fullscreenChartId && paView(fullscreenChartId) === "table"
                    );
                    return (
                      <div className="pa-fs-canvas">
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
                      </div>
                    );
                  })()}
                </>
              )}
              </div>
            </PaErrorBoundary>
            <nav
              className="pa-fs-chart-nav pa-fs-chart-nav--below-axis"
              aria-label="Switch productivity chart without leaving full screen"
            >
              <button
                type="button"
                className="pa-fs-chart-nav-btn pa-fs-chart-nav-btn--prev"
                onClick={() => fsPrevChart && setFullscreenChartId(fsPrevChart.id)}
                disabled={!fsPrevChart}
                title={fsPrevChart ? fsPrevChart.title : "First chart"}
                aria-label={
                  fsPrevChart
                    ? `Previous chart: ${fsPrevChart.title}`
                    : "No previous chart"
                }
              >
                <span className="pa-fs-chart-nav-btn-arrow" aria-hidden="true">
                  ←
                </span>
                <span className="pa-fs-chart-nav-btn-copy">
                  <span className="pa-fs-chart-nav-btn-text">Previous</span>
                  <span className="pa-fs-chart-nav-btn-sub">
                    {fsPrevChart ? fsPrevChart.title : "Start"}
                  </span>
                </span>
              </button>

              <div className="pa-fs-chart-nav-center">
                <div className="pa-fs-dots" aria-label="Jump to chart">
                  {FS_ALL.map((c, i) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`pa-fs-dot${i === fsChartIndex ? " is-active" : ""}`}
                      title={c.title}
                      aria-label={`${c.title} (${i + 1} of ${FS_ALL.length})`}
                      aria-current={i === fsChartIndex ? "true" : undefined}
                      onClick={() => setFullscreenChartId(c.id)}
                    />
                  ))}
                </div>
                <span className="pa-fs-chart-nav-counter">
                  {fsChartIndex + 1} / {FS_ALL.length}
                </span>
                <span className="pa-fs-chart-nav-keys-hint muted small">
                  <kbd className="pa-kbd">←</kbd>
                  <kbd className="pa-kbd">→</kbd>
                </span>
              </div>

              <button
                type="button"
                className="pa-fs-chart-nav-btn pa-fs-chart-nav-btn--next"
                onClick={() => fsNextChart && setFullscreenChartId(fsNextChart.id)}
                disabled={!fsNextChart}
                title={fsNextChart ? fsNextChart.title : "Last chart"}
                aria-label={
                  fsNextChart
                    ? `Next chart: ${fsNextChart.title}`
                    : "No next chart"
                }
              >
                <span className="pa-fs-chart-nav-btn-copy">
                  <span className="pa-fs-chart-nav-btn-text">Next</span>
                  <span className="pa-fs-chart-nav-btn-sub">
                    {fsNextChart ? fsNextChart.title : "End"}
                  </span>
                </span>
                <span className="pa-fs-chart-nav-btn-arrow" aria-hidden="true">
                  →
                </span>
              </button>
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
