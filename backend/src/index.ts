import express from "express";
import cors from "cors";
import { z } from "zod";
import { promises as fs } from "fs";
import { watch as fsWatch } from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const DATA_DIR = path.join(__dirname, "..", "data");
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");

const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  dueDate: z.string().optional(),
  dueTime: z.string().optional(),
  durationMinutes: z.number().int().positive().optional(),
  deadlineDate: z.string().optional(),
  deadlineTime: z.string().optional(),
  repeat: z
    .enum([
      "none",
      "daily",
      "weekly",
      "weekdays",
      "weekends",
      "monthly",
      "quarterly",
      "yearly",
      "custom"
    ])
    .optional(),
  repeatEvery: z.number().int().positive().optional(),
  repeatUnit: z.enum(["day", "week", "month", "quarter", "year"]).optional(),
  labels: z.array(z.string()),
  location: z.string().optional(),
  // Multi-link support: store always as an array so the UI can offer
  // "single or multiple" URLs.
  link: z.array(z.string()).optional(),
  reminderMinutesBefore: z.number().int().nonnegative().optional(),
  projectId: z.string().nullable(),
  completed: z.boolean(),
  parentId: z.string().optional(),
  childId: z.string().optional(),
  cancelled: z.boolean().optional()
});

const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1)
});

type Task = z.infer<typeof TaskSchema>;
type Project = z.infer<typeof ProjectSchema>;

let tasks: Task[] = [];
let projects: Project[] = [];

function yyyymmddLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function isoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromIsoDateLocal(iso: string): Date {
  // Use local midday to avoid timezone shifts around midnight.
  return new Date(`${iso}T12:00:00`);
}

