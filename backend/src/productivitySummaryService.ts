/**
 * Productivity Summary — Groq + Tavily orchestration over profile-scoped tasks.
 * Secrets stay server-side (GROQ_API_KEY, TAVILY_API_KEY).
 */

export type SummaryPeriod =
  | "day"
  | "week"
  | "sprint"
  | "month"
  | "bimonth"
  | "quarter"
  | "semester"
  | "year"
  | "next_day"
  | "next_week"
  | "next_sprint"
  | "next_month"
  | "next_quarter"
  | "next_semester"
  | "next_year"
  | "custom";

export type SummaryTask = {
  id: string;
  title: string;
  description?: string;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate?: string;
  completed: boolean;
  completedAt?: string;
  cancelled?: boolean;
  projectId?: string | null;
  labels?: string[];
};

export type SummaryProject = {
  id: string;
  name: string;
};

export type DateRange = {
  startDate: string;
  endDate: string;
  period: SummaryPeriod;
  label: string;
};

export type TaskDigestStats = {
  totalInRange: number;
  completed: number;
  active: number;
  cancelled: number;
  overdue: number;
  completionRate: number;
  byPriority: Record<string, number>;
  byProject: Array<{ projectId: string | null; name: string; total: number; completed: number }>;
};

export type DigestTaskRef = {
  id: string;
  title: string;
  priority: SummaryTask["priority"];
  dueDate?: string;
  projectName: string;
};

export type TaskDigest = {
  range: DateRange;
  stats: TaskDigestStats;
  /** Compact task lines for the LLM (capped). */
  highlights: string[];
  /** Open (incomplete, not cancelled) tasks with id + title for listing sections. */
  openTasks: DigestTaskRef[];
  /** Overdue subset of open tasks (dueDate before today). */
  overdueTasks: DigestTaskRef[];
  empty: boolean;
};

export type WebSource = {
  title: string;
  url: string;
  snippet?: string;
};

export type SummaryResult = {
  summary: string;
  range: DateRange;
  stats: TaskDigestStats;
  sources: WebSource[];
  model: string;
  enriched: boolean;
  /** True when a local digest brief was returned because Groq failed. */
  degraded?: boolean;
};

export type AskResult = {
  answer: string;
  range: DateRange | null;
  stats: TaskDigestStats | null;
  sources: WebSource[];
  model: string;
  enriched: boolean;
  /** True when a local digest answer was returned because Groq failed. */
  degraded?: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Keep LLM prompts small to stay under Groq free-tier token budgets. */
const MAX_HIGHLIGHTS = 12;
const MAX_OPEN_LIST = 25;
const MAX_OVERDUE_LIST = 25;
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const FALLBACK_GROQ_MODEL = "llama-3.1-8b-instant";
const MAX_COMPLETION_TOKENS = 900;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const TAVILY_URL = "https://api.tavily.com/search";

export function isoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysLocal(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

export function startOfWeekMonday(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
  const dow = x.getDay(); // 0=Sun..6=Sat
  const delta = dow === 0 ? -6 : 1 - dow;
  return addDaysLocal(x, delta);
}

export function endOfWeekSunday(d: Date): Date {
  return addDaysLocal(startOfWeekMonday(d), 6);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 12, 0, 0);
}

function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q, 1, 12, 0, 0);
}

function endOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q + 3, 0, 12, 0, 0);
}

