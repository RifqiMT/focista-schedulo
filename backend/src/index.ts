import express from "express";
import cors from "cors";
import { z } from "zod";
import { promises as fs } from "fs";
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
  const re = new RegExp(`^${parentId}-(\\d+)$`);
  let max = 0;
  for (const t of tasks) {
    if (!isRepeatingTask(t)) continue;
    if (seriesKeyForTask(t) !== seriesKey) continue;
    if (!t.childId) continue;
    const m = t.childId.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${parentId}-${max + 1}`;
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
    idToChildId.set(t.id, `${anchor.parentId!}-${idx + 1}`);
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

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadData() {
  await ensureDataDir();
  try {
    const rawTasks = await fs.readFile(TASKS_FILE, "utf8");
    const parsed = JSON.parse(rawTasks);
    const safe = z.array(TaskSchema).safeParse(parsed);
    if (safe.success) tasks = safe.data;
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
      sorted.find((t) => !!t.parentId)?.parentId ?? allocateNextParentId();
    const duration =
      sorted.find((t) => t.durationMinutes !== undefined)?.durationMinutes;

    const idToChildId = new Map<string, string>();
    sorted.forEach((t, idx) => {
      idToChildId.set(t.id, `${existingPid}-${idx + 1}`);
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
    const candidate = sorted.find((t) => isStandardParentId(t.parentId))?.parentId;
    const pid = candidate ?? ensureStandardParentIdForTask(sorted[0]);

    const idToChildId = new Map<string, string>();
    sorted.forEach((t, idx) => idToChildId.set(t.id, `${pid}-${idx + 1}`));

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

app.post("/api/tasks", (req, res) => {
  const baseSchema = TaskSchema.omit({ id: true, completed: true });
  const parsed = baseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const repeating = !!parsed.data.repeat && parsed.data.repeat !== "none";
  const seriesKey = seriesKeyForFields({
    projectId: parsed.data.projectId,
    title: parsed.data.title,
    repeat: parsed.data.repeat,
    repeatEvery: parsed.data.repeatEvery,
    repeatUnit: parsed.data.repeatUnit
  });
  const existingParentId = repeating ? findExistingParentIdForSeries(seriesKey) : undefined;
  const parentId =
    repeating ? (existingParentId ?? parsed.data.parentId ?? allocateNextParentId()) : parsed.data.parentId;
  const childId =
    repeating && parentId
      ? (parsed.data.childId && parsed.data.childId.startsWith(`${parentId}-`)
          ? parsed.data.childId
          : allocateNextChildId(parentId, seriesKey))
      : parsed.data.childId;
  const durationMinutes =
    parentId && parsed.data.durationMinutes === undefined
      ? firstDefinedDurationMinutesForParent(parentId)
      : parsed.data.durationMinutes;

  const task: Task = {
    id: Date.now().toString(),
    completed: false,
    cancelled: false,
    ...parsed.data,
    durationMinutes,
    parentId,
    childId
  };
  tasks.push(task);
  // Keep duration consistent across a series when a duration is supplied.
  if (parentId && durationMinutes !== undefined) {
    syncDurationMinutesForParent(parentId, durationMinutes);
    syncSeriesIdentityAndDuration({ ...task, parentId, durationMinutes });
  }
  void persistTasks();
  res.status(201).json(task);
});

app.put("/api/tasks/:id", (req, res) => {
  const id = req.params.id;
  const parsed = TaskSchema.safeParse({ ...req.body, id });
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return res.sendStatus(404);
  const existing = tasks[index];
  const repeating = !!parsed.data.repeat && parsed.data.repeat !== "none";
  const seriesKey = seriesKeyForFields({
    projectId: parsed.data.projectId,
    title: parsed.data.title,
    repeat: parsed.data.repeat,
    repeatEvery: parsed.data.repeatEvery,
    repeatUnit: parsed.data.repeatUnit
  });
  const existingParentId = repeating ? findExistingParentIdForSeries(seriesKey, id) : undefined;
  const resolvedParentId =
    repeating
      ? (existingParentId ?? parsed.data.parentId ?? existing.parentId ?? allocateNextParentId())
      : parsed.data.parentId ?? existing.parentId;

  const resolvedChildId =
    repeating && resolvedParentId
      ? (parsed.data.childId && parsed.data.childId.startsWith(`${resolvedParentId}-`)
          ? parsed.data.childId
          : existing.childId && existing.childId.startsWith(`${resolvedParentId}-`)
            ? existing.childId
            : allocateNextChildId(resolvedParentId, seriesKey))
      : parsed.data.childId ?? existing.childId;

  const next: Task = {
    ...parsed.data,
    parentId: resolvedParentId,
    childId: resolvedChildId
  };
  // If the client didn't send durationMinutes, inherit from existing.
  if (next.durationMinutes === undefined) {
    next.durationMinutes = existing.durationMinutes;
  }
  tasks[index] = next;

  // Ensure duration is consistent for all occurrences in a series.
  if (tasks[index].parentId && tasks[index].durationMinutes !== undefined) {
    syncDurationMinutesForParent(tasks[index].parentId!, tasks[index].durationMinutes!);
    syncSeriesIdentityAndDuration(tasks[index]);
  }
  void persistTasks();
  res.json(tasks[index]);
});

app.patch("/api/tasks/:id/complete", (req, res) => {
  const id = req.params.id;
  const task = tasks.find((t) => t.id === id);
  if (!task) return res.sendStatus(404);
  task.completed = !task.completed;
  void persistTasks();
  res.json(task);
});

app.delete("/api/tasks/:id", (req, res) => {
  const id = req.params.id;
  const before = tasks.length;
  tasks = tasks.filter((t) => t.id !== id);
  if (tasks.length === before) return res.sendStatus(404);
  void persistTasks();
  res.sendStatus(204);
});

app.get("/api/stats", (_req, res) => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const completedToday = tasks.filter(
    (t) => t.completed && !t.cancelled && t.dueDate === todayIso
  );
  const allCompleted = tasks.filter((t) => t.completed && !t.cancelled);

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

  res.json({
    completedToday: completedToday.length,
    streakDays: 0,
    level,
    pointsToday,
    totalPoints,
    xpToNext
  });
});

loadData().then(() => {
  app.listen(PORT, () => {
    console.log(`Focista Schedulo backend listening on http://localhost:${PORT}`);
  });
});