function addDaysLocal(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function addMonthsLocal(base: Date, months: number): Date {
  const d = new Date(base.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) {
    // Go to the last day of the previous month.
    d.setDate(0);
  }
  return d;
}

function nextOccurrenceDateLocal(current: Date, repeatTask: Task): Date | null {
  const repeat = repeatTask.repeat ?? "none";
  const repeatEvery = repeatTask.repeatEvery ?? 1;
  // Only used for `custom` repeats.
  const repeatUnit = repeatTask.repeatUnit ?? "week";

  switch (repeat) {
    case "daily":
      return addDaysLocal(current, repeatEvery);
    case "weekly":
      return addDaysLocal(current, 7 * repeatEvery);
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
      return addMonthsLocal(current, repeatEvery);
    case "quarterly":
      return addMonthsLocal(current, 3 * repeatEvery);
    case "yearly":
      return addMonthsLocal(current, 12 * repeatEvery);
    case "custom": {
      switch (repeatUnit) {
        case "day":
          return addDaysLocal(current, repeatEvery);
        case "week":
          return addDaysLocal(current, repeatEvery * 7);
        case "month":
          return addMonthsLocal(current, repeatEvery);
        case "quarter":
          return addMonthsLocal(current, repeatEvery * 3);
        case "year":
          return addMonthsLocal(current, repeatEvery * 12);
      }
      return null;
    }
    case "none":
    default:
      return null;
  }
}

function sortLabelsAsc(labels: string[]): string[] {
  const toKey = (s: string) => s.trim().toLowerCase();
  return labels
    .slice()
    .sort((a, b) => toKey(a).localeCompare(toKey(b)) || a.localeCompare(b));
}

function sortLinksAsc(links: string[]): string[] {
  const toKey = (s: string) => s.trim().toLowerCase();
  return links
    .slice()
    .sort((a, b) => toKey(a).localeCompare(toKey(b)) || a.localeCompare(b));
}

function isStandardParentId(pid: string | undefined): pid is string {
  return typeof pid === "string" && /^\d{8}-\d+$/.test(pid);
}

function dateStrToYyyymmdd(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}`;
}

function allocateNextParentId(now = new Date()): string {
  const prefix = yyyymmddLocal(now);
  const used = new Set(tasks.map((t) => t.parentId).filter((v): v is string => !!v));
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const pid of used) {
    const m = pid.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let candidate = `${prefix}-${max + 1}`;
  while (used.has(candidate)) {
    max += 1;
    candidate = `${prefix}-${max + 1}`;
  }
  return candidate;
}

function allocateNextParentIdForPrefix(prefix: string): string {
  const used = new Set(tasks.map((t) => t.parentId).filter((v): v is string => !!v));
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const pid of used) {
    const m = pid.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let candidate = `${prefix}-${max + 1}`;
  while (used.has(candidate)) {
    max += 1;
    candidate = `${prefix}-${max + 1}`;
  }
  return candidate;
}

function allocateNextParentIdForTask(t: Pick<Task, "dueDate">): string {
  const prefix = dateStrToYyyymmdd(t.dueDate) ?? yyyymmddLocal(new Date());
  return allocateNextParentIdForPrefix(prefix);
}

function ensureStandardParentIdForTask(t: Task): string {
  if (isStandardParentId(t.parentId)) return t.parentId;
  const prefix = dateStrToYyyymmdd(t.dueDate) ?? yyyymmddLocal(new Date());
  return allocateNextParentIdForPrefix(prefix);
}

function normalizeProjectId(id: string): string | null {
  const raw = id.trim();
  if (!raw) return null;
  const m = raw.match(/^p\s*0*(\d+)$/i);
  if (m) return `P${Number(m[1])}`;
  const u = raw.match(/^P0*(\d+)$/);
  if (u) return `P${Number(u[1])}`;
  return raw;
}

function allocateNextProjectId(): string {
  const used = new Set<number>();
  for (const p of projects) {
    const m = p.id.match(/^P(\d+)$/);
    if (m) used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return `P${n}`;
}

function firstDefinedDurationMinutesForParent(parentId: string): number | undefined {
  return tasks.find((t) => t.parentId === parentId && t.durationMinutes !== undefined)
    ?.durationMinutes;
}

function syncDurationMinutesForParent(parentId: string, durationMinutes: number) {
  tasks = tasks.map((t) =>
    t.parentId === parentId ? { ...t, durationMinutes } : t
  );
}

function isRepeatingTask(t: Task): boolean {
  return !!t.repeat && t.repeat !== "none";
}

function seriesKeyForTask(t: Task): string {
  return [
    t.projectId ?? "",
    t.title,
    t.repeat ?? "none",
    String(t.repeatEvery ?? ""),
    String(t.repeatUnit ?? "")
  ].join("::");
}

function seriesKeyForFields(fields: {
  projectId: string | null;
  title: string;
  repeat?: Task["repeat"];
  repeatEvery?: number;
  repeatUnit?: Task["repeatUnit"];
}): string {
  return [
    fields.projectId ?? "",
    fields.title,
    fields.repeat ?? "none",
    String(fields.repeatEvery ?? ""),
    String(fields.repeatUnit ?? "")
  ].join("::");
}

function findExistingParentIdForSeries(seriesKey: string, excludeTaskId?: string): string | undefined {
  return tasks.find(
    (t) =>
      t.id !== excludeTaskId &&
      isRepeatingTask(t) &&
      seriesKeyForTask(t) === seriesKey &&
      !!t.parentId
  )?.parentId;
}

function allocateNextChildId(parentId: string, seriesKey: string): string {
  let max = 0;
  for (const t of tasks) {
    if (!isRepeatingTask(t)) continue;
    if (seriesKeyForTask(t) !== seriesKey) continue;
    if (!t.childId) continue;
    const n = Number(t.childId);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return String(max + 1);
}

function syncSeriesIdentityAndDuration(anchor: Task) {
  if (!anchor.parentId) return;
  if (!isRepeatingTask(anchor)) return;
  if (anchor.durationMinutes === undefined) return;

  const key = seriesKeyForTask(anchor);
  const series = tasks.filter((t) => isRepeatingTask(t) && seriesKeyForTask(t) === key);
  const sorted = series
    .slice()
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

  const idToChildId = new Map<string, string>();
  sorted.forEach((t, idx) => {
    if (t.childId) return;
    idToChildId.set(t.id, String(idx + 1));
  });

  tasks = tasks.map((t) => {
    if (!isRepeatingTask(t)) return t;
    if (seriesKeyForTask(t) !== key) return t;
    return {
      ...t,
      parentId: anchor.parentId,
      durationMinutes: anchor.durationMinutes,
      childId: t.childId ?? idToChildId.get(t.id)
    };
  });
}

async function rebuildParentAndChildIdsDeterministic(): Promise<void> {
  // Rebuild parentId and childId for all tasks so that:
  // - The date prefix always comes from the earliest occurrence (for series) or the task's own dueDate (one‑time).
  // - The numeric suffix is small and sequential per date.
  const dateCounter = new Map<string, number>();
  const newParent = new Map<string, string>();
  const newChild = new Map<string, string | undefined>();

  // 1) Repeating series: group by logical series key and assign parent/child IDs.
  const seriesMap = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!isRepeatingTask(t) || !t.dueDate) continue;
    const key = seriesKeyForTask(t);
    const arr = seriesMap.get(key) ?? [];
    arr.push(t);
    seriesMap.set(key, arr);
  }

  for (const [, arr] of seriesMap.entries()) {
    if (arr.length === 0) continue;
    const sorted = arr
      .slice()
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    const first = sorted[0];
    const prefix =
      dateStrToYyyymmdd(first.dueDate) ?? yyyymmddLocal(new Date());
    const n = (dateCounter.get(prefix) ?? 0) + 1;
    dateCounter.set(prefix, n);
    const pid = `${prefix}-${n}`;
    sorted.forEach((t, idx) => {
      newParent.set(t.id, pid);
      // Child IDs are simple sequence numbers within the series: "1", "2", ...
      newChild.set(t.id, String(idx + 1));
    });
  }

  // 2) One‑time tasks: assign parentId based on their own dueDate.
  for (const t of tasks) {
    if (isRepeatingTask(t)) continue;
    if (!t.dueDate) continue;
    const prefix = dateStrToYyyymmdd(t.dueDate) ?? yyyymmddLocal(new Date());
    const n = (dateCounter.get(prefix) ?? 0) + 1;
    dateCounter.set(prefix, n);
    const pid = `${prefix}-${n}`;
    newParent.set(t.id, pid);
    newChild.set(t.id, undefined);
  }

  let mutated = false;
  tasks = tasks.map((t) => {
    const np = newParent.get(t.id);
    const hasChildOverride = newChild.has(t.id);
    if (!np && !hasChildOverride) return t;
    const next: Task = { ...t };
    if (np) next.parentId = np;
    if (hasChildOverride) {
      next.childId = newChild.get(t.id);
    }
    if (next.parentId !== t.parentId || next.childId !== t.childId) {
      mutated = true;
    }
    return next;
  });

  if (mutated) {
    await persistTasks();
  }
}

async function enforceSequentialCompletionForRepeatingSeries(): Promise<boolean> {
  let changed = false;

  // Only consider non-cancelled repeating tasks as members of the series.
  const repeating = tasks.filter((t) => isRepeatingTask(t) && !!t.dueDate && !t.cancelled);
  const seriesMap = new Map<string, Task[]>();

  for (const t of repeating) {
    const key = seriesKeyForTask(t);
    const arr = seriesMap.get(key) ?? [];
    arr.push(t);
    seriesMap.set(key, arr);
  }

  for (const [key, arr] of seriesMap.entries()) {
    if (!arr.length) continue;

    const sorted = arr
      .slice()
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    const template = sorted[0];

    const completedDueDates = sorted
      .filter((t) => t.completed && !!t.dueDate)
      .map((t) => t.dueDate as string);

    const latestCompletedDueDate =
      completedDueDates.length > 0
        ? completedDueDates.slice().sort((a, b) => a.localeCompare(b))[completedDueDates.length - 1] ??
          null
        : null;

    if (!latestCompletedDueDate) {
      // No completed tasks in series: ensure everything is active.
      for (const t of arr) {
        if (t.completed) {
          t.completed = false;
          changed = true;
        }
      }
      continue;
    }

    // Mark all occurrences from earliest until the latest completed as completed.
    let current = fromIsoDateLocal(template.dueDate!);
    let safety = 0;
    while (safety < 2000) {
      safety += 1;
      const dueIso = isoDateLocal(current);
      if (dueIso.localeCompare(latestCompletedDueDate) > 0) break;

      const exists = tasks.find(
        (t) =>
          isRepeatingTask(t) &&
          !t.cancelled &&
          seriesKeyForTask(t) === key &&
          t.dueDate === dueIso
      );

      if (exists) {
        if (!exists.completed) {
          exists.completed = true;
          changed = true;
        }
      } else {
        const newTask: Task = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          title: template.title,
          description: template.description,
          priority: template.priority,
          dueDate: dueIso,
          dueTime: template.dueTime,
          durationMinutes: template.durationMinutes,
          repeat: template.repeat,
          repeatEvery: template.repeatEvery,
          repeatUnit: template.repeatUnit,
          labels: template.labels,
          link: template.link,
          location: template.location,
          reminderMinutesBefore: template.reminderMinutesBefore,
          projectId: template.projectId ?? null,
          completed: true,
          parentId: template.parentId,
          childId: undefined,
          cancelled: false
        };
        tasks.push(newTask);
        changed = true;
      }

      const next = nextOccurrenceDateLocal(current, template);
      if (!next) break;
      current = next;
    }

    // Ensure any existing tasks after the latest completed occurrence are active.
    for (const t of tasks) {
      if (!isRepeatingTask(t) || t.cancelled) continue;
      if (seriesKeyForTask(t) !== key) continue;
      if (!t.dueDate) continue;
      if (t.dueDate.localeCompare(latestCompletedDueDate) > 0 && t.completed) {
        t.completed = false;
        changed = true;
      }
    }
  }

  if (!changed) return false;
  await rebuildParentAndChildIdsDeterministic();
  return true;
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadData() {
  await ensureDataDir();
  try {
    const rawTasks = await fs.readFile(TASKS_FILE, "utf8");
    const parsed = JSON.parse(rawTasks);
    const safe = z.array(TaskSchema).safeParse(parsed);
    if (safe.success) {
      // Keep label ordering deterministic across all UI surfaces.
      tasks = safe.data.map((t) => ({
        ...t,
        labels: sortLabelsAsc(t.labels),
        link: t.link ? sortLinksAsc(t.link) : t.link
      }));
    }
  } catch {
    tasks = [];
  }

  try {
    const rawProjects = await fs.readFile(PROJECTS_FILE, "utf8");
    const parsed = JSON.parse(rawProjects);
    const safe = z.array(ProjectSchema).safeParse(parsed);
    if (safe.success) projects = safe.data;
  } catch {
    projects = [
      { id: "P1", name: "Personal Growth" },
      { id: "P2", name: "Work – Q2 Delivery" }
    ];
  }

  // Normalize and re-sequence project IDs to strict "P1..Pn", then migrate task references.
  // This avoids legacy timestamp-like IDs causing huge numbers.
  const idMap = new Map<string, string>();

  const sorted = projects
    .slice()
    .map((p) => {
      const norm = normalizeProjectId(p.id) ?? p.id;
      const m = norm.match(/^P(\d+)$/);
      const n = m ? Number(m[1]) : Number.POSITIVE_INFINITY;
      return { project: { ...p, id: norm }, sortKey: n };
    })
    .sort((a, b) => {
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      return a.project.name.localeCompare(b.project.name);
    })
    .map((x) => x.project);

  const resequenced: Project[] = [];
  let nextNum = 1;
  for (const p of sorted) {
    const newId = `P${nextNum}`;
    nextNum += 1;
    if (p.id !== newId) idMap.set(p.id, newId);
    resequenced.push({ ...p, id: newId });
  }
  projects = resequenced;

  if (idMap.size > 0) {
    tasks = tasks.map((t) => {
      if (!t.projectId) return t;
      const next = idMap.get(t.projectId);
      return next ? { ...t, projectId: next } : t;
    });
  }

  if (idMap.size > 0) {
    await persistProjects();
    await persistTasks();
  }

  // Normalize repeating series (including completed tasks):
  // - ensure every occurrence has a stable parentId
  // - ensure childId exists and is sequential by dueDate
  // - ensure durationMinutes is consistent across the whole series
  const repeating = tasks.filter((t) => isRepeatingTask(t) && !!t.dueDate);
  const seriesMap = new Map<string, Task[]>();
  for (const t of repeating) {
    const key = seriesKeyForTask(t);
    const arr = seriesMap.get(key) ?? [];
    arr.push(t);
    seriesMap.set(key, arr);
  }

  let mutated = false;
  for (const [key, arr] of seriesMap.entries()) {
    if (arr.length === 0) continue;
    const sorted = arr
      .slice()
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

    const existingPid =
      sorted.find((t) => !!t.parentId)?.parentId ?? allocateNextParentIdForTask(sorted[0]);
    const duration =
      sorted.find((t) => t.durationMinutes !== undefined)?.durationMinutes;

    const idToChildId = new Map<string, string>();
    sorted.forEach((t, idx) => {
      idToChildId.set(t.id, String(idx + 1));
    });

    tasks = tasks.map((t) => {
      if (!isRepeatingTask(t) || !t.dueDate) return t;
      if (seriesKeyForTask(t) !== key) return t;
      const next: Task = {
        ...t,
        parentId: existingPid,
        childId: t.childId ?? idToChildId.get(t.id)
      };
      if (duration !== undefined) next.durationMinutes = duration;
      if (
        next.parentId !== t.parentId ||
        next.childId !== t.childId ||
        next.durationMinutes !== t.durationMinutes
      ) {
        mutated = true;
      }
      return next;
    });
  }

  if (mutated) {
    await persistTasks();
  }

  // Standardize Parent IDs for ALL tasks (one-time + repeating):
  // - enforce format YYYYMMDD-N
  // - ensure each repeating series shares the same parentId
  // - assign parentId for one-time tasks too
  let pidMutated = false;

  // 1) One-time tasks: ensure parentId is standard.
  tasks = tasks.map((t) => {
    if (isRepeatingTask(t)) return t;
    const nextPid = ensureStandardParentIdForTask(t);
    if (t.parentId !== nextPid) pidMutated = true;
    // childId is only meaningful for series occurrences
    const next: Task = { ...t, parentId: nextPid };
    if (next.childId) {
      next.childId = undefined;
      pidMutated = true;
    }
    return next;
  });

  // 2) Repeating tasks: enforce shared standard parentId per series.
  const repeating2 = tasks.filter((t) => isRepeatingTask(t) && !!t.dueDate);
  const series2 = new Map<string, Task[]>();
  for (const t of repeating2) {
    const key = seriesKeyForTask(t);
    const arr = series2.get(key) ?? [];
    arr.push(t);
    series2.set(key, arr);
  }

  for (const [key, arr] of series2.entries()) {
    const sorted = arr
      .slice()
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    // Always derive the series parentId from the earliest occurrence's date,
    // so the parentId prefix reflects the first task's date (e.g., 20260101-1).
    const pid = ensureStandardParentIdForTask(sorted[0]);

    const idToChildId = new Map<string, string>();
    sorted.forEach((t, idx) => idToChildId.set(t.id, String(idx + 1)));

    tasks = tasks.map((t) => {
      if (!isRepeatingTask(t) || !t.dueDate) return t;
      if (seriesKeyForTask(t) !== key) return t;
      const next: Task = {
        ...t,
        parentId: pid,
        childId: t.childId ?? idToChildId.get(t.id)
      };
      if (next.parentId !== t.parentId || next.childId !== t.childId) pidMutated = true;
      return next;
    });
  }

  if (pidMutated) {
    await persistTasks();
  }

  // Finally, rebuild all parentId / childId values deterministically so that
  // the prefix always reflects the first occurrence date and the numeric
  // suffixes are compact and sequential per date.
  await rebuildParentAndChildIdsDeterministic();

  // Enforce sequential completion for repeating series:
  // If a later occurrence is marked completed, we materialize any missing
  // earlier occurrences and mark them completed too so the UI has no "gaps".
  const completionMutated = await enforceSequentialCompletionForRepeatingSeries();
  if (completionMutated) {
    await persistTasks();
  }
}

function startDataAutoSync() {
  let timer: NodeJS.Timeout | null = null;
  let reloading = false;
  let queued = false;

  const scheduleReload = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (reloading) {
        queued = true;
        return;
      }
      reloading = true;
      try {
        await loadData();
      } finally {
        reloading = false;
        if (queued) {
          queued = false;
          scheduleReload();
        }
      }
    }, 150);
  };

  // Watch the whole folder so edits/renames are caught reliably across editors.
  fsWatch(DATA_DIR, { persistent: true }, (_eventType, filename) => {
    const name = typeof filename === "string" ? filename : "";
    if (!name.endsWith(".json")) return;
    scheduleReload();
  });
}

async function persistTasks() {
  await ensureDataDir();
  await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf8");
}

async function persistProjects() {
  await ensureDataDir();
  await fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2), "utf8");
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "focista-schedulo-backend" });
});

app.get("/api/projects", (_req, res) => {
  res.json(projects);
});

app.post("/api/projects", (req, res) => {
  const body = ProjectSchema.omit({ id: true }).safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: body.error.flatten() });
  }
  const project: Project = { id: allocateNextProjectId(), ...body.data };
  projects.push(project);
  void persistProjects();
  res.status(201).json(project);
});

app.put("/api/projects/:id", (req, res) => {
  const id = req.params.id;
  const parsed = ProjectSchema.safeParse({ ...req.body, id });
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const index = projects.findIndex((p) => p.id === id);
  if (index === -1) return res.sendStatus(404);
  projects[index] = parsed.data;
  void persistProjects();
  res.json(parsed.data);
});

app.delete("/api/projects/:id", (req, res) => {
  const id = req.params.id;
  const before = projects.length;
  projects = projects.filter((p) => p.id !== id);
  if (projects.length === before) return res.sendStatus(404);
  tasks = tasks.filter((t) => t.projectId !== id);
  void persistProjects();
  void persistTasks();
  res.sendStatus(204);
});

app.get("/api/tasks", (req, res) => {
  const { projectId } = req.query;
  const filtered =
    typeof projectId === "string"
      ? tasks.filter((t) => t.projectId === projectId)
      : tasks;
  res.json(filtered);
});

app.post("/api/tasks", async (req, res) => {
  const baseSchema = TaskSchema.omit({ id: true, completed: true });
  const parsed = baseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const repeating = !!parsed.data.repeat && parsed.data.repeat !== "none";
  const sortedParsedData = {
    ...parsed.data,
    labels: sortLabelsAsc(parsed.data.labels),
    link: parsed.data.link ? sortLinksAsc(parsed.data.link) : parsed.data.link
  };
  const seriesKey = seriesKeyForFields({
    projectId: sortedParsedData.projectId,
    title: sortedParsedData.title,
    repeat: sortedParsedData.repeat,
    repeatEvery: sortedParsedData.repeatEvery,
    repeatUnit: sortedParsedData.repeatUnit
  });
  const existingParentId = repeating ? findExistingParentIdForSeries(seriesKey) : undefined;
  const parentPrefix =
    dateStrToYyyymmdd(sortedParsedData.dueDate) ?? yyyymmddLocal(new Date());
  const parentId =
    repeating
      ? (existingParentId ??
        sortedParsedData.parentId ??
        allocateNextParentIdForPrefix(parentPrefix))
      : sortedParsedData.parentId;
  const childId =
    repeating && parentId ? allocateNextChildId(parentId, seriesKey) : sortedParsedData.childId;
  const durationMinutes =
    parentId && sortedParsedData.durationMinutes === undefined
      ? firstDefinedDurationMinutesForParent(parentId)
      : sortedParsedData.durationMinutes;

  // If we're creating a repeating occurrence, propagate definition-level fields
  // (title/labels/location/priority/etc) to all existing occurrences in the series.
  const seriesMembersToPropagate =
    repeating
      ? tasks.filter((t) => isRepeatingTask(t) && seriesKeyForTask(t) === seriesKey)
      : [];

  const task: Task = {
    id: Date.now().toString(),
    completed: false,
    cancelled: false,
    ...sortedParsedData,
    durationMinutes,
    parentId,
    childId
  };
  tasks.push(task);

  if (repeating && seriesMembersToPropagate.length > 0) {
    const seriesMetadata: Partial<Task> = {
      title: task.title,
      description: task.description,
      priority: task.priority,
      projectId: task.projectId,
      labels: task.labels,
      link: task.link,
      location: task.location,
      reminderMinutesBefore: task.reminderMinutesBefore,
      repeat: task.repeat,
      repeatEvery: task.repeatEvery,
      repeatUnit: task.repeatUnit,
      durationMinutes
    };

    tasks = tasks.map((t) => {
      if (!isRepeatingTask(t)) return t;
      if (seriesKeyForTask(t) !== seriesKey) return t;
      // Preserve completion/cancel state and per-occurrence IDs/due dates.
      if (t.id === task.id) return t;
      return { ...t, ...seriesMetadata };
    });
  }
  // Keep duration consistent across a series when a duration is supplied.
  if (parentId && durationMinutes !== undefined) {
    syncDurationMinutesForParent(parentId, durationMinutes);
    // Parent/child identity (and childId sequencing) is rebuilt deterministically below.
  }
  await persistTasks();
  // Ensure parentId prefix always matches the earliest dueDate in the series.
  await rebuildParentAndChildIdsDeterministic();
  const saved = tasks.find((t) => t.id === task.id) ?? task;
  res.status(201).json(saved);
});

app.put("/api/tasks/:id", async (req, res) => {
  const id = req.params.id;
  const parsed = TaskSchema.safeParse({ ...req.body, id });
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const sortedParsedData = {
    ...parsed.data,
    labels: sortLabelsAsc(parsed.data.labels),
    link: parsed.data.link ? sortLinksAsc(parsed.data.link) : parsed.data.link
  };
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return res.sendStatus(404);
  const existing = tasks[index];
  const repeating = !!sortedParsedData.repeat && sortedParsedData.repeat !== "none";
  const seriesKeyBefore = repeating ? seriesKeyForTask(existing) : undefined;
  const seriesKey = seriesKeyForFields({
    projectId: sortedParsedData.projectId,
    title: sortedParsedData.title,
    repeat: sortedParsedData.repeat,
    repeatEvery: sortedParsedData.repeatEvery,
    repeatUnit: sortedParsedData.repeatUnit
  });
  const existingParentId = repeating ? findExistingParentIdForSeries(seriesKey, id) : undefined;
  const updateParentPrefix =
    dateStrToYyyymmdd(sortedParsedData.dueDate ?? existing.dueDate) ?? yyyymmddLocal(new Date());
  const resolvedParentId =
    repeating
      ? (existingParentId ??
        sortedParsedData.parentId ??
        existing.parentId ??
        allocateNextParentIdForPrefix(updateParentPrefix))
      : sortedParsedData.parentId ?? existing.parentId;

  const resolvedChildId =
    repeating && resolvedParentId
      ? allocateNextChildId(resolvedParentId, seriesKey)
      : sortedParsedData.childId ?? existing.childId;

  const next: Task = {
    ...sortedParsedData,
    parentId: resolvedParentId,
    childId: resolvedChildId
  };
  // If the client didn't send durationMinutes, inherit from existing.
  if (next.durationMinutes === undefined) {
    next.durationMinutes = existing.durationMinutes;
  }
  tasks[index] = next;

  // Series-wide metadata propagation:
  // If this is a repeating series task, apply definition-level edits (title/labels/location/etc)
  // to all occurrences that belong to the *original* series.
  if (repeating && seriesKeyBefore) {
    const memberIds = new Set(
      tasks
        .filter((t) => isRepeatingTask(t) && seriesKeyForTask(t) === seriesKeyBefore)
        .map((t) => t.id)
    );

    const seriesMetadata: Partial<Task> = {
      title: next.title,
      description: next.description,
      priority: next.priority,
      projectId: next.projectId,
      labels: next.labels,
      link: next.link,
      location: next.location,
      reminderMinutesBefore: next.reminderMinutesBefore,
      repeat: next.repeat,
      repeatEvery: next.repeatEvery,
      repeatUnit: next.repeatUnit,
      durationMinutes: next.durationMinutes
    };

    tasks = tasks.map((t) => {
      if (!memberIds.has(t.id)) return t;
      return { ...t, ...seriesMetadata };
    });
  }

  // Ensure duration is consistent for all occurrences in a series.
  if (tasks[index].parentId && tasks[index].durationMinutes !== undefined) {
    syncDurationMinutesForParent(tasks[index].parentId!, tasks[index].durationMinutes!);
    // Parent/child identity is rebuilt deterministically below.
  }
  await persistTasks();
  // Ensure parentId/childId determinism even when dueDate changes series prefix.
  await rebuildParentAndChildIdsDeterministic();
  const updated = tasks.find((t) => t.id === id) ?? tasks[index];
  res.json(updated);
});

app.patch("/api/tasks/:id/complete", (req, res) => {
  const id = req.params.id;
  const task = tasks.find((t) => t.id === id);
  if (!task) return res.sendStatus(404);
  task.completed = !task.completed;
  void persistTasks();
  res.json(task);
});

app.delete("/api/tasks/:id", async (req, res) => {
  const id = req.params.id;
  const before = tasks.length;
  tasks = tasks.filter((t) => t.id !== id);
  if (tasks.length === before) return res.sendStatus(404);
  await persistTasks();
  // Recompute series prefixes after deletion (earliest date may change).
  await rebuildParentAndChildIdsDeterministic();
  res.sendStatus(204);
});

app.get("/api/stats", (_req, res) => {
  const toIsoLocal = (d: Date) => d.toISOString().slice(0, 10);
  const addDays = (d: Date, days: number) => {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + days);
    return x;
  };
  const uniqSorted = (arr: number[]) =>
    Array.from(new Set(arr)).sort((a, b) => a - b);

  const buildMilestones = (opts: {
    base: number[];
    current: number;
    extendFrom: number;
    extendStep: number;
    minCount?: number;
    maxCount?: number;
    extendLabel?: string;
  }) => {
    const { base, current, extendFrom, extendStep, minCount = 20, maxCount } = opts;
    const out: number[] = [...base];
    const maxBase = base.length ? Math.max(...base) : extendFrom;
    // Ensure we produce enough sequential tiers from extendFrom, regardless of large base tiers.
    const cap = Math.max(
      current + extendStep,
      extendFrom + extendStep * (minCount + 2),
      maxBase
    );
    for (let v = extendFrom; v <= cap; v += extendStep) out.push(v);
    let milestones = uniqSorted(out);
    if (typeof maxCount === "number" && maxCount > 0) {
      milestones = milestones.slice(0, maxCount);
    }
    const achieved = milestones.filter((m) => m <= current);
    const next = milestones.find((m) => m > current) ?? null;
    const prev = achieved.length ? achieved[achieved.length - 1] : 0;
    const progressToNext =
      next === null ? 1 : Math.max(0, Math.min(1, (current - prev) / Math.max(1, next - prev)));
    return {
      milestones,
      achieved,
      achievedCount: achieved.length,
      next,
      prev,
      progressToNext
    };
  };

  const now = new Date();
  const todayIso = toIsoLocal(now);

  const safeTasks = tasks.filter((t) => !t.cancelled);
  const completedTasks = safeTasks.filter((t) => t.completed && !!t.dueDate);

  const completedToday = completedTasks.filter((t) => t.dueDate === todayIso);
  const allCompleted = completedTasks;

  const completionsByDay = new Map<string, number>();
  for (const t of completedTasks) {
    if (!t.dueDate) continue;
    completionsByDay.set(t.dueDate, (completionsByDay.get(t.dueDate) ?? 0) + 1);
  }

  const scoreFor = (task: Task): number => {
    switch (task.priority) {
      case "low":
        return 1;
      case "medium":
        return 2;
      case "high":
        return 3;
      case "urgent":
        return 4;
      default:
        return 0;
    }
  };

  const pointsToday = completedToday.reduce(
    (sum, t) => sum + scoreFor(t),
    0
  );
  const totalPoints = allCompleted.reduce(
    (sum, t) => sum + scoreFor(t),
    0
  );

  const level = 1 + Math.floor(totalPoints / 50);
  const pointsIntoLevel = totalPoints % 50;
  const xpToNext = pointsIntoLevel === 0 ? 50 : 50 - pointsIntoLevel;

  const streakDays = (() => {
    // Consecutive days ending today where the user completed >=1 task on that day.
    let streak = 0;
    for (let i = 0; i < 365; i += 1) {
      const dayIso = toIsoLocal(addDays(now, -i));
      const count = completionsByDay.get(dayIso) ?? 0;
      if (count <= 0) break;
      streak += 1;
    }
    return streak;
  })();

  const last7Days = (() => {
    // oldest -> newest
    const days: { date: string; completed: number; points: number }[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const iso = toIsoLocal(addDays(now, -i));
      const completed = completionsByDay.get(iso) ?? 0;
      const points = completedTasks
        .filter((t) => t.dueDate === iso)
        .reduce((sum, t) => sum + scoreFor(t), 0);
      days.push({ date: iso, completed, points });
    }
    return days;
  })();

  const pointsByPriority = (() => {
    const out = { low: 0, medium: 0, high: 0, urgent: 0 };
    for (const t of completedTasks) {
      out[t.priority] += scoreFor(t);
    }
    return out;
  })();

  const achievements = (() => {
    // Productive Day: complete 3 tasks due before 21:00 today
    const isBefore2100 = (time: string | undefined): boolean => {
      if (!time) return false;
      const m = time.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return false;
      const hh = Number(m[1]);
      const mm = Number(m[2]);
      return hh < 21 || (hh === 20 && mm >= 0);
    };

    const earlyCount = completedToday.filter((t) => isBefore2100(t.dueTime)).length;
    const earlyStarter = {
      id: "early_starter",
      name: "Productive Day",
      description: "Complete 3 tasks scheduled before 21:00.",
      progress: Math.min(3, earlyCount),
      goal: 3,
      achieved: earlyCount >= 3
    };

    // Consistency Builder: last 7 days.
    const dailyXpTarget = 5;

    const weeklyProgress = (() => {
      // Number of days in the last 7 days where BOTH:
      // - "Productive Day" is achieved (>=3 tasks before 21:00)
      // - "Daily Grinding" is achieved (>=5 XP gained that day)
      let count = 0;
      for (const day of last7Days) {
        const dayIso = day.date;
        const dayTasks = completedTasks.filter((t) => t.dueDate === dayIso);
        const productiveCount = dayTasks.filter((t) => isBefore2100(t.dueTime)).length;
        const dayPoints = dayTasks.reduce((sum, t) => sum + scoreFor(t), 0);

        const hasProductiveDay = productiveCount >= 3;
        const hasDailyGrinding = dayPoints >= dailyXpTarget;

        if (hasProductiveDay && hasDailyGrinding) count += 1;
      }
      return count;
    })();
    const consistency = {
      id: "consistency_builder",
      name: "Consistency Builder",
      description:
        "In the last 7 days, count how many days achieved both “Productive Day” and “Daily Grinding”.",
      progress: weeklyProgress,
      goal: 7,
      achieved: weeklyProgress >= 7
    };

    // Daily XP: gain at least 5 experience points today.
    const dailyXp = {
      id: "daily_grinding",
      name: "Daily Grinding",
      description: "Grind at least 5 experience points today.",
      progress: Math.min(dailyXpTarget, pointsToday),
      goal: dailyXpTarget,
      achieved: pointsToday >= dailyXpTarget
    };

    return [earlyStarter, consistency, dailyXp];
  })();

  const milestoneAchievements = (() => {
    const completedCount = allCompleted.length;
    const xpGained = totalPoints;
    const levelValue = level;

    const streakBase = [1, 3, 5, 7, 30, 60, 90, 180, 365, 730, 1095, 1460, 1825, 3650];
    const countBase = [1, 5, 10, 25, 100, 150, 250, 500, 750, 1000];
    const levelBase = [1, 2, 3, 4, 5, 10];

    const streak = buildMilestones({
      base: streakBase,
      current: streakDays,
      extendFrom: 1825,
      extendStep: 365,
      minCount: 150,
      maxCount: 150
    });
    const tasksCompleted = buildMilestones({
      base: countBase,
      current: completedCount,
      extendFrom: 1000,
      extendStep: 250,
      minCount: 150,
      maxCount: 150
    });
    const xp = buildMilestones({
      base: countBase,
      current: xpGained,
      extendFrom: 1000,
      extendStep: 500,
      minCount: 150,
      maxCount: 150
    });
    const levelsUp = buildMilestones({
      base: levelBase,
      current: levelValue,
      extendFrom: 10,
      extendStep: 5,
      minCount: 150,
      maxCount: 150
    });

    const compact = (arr: number[], tail = 6) =>
      arr.length <= tail ? arr : arr.slice(-tail);

    return {
      streakDays: {
        id: "streak_days",
        name: "Day streaks",
        unit: "days",
        current: streakDays,
        next: streak.next,
        progressToNext: streak.progressToNext,
        achievedCount: streak.achievedCount,
        recentUnlocked: compact(streak.achieved),
        milestones: streak.milestones,
        achieved: streak.achieved
      },
      tasksCompleted: {
        id: "tasks_completed",
        name: "Tasks completed",
        unit: "tasks",
        current: completedCount,
        next: tasksCompleted.next,
        progressToNext: tasksCompleted.progressToNext,
        achievedCount: tasksCompleted.achievedCount,
        recentUnlocked: compact(tasksCompleted.achieved),
        milestones: tasksCompleted.milestones,
        achieved: tasksCompleted.achieved
      },
      xpGained: {
        id: "xp_gained",
        name: "Experience gained",
        unit: "XP",
        current: xpGained,
        next: xp.next,
        progressToNext: xp.progressToNext,
        achievedCount: xp.achievedCount,
        recentUnlocked: compact(xp.achieved),
        milestones: xp.milestones,
        achieved: xp.achieved
      },
      levelsUp: {
        id: "levels_up",
        name: "Levels up",
        unit: "levels",
        current: levelValue,
        next: levelsUp.next,
        progressToNext: levelsUp.progressToNext,
        achievedCount: levelsUp.achievedCount,
        recentUnlocked: compact(levelsUp.achieved),
        milestones: levelsUp.milestones,
        achieved: levelsUp.achieved
      }
    };
  })();

  res.json({
    completedToday: completedToday.length,
    streakDays,
    level,
    pointsToday,
    totalPoints,
    xpToNext,
    last7Days,
    pointsByPriority,
    achievements,
    milestoneAchievements
  });
});

app.post("/api/admin/reload-data", async (_req, res) => {
  try {
    await loadData();
    res.json({
      ok: true,
      counts: { projects: projects.length, tasks: tasks.length }
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

loadData().then(() => {
  startDataAutoSync();
  app.listen(PORT, () => {
    console.log(`Focista Schedulo backend listening on http://localhost:${PORT}`);
  });
});