function parseIsoDate(iso: string): Date | null {
  if (!ISO_DATE.test(iso)) return null;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Resolve a named period (or custom range) to inclusive local calendar dates.
 */
export function resolvePeriodRange(
  period: SummaryPeriod,
  now: Date = new Date(),
  customStart?: string,
  customEnd?: string
): DateRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);

  if (period === "custom") {
    const start = customStart ? parseIsoDate(customStart) : null;
    const end = customEnd ? parseIsoDate(customEnd) : null;
    if (!start || !end) {
      throw new PeriodRangeError("Custom period requires valid startDate and endDate (YYYY-MM-DD).");
    }
    if (isoDateLocal(start) > isoDateLocal(end)) {
      throw new PeriodRangeError("startDate must be on or before endDate.");
    }
    return {
      period,
      startDate: isoDateLocal(start),
      endDate: isoDateLocal(end),
      label: `${isoDateLocal(start)} → ${isoDateLocal(end)}`
    };
  }

  let start: Date;
  let end: Date;
  let label: string;

  switch (period) {
    case "day":
      start = today;
      end = today;
      label = "Today";
      break;
    case "week":
      start = startOfWeekMonday(today);
      end = endOfWeekSunday(today);
      label = "This week (Mon–Sun)";
      break;
    case "sprint":
      start = startOfWeekMonday(today);
      end = addDaysLocal(start, 13);
      label = "Current sprint (2 weeks)";
      break;
    case "month":
      start = startOfMonth(today);
      end = endOfMonth(today);
      label = "This month";
      break;
    case "bimonth": {
      const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1, 12, 0, 0);
      start = startOfMonth(prevMonth);
      end = endOfMonth(today);
      label = "Bi-month (last 2 months)";
      break;
    }
    case "quarter":
      start = startOfQuarter(today);
      end = endOfQuarter(today);
      label = "This quarter";
      break;
    case "semester": {
      const half = today.getMonth() < 6 ? 0 : 6;
      start = new Date(today.getFullYear(), half, 1, 12, 0, 0);
      end = new Date(today.getFullYear(), half + 6, 0, 12, 0, 0);
      label = half === 0 ? "H1 (Jan–Jun)" : "H2 (Jul–Dec)";
      break;
    }
    case "year":
      start = new Date(today.getFullYear(), 0, 1, 12, 0, 0);
      end = new Date(today.getFullYear(), 11, 31, 12, 0, 0);
      label = `Year ${today.getFullYear()}`;
      break;
    case "next_day":
      start = addDaysLocal(today, 1);
      end = start;
      label = "Tomorrow";
      break;
    case "next_week": {
      const thisMonday = startOfWeekMonday(today);
      start = addDaysLocal(thisMonday, 7);
      end = addDaysLocal(start, 6);
      label = "Next week (Mon–Sun)";
      break;
    }
    case "next_sprint": {
      const thisMonday = startOfWeekMonday(today);
      start = addDaysLocal(thisMonday, 14);
      end = addDaysLocal(start, 13);
      label = "Next sprint (2 weeks)";
      break;
    }
    case "next_month": {
      const nm = new Date(today.getFullYear(), today.getMonth() + 1, 1, 12, 0, 0);
      start = startOfMonth(nm);
      end = endOfMonth(nm);
      label = "Next month";
      break;
    }
    case "next_quarter": {
      const thisQStart = startOfQuarter(today);
      const nq = new Date(thisQStart.getFullYear(), thisQStart.getMonth() + 3, 1, 12, 0, 0);
      start = startOfQuarter(nq);
      end = endOfQuarter(nq);
      label = "Next quarter";
      break;
    }
    case "next_semester": {
      const half = today.getMonth() < 6 ? 0 : 6;
      if (half === 0) {
        start = new Date(today.getFullYear(), 6, 1, 12, 0, 0);
        end = new Date(today.getFullYear(), 12, 0, 12, 0, 0);
        label = "Next half year (H2)";
      } else {
        start = new Date(today.getFullYear() + 1, 0, 1, 12, 0, 0);
        end = new Date(today.getFullYear() + 1, 6, 0, 12, 0, 0);
        label = "Next half year (H1)";
      }
      break;
    }
    case "next_year":
      start = new Date(today.getFullYear() + 1, 0, 1, 12, 0, 0);
      end = new Date(today.getFullYear() + 1, 11, 31, 12, 0, 0);
      label = `Year ${today.getFullYear() + 1}`;
      break;
    default: {
      const _exhaustive: never = period;
      throw new PeriodRangeError(`Unknown period: ${String(_exhaustive)}`);
    }
  }

  return {
    period,
    startDate: isoDateLocal(start),
    endDate: isoDateLocal(end),
    label
  };
}

export class PeriodRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeriodRangeError";
  }
}

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

export class ProviderRequestError extends Error {
  status?: number;
  retryAfterMinutes?: number;

  constructor(
    message: string,
    opts?: { status?: number; retryAfterMinutes?: number }
  ) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = opts?.status;
    this.retryAfterMinutes = opts?.retryAfterMinutes;
  }
}

