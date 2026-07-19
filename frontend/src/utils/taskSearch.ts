/**
 * Free-text task search: every whitespace token must appear as a substring
 * somewhere in the task's searchable attributes (AND semantics).
 */

export type SearchableTask = {
  id: string;
  title: string;
  description?: string;
  priority: "low" | "medium" | "high" | "urgent" | string;
  dueDate?: string;
  dueTime?: string;
  durationMinutes?: number;
  deadlineDate?: string;
  deadlineTime?: string;
  repeat?: string;
  repeatEvery?: number;
  repeatUnit?: string;
  labels: string[];
  location?: string;
  link?: string[];
  reminderMinutesBefore?: number;
  profileId?: string | null;
  projectId: string | null;
  completed: boolean;
  cancelled?: boolean;
  completedAt?: string;
  parentId?: string;
  childId?: string;
};

type TaskSearchContext = {
  projectNameById?: ReadonlyMap<string, string> | Record<string, string>;
  profileNameById?: ReadonlyMap<string, string> | Record<string, string>;
};

function lookupName(
  map: TaskSearchContext["projectNameById"],
  id: string | null | undefined
): string | undefined {
  if (!id || !map) return undefined;
  if (map instanceof Map) return map.get(id);
  return map[id];
}

function parseLocationTokens(location: string | undefined | null): string[] {
  const raw = location?.trim() ?? "";
  if (!raw) return [];
  if (raw.includes("|")) {
    return raw
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [raw];
}

function parseLocationAliasToken(raw: string): { query: string; label?: string } | null {
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
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(t) && !/\s/.test(t)) {
    return `https://${t}`;
  }
  if (/\s/.test(t)) return null;
  return `https://${t}`;
}

function parseLinkAliasToken(
  raw: string | undefined | null
): { href: string; label?: string } | null {
  const t = raw?.trim();
  if (!t) return null;
  const m = t.match(/^\s*(.*?)\s*(=>|->|\|)\s*(\S.*?)\s*$/);
  const hrefRaw = m ? (m[3] ?? "").trim() : t;
  const labelRaw = m ? (m[1] ?? "").trim() : "";
  const href = normalizeHyperlinkHref(hrefRaw);
  if (!href) return null;
  const label = labelRaw ? labelRaw.replace(/\s+/g, " ") : undefined;
  return { href, label };
}

function minutesSearchParts(minutes: number | undefined): string[] {
  if (minutes == null || !Number.isFinite(minutes)) return [];
  const n = Math.round(minutes);
  const parts = [String(n), `${n}m`, `${n} min`, `${n}mins`, `${n} minutes`];
  if (n % 60 === 0 && n > 0) {
    const h = n / 60;
    parts.push(`${h}h`, `${h} hr`, `${h} hour`, `${h} hours`);
  }
  return parts;
}

function repeatSearchParts(task: SearchableTask): string[] {
  const repeat = (task.repeat ?? "none").trim().toLowerCase();
  if (!repeat || repeat === "none") return ["none", "no repeat", "once"];
  const parts = [repeat, "repeat", "recurring"];
  if (repeat === "weekdays") parts.push("weekday", "workday", "workdays");
  if (repeat === "weekends") parts.push("weekend");
  if (repeat === "custom") {
    const every = task.repeatEvery ?? 1;
    const unit = (task.repeatUnit ?? "week").toLowerCase();
    parts.push("custom", String(every), unit, `${every} ${unit}`, `every ${every} ${unit}`);
    if (every === 1) parts.push(`every ${unit}`);
  }
  return parts;
}

function statusSearchParts(task: SearchableTask): string[] {
  const parts: string[] = [];
  if (task.cancelled) {
    parts.push("cancelled", "canceled", "cancel");
  } else if (task.completed) {
    parts.push("completed", "complete", "done", "finished");
  } else {
    parts.push("active", "open", "incomplete", "todo", "to-do");
  }
  return parts;
}

function dateSearchParts(isoDate: string | undefined): string[] {
  if (!isoDate?.trim()) return [];
  const d = isoDate.trim();
  const parts = [d];
  // Compact form without separators (e.g. 20260719)
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    parts.push(d.replace(/-/g, ""));
    parts.push(d.replace(/-/g, "/"));
  }
  return parts;
}

/** Flatten all searchable task attributes into one lowercase haystack string. */
export function buildTaskSearchHaystack(
  task: SearchableTask,
  ctx: TaskSearchContext = {}
): string {
  const locationParts = parseLocationTokens(task.location).flatMap((token) => {
    const parsed = parseLocationAliasToken(token);
    return parsed ? [parsed.label ?? "", parsed.query] : [token];
  });

  const linkParts = (task.link ?? []).flatMap((token) => {
    const parsed = parseLinkAliasToken(token);
    if (!parsed) return [token];
    const bare = parsed.href.replace(/^https?:\/\//i, "");
    return [parsed.label ?? "", parsed.href, bare];
  });

  const projectName = lookupName(ctx.projectNameById, task.projectId);
  const profileName = lookupName(ctx.profileNameById, task.profileId);

  const parts: Array<string | number | undefined | null> = [
    task.id,
    task.parentId,
    task.childId,
    task.title,
    task.description,
    ...(task.labels ?? []),
    ...locationParts,
    ...linkParts,
    task.priority,
    ...dateSearchParts(task.dueDate),
    task.dueTime,
    ...dateSearchParts(task.deadlineDate),
    task.deadlineTime,
    ...minutesSearchParts(task.durationMinutes),
    ...minutesSearchParts(task.reminderMinutesBefore),
    task.reminderMinutesBefore != null ? "reminder" : null,
    ...repeatSearchParts(task),
    ...statusSearchParts(task),
    task.projectId,
    projectName,
    task.projectId ? "has-project" : "no-project",
    task.profileId,
    profileName,
    task.completedAt
  ];

  return parts
    .filter((p) => p != null && String(p).trim() !== "")
    .join(" ")
    .toLowerCase();
}

export function tokenizeTaskSearchQuery(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function matchesTaskSearchTokens(
  task: SearchableTask,
  tokens: string[],
  ctx: TaskSearchContext = {}
): boolean {
  if (tokens.length === 0) return true;
  const haystack = buildTaskSearchHaystack(task, ctx);
  return tokens.every((tok) => haystack.includes(tok));
}

export function matchesTaskSearchQuery(
  task: SearchableTask,
  query: string,
  ctx: TaskSearchContext = {}
): boolean {
  return matchesTaskSearchTokens(task, tokenizeTaskSearchQuery(query), ctx);
}
