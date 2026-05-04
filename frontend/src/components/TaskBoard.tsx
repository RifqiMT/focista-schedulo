import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TaskEditorDrawer } from "./TaskEditorDrawer";
import { apiFetch, apiUrl } from "../apiClient";
import { getFriendlyErrorMessage } from "../utils/friendlyError";

export interface Task {
  id: string;
  title: string;
  description?: string;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate?: string;
  dueTime?: string;
  durationMinutes?: number;
  deadlineDate?: string;
  deadlineTime?: string;
  repeat?:
    | "none"
    | "daily"
    | "weekly"
    | "weekdays"
    | "weekends"
    | "monthly"
    | "quarterly"
    | "yearly"
    | "custom";
  repeatEvery?: number;
  repeatUnit?: "day" | "week" | "month" | "quarter" | "year";
  labels: string[];
  location?: string;
  // Multi-link support: store always as an array of URL strings.
  link?: string[];
  reminderMinutesBefore?: number;
  profileId?: string | null;
  projectId: string | null;
  completed: boolean;
  cancelled?: boolean;
  virtual?: boolean;
  parentId?: string;
  childId?: string;
}

function hasProject(t: Pick<Task, "projectId">): boolean {
  return typeof t.projectId === "string" && t.projectId.trim() !== "";
}

function normalizeProjectAssociation(tasks: Task[]): Task[] {
  // Enforce invariant in the UI too: all tasks sharing a parentId share the same projectId.
  // Canonical projectId = first non-empty projectId seen for that parentId; otherwise null.
  const canonicalByParentId = new Map<string, string | null>();

  for (const t of tasks) {
    if (!t.parentId) continue;
    if (canonicalByParentId.has(t.parentId)) continue;
    canonicalByParentId.set(t.parentId, hasProject(t) ? t.projectId : null);
  }
  for (const t of tasks) {
    if (!t.parentId) continue;
    if (!hasProject(t)) continue;
    const existing = canonicalByParentId.get(t.parentId);
    if (!existing) canonicalByParentId.set(t.parentId, t.projectId);
  }

  let changed = false;
  const next = tasks.map((t) => {
    if (!t.parentId) return t;
    const canonical = canonicalByParentId.get(t.parentId);
    if (canonical === undefined) return t;
    const current = hasProject(t) ? t.projectId : null;
    if (current === canonical) return t;
    changed = true;
    return { ...t, projectId: canonical };
  });

  return changed ? next : tasks;
}

function clampHover(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Top-left of a fixed hovercard in viewport pixels, biased below/right of the pointer. */
function computeTaskHoverCardCoords(
  clientX: number,
  clientY: number,
  cardW: number,
  cardH: number,
  vw: number,
  vh: number
): { x: number; y: number } {
  const padding = 12;
  const offset = 12;
  const desiredX = clientX + offset;
  const desiredY = clientY + offset;
  const xRight = desiredX;
  const xLeft = clientX - cardW - offset;
  const yBelow = desiredY;
  const yAbove = clientY - cardH - offset;

  const canFitRight = vw - xRight >= cardW + padding;
  const canFitLeft = xLeft >= padding;

  const x = canFitRight
    ? clampHover(xRight, padding, vw - cardW - padding)
    : canFitLeft
      ? clampHover(xLeft, padding, vw - cardW - padding)
      : clampHover(desiredX, padding, vw - cardW - padding);

  const canFitBelow = vh - yBelow >= cardH + padding;
  const canFitAbove = yAbove >= padding;

  const y = canFitBelow
    ? clampHover(yBelow, padding, vh - cardH - padding)
    : canFitAbove
      ? clampHover(yAbove, padding, vh - cardH - padding)
      : clampHover(yBelow, padding, vh - cardH - padding);

  return { x, y };
}

/** True when the event is on controls inside a task/subtask card (no details hover for those). */
function isTaskCardInteractiveHoverTarget(ev: { target: EventTarget | null }): boolean {
  const el = ev.target as HTMLElement | null;
  if (!el?.closest) return false;
  const card = el.closest(".task-card");
  if (!card) return false;
  if (el.closest(".task-actions") || el.closest(".task-checkbox")) return true;
  const ctl = el.closest(
    "button, a[href], input:not([type='hidden']), select, textarea, [role='button']"
  );
  return Boolean(ctl && card.contains(ctl));
}

function isRepeating(task: Task): boolean {
  return !!task.repeat && task.repeat !== "none";
}

function seriesKeyForTask(task: Task): string {
  return [
    task.profileId ?? "",
    task.projectId ?? "",
    task.title,
    task.repeat ?? "none",
    String(task.repeatEvery ?? ""),
    String(task.repeatUnit ?? "")
  ].join("::");
}

// Returns the 1-based "Child ID" index for a repeating task, where the numbering
// is sequential by dueDate within the same parentId.
function completedChildIndex(task: Task, all: Task[]): number | null {
  if (!isRepeating(task)) return null;
  if (!task.parentId) return null;
  if (!task.dueDate) return null;

  const parent = task.parentId;
  const related = all
    .filter(
      (t) => isRepeating(t) && t.parentId === parent && !!t.dueDate && !t.cancelled
    )
    .slice()
    .sort((a, b) => {
      const d = (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
      if (d !== 0) return d;
      const tm = (a.dueTime ?? "").localeCompare(b.dueTime ?? "");
      if (tm !== 0) return tm;
      return a.id.localeCompare(b.id);
    });

  const idx = related.findIndex((t) => t.id === task.id);
  return idx === -1 ? null : idx + 1;
}

type TimeScope =
  | "all"
  | "yesterday"
  | "today"
  | "tomorrow"
  | "last_week"
  | "week"
  | "next_week"
  | "sprint"
  | "last_month"
  | "month"
  | "next_month"
  | "custom"
  | "last_quarter"
  | "quarter"
  | "next_quarter";

interface TaskBoardProps {
  activeProfileId: string | null;
  selectedProjectId: string | null;
  timeScope: TimeScope;
  onTimeScopeChange: (scope: TimeScope) => void;
}

function isJuly2026DueDate(dueDate: string | undefined): boolean {
  return /^2026-07-\d{2}$/.test((dueDate ?? "").trim());
}

function formatWithWeekday(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  return `${weekday}, ${dateStr}`;
}

function addMinutesLocal(startIsoDate: string, startTime: string, minutes: number): { endDate: string; endTime: string } | null {
  const start = new Date(`${startIsoDate}T${startTime}:00`);
  if (Number.isNaN(start.getTime())) return null;
  const endRaw = new Date(start.getTime() + Math.max(1, minutes) * 60_000);
  // Match calendar semantics: if the event ends exactly at midnight,
  // treat it as ending in the previous day.
  const end =
    endRaw.getHours() === 0 &&
    endRaw.getMinutes() === 0 &&
    endRaw.getSeconds() === 0 &&
    endRaw.getMilliseconds() === 0
      ? new Date(endRaw.getTime() - 1)
      : endRaw;
  // Keep end-date in the same local-day basis as the start/end timestamps.
  // Adding +12h here can incorrectly roll evening tasks into the next day.
  const endDate = toISODateLocal(end);
  const hh = String(end.getHours()).padStart(2, "0");
  const mm = String(end.getMinutes()).padStart(2, "0");
  return { endDate, endTime: `${hh}:${mm}` };
}

function getParentId(task: Task): string {
  return task.parentId ?? task.id;
}

function shortId(id: string): string {
  if (!id) return "";
  const safe = id.split("::")[0];
  return safe.length > 10 ? `${safe.slice(0, 6)}…${safe.slice(-3)}` : safe;
}

function stripDoubleColonSuffix(id: string | null | undefined): string {
  if (!id) return "";
  return id.split("::")[0];
}

function canonicalParentKey(task: Task): string {
  // Parent/series identity should ignore any virtual or disambiguation suffixes.
  // This prevents the list view from splitting occurrences across multiple groups.
  return stripDoubleColonSuffix(getParentId(task));
}

function parseLocationTokens(location: string | undefined | null): string[] {
  const raw = location?.trim() ?? "";
  if (!raw) return [];
  if (raw.includes("|")) {
    return raw.split("|").map((s) => s.trim()).filter(Boolean);
  }
  return [raw];
}

function parseLocationAliasToken(
  raw: string
): { query: string; label?: string } | null {
  const t = raw.trim();
  if (!t) return null;
  const idx = t.indexOf("=>");
  if (idx >= 0) {
    const labelRaw = t.slice(0, idx).trim();
    const queryRaw = t.slice(idx + 2).trim();
    if (!queryRaw) return null;
    const label = labelRaw ? labelRaw.replace(/\s+/g, " ") : undefined;
    return { query: queryRaw, label };
  }
  return { query: t };
}

function normalizeHyperlinkHref(raw: string | undefined | null): string | null {
  const t = raw?.trim();
  if (!t) return null;

  if (/^https?:\/\//i.test(t)) return t;

  if (/^www\./i.test(t)) return `https://${t}`;

  // If it looks like a domain (with an optional path/query), treat it as a URL.
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(t) && !/\s/.test(t)) {
    return `https://${t}`;
  }

  // Reject tokens containing whitespace (likely not a URL).
  if (/\s/.test(t)) return null;

  return `https://${t}`;
}

function parseLinkAliasToken(
  raw: string | undefined | null
): { href: string; label?: string } | null {
  const t = raw?.trim();
  if (!t) return null;

  // Accept multiple alias separators for UX:
  // - `Label=>https://...` (canonical stored format)
  // - `Label -> https://...`
  // - `Label | https://...`
  const m = t.match(/^\s*(.*?)\s*(=>|->|\|)\s*(\S.*?)\s*$/);
  const hrefRaw = m ? (m[3] ?? "").trim() : t;
  const labelRaw = m ? (m[1] ?? "").trim() : "";
  const href = normalizeHyperlinkHref(hrefRaw);
  if (!href) return null;
  const label = labelRaw ? labelRaw.replace(/\s+/g, " ") : undefined;
  return { href, label };
}

function shortLinkText(href: string): string {
  return href.replace(/^https?:\/\//i, "");
}

function toISODateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(base: Date, months: number): Date {
  const d = new Date(base.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) {
    d.setDate(0);
  }
  return d;
}

function formatDurationMinutesForOverview(minutes: number): string {
  const m = Math.round(minutes);
  if (!Number.isFinite(m) || m <= 0) return "—";

  const plural = (n: number, singular: string, pluralWord?: string) => {
    const p = pluralWord ?? `${singular}s`;
    return `${n} ${n === 1 ? singular : p}`;
  };

  const minutesPerHour = 60;
  const minutesPerDay = 1440;
  const minutesPerWeek = 7 * minutesPerDay; // 10080
  const minutesPerMonth = 30 * minutesPerDay; // UX-friendly "month" unit (no calendar context)

  const formatMinutesPart = (mins: number) => `${mins} mins`; // always "mins"

  // < 1 hour: show minutes only.
  if (m < minutesPerHour) return formatMinutesPart(m);

  // < 1 day: show hours + remainder minutes.
  if (m < minutesPerDay) {
    const hours = Math.floor(m / minutesPerHour);
    const remMins = m % minutesPerHour;
    if (remMins === 0) return plural(hours, "hour", "hours");
    return `${plural(hours, "hour", "hours")} & ${formatMinutesPart(remMins)}`;
  }

  const parts: string[] = [];

  // Month precedence: when >= 1 month, show months first.
  if (m >= minutesPerMonth) {
    const months = Math.floor(m / minutesPerMonth);
    parts.push(plural(months, "month", "months"));
  }

  let rem = m;
  if (m >= minutesPerMonth) {
    rem = rem % minutesPerMonth;
  }

  if (rem >= minutesPerWeek) {
    const weeks = Math.floor(rem / minutesPerWeek);
    parts.push(plural(weeks, "week", "weeks"));
    rem = rem % minutesPerWeek;
  }

  if (rem >= minutesPerDay) {
    const days = Math.floor(rem / minutesPerDay);
    parts.push(plural(days, "day", "days"));
    rem = rem % minutesPerDay;
  }

  if (rem >= minutesPerHour) {
    const hours = Math.floor(rem / minutesPerHour);
    rem = rem % minutesPerHour;
    if (hours > 0) parts.push(plural(hours, "hour", "hours"));
  }

  if (rem > 0) {
    parts.push(formatMinutesPart(rem));
  }

  return parts.join(" & ");
}

function nextOccurrenceDate(current: Date, task: Task): Date | null {
  const { repeat, repeatEvery, repeatUnit } = task;
  switch (repeat) {
    case "daily":
      return addDays(current, repeatEvery ?? 1);
    case "weekly":
      return addDays(current, 7 * (repeatEvery ?? 1));
    case "weekdays": {
      const d = new Date(current.getTime());
      do {
        d.setDate(d.getDate() + 1);
      } while (d.getDay() === 0 || d.getDay() === 6);
      return d;
    }
    case "weekends": {
      const d = new Date(current.getTime());
      do {
        d.setDate(d.getDate() + 1);
      } while (d.getDay() !== 0 && d.getDay() !== 6);
      return d;
    }
    case "monthly":
      return addMonths(current, repeatEvery ?? 1);
    case "quarterly":
      return addMonths(current, 3 * (repeatEvery ?? 1));
    case "yearly":
      return addMonths(current, 12 * (repeatEvery ?? 1));
    case "custom": {
      const every = repeatEvery ?? 1;
      // Match the editor/backend default for custom repeats.
      const unit = repeatUnit ?? "week";
      switch (unit) {
        case "day":
          return addDays(current, every);
        case "week":
          return addDays(current, every * 7);
        case "month":
          return addMonths(current, every);
        case "quarter":
          return addMonths(current, every * 3);
        case "year":
          return addMonths(current, every * 12);
      }
      return null;
    }
    default:
      return null;
  }
}

function expandRepeatingTasks(
  base: Task[],
  horizonEndIso?: string | null,
  horizonStartIso?: string | null
): Task[] {
  const result: Task[] = [...base];
  const today = new Date();
  // Generate occurrences only up to the visible calendar horizon (plus buffer).
  // This avoids expensive multi-year expansion on every refresh.
  const horizon = (() => {
    const raw = (horizonEndIso ?? "").trim();
    if (raw) {
      const d = new Date(raw + "T12:00:00");
      if (!Number.isNaN(d.getTime())) return d;
    }
    return addDays(today, 365); // safe fallback
  })();
  const horizonStart = (() => {
    const raw = (horizonStartIso ?? "").trim();
    if (raw) {
      const d = new Date(raw + "T12:00:00");
      if (!Number.isNaN(d.getTime())) return d;
    }
    return null;
  })();

  type SeriesKey = string;
  const seriesMap = new Map<SeriesKey, Task[]>();

  const seriesKeyFor = (t: Task) => {
    const repeat = t.repeat ?? "none";
    const repeatEveryKey = repeat === "custom" ? String(t.repeatEvery ?? 1) : String(t.repeatEvery ?? "");
    const repeatUnitKey = repeat === "custom" ? String(t.repeatUnit ?? "week") : String(t.repeatUnit ?? "");
    return [t.profileId ?? "", t.projectId ?? "", t.title, repeat, repeatEveryKey, repeatUnitKey].join("::");
  };

  const matchesSeries = (a: Task, b: Task) =>
    seriesKeyFor(a) === seriesKeyFor(b);

  for (const task of base) {
    if (!task.dueDate || !task.repeat || task.repeat === "none") continue;
    const key = seriesKeyFor(task);
    const arr = seriesMap.get(key) ?? [];
    arr.push(task);
    seriesMap.set(key, arr);
  }

  const yyyymmdd = `${today.getFullYear()}${String(
    today.getMonth() + 1
  ).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  const sortedSeriesKeys = Array.from(seriesMap.keys()).sort((a, b) =>
    a.localeCompare(b)
  );

  // Allocate series parent ids only when a series is missing them.
  const usedParentIds = new Set(
    base.map((t) => t.parentId).filter((v): v is string => !!v)
  );
  const seriesToParentId = new Map<SeriesKey, string>();
  let counter = 1;

  for (const key of sortedSeriesKeys) {
    const tasksInSeries = seriesMap.get(key) ?? [];
    const existing = tasksInSeries.find((t) => !!t.parentId)?.parentId;
    if (existing) {
      seriesToParentId.set(key, existing);
      continue;
    }

    let candidate = `${yyyymmdd}-${counter}`;
    while (usedParentIds.has(candidate)) {
      counter += 1;
      candidate = `${yyyymmdd}-${counter}`;
    }
    usedParentIds.add(candidate);
    seriesToParentId.set(key, candidate);
    counter += 1;
  }

  // Normalize ids for existing tasks in each series:
  // - parentId: stable per series (reuse if already present)
  // - childId: stable per occurrence index (only assign if missing)
  for (const [key, tasksInSeries] of seriesMap.entries()) {
    const pid = seriesToParentId.get(key);
    if (!pid) continue;

    const sortedByDue = tasksInSeries
      .slice()
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

    sortedByDue.forEach((t, idx) => {
      const ri = result.findIndex((r) => r.id === t.id);
      if (ri === -1) return;

      const currentTask = result[ri];
      const finalParentId = currentTask.parentId ?? pid;
      const desiredChildId = `${finalParentId}-${idx + 1}`;

      result[ri] = {
        ...currentTask,
        parentId: finalParentId,
        childId: currentTask.childId ?? desiredChildId
      };
    });
  }

  // Generate a full horizon of upcoming virtual occurrences per series so
  // future months in the calendar show all recurring tasks.
  for (const [key, tasksInSeries] of seriesMap.entries()) {
    const pid = seriesToParentId.get(key);
    if (!pid) continue;

    const withDates = tasksInSeries.filter((t) => t.dueDate);
    if (withDates.length === 0) continue;

    const sortedByDue = withDates
      .slice()
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

    // Use the earliest known occurrence as the starting point so we can
    // fill any gaps between real occurrences (important for custom repeats).
    const template = sortedByDue[0];
    if (!template.dueDate) continue;

    let current = new Date(template.dueDate + "T12:00:00");
    // Index within the full repeating sequence (1-based) starting from the earliest.
    let occurrenceIndex = 1;

    // Optimization (list view): if we only care about occurrences from horizonStart onward,
    // fast-forward close to that date so we don't walk from an early historical template.
    if (horizonStart && current < horizonStart) {
      const diffDays = Math.floor((horizonStart.getTime() - current.getTime()) / (24 * 60 * 60 * 1000));
      const repeat = template.repeat ?? "none";
      const every = template.repeat === "custom" ? template.repeatEvery ?? 1 : template.repeatEvery ?? 1;
      const unit = template.repeat === "custom" ? template.repeatUnit ?? "week" : null;

      const jumpByDays = (stepDays: number) => {
        if (stepDays <= 0) return;
        const steps = Math.max(0, Math.floor(diffDays / stepDays));
        if (steps <= 0) return;
        current = addDays(current, steps * stepDays);
        occurrenceIndex += steps;
      };

      const jumpByMonths = (stepMonths: number) => {
        if (stepMonths <= 0) return;
        const startYM = current.getFullYear() * 12 + current.getMonth();
        const targetYM = horizonStart.getFullYear() * 12 + horizonStart.getMonth();
        const diffM = targetYM - startYM;
        const steps = Math.max(0, Math.floor(diffM / stepMonths));
        if (steps <= 0) return;
        current = addMonths(current, steps * stepMonths);
        occurrenceIndex += steps;
      };

      if (repeat === "daily") jumpByDays(every);
      else if (repeat === "weekly") jumpByDays(7 * every);
      else if (repeat === "monthly") jumpByMonths(every);
      else if (repeat === "quarterly") jumpByMonths(3 * every);
      else if (repeat === "yearly") jumpByMonths(12 * every);
      else if (repeat === "custom") {
        if (unit === "day") jumpByDays(every);
        else if (unit === "week") jumpByDays(7 * every);
        else if (unit === "month") jumpByMonths(every);
        else if (unit === "quarter") jumpByMonths(3 * every);
        else if (unit === "year") jumpByMonths(12 * every);
      }
      // For weekdays/weekends, we fall back to the loop below (date math isn't constant-step).
    }

    // Walk forward, generating occurrences until the horizon.
    for (;;) {
      const next = nextOccurrenceDate(current, template);
      if (!next || next > horizon) break;

      const iso = toISODateLocal(next);
      occurrenceIndex += 1;

      if (horizonStart && next < horizonStart) {
        current = next;
        continue;
      }

      // Skip if a real task already exists on this date for this series.
      const realExistsOnDate = base.some(
        (other) =>
          other.dueDate === iso &&
          // Canonical match first, then a tolerant fallback:
          // if a persisted occurrence exists on the same day with same title/profile,
          // do not synthesize another virtual "active" row.
          (matchesSeries(other, template) ||
            ((other.title ?? "").trim().toLowerCase() ===
              (template.title ?? "").trim().toLowerCase() &&
              (other.profileId ?? null) === (template.profileId ?? null))) &&
          !other.cancelled
      );

      if (!realExistsOnDate) {
        const forceCompleted = isJuly2026DueDate(iso);
        result.push({
          ...template,
          id: `${template.id}::${iso}`,
          dueDate: iso,
          completed: forceCompleted,
          completedAt: forceCompleted ? `${iso}T12:00:00.000Z` : undefined,
          virtual: true,
          parentId: pid,
          childId: `${pid}-${occurrenceIndex}`
        });
      }

      current = next;
    }

    // Re-sequence parent/child ids across real + virtual occurrences so
    // numbering starts from 1 and increments by dueDate order for this series.
    const seriesTasksInResult = result
      .filter((t) => {
        if (!t.dueDate) return false;
        if (!isRepeating(t)) return false;
        return seriesKeyFor(t) === key;
      })
      .slice()
      .sort((a, b) => {
        const d = (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
        if (d !== 0) return d;
        const tm = (a.dueTime ?? "").localeCompare(b.dueTime ?? "");
        if (tm !== 0) return tm;
        return a.id.localeCompare(b.id);
      });

    seriesTasksInResult.forEach((t, idx) => {
      const ri = result.findIndex((r) => r.id === t.id);
      if (ri === -1) return;
      result[ri] = {
        ...result[ri],
        parentId: pid,
        childId: `${pid}-${idx + 1}`
      };
    });
  }

  const deduped = new Map<string, Task>();
  for (const task of result) {
    const key =
      isRepeating(task) && task.dueDate
        ? `series::${seriesKeyFor(task)}::${task.dueDate}`
        : `single::${task.id}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, task);
      continue;
    }
    // Prefer persisted tasks over virtual placeholders for the same occurrence.
    if (existing.virtual && !task.virtual) {
      deduped.set(key, task);
      continue;
    }
    if (!!existing.virtual === !!task.virtual && task.id.localeCompare(existing.id) > 0) {
      deduped.set(key, task);
    }
  }
  return Array.from(deduped.values());
}