function extractRetryMinutes(body: string): number | undefined {
  const mins = body.match(/try again in\s+(\d+)\s*m/i);
  if (mins) return Number(mins[1]);
  const secs = body.match(/try again in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (secs) return Math.max(1, Math.ceil(Number(secs[1]) / 60));
  return undefined;
}

/** Progress day: due date when set, else completion timestamp (matches /api/stats). */
export function taskProgressDate(t: SummaryTask): string | null {
  if (t.completed) {
    if (t.dueDate && ISO_DATE.test(t.dueDate)) return t.dueDate;
    if (t.completedAt) {
      const d = new Date(t.completedAt);
      if (!Number.isNaN(d.getTime())) return isoDateLocal(d);
    }
  }
  if (t.dueDate && ISO_DATE.test(t.dueDate)) return t.dueDate;
  return null;
}

function inRange(iso: string | null, range: DateRange): boolean {
  if (!iso) return false;
  return iso >= range.startDate && iso <= range.endDate;
}

function projectName(projects: SummaryProject[], projectId: string | null | undefined): string {
  if (!projectId) return "Unassigned";
  return projects.find((p) => p.id === projectId)?.name ?? "Unknown project";
}

/**
 * Build a compact, non-hallucinating digest of tasks in range for LLM prompts.
 */
export function buildTaskDigest(
  tasks: SummaryTask[],
  projects: SummaryProject[],
  range: DateRange,
  nowIso: string = isoDateLocal(new Date())
): TaskDigest {
  const inScope = tasks.filter((t) => {
    if (t.cancelled) {
      const d = taskProgressDate(t) ?? t.dueDate ?? null;
      return inRange(d ?? null, range);
    }
    const d = taskProgressDate(t);
    if (d) return inRange(d, range);
    // Undated active tasks: include for near-term scopes so Q&A / planning can see open work
    if (
      !t.completed &&
      (range.period === "day" ||
        range.period === "week" ||
        range.period === "sprint" ||
        range.period === "next_day" ||
        range.period === "next_week" ||
        range.period === "next_sprint")
    ) {
      return true;
    }
    return false;
  });

  const byPriority: Record<string, number> = { low: 0, medium: 0, high: 0, urgent: 0 };
  const projectMap = new Map<string | null, { total: number; completed: number }>();

  let completed = 0;
  let active = 0;
  let cancelled = 0;
  let overdue = 0;

  for (const t of inScope) {
    byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
    const key = t.projectId ?? null;
    const row = projectMap.get(key) ?? { total: 0, completed: 0 };
    row.total += 1;
    if (t.completed) row.completed += 1;
    projectMap.set(key, row);

    if (t.cancelled) cancelled += 1;
    else if (t.completed) completed += 1;
    else {
      active += 1;
      if (t.dueDate && t.dueDate < nowIso) overdue += 1;
    }
  }

  const totalInRange = inScope.length;
  const completionRate =
    totalInRange - cancelled > 0
      ? Math.round((completed / (totalInRange - cancelled)) * 1000) / 10
      : 0;

  const byProject = Array.from(projectMap.entries())
    .map(([projectId, v]) => ({
      projectId,
      name: projectName(projects, projectId),
      total: v.total,
      completed: v.completed
    }))
    .sort((a, b) => b.total - a.total);

  const toRef = (t: SummaryTask): DigestTaskRef => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    dueDate: t.dueDate,
    projectName: projectName(projects, t.projectId)
  });

  const openSorted = inScope
    .filter((t) => !t.completed && !t.cancelled)
    .sort((a, b) => {
      const aLate = a.dueDate && a.dueDate < nowIso ? 1 : 0;
      const bLate = b.dueDate && b.dueDate < nowIso ? 1 : 0;
      if (bLate !== aLate) return bLate - aLate;
      const rank = { urgent: 4, high: 3, medium: 2, low: 1 };
      return (rank[b.priority] ?? 0) - (rank[a.priority] ?? 0);
    });

  const overdueSorted = openSorted.filter((t) => t.dueDate && t.dueDate < nowIso);

  const openTasks = openSorted.slice(0, MAX_OPEN_LIST).map(toRef);
  const overdueTasks = overdueSorted.slice(0, MAX_OVERDUE_LIST).map(toRef);

  // Prefer overdue / high priority / incomplete in highlights
  const ranked = [...inScope].sort((a, b) => {
    const score = (t: SummaryTask) => {
      let s = 0;
      if (!t.completed && !t.cancelled && t.dueDate && t.dueDate < nowIso) s += 100;
      if (t.priority === "urgent") s += 40;
      else if (t.priority === "high") s += 30;
      else if (t.priority === "medium") s += 15;
      if (!t.completed && !t.cancelled) s += 10;
      return s;
    };
    return score(b) - score(a);
  });

  const highlights = ranked.slice(0, MAX_HIGHLIGHTS).map((t) => {
    const status = t.cancelled ? "cancelled" : t.completed ? "done" : "open";
    const due = t.dueDate ? ` due=${t.dueDate}` : "";
    const proj = ` project=${projectName(projects, t.projectId)}`;
    return `- id=${t.id} [${status}] (${t.priority}) "${t.title}"${due}${proj}`;
  });

  return {
    range,
    stats: {
      totalInRange,
      completed,
      active,
      cancelled,
      overdue,
      completionRate,
      byPriority,
      byProject
    },
    highlights,
    openTasks,
    overdueTasks,
    empty: totalInRange === 0
  };
}

function formatTaskRefLine(t: DigestTaskRef): string {
  const due = t.dueDate ? `, due ${t.dueDate}` : "";
  return `- "${t.title}" (ID: ${t.id}, ${t.priority}${due})`;
}

function digestPromptBlock(digest: TaskDigest): string {
  const { stats, range, highlights, openTasks, overdueTasks, empty } = digest;
  if (empty) {
    return `Period: ${range.label} (${range.startDate} to ${range.endDate})\nNo tasks found in this period.`;
  }
  const projects = stats.byProject
    .slice(0, 8)
    .map((p) => `  - ${p.name}: ${p.completed}/${p.total}`)
    .join("\n");

  const openBlock =
    openTasks.length === 0
      ? "Open tasks: none"
      : [
          `Open tasks (${openTasks.length}${stats.active > openTasks.length ? ` of ${stats.active}` : ""}):`,
          ...openTasks.map(formatTaskRefLine)
        ].join("\n");

  const overdueBlock =
    overdueTasks.length === 0
      ? "Overdue tasks: none"
      : [
          `Overdue tasks (${overdueTasks.length}${stats.overdue > overdueTasks.length ? ` of ${stats.overdue}` : ""}):`,
          ...overdueTasks.map(formatTaskRefLine)
        ].join("\n");

  // Prefer open/overdue lists; only add a short completed sample to save tokens.
  const completedSample = highlights.filter((h) => h.includes("[done]")).slice(0, 8);
  const sampleBlock =
    completedSample.length > 0
      ? `Completed sample:\n${completedSample.join("\n")}`
      : highlights.length > 0
        ? `Task sample:\n${highlights.slice(0, 8).join("\n")}`
        : "";

  return [
    `Period: ${range.label} (${range.startDate} to ${range.endDate})`,
    `Stats: total=${stats.totalInRange}, completed=${stats.completed}, active=${stats.active}, cancelled=${stats.cancelled}, overdue=${stats.overdue}, completionRate=${stats.completionRate}%`,
    `Priority: low=${stats.byPriority.low ?? 0}, medium=${stats.byPriority.medium ?? 0}, high=${stats.byPriority.high ?? 0}, urgent=${stats.byPriority.urgent ?? 0}`,
    `Projects:\n${projects || "  (none)"}`,
    openBlock,
    overdueBlock,
    sampleBlock
  ]
    .filter(Boolean)
    .join("\n");
}

/** Deterministic plain-English brief when Groq is rate-limited or unavailable. */
export function buildLocalDigestBrief(digest: TaskDigest): string {
  const { range, stats, openTasks, overdueTasks, empty } = digest;
  if (empty) {
    return `No tasks were found for ${range.label} (${range.startDate} to ${range.endDate}). Add or schedule work in this timeline, then generate again.`;
  }

  const activeDenom = Math.max(0, stats.totalInRange - stats.cancelled);
  const projectBits = stats.byProject
    .slice(0, 5)
    .map((p) => `${p.name} (${p.completed}/${p.total})`)
    .join("; ");

  const parts: string[] = [];
  parts.push(
    `For ${range.label} (${range.startDate} to ${range.endDate}), ${stats.completed} of ${activeDenom} active tasks were completed (${stats.completionRate}% completion rate).` +
      (projectBits ? ` Work was distributed across: ${projectBits}.` : "")
  );

  if (stats.active === 0 && stats.overdue === 0) {
    parts.push("There are no open or overdue tasks in this timeline.");
  } else {
    parts.push(
      `There are ${stats.active} open task${stats.active === 1 ? "" : "s"}, including ${stats.overdue} overdue.`
    );
  }

  if (openTasks.length > 0) {
    parts.push(
      `Open tasks:\n${openTasks.map((t) => `- "${t.title}" (ID: ${t.id})`).join("\n")}`
    );
  }
  if (overdueTasks.length > 0) {
    parts.push(
      `Overdue tasks:\n${overdueTasks.map((t) => `- "${t.title}" (ID: ${t.id})`).join("\n")}`
    );
  }

  parts.push(
    "Next step: review any open or overdue items above, then refresh when AI writing is available again."
  );
  parts.push("(Local timeline brief — AI writing was temporarily unavailable.)");
  return parts.join("\n\n");
}