function collapseSeriesForList(tasks: Task[], rangeStartIso: string, rangeEndIso: string): Task[] {
  const nonRecurring = tasks.filter((t) => !t.repeat || t.repeat === "none");
  const recurring = tasks.filter(
    (t) => t.repeat && t.repeat !== "none" && !!t.dueDate && !t.cancelled
  );

  type SeriesKey = string;
  const seriesKeyFor = (t: Task): SeriesKey => {
    const repeat = t.repeat ?? "none";
    const repeatEveryKey = repeat === "custom" ? String(t.repeatEvery ?? 1) : String(t.repeatEvery ?? "");
    const repeatUnitKey = repeat === "custom" ? String(t.repeatUnit ?? "week") : String(t.repeatUnit ?? "");
    return [t.profileId ?? "", t.projectId ?? "", t.title, repeat, repeatEveryKey, repeatUnitKey].join("::");
  };

  const seriesMap = new Map<SeriesKey, Task[]>();
  for (const t of recurring) {
    const key = seriesKeyFor(t);
    const arr = seriesMap.get(key) ?? [];
    arr.push(t);
    seriesMap.set(key, arr);
  }

  const upcomingPerSeries: Task[] = [];

  for (const [, seriesTasks] of seriesMap.entries()) {
    const inWindow = seriesTasks
      .filter((t) => {
        const iso = t.dueDate ?? "";
        if (!iso) return false;
        return iso >= rangeStartIso && iso <= rangeEndIso;
      })
      .slice()
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

    if (inWindow.length === 0) continue;

    // Prefer an active (not completed) occurrence within the window; otherwise
    // fall back to the first occurrence in the window (e.g., when viewing Completed or All).
    const firstActive = inWindow.find((t) => !t.completed && !t.cancelled) ?? inWindow[0]!;
    upcomingPerSeries.push(firstActive);
  }

  return [...nonRecurring, ...upcomingPerSeries];
}