/** Deterministic Ask answer from the digest when Groq is unavailable. */
export function buildLocalAskAnswer(digest: TaskDigest, question: string): string {
  const q = question.toLowerCase();
  if (digest.empty) {
    return `That information is not in the selected timeline. No tasks were found for ${digest.range.label}.\n\n(Local answer — AI writing was temporarily unavailable.)`;
  }

  const wantsOverdue = /overdue|late|past due|missed/.test(q);
  const wantsOpen = /open|remaining|incomplete|left|todo|to-do|active/.test(q);
  const wantsDone = /finish|finished|complet|done|accomplish/.test(q);
  const wantsFocus = /focus|next|priorit|urgent|important/.test(q);

  const parts: string[] = [];

  if (wantsOverdue || (!wantsOpen && !wantsDone && /what/.test(q) && /overdue|late/.test(q))) {
    if (digest.overdueTasks.length === 0) {
      parts.push(`There are no overdue tasks in ${digest.range.label}.`);
    } else {
      parts.push(
        `There are ${digest.stats.overdue} overdue task${digest.stats.overdue === 1 ? "" : "s"} in ${digest.range.label}.`
      );
      parts.push(
        `Overdue tasks:\n${digest.overdueTasks.map((t) => `- "${t.title}" (ID: ${t.id})`).join("\n")}`
      );
    }
  } else if (wantsOpen) {
    if (digest.openTasks.length === 0) {
      parts.push(`There are no open tasks in ${digest.range.label}.`);
    } else {
      parts.push(
        `There are ${digest.stats.active} open task${digest.stats.active === 1 ? "" : "s"} in ${digest.range.label}.`
      );
      parts.push(
        `Open tasks:\n${digest.openTasks.map((t) => `- "${t.title}" (ID: ${t.id})`).join("\n")}`
      );
    }
  } else if (wantsDone) {
    parts.push(
      `In ${digest.range.label}, ${digest.stats.completed} task${digest.stats.completed === 1 ? " was" : "s were"} completed (${digest.stats.completionRate}% completion rate).`
    );
  } else if (wantsFocus) {
    if (digest.overdueTasks.length > 0) {
      parts.push("Focus next on overdue work:");
      parts.push(
        `Overdue tasks:\n${digest.overdueTasks
          .slice(0, 8)
          .map((t) => `- "${t.title}" (ID: ${t.id})`)
          .join("\n")}`
      );
    } else if (digest.openTasks.length > 0) {
      const urgent = digest.openTasks.filter(
        (t) => t.priority === "urgent" || t.priority === "high"
      );
      const list = (urgent.length > 0 ? urgent : digest.openTasks).slice(0, 8);
      parts.push("Focus next on these open items:");
      parts.push(`Open tasks:\n${list.map((t) => `- "${t.title}" (ID: ${t.id})`).join("\n")}`);
    } else {
      parts.push(
        `There is no open or overdue work in ${digest.range.label}. Plan the next period when ready.`
      );
    }
  } else {
    parts.push(
      `For ${digest.range.label}: ${digest.stats.completed} completed, ${digest.stats.active} open, ${digest.stats.overdue} overdue (${digest.stats.completionRate}% completion rate). Ask about overdue, open, finished, or focus items for a detailed list.`
    );
  }

  parts.push("(Local answer — AI writing was temporarily unavailable.)");
  return parts.join("\n\n");
}

export function resolveGroqApiKey(override?: string | null): string | undefined {
  const fromClient = override?.trim();
  if (fromClient) return fromClient;
  return process.env.GROQ_API_KEY?.trim() || undefined;
}

export function resolveTavilyApiKey(override?: string | null): string | undefined {
  const fromClient = override?.trim();
  if (fromClient) return fromClient;
  return process.env.TAVILY_API_KEY?.trim() || undefined;
}

/** @deprecated Prefer resolveGroqApiKey — kept for callers that only use env. */
export function getGroqApiKey(): string | undefined {
  return resolveGroqApiKey();
}

/** @deprecated Prefer resolveTavilyApiKey — kept for callers that only use env. */
export function getTavilyApiKey(): string | undefined {
  return resolveTavilyApiKey();
}

export function getGroqModel(): string {
  return process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;
}

export type AiKeyProvider = "groq" | "tavily";

export type AiKeyValidationResult = {
  provider: AiKeyProvider;
  valid: boolean;
  reason?: string;
};

/** Lightweight format check (no network). */
export function assessAiKeyFormat(
  provider: AiKeyProvider,
  apiKey: string
): { ok: boolean; reason?: string } {
  const key = apiKey.trim();
  if (!key) return { ok: false, reason: "Enter an API key." };
  if (provider === "groq") {
    if (!/^gsk_[A-Za-z0-9_-]{20,}$/.test(key)) {
      return { ok: false, reason: "Groq keys usually start with gsk_." };
    }
    return { ok: true };
  }
  if (!/^tvly[-_][A-Za-z0-9_-]{8,}$/i.test(key)) {
    return { ok: false, reason: "Tavily keys usually start with tvly-." };
  }
  return { ok: true };
}

/** Live check against the provider. Never log the key. */
export async function validateAiApiKey(
  provider: AiKeyProvider,
  apiKey: string
): Promise<AiKeyValidationResult> {
  const format = assessAiKeyFormat(provider, apiKey);
  if (!format.ok) {
    return { provider, valid: false, reason: format.reason };
  }
  const key = apiKey.trim();

  try {
    if (provider === "groq") {
      const res = await fetch("https://api.groq.com/openai/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` }
      });
      if (res.ok) return { provider, valid: true };
      if (res.status === 401 || res.status === 403) {
        return { provider, valid: false, reason: "This Groq key was rejected." };
      }
      if (res.status === 429) {
        return {
          provider,
          valid: true,
          reason: "Key accepted, but Groq is rate-limiting right now."
        };
      }
      return { provider, valid: false, reason: `Groq check failed (${res.status}).` };
    }

    const res = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query: "productivity",
        max_results: 1,
        search_depth: "basic",
        include_answer: false
      })
    });
    if (res.ok) return { provider, valid: true };
    if (res.status === 401 || res.status === 403) {
      return { provider, valid: false, reason: "This Tavily key was rejected." };
    }
    if (res.status === 429) {
      return {
        provider,
        valid: true,
        reason: "Key accepted, but Tavily is rate-limiting right now."
      };
    }
    return { provider, valid: false, reason: `Tavily check failed (${res.status}).` };
  } catch (err) {
    console.error(`[ai-keys] ${provider} validate network error:`, err);
    return {
      provider,
      valid: false,
      reason: "Could not reach the provider to validate this key."
    };
  }
}

export async function searchTavily(
  query: string,
  apiKey: string,
  maxResults = 4
): Promise<WebSource[]> {
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: query.slice(0, 390),
      max_results: maxResults,
      search_depth: "basic",
      include_answer: false
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ProviderRequestError(
      `Tavily search failed (${res.status}): ${text.slice(0, 200) || res.statusText}`
    );
  }
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (data.results ?? [])
    .filter((r) => r.url && r.title)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      snippet: r.content?.slice(0, 280)
    }));
}

export async function completeWithGroq(
  system: string,
  user: string,
  apiKey: string,
  model: string = getGroqModel(),
  maxTokens: number = MAX_COMPLETION_TOKENS
): Promise<{ text: string; model: string }> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ProviderRequestError(
      `Groq completion failed (${res.status}): ${text.slice(0, 240) || res.statusText}`,
      {
        status: res.status,
        retryAfterMinutes: extractRetryMinutes(text)
      }
    );
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new ProviderRequestError("Groq returned an empty response.");
  }
  return { text, model: data.model ?? model };
}

async function completeWithGroqResilient(
  system: string,
  user: string,
  apiKey: string
): Promise<{ text: string; model: string }> {
  const primary = getGroqModel();
  try {
    return await completeWithGroq(system, user, apiKey, primary);
  } catch (err) {
    const isRateLimited =
      err instanceof ProviderRequestError && (err.status === 429 || /rate limit/i.test(err.message));
    const isServerError =
      err instanceof ProviderRequestError && typeof err.status === "number" && err.status >= 500;
    if ((isRateLimited || isServerError) && primary !== FALLBACK_GROQ_MODEL) {
      try {
        return await completeWithGroq(system, user, apiKey, FALLBACK_GROQ_MODEL, 700);
      } catch {
        throw err;
      }
    }
    throw err;
  }
}