export function TaskBoard({
  activeProfileId,
  selectedProjectId,
  timeScope,
  onTimeScopeChange
}: TaskBoardProps) {
  const PERF_DEBUG_PROFILE_NAME = "Rifqi Tjahyono";
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editingTask, setEditingTask] = useState<Task | Task[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [completionFilter, setCompletionFilter] = useState<"all" | "active" | "completed">("all");
  const [projectAssocFilter, setProjectAssocFilter] = useState<"all" | "with" | "none">("all");
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [moveDialogTasks, setMoveDialogTasks] = useState<Task[] | null>(null);
  const [moveDialogProjectId, setMoveDialogProjectId] = useState<string | null>("same");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"json" | "csv" | "both">("json");
  const [exportProfiles, setExportProfiles] = useState<
    Array<{ id: string; name: string; isPasswordProtected: boolean }>
  >([]);
  const [exportIncludeLockedProfiles, setExportIncludeLockedProfiles] = useState(false);
  const [exportProfilePasswords, setExportProfilePasswords] = useState<Record<string, string>>({});
  const [showExportProfilePasswords, setShowExportProfilePasswords] = useState<Record<string, boolean>>({});
  const [exportPreparing, setExportPreparing] = useState(false);
  const [openCluster, setOpenCluster] = useState<"timeframe" | "view" | "status" | null>(null);
  const [hoveredTask, setHoveredTask] = useState<{
    task: Task;
    anchorIso: string | null;
    isAllDay: boolean;
    startMin: number | null;
    endMin: number | null;
    pointerX: number;
    pointerY: number;
    x: number;
    y: number;
  } | null>(null);
  const projectsFetchInFlight = useRef(false);
  const tasksFetchInFlight = useRef(false);
  const latestTasksRequestRef = useRef(0);
  const latestProjectsRequestRef = useRef(0);
  const tasksAbortRef = useRef<AbortController | null>(null);
  const projectsAbortRef = useRef<AbortController | null>(null);
  const virtualMaterializeInFlightRef = useRef<Map<string, Promise<Task | null>>>(new Map());
  const taskMutationInFlightRef = useRef<Set<string>>(new Set());
  const bgRefreshTimerRef = useRef<number | null>(null);
  const lastTasksLoadedToastAtRef = useRef(0);
  const taskHoverCardRef = useRef<HTMLDivElement | null>(null);
  const hoverAutoCloseTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null
  );
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [calendarMonthAnchor, setCalendarMonthAnchor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(12, 0, 0, 0);
    return d;
  });
  const [selectedCalendarDayIso, setSelectedCalendarDayIso] = useState<string | null>(null);
  const [dayAgendaOpen, setDayAgendaOpen] = useState(false);
  const [taskSearchQuery, setTaskSearchQuery] = useState("");
  const [historyNextOffset, setHistoryNextOffset] = useState<number | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyJumpDate, setHistoryJumpDate] = useState("");
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null);
  const [perfDebugEnabled, setPerfDebugEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("pst.perfDebug.rifqi") === "1";
  });
  const hoveredTaskId = hoveredTask?.task.id;
  const canUsePerfDebug = activeProfileName === PERF_DEBUG_PROFILE_NAME;
  const isShowcaseReadOnlyActive = activeProfileName?.trim().toLowerCase() === "test";

  const activeBaseTasks = useMemo(() => tasks.filter((t) => !t.cancelled), [tasks]);

  const calendarHorizonIso = useMemo(() => {
    // Expand repeats only a bit past the visible month for smooth navigation.
    const end = new Date(calendarMonthAnchor.getTime());
    end.setMonth(end.getMonth() + 4);
    end.setDate(1);
    end.setHours(12, 0, 0, 0);
    const y = end.getFullYear();
    const m = String(end.getMonth() + 1).padStart(2, "0");
    const d = String(end.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, [calendarMonthAnchor]);

  // If hovercard is closed, cancel any pending auto-close.
  useEffect(() => {
    if (hoveredTask) return;
    if (hoverAutoCloseTimerRef.current) {
      window.clearTimeout(hoverAutoCloseTimerRef.current);
      hoverAutoCloseTimerRef.current = null;
    }
  }, [hoveredTaskId]);

  type ClusterKey = "timeframe" | "view" | "status" | "project-assoc";

  const closeHoverAndCompletedDetails = () => {
    setHoveredTask(null);
    setExpandedGroups(new Set());
  };

  const closeDropdownAndHover = () => {
    setOpenCluster(null);
    setHoveredTask(null);
  };

  const openExclusiveCluster = (cluster: ClusterKey) => {
    // Enforce: only one popup/dropdown should be visible at a time.
    setOpenCluster(cluster);
    closeHoverAndCompletedDetails();
  };

  const toggleExclusiveCluster = (cluster: ClusterKey) => {
    const next = openCluster === cluster ? null : cluster;
    setOpenCluster(next);
    if (next) closeHoverAndCompletedDetails();
  };

  const openEditor = (task: Task) => {
    // Enforce single popup/dropdown: close dropdown menus & hovercards when editor opens.
    setOpenCluster(null);
    closeHoverAndCompletedDetails();
    setEditingTask(task);
  };

  const openMultiEditor = (tasksToEdit: Task[]) => {
    setOpenCluster(null);
    closeHoverAndCompletedDetails();
    const compareDueDateDesc = (a: Task, b: Task) => {
      // Match list/table sorting: missing dueDate goes last, otherwise ISO desc.
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return b.dueDate.localeCompare(a.dueDate);
    };
    const sorted = tasksToEdit.slice().sort(compareDueDateDesc);
    setEditingTask(sorted);
  };

  const toggleSingleExpandedGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set<string>();
      if (prev.has(key)) return next; // toggle off
      next.add(key); // toggle on, while closing other groups
      return next;
    });
  };

  const notifyTasksChanged = (source: "local" | "external" = "local") => {
    if (typeof window !== "undefined" && "dispatchEvent" in window) {
      window.dispatchEvent(new CustomEvent("pst:tasks-changed", { detail: { source } }));
    }
  };

  const toast = (opts: {
    kind: "success" | "error" | "info";
    title: string;
    message?: string;
    durationMs?: number;
  }) => {
    if (typeof window === "undefined" || !("dispatchEvent" in window)) return;
    window.dispatchEvent(new CustomEvent("pst:toast", { detail: opts }));
  };

  const notifyShowcaseReadOnly = () => {
    toast({
      kind: "info",
      title: "Showcase mode",
      message: 'Profile "Test" is read-only. Task create, edit, complete, move, and delete are disabled.'
    });
  };

  const logSlowAction = (action: string, started: number) => {
    if (!canUsePerfDebug || !perfDebugEnabled) return;
    const elapsed = performance.now() - started;
    if (elapsed < 1000) return;
    console.info(`[perf][TaskBoard] ${action} took ${elapsed.toFixed(1)}ms`);
  };

  useEffect(() => {
    if (!activeProfileId) {
      setActiveProfileName(null);
      return;
    }
    const controller = new AbortController();
    const run = async () => {
      try {
        const res = await apiFetch("/api/profiles", { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as Array<{ id: string; name: string }>;
        const active = data.find((p) => p.id === activeProfileId);
        setActiveProfileName(active?.name ?? null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    };
    void run();
    return () => controller.abort();
  }, [activeProfileId]);

  useEffect(() => {
    if (canUsePerfDebug) return;
    if (perfDebugEnabled) setPerfDebugEnabled(false);
  }, [canUsePerfDebug, perfDebugEnabled]);

  useEffect(() => {
    const onOpenExport = () => {
      // Export is a modal popup; close other UI popups/dropdowns.
      setExportDialogOpen(true);
      setOpenCluster(null);
      closeHoverAndCompletedDetails();
    };
    window.addEventListener("pst:open-export", onOpenExport);
    return () => window.removeEventListener("pst:open-export", onOpenExport);
  }, []);

  useEffect(() => {
    if (!openCluster) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenCluster(null);
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".task-cluster")) return;
      setOpenCluster(null);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, { capture: true } as any);
    };
  }, [openCluster]);

  // Close the hover popup (task-hovercard) on outside click so it doesn't linger
  // when the cursor moves away and the user clicks elsewhere.
  useEffect(() => {
    if (!hoveredTask) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Keep open if the click is inside the hovercard or the task element that triggers it.
      if (target.closest(".task-hovercard")) return;
      if (target.closest(".task-card")) return;
      if (target.closest(".calendar-item")) return;
      if (target.closest(".calendar-day")) return;
      if (target.closest(".day-agenda")) return;

      setHoveredTask(null);
    };

    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, { capture: true } as any);
    };
  }, [hoveredTask]);

  // If DOM refresh prevents `onMouseLeave` from firing, auto-close hovercard
  // when the pointer moves away from both the card and the hovercard.
  useEffect(() => {
    if (!hoveredTask) return;

    const onPointerMove = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      if (target.closest(".task-hovercard")) {
        if (hoverAutoCloseTimerRef.current) {
          window.clearTimeout(hoverAutoCloseTimerRef.current);
          hoverAutoCloseTimerRef.current = null;
        }
        return;
      }

      const closestTaskish = target.closest<HTMLElement>(
        ".task-card[data-task-id], .calendar-item[data-task-id], .day-agenda-chip[data-task-id], .day-agenda-event[data-task-id]"
      );

      // If pointer is over a different task than the one currently shown,
      // close immediately so the next task's hover can take over.
      if (closestTaskish) {
        const tid = closestTaskish.dataset.taskId;
        if (tid && tid !== hoveredTaskId) {
          if (hoverAutoCloseTimerRef.current) {
            window.clearTimeout(hoverAutoCloseTimerRef.current);
            hoverAutoCloseTimerRef.current = null;
          }
          setHoveredTask(null);
          return;
        }

        // Pointer is still over the same task (or missing tid): keep open.
        if (hoverAutoCloseTimerRef.current) {
          window.clearTimeout(hoverAutoCloseTimerRef.current);
          hoverAutoCloseTimerRef.current = null;
        }
        return;
      }

      const isInsideInteractive =
        !!target.closest(".calendar-day") ||
        !!target.closest(".day-agenda") ||
        !!target.closest(".day-agenda-event") ||
        !!target.closest(".day-agenda-chip");

      // If pointer is still inside, cancel pending auto-close.
      if (isInsideInteractive) {
        if (hoverAutoCloseTimerRef.current) {
          window.clearTimeout(hoverAutoCloseTimerRef.current);
          hoverAutoCloseTimerRef.current = null;
        }
        return;
      }

      // Otherwise, close after a short grace period. This prevents flicker
      // during normal movement from the card to the hovercard.
      if (hoverAutoCloseTimerRef.current) {
        window.clearTimeout(hoverAutoCloseTimerRef.current);
      }
      hoverAutoCloseTimerRef.current = window.setTimeout(() => {
        setHoveredTask(null);
        hoverAutoCloseTimerRef.current = null;
      }, 120);
    };

    const closeNow = () => {
      if (hoverAutoCloseTimerRef.current) {
        window.clearTimeout(hoverAutoCloseTimerRef.current);
        hoverAutoCloseTimerRef.current = null;
      }
      setHoveredTask(null);
    };

    // Extra safety: close when the pointer leaves the document/window or when the user scrolls
    // without moving the pointer (pointermove won't fire in that case).
    const onScroll = () => closeNow();
    const onWindowBlur = () => closeNow();
    const onDocLeave = (e: MouseEvent) => {
      // When leaving the document, relatedTarget is often null.
      if ((e.relatedTarget as any) == null) closeNow();
    };

    window.addEventListener("pointermove", onPointerMove, { capture: true });
    window.addEventListener("scroll", onScroll, { capture: true, passive: true } as any);
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("mouseleave", onDocLeave, { capture: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove, { capture: true } as any);
      window.removeEventListener("scroll", onScroll, { capture: true } as any);
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("mouseleave", onDocLeave, { capture: true } as any);
    };
  }, [hoveredTaskId]);

  useLayoutEffect(() => {
    if (!hoveredTask) return;
    const el = taskHoverCardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 32 || h < 32) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { x: nx, y: ny } = computeTaskHoverCardCoords(
      hoveredTask.pointerX,
      hoveredTask.pointerY,
      w,
      h,
      vw,
      vh
    );

    setHoveredTask((prev) => {
      if (!prev) return prev;
      if (Math.abs(prev.x - nx) < 0.5 && Math.abs(prev.y - ny) < 0.5) return prev;
      return { ...prev, x: nx, y: ny };
    });
  }, [hoveredTask]);

  // Close the "completed group details" expanded section on outside click.
  useEffect(() => {
    if (expandedGroups.size === 0) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Keep open when clicking inside the details region or its toggle button.
      if (target.closest(".completed-group-details")) return;
      if (target.closest(".task-action-button")) return;

      setExpandedGroups(new Set());
    };

    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, { capture: true } as any);
    };
  }, [expandedGroups.size]);

  const refreshTasks = async (opts?: { silent?: boolean; appendHistory?: boolean; jumpToDate?: string }) => {
    const requestId = ++latestTasksRequestRef.current;
    tasksAbortRef.current?.abort();
    const controller = new AbortController();
    tasksAbortRef.current = controller;
    tasksFetchInFlight.current = true;
    if (!opts?.silent) setLoading(true);
    const started = performance.now();
    try {
      const requestedProfileId = activeProfileId ?? null;
      const requestedProjectId = selectedProjectId ?? null;
      const base = new URL(apiUrl("/api/tasks"));
      if (requestedProfileId) {
        base.searchParams.set("profileId", requestedProfileId);
      }
      if (requestedProjectId) {
        base.searchParams.set("projectId", requestedProjectId);
      }
      const paginateAllHistory = timeScope === "all";

      // Fetch window:
      // - "All" should truly include historical tasks, so do not apply `since`.
      // - For other timeframes, bound the fetch to the current range start (keeps large datasets snappy).
      // Note: `customRange*` states are declared later in this file, so referencing them here
      // would trigger TDZ at runtime. For custom scopes we fetch unbounded and rely on client
      // filtering (still correct, and avoids blank-page crashes).
      if (timeScope !== "all" && timeScope !== "custom") {
        // `listRangeStartIso` is defined below this function, so we inline the same mapping here.
        const sinceIso = (() => {
          if (timeScope === "yesterday") return yesterdayIso;
          if (timeScope === "today") return todayIso;
          if (timeScope === "tomorrow") return tomorrowIso;
          if (timeScope === "last_week") return lastWeekStartIso;
          if (timeScope === "week") return startOfWeekMondayIso;
          if (timeScope === "next_week") return nextWeekStartIso;
          if (timeScope === "sprint") return startOfWeekMondayIso;
          if (timeScope === "last_month") return lastMonthStartIso;
          if (timeScope === "month") return thisMonthStartIso;
          if (timeScope === "next_month") return nextMonthStartIso;
          if (timeScope === "last_quarter") return lastQuarterStartIso;
          if (timeScope === "quarter") return thisQuarterStartIso;
          if (timeScope === "next_quarter") return nextQuarterStartIso;
          // Fallback: last 90 days from today for any unexpected scope.
          const d = new Date(todayIso + "T12:00:00");
          d.setDate(d.getDate() - 90);
          return toISODateLocal(d);
        })();
        base.searchParams.set("since", sinceIso);
      }

      if (paginateAllHistory) {
        const PAGE_SIZE = 900;
        base.searchParams.set("paginate", "1");
        base.searchParams.set("limit", String(PAGE_SIZE));
        const startOffset = opts?.appendHistory ? historyNextOffset ?? 0 : 0;
        base.searchParams.set("offset", String(startOffset));
        if (!opts?.appendHistory && opts?.jumpToDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.jumpToDate)) {
          base.searchParams.set("jumpToDate", opts.jumpToDate);
        }
      }

      const res = await apiFetch(`${base.pathname}${base.search}`, { signal: controller.signal });
      const elapsed = performance.now() - started;
      if (!res.ok) {
        const message = await getFriendlyErrorMessage(res);
        toast({
          kind: "error",
          title: "Task list load failed",
          message,
          durationMs: elapsed
        });
        return;
      }
      const payload = await res.json();
      if (requestId !== latestTasksRequestRef.current) return;
      const data: Task[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : [];
      const scoped = data
        .map((t) =>
          isJuly2026DueDate(t.dueDate)
            ? {
                ...t,
                completed: true,
                completedAt: t.completedAt ?? `${t.dueDate}T12:00:00.000Z`
              }
            : t
        )
        .filter((t) =>
          requestedProfileId ? (t.profileId ?? null) === requestedProfileId : true
        );
      if (timeScope === "all" && !Array.isArray(payload)) {
        const normalized = normalizeProjectAssociation(scoped);
        if (opts?.appendHistory) {
          setTasks((prev) => {
            const dedupeKey = (task: Task) =>
              isRepeating(task)
                ? `series::${seriesKeyForTask(task)}::${task.dueDate ?? ""}`
                : `single::${(task.profileId ?? "").trim().toLowerCase()}::${(task.projectId ?? "")
                    .trim()
                    .toLowerCase()}::${task.title.trim().toLowerCase()}::${
                    task.description?.trim().toLowerCase() ?? ""
                  }::${task.dueDate ?? ""}::${task.dueTime ?? ""}::${task.priority}::${
                    task.completed ? 1 : 0
                  }::${task.cancelled ? 1 : 0}`;
            const seen = new Set(prev.map((t) => dedupeKey(t)));
            const merged = prev.slice();
            for (const t of normalized) {
              const key = dedupeKey(t);
              if (!seen.has(key)) {
                merged.push(t);
                seen.add(key);
              }
            }
            return merged;
          });
        } else {
          setTasks(normalizeProjectAssociation(scoped));
        }
        setHistoryHasMore(Boolean(payload?.hasMore));
        setHistoryNextOffset(
          typeof payload?.nextOffset === "number" ? payload.nextOffset : null
        );
      } else {
        setTasks(normalizeProjectAssociation(scoped));
        if (!opts?.appendHistory) {
          setHistoryHasMore(false);
          setHistoryNextOffset(null);
        }
      }
      // Avoid noisy "loaded" toasts during background/silent refresh loops.
      // Show only for user-visible loads, slow responses, and with a cooldown.
      const now = Date.now();
      const canShowLoadedToast =
        !opts?.silent &&
        elapsed >= 1500 &&
        now - lastTasksLoadedToastAtRef.current >= 8000;
      if (canShowLoadedToast) {
        lastTasksLoadedToastAtRef.current = now;
        toast({
          kind: "info",
          title: "Task list loaded",
          message: `${data.length} task(s).`,
          durationMs: elapsed
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      // ignore
    } finally {
      if (requestId === latestTasksRequestRef.current) {
        tasksFetchInFlight.current = false;
        if (opts?.appendHistory) setHistoryLoadingMore(false);
        if (!opts?.silent) setLoading(false);
      }
    }
  };

  useEffect(() => {
    setHistoryHasMore(false);
    setHistoryNextOffset(null);
    setHistoryLoadingMore(false);
    void refreshTasks();
  }, [activeProfileId, selectedProjectId, timeScope]);

  useEffect(() => {
    const onTasksChanged = (e: Event) => {
      const ce = e as CustomEvent | null;
      const source = ce?.detail?.source;
      if (source === "local") {
        // UI already updated optimistically; avoid blocking the app with a full refetch/loading state.
        // Still do a gentle background refresh to reconcile any backend-side normalization.
        if (bgRefreshTimerRef.current) window.clearTimeout(bgRefreshTimerRef.current);
        bgRefreshTimerRef.current = window.setTimeout(() => {
          bgRefreshTimerRef.current = null;
          void refreshTasks({ silent: true });
        }, 900);
        return;
      }
      void refreshTasks();
    };
    window.addEventListener("pst:tasks-changed", onTasksChanged);
    return () => {
      window.removeEventListener("pst:tasks-changed", onTasksChanged);
      if (bgRefreshTimerRef.current) {
        window.clearTimeout(bgRefreshTimerRef.current);
        bgRefreshTimerRef.current = null;
      }
    };
  }, [activeProfileId, selectedProjectId, timeScope]);

  useEffect(() => {
    const requestId = ++latestProjectsRequestRef.current;
    projectsAbortRef.current?.abort();
    const controller = new AbortController();
    projectsAbortRef.current = controller;
    async function loadProjects() {
      try {
        const requestedProfileId = activeProfileId ?? null;
        const base = new URL(apiUrl("/api/projects"));
        if (requestedProfileId) base.searchParams.set("profileId", requestedProfileId);
        const res = await apiFetch(`${base.pathname}${base.search}`, { signal: controller.signal });
        if (!res.ok) return;
        const data: { id: string; name: string }[] = await res.json();
        if (requestId !== latestProjectsRequestRef.current) return;
        setProjects(data);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // ignore
      }
    }
    loadProjects();
    return () => controller.abort();
  }, [activeProfileId]);

  const refreshProjects = async () => {
    const requestId = ++latestProjectsRequestRef.current;
    projectsAbortRef.current?.abort();
    const controller = new AbortController();
    projectsAbortRef.current = controller;
    projectsFetchInFlight.current = true;
    const started = performance.now();
    try {
      const requestedProfileId = activeProfileId ?? null;
      const base = new URL(apiUrl("/api/projects"));
      if (requestedProfileId) base.searchParams.set("profileId", requestedProfileId);
      const res = await apiFetch(`${base.pathname}${base.search}`, { signal: controller.signal });
      const elapsed = performance.now() - started;
      if (!res.ok) {
        const message = await getFriendlyErrorMessage(res);
        toast({
          kind: "error",
          title: "Projects load failed",
          message,
          durationMs: elapsed
        });
        return;
      }
      const data: { id: string; name: string }[] = await res.json();
      if (requestId !== latestProjectsRequestRef.current) return;
      setProjects(data);
      if (elapsed >= 900) {
        toast({
          kind: "info",
          title: "Projects loaded",
          message: `${data.length} project(s).`,
          durationMs: elapsed
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      // ignore
    } finally {
      if (requestId === latestProjectsRequestRef.current) {
        projectsFetchInFlight.current = false;
      }
    }
  };

  useEffect(() => {
    const onProjectsChanged = () => {
      void refreshProjects();
      // In case tasks were migrated/affected by a project operation (e.g. delete),
      // refresh tasks too so the UI stays seamless.
      void refreshTasks({ silent: true });
    };
    window.addEventListener("pst:projects-changed", onProjectsChanged);
    return () =>
      window.removeEventListener("pst:projects-changed", onProjectsChanged);
  }, [activeProfileId, selectedProjectId, timeScope]);

  // Self-heal: if tasks reference a projectId we don't know, refetch projects immediately.
  useEffect(() => {
    const known = new Set(projects.map((p) => p.id));
    const hasUnknown = tasks.some((t) => t.projectId && !known.has(t.projectId));
    if (hasUnknown) {
      void refreshProjects();
    }
  }, [tasks, projects]);

  // Seamless sync: when returning to the tab/window, refresh data.
  useEffect(() => {
    const onFocus = () => {
      void refreshProjects();
      void refreshTasks({ silent: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activeProfileId, selectedProjectId]);

  useEffect(() => {
    if (!exportDialogOpen) return;
    const run = async () => {
      setExportPreparing(true);
      setExportIncludeLockedProfiles(false);
      setExportProfilePasswords({});
      setShowExportProfilePasswords({});
      try {
        const res = await apiFetch("/api/profiles");
        if (!res.ok) throw new Error(await getFriendlyErrorMessage(res));
        const data = (await res.json()) as Array<{
          id: string;
          name: string;
          isPasswordProtected?: boolean;
        }>;
        setExportProfiles(
          data.map((p) => ({
            id: p.id,
            name: p.name,
            isPasswordProtected: !!p.isPasswordProtected
          }))
        );
      } catch (error) {
        toast({
          kind: "error",
          title: "Export preparation failed",
          message: error instanceof Error ? error.message : String(error)
        });
      } finally {
        setExportPreparing(false);
      }
    };
    void run();
  }, [exportDialogOpen]);

  const downloadBlob = (filename: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const csvCell = (value: unknown) => {
    const s =
      value === null || value === undefined
        ? ""
        : typeof value === "string"
          ? value
          : String(value);
    const escaped = s.replaceAll('"', '""');
    return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
  };

  const exportAllData = async (format: "json" | "csv" | "both"): Promise<boolean> => {
    const started = performance.now();
    const lockedProfiles = exportProfiles.filter((p) => p.isPasswordProtected);
    const profilePasswords = exportIncludeLockedProfiles
      ? Object.fromEntries(lockedProfiles.map((p) => [p.id, exportProfilePasswords[p.id] ?? ""]))
      : {};
    const snapshotRes = await apiFetch("/api/admin/export-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profilePasswords })
    });
    const elapsedFetch = performance.now() - started;
    if (!snapshotRes.ok) {
      const message = await getFriendlyErrorMessage(snapshotRes);
      toast({
        kind: "error",
        title: "Export failed",
        message,
        durationMs: elapsedFetch
      });
      return false;
    }
    const snapshot = await snapshotRes.json();
    const allTasksRaw: Task[] = snapshot?.data?.tasks ?? [];
    const allProjects: { id: string; name: string; profileId?: string | null }[] =
      snapshot?.data?.projects ?? [];
    const allProfiles: Array<{
      id: string;
      name: string;
      title: string;
      passwordHash?: string;
      createdAt: string;
      updatedAt: string;
    }> = snapshot?.data?.profiles ?? [];
    const excludedLockedProfiles: string[] = Array.isArray(snapshot?.excludedLockedProfiles)
      ? snapshot.excludedLockedProfiles
      : [];

    const isoWeekForDueDate = (dueDateIso: string | undefined): string => {
      if (!dueDateIso) return "";
      const m = dueDateIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return "";
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return "";
      // ISO week in UTC (Mon-start), deterministic.
      const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0, 0));
      const weekdayMon0 = (dt.getUTCDay() + 6) % 7; // Mon=0..Sun=6
      dt.setUTCDate(dt.getUTCDate() - weekdayMon0 + 3); // Thursday
      const weekYear = dt.getUTCFullYear();
      const jan4 = new Date(Date.UTC(weekYear, 0, 4, 12, 0, 0, 0));
      const jan4Mon0 = (jan4.getUTCDay() + 6) % 7;
      jan4.setUTCDate(jan4.getUTCDate() - jan4Mon0 + 3);
      const diffWeeks = Math.round((dt.getTime() - jan4.getTime()) / (7 * 24 * 60 * 60 * 1000));
      const week = 1 + diffWeeks;
      const wk = String(Math.max(1, week)).padStart(2, "0");
      return `${weekYear}-W${wk}`;
    };

    const byParentThenDueAsc = (a: Task, b: Task) => {
      const ap = a.parentId ?? "";
      const bp = b.parentId ?? "";
      if (ap !== bp) return ap.localeCompare(bp);
      const ad = a.dueDate ?? "";
      const bd = b.dueDate ?? "";
      if (ad !== bd) return ad.localeCompare(bd);
      const ac = a.childId ?? "";
      const bc = b.childId ?? "";
      if (ac !== bc) return ac.localeCompare(bc);
      return (a.id ?? "").localeCompare(b.id ?? "");
    };

    const allTasks = allTasksRaw.slice().sort(byParentThenDueAsc);

    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "-",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0")
    ].join("");

    const exportJson = () => {
      const sanitizedTasks = allTasks.map(({ deadlineDate: _dd, deadlineTime: _dt, ...rest }) =>
        ({
          ...rest,
          isoWeekDueDate: isoWeekForDueDate(rest.dueDate)
        } as any)
      );
      const payload = {
        app: "focista-schedulo",
        exportedAt: now.toISOString(),
        profiles: allProfiles,
        projects: allProjects,
        tasks: sanitizedTasks
      };
      downloadBlob(
        `pst-export-${stamp}.json`,
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
      );
    };

    if (format === "json") {
      exportJson();
      toast({
        kind: "success",
        title: "Exported",
        message:
          !exportIncludeLockedProfiles && lockedProfiles.length > 0
            ? `Exported JSON (${allTasks.length} tasks, ${allProjects.length} projects, ${allProfiles.length} profiles). Locked profiles were excluded by choice.`
            : excludedLockedProfiles.length > 0
            ? `Exported JSON (${allTasks.length} tasks, ${allProjects.length} projects, ${allProfiles.length} profiles). Excluded locked profile(s): ${excludedLockedProfiles.join(", ")}.`
            : `Exported JSON (${allTasks.length} tasks, ${allProjects.length} projects, ${allProfiles.length} profiles).`,
        durationMs: performance.now() - started
      });
      return true;
    }

    // Single CSV file containing both projects and tasks.
    // Projects use recordType=project; tasks use recordType=task.
    const projectNameById = new Map(allProjects.map((p) => [p.id, p.name]));
    const headers = [
      "recordType",
      // shared-ish
      "id",
      "profileId",
      "projectId",
      "projectName",
      "name",
      "title",
      "passwordHash",
      "createdAt",
      "updatedAt",
      // project fields
      "projectNameOnly",
      // task fields
      "title",
      "description",
      "priority",
      "dueDate",
      "isoWeekDueDate",
      "dueTime",
      "repeat",
      "repeatEvery",
      "repeatUnit",
      "labels",
      "location",
      "link",
      "reminderMinutesBefore",
      "completed",
      "cancelled",
      "parentId",
      "childId"
    ];

    const rows: string[] = [];
    rows.push(headers.map(csvCell).join(","));

    for (const p of allProfiles) {
      const row: Record<string, unknown> = {
        recordType: "profile",
        id: p.id,
        name: p.name,
        title: p.title,
        passwordHash: p.passwordHash ?? "",
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      };
      rows.push(headers.map((h) => csvCell(row[h])).join(","));
    }

    for (const p of allProjects) {
      const row: Record<string, unknown> = {
        recordType: "project",
        id: p.id,
        profileId: p.profileId ?? "",
        projectId: p.id,
        projectName: p.name,
        projectNameOnly: p.name
      };
      rows.push(headers.map((h) => csvCell(row[h])).join(","));
    }

    for (const t of allTasks) {
      const row: Record<string, unknown> = {
        recordType: "task",
        id: t.id,
        profileId: t.profileId ?? "",
        projectId: t.projectId ?? "",
        projectName: t.projectId ? projectNameById.get(t.projectId) ?? "" : "",
        title: t.title,
        description: t.description ?? "",
        priority: t.priority,
        dueDate: t.dueDate ?? "",
        isoWeekDueDate: isoWeekForDueDate(t.dueDate),
        dueTime: t.dueTime ?? "",
        repeat: t.repeat ?? "none",
        repeatEvery: t.repeatEvery ?? "",
        repeatUnit: t.repeatUnit ?? "",
        labels: (t.labels ?? []).join("|"),
        location: t.location ?? "",
        link: (t.link ?? []).join("|"),
        reminderMinutesBefore:
          t.reminderMinutesBefore !== undefined ? t.reminderMinutesBefore : "",
        completed: t.completed,
        cancelled: t.cancelled ?? false,
        parentId: t.parentId ?? "",
        childId: t.childId ?? ""
      };
      rows.push(headers.map((h) => csvCell(row[h])).join(","));
    }

    const exportCsv = () =>
      downloadBlob(
      `pst-export-${stamp}.csv`,
      new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" })
    );
    if (format === "both") {
      exportJson();
      exportCsv();
      toast({
        kind: "success",
        title: "Exported",
        message:
          !exportIncludeLockedProfiles && lockedProfiles.length > 0
            ? `Exported JSON + CSV (${allTasks.length} tasks, ${allProjects.length} projects, ${allProfiles.length} profiles). Locked profiles were excluded by choice.`
            : excludedLockedProfiles.length > 0
            ? `Exported JSON + CSV (${allTasks.length} tasks, ${allProjects.length} projects, ${allProfiles.length} profiles). Excluded locked profile(s): ${excludedLockedProfiles.join(", ")}.`
            : `Exported JSON + CSV (${allTasks.length} tasks, ${allProjects.length} projects, ${allProfiles.length} profiles).`,
        durationMs: performance.now() - started
      });
      return true;
    }
    exportCsv();
    toast({
      kind: "success",
      title: "Exported",
      message:
        !exportIncludeLockedProfiles && lockedProfiles.length > 0
          ? `Exported CSV (${allTasks.length} tasks, ${allProjects.length} projects, ${allProfiles.length} profiles). Locked profiles were excluded by choice.`
          : excludedLockedProfiles.length > 0
          ? `Exported CSV (${allTasks.length} tasks, ${allProjects.length} projects, ${allProfiles.length} profiles). Excluded locked profile(s): ${excludedLockedProfiles.join(", ")}.`
          : `Exported CSV (${allTasks.length} tasks, ${allProjects.length} projects, ${allProfiles.length} profiles).`,
      durationMs: performance.now() - started
    });
    return true;
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const yesterdayIso = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const tomorrowIso = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const thisMonthStartIso = (() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  })();
  const thisMonthEndIso = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 0);
    return d.toISOString().slice(0, 10);
  })();
  const startOfWeekMondayIso = (() => {
    const d = new Date();
    const offset = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  })();
  const endOfWeekSundayIso = (() => {
    const d = new Date(startOfWeekMondayIso + "T12:00:00");
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  })();
  const endOfSprintIso = (() => {
    const d = new Date(startOfWeekMondayIso + "T12:00:00");
    d.setDate(d.getDate() + 13);
    return d.toISOString().slice(0, 10);
  })();
  const nextWeekStartIso = (() => {
    const d = new Date(endOfWeekSundayIso + "T12:00:00");
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const nextWeekEndIso = (() => {
    const d = new Date(nextWeekStartIso + "T12:00:00");
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  })();
  const lastWeekStartIso = (() => {
    const d = new Date(startOfWeekMondayIso + "T12:00:00");
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  })();
  const lastWeekEndIso = (() => {
    const d = new Date(lastWeekStartIso + "T12:00:00");
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  })();
  const nextMonthStartIso = (() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const nextMonthEndIso = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 2, 0);
    return d.toISOString().slice(0, 10);
  })();
  const lastMonthStartIso = (() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const lastMonthEndIso = (() => {
    const d = new Date();
    d.setDate(0);
    return d.toISOString().slice(0, 10);
  })();
  const thisQuarterStartIso = (() => {
    const d = new Date();
    const qStartMonth = Math.floor(d.getMonth() / 3) * 3;
    const s = new Date(d.getFullYear(), qStartMonth, 1, 12, 0, 0, 0);
    return s.toISOString().slice(0, 10);
  })();
  const thisQuarterEndIso = (() => {
    const d = new Date(thisQuarterStartIso + "T12:00:00");
    const e = new Date(d.getFullYear(), d.getMonth() + 3, 0, 12, 0, 0, 0);
    return e.toISOString().slice(0, 10);
  })();
  const nextQuarterStartIso = (() => {
    const d = new Date(thisQuarterStartIso + "T12:00:00");
    const s = new Date(d.getFullYear(), d.getMonth() + 3, 1, 12, 0, 0, 0);
    return s.toISOString().slice(0, 10);
  })();
  const nextQuarterEndIso = (() => {
    const d = new Date(nextQuarterStartIso + "T12:00:00");
    const e = new Date(d.getFullYear(), d.getMonth() + 3, 0, 12, 0, 0, 0);
    return e.toISOString().slice(0, 10);
  })();
  const lastQuarterStartIso = (() => {
    const d = new Date(thisQuarterStartIso + "T12:00:00");
    const s = new Date(d.getFullYear(), d.getMonth() - 3, 1, 12, 0, 0, 0);
    return s.toISOString().slice(0, 10);
  })();
  const lastQuarterEndIso = (() => {
    const d = new Date(lastQuarterStartIso + "T12:00:00");
    const e = new Date(d.getFullYear(), d.getMonth() + 3, 0, 12, 0, 0, 0);
    return e.toISOString().slice(0, 10);
  })();
  const [customRangeStartIso, setCustomRangeStartIso] = useState<string>(todayIso);
  const [customRangeEndIso, setCustomRangeEndIso] = useState<string>(todayIso);
  const [customRangeDraftStartIso, setCustomRangeDraftStartIso] = useState<string>(todayIso);
  const [customRangeDraftEndIso, setCustomRangeDraftEndIso] = useState<string>(todayIso);
  const normalizeRange = (start: string, end: string): [string, string] =>
    start <= end ? [start, end] : [end, start];
  const customRangeStartNormalizedIso =
    customRangeStartIso <= customRangeEndIso ? customRangeStartIso : customRangeEndIso;
  const customRangeEndNormalizedIso =
    customRangeStartIso <= customRangeEndIso ? customRangeEndIso : customRangeStartIso;

  const listHorizonIso = useMemo(() => {
    if (viewMode !== "list") return null;
    // Expand repeats for future-facing list scopes so tasks in next week/month/quarter show up.
    // Past-only scopes should not inflate the list with virtual tasks.
    const endIso = (() => {
      if (timeScope === "all") {
        // "All" should still feel like a usable upcoming list; expand repeats for a reasonable
        // forward horizon so recurring series show their next occurrences.
        const d = new Date(todayIso + "T12:00:00");
        return toISODateLocal(addMonths(d, 12));
      }
      if (timeScope === "week") return endOfWeekSundayIso;
      if (timeScope === "next_week") return nextWeekEndIso;
      if (timeScope === "sprint") return endOfSprintIso;
      if (timeScope === "month") return thisMonthEndIso;
      if (timeScope === "next_month") return nextMonthEndIso;
      if (timeScope === "quarter") return thisQuarterEndIso;
      if (timeScope === "next_quarter") return nextQuarterEndIso;
      if (timeScope === "custom") return customRangeEndNormalizedIso;
      return null;
    })();
    if (!endIso) return null;
    if (endIso < todayIso) return null;
    return endIso;
  }, [
    viewMode,
    timeScope,
    endOfWeekSundayIso,
    nextWeekEndIso,
    endOfSprintIso,
    thisMonthEndIso,
    nextMonthEndIso,
    thisQuarterEndIso,
    nextQuarterEndIso,
    customRangeEndNormalizedIso,
    todayIso
  ]);

  // Performance: expand repeating tasks only when needed (calendar, and future list scopes).
  const tasksWithRepeats = useMemo(() => {
    if (viewMode === "calendar") {
      return expandRepeatingTasks(activeBaseTasks, calendarHorizonIso);
    }
    if (viewMode === "list" && listHorizonIso) {
      // List view only needs occurrences within the selected window; avoid generating
      // a broad horizon of virtual tasks (helps keep interactions snappy).
      const startIso = (() => {
        if (timeScope === "all") return todayIso;
        if (timeScope === "yesterday") return yesterdayIso;
        if (timeScope === "today") return todayIso;
        if (timeScope === "tomorrow") return tomorrowIso;
        if (timeScope === "last_week") return lastWeekStartIso;
        if (timeScope === "week") return startOfWeekMondayIso;
        if (timeScope === "next_week") return nextWeekStartIso;
        if (timeScope === "sprint") return startOfWeekMondayIso;
        if (timeScope === "last_month") return lastMonthStartIso;
        if (timeScope === "month") return thisMonthStartIso;
        if (timeScope === "next_month") return nextMonthStartIso;
        if (timeScope === "last_quarter") return lastQuarterStartIso;
        if (timeScope === "quarter") return thisQuarterStartIso;
        if (timeScope === "next_quarter") return nextQuarterStartIso;
        if (timeScope === "custom") return customRangeStartNormalizedIso;
        return null;
      })();
      const endIso = (() => {
        if (timeScope === "all") return null;
        if (timeScope === "yesterday") return yesterdayIso;
        if (timeScope === "today") return todayIso;
        if (timeScope === "tomorrow") return tomorrowIso;
        if (timeScope === "last_week") return lastWeekEndIso;
        if (timeScope === "week") return endOfWeekSundayIso;
        if (timeScope === "next_week") return nextWeekEndIso;
        if (timeScope === "sprint") return endOfSprintIso;
        if (timeScope === "last_month") return lastMonthEndIso;
        if (timeScope === "month") return thisMonthEndIso;
        if (timeScope === "next_month") return nextMonthEndIso;
        if (timeScope === "last_quarter") return lastQuarterEndIso;
        if (timeScope === "quarter") return thisQuarterEndIso;
        if (timeScope === "next_quarter") return nextQuarterEndIso;
        if (timeScope === "custom") return customRangeEndNormalizedIso;
        return null;
      })();
      return expandRepeatingTasks(activeBaseTasks, endIso ?? listHorizonIso, startIso);
    }
    return activeBaseTasks;
  }, [
    activeBaseTasks,
    viewMode,
    calendarHorizonIso,
    listHorizonIso,
    timeScope,
    yesterdayIso,
    todayIso,
    tomorrowIso,
    lastWeekStartIso,
    lastWeekEndIso,
    startOfWeekMondayIso,
    endOfWeekSundayIso,
    nextWeekStartIso,
    nextWeekEndIso,
    endOfSprintIso,
    lastMonthStartIso,
    lastMonthEndIso,
    thisMonthStartIso,
    thisMonthEndIso,
    nextMonthStartIso,
    nextMonthEndIso,
    lastQuarterStartIso,
    lastQuarterEndIso,
    thisQuarterStartIso,
    thisQuarterEndIso,
    nextQuarterStartIso,
    nextQuarterEndIso,
    customRangeStartNormalizedIso,
    customRangeEndNormalizedIso
  ]);

  // Keep hovercard content in sync after any task update/refresh.
  // Without this, the hover popup can remain open with stale task data/IDs.
  useEffect(() => {
    if (!hoveredTask) return;
    const updated = tasksWithRepeats.find((t) => t.id === hoveredTask.task.id);

    if (!updated) {
      setHoveredTask(null);
      return;
    }

    // Update the task reference used by the hovercard render.
    setHoveredTask((prev) => {
      if (!prev) return prev;
      // Preserve anchor coords; only swap the task object.
      return { ...prev, task: updated };
    });
  }, [tasksWithRepeats, hoveredTaskId]);

  useEffect(() => {
    if (viewMode !== "calendar") return;
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    if (timeScope === "custom") {
      const start = new Date(`${customRangeStartNormalizedIso}T12:00:00`);
      const m = new Date(start.getTime());
      m.setDate(1);
      setCalendarMonthAnchor(m);
      setSelectedCalendarDayIso(customRangeStartNormalizedIso);
      setDayAgendaOpen(true);
      return;
    }
    if (timeScope === "quarter" || timeScope === "next_quarter" || timeScope === "last_quarter") {
      const startIso =
        timeScope === "quarter"
          ? thisQuarterStartIso
          : timeScope === "next_quarter"
            ? nextQuarterStartIso
            : lastQuarterStartIso;
      const start = new Date(`${startIso}T12:00:00`);
      const m = new Date(start.getTime());
      m.setDate(1);
      setCalendarMonthAnchor(m);
      setSelectedCalendarDayIso(startIso);
      setDayAgendaOpen(true);
      return;
    }
    if (
      timeScope === "all" ||
      timeScope === "month" ||
      timeScope === "next_month" ||
      timeScope === "last_month"
    ) {
      const m = new Date(d.getTime());
      m.setDate(1);
      if (timeScope === "next_month") {
        m.setMonth(m.getMonth() + 1);
      } else if (timeScope === "last_month") {
        m.setMonth(m.getMonth() - 1);
      }
      setCalendarMonthAnchor(m);
      return;
    }
    const todayIsoLocal = toISODateLocal(d);
    setSelectedCalendarDayIso(todayIsoLocal);
    // When viewing "Today" or "Tomorrow" in calendar, open the day agenda by default.
    // For other timeframe ranges (week/sprint/month/next_month/all), keep agenda collapsed initially.
    setDayAgendaOpen(
      timeScope === "yesterday" || timeScope === "today" || timeScope === "tomorrow"
    );
  }, [
    timeScope,
    viewMode,
    customRangeStartNormalizedIso,
    thisQuarterStartIso,
    nextQuarterStartIso,
    lastQuarterStartIso
  ]);

  // For the list view:
  // - show only the next upcoming occurrence per series for active/all views
  // - show *all* occurrences when filtering by completed, so the user can see
  //   the full history of a recurring series (e.g., 55 completed standups).
  // - for day-scoped views (Yesterday/Today/Tomorrow), show all occurrences so
  //   completed recurring tasks done that day are visible (avoid "empty" despite completions).
  const listRangeStartIso = (() => {
    if (timeScope === "all") return "0000-01-01";
    if (timeScope === "yesterday") return yesterdayIso;
    if (timeScope === "today") return todayIso;
    if (timeScope === "tomorrow") return tomorrowIso;
    if (timeScope === "last_week") return lastWeekStartIso;
    if (timeScope === "week") return startOfWeekMondayIso;
    if (timeScope === "next_week") return nextWeekStartIso;
    if (timeScope === "sprint") return startOfWeekMondayIso;
    if (timeScope === "last_month") return lastMonthStartIso;
    if (timeScope === "month") return thisMonthStartIso;
    if (timeScope === "next_month") return nextMonthStartIso;
    if (timeScope === "last_quarter") return lastQuarterStartIso;
    if (timeScope === "quarter") return thisQuarterStartIso;
    if (timeScope === "next_quarter") return nextQuarterStartIso;
    if (timeScope === "custom") return customRangeStartNormalizedIso;
    return todayIso;
  })();
  const listRangeEndIso = (() => {
    if (timeScope === "all") return "9999-12-31";
    if (timeScope === "yesterday") return yesterdayIso;
    if (timeScope === "today") return todayIso;
    if (timeScope === "tomorrow") return tomorrowIso;
    if (timeScope === "last_week") return lastWeekEndIso;
    if (timeScope === "week") return endOfWeekSundayIso;
    if (timeScope === "next_week") return nextWeekEndIso;
    if (timeScope === "sprint") return endOfSprintIso;
    if (timeScope === "last_month") return lastMonthEndIso;
    if (timeScope === "month") return thisMonthEndIso;
    if (timeScope === "next_month") return nextMonthEndIso;
    if (timeScope === "last_quarter") return lastQuarterEndIso;
    if (timeScope === "quarter") return thisQuarterEndIso;
    if (timeScope === "next_quarter") return nextQuarterEndIso;
    if (timeScope === "custom") return customRangeEndNormalizedIso;
    return "9999-12-31";
  })();

  const listSource = tasksWithRepeats;

  const searchTokens = taskSearchQuery
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const matchesTaskSearch = (t: Task): boolean => {
    if (searchTokens.length === 0) return true;
    const locationSearchParts = parseLocationTokens(t.location).flatMap((token) => {
      const parsed = parseLocationAliasToken(token);
      return parsed ? [parsed.label ?? "", parsed.query] : [token];
    });

    const linkSearchParts = (t.link ?? []).flatMap((token) => {
      const parsed = parseLinkAliasToken(token);
      return parsed ? [parsed.label ?? "", parsed.href] : [token];
    });

    const haystack = [
      t.title,
      t.description,
      ...locationSearchParts,
      ...linkSearchParts,
      (t.labels ?? []).join(" ")
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchTokens.every((tok) => haystack.includes(tok));
  };

  const filteredTasksRaw = useMemo(() => {
    const startIso = listRangeStartIso;
    const endIso = listRangeEndIso;
    return listSource
      .filter((t) => {
        if (completionFilter === "active" && t.completed) return false;
        if (completionFilter === "completed" && !t.completed) return false;
        // Project association filter has priority over a specific selected project.
        // "No project" should still work even if the user previously selected a project.
        if (projectAssocFilter === "none") {
          if (hasProject(t)) return false;
        } else {
          if (selectedProjectId && t.projectId !== selectedProjectId) return false;
          if (projectAssocFilter === "with" && !hasProject(t)) return false;
        }

        if (!t.dueDate) {
          return timeScope === "all" && matchesTaskSearch(t);
        }

        // Fast path: timeScope is always a simple ISO range for dated tasks.
        // (Day scopes are ranges of length 1.)
        const inRange = t.dueDate >= startIso && t.dueDate <= endIso;
        return inRange && matchesTaskSearch(t);
      })
      .slice()
      .sort((a, b) => {
        // List-view ordering:
        // 1) Active first, then completed
        // 2) Earliest due date/time first (within current filter window)
        // 3) Stable tie-breakers (parentId, then id)
        const aStatus = a.completed ? 1 : 0;
        const bStatus = b.completed ? 1 : 0;
        if (aStatus !== bStatus) return aStatus - bStatus;

        const ad = a.dueDate ?? "";
        const bd = b.dueDate ?? "";
        if (ad && bd) {
          const d = ad.localeCompare(bd);
          if (d !== 0) return d;
        } else if (ad && !bd) {
          return -1;
        } else if (!ad && bd) {
          return 1;
        }

        const at = a.dueTime ?? "";
        const bt = b.dueTime ?? "";
        if (at && bt) {
          const t = at.localeCompare(bt);
          if (t !== 0) return t;
        } else if (at && !bt) {
          return -1;
        } else if (!at && bt) {
          return 1;
        }

        const pa = getParentId(a);
        const pb = getParentId(b);
        const p = pa.localeCompare(pb);
        if (p !== 0) return p;
        return a.id.localeCompare(b.id);
      });
  }, [
    listSource,
    completionFilter,
    projectAssocFilter,
    selectedProjectId,
    timeScope,
    listRangeStartIso,
    listRangeEndIso,
    taskSearchQuery
  ]);

  const filteredTasks = useMemo(() => {
    if (viewMode !== "list") return filteredTasksRaw;
    if (completionFilter === "completed") return filteredTasksRaw;
    // For day-scoped views we intentionally show all occurrences (including completed repeats).
    if (timeScope === "yesterday" || timeScope === "today" || timeScope === "tomorrow") {
      return filteredTasksRaw;
    }
    // "All" should mean the full timeline for collapsing/representatives as well.
    // This keeps recurring series aligned with the selected timeframe, instead of acting like "upcoming from today".
    return collapseSeriesForList(filteredTasksRaw, listRangeStartIso, listRangeEndIso);
  }, [
    viewMode,
    completionFilter,
    timeScope,
    filteredTasksRaw,
    listRangeStartIso,
    listRangeEndIso,
    todayIso
  ]);

  const filteredTaskCounts = useMemo(() => {
    const completed = filteredTasksRaw.filter((t) => t.completed).length;
    const active = Math.max(0, filteredTasksRaw.length - completed);
    return {
      total: filteredTasksRaw.length,
      active,
      completed
    };
  }, [filteredTasksRaw]);
  const formatStatusBreakdownTooltip = (counts: {
    total: number;
    active: number;
    completed: number;
  }, scopedTasks: Task[]) => {
    const total = Math.max(0, counts.total);
    const activePct = total > 0 ? Math.round((counts.active / total) * 100) : 0;
    const completedPct = total > 0 ? Math.round((counts.completed / total) * 100) : 0;
    const priorities: Array<Task["priority"]> = ["low", "medium", "high", "urgent"];
    const priorityRows = priorities
      .map((priority) => {
        const activeCount = scopedTasks.filter((t) => t.priority === priority && !t.completed).length;
        const completedCount = scopedTasks.filter((t) => t.priority === priority && t.completed).length;
        const totalCount = activeCount + completedCount;
        if (totalCount === 0) return null;
        const label = priority.charAt(0).toUpperCase() + priority.slice(1);
        return `${label}: Active ${activeCount} • Completed ${completedCount} (Total ${totalCount})`;
      })
      .filter(Boolean) as string[];
    return [
      "Task status breakdown",
      `Total: ${total}`,
      `Active: ${counts.active} (${activePct}%)`,
      `Completed: ${counts.completed} (${completedPct}%)`,
      "",
      "Priority breakdown",
      ...(priorityRows.length ? priorityRows : ["No prioritized tasks in this view."])
    ].join("\n");
  };

  const searchQuery = taskSearchQuery.trim().toLowerCase();
  const searchSuggestions = useMemo(() => {
    if (!searchQuery) return [];
    const out: string[] = [];
    const seen = new Set<string>();

    const withinScope = (t: Task): boolean => {
      if (completionFilter === "active" && t.completed) return false;
      if (completionFilter === "completed" && !t.completed) return false;
      if (projectAssocFilter === "none") {
        if (hasProject(t)) return false;
      } else {
        if (selectedProjectId && t.projectId !== selectedProjectId) return false;
        if (projectAssocFilter === "with" && !hasProject(t)) return false;
      }

      if (!t.dueDate) return timeScope === "all";
      if (timeScope === "all") return true;
      if (timeScope === "yesterday") return t.dueDate === yesterdayIso;
      if (timeScope === "today") return t.dueDate === todayIso;
      if (timeScope === "tomorrow") return t.dueDate === tomorrowIso;
      if (timeScope === "last_week")
        return t.dueDate >= lastWeekStartIso && t.dueDate <= lastWeekEndIso;
      if (timeScope === "week")
        return t.dueDate >= startOfWeekMondayIso && t.dueDate <= endOfWeekSundayIso;
      if (timeScope === "next_week")
        return t.dueDate >= nextWeekStartIso && t.dueDate <= nextWeekEndIso;
      if (timeScope === "sprint")
        return t.dueDate >= startOfWeekMondayIso && t.dueDate <= endOfSprintIso;
      if (timeScope === "last_month")
        return t.dueDate >= lastMonthStartIso && t.dueDate <= lastMonthEndIso;
      if (timeScope === "month")
        return t.dueDate >= thisMonthStartIso && t.dueDate <= thisMonthEndIso;
      if (timeScope === "next_month")
        return t.dueDate >= nextMonthStartIso && t.dueDate <= nextMonthEndIso;
      if (timeScope === "last_quarter")
        return t.dueDate >= lastQuarterStartIso && t.dueDate <= lastQuarterEndIso;
      if (timeScope === "quarter")
        return t.dueDate >= thisQuarterStartIso && t.dueDate <= thisQuarterEndIso;
      if (timeScope === "next_quarter")
        return t.dueDate >= nextQuarterStartIso && t.dueDate <= nextQuarterEndIso;
      if (timeScope === "custom")
        return (
          t.dueDate >= customRangeStartNormalizedIso &&
          t.dueDate <= customRangeEndNormalizedIso
        );
      return true;
    };

    const add = (v: string) => {
      const s = v.trim();
      if (!s) return;
      if (seen.has(s)) return;
      seen.add(s);
      out.push(s);
    };

    const base = listSource.filter(withinScope).slice(0, 60);
    for (const t of base) {
      for (const l of t.labels ?? []) {
        if (l.toLowerCase().includes(searchQuery)) add(l);
        if (out.length >= 10) return out;
      }
    }

    for (const t of base) {
      const locationSearchParts = parseLocationTokens(t.location).flatMap((token) => {
        const parsed = parseLocationAliasToken(token);
        return parsed ? [parsed.label ?? "", parsed.query] : [token];
      });

      const linkSearchParts = (t.link ?? []).flatMap((token) => {
        const parsed = parseLinkAliasToken(token);
        return parsed ? [parsed.label ?? "", parsed.href] : [token];
      });

      const hay = [
        t.title,
        t.description,
        ...locationSearchParts,
        ...linkSearchParts
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (hay.includes(searchQuery)) add(t.title);
      if (out.length >= 10) return out;
    }

    return out;
  }, [
    searchQuery,
    listSource,
    completionFilter,
    projectAssocFilter,
    selectedProjectId,
    timeScope,
    yesterdayIso,
    todayIso,
    tomorrowIso,
    lastWeekStartIso,
    lastWeekEndIso,
    startOfWeekMondayIso,
    endOfWeekSundayIso,
    nextWeekStartIso,
    nextWeekEndIso,
    endOfSprintIso,
    lastMonthStartIso,
    lastMonthEndIso,
    thisMonthStartIso,
    thisMonthEndIso,
    nextMonthStartIso,
    nextMonthEndIso,
    lastQuarterStartIso,
    lastQuarterEndIso,
    thisQuarterStartIso,
    thisQuarterEndIso,
    nextQuarterStartIso,
    nextQuarterEndIso,
    customRangeStartNormalizedIso,
    customRangeEndNormalizedIso
  ]);

  const materializeVirtualTask = async (task: Task): Promise<Task | null> => {
    if (isShowcaseReadOnlyActive) return null;
    if (!task.virtual) return task;
    if (!task.dueDate) return null;

    const materializeKey = `${seriesKeyForTask(task)}::${task.dueDate}`;
    const inFlight = virtualMaterializeInFlightRef.current.get(materializeKey);
    if (inFlight) return inFlight;

    const existingReal = tasks.find(
      (t) =>
        !t.virtual &&
        !t.cancelled &&
        !!t.dueDate &&
        t.dueDate === task.dueDate &&
        seriesKeyForTask(t) === seriesKeyForTask(task)
    );
    if (existingReal) return existingReal;

    const promise = (async () => {
      const started = performance.now();
      const res = await apiFetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDate: task.dueDate,
          dueTime: task.dueTime,
          durationMinutes: task.durationMinutes,
          repeat: task.repeat ?? "none",
          repeatEvery: task.repeatEvery,
          repeatUnit: task.repeatUnit,
          labels: task.labels,
          location: task.location,
          link: task.link,
          reminderMinutesBefore: task.reminderMinutesBefore,
          profileId: task.profileId ?? activeProfileId,
          projectId: task.projectId,
          parentId: task.parentId,
          childId: task.childId
        })
      });
      if (!res.ok) return null;
      const created: Task = await res.json();
      setTasks((prev) => {
        if (prev.some((t) => t.id === created.id)) return prev;
        return [...prev, created];
      });
      toast({
        kind: "success",
        title: "Task created",
        message: `Created: ${created.title}`,
        durationMs: performance.now() - started
      });
      return created;
    })();

    virtualMaterializeInFlightRef.current.set(materializeKey, promise);
    try {
      return await promise;
    } finally {
      virtualMaterializeInFlightRef.current.delete(materializeKey);
    }
  };

  const toggleComplete = (task: Task) => {
    if (isShowcaseReadOnlyActive) {
      notifyShowcaseReadOnly();
      return;
    }
    const update = async () => {
      const started = performance.now();
      let target = task;
      if (task.virtual) {
        const created = await materializeVirtualTask(task);
        if (!created) return;
        target = created;
      }
      if (taskMutationInFlightRef.current.has(target.id)) return;
      taskMutationInFlightRef.current.add(target.id);
      try {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === target.id ? { ...t, completed: !t.completed } : t
          )
        );
        const res = await apiFetch(
          `/api/tasks/${encodeURIComponent(target.id)}/complete`,
          { method: "PATCH" }
        );
        if (!res.ok) {
          void refreshTasks({ silent: true });
        } else {
          const updated = (await res.json()) as Task & { missing?: boolean };
          if (updated.missing) {
            void refreshTasks({ silent: true });
            return;
          }
          setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
          notifyTasksChanged();
        }
      } catch {
        void refreshTasks({ silent: true });
      } finally {
        logSlowAction("toggleComplete", started);
        taskMutationInFlightRef.current.delete(target.id);
      }
    };
    void update();
  };

  const deleteTask = async (
    task: Task,
    opts?: { silent?: boolean; suppressNotify?: boolean }
  ): Promise<boolean> => {
    if (isShowcaseReadOnlyActive) {
      if (!opts?.silent) notifyShowcaseReadOnly();
      return false;
    }
    const started = performance.now();
    let target = task;
    if (task.virtual) {
      const created = await materializeVirtualTask(task);
      if (!created) return false;
      target = created;
    }
    if (target.repeat && target.repeat !== "none") {
      const seriesKey = (t: Task) =>
        t.title === target.title &&
        t.repeat === target.repeat &&
        (t.repeatEvery ?? 1) === (target.repeatEvery ?? 1) &&
        (t.repeatUnit ?? "week") === (target.repeatUnit ?? "week") &&
        t.projectId === target.projectId &&
        (t.profileId ?? null) === (target.profileId ?? activeProfileId ?? null);

      const seriesMembers = tasks.filter(seriesKey);
      const ids = Array.from(new Set(seriesMembers.map((member) => member.id)));
      const batchRes = await apiFetch("/api/tasks/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids })
      });
      if (!batchRes.ok) return false;
      const out = (await batchRes.json()) as { deletedIds?: string[] };
      const deletedIds = new Set(out.deletedIds ?? []);
      if (deletedIds.size === 0) return false;
      setTasks((prev) => prev.filter((t) => !deletedIds.has(t.id)));
      if (!opts?.silent) {
        toast({
          kind: "success",
          title: "Tasks deleted",
          message: `Deleted repeating series: ${target.title}`,
          durationMs: performance.now() - started
        });
      }
    } else {
      const res = await apiFetch(`/api/tasks/${target.id}`, {
        method: "DELETE"
      });
      if (!res.ok && res.status !== 204) return false;
      setTasks((prev) => prev.filter((t) => t.id !== target.id));
      if (!opts?.silent) {
        toast({
          kind: "success",
          title: "Task deleted",
          message: `Deleted: ${target.title}`,
          durationMs: performance.now() - started
        });
      }
    }
    if (!opts?.suppressNotify) notifyTasksChanged();
    return true;
  };

  const toggleSelect = (taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedTaskIds(new Set());

  const loadMoreHistory = () => {
    if (historyLoadingMore || !historyHasMore) return;
    setHistoryLoadingMore(true);
    void refreshTasks({ silent: true, appendHistory: true });
  };

  const jumpToHistoryDate = () => {
    if (historyLoadingMore) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(historyJumpDate)) return;
    setHistoryLoadingMore(true);
    void refreshTasks({ silent: true, jumpToDate: historyJumpDate });
  };

  const deleteSelected = () => {
    if (isShowcaseReadOnlyActive) {
      notifyShowcaseReadOnly();
      return;
    }
    const run = async () => {
      const started = performance.now();
      const ids = Array.from(selectedTaskIds);
      if (!ids.length) return;
      const ok = window.confirm(
        `Delete ${ids.length} selected task${ids.length > 1 ? "s" : ""}?`
      );
      if (!ok) return;
      const tasksToDelete = tasksWithRepeats.filter((t) =>
        selectedTaskIds.has(t.id)
      );
      const materialized: Task[] = [];
      for (const t of tasksToDelete) {
        if (t.virtual) {
          const created = await materializeVirtualTask(t);
          if (created) materialized.push(created);
        } else {
          materialized.push(t);
        }
      }
      const uniqueIds = Array.from(new Set(materialized.map((t) => t.id)));
      const res = await apiFetch("/api/tasks/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: uniqueIds })
      });
      let deletedCount = 0;
      if (res.ok) {
        const out = (await res.json()) as { deletedIds?: string[] };
        const deletedIds = new Set(out.deletedIds ?? []);
        deletedCount = deletedIds.size;
        if (deletedCount > 0) {
          setTasks((prev) => prev.filter((t) => !deletedIds.has(t.id)));
        }
      }
      if (deletedCount > 0) notifyTasksChanged();
      setSelectedTaskIds(new Set());
      toast({
        kind: deletedCount > 0 ? "success" : "error",
        title: deletedCount > 0 ? "Selected tasks deleted" : "Delete failed",
        message: `Deleted ${deletedCount} task(s).`,
        durationMs: performance.now() - started
      });
      logSlowAction("deleteSelected", started);
    };
    void run();
  };
  const moveTasks = (tasksToMove: Task[]) => {
    if (isShowcaseReadOnlyActive) {
      notifyShowcaseReadOnly();
      return;
    }
    if (!tasksToMove.length) return;
    setMoveDialogTasks(tasksToMove);
    setMoveDialogProjectId("same");
  };

  const confirmMove = () => {
    if (isShowcaseReadOnlyActive) {
      notifyShowcaseReadOnly();
      return;
    }
    if (!moveDialogTasks) return;
    const run = async () => {
      const started = performance.now();
      let targetProjectId: string | null = null;
      if (moveDialogProjectId === "same") {
        targetProjectId = moveDialogTasks[0]?.projectId ?? null;
      } else {
        targetProjectId = moveDialogProjectId;
      }

      const materialized: Task[] = [];
      for (const task of moveDialogTasks) {
        if (task.virtual) {
          const created = await materializeVirtualTask(task);
          if (created) {
            materialized.push(created);
          }
        } else {
          materialized.push(task);
        }
      }

      const seriesMembers: Task[] = [];
      for (const base of materialized) {
        const originalProjectId = base.projectId;
        const keyMatches = (t: Task) =>
          t.title === base.title &&
          t.repeat === base.repeat &&
          t.projectId === originalProjectId &&
          t.repeatEvery === base.repeatEvery &&
          t.repeatUnit === base.repeatUnit;
        tasks.forEach((t) => {
          if (keyMatches(t)) {
            seriesMembers.push(t);
          }
        });
      }

      const uniqueSeriesMembers = Array.from(
        new Map(seriesMembers.map((t) => [t.id, t])).values()
      );

      const updates = uniqueSeriesMembers.map((task) => ({
        id: task.id,
        task: { ...task, projectId: targetProjectId }
      }));
      const res = await apiFetch("/api/tasks/batch-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates })
      });
      if (res.ok) {
        const out = (await res.json()) as { updated?: Task[] };
        const savedById = new Map((out.updated ?? []).map((t) => [t.id, t]));
        if (savedById.size > 0) {
          setTasks((prev) => prev.map((t) => savedById.get(t.id) ?? t));
        }
      }
      setSelectedTaskIds(new Set());
      setMoveDialogTasks(null);
      notifyTasksChanged();
      toast({
        kind: "success",
        title: "Tasks moved",
        message: `Moved ${uniqueSeriesMembers.length} task(s).`,
        durationMs: performance.now() - started
      });
      logSlowAction("confirmMove", started);
    };
    void run();
  };

  const moveSelected = () => {
    const tasksToMove = tasksWithRepeats.filter((t) =>
      selectedTaskIds.has(t.id)
    );
    moveTasks(tasksToMove);
  };

  let groupedByParent:
    | {
        key: string;
        representative: Task;
        count: number;
        items: Task[];
      }[]
    | null = null;

  if (completionFilter === "completed" || completionFilter === "all") {
    const compareDueDateAsc = (a: Task, b: Task) => {
      // Put tasks with missing dueDate at the bottom.
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    };

    const map = new Map<
      string,
      {
        representative: Task;
        count: number;
        items: Task[];
      }
    >();

    // IMPORTANT: group/count from the *uncollapsed* set so recurring series counts
    // reflect all matching occurrences in the selected timeframe.
    const baseForGrouping =
      completionFilter === "completed"
        ? filteredTasks
        : filteredTasksRaw.filter((t) => t.completed);

    for (const task of baseForGrouping) {
      // Only repeating series should be grouped by their Parent ID.
      // One-time (repeat: "none") tasks must stay ungrouped so they remain
      // easy to edit / mark complete / mark active (full task card actions).
      const key = isRepeating(task) ? canonicalParentKey(task) : task.id;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { representative: task, count: 1, items: [task] });
      } else {
        existing.count += 1;
        existing.items.push(task);
        // Keep the earliest due occurrence as representative so completed groups
        // follow ascending due-date ordering consistently with active tasks.
        if (compareDueDateAsc(task, existing.representative) < 0) {
          existing.representative = task;
        }
      }
    }

    groupedByParent = Array.from(map.entries())
      .map(([key, value]) => ({
        key,
        representative: value.representative,
        count: value.count,
        items: value.items.slice().sort(compareDueDateAsc)
      }))
      .sort((a, b) => compareDueDateAsc(a.representative, b.representative));
  }

  const renderTaskRow = (_task: Task, _opts?: { showChildId?: boolean }) => {
    // Keep task cards minimal: only show title + key schedule metadata + labels.
    // Parent ID is always shown (never Child ID) to match the current UX spec.
    const task = _task;
    const idLabel = "Parent ID";
    const idValue = shortId(canonicalParentKey(task));

    return (
    <article
      key={task.id}
      className={`task-card ${task.completed ? "task-card-completed" : ""}`}
      data-task-id={task.id}
      title="Open task details (virtual occurrences will be materialized on interaction)."
      onMouseEnter={(ev) => {
        if (isTaskCardInteractiveHoverTarget(ev)) return;
        showTaskHoverCard({ task, clientX: ev.clientX, clientY: ev.clientY });
      }}
      onMouseMove={(ev) => {
        if (isTaskCardInteractiveHoverTarget(ev)) {
          setHoveredTask((prev) => (prev?.task.id === task.id ? null : prev));
          return;
        }
        showTaskHoverCard({ task, clientX: ev.clientX, clientY: ev.clientY });
      }}
      onPointerDownCapture={(ev) => {
        if (isTaskCardInteractiveHoverTarget(ev)) {
          setHoveredTask((prev) => (prev?.task.id === task.id ? null : prev));
        }
      }}
      onFocusCapture={(ev) => {
        if (isTaskCardInteractiveHoverTarget(ev)) {
          setHoveredTask((prev) => (prev?.task.id === task.id ? null : prev));
        }
      }}
      onFocus={(ev) => {
        if (isTaskCardInteractiveHoverTarget(ev)) return;
        const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
        showTaskHoverCard({
          task,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top
        });
      }}
      onBlur={() => setHoveredTask(null)}
      onClick={() => {
        const open = async () => {
          if (!task.virtual) {
            openEditor(task);
            return;
          }
          const created = await materializeVirtualTask(task);
          if (created) {
            openEditor(created);
            notifyTasksChanged();
          }
        };
        void open();
      }}
    >
      <div className="task-main">
        <label
          className="task-checkbox"
          onClick={(e) => {
            e.stopPropagation();
            toggleSelect(task.id);
          }}
          title="Select this task for bulk actions."
        >
          <input
            type="checkbox"
            checked={selectedTaskIds.has(task.id)}
            onChange={() => toggleSelect(task.id)}
            title="Select this task for bulk actions."
          />
          <span />
        </label>
        <div className="task-main-inner">
          <div>
            <div className="task-title-row">
              <div className="task-title">{task.title}</div>
              <span
                className={`task-status-pill ${
                  task.completed ? "task-status-completed" : "task-status-active"
                }`}
              >
                {task.completed ? "Completed" : "Active"}
              </span>
            </div>
            <div className="task-meta-row">
              {task.dueDate && (
                <span className="pill subtle">
                  {(() => {
                    const hasTime = !!task.dueTime;
                    const duration =
                      task.durationMinutes !== undefined
                        ? task.durationMinutes
                        : hasTime
                          ? 30
                          : 1440;
                    const startTime = task.dueTime ?? "00:00";
                    const end = addMinutesLocal(task.dueDate!, startTime, duration);
                    if (!end) {
                      return (
                        <>
                          Due {formatWithWeekday(task.dueDate)} {task.dueTime ? `• ${task.dueTime}` : ""}
                        </>
                      );
                    }

                    const startDate = task.dueDate!;
                    const endDate = end.endDate;
                    const multiDay = endDate !== startDate;
                    const daySpan = (() => {
                      const a = new Date(startDate + "T12:00:00");
                      const b = new Date(endDate + "T12:00:00");
                      if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
                      const diff = Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
                      return diff >= 0 ? diff + 1 : null;
                    })();

                    if (!hasTime) {
                      if (!multiDay) return <>Due {formatWithWeekday(startDate)} (all day)</>;
                      return (
                        <>
                          {formatWithWeekday(startDate)} — {formatWithWeekday(endDate)}
                          {daySpan ? ` • ${daySpan} ${daySpan === 1 ? "day" : "days"}` : ""}
                        </>
                      );
                    }

                    if (!multiDay) {
                      return (
                        <>
                          Due {formatWithWeekday(startDate)} • {startTime}
                        </>
                      );
                    }
                    return (
                      <>
                        {formatWithWeekday(startDate)} • {startTime} — {formatWithWeekday(endDate)} • {end.endTime}
                      </>
                    );
                  })()}
                </span>
              )}
              {task.durationMinutes !== undefined && (
                <span className="pill subtle">
                  Duration{" "}
                  {(() => {
                    const mins = task.durationMinutes ?? 0;
                    const days = Math.floor(mins / 1440);
                    const remAfterDays = mins % 1440;
                    const hours = Math.floor(remAfterDays / 60);
                    const remMins = remAfterDays % 60;
                    const parts: string[] = [];
                    if (days) parts.push(`${days}d`);
                    if (hours) parts.push(`${hours}h`);
                    if (remMins || parts.length === 0) parts.push(`${remMins}m`);
                    return parts.join(" ");
                  })()}
                </span>
              )}
              {task.priority && (
                <span className={`pill priority-${task.priority}`}>
                  {task.priority.toUpperCase()}
                </span>
              )}
              <span className="pill subtle">
                Project:{" "}
                {task.projectId
                  ? projects.find((p) => p.id === task.projectId)?.name ??
                    "Project"
                  : "All tasks"}
              </span>
              <span className="pill subtle">
                {idLabel}: {idValue}
              </span>
              {task.labels.map((label) => (
                <span key={label} className="pill label-pill">
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div className="task-actions">
            <button
              className="task-action-button"
              aria-label="Mark complete / active"
              onClick={(e) => {
                e.stopPropagation();
                toggleComplete(task);
              }}
              title={task.completed ? "Mark this task active again." : "Mark this task completed."}
            >
              {task.completed ? "Mark active" : "Complete"}
            </button>
            <button
              className="task-action-button"
              aria-label="Move to another project"
              onClick={(e) => {
                e.stopPropagation();
                moveTasks([task]);
              }}
              title="Move this task to a different project."
            >
              Move
            </button>
            <button
              className="task-action-button"
              aria-label="Delete task"
              onClick={(e) => {
                e.stopPropagation();
                void deleteTask(task);
              }}
              title="Delete this task."
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </article>
    );
  };

  const openTask = (task: Task) => {
    const run = async () => {
      if (!task.virtual) {
        openEditor(task);
        return;
      }
      const created = await materializeVirtualTask(task);
      if (created) {
        openEditor(created);
        notifyTasksChanged();
      }
    };
    void run();
  };

  const monthLabel = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const startOfCalendarGrid = (anchor: Date) => {
    const first = new Date(anchor.getTime());
    first.setDate(1);
    // Monday-start calendar grid (Mon=0 ... Sun=6)
    const day = (first.getDay() + 6) % 7;
    const start = new Date(first.getTime());
    start.setDate(first.getDate() - day);
    start.setHours(12, 0, 0, 0);
    return start;
  };

  const addDaysLocal = (d: Date, days: number) => {
    const next = new Date(d.getTime());
    next.setDate(next.getDate() + days);
    return next;
  };

  const tasksForCalendar = tasksWithRepeats.filter((t) => {
    if (completionFilter === "completed") return t.completed;
    if (completionFilter === "active") return !t.completed;
    if (projectAssocFilter === "none") {
      if (hasProject(t)) return false;
    } else {
      if (selectedProjectId && t.projectId !== selectedProjectId) return false;
      if (projectAssocFilter === "with" && !hasProject(t)) return false;
    }
    return matchesTaskSearch(t);
  });
  const calendarCounts = (() => {
    const completed = tasksForCalendar.filter((t) => t.completed).length;
    return {
      total: tasksForCalendar.length,
      active: Math.max(0, tasksForCalendar.length - completed),
      completed
    };
  })();

  type CalendarEntry = {
    dateIso: string;
    startMin: number; // minutes since midnight on dateIso
    endMin: number; // minutes since midnight on dateIso (can be 1440)
    isAllDay: boolean;
    startsToday: boolean;
    task: Task;
  };

  const parseTimeToMinutes = (time: string | undefined): number | null => {
    if (!time) return null;
    const m = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return hh * 60 + mm;
  };

  const showTaskHoverCard = (opts: {
    task: Task;
    anchorIso?: string | null;
    isAllDay?: boolean;
    startMin?: number | null;
    endMin?: number | null;
    clientX: number;
    clientY: number;
  }) => {
    // Enforce: only one popup/dropdown should be visible at a time.
    setOpenCluster(null);

    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    // Initial guess; useLayoutEffect refines using measured `.task-hovercard` size.
    const cardW = Math.min(500, vw - 24);
    const cardH = Math.min(520, Math.max(200, Math.round(vh * 0.42)));

    const { x, y } = computeTaskHoverCardCoords(
      opts.clientX,
      opts.clientY,
      cardW,
      cardH,
      vw,
      vh
    );

    const anchorIso =
      opts.anchorIso ??
      opts.task.dueDate ??
      null;

    const startMin =
      opts.startMin !== undefined ? opts.startMin : parseTimeToMinutes(opts.task.dueTime);
    const endMin =
      opts.endMin !== undefined
        ? opts.endMin
        : startMin !== null
          ? Math.min(
              1440,
              startMin + (opts.task.durationMinutes ?? 15)
            )
          : null;

    const isAllDay =
      opts.isAllDay !== undefined
        ? opts.isAllDay
        : startMin === null;

    setHoveredTask({
      task: opts.task,
      anchorIso,
      isAllDay,
      startMin,
      endMin,
      pointerX: opts.clientX,
      pointerY: opts.clientY,
      x,
      y
    });
  };

  const renderTaskHoverCard = () => {
    if (!hoveredTask || typeof document === "undefined") return null;
    const card = (
      <div
        ref={taskHoverCardRef}
        className={`task-hovercard ${hoveredTask.task.completed ? "is-completed" : ""}`}
        data-priority={hoveredTask.task.priority}
        data-status={hoveredTask.task.completed ? "completed" : "active"}
        style={{ left: hoveredTask.x, top: hoveredTask.y }}
        role="status"
        aria-live="polite"
      >
        {(() => {
          const task = hoveredTask.task;
          const projectName =
            task.projectId
              ? projects.find((p) => p.id === task.projectId)?.name ?? "Project"
              : "No project";
          const statusLabel = task.completed ? "Completed" : "Active";
          const priorityLabel =
            task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
          const dateLabel = hoveredTask.anchorIso
            ? new Intl.DateTimeFormat(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric"
              }).format(new Date(hoveredTask.anchorIso + "T12:00:00"))
            : "No date";

          const timeLabel = hoveredTask.isAllDay
            ? "All day"
            : hoveredTask.startMin !== null && hoveredTask.endMin !== null
              ? `${String(Math.floor(hoveredTask.startMin / 60)).padStart(2, "0")}:${String(
                  hoveredTask.startMin % 60
                ).padStart(2, "0")}–${String(Math.floor(hoveredTask.endMin / 60)).padStart(
                  2,
                  "0"
                )}:${String(hoveredTask.endMin % 60).padStart(2, "0")}`
              : task.dueTime
                ? task.dueTime
                : "—";

          const calendarWeekLabel = (() => {
            const isoSource = task.dueDate ?? hoveredTask.anchorIso;
            if (!isoSource) return null;
            const d = new Date(isoSource + "T12:00:00");
            if (Number.isNaN(d.getTime())) return null;
            const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            const dayNum = tmp.getUTCDay() || 7; // Mon=1 ... Sun=7
            tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
            const isoYear = tmp.getUTCFullYear();
            const yearStart = new Date(Date.UTC(isoYear, 0, 1));
            const diffDays = Math.floor((tmp.getTime() - yearStart.getTime()) / 86400000);
            const weekNo = Math.floor(diffDays / 7) + 1;
            return `CW ${String(weekNo).padStart(2, "0")}-${isoYear}`;
          })();
          const durationLabel =
            task.durationMinutes !== undefined
              ? formatDurationMinutesForOverview(task.durationMinutes)
              : null;
          const reminderLabel =
            task.reminderMinutesBefore !== undefined
              ? `${task.reminderMinutesBefore} min before`
              : null;
          const repeatLabel = (() => {
            if (!task.repeat || task.repeat === "none") return null;
            if (task.repeat === "custom") {
              if (task.repeatEvery && task.repeatUnit) {
                return `Every ${task.repeatEvery} ${task.repeatUnit}${task.repeatEvery === 1 ? "" : "s"}`;
              }
              return "Custom repeat";
            }
            if (task.repeat === "daily") return "Daily";
            if (task.repeat === "weekly") return "Weekly";
            if (task.repeat === "weekdays") return "Weekdays";
            if (task.repeat === "weekends") return "Weekends";
            if (task.repeat === "monthly") return "Monthly";
            if (task.repeat === "quarterly") return "Quarterly";
            if (task.repeat === "yearly") return "Yearly";
            return "Repeats";
          })();

          return (
            <>
              <div className="task-hovercard-top">
                <div className="task-hovercard-title">{task.title}</div>
                <div className="task-hovercard-badges">
                  <span
                    className={`task-hovercard-badge task-hovercard-badge-status ${
                      task.completed ? "is-completed" : ""
                    }`}
                  >
                    {statusLabel}
                  </span>
                  <span className="task-hovercard-badge task-hovercard-badge-priority">
                    {priorityLabel}
                  </span>
                  <span className="task-hovercard-badge task-hovercard-badge-project">
                    {projectName}
                  </span>
                </div>
              </div>

              <div className="task-hovercard-meta">
                {task.description ? (
                  <div className="task-hovercard-row">
                    <span className="task-hovercard-k">Description</span>
                    <span className="task-hovercard-v task-hovercard-v-wrap">
                      {task.description}
                    </span>
                  </div>
                ) : null}

                <div className="task-hovercard-section">
                  <div className="task-hovercard-section-title">Schedule</div>
                  <div className="task-hovercard-row">
                    <span className="task-hovercard-k">When</span>
                    <span className="task-hovercard-v task-hovercard-v-wrap">
                      {dateLabel}
                    </span>
                  </div>

                  <div className="task-hovercard-row">
                    <span className="task-hovercard-k">Time</span>
                    <span className="task-hovercard-v task-hovercard-v-wrap">
                      {timeLabel}
                    </span>
                  </div>

                  {calendarWeekLabel ? (
                    <div className="task-hovercard-row">
                      <span className="task-hovercard-k">Calendar week</span>
                      <span className="task-hovercard-v task-hovercard-v-wrap">
                        {calendarWeekLabel}
                      </span>
                    </div>
                  ) : null}

                  <div className="task-hovercard-row">
                    <span className="task-hovercard-k">Schedule</span>
                    <span className="task-hovercard-v task-hovercard-v-wrap">
                      {task.virtual
                        ? "Upcoming occurrence"
                        : repeatLabel
                          ? repeatLabel
                          : "No repetition"}
                    </span>
                  </div>

                  <div className="task-hovercard-row">
                    <span className="task-hovercard-k">Repetition</span>
                    <span className="task-hovercard-v task-hovercard-v-wrap">
                      {repeatLabel ? repeatLabel : "No repetition"}
                    </span>
                  </div>

                  <div className="task-hovercard-row">
                    <span className="task-hovercard-k">Cancelled</span>
                    <span className="task-hovercard-v task-hovercard-v-wrap">
                      {task.cancelled ? "Yes" : "No"}
                    </span>
                  </div>
                </div>

                <div className="task-hovercard-divider" aria-hidden="true" />

                <div className="task-hovercard-section">
                  <div className="task-hovercard-section-title">Details</div>

                  <div className="task-hovercard-row">
                    <span className="task-hovercard-k">Duration</span>
                    <span className="task-hovercard-v task-hovercard-v-wrap">
                      {task.durationMinutes !== undefined
                        ? durationLabel
                        : "—"}
                    </span>
                  </div>

                  <div className="task-hovercard-row">
                    <span className="task-hovercard-k">Location</span>
                    <span className="task-hovercard-v task-hovercard-v-wrap">
                      {task.location ? (
                        (() => {
                          const tokens = parseLocationTokens(task.location);
                          if (!tokens.length) return "—";
                          return (
                            <span className="task-hovercard-labels">
                              {tokens.map((loc) => {
                                const parsed = parseLocationAliasToken(loc);
                                const query = parsed?.query ?? loc;
                                const display = parsed?.label ?? query;
                                const href = normalizeHyperlinkHref(query);
                                return href ? (
                                  <a
                                    key={loc}
                                    className="task-hovercard-chip location-map-link"
                                    href={href ?? undefined}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {display}
                                  </a>
                                  ) : (
                                    <span key={loc} className="task-hovercard-chip">
                                      {display}
                                    </span>
                                  );
                              })}
                            </span>
                          );
                        })()
                      ) : (
                        "—"
                      )}
                    </span>
                  </div>

                  <div className="task-hovercard-row">
                    <span className="task-hovercard-k">Reminder</span>
                    <span className="task-hovercard-v task-hovercard-v-wrap">
                      {task.reminderMinutesBefore !== undefined
                        ? reminderLabel
                        : "—"}
                    </span>
                  </div>
                </div>

                <div className="task-hovercard-divider" aria-hidden="true" />

                <div className="task-hovercard-section">
                  <div className="task-hovercard-section-title">Tags</div>

                  <div className="task-hovercard-row">
                    <span className="task-hovercard-k">Labels</span>
                    <span className="task-hovercard-v task-hovercard-labels">
                      {task.labels.length > 0 ? (
                        task.labels.map((l) => (
                          <span key={l} className="task-hovercard-chip">
                            {l}
                          </span>
                        ))
                      ) : (
                        <span className="task-hovercard-chip">—</span>
                      )}
                    </span>
                  </div>

                  <div className="task-hovercard-row">
                    <span className="task-hovercard-k">Links</span>
                    <span className="task-hovercard-v task-hovercard-labels">
                      {(task.link ?? []).length > 0 ? (
                        (task.link ?? []).map((l) => {
                          const parsed = parseLinkAliasToken(l);
                          if (!parsed) {
                            return (
                              <span key={l} className="task-hovercard-chip">
                                {l}
                              </span>
                            );
                          }

                          const href = parsed.href;
                          const text = parsed.label ?? shortLinkText(href);
                          return (
                            <a
                              key={l}
                              className="task-hovercard-chip task-link-chip"
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {text}
                            </a>
                          );
                        })
                      ) : (
                        <span className="task-hovercard-chip">—</span>
                      )}
                    </span>
                  </div>
                </div>

                <div className="task-hovercard-divider" aria-hidden="true" />
                <div className="task-hovercard-ids" aria-label="Identifiers">
                  <div className="task-hovercard-ids-title">Identifiers</div>
                  <div className="task-hovercard-ids-grid task-hovercard-mono">
                    <div className="task-hovercard-ids-k">Task</div>
                    <div className="task-hovercard-ids-v">
                      {stripDoubleColonSuffix(task.id)}
                    </div>
                    <div className="task-hovercard-ids-k">Parent</div>
                    <div className="task-hovercard-ids-v">
                      {task.parentId ? stripDoubleColonSuffix(task.parentId) : "—"}
                    </div>
                    <div className="task-hovercard-ids-k">Child</div>
                    <div className="task-hovercard-ids-v">
                      {(() => {
                        if (!isRepeating(task)) return "—";
                        const idx = completedChildIndex(task, tasksWithRepeats);
                        if (idx != null) return idx;
                        return task.childId ? stripDoubleColonSuffix(task.childId) : "—";
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </>
          );
        })()}
      </div>
    );
    return createPortal(card, document.body);
  };

  const tasksByDate = (() => {
    const map = new Map<string, CalendarEntry[]>();

    const minutesSinceMidnight = (d: Date) => d.getHours() * 60 + d.getMinutes();
    const startOfDayLocal = (d: Date) => {
      const x = new Date(d.getTime());
      x.setHours(0, 0, 0, 0);
      return x;
    };
    const clamp = (n: number, min: number, max: number) =>
      Math.max(min, Math.min(max, n));

    for (const t of tasksForCalendar) {
      if (!t.dueDate) continue;
      const hasTime = !!t.dueTime;
      const duration =
        t.durationMinutes !== undefined
          ? t.durationMinutes
          : hasTime
            ? 30
            : 1440;

      const start = new Date(`${t.dueDate}T${t.dueTime ?? "00:00"}:00`);
      const endRaw = new Date(start.getTime() + Math.max(1, duration) * 60_000);
      // If an event ends exactly at midnight, treat it as ending in the previous day
      // to avoid creating a zero-length segment on the next day.
      const end =
        endRaw.getHours() === 0 &&
        endRaw.getMinutes() === 0 &&
        endRaw.getSeconds() === 0 &&
        endRaw.getMilliseconds() === 0
          ? new Date(endRaw.getTime() - 1)
          : endRaw;

      let cursor = startOfDayLocal(start);
      const endDay = startOfDayLocal(end);
      const startDayMs = cursor.getTime();

      while (cursor.getTime() <= endDay.getTime()) {
        const dayStart = new Date(cursor.getTime());
        const dayEnd = new Date(cursor.getTime());
        dayEnd.setDate(dayEnd.getDate() + 1);

        const segStart = start.getTime() > dayStart.getTime() ? start : dayStart;
        const segEnd = end.getTime() < dayEnd.getTime() ? end : dayEnd;

        const startMin = clamp(minutesSinceMidnight(segStart), 0, 1440);
        const endMin =
          segEnd.getTime() === dayEnd.getTime()
            ? 1440
            : clamp(minutesSinceMidnight(segEnd), 0, 1440);

        const dayIso = toISODateLocal(new Date(dayStart.getTime() + 12 * 60 * 60 * 1000));
        const isAllDay = !hasTime && startMin === 0 && endMin === 1440;

        const arr = map.get(dayIso) ?? [];
        arr.push({
          dateIso: dayIso,
          startMin,
          endMin,
          isAllDay,
          startsToday: dayStart.getTime() === startDayMs,
          task: t
        });
        map.set(dayIso, arr);

        cursor = addDaysLocal(cursor, 1);
      }
    }

    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => {
        if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
        const byStart = a.startMin - b.startMin;
        if (byStart !== 0) return byStart;
        return a.task.title.localeCompare(b.task.title);
      });
      map.set(k, arr);
    }

    return map;
  })();

  const renderDayAgenda = (dayIso: string) => {
    const items = (tasksByDate.get(dayIso) ?? []).slice();
    const allDay = items.filter((e) => e.isAllDay);
    const timed = items.filter((e) => !e.isAllDay);

    const startMinutesList = timed.map((e) => e.startMin);
    const endMinutesList = timed.map((e) => e.endMin);

    const minM = startMinutesList.length ? Math.min(...startMinutesList) : 9 * 60;
    const maxM = endMinutesList.length ? Math.max(...endMinutesList) : 17 * 60;
    const startHour = Math.max(0, Math.min(9, Math.floor(minM / 60) - 1));
    const endHour = Math.min(23, Math.max(17, Math.floor(maxM / 60) + 2));
    const startMinutes = startHour * 60;
    const totalMinutes = (endHour - startHour + 1) * 60;
    // Vertical scale for the day agenda (pixels per minute).
    // Higher value makes short (15m) tasks more visually distinct.
    const pxPerMin = 2.0;

    const dayLabel = (() => {
      const d = new Date(dayIso + "T12:00:00");
      const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
      const month = d.toLocaleDateString(undefined, { month: "long" });
      return `${weekday}, ${d.getDate()} ${month} ${d.getFullYear()}`;
    })();
    const dayCompleted = items.filter((e) => e.task.completed).length;
    const dayActive = Math.max(0, items.length - dayCompleted);

    const nowLineTop = (() => {
      const todayIso = (() => {
        const d = new Date();
        d.setHours(12, 0, 0, 0);
        return toISODateLocal(d);
      })();
      if (dayIso !== todayIso) return null;
      const now = new Date();
      const nowM = now.getHours() * 60 + now.getMinutes();
      if (nowM < startMinutes || nowM > startMinutes + totalMinutes) return null;
      return (nowM - startMinutes) * pxPerMin;
    })();

    const layoutTimedOverlaps = (
      entries: CalendarEntry[]
    ): Array<
      CalendarEntry & {
        col: number;
        cols: number;
      }
    > => {
      if (entries.length === 0) return [];

      const sorted = entries
        .slice()
        .sort((a, b) => (a.startMin - b.startMin) || (a.endMin - b.endMin));

      const groups: CalendarEntry[][] = [];
      let current: CalendarEntry[] = [];
      let groupEnd = -1;

      for (const e of sorted) {
        if (current.length === 0) {
          current = [e];
          groupEnd = e.endMin;
          continue;
        }
        if (e.startMin < groupEnd) {
          current.push(e);
          groupEnd = Math.max(groupEnd, e.endMin);
        } else {
          groups.push(current);
          current = [e];
          groupEnd = e.endMin;
        }
      }
      if (current.length) groups.push(current);

      const out: Array<CalendarEntry & { col: number; cols: number }> = [];

      for (const g of groups) {
        const byStart = g
          .slice()
          .sort((a, b) => (a.startMin - b.startMin) || (a.endMin - b.endMin));

        const active: Array<{ endMin: number; col: number }> = [];
        const freeCols: number[] = [];
        let maxCols = 0;

        const placed = new Map<
          string,
          CalendarEntry & { col: number; cols: number }
        >();

        const keyOf = (e: CalendarEntry) =>
          `${e.task.id}::${e.dateIso}::${e.startMin}-${e.endMin}`;

        for (const e of byStart) {
          // retire ended
          for (let i = active.length - 1; i >= 0; i--) {
            if (active[i].endMin <= e.startMin) {
              freeCols.push(active[i].col);
              active.splice(i, 1);
            }
          }
          freeCols.sort((a, b) => a - b);

          const col = freeCols.length ? (freeCols.shift() as number) : active.length;
          active.push({ endMin: e.endMin, col });
          active.sort((a, b) => a.endMin - b.endMin);

          maxCols = Math.max(maxCols, active.length);

          placed.set(keyOf(e), { ...e, col, cols: 1 });
        }

        // finalize cols for this overlap group
        for (const v of placed.values()) {
          out.push({ ...v, cols: maxCols });
        }
      }

      return out;
    };

    const timedLaidOut = layoutTimedOverlaps(timed);

    return (
      <div className="day-agenda">
        <div className="day-agenda-header">
          <div>
            <div
              className="day-agenda-title"
              style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}
            >
              <span>{dayLabel}</span>
              <span
                className="pill subtle"
                title={formatStatusBreakdownTooltip({
                  total: items.length,
                  active: dayActive,
                  completed: dayCompleted
                }, items.map((e) => e.task))}
                aria-label="Day agenda status breakdown"
              >
                Active {dayActive} • Completed {dayCompleted}
              </span>
            </div>
            <div className="muted">
              {selectedProjectId ? "Project filtered" : "All projects"} •{" "}
              {items.length} task{items.length === 1 ? "" : "s"}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button
              className="ghost-button"
              onClick={() => {
                openEditor({
                  id: "new",
                  title: "",
                  description: "",
                  priority: "medium",
                  labels: [],
                  profileId: activeProfileId,
                  projectId: selectedProjectId,
                  completed: false,
                  dueDate: dayIso
                } as Task);
              }}
            >
              Add task
            </button>
            <button
              className="ghost-button"
              onClick={() => setDayAgendaOpen(false)}
            >
              Close
            </button>
          </div>
        </div>

        {allDay.length > 0 && (
          <div className="day-agenda-allday">
            <div className="day-agenda-allday-label">All day</div>
            <div className="day-agenda-allday-items">
              {allDay.map((e) => (
                <button
                  key={`${e.task.id}::${e.dateIso}::allday`}
                  className={`day-agenda-chip priority-${e.task.priority}`}
                  data-task-id={e.task.id}
                  onClick={() => openTask(e.task)}
                  onMouseEnter={(ev) =>
                    showTaskHoverCard({
                      task: e.task,
                      anchorIso: e.dateIso,
                      isAllDay: true,
                      startMin: 0,
                      endMin: 1440,
                      clientX: ev.clientX,
                      clientY: ev.clientY
                    })
                  }
                  onMouseMove={(ev) => {
                    showTaskHoverCard({
                      task: e.task,
                      anchorIso: e.dateIso,
                      isAllDay: true,
                      startMin: 0,
                      endMin: 1440,
                      clientX: ev.clientX,
                      clientY: ev.clientY
                    });
                  }}
                  onFocus={(ev) => {
                    const rect = (ev.currentTarget as HTMLButtonElement).getBoundingClientRect();
                    showTaskHoverCard({
                      task: e.task,
                      anchorIso: e.dateIso,
                      isAllDay: true,
                      startMin: 0,
                      endMin: 1440,
                      clientX: rect.left + rect.width / 2,
                      clientY: rect.top
                    });
                  }}
                  onBlur={() => setHoveredTask(null)}
                >
                  {e.task.title}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="day-agenda-grid">
          <div className="day-agenda-times">
            {Array.from({ length: endHour - startHour + 1 }, (_, i) => {
              const h = startHour + i;
              const label = `${String(h).padStart(2, "0")}:00`;
              return (
                <div key={label} className="day-agenda-time">
                  {label}
                </div>
              );
            })}
          </div>

          <div
            className="day-agenda-track"
            style={{ height: `${totalMinutes * pxPerMin}px` }}
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const y = e.clientY - rect.top;
              const mins = Math.max(0, Math.min(totalMinutes - 1, Math.round(y / pxPerMin)));
              const hh = Math.floor((startMinutes + mins) / 60);
              const mm = (startMinutes + mins) % 60;
              const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
              openEditor({
                id: "new",
                title: "",
                description: "",
                priority: "medium",
                labels: [],
                profileId: activeProfileId,
                projectId: selectedProjectId,
                completed: false,
                dueDate: dayIso,
                dueTime: time
              } as Task);
            }}
            role="button"
            tabIndex={0}
          >
            {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
              <div
                key={i}
                className="day-agenda-hour-line"
                style={{ top: `${i * 60 * pxPerMin}px` }}
              />
            ))}

            {nowLineTop !== null && (
              <div
                className="day-agenda-nowline"
                style={{ top: `${nowLineTop}px` }}
                aria-hidden="true"
              />
            )}

            {timedLaidOut.map((e) => {
              const startM = e.startMin;
              const endM = e.endMin;
              const top = (startM - startMinutes) * pxPerMin;
              const durMins = Math.max(1, endM - startM);
              const maxHeight = Math.max(20, totalMinutes * pxPerMin - top - 2);
              // Allow short tasks (e.g. 15m) to be clearly smaller, but keep a minimum tap target.
              const height = Math.max(20, Math.min(maxHeight, durMins * pxPerMin));
              const startLabel = `${String(Math.floor(startM / 60)).padStart(2, "0")}:${String(
                startM % 60
              ).padStart(2, "0")}`;
              const endLabel =
                endM === 1440
                  ? "24:00"
                  : `${String(Math.floor(endM / 60)).padStart(2, "0")}:${String(
                      endM % 60
                    ).padStart(2, "0")}`;

              const durationMinutes = Math.max(1, endM - startM);
              const durationLabel =
                durationMinutes >= 60
                  ? `${Math.floor(durationMinutes / 60)}h${
                      durationMinutes % 60 ? ` ${durationMinutes % 60}m` : ""
                    }`
                  : `${durationMinutes}m`;

              const pad = 10;
              const gap = 8;
              const cols = Math.max(1, e.cols);
              const col = Math.max(0, Math.min(cols - 1, e.col));
              const widthExpr = `calc((100% - ${pad * 2 + gap * (cols - 1)}px) / ${cols})`;
              const leftExpr = `calc(${pad}px + ${col} * (${widthExpr} + ${gap}px))`;

              return (
                <button
                  key={`${e.task.id}::${e.dateIso}::${startM}-${endM}`}
                  className={`day-agenda-event priority-${e.task.priority}`}
                  data-task-id={e.task.id}
                  style={{
                    top: `${top}px`,
                    height: `${height}px`,
                    left: leftExpr,
                    width: widthExpr,
                    zIndex: 1 + col
                  }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    openTask(e.task);
                  }}
                  onMouseEnter={(ev) =>
                    showTaskHoverCard({
                      task: e.task,
                      anchorIso: e.dateIso,
                      isAllDay: e.isAllDay,
                      startMin: e.startMin,
                      endMin: e.endMin,
                      clientX: ev.clientX,
                      clientY: ev.clientY
                    })
                  }
                  onMouseMove={(ev) => {
                    showTaskHoverCard({
                      task: e.task,
                      anchorIso: e.dateIso,
                      isAllDay: e.isAllDay,
                      startMin: e.startMin,
                      endMin: e.endMin,
                      clientX: ev.clientX,
                      clientY: ev.clientY
                    });
                  }}
                  onFocus={(ev) => {
                    const rect = (ev.currentTarget as HTMLButtonElement).getBoundingClientRect();
                    showTaskHoverCard({
                      task: e.task,
                      anchorIso: e.dateIso,
                      isAllDay: e.isAllDay,
                      startMin: e.startMin,
                      endMin: e.endMin,
                      clientX: rect.left + rect.width / 2,
                      clientY: rect.top
                    });
                  }}
                  onBlur={() => setHoveredTask(null)}
                >
                  <div className="day-agenda-event-header">
                    <div className="day-agenda-event-title">{e.task.title}</div>
                    <div className="day-agenda-event-meta">
                      <span className="day-agenda-event-time">
                        {startLabel} – {endLabel}
                      </span>
                      <span className="day-agenda-event-dot">•</span>
                      <span className="day-agenda-event-duration">{durationLabel}</span>
                      {!e.startsToday && (
                        <span className="day-agenda-event-continues">Continues</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderCalendar = () => {
    const todayIsoLocal = (() => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      return toISODateLocal(d);
    })();

    const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const todayLocalNoon = (() => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      return d;
    })();

    const startOfWeekMonday = (d: Date) => {
      const x = new Date(d.getTime());
      const offset = (x.getDay() + 6) % 7; // Mon=0 ... Sun=6
      x.setDate(x.getDate() - offset);
      x.setHours(12, 0, 0, 0);
      return x;
    };

    const rangeDays: Date[] = (() => {
      if (
        timeScope === "all" ||
        timeScope === "month" ||
        timeScope === "next_month" ||
        timeScope === "last_month"
      ) {
        // `calendarMonthAnchor` is already set to the correct month when switching timeframes.
        // For example, when `timeScope === "next_month"`, `calendarMonthAnchor` should point
        // to the *next* calendar month (e.g., April). So we must NOT shift it again here.
        const monthAnchor = calendarMonthAnchor;
        const gridStart = startOfCalendarGrid(monthAnchor);
        return Array.from({ length: 42 }, (_, i) => addDaysLocal(gridStart, i));
      }
      if (timeScope === "yesterday" || timeScope === "today" || timeScope === "tomorrow") {
        const base = new Date(todayLocalNoon.getTime());
        if (timeScope === "yesterday") base.setDate(base.getDate() - 1);
        if (timeScope === "tomorrow") base.setDate(base.getDate() + 1);
        return [base];
      }
      if (timeScope === "quarter" || timeScope === "next_quarter" || timeScope === "last_quarter") {
        const startIso =
          timeScope === "quarter"
            ? thisQuarterStartIso
            : timeScope === "next_quarter"
              ? nextQuarterStartIso
              : lastQuarterStartIso;
        const endIso =
          timeScope === "quarter"
            ? thisQuarterEndIso
            : timeScope === "next_quarter"
              ? nextQuarterEndIso
              : lastQuarterEndIso;
        const startLocal = new Date(`${startIso}T12:00:00`);
        const endLocal = new Date(`${endIso}T12:00:00`);
        const days =
          Math.floor((endLocal.getTime() - startLocal.getTime()) / 86400000) + 1;
        return Array.from({ length: Math.max(1, days) }, (_, i) =>
          addDaysLocal(startLocal, i)
        );
      }
      const baseWeekStart =
        timeScope === "last_week"
          ? (() => {
              const d = startOfWeekMonday(todayLocalNoon);
              d.setDate(d.getDate() - 7);
              return d;
            })()
          : timeScope === "next_week"
          ? (() => {
              const d = startOfWeekMonday(todayLocalNoon);
              d.setDate(d.getDate() + 7);
              return d;
            })()
          : startOfWeekMonday(todayLocalNoon);
      const count = timeScope === "sprint" ? 14 : 7;
      return Array.from({ length: count }, (_, i) => addDaysLocal(baseWeekStart, i));
    })();

    const anchorMonth = calendarMonthAnchor.getMonth();
    const anchorYear = calendarMonthAnchor.getFullYear();

    const start = rangeDays[0];
    const end = rangeDays[rangeDays.length - 1];
    const isoWeekYearAndNo = (d: Date) => {
      const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = tmp.getUTCDay() || 7; // Mon=1 ... Sun=7
      tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
      const isoYear = tmp.getUTCFullYear();
      const yearStart = new Date(Date.UTC(isoYear, 0, 1));
      const diffDays = Math.floor((tmp.getTime() - yearStart.getTime()) / 86400000);
      const weekNo = Math.floor(diffDays / 7) + 1;
      return { isoYear, weekNo };
    };
    const formatWeek = (d: Date) => {
      const { isoYear, weekNo } = isoWeekYearAndNo(d);
      return `${String(weekNo).padStart(2, "0")}-${isoYear}`;
    };

    const rangeLabel = (() => {
      const sameMonth =
        start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
      const sameYear = start.getFullYear() === end.getFullYear();

      const fmtStart = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year:
          timeScope === "yesterday" || timeScope === "today" || timeScope === "tomorrow"
            ? "numeric"
            : undefined
      }).format(start);
      const fmtEnd = new Intl.DateTimeFormat(undefined, {
        month: sameMonth ? undefined : "short",
        day: "numeric",
        year: undefined
      }).format(end);

      if (timeScope === "yesterday" || timeScope === "today" || timeScope === "tomorrow") {
        // For "today" / "tomorrow" in calendar view, show the full calendar week context
        // e.g. "CW 12-2026 • 16–22 Mar 2026".
        const weekStartLocal = new Date(start.getTime());
        // Move back to Monday of this week (Mon=1 ... Sun=0/7)
        const offset = (weekStartLocal.getDay() + 6) % 7;
        weekStartLocal.setDate(weekStartLocal.getDate() - offset);
        const weekEndLocal = new Date(weekStartLocal.getTime());
        weekEndLocal.setDate(weekEndLocal.getDate() + 6);

        const weekLabel = `CW ${formatWeek(start)}`;
        const weekRange = (() => {
          const startDay = weekStartLocal.getDate();
          const endDay = weekEndLocal.getDate();
          const monthLabelShort = weekEndLocal.toLocaleDateString(undefined, {
            month: "short"
          });
          const yearLabel = weekEndLocal.getFullYear();
          return `${startDay}–${endDay} ${monthLabelShort} ${yearLabel}`;
        })();

        return `${weekLabel} • ${weekRange}`;
      }

      const startYear = start.getFullYear();
      const endYear = end.getFullYear();
      const dateTail = sameYear ? startYear : `${startYear}–${endYear}`;

      if (timeScope === "last_week" || timeScope === "week" || timeScope === "next_week") {
        return `${fmtStart} – ${fmtEnd}, ${dateTail}`;
      }

      if (timeScope === "sprint") {
        return `${fmtStart} – ${fmtEnd}, ${dateTail}`;
      }

      if (timeScope === "all") {
        return monthLabel(calendarMonthAnchor);
      }
      if (timeScope === "last_month") {
        return `Last month • ${monthLabel(calendarMonthAnchor)}`;
      }
      if (timeScope === "month") {
        return `This month • ${monthLabel(calendarMonthAnchor)}`;
      }
      if (timeScope === "next_month") {
        // `calendarMonthAnchor` is already set to the start of the next month.
        return `Next month • ${monthLabel(calendarMonthAnchor)}`;
      }
      if (timeScope === "quarter" || timeScope === "next_quarter" || timeScope === "last_quarter") {
        const startIso =
          timeScope === "quarter"
            ? thisQuarterStartIso
            : timeScope === "next_quarter"
              ? nextQuarterStartIso
              : lastQuarterStartIso;
        const startDate = new Date(`${startIso}T12:00:00`);
        const quarterNo = Math.floor(startDate.getMonth() / 3) + 1;
        const quarterPrefix =
          timeScope === "quarter"
            ? "This quarter"
            : timeScope === "next_quarter"
              ? "Next quarter"
              : "Last quarter";
        return `${quarterPrefix} • Q${quarterNo} ${startDate.getFullYear()}`;
      }
      if (timeScope === "custom") {
        return `Custom range • ${customRangeStartNormalizedIso} – ${customRangeEndNormalizedIso}`;
      }

      return `${fmtStart} – ${fmtEnd}, ${dateTail}`;
    })();

    return (
      <div className="calendar-shell">
        {false && (
          <div
            className={`task-hovercard ${
              hoveredTask?.task.completed ? "is-completed" : ""
            }`}
            data-priority={hoveredTask?.task.priority ?? "low"}
            data-status={hoveredTask?.task.completed ? "completed" : "active"}
            style={{ left: hoveredTask?.x ?? 0, top: hoveredTask?.y ?? 0 }}
            role="status"
            aria-live="polite"
          >
            {(() => {
              if (!hoveredTask) return null;
              const ht = hoveredTask!;
              const task = ht.task;
              const projectName =
                task.projectId
                  ? projects.find((p) => p.id === task.projectId)?.name ?? "Project"
                  : "No project";
              const statusLabel = task.completed ? "Completed" : "Active";
              const priorityLabel =
                task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
              const dateLabel = ht.anchorIso
                ? new Intl.DateTimeFormat(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric"
                  }).format(new Date(ht.anchorIso + "T12:00:00"))
                : "No date";

              let timeLabel: string;
              if (ht.isAllDay) {
                timeLabel = "All day";
              } else if (ht.startMin !== null && ht.endMin !== null) {
                const startMin = ht.startMin;
                const endMin = ht.endMin;
                timeLabel = `${String(Math.floor(startMin! / 60)).padStart(2, "0")}:${String(
                  startMin! % 60
                ).padStart(2, "0")}–${String(Math.floor(endMin! / 60)).padStart(2, "0")}:${String(
                  endMin! % 60
                ).padStart(2, "0")}`;
              } else {
                timeLabel = task.dueTime ?? "—";
              }
              const durationLabel =
                task.durationMinutes !== undefined ? `${task.durationMinutes} min` : null;
              const reminderLabel =
                task.reminderMinutesBefore !== undefined
                  ? `${task.reminderMinutesBefore} min before`
                  : null;
              const repeatLabel = (() => {
                if (!task.repeat || task.repeat === "none") return null;
                if (task.repeat === "custom") {
                  if (task.repeatEvery && task.repeatUnit) {
                    return `Every ${task.repeatEvery} ${task.repeatUnit}${task.repeatEvery === 1 ? "" : "s"}`;
                  }
                  return "Custom repeat";
                }
                if (task.repeat === "daily") return "Daily";
                if (task.repeat === "weekly") return "Weekly";
                if (task.repeat === "weekdays") return "Weekdays";
                if (task.repeat === "weekends") return "Weekends";
                if (task.repeat === "monthly") return "Monthly";
                if (task.repeat === "quarterly") return "Quarterly";
                if (task.repeat === "yearly") return "Yearly";
                return "Repeats";
              })();

              return (
                <>
                  <div className="task-hovercard-top">
                    <div className="task-hovercard-title">{task.title}</div>
                    <div className="task-hovercard-badges">
                      <span
                        className={`task-hovercard-badge task-hovercard-badge-status ${
                          task.completed ? "is-completed" : ""
                        }`}
                      >
                        {task.completed ? "✓" : "•"} {statusLabel}
                      </span>
                      <span className="task-hovercard-badge task-hovercard-badge-priority">
                        {priorityLabel}
                      </span>
                      <span className="task-hovercard-badge task-hovercard-badge-project">
                        {projectName}
                      </span>
                    </div>
                  </div>
                  {task.description ? (
                    <div className="task-hovercard-desc">{task.description}</div>
                  ) : null}
                  <div className="task-hovercard-meta">
                    <div className="task-hovercard-row">
                      <span className="task-hovercard-k">When</span>
                      <span className="task-hovercard-v task-hovercard-v-wrap">
                      {dateLabel}
                    </span>
                  </div>

                  <div className="task-hovercard-row">
                    <span className="task-hovercard-k">Time</span>
                    <span className="task-hovercard-v task-hovercard-v-wrap">
                      {timeLabel}
                      </span>
                    </div>
                    <div className="task-hovercard-row">
                      <span className="task-hovercard-k">Details</span>
                      <span className="task-hovercard-v task-hovercard-v-wrap">
                        {task.durationMinutes !== undefined
                          ? `Duration: ${durationLabel}`
                          : "Duration: —"}
                        {" • "}
                        {task.location ? (
                          (() => {
                            const tokens = parseLocationTokens(task.location);
                            if (!tokens.length) return "Location: —";
                            return (
                              <span className="task-hovercard-labels">
                                {tokens.map((loc) => {
                                  const parsed = parseLocationAliasToken(loc);
                                  const query = parsed?.query ?? loc;
                                  const display = parsed?.label ?? query;
                                  const href = normalizeHyperlinkHref(query);
                                  return href ? (
                                    <a
                                      key={loc}
                                      className="location-map-link task-hovercard-chip"
                                      href={href ?? undefined}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {display}
                                    </a>
                                  ) : (
                                    <span key={loc} className="task-hovercard-chip">
                                      {display}
                                    </span>
                                  );
                                })}
                              </span>
                            );
                          })()
                        ) : (
                          "Location: —"
                        )}
                        {" • "}
                        {task.reminderMinutesBefore !== undefined
                          ? `Reminder: ${reminderLabel}`
                          : "Reminder: —"}
                      </span>
                    </div>

                    <div className="task-hovercard-row">
                      <span className="task-hovercard-k">Schedule</span>
                      <span className="task-hovercard-v task-hovercard-v-wrap">
                        {task.virtual
                          ? "Upcoming occurrence"
                          : repeatLabel
                            ? `Repeat: ${repeatLabel}`
                            : "No repetition"}
                      </span>
                    </div>

                    <div className="task-hovercard-row">
                      <span className="task-hovercard-k">Labels</span>
                      <span className="task-hovercard-v task-hovercard-labels">
                        {task.labels?.length ? (
                          task.labels.map((l) => (
                            <span key={l} className="task-hovercard-chip">
                              {l}
                            </span>
                          ))
                        ) : (
                          <span className="task-hovercard-chip">—</span>
                        )}
                      </span>
                    </div>
                    <div className="task-hovercard-row">
                      <span className="task-hovercard-k">Links</span>
                      <span className="task-hovercard-v task-hovercard-labels">
                        {(task.link ?? []).length > 0 ? (
                          (task.link ?? []).map((l) => {
                            const parsed = parseLinkAliasToken(l);
                            if (!parsed) {
                              return (
                                <span key={l} className="task-hovercard-chip">
                                  {l}
                                </span>
                              );
                            }
                            const href = parsed.href;
                            const text = parsed.label ?? shortLinkText(href);
                            return (
                              <a
                                key={l}
                                className="task-hovercard-chip task-link-chip"
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {text}
                              </a>
                            );
                          })
                        ) : (
                          <span className="task-hovercard-chip">—</span>
                        )}
                      </span>
                    </div>
                    <div className="task-hovercard-divider" aria-hidden="true" />
                    <div className="task-hovercard-ids" aria-label="Identifiers">
                      <div className="task-hovercard-ids-title">Identifiers</div>
                      <div className="task-hovercard-ids-grid task-hovercard-mono">
                        <div className="task-hovercard-ids-k">Task</div>
                        <div className="task-hovercard-ids-v">
                          {stripDoubleColonSuffix(task.id)}
                        </div>
                        <div className="task-hovercard-ids-k">Parent</div>
                        <div className="task-hovercard-ids-v">
                          {task.parentId ? stripDoubleColonSuffix(task.parentId) : "—"}
                        </div>
                        <div className="task-hovercard-ids-k">Child</div>
                        <div className="task-hovercard-ids-v">
                          {task.childId ? stripDoubleColonSuffix(task.childId) : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        )}
        <div className="calendar-header">
          <div className="calendar-month">
            {timeScope === "all" && (
              <button
                className="ghost-button small"
                onClick={() => {
                  const d = new Date(calendarMonthAnchor.getTime());
                  d.setMonth(d.getMonth() - 1);
                  setCalendarMonthAnchor(d);
                }}
                title="Go to previous month."
              >
                ←
              </button>
            )}
            <div className="calendar-header-title-block">
              <div
                className="calendar-month-label"
                style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}
              >
                <span>{rangeLabel}</span>
                <span
                  className="pill subtle"
                  title={formatStatusBreakdownTooltip(calendarCounts, tasksForCalendar)}
                  aria-label="Calendar status breakdown"
                >
                  Active {calendarCounts.active} • Completed {calendarCounts.completed}
                </span>
              </div>
            </div>
            {timeScope === "all" && (
              <button
                className="ghost-button small"
                onClick={() => {
                  const d = new Date(calendarMonthAnchor.getTime());
                  d.setMonth(d.getMonth() + 1);
                  setCalendarMonthAnchor(d);
                }}
                title="Go to next month."
              >
                →
              </button>
            )}
          </div>
          <button
            className="ghost-button"
            onClick={() => {
              const d = new Date();
              d.setDate(1);
              d.setHours(12, 0, 0, 0);
              setCalendarMonthAnchor(d);
              const day = new Date();
              day.setHours(12, 0, 0, 0);
              setSelectedCalendarDayIso(toISODateLocal(day));
              setDayAgendaOpen(true);
            }}
            title="Jump to the current month and open today's agenda."
          >
            Today
          </button>
          {selectedCalendarDayIso && (
            <button
              className="ghost-button"
              onClick={() => setDayAgendaOpen((v) => !v)}
              title={dayAgendaOpen ? "Hide the day agenda timeline." : "Open the day agenda timeline."}
            >
              {dayAgendaOpen ? "Hide agenda" : "Open agenda"}
            </button>
          )}
        </div>

        <div className="calendar-legend" aria-label="Calendar legend">
          <div className="calendar-legend-item">
            <span className="calendar-legend-today" aria-hidden="true" />
            <span>Today</span>
          </div>
          <div className="calendar-legend-sep" aria-hidden="true" />
          <div className="calendar-legend-item">
            <span className="calendar-legend-swatch calendar-legend-swatch-active" aria-hidden="true">
              •
            </span>
            <span>Active</span>
          </div>
          <div className="calendar-legend-item">
            <span className="calendar-legend-swatch calendar-legend-swatch-completed" aria-hidden="true">
              ✓
            </span>
            <span>Completed</span>
          </div>
          <div className="calendar-legend-sep" aria-hidden="true" />
          <div className="calendar-legend-item">
            <span className="calendar-legend-dot priority-low" aria-hidden="true" />
            <span>Low</span>
          </div>
          <div className="calendar-legend-item">
            <span className="calendar-legend-dot priority-medium" aria-hidden="true" />
            <span>Medium</span>
          </div>
          <div className="calendar-legend-item">
            <span className="calendar-legend-dot priority-high" aria-hidden="true" />
            <span>High</span>
          </div>
          <div className="calendar-legend-item">
            <span className="calendar-legend-dot priority-urgent" aria-hidden="true" />
            <span>Urgent</span>
          </div>
        </div>

        <div className="calendar-grid">
          {weekdayLabels.map((w) => (
            <div key={w} className="calendar-weekday">
              {w}
            </div>
          ))}
          {Array.from({ length: Math.ceil(rangeDays.length / 7) }, (_, weekIdx) => {
            const weekDays = rangeDays.slice(weekIdx * 7, weekIdx * 7 + 7);
            if (weekDays.length === 0) return null;
            const weekStartDate = weekDays[0];
            const weekEndDate = weekDays[weekDays.length - 1];
            const weekLabel = `${formatWeek(weekStartDate)}`;
            const weekRangeLabel = (() => {
              const startDay = weekStartDate.getDate();
              const endDay = weekEndDate.getDate();
              const startMonth = weekStartDate.toLocaleDateString(undefined, {
                month: "short"
              });
              const endMonth = weekEndDate.toLocaleDateString(undefined, {
                month: "short"
              });
              if (weekStartDate.getMonth() === weekEndDate.getMonth()) {
                return `${startDay} ${startMonth} - ${endDay} ${endMonth}`;
              }
              return `${startDay} ${startMonth} - ${endDay} ${endMonth}`;
            })();
            return (
              <React.Fragment key={`week-${weekIdx}`}>
                <div className="calendar-week-row-pill" style={{ gridColumn: "1 / -1" }}>
                  <span className="calendar-week-row-pill-label">CW {weekLabel}</span>
                  <span className="calendar-week-row-pill-range">{weekRangeLabel}</span>
                </div>
                {weekDays.map((d) => {
                  const iso = toISODateLocal(d);
                  const isToday = iso === todayIsoLocal;
                  const inAnchorMonth =
                    d.getMonth() === anchorMonth && d.getFullYear() === anchorYear;
                  const dayTasks =
                    (timeScope === "month" || timeScope === "next_month" || timeScope === "last_month") &&
                    !inAnchorMonth
                      ? []
                      : tasksByDate.get(iso) ?? [];
                  const dayLabel = new Intl.DateTimeFormat(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric"
                  }).format(d);

                  const todayGridStyle =
                    timeScope === "yesterday" || timeScope === "today"
                      ? { gridColumnStart: ((d.getDay() + 6) % 7) + 1 }
                      : undefined;

                  return (
                    <div
                      key={iso}
                      className={`calendar-cell ${isToday ? "calendar-cell-today" : ""} ${
                        selectedCalendarDayIso === iso ? "calendar-cell-selected" : ""
                      } ${
                        (timeScope === "all" ||
                          timeScope === "month" ||
                          timeScope === "next_month" ||
                          timeScope === "last_month") &&
                        !inAnchorMonth
                          ? "calendar-cell-out"
                          : ""
                      }`}
                      onClick={() => {
                        setSelectedCalendarDayIso(iso);
                        setDayAgendaOpen(true);
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={dayLabel}
                      style={todayGridStyle}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedCalendarDayIso(iso);
                          setDayAgendaOpen(true);
                        }
                      }}
                    >
                      <div className="calendar-cell-top">
                        <div className="calendar-day">
                          {timeScope === "all"
                            ? d.getDate()
                            : `${d.getDate()} ${d.toLocaleDateString(undefined, {
                                month: "short"
                              })}`}
                        </div>
                        <div className="calendar-cell-top-right">
                          {isToday && <span className="calendar-today-pill">★ Today</span>}
                          {dayTasks.length > 0 && (
                            <span className="pill subtle calendar-count-pill">
                              {dayTasks.length}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="calendar-items">
                        {dayTasks.slice(0, 4).map((e) => (
                          <button
                            key={`${e.task.id}::${e.dateIso}::${e.startMin}-${e.endMin}`}
                            className={`calendar-item priority-${e.task.priority} ${
                              e.task.completed ? "calendar-item-completed" : "calendar-item-active"
                            }`}
                            data-task-id={e.task.id}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              openTask(e.task);
                            }}
                            onMouseEnter={(ev) =>
                              showTaskHoverCard({
                                task: e.task,
                                anchorIso: iso,
                                isAllDay: e.isAllDay,
                                startMin: e.startMin,
                                endMin: e.endMin,
                                clientX: ev.clientX,
                                clientY: ev.clientY
                              })
                            }
                            onMouseMove={(ev) => {
                              showTaskHoverCard({
                                task: e.task,
                                anchorIso: iso,
                                isAllDay: e.isAllDay,
                                startMin: e.startMin,
                                endMin: e.endMin,
                                clientX: ev.clientX,
                                clientY: ev.clientY
                              });
                            }}
                            onFocus={(ev) => {
                              const rect = (ev.currentTarget as HTMLButtonElement).getBoundingClientRect();
                              showTaskHoverCard({
                                task: e.task,
                                anchorIso: iso,
                                isAllDay: e.isAllDay,
                                startMin: e.startMin,
                                endMin: e.endMin,
                                clientX: rect.left + rect.width / 2,
                                clientY: rect.top
                              });
                            }}
                            onBlur={() => setHoveredTask(null)}
                          >
                            <span
                              className="calendar-item-status"
                              aria-label={e.task.completed ? "Completed" : "Active"}
                              title={e.task.completed ? "Completed" : "Active"}
                            >
                              {e.task.completed ? "✓" : "•"}
                            </span>
                            <span className="calendar-item-time">
                              {e.isAllDay
                                ? "All day"
                                : `${String(Math.floor(e.startMin / 60)).padStart(
                                    2,
                                    "0"
                                  )}:${String(e.startMin % 60).padStart(2, "0")}`}
                            </span>
                            <span className="calendar-item-title">
                              {e.task.title}
                              {!e.startsToday ? " ↪" : ""}
                            </span>
                          </button>
                        ))}
                        {dayTasks.length > 4 && (
                          <div className="calendar-more muted">
                            +{dayTasks.length - 4} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>

        {selectedCalendarDayIso && dayAgendaOpen && renderDayAgenda(selectedCalendarDayIso)}
      </div>
    );
  };

  return (
    <section className="task-board">
      {renderTaskHoverCard()}
      <div className="board-header">
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span>Tasks</span>
            <span
              className="pill subtle"
              aria-label="Filtered active and completed counts"
              title={formatStatusBreakdownTooltip(filteredTaskCounts, filteredTasksRaw)}
            >
              Active {filteredTaskCounts.active} • Completed {filteredTaskCounts.completed}
            </span>
          </h2>
          <p className="muted">
            Capture title, priority, reminders, labels, locations, and more. Showing{" "}
            {filteredTaskCounts.total} task{filteredTaskCounts.total === 1 ? "" : "s"} for the
            current filters.
          </p>
        </div>
        <div className="board-header-actions">
          <div className="task-toolbar" aria-label="Task controls">
            <div className="task-search" role="search" aria-label="Search tasks">
              <input
                className="task-search-input"
                value={taskSearchQuery}
                onChange={(e) => {
                  setTaskSearchQuery(e.target.value);
                  setOpenCluster(null);
                }}
                onFocus={() => {
                  setOpenCluster(null);
                  setHoveredTask(null);
                  setExpandedGroups(new Set());
                }}
                placeholder="Search tasks (title, labels, location)…"
                list="task-search-suggestions"
              />
              <datalist id="task-search-suggestions">
                {searchSuggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              {taskSearchQuery.trim() ? (
                <button
                  type="button"
                  className="task-search-clear"
                  aria-label="Clear task search"
                  onClick={() => {
                    setTaskSearchQuery("");
                    setOpenCluster(null);
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
            {canUsePerfDebug ? (
              <button
                type="button"
                className="task-cluster-trigger"
                aria-pressed={perfDebugEnabled}
                title="Toggle performance debug logs for this profile."
                onClick={() => {
                  setPerfDebugEnabled((prev) => {
                    const next = !prev;
                    if (typeof window !== "undefined") {
                      window.localStorage.setItem("pst.perfDebug.rifqi", next ? "1" : "0");
                    }
                    return next;
                  });
                }}
              >
                Perf logs: {perfDebugEnabled ? "On" : "Off"}
              </button>
            ) : null}
            <div
              className={`task-cluster ${openCluster === "timeframe" ? "is-open" : ""}`}
              data-cluster="timeframe"
              onMouseEnter={() => {
                if (openCluster !== "timeframe") openExclusiveCluster("timeframe");
              }}
            >
              <button
                className="task-cluster-trigger"
                type="button"
                aria-haspopup="menu"
                aria-expanded={openCluster === "timeframe"}
                aria-label="Timeframe"
                onClick={() => toggleExclusiveCluster("timeframe")}
              >
                Timeframe:{" "}
                {timeScope === "today"
                  ? "Today"
                  : timeScope === "yesterday"
                    ? "Yesterday"
                  : timeScope === "tomorrow"
                    ? "Tomorrow"
                    : timeScope === "last_week"
                      ? "Last week"
                    : timeScope === "week"
                      ? "This week"
                      : timeScope === "next_week"
                        ? "Next week"
                        : timeScope === "sprint"
                          ? "This sprint"
                          : timeScope === "last_month"
                            ? "Last month"
                          : timeScope === "month"
                            ? "This month"
                            : timeScope === "next_month"
                              ? "Next month"
                              : timeScope === "last_quarter"
                                ? "Last quarter"
                              : timeScope === "quarter"
                                ? "This quarter"
                                : timeScope === "next_quarter"
                                  ? "Next quarter"
                              : timeScope === "custom"
                                ? "Custom range"
                              : "All"}
              </button>
              <div className="task-cluster-menu" role="menu" aria-label="Timeframe options">
                <button
                  className={`task-cluster-item ${timeScope === "yesterday" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={timeScope === "yesterday"}
                  onClick={() => {
                    onTimeScopeChange("yesterday");
                    setOpenCluster(null);
                  }}
                >
                  Yesterday
                </button>
                <button
                  className={`task-cluster-item ${timeScope === "today" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={timeScope === "today"}
                  onClick={() => {
                    onTimeScopeChange("today");
                    setOpenCluster(null);
                  }}
                >
                  Today
                </button>
                <button
                  className={`task-cluster-item ${timeScope === "tomorrow" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={timeScope === "tomorrow"}
                  onClick={() => {
                    onTimeScopeChange("tomorrow");
                    setOpenCluster(null);
                  }}
                >
                  Tomorrow
                </button>
                <button
                  className={`task-cluster-item ${timeScope === "last_week" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={timeScope === "last_week"}
                  onClick={() => {
                    onTimeScopeChange("last_week");
                    setOpenCluster(null);
                  }}
                >
                  Last week
                </button>
                <button
                  className={`task-cluster-item ${timeScope === "week" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={timeScope === "week"}
                  onClick={() => {
                    onTimeScopeChange("week");
                    setOpenCluster(null);
                  }}
                >
                  This week
                </button>
                <button
                  className={`task-cluster-item ${timeScope === "next_week" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={timeScope === "next_week"}
                  onClick={() => {
                    onTimeScopeChange("next_week");
                    setOpenCluster(null);
                  }}
                >
                  Next week
                </button>
                <button
                  className={`task-cluster-item ${timeScope === "sprint" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={timeScope === "sprint"}
                  onClick={() => {
                    onTimeScopeChange("sprint");
                    setOpenCluster(null);
                  }}
                >
                  This sprint (2 weeks)
                </button>
                <button
                  className={`task-cluster-item ${timeScope === "last_month" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={timeScope === "last_month"}
                  onClick={() => {
                    onTimeScopeChange("last_month");
                    setOpenCluster(null);
                  }}
                >
                  Last month
                </button>
                <button
                  className={`task-cluster-item ${timeScope === "month" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={timeScope === "month"}
                  onClick={() => {
                    onTimeScopeChange("month");
                    setOpenCluster(null);
                  }}
                >
                  This month
                </button>
                <button
                  className={`task-cluster-item ${timeScope === "next_month" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={timeScope === "next_month"}
                  onClick={() => {
                    onTimeScopeChange("next_month");
                    setOpenCluster(null);
                  }}
                >
                  Next month
                </button>
                <button
                  className={`task-cluster-item ${timeScope === "last_quarter" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={timeScope === "last_quarter"}
                  onClick={() => {
                    onTimeScopeChange("last_quarter");
                    setOpenCluster(null);
                  }}
                >
                  Last quarter
                </button>
                <button
                  className={`task-cluster-item ${timeScope === "quarter" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={timeScope === "quarter"}
                  onClick={() => {
                    onTimeScopeChange("quarter");
                    setOpenCluster(null);
                  }}
                >
                  This quarter
                </button>
                <button
                  className={`task-cluster-item ${timeScope === "next_quarter" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={timeScope === "next_quarter"}
                  onClick={() => {
                    onTimeScopeChange("next_quarter");
                    setOpenCluster(null);
                  }}
                >
                  Next quarter
                </button>
                <button
                  className={`task-cluster-item ${timeScope === "custom" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={timeScope === "custom"}
                  onClick={() => {
                    onTimeScopeChange("custom");
                  }}
                  title="Pick a custom start and end date range."
                >
                  Custom range
                </button>
                {timeScope === "custom" && (
                  <div className="task-cluster-item" role="group" aria-label="Custom range selector">
                    <div style={{ display: "grid", gap: "0.4rem" }}>
                      <label style={{ display: "grid", gap: "0.2rem" }}>
                        <span className="muted">Start date</span>
                        <input
                          type="date"
                          value={customRangeDraftStartIso}
                          onChange={(e) => setCustomRangeDraftStartIso(e.target.value)}
                          title="Custom range start date."
                        />
                      </label>
                      <label style={{ display: "grid", gap: "0.2rem" }}>
                        <span className="muted">End date</span>
                        <input
                          type="date"
                          value={customRangeDraftEndIso}
                          onChange={(e) => setCustomRangeDraftEndIso(e.target.value)}
                          title="Custom range end date."
                        />
                      </label>
                      <button
                        className="task-action-button"
                        type="button"
                        onClick={() => {
                          const [start, end] = normalizeRange(
                            customRangeDraftStartIso || todayIso,
                            customRangeDraftEndIso || customRangeDraftStartIso || todayIso
                          );
                          setCustomRangeStartIso(start);
                          setCustomRangeEndIso(end);
                          onTimeScopeChange("custom");
                          setOpenCluster(null);
                        }}
                        title="Apply the selected custom range."
                      >
                        Apply custom range
                      </button>
                    </div>
                  </div>
                )}
                <button
                  className={`task-cluster-item ${timeScope === "all" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={timeScope === "all"}
                  onClick={() => {
                    onTimeScopeChange("all");
                    setOpenCluster(null);
                  }}
                >
                  All
                </button>
              </div>
            </div>

            <div
              className={`task-cluster ${openCluster === "view" ? "is-open" : ""}`}
              data-cluster="view"
              onMouseEnter={() => {
                if (openCluster !== "view") openExclusiveCluster("view");
              }}
            >
              <button
                className="task-cluster-trigger"
                type="button"
                aria-haspopup="menu"
                aria-expanded={openCluster === "view"}
                aria-label="View"
                onClick={() => toggleExclusiveCluster("view")}
                title="Choose between list view and calendar view."
              >
                View: {viewMode === "list" ? "List" : "Calendar"}
              </button>
              <div className="task-cluster-menu" role="menu" aria-label="View options">
                <button
                  className={`task-cluster-item ${viewMode === "list" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={viewMode === "list"}
                  onClick={() => {
                    setViewMode("list");
                    setOpenCluster(null);
                  }}
                  title="Show tasks as a list."
                >
                  List
                </button>
                <button
                  className={`task-cluster-item ${viewMode === "calendar" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={viewMode === "calendar"}
                  onClick={() => {
                    setViewMode("calendar");
                    // When switching to calendar, default to "This week" and show all statuses.
                    onTimeScopeChange("week");
                    setCompletionFilter("all");
                    setOpenCluster(null);
                  }}
                  title="Show tasks on a month calendar with a day agenda timeline."
                >
                  Calendar
                </button>
              </div>
            </div>

            <div
              className={`task-cluster ${openCluster === "status" ? "is-open" : ""}`}
              data-cluster="status"
              onMouseEnter={() => {
                if (openCluster !== "status") openExclusiveCluster("status");
              }}
            >
              <button
                className="task-cluster-trigger"
                type="button"
                aria-haspopup="menu"
                aria-expanded={openCluster === "status"}
                aria-label="Status"
                onClick={() => toggleExclusiveCluster("status")}
                title="Filter tasks by status: Active, Completed, or All."
              >
                Status:{" "}
                {completionFilter === "all"
                  ? "All"
                  : completionFilter === "active"
                    ? "Active"
                    : "Completed"}
              </button>
              <div className="task-cluster-menu" role="menu" aria-label="Status options">
                <button
                  className={`task-cluster-item ${completionFilter === "all" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={completionFilter === "all"}
                  onClick={() => {
                    setCompletionFilter("all");
                    setOpenCluster(null);
                  }}
                  title="Show active and completed tasks."
                >
                  All
                </button>
                <button
                  className={`task-cluster-item ${completionFilter === "active" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={completionFilter === "active"}
                  onClick={() => {
                    setCompletionFilter("active");
                    setOpenCluster(null);
                  }}
                  title="Show only active (not completed) tasks."
                >
                  Active
                </button>
                <button
                  className={`task-cluster-item ${completionFilter === "completed" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={completionFilter === "completed"}
                  onClick={() => {
                    setCompletionFilter("completed");
                    setOpenCluster(null);
                  }}
                  title="Show only completed tasks."
                >
                  Completed
                </button>
              </div>
            </div>

            <div
              className={`task-cluster ${openCluster === "project-assoc" ? "is-open" : ""}`}
              data-cluster="project-assoc"
              onMouseEnter={() => {
                if (openCluster !== "project-assoc") openExclusiveCluster("project-assoc");
              }}
            >
              <button
                className="task-cluster-trigger"
                type="button"
                aria-haspopup="menu"
                aria-expanded={openCluster === "project-assoc"}
                aria-label="Project association"
                onClick={() => toggleExclusiveCluster("project-assoc")}
                title="Filter tasks by project association."
              >
                Project:{" "}
                {projectAssocFilter === "all"
                  ? "All"
                  : projectAssocFilter === "with"
                    ? "With"
                    : "None"}
              </button>
              <div className="task-cluster-menu" role="menu" aria-label="Project association options">
                <button
                  className={`task-cluster-item ${projectAssocFilter === "all" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={projectAssocFilter === "all"}
                  onClick={() => {
                    setProjectAssocFilter("all");
                    setOpenCluster(null);
                  }}
                >
                  All
                </button>
                <button
                  className={`task-cluster-item ${projectAssocFilter === "with" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={projectAssocFilter === "with"}
                  onClick={() => {
                    setProjectAssocFilter("with");
                    setOpenCluster(null);
                  }}
                  title="Show only tasks that belong to a project."
                >
                  With project
                </button>
                <button
                  className={`task-cluster-item ${projectAssocFilter === "none" ? "is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={projectAssocFilter === "none"}
                  onClick={() => {
                    setProjectAssocFilter("none");
                    setOpenCluster(null);
                  }}
                  title="Show only tasks that have no project."
                >
                  No project
                </button>
              </div>
            </div>

            {selectedTaskIds.size > 0 && (
              <div className="task-toolbar-cluster" role="group" aria-label="Bulk actions">
                <button
                  className="ghost-button small"
                  onClick={clearSelection}
                  title="Unselect all selected tasks."
                >
                  Unselect all
                </button>
                <button
                  className="ghost-button small"
                  onClick={() => {
                    const tasksToEdit = tasksWithRepeats.filter((t) => selectedTaskIds.has(t.id));
                    if (!tasksToEdit.length) return;
                    openMultiEditor(tasksToEdit);
                  }}
                  title="Edit all selected tasks (latest due date first)."
                >
                  Edit selected
                </button>
                <button
                  className="ghost-button small"
                  onClick={moveSelected}
                  title="Move all selected tasks to another project."
                >
                  Move selected
                </button>
                <button
                  className="ghost-button small"
                  onClick={deleteSelected}
                  title="Delete all selected tasks."
                >
                  Delete selected
                </button>
              </div>
            )}
          </div>
          <button
            className="primary-button"
            onClick={() =>
              openEditor({
                id: "new",
                title: "",
                description: "",
                priority: "medium",
                labels: [],
                profileId: activeProfileId,
                projectId: selectedProjectId,
                completed: false
              } as Task)
            }
            title="Create a new task."
          >
            Add task
          </button>
        </div>
      </div>

      <div className="task-list">
        {loading && <p className="muted">Loading tasks…</p>}
        {!loading && viewMode === "calendar" && renderCalendar()}
        {!loading && viewMode === "list" && completionFilter !== "completed" &&
          filteredTasks
            .filter(
              (task) => !(completionFilter === "all" && task.completed && isRepeating(task))
            )
            .map((task) => {
              // Only repeating series should have expandable occurrences.
              if (!isRepeating(task)) {
                return renderTaskRow(task);
              }

              const parentKey = canonicalParentKey(task);

              const inTimeScopeForList = (t: Task): boolean => {
                if (!t.dueDate) return timeScope === "all";
                if (timeScope === "all") return true;
                if (timeScope === "yesterday") return t.dueDate === yesterdayIso;
                if (timeScope === "today") return t.dueDate === todayIso;
                if (timeScope === "tomorrow") return t.dueDate === tomorrowIso;
                if (timeScope === "last_week")
                  return t.dueDate >= lastWeekStartIso && t.dueDate <= lastWeekEndIso;
                if (timeScope === "week")
                  return t.dueDate >= startOfWeekMondayIso && t.dueDate <= endOfWeekSundayIso;
                if (timeScope === "next_week")
                  return t.dueDate >= nextWeekStartIso && t.dueDate <= nextWeekEndIso;
                if (timeScope === "sprint")
                  return t.dueDate >= startOfWeekMondayIso && t.dueDate <= endOfSprintIso;
                if (timeScope === "last_month")
                  return t.dueDate >= lastMonthStartIso && t.dueDate <= lastMonthEndIso;
                if (timeScope === "month")
                  return t.dueDate >= thisMonthStartIso && t.dueDate <= thisMonthEndIso;
                if (timeScope === "next_month")
                  return t.dueDate >= nextMonthStartIso && t.dueDate <= nextMonthEndIso;
                if (timeScope === "last_quarter")
                  return t.dueDate >= lastQuarterStartIso && t.dueDate <= lastQuarterEndIso;
                if (timeScope === "quarter")
                  return t.dueDate >= thisQuarterStartIso && t.dueDate <= thisQuarterEndIso;
                if (timeScope === "next_quarter")
                  return t.dueDate >= nextQuarterStartIso && t.dueDate <= nextQuarterEndIso;
                return true;
              };

              // When Status is "All", completed repeating tasks are rendered in the
              // grouped-by-parent completed section. So, for the expand UI here,
              // show active occurrences only.
              const showActiveOnly = completionFilter === "all" || completionFilter === "active";

              const occurrences = tasksWithRepeats
                .filter((t) => isRepeating(t) && canonicalParentKey(t) === parentKey)
                .filter((t) => !t.cancelled)
                .filter((t) => (showActiveOnly ? !t.completed : t.completed))
                .filter((t) => {
                  if (projectAssocFilter === "none") return !hasProject(t);
                  if (selectedProjectId) return t.projectId === selectedProjectId;
                  if (projectAssocFilter === "with") return hasProject(t);
                  return true;
                })
                .filter((t) => inTimeScopeForList(t))
                .filter((t) => matchesTaskSearch(t))
                .slice()
                .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

              const canExpand = occurrences.length >= 1;
              const expanded = expandedGroups.has(parentKey);

              return (
                <div key={task.id}>
                  {renderTaskRow(task)}
                  {canExpand ? (
                    <div style={{ marginTop: "0.35rem", display: "flex", justifyContent: "flex-end" }}>
                      <button
                        className="task-action-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeDropdownAndHover();
                            toggleSingleExpandedGroup(parentKey);
                        }}
                      >
                        {expanded ? "Hide" : "Show"} occurrences
                      </button>
                    </div>
                  ) : null}

                  {canExpand && expanded ? (
                    <div className="completed-group-details">
                      {occurrences.map((item) => renderTaskRow(item, { showChildId: true }))}
                    </div>
                  ) : null}
                </div>
              );
            })}
        {!loading && viewMode === "list" && completionFilter === "all" && groupedByParent &&
          groupedByParent.map(({ key, representative, count, items }) => {
            // Non-recurring tasks must render as a normal task card (no parent grouping).
            if (!isRepeating(representative)) {
              return null;
            }

            return (
              <div key={key}>
                <article className="task-card task-card-completed">
                  <div className="task-main-inner">
                    <div>
                      <div className="task-title">{representative.title}</div>
                      <div className="task-meta-row">
                        {representative.projectId && (
                          <span className="pill subtle">
                            {projects.find((p) => p.id === representative.projectId)?.name ??
                              "Project"}
                          </span>
                        )}
                        <span className="pill subtle">
                          Parent ID: {shortId(canonicalParentKey(representative))}
                        </span>
                      </div>
                    </div>
                    <div className="task-actions">
                      {count >= 1 && items.some((t) => isRepeating(t)) ? (
                        <button
                          className="task-action-button"
                          onClick={() => {
                            closeDropdownAndHover();
                            toggleSingleExpandedGroup(key);
                          }}
                        >
                          {expandedGroups.has(key) ? "Hide" : "Show"} occurrences
                        </button>
                      ) : null}
                      <span className="pill subtle">{count} completed</span>
                    </div>
                  </div>
                </article>
                {count >= 1 && items.some((t) => isRepeating(t)) && expandedGroups.has(key) && (
                  <div className="completed-group-details">
                    {items.map((item) => renderTaskRow(item, { showChildId: true }))}
                  </div>
                )}
              </div>
            );
          })}
        {!loading &&
          viewMode === "list" &&
          completionFilter === "completed" &&
          filteredTasks.filter((t) => !isRepeating(t)).map((task) => renderTaskRow(task))}
        {!loading && viewMode === "list" && completionFilter === "completed" && groupedByParent &&
          groupedByParent.map(({ key, representative, count, items }) => {
            if (!isRepeating(representative)) {
              return null;
            }

            return (
              <div key={key}>
                <article className="task-card task-card-completed">
                  <div className="task-main-inner">
                    <div>
                      <div className="task-title">{representative.title}</div>
                      <div className="task-meta-row">
                        {representative.projectId && (
                          <span className="pill subtle">
                            {projects.find((p) => p.id === representative.projectId)?.name ??
                              "Project"}
                          </span>
                        )}
                        <span className="pill subtle">
                          Parent ID: {shortId(canonicalParentKey(representative))}
                        </span>
                        {items.some((t) => t.durationMinutes !== undefined) && (
                          <span className="pill subtle">
                            Duration{" "}
                            {(() => {
                              const mins =
                                items.find((t) => t.durationMinutes !== undefined)
                                  ?.durationMinutes ?? 0;
                              return mins >= 60
                                ? `${Math.floor(mins / 60)}h${
                                    mins % 60 ? ` ${mins % 60}m` : ""
                                  }`
                                : `${mins}m`;
                            })()}
                          </span>
                        )}
                        {representative.repeat && representative.repeat !== "none" && (
                          <span className="pill subtle">
                            Repeats {representative.repeat}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="task-actions">
                      {count >= 1 && items.some((t) => isRepeating(t)) ? (
                        <button
                          className="task-action-button"
                          onClick={() => {
                            closeDropdownAndHover();
                            toggleSingleExpandedGroup(key);
                          }}
                        >
                          {expandedGroups.has(key) ? "Hide" : "Show"} occurrences
                        </button>
                      ) : null}
                      <span className="pill subtle">{count} completed</span>
                    </div>
                  </div>
                </article>
                {count >= 1 && items.some((t) => isRepeating(t)) && expandedGroups.has(key) && (
                  <div className="completed-group-details">
                    {items.map((item) => renderTaskRow(item, { showChildId: true }))}
                  </div>
                )}
              </div>
            );
          })}
        {!loading &&
          viewMode === "list" &&
          ((completionFilter === "completed" && filteredTasks.length === 0) ||
            (completionFilter === "all" &&
              filteredTasks.filter((task) => !(task.completed && isRepeating(task))).length === 0 &&
              !(groupedByParent?.some(({ representative }) => isRepeating(representative)) ?? false)) ||
            (completionFilter === "active" && filteredTasks.length === 0)) && (
          <div className="empty-state">
            <h3>No tasks yet</h3>
            <p className="muted">
              Start by creating a task with a title, priority, and reminder.
            </p>
          </div>
        )}
        {!loading &&
          viewMode === "list" &&
          timeScope === "all" &&
          historyHasMore && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "0.45rem",
                paddingTop: "0.35rem",
                flexWrap: "wrap"
              }}
            >
              <input
                type="date"
                value={historyJumpDate}
                onChange={(e) => setHistoryJumpDate(e.target.value)}
                className="task-search-input"
                style={{ width: "12rem", maxWidth: "100%" }}
                title="Jump to older tasks near this date."
              />
              <button
                className="ghost-button small"
                type="button"
                onClick={jumpToHistoryDate}
                disabled={historyLoadingMore || !historyJumpDate}
                title="Jump to historical tasks around selected date."
              >
                Jump to date
              </button>
              <button
                className="ghost-button small"
                type="button"
                onClick={loadMoreHistory}
                disabled={historyLoadingMore}
                title="Load older historical tasks."
              >
                {historyLoadingMore ? "Loading history..." : "Load older tasks"}
              </button>
            </div>
          )}
      </div>

      <TaskEditorDrawer
        task={editingTask}
        onClose={() => setEditingTask(null)}
        onLabelsDraftChange={(nextLabels) => {
          if (!editingTask || Array.isArray(editingTask) || editingTask.id === "new") return;

          const updateSeries =
            isRepeating(editingTask) && typeof editingTask.parentId === "string";
          const targetParentId = updateSeries ? editingTask.parentId : null;
          const targetId = updateSeries ? null : editingTask.id;

          setTasks((prev) => {
            let changed = false;
            const next = prev.map((t) => {
              const match = updateSeries ? t.parentId === targetParentId : t.id === targetId;
              if (!match) return t;
              const same =
                (t.labels ?? []).length === nextLabels.length &&
                (t.labels ?? []).every((l, i) => l === nextLabels[i]);
              if (same) return t;
              changed = true;
              return { ...t, labels: nextLabels };
            });
            return changed ? next : prev;
          });

          setHoveredTask((prev) => {
            if (!prev) return prev;
            const match = updateSeries
              ? prev.task.parentId === targetParentId
              : prev.task.id === targetId;
            if (!match) return prev;
            return { ...prev, task: { ...prev.task, labels: nextLabels } };
          });
        }}
        onLinksDraftChange={(nextLinks) => {
          if (!editingTask || Array.isArray(editingTask) || editingTask.id === "new") return;

          const updateSeries =
            isRepeating(editingTask) && typeof editingTask.parentId === "string";
          const targetParentId = updateSeries ? editingTask.parentId : null;
          const targetId = updateSeries ? null : editingTask.id;

          setTasks((prev) => {
            let changed = false;
            const next = prev.map((t) => {
              const match = updateSeries ? t.parentId === targetParentId : t.id === targetId;
              if (!match) return t;

              const same =
                (t.link ?? []).length === nextLinks.length &&
                (t.link ?? []).every((l, i) => l === nextLinks[i]);

              if (same) return t;
              changed = true;
              return { ...t, link: nextLinks };
            });
            return changed ? next : prev;
          });

          setHoveredTask((prev) => {
            if (!prev) return prev;
            const match = updateSeries
              ? prev.task.parentId === targetParentId
              : prev.task.id === targetId;
            if (!match) return prev;
            return { ...prev, task: { ...prev.task, link: nextLinks } };
          });
        }}
        onSave={(updatedOrMany) => {
          const save = async () => {
            if (isShowcaseReadOnlyActive) {
              notifyShowcaseReadOnly();
              setEditingTask(null);
              return;
            }
            const createOne = async (
              updated: Task,
              opts?: {
                silentSuccess?: boolean;
                silentError?: boolean;
                suppressNotify?: boolean;
                suppressLocalAppend?: boolean;
              }
            ) => {
              const started = performance.now();
              const res = await apiFetch("/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  title: updated.title,
                  description: updated.description,
                  priority: updated.priority,
                  dueDate: updated.dueDate,
                  dueTime: updated.dueTime,
                  durationMinutes: updated.durationMinutes,
                  repeat: updated.repeat ?? "none",
                  repeatEvery: updated.repeatEvery,
                  repeatUnit: updated.repeatUnit,
                  labels: updated.labels,
                  location: updated.location,
                  link: updated.link,
                  reminderMinutesBefore: updated.reminderMinutesBefore,
                  profileId: updated.profileId ?? activeProfileId,
                  projectId: updated.projectId,
                  parentId: updated.parentId,
                  childId: updated.childId
                })
              });
              if (res.ok) {
                const created: Task = await res.json();
                if (!opts?.suppressLocalAppend) {
                  setTasks((prev) => [...prev, created]);
                }
                if (!opts?.suppressNotify) notifyTasksChanged();
                if (!opts?.silentSuccess) {
                  toast({
                    kind: "success",
                    title: "Task created",
                    message: `Created: ${created.title}`,
                    durationMs: performance.now() - started
                  });
                }
                return created;
              }
              if (!opts?.silentError) {
                const message = await getFriendlyErrorMessage(res);
                toast({
                  kind: "error",
                  title: "Create failed",
                  message,
                  durationMs: performance.now() - started
                });
              }
              return null;
            };

            if (Array.isArray(updatedOrMany)) {
              const allNew = updatedOrMany.every((t) => t.id === "new");
              if (allNew) {
                // Batch create.
                const started = performance.now();
                const createCandidates = updatedOrMany.filter((t) => t.title.trim());
                const results = await Promise.all(
                  createCandidates.map((t) =>
                    createOne(t, {
                      silentSuccess: true,
                      silentError: true,
                      suppressNotify: true,
                      suppressLocalAppend: true
                    })
                  )
                );
                const createdBatch = results.filter((t): t is Task => !!t);
                const okCount = createdBatch.length;
                if (createdBatch.length > 0) {
                  setTasks((prev) => [...prev, ...createdBatch]);
                  notifyTasksChanged();
                }
                if (okCount === 0) void refreshTasks();
                toast({
                  kind: okCount > 0 ? "success" : "error",
                  title: okCount > 0 ? "Tasks created" : "Create failed",
                  message: `Created ${okCount} task(s).`,
                  durationMs: performance.now() - started
                });
                logSlowAction("batchCreateTasks", started);
                setEditingTask(null);
                return;
              }

              // Batch edit: update in one backend call.
              const started = performance.now();
              const updates: Array<{ id: string; task: Task }> = [];
              for (const updated of updatedOrMany) {
                if (!updated.title.trim()) continue;
                let target = updated;
                if (updated.virtual) {
                  const created = await materializeVirtualTask(updated);
                  if (!created) continue;
                  target = { ...updated, ...created, id: created.id, virtual: false };
                }
                const { deadlineDate: _deadlineDate, deadlineTime: _deadlineTime, virtual: _virtual, ...rest } =
                  target;
                updates.push({ id: target.id, task: rest as Task });
              }
              const res = await apiFetch("/api/tasks/batch-update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ updates })
              });
              const savedById = new Map<string, Task>();
              let okCount = 0;
              if (res.ok) {
                const out = (await res.json()) as { updated?: Task[] };
                for (const saved of out.updated ?? []) {
                  savedById.set(saved.id, saved);
                }
                okCount = savedById.size;
              }
              if (savedById.size > 0) {
                setTasks((prev) =>
                  prev.map((t) => savedById.get(t.id) ?? t)
                );
                notifyTasksChanged();
              }
              if (okCount === 0) void refreshTasks({ silent: true });
              toast({
                kind: okCount > 0 ? "success" : "error",
                title: okCount > 0 ? "Tasks updated" : "Update failed",
                message: `Updated ${okCount} task(s).`,
                durationMs: performance.now() - started
              });
              logSlowAction("batchUpdateTasks", started);
              setEditingTask(null);
              return;
            }

            const updated = updatedOrMany;
            if (updated.id === "new") {
              const created = await createOne(updated);
              if (!created) void refreshTasks({ silent: true });
            } else {
              const started = performance.now();
              let target = updated;
              if (updated.virtual) {
                const created = await materializeVirtualTask(updated);
                if (!created) {
                  void refreshTasks({ silent: true });
                  return;
                }
                target = { ...updated, ...created, id: created.id, virtual: false };
              }
              const { deadlineDate: _deadlineDate, deadlineTime: _deadlineTime, virtual: _virtual, ...rest } =
                target;
              const res = await apiFetch(`/api/tasks/${target.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(rest)
              });
              if (res.ok) {
                const saved: Task = await res.json();
                setTasks((prev) =>
                  prev.map((t) => (t.id === saved.id ? saved : t))
                );
                notifyTasksChanged();
                toast({
                  kind: "success",
                  title: "Task updated",
                  message: `Updated: ${saved.title}`,
                  durationMs: performance.now() - started
                });
              } else {
                const message = await getFriendlyErrorMessage(res);
                void refreshTasks({ silent: true });
                toast({
                  kind: "error",
                  title: "Update failed",
                  message,
                  durationMs: performance.now() - started
                });
              }
              logSlowAction("updateTask", started);
            }
            setEditingTask(null);
          };
          void save();
        }}
      />
      {moveDialogTasks && (
        <div className="drawer-backdrop" onClick={() => setMoveDialogTasks(null)}>
          <aside
            className="drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="drawer-header">
              <h2>Move {moveDialogTasks.length} task{moveDialogTasks.length > 1 ? "s" : ""}</h2>
            </header>
            <div className="drawer-body">
              <label className="field">
                <span>Destination project</span>
                <select
                  value={moveDialogProjectId ?? "none"}
                  onChange={(e) =>
                    setMoveDialogProjectId(
                      e.target.value === "none"
                        ? null
                        : e.target.value === "same"
                          ? "same"
                          : e.target.value
                    )
                  }
                  title="Choose a destination project for the selected task(s)."
                >
                  <option value="same">Keep current project</option>
                  <option value="none">(none) – All tasks</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <footer className="drawer-footer">
              <button
                className="ghost-button"
                onClick={() => setMoveDialogTasks(null)}
                title="Close without moving tasks."
              >
                Cancel
              </button>
              <button
                className="primary-button"
                onClick={confirmMove}
                title="Confirm moving tasks to the chosen project."
              >
                Move
              </button>
            </footer>
          </aside>
        </div>
      )}
      {exportDialogOpen && (
        <div className="drawer-backdrop" onClick={() => setExportDialogOpen(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <header className="drawer-header">
              <h2>Export data</h2>
            </header>
            <div className="drawer-body">
              {(() => {
                const lockedProfiles = exportProfiles.filter((p) => p.isPasswordProtected);
                return (
                  <>
              <label className="field">
                <span>Format</span>
                <select
                  value={exportFormat}
                  onChange={(e) =>
                    setExportFormat(e.target.value as "json" | "csv" | "both")
                  }
                  title="Choose export format."
                >
                  <option value="json">JSON (recommended)</option>
                  <option value="csv">CSV</option>
                  <option value="both">Both (JSON + CSV)</option>
                </select>
              </label>
              <p className="muted" style={{ marginTop: "0.5rem" }}>
                Exports merged profiles, projects, and tasks in a single file.
              </p>
              {lockedProfiles.length > 0 ? (
                <label className="field" style={{ marginTop: "0.65rem" }}>
                  <span>Locked profiles data</span>
                  <select
                    value={exportIncludeLockedProfiles ? "include" : "exclude"}
                    onChange={(e) => setExportIncludeLockedProfiles(e.target.value === "include")}
                    title="Choose whether to include data associated with locked profiles."
                  >
                    <option value="exclude">Exclude locked profiles</option>
                    <option value="include">Include locked profiles (enter passwords)</option>
                  </select>
                </label>
              ) : null}
              {lockedProfiles.length > 0 && exportIncludeLockedProfiles ? (
                <div className="export-lock-panel" role="group" aria-label="Locked profile passwords">
                  <div className="export-lock-panel-head">
                    <strong>Locked profiles</strong>
                    <span className="muted">{lockedProfiles.length} profile(s) need password for encrypted hash export</span>
                  </div>
                  <div className="export-lock-list">
                    {lockedProfiles.map((profile) => (
                      <label className="field export-lock-item" key={profile.id}>
                        <span>{profile.name}</span>
                        <div className="password-input-row">
                          <input
                            type={showExportProfilePasswords[profile.id] ? "text" : "password"}
                            value={exportProfilePasswords[profile.id] ?? ""}
                            onChange={(e) =>
                              setExportProfilePasswords((prev) => ({
                                ...prev,
                                [profile.id]: e.target.value
                              }))
                            }
                            placeholder="Enter profile password"
                          />
                          <button
                            className="ghost-button small"
                            type="button"
                            onClick={() =>
                              setShowExportProfilePasswords((prev) => ({
                                ...prev,
                                [profile.id]: !prev[profile.id]
                              }))
                            }
                          >
                            {showExportProfilePasswords[profile.id] ? "Hide" : "Show"}
                          </button>
                        </div>
                      </label>
                    ))}
                  </div>
                  <p className="muted export-lock-tip">
                    Wrong or empty password will exclude that locked profile and its related projects/tasks.
                  </p>
                </div>
              ) : null}
              {exportPreparing ? (
                <p className="muted" style={{ marginTop: "0.5rem" }}>
                  Preparing profile locks...
                </p>
              ) : null}
                  </>
                );
              })()}
            </div>
            <footer className="drawer-footer">
              <button
                className="ghost-button"
                onClick={() => setExportDialogOpen(false)}
                title="Close without exporting."
              >
                Cancel
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  const run = async () => {
                    const ok = await exportAllData(exportFormat);
                    if (ok) setExportDialogOpen(false);
                  };
                  void run();
                }}
                title="Download an export file containing all profiles, projects, and tasks."
              >
                Download
              </button>
            </footer>
          </aside>
        </div>
      )}
    </section>
  );
}