async function optionalWebEnrich(
  query: string,
  enrich: boolean,
  tavilyApiKey?: string | null
): Promise<{ sources: WebSource[]; block: string; enriched: boolean }> {
  if (!enrich) return { sources: [], block: "", enriched: false };
  const key = resolveTavilyApiKey(tavilyApiKey);
  if (!key) return { sources: [], block: "", enriched: false };
  try {
    const sources = await searchTavily(query, key);
    if (sources.length === 0) return { sources: [], block: "", enriched: false };
    const block =
      "\n\nOptional web context (may use for tips; do not invent task facts):\n" +
      sources
        .map((s, i) => `[${i + 1}] ${s.title} — ${s.url}\n${s.snippet ?? ""}`)
        .join("\n");
    return { sources, block, enriched: true };
  } catch (err) {
    console.error("[productivity-summary] Tavily enrich failed:", err);
    return { sources: [], block: "", enriched: false };
  }
}

const SUMMARY_SYSTEM = `You write professional productivity summaries for Focista Schedulo.

Audience: busy professionals reviewing their own to-do list.
Voice: plain English that is calm, precise, and businesslike. Write a cohesive status brief, not a coach, chatbot, or sales pitch.

Style requirements:
- Use complete sentences, clear transitions, and standard punctuation so paragraphs read as one coherent brief.
- Prefer everyday words over jargon, slang, hype, or motivational filler.
- Do not use emoji, exclamation marks for emphasis, or phrases such as "great job", "crush it", "let's go", "awesome", or similar.
- Do not use markdown headings (#), bold (**), italics, or decorative separators.
- You may label sections with a short plain line ending in a colon (for example: "Open tasks:" or "Overdue tasks:"), then use "- " bullets under that line.
- Be comprehensive enough to cover the period accurately, usually about 120–220 words of narrative plus any required task lists. If the digest is empty, keep the reply to one or two sentences.

Content requirements:
- Use only facts from the provided task digest. Never invent tasks, completions, dates, IDs, or projects.
- If the digest is empty, say so clearly and offer one practical next step.
- Otherwise write a cohesive overview that covers, in order:
  1) Period outcomes: what was completed, completion rate, and how work was distributed across projects.
  2) Current status: what remains open, what is overdue, and any high or urgent priority risks.
  3) Next steps: one to three concrete, practical actions grounded in the digest.
- When Open tasks are listed in the digest (not "none"), you MUST include a dedicated section titled exactly "Open tasks:" followed by a bullet for every open task provided, each on its own line in this form:
  - "Task title" (ID: <exact-id>)
  Include priority and due date in the same bullet when present in the digest.
- When Overdue tasks are listed in the digest (not "none"), you MUST include a dedicated section titled exactly "Overdue tasks:" followed by a bullet for every overdue task provided, each on its own line in this form:
  - "Task title" (ID: <exact-id>)
  Include due date and priority when present.
- If open or overdue counts are zero, state that briefly in the narrative and do not invent a task list.
- Copy task titles and IDs exactly as given. Do not shorten IDs.
- If web context is provided, you may add at most one brief tip tied to those sources and cite it as [n]. Do not let tips override task facts.`;

const ASK_SYSTEM = `You answer questions about a user's to-do list for Focista Schedulo.

Audience: the same professional reading their own task data.
Voice: plain English that is direct, coherent, and businesslike. Answer like a concise, careful colleague.

Style requirements:
- Use complete sentences and clear everyday wording; avoid slang, hype, emoji, and exclamation-heavy tone.
- Do not use markdown headings (#), bold (**), or italics.
- Prefer a short opening answer, then supporting detail. When listing tasks, use a plain section label ending in a colon and "- " bullets.
- Be complete enough to answer the question fully without padding.

Content requirements:
- Use only facts from the provided task digest. Never invent tasks, dates, priorities, IDs, or completion status.
- If the digest does not contain the answer, say so plainly (for example: "That information is not in the selected timeline.") and stop.
- Lead with the direct answer, then supporting details that stay on topic.
- When the user asks about open, remaining, incomplete, or overdue work—or when listing those tasks is the clearest way to answer—include a dedicated list. Use "Open tasks:" and/or "Overdue tasks:" as needed, with one bullet per task in this form:
  - "Task title" (ID: <exact-id>)
  Add due date and priority when available in the digest.
- Copy titles and IDs exactly. Do not omit IDs when listing tasks from the digest lists.
- If web context is provided, use it only for optional general advice, cite [n], and never override task facts.`;

export async function generateProductivitySummary(input: {
  tasks: SummaryTask[];
  projects: SummaryProject[];
  period: SummaryPeriod;
  startDate?: string;
  endDate?: string;
  enrichWithWeb?: boolean;
  groqApiKey?: string | null;
  tavilyApiKey?: string | null;
  now?: Date;
}): Promise<SummaryResult> {
  const groqKey = resolveGroqApiKey(input.groqApiKey);
  if (!groqKey) {
    throw new ProviderConfigError(
      "Groq API key is not configured. Add one via AI keys in the app header, or set GROQ_API_KEY on the server."
    );
  }

  const range = resolvePeriodRange(
    input.period,
    input.now ?? new Date(),
    input.startDate,
    input.endDate
  );
  const digest = buildTaskDigest(
    input.tasks,
    input.projects,
    range,
    isoDateLocal(input.now ?? new Date())
  );

  const enrich = input.enrichWithWeb !== false;
  const web = await optionalWebEnrich(
    `productivity planning tips for knowledge workers completing ${digest.stats.completed} of ${digest.stats.totalInRange} tasks`,
    enrich,
    input.tavilyApiKey
  );

  const userPrompt = `${digestPromptBlock(digest)}${web.block}\n\nWrite a professional, comprehensive, and cohesive plain-English status summary for this period. If open or overdue tasks are present in the digest, include the required Open tasks and Overdue tasks sections with exact names and IDs.`;

  try {
    const { text, model } = await completeWithGroqResilient(SUMMARY_SYSTEM, userPrompt, groqKey);
    return {
      summary: text,
      range,
      stats: digest.stats,
      sources: web.sources,
      model,
      enriched: web.enriched,
      degraded: false
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[productivity-summary] Groq unavailable; returning local digest brief:", detail);
    return {
      summary: buildLocalDigestBrief(digest),
      range,
      stats: digest.stats,
      sources: web.sources,
      model: "local-digest",
      enriched: web.enriched,
      degraded: true
    };
  }
}

export async function askProductivityQuestion(input: {
  tasks: SummaryTask[];
  projects: SummaryProject[];
  question: string;
  period?: SummaryPeriod;
  startDate?: string;
  endDate?: string;
  enrichWithWeb?: boolean;
  groqApiKey?: string | null;
  tavilyApiKey?: string | null;
  now?: Date;
}): Promise<AskResult> {
  const groqKey = resolveGroqApiKey(input.groqApiKey);
  if (!groqKey) {
    throw new ProviderConfigError(
      "Groq API key is not configured. Add one via AI keys in the app header, or set GROQ_API_KEY on the server."
    );
  }

  const question = input.question.trim();
  if (!question) {
    throw new PeriodRangeError("question is required.");
  }

  let range: DateRange | null = null;
  let digest: TaskDigest | null = null;

  if (input.period) {
    range = resolvePeriodRange(
      input.period,
      input.now ?? new Date(),
      input.startDate,
      input.endDate
    );
    digest = buildTaskDigest(
      input.tasks,
      input.projects,
      range,
      isoDateLocal(input.now ?? new Date())
    );
  } else {
    // Default: current sprint window for Q&A context breadth
    range = resolvePeriodRange("sprint", input.now ?? new Date());
    digest = buildTaskDigest(
      input.tasks,
      input.projects,
      range,
      isoDateLocal(input.now ?? new Date())
    );
  }

  const enrich = input.enrichWithWeb === true;
  const web = await optionalWebEnrich(question, enrich, input.tavilyApiKey);

  const userPrompt = `${digestPromptBlock(digest)}${web.block}\n\nUser question: ${question}\n\nReply in professional, clear plain English. If your answer involves open or overdue tasks, list each relevant task with its exact name and ID.`;

  try {
    const { text, model } = await completeWithGroqResilient(ASK_SYSTEM, userPrompt, groqKey);
    return {
      answer: text,
      range,
      stats: digest.stats,
      sources: web.sources,
      model,
      enriched: web.enriched,
      degraded: false
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[productivity-summary/ask] Groq unavailable; returning local digest answer:", detail);
    return {
      answer: buildLocalAskAnswer(digest, question),
      range,
      stats: digest.stats,
      sources: web.sources,
      model: "local-digest",
      enriched: web.enriched,
      degraded: true
    };
  }
}
