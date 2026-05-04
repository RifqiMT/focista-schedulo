import express from "express";
import cors from "cors";
import compression from "compression";
import { z } from "zod";
import { promises as fs } from "fs";
import { watch as fsWatch } from "fs";
import path from "path";
import { computeMonthlyGrinding } from "./monthlyGrinding";
import { computeYearlyGrinding } from "./yearlyGrinding";
import { buildBadgesEarnedMilestoneBlock } from "./badgesEarnedMilestone";
import { capMilestoneBadges } from "./capMilestoneBadges";
import { hashPassword, verifyPassword } from "./profileSecurity";
import {
  createProfile as createProfileRecord,
  deleteProfile as deleteProfileRecord,
  toProfilePublic,
  updateProfile as updateProfileRecord,
  verifyProfileUnlock
} from "./profileService";

const app = express();
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN?.trim();
if (FRONTEND_ORIGIN) {
  app.use(cors({ origin: FRONTEND_ORIGIN, credentials: false }));
} else {
  app.use(cors());
}
app.use(compression());
// Accept larger JSON bodies for import workflows.
app.use(express.json({ limit: "10mb" }));
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  const started = performance.now();
  const originalEnd = res.end.bind(res);
  res.end = ((...args: unknown[]) => {
    const elapsed = performance.now() - started;
    if (!res.headersSent) {
      res.setHeader("X-Server-Time-Ms", elapsed.toFixed(1));
    }
    return originalEnd(...(args as Parameters<typeof originalEnd>));
  }) as typeof res.end;
  next();
});

const PORT = process.env.PORT || 4000;
const DATA_DIR = path.join(__dirname, "..", "data");
const UNIFIED_DATA_FILE = path.join(DATA_DIR, "focista-unified-data.json");
const TASKS_FILE = path.join(DATA_DIR, "tasks.runtime.json");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.runtime.json");
const PROFILES_FILE = path.join(DATA_DIR, "profiles.runtime.json");
const LEGACY_TASKS_FILE = path.join(DATA_DIR, "tasks.json");
const LEGACY_PROJECTS_FILE = path.join(DATA_DIR, "projects.json");

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
  profileId: z.string().nullable().optional(),
  projectId: z.string().nullable(),
  completed: z.boolean(),
  completedAt: z.string().optional(),
  parentId: z.string().optional(),
  childId: z.string().optional(),
  cancelled: z.boolean().optional()
});

const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  profileId: z.string().nullable().optional()
});

const ProfileSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  title: z.string().min(1),
  passwordHash: z.string().min(1).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

type Task = z.infer<typeof TaskSchema>;
type Project = z.infer<typeof ProjectSchema>;
type Profile = z.infer<typeof ProfileSchema>;

let tasks: Task[] = [];
let projects: Project[] = [];
let profiles: Profile[] = [];
let lastProfileBackfillDiagnostics: {
  totalBackfilled: number;
  byProfileId: Record<string, number>;
  byProfileName: Record<string, number>;
} = {
  totalBackfilled: 0,
  byProfileId: {},
  byProfileName: {}
};

type ImportFormat = "json" | "csv";

function parseCsv(content: string): { headers: string[]; rows: Record<string, string>[] } {
  const s = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    // Skip empty trailing lines
    if (row.length === 1 && row[0] === "") {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = s[i + 1];
        if (next === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushCell();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushCell();
      pushRow();
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  pushCell();
  pushRow();

  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => (h ?? "").trim());
  const out: Record<string, string>[] = [];
  for (const r of rows.slice(1)) {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    out.push(obj);
  }
  return { headers, rows: out };
}

function parseBool(v: string | undefined): boolean | undefined {
  if (v == null) return undefined;
  const s = v.trim().toLowerCase();
  if (s === "") return undefined;
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return undefined;
}

function parseIntOpt(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const s = v.trim();
  if (s === "") return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

const CSV_REPEAT_VALUES = [
  "none",
  "daily",
  "weekly",
  "weekdays",
  "weekends",
  "monthly",
  "quarterly",
  "yearly",
  "custom"
] as const;

function parseCsvRepeat(v: string | undefined): (typeof CSV_REPEAT_VALUES)[number] {
  const s = (v ?? "none").trim();
  return CSV_REPEAT_VALUES.includes(s as (typeof CSV_REPEAT_VALUES)[number])
    ? (s as (typeof CSV_REPEAT_VALUES)[number])
    : "none";
}

const CSV_REPEAT_UNITS = ["day", "week", "month", "quarter", "year"] as const;

function parseCsvRepeatUnit(v: string | undefined): Task["repeatUnit"] | undefined {
  const s = (v ?? "").trim();
  if (!s) return undefined;
  return (CSV_REPEAT_UNITS as readonly string[]).includes(s)
    ? (s as NonNullable<Task["repeatUnit"]>)
    : undefined;
}

function isLooseProjectArray(p: unknown): p is unknown[] {
  return (
    Array.isArray(p) &&
    p.length > 0 &&
    typeof p[0] === "object" &&
    p[0] !== null &&
    typeof (p[0] as Record<string, unknown>).name === "string"
  );
}

function isLooseTaskArray(p: unknown): p is unknown[] {
  return (
    Array.isArray(p) &&
    p.length > 0 &&
    typeof p[0] === "object" &&
    p[0] !== null &&
    typeof (p[0] as Record<string, unknown>).priority === "string"
  );
}

function isLooseProfileArray(p: unknown): p is unknown[] {
  return (
    Array.isArray(p) &&
    p.length > 0 &&
    typeof p[0] === "object" &&
    p[0] !== null &&
    typeof (p[0] as Record<string, unknown>).name === "string" &&
    typeof (p[0] as Record<string, unknown>).title === "string"
  );
}

function parseProfilesLoose(rows: unknown[]): Profile[] {
  const nowIso = new Date().toISOString();
  const out: Profile[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    const rawName = String(r.name ?? r.profileName ?? "").trim();
    const rawTitle = String(r.title ?? r.profileTitle ?? rawName).trim();
    if (!rawName || !rawTitle) continue;
    const idRaw = String(r.id ?? "").trim();
    const profile: Profile = {
      id: idRaw || makeProfileId(),
      name: rawName,
      title: rawTitle,
      passwordHash:
        typeof r.passwordHash === "string" && r.passwordHash.trim() ? r.passwordHash.trim() : undefined,
      createdAt:
        typeof r.createdAt === "string" && r.createdAt.trim() ? r.createdAt.trim() : nowIso,
      updatedAt:
        typeof r.updatedAt === "string" && r.updatedAt.trim() ? r.updatedAt.trim() : nowIso
    };
    out.push(profile);
  }
  return out;
}

function normalizeProfileLabel(label: string | undefined): string {
  return (label ?? "").trim().toLowerCase();
}

function parsePipeArray(v: string | undefined): string[] {
  const s = (v ?? "").trim();
  if (!s) return [];
  return s.split("|").map((x) => x.trim()).filter(Boolean);
}

function mergeProjects(existing: Project[], incoming: Project[]): Project[] {
  const byId = new Map<string, Project>();
  for (const p of existing) byId.set(p.id, p);
  for (const p of incoming) {
    const prev = byId.get(p.id);
    if (!prev) byId.set(p.id, p);
    else byId.set(p.id, { ...prev, ...p });
  }
  const bySemantic = new Map<string, Project>();
  for (const p of byId.values()) {
    const key = `${(p.profileId ?? "").trim().toLowerCase()}::${p.name.trim().toLowerCase()}`;
    const prev = bySemantic.get(key);
    if (!prev) {
      bySemantic.set(key, p);
      continue;
    }
    if (p.id.localeCompare(prev.id) > 0) bySemantic.set(key, p);
  }
  return Array.from(bySemantic.values());
}

function mergeProfiles(existing: Profile[], incoming: Profile[]): Profile[] {
  const byId = new Map<string, Profile>();
  for (const p of existing) byId.set(p.id, p);
  for (const p of incoming) {
    const prev = byId.get(p.id);
    byId.set(
      p.id,
      prev
        ? {
            ...prev,
            ...p,
            createdAt: prev.createdAt || p.createdAt
          }
        : p
    );
  }
  const bySemantic = new Map<string, Profile>();
  for (const p of byId.values()) {
    const key = `${normalizeProfileLabel(p.name)}::${normalizeProfileLabel(p.title)}`;
    const prev = bySemantic.get(key);
    if (!prev) {
      bySemantic.set(key, p);
      continue;
    }
    const prevUpdated = toEpochMs(prev.updatedAt);
    const nextUpdated = toEpochMs(p.updatedAt);
    if (nextUpdated >= prevUpdated) {
      bySemantic.set(key, p);
    }
  }
  return Array.from(bySemantic.values());
}

function canonicalizeProfilesAndRemap(
  profilesInput: Profile[],
  projectsInput: Project[],
  tasksInput: Task[]
): { profiles: Profile[]; projects: Project[]; tasks: Task[] } {
  const bySemantic = new Map<string, Profile>();
  const aliasById = new Map<string, string>();
  for (const p of profilesInput) {
    const key = `${normalizeProfileLabel(p.name)}::${normalizeProfileLabel(p.title)}`;
    const prev = bySemantic.get(key);
    if (!prev) {
      bySemantic.set(key, p);
      aliasById.set(p.id, p.id);
      continue;
    }
    const prevUpdated = toEpochMs(prev.updatedAt);
    const nextUpdated = toEpochMs(p.updatedAt);
    if (nextUpdated >= prevUpdated) {
      aliasById.set(prev.id, p.id);
      aliasById.set(p.id, p.id);
      bySemantic.set(key, p);
    } else {
      aliasById.set(p.id, prev.id);
    }
  }
  const canonicalProfiles = Array.from(bySemantic.values());
  const canonicalIds = new Set(canonicalProfiles.map((p) => p.id));
  const remap = (pid: string | null | undefined): string | null => {
    if (!pid) return null;
    const mapped = aliasById.get(pid) ?? pid;
    return canonicalIds.has(mapped) ? mapped : null;
  };
  const projects = projectsInput.map((p) => ({ ...p, profileId: remap(p.profileId) }));
  const tasks = tasksInput.map((t) => ({ ...t, profileId: remap(t.profileId) }));
  return { profiles: canonicalProfiles, projects, tasks };
}

function mergeTasks(existing: Task[], incoming: Task[]): Task[] {
  const byId = new Map<string, Task>();
  for (const t of existing) byId.set(t.id, t);
  for (const t of incoming) {
    const prev = byId.get(t.id);
    if (!prev) byId.set(t.id, t);
    else {
      // Prefer incoming values but preserve cancellation/completion intent if either is true.
      byId.set(t.id, {
        ...prev,
        ...t,
        completed: prev.completed || t.completed,
        cancelled: (prev.cancelled ?? false) || (t.cancelled ?? false)
      });
    }
  }
  const merged = Array.from(byId.values());
  const bySemantic = new Map<string, Task>();
  for (const t of merged) {
    const key = isRepeatingTask(t)
      ? `series::${seriesKeyForTask(t)}::${t.dueDate ?? ""}`
      : `single::${(t.profileId ?? "").trim().toLowerCase()}::${(t.projectId ?? "")
          .trim()
          .toLowerCase()}::${t.title.trim().toLowerCase()}::${t.description?.trim().toLowerCase() ?? ""}::${
          t.dueDate ?? ""
        }::${t.dueTime ?? ""}::${t.priority}::${t.completed ? 1 : 0}::${t.cancelled ? 1 : 0}`;
    const prev = bySemantic.get(key);
    if (!prev) {
      bySemantic.set(key, t);
      continue;
    }
    const prevRecency = toEpochMs(prev.completedAt);
    const nextRecency = toEpochMs(t.completedAt);
    if (nextRecency >= prevRecency) bySemantic.set(key, t);
  }
  return Array.from(bySemantic.values());
}

function toEpochMs(iso: string | undefined): number {
  const s = (iso ?? "").trim();
  if (!s) return 0;
  const d = new Date(s);
  const ms = d.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function mergeTasksPreferLatest(existing: Task[], incoming: Task[]): Task[] {
  const byId = new Map<string, Task>();
  for (const t of existing) byId.set(t.id, t);
  for (const t of incoming) {
    const prev = byId.get(t.id);
    if (!prev) {
      byId.set(t.id, t);
      continue;
    }
    const prevRecency = toEpochMs(prev.completedAt);
    const nextRecency = toEpochMs(t.completedAt);
    const winner = nextRecency >= prevRecency ? t : prev;
    const loser = winner === t ? prev : t;
    byId.set(t.id, {
      ...loser,
      ...winner,
      completed: (loser.completed ?? false) || (winner.completed ?? false),
      cancelled: (loser.cancelled ?? false) || (winner.cancelled ?? false)
    });
  }
  const merged = Array.from(byId.values());
  const bySemantic = new Map<string, Task>();
  for (const t of merged) {
    const key = isRepeatingTask(t)
      ? `series::${seriesKeyForTask(t)}::${t.dueDate ?? ""}`
      : `single::${(t.profileId ?? "").trim().toLowerCase()}::${(t.projectId ?? "")
          .trim()
          .toLowerCase()}::${t.title.trim().toLowerCase()}::${t.description?.trim().toLowerCase() ?? ""}::${
          t.dueDate ?? ""
        }::${t.dueTime ?? ""}::${t.priority}::${t.completed ? 1 : 0}::${t.cancelled ? 1 : 0}`;
    const prev = bySemantic.get(key);
    if (!prev) {
      bySemantic.set(key, t);
      continue;
    }
    const prevRecency = toEpochMs(prev.completedAt);
    const nextRecency = toEpochMs(t.completedAt);
    if (nextRecency >= prevRecency) bySemantic.set(key, t);
  }
  return Array.from(bySemantic.values());
}

async function readSyncSourceFromDataDir(): Promise<{
  projects: Project[];
  tasks: Task[];
  profiles: Profile[];
  filesRead: number;
}> {
  // Sync is explicitly non-monolith: ignore unified snapshot file.
  // Use runtime split files (and compatible JSON fallbacks) only.
  const entries = await fs.readdir(DATA_DIR).catch(() => []);
  const jsonFiles = entries.filter((n) => {
    const lower = n.toLowerCase();
    return lower.endsWith(".json") && lower !== "focista-unified-data.json";
  });
  const fileMetas = await Promise.all(
    jsonFiles.map(async (name) => {
      const full = path.join(DATA_DIR, name);
      const st = await fs.stat(full).catch(() => null);
      return st ? { name, full, mtimeMs: st.mtimeMs } : null;
    })
  );
  const ordered = fileMetas.filter(Boolean).sort((a, b) => a!.mtimeMs - b!.mtimeMs) as Array<{
    name: string;
    full: string;
    mtimeMs: number;
  }>;

  let incomingProjects: Project[] = [];
  let incomingTasks: Task[] = [];
  let incomingProfiles: Profile[] = [];

  for (const f of ordered) {
    const raw = await fs.readFile(f.full, "utf8").catch(() => "");
    if (!raw.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const rec =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    const pArr = Array.isArray(rec?.projects)
      ? rec.projects
      : isLooseProjectArray(parsed)
        ? parsed
        : [];
    const tArr = Array.isArray(rec?.tasks)
      ? rec.tasks
      : isLooseTaskArray(parsed)
        ? parsed
        : [];

    const pSafe = z.array(ProjectSchema).safeParse(pArr);
    const tSafe = z.array(TaskSchema).safeParse(tArr);
    const profileArr = Array.isArray(rec?.profiles)
      ? rec.profiles
      : Array.isArray(parsed)
        ? parsed
        : [];
    const profileSafe = z.array(ProfileSchema).safeParse(profileArr);
    if (pSafe.success && pSafe.data.length) {
      incomingProjects = mergeProjects(incomingProjects, pSafe.data);
    }
    if (tSafe.success && tSafe.data.length) {
      incomingTasks = mergeTasksPreferLatest(incomingTasks, tSafe.data);
    }
    if (profileSafe.success && profileSafe.data.length) {
      incomingProfiles = mergeProfiles(incomingProfiles, profileSafe.data);
    }
  }

  return {
    projects: incomingProjects,
    tasks: incomingTasks,
    profiles: incomingProfiles,
    filesRead: ordered.length
  };
}

// Lightweight in-memory caching for expensive aggregate endpoints.
type CachedValue<T> = {
  version: number;
  value: T;
  at: number;
};

let dataVersion = 0;

type SseClient = {
  id: string;
  res: import("express").Response;
};

const sseClients = new Map<string, SseClient>();

function sseSend(res: import("express").Response, event: string, data: unknown) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Ignore write failures; client cleanup happens on close.
  }
}

function broadcastDataVersion() {
  const payload = { version: dataVersion, at: Date.now() };
  for (const c of sseClients.values()) {
    sseSend(c.res, "dataVersion", payload);
  }
}

function bumpDataVersion(): void {
  dataVersion += 1;
  broadcastDataVersion();
}

function makeCache<T>() {
  let cache: CachedValue<T> | null = null;
  return {
    get(): T | null {
      if (!cache) return null;
      if (cache.version !== dataVersion) return null;
      return cache.value;
    },
    set(value: T) {
      cache = { version: dataVersion, value, at: Date.now() };
    },
    clear() {
      cache = null;
    }
  };
}

function makeScopedCache<T>() {
  const cache = new Map<string, CachedValue<T>>();
  return {
    get(key: string): T | null {
      const row = cache.get(key);
      if (!row) return null;
      if (row.version !== dataVersion) return null;
      return row.value;
    },
    set(key: string, value: T) {
      cache.set(key, { version: dataVersion, value, at: Date.now() });
    },
    clear() {
      cache.clear();
    }
  };
}

const statsCache = makeScopedCache<unknown>();
const productivityCache = makeScopedCache<unknown>();

function makeTaskId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function makeProfileId(): string {
  return `PR-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

const PROFILE_ID_FORMAT = /^PR-\d{13}-[a-f0-9]{6}$/;
const RIFQI_PROFILE_NAME = "rifqi tjahyono";
const RIFQI_PROFILE_TARGET_ID = "PR-1777494302624-98735a";

function isCanonicalProfileId(id: string | null | undefined): boolean {
  return !!id && PROFILE_ID_FORMAT.test(id);
}

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

function parseIsoDateTimeToLocalDate(isoDateTime: string | undefined): string | null {
  if (!isoDateTime) return null;
  const d = new Date(isoDateTime);
  if (Number.isNaN(d.getTime())) return null;
  return isoDateLocal(d);
}

/** Calendar day used for progress (/api/stats, productivity, streaks): due date when set, else completion timestamp. */
function completionDateIsoLocalForTask(t: Task): string | null {
  if (!t.completed) return null;
  // Primary semantics: progress is attributed to the scheduling intent (due date) when present.
  if (t.dueDate) return t.dueDate;
  // Fallback: if undated, attribute to the local calendar day of completion time.
  return parseIsoDateTimeToLocalDate(t.completedAt);
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

function hasProjectId(projectId: string | null | undefined): projectId is string {
  return typeof projectId === "string" && projectId.trim() !== "";
}

function hasProfileId(profileId: string | null | undefined): profileId is string {
  return typeof profileId === "string" && profileId.trim() !== "";
}

function profileIdForProjectId(projectId: string | null | undefined): string | null {
  if (!hasProjectId(projectId)) return null;
  return projects.find((p) => p.id === projectId)?.profileId ?? null;
}

function syncProjectIdForParent(parentId: string) {
  // Enforce invariant: all tasks sharing a parentId share the same projectId.
  // Pick the first non-empty projectId in that parent group; otherwise null.
  const canonical =
    tasks.find((t) => t.parentId === parentId && hasProjectId(t.projectId))?.projectId ?? null;
  const canonicalProfileId =
    (hasProjectId(canonical)
      ? profileIdForProjectId(canonical)
      : (tasks.find((t) => t.parentId === parentId && hasProfileId(t.profileId))?.profileId ?? null)) ??
    null;
  tasks = tasks.map((t) =>
    t.parentId === parentId
      ? { ...t, projectId: canonical, profileId: canonicalProfileId }
      : t
  );
}

function forceProjectIdForParent(parentId: string, projectId: string | null) {
  // Explicit series move: if the user edits a single occurrence's project, the intent is that the
  // whole parent group stays consistent (historical + future occurrences).
  const canonical = hasProjectId(projectId) ? projectId : null;
  const canonicalProfileId =
    (hasProjectId(canonical)
      ? profileIdForProjectId(canonical)
      : (tasks.find((t) => t.parentId === parentId && hasProfileId(t.profileId))?.profileId ?? null)) ??
    null;
  tasks = tasks.map((t) =>
    t.parentId === parentId
      ? { ...t, projectId: canonical, profileId: canonicalProfileId }
      : t
  );
}

function isRepeatingTask(t: Task): boolean {
  return !!t.repeat && t.repeat !== "none";
}

function seriesKeyForTask(t: Task): string {
  return [
    t.profileId ?? "",
    t.projectId ?? "",
    t.title,
    t.repeat ?? "none",
    String(t.repeatEvery ?? ""),
    String(t.repeatUnit ?? "")
  ].join("::");
}

function seriesKeyForFields(fields: {
  profileId: string | null;
  projectId: string | null;
  title: string;
  repeat?: Task["repeat"];
  repeatEvery?: number;
  repeatUnit?: Task["repeatUnit"];
}): string {
  return [
    fields.profileId ?? "",
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
    // Backfilled occurrences should inherit the canonical projectId for the series,
    // not just the earliest template row (older data may have projectId only on later rows).
    const canonicalProjectId =
      sorted.find((t) => hasProjectId(t.projectId))?.projectId ?? null;
    const canonicalProfileId =
      sorted.find((t) => hasProfileId(t.profileId))?.profileId ??
      profileIdForProjectId(canonicalProjectId);

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

    // Fill *missing* persisted occurrences up to latestCompletedDueDate as completed
    // (so completing a later day still materializes earlier gap dates).
    // Do **not** force completed=true on rows that already exist: that overwrote
    // explicit "mark active" toggles after persist + file reload.
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

      if (!exists) {
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
          projectId: canonicalProjectId,
          profileId: canonicalProfileId,
          completed: true,
          completedAt: new Date().toISOString(),
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

function repairMissingProjectIdsForRepeatingSeries(): boolean {
  // Only fill missing projectId within an existing parent group when the group already has
  // exactly one non-empty projectId. Do NOT infer across different parentIds (titles can repeat).
  const parentIds = new Set(tasks.map((t) => t.parentId).filter((v): v is string => !!v));
  if (parentIds.size === 0) return false;

  let changed = false;
  for (const pid of parentIds) {
    const members = tasks.filter((t) => t.parentId === pid && isRepeatingTask(t) && !t.cancelled);
    if (members.length === 0) continue;
    const ids = new Set(members.map((t) => t.projectId).filter(hasProjectId));
    if (ids.size !== 1) continue;
    const canonical = Array.from(ids)[0] ?? null;
    if (!canonical) continue;
    const hasMissing = members.some((t) => !hasProjectId(t.projectId));
    if (!hasMissing) continue;
    tasks = tasks.map((t) =>
      t.parentId === pid && isRepeatingTask(t) && !t.cancelled && !hasProjectId(t.projectId)
        ? { ...t, projectId: canonical }
        : t
    );
    changed = true;
  }

  return changed;
}

function repairMissingProfileIdsForRepeatingSeries(): boolean {
  // Only fill missing profileId within an existing parent group when the group already has
  // exactly one non-empty profileId. Do NOT infer across different parentIds.
  const parentIds = new Set(tasks.map((t) => t.parentId).filter((v): v is string => !!v));
  if (parentIds.size === 0) return false;

  let changed = false;
  for (const pid of parentIds) {
    const members = tasks.filter((t) => t.parentId === pid && isRepeatingTask(t) && !t.cancelled);
    if (members.length === 0) continue;
    const ids = new Set(members.map((t) => t.profileId).filter(hasProfileId));
    if (ids.size !== 1) continue;
    const canonical = Array.from(ids)[0] ?? null;
    if (!canonical) continue;
    const hasMissing = members.some((t) => !hasProfileId(t.profileId));
    if (!hasMissing) continue;
    tasks = tasks.map((t) =>
      t.parentId === pid && isRepeatingTask(t) && !t.cancelled && !hasProfileId(t.profileId)
        ? { ...t, profileId: canonical }
        : t
    );
    changed = true;
  }

  return changed;
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readUnifiedDataFile(): Promise<{
  projects: Project[];
  tasks: Task[];
  profiles: Profile[];
} | null> {
  try {
    const raw = await fs.readFile(UNIFIED_DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const rec =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    if (!rec) return null;

    const projectsRaw = Array.isArray(rec.projects) ? rec.projects : [];
    const tasksRaw = Array.isArray(rec.tasks) ? rec.tasks : [];
    const profilesRaw = Array.isArray(rec.profiles) ? rec.profiles : [];

    // Strict-first parse, then degrade gracefully per-row if one malformed item exists.
    const pSafe = z.array(ProjectSchema).safeParse(projectsRaw);
    const tSafe = z.array(TaskSchema).safeParse(tasksRaw);
    const profileSafe = z.array(ProfileSchema).safeParse(profilesRaw);
    if (pSafe.success && tSafe.success && profileSafe.success) {
      return { projects: pSafe.data, tasks: tSafe.data, profiles: profileSafe.data };
    }

    const projects: Project[] = [];
    const tasks: Task[] = [];
    const profiles: Profile[] = [];
    let droppedProjects = 0;
    let droppedTasks = 0;
    let droppedProfiles = 0;

    for (const p of projectsRaw) {
      const ok = ProjectSchema.safeParse(p);
      if (ok.success) projects.push(ok.data);
      else droppedProjects += 1;
    }
    for (const t of tasksRaw) {
      const ok = TaskSchema.safeParse(t);
      if (ok.success) tasks.push(ok.data);
      else droppedTasks += 1;
    }
    for (const p of profilesRaw) {
      const ok = ProfileSchema.safeParse(p);
      if (ok.success) profiles.push(ok.data);
      else droppedProfiles += 1;
    }

    if (droppedProjects || droppedTasks || droppedProfiles) {
      console.warn("[unified-data] dropped invalid rows", {
        droppedProjects,
        droppedTasks,
        droppedProfiles
      });
    }

    // If everything got dropped, treat file as unusable and fallback to legacy/default flow.
    if (projects.length === 0 && tasks.length === 0 && profiles.length === 0) return null;
    return { projects, tasks, profiles };
  } catch {
    return null;
  }
}

async function readRuntimeDataFiles(): Promise<{
  projects: Project[];
  tasks: Task[];
  profiles: Profile[];
} | null> {
  const parseArrayFile = async <T>(file: string, schema: z.ZodType<T>): Promise<T[] | null> => {
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      const safe = z.array(schema).safeParse(parsed);
      return safe.success ? safe.data : [];
    } catch {
      return null;
    }
  };

  const [tasksRuntime, projectsRuntime, profilesRuntime] = await Promise.all([
    parseArrayFile(TASKS_FILE, TaskSchema),
    parseArrayFile(PROJECTS_FILE, ProjectSchema),
    parseArrayFile(PROFILES_FILE, ProfileSchema)
  ]);

  const hasAnyRuntime =
    tasksRuntime !== null || projectsRuntime !== null || profilesRuntime !== null;
  if (!hasAnyRuntime) return null;
  return {
    projects: projectsRuntime ?? [],
    tasks: tasksRuntime ?? [],
    profiles: profilesRuntime ?? []
  };
}

async function loadData() {
  await ensureDataDir();
  // Runtime mode (non-monolith): split files are primary source for normal app usage.
  const runtime = await readRuntimeDataFiles();
  if (runtime) {
    projects = runtime.projects;
    tasks = runtime.tasks;
    profiles = runtime.profiles;
  } else {
    const unified = await readUnifiedDataFile();
    if (unified) {
      projects = unified.projects;
      tasks = unified.tasks;
      profiles = unified.profiles;
      // Bootstrap runtime files from unified snapshot once.
      await Promise.all([
        fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf8"),
        fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2), "utf8"),
        fs.writeFile(PROFILES_FILE, JSON.stringify(profiles, null, 2), "utf8")
      ]);
    } else {
    try {
      const rawTasks = await fs.readFile(LEGACY_TASKS_FILE, "utf8");
      const parsed = JSON.parse(rawTasks);
      const safe = z.array(TaskSchema).safeParse(parsed);
      if (safe.success) tasks = safe.data;
      else tasks = [];
    } catch {
      tasks = [];
    }

    try {
      const rawProjects = await fs.readFile(LEGACY_PROJECTS_FILE, "utf8");
      const parsed = JSON.parse(rawProjects);
      const safe = z.array(ProjectSchema).safeParse(parsed);
      if (safe.success) projects = safe.data;
      else projects = [];
    } catch {
      projects = [
        { id: "P1", name: "Personal Growth" },
        { id: "P2", name: "Work – Q2 Delivery" }
      ];
    }
    profiles = [];
    }
  }

  // Keep label/link ordering deterministic across all UI surfaces.
  tasks = tasks.map((t) => ({
    ...t,
    completedAt: t.completed ? t.completedAt : undefined,
    labels: sortLabelsAsc(t.labels),
    link: t.link ? sortLinksAsc(t.link) : t.link
  }));

  // Repair inconsistent data from historical race conditions:
  // 1) remove duplicate IDs (keep latest record)
  // 2) collapse duplicate repeating occurrences on the same dueDate
  //    within the same logical series (prefer completed=true if either is completed)
  const byId = new Map<string, Task>();
  for (const t of tasks) {
    byId.set(t.id, t);
  }
  const afterIdDedup = Array.from(byId.values());

  const bySeriesDue = new Map<string, Task>();
  for (const t of afterIdDedup) {
    if (!isRepeatingTask(t) || !t.dueDate || t.cancelled) {
      bySeriesDue.set(`id:${t.id}`, t);
      continue;
    }
    const key = `series:${seriesKeyForTask(t)}::${t.dueDate}`;
    const existing = bySeriesDue.get(key);
    if (!existing) {
      bySeriesDue.set(key, t);
      continue;
    }
    bySeriesDue.set(key, {
      ...existing,
      ...t,
      completed: existing.completed || t.completed
    });
  }
  const normalized = Array.from(bySeriesDue.values());
  if (normalized.length !== tasks.length) {
    tasks = normalized;
    await persistTasks();
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

  // Normalize profile IDs:
  // - Force profile "Rifqi Tjahyono" to requested stable ID.
  // - Ensure all other profiles use canonical format PR-<13digits>-<hex6>.
  const profileIdMap = new Map<string, string>();
  const usedProfileIds = new Set<string>();
  profiles = profiles.map((p) => {
    const oldId = p.id;
    const normalizedName = p.name.trim().toLowerCase();
    let nextId = oldId;
    if (normalizedName === RIFQI_PROFILE_NAME) {
      nextId = RIFQI_PROFILE_TARGET_ID;
    } else if (!isCanonicalProfileId(oldId)) {
      nextId = makeProfileId();
      while (usedProfileIds.has(nextId)) nextId = makeProfileId();
    }
    usedProfileIds.add(nextId);
    if (nextId !== oldId) profileIdMap.set(oldId, nextId);
    return nextId === oldId ? p : { ...p, id: nextId };
  });
  // Collapse any accidental duplicates after ID normalization by semantic identity.
  profiles = mergeProfiles([], profiles);
  if (profileIdMap.size > 0) {
    projects = projects.map((p) => {
      const pid = p.profileId ?? null;
      if (!pid) return p;
      const mapped = profileIdMap.get(pid);
      return mapped ? { ...p, profileId: mapped } : p;
    });
    tasks = tasks.map((t) => {
      const pid = t.profileId ?? null;
      if (!pid) return t;
      const mapped = profileIdMap.get(pid);
      return mapped ? { ...t, profileId: mapped } : t;
    });
    await persistProfiles();
    await persistProjects();
    await persistTasks();
  }

  // Backfill missing task.profileId from associated project.profileId.
  // This keeps profile-scoped views consistent after sync/import of partial records.
  let profileBackfillMutated = false;
  let profileBackfillCount = 0;
  const profileBackfillByProfileId = new Map<string, number>();
  const profileNameById = new Map(profiles.map((p) => [p.id, p.name]));
  tasks = tasks.map((t) => {
    if (hasProfileId(t.profileId)) return t;
    if (!hasProjectId(t.projectId)) return t;
    const inferredProfileId = profileIdForProjectId(t.projectId);
    if (!hasProfileId(inferredProfileId)) return t;
    profileBackfillMutated = true;
    profileBackfillCount += 1;
    profileBackfillByProfileId.set(
      inferredProfileId,
      (profileBackfillByProfileId.get(inferredProfileId) ?? 0) + 1
    );
    return { ...t, profileId: inferredProfileId };
  });
  lastProfileBackfillDiagnostics = {
    totalBackfilled: profileBackfillCount,
    byProfileId: Object.fromEntries(profileBackfillByProfileId.entries()),
    byProfileName: Object.fromEntries(
      Array.from(profileBackfillByProfileId.entries()).map(([id, count]) => [
        profileNameById.get(id) ?? id,
        count
      ])
    )
  };
  if (profileBackfillMutated) {
    console.info("[loadData] profileId backfill", lastProfileBackfillDiagnostics);
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

  // Ensure all children/occurrences share the same projectId as their parent group.
  const parentIds = new Set(tasks.map((t) => t.parentId).filter((v): v is string => !!v));
  if (parentIds.size > 0) {
    let projMutated = false;
    for (const pid of parentIds) {
      const before = tasks.find((t) => t.parentId === pid)?.projectId ?? null;
      syncProjectIdForParent(pid);
      const after = tasks.find((t) => t.parentId === pid)?.projectId ?? null;
      if (before !== after) projMutated = true;
    }
    if (projMutated) await persistTasks();
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

  // Repair missing project association in repeating series (high confidence only).
  // Keeps "Tasks completed by project" accurate for historical + backfilled occurrences.
  const inferredProjectIds = repairMissingProjectIdsForRepeatingSeries();
  if (inferredProjectIds) {
    await persistTasks();
  }

  // Repair missing profile association in repeating series (high confidence only).
  // This prevents profile-scoped views from hiding valid recurring occurrences.
  const inferredProfileIds = repairMissingProfileIdsForRepeatingSeries();
  if (inferredProfileIds) {
    await persistTasks();
  }

  // Enforce sequential completion for repeating series:
  // If a later occurrence is marked completed, we materialize any missing
  // earlier occurrences and mark them completed too so the UI has no "gaps".
  const completionMutated = await enforceSequentialCompletionForRepeatingSeries();
  if (completionMutated) {
    await persistTasks();
  }

  statsCache.clear();
  productivityCache.clear();
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

let persistDebounceTimer: NodeJS.Timeout | null = null;
let persistInFlight: Promise<void> | null = null;
let persistResolvers: Array<() => void> = [];
let persistRejectors: Array<(err: unknown) => void> = [];
let dirtyTasks = false;
let dirtyProjects = false;
let dirtyProfiles = false;

async function persistRuntimeData(): Promise<void> {
  await ensureDataDir();
  const writes: Array<Promise<void>> = [];
  if (dirtyTasks) {
    writes.push(fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf8"));
  }
  if (dirtyProjects) {
    writes.push(fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2), "utf8"));
  }
  if (dirtyProfiles) {
    writes.push(fs.writeFile(PROFILES_FILE, JSON.stringify(profiles, null, 2), "utf8"));
  }
  await Promise.all(writes);
  dirtyTasks = false;
  dirtyProjects = false;
  dirtyProfiles = false;
}

async function flushPersistQueue(): Promise<void> {
  // Serialize writes and coalesce bursts.
  if (persistInFlight) {
    await persistInFlight;
  }
  const resolvers = persistResolvers;
  const rejectors = persistRejectors;
  persistResolvers = [];
  persistRejectors = [];

  persistInFlight = (async () => {
    await persistRuntimeData();
    bumpDataVersion();
  })();

  try {
    await persistInFlight;
    resolvers.forEach((r) => r());
  } catch (err) {
    rejectors.forEach((rj) => rj(err));
  } finally {
    persistInFlight = null;
  }
}

function schedulePersistFlush(delayMs = 40): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    persistResolvers.push(resolve);
    persistRejectors.push(reject);
    if (persistDebounceTimer) clearTimeout(persistDebounceTimer);
    persistDebounceTimer = setTimeout(() => {
      persistDebounceTimer = null;
      void flushPersistQueue();
    }, delayMs);
  });
}

async function persistTasks() {
  // Invalidate before awaiting I/O so /api/stats cannot return pre-mutation cache
  // while in-memory `tasks` is already updated.
  statsCache.clear();
  productivityCache.clear();
  dirtyTasks = true;
  await schedulePersistFlush();
}

async function persistProjects() {
  statsCache.clear();
  productivityCache.clear();
  dirtyProjects = true;
  await schedulePersistFlush();
}

async function persistProfiles() {
  statsCache.clear();
  productivityCache.clear();
  dirtyProfiles = true;
  await schedulePersistFlush();
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "focista-schedulo-backend" });
});

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");
  // If behind a proxy, prevent buffering so events flush immediately.
  res.setHeader("X-Accel-Buffering", "no");

  // Initial handshake.
  res.write("retry: 2000\n\n");

  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  sseClients.set(id, { id, res });

  // Send the current version immediately so clients can sync on connect.
  sseSend(res, "dataVersion", { version: dataVersion, at: Date.now() });

  const keepAlive = setInterval(() => {
    // Comment ping keeps connections open through intermediaries.
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      // ignore
    }
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.delete(id);
  });
});

app.get("/api/projects", (req, res) => {
  const effectiveProfileId = resolveEffectiveProfileId(req.query.profileId);
  const cleaned = dedupeProjectsForRead(projects);
  if (effectiveProfileId) {
    return res.json(cleaned.filter((p) => (p.profileId ?? null) === effectiveProfileId));
  }
  res.json(cleaned);
});

const SHOWCASE_READONLY_PROFILE_NAME = "test";
const SHOWCASE_READONLY_MESSAGE =
  'Showcase mode: profile "Test" is read-only. Create, edit, and delete actions are disabled.';

function getShowcaseReadOnlyProfileId(): string | null {
  const match = profiles.find(
    (p) => p.name.trim().toLowerCase() === SHOWCASE_READONLY_PROFILE_NAME
  );
  return match?.id ?? null;
}

function isShowcaseReadOnlyProfileId(profileId: string | null | undefined): boolean {
  if (!profileId) return false;
  const lockedId = getShowcaseReadOnlyProfileId();
  if (!lockedId) return false;
  return profileId === lockedId;
}

app.post("/api/projects", (req, res) => {
  const body = ProjectSchema.omit({ id: true }).safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: body.error.flatten() });
  }
  if (!hasProfileId(body.data.profileId)) {
    return res.status(400).json({ error: "profileId is required when creating a project." });
  }
  if (!profiles.some((p) => p.id === body.data.profileId)) {
    return res.status(400).json({ error: "profileId does not exist." });
  }
  if (isShowcaseReadOnlyProfileId(body.data.profileId)) {
    return res.status(403).json({ error: SHOWCASE_READONLY_MESSAGE });
  }
  const project: Project = {
    id: allocateNextProjectId(),
    ...body.data,
    profileId: body.data.profileId
  };
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
  if (!hasProfileId(parsed.data.profileId)) {
    return res.status(400).json({ error: "profileId is required when updating a project." });
  }
  if (!profiles.some((p) => p.id === parsed.data.profileId)) {
    return res.status(400).json({ error: "profileId does not exist." });
  }
  const index = projects.findIndex((p) => p.id === id);
  if (index === -1) return res.sendStatus(404);
  if (
    isShowcaseReadOnlyProfileId(projects[index]?.profileId ?? null) ||
    isShowcaseReadOnlyProfileId(parsed.data.profileId)
  ) {
    return res.status(403).json({ error: SHOWCASE_READONLY_MESSAGE });
  }
  projects[index] = { ...parsed.data, profileId: parsed.data.profileId };
  void persistProjects();
  res.json(parsed.data);
});

app.delete("/api/projects/:id", async (req, res) => {
  const id = req.params.id;
  const targetProject = projects.find((p) => p.id === id);
  if (!targetProject) return res.sendStatus(404);
  if (isShowcaseReadOnlyProfileId(targetProject.profileId ?? null)) {
    return res.status(403).json({ error: SHOWCASE_READONLY_MESSAGE });
  }
  const before = projects.length;
  projects = projects.filter((p) => p.id !== id);
  if (projects.length === before) return res.sendStatus(404);
  tasks = tasks.filter((t) => t.projectId !== id);
  await persistProjects();
  await persistTasks();
  await rebuildParentAndChildIdsDeterministic();
  res.sendStatus(204);
});

app.get("/api/profiles", (_req, res) => {
  res.json(profiles.map(toProfilePublic));
});

app.get("/api/profiles/task-counts", (_req, res) => {
  const countsByProfileId: Record<string, number> = {};
  const seenByProfile = new Map<string, Set<string>>();
  for (const task of tasks) {
    const pid = task.profileId ?? null;
    if (!pid) continue;
    let seen = seenByProfile.get(pid);
    if (!seen) {
      seen = new Set<string>();
      seenByProfile.set(pid, seen);
    }
    // Normalize repeating occurrences by series+date so imported duplicates
    // do not inflate profile-level task counts.
    const occurrenceKey = isRepeatingTask(task)
      ? `${seriesKeyForTask(task)}::${task.dueDate ?? ""}::${completionDateIsoLocalForTask(task) ?? ""}`
      : `one::${task.id}`;
    if (seen.has(occurrenceKey)) continue;
    seen.add(occurrenceKey);
    countsByProfileId[pid] = (countsByProfileId[pid] ?? 0) + 1;
  }
  res.json({ countsByProfileId });
});

app.post("/api/profiles", async (req, res) => {
  const body = z
    .object({
      name: z.string(),
      title: z.string(),
      password: z.string().optional(),
      requirePassword: z.boolean().optional()
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const out = await createProfileRecord({
    profiles,
    name: body.data.name,
    title: body.data.title,
    password: body.data.password,
    requirePassword: body.data.requirePassword,
    nowIso: new Date().toISOString(),
    makeId: makeProfileId,
    hashPassword
  });
  if (!out.ok) return res.status(out.status).json({ error: out.error });
  profiles = out.value.profiles;
  await persistProfiles();
  res.status(201).json(out.value.profile);
});

app.put("/api/profiles/:id", async (req, res) => {
  if (isShowcaseReadOnlyProfileId(req.params.id)) {
    return res.status(403).json({ error: SHOWCASE_READONLY_MESSAGE });
  }
  const body = z
    .object({
      name: z.string(),
      title: z.string(),
      requirePassword: z.boolean().optional(),
      currentPassword: z.string().optional(),
      newPassword: z.string().optional(),
      confirmNewPassword: z.string().optional()
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const out = await updateProfileRecord({
    profiles,
    id: req.params.id,
    name: body.data.name,
    title: body.data.title,
    requirePassword: body.data.requirePassword,
    currentPassword: body.data.currentPassword,
    newPassword: body.data.newPassword,
    confirmNewPassword: body.data.confirmNewPassword,
    nowIso: new Date().toISOString(),
    hashPassword,
    verifyPassword
  });
  if (!out.ok) return res.status(out.status).json({ error: out.error });
  profiles = out.value.profiles;
  await persistProfiles();
  res.json(out.value.profile);
});

app.post("/api/profiles/:id/unlock", async (req, res) => {
  const body = z.object({ password: z.string().optional() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const out = await verifyProfileUnlock({
    profiles,
    id: req.params.id,
    password: body.data.password,
    verifyPassword
  });
  if (!out.ok) return res.status(out.status).json({ error: out.error });
  res.json({ ok: true, profile: out.value.profile });
});

app.delete("/api/profiles/:id", async (req, res) => {
  if (isShowcaseReadOnlyProfileId(req.params.id)) {
    return res.status(403).json({ error: SHOWCASE_READONLY_MESSAGE });
  }
  const body = z.object({ password: z.string().optional() }).safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const target = profiles.find((p) => p.id === req.params.id);
  if (!target) return res.sendStatus(404);
  if (target.passwordHash) {
    const verify = await verifyProfileUnlock({
      profiles,
      id: req.params.id,
      password: body.data.password,
      verifyPassword
    });
    if (!verify.ok) return res.status(verify.status).json({ error: verify.error });
  }
  const out = deleteProfileRecord({ profiles, id: req.params.id });
  if (!out.ok) return res.sendStatus(404);
  profiles = out.value.profiles;
  projects = projects.filter((p) => (p.profileId ?? null) !== req.params.id);
  tasks = tasks.filter((t) => (t.profileId ?? null) !== req.params.id);
  await persistProfiles();
  await persistProjects();
  await persistTasks();
  res.sendStatus(204);
});

function dedupeTasksForRead(input: Task[]): Task[] {
  const byKey = new Map<string, Task>();
  for (const task of input) {
    const key = isRepeatingTask(task)
      ? `series::${seriesKeyForTask(task)}::${task.dueDate ?? ""}`
      : `single::${(task.profileId ?? "").trim().toLowerCase()}::${(task.projectId ?? "")
          .trim()
          .toLowerCase()}::${task.title.trim().toLowerCase()}::${task.dueDate ?? ""}::${task.dueTime ?? ""}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, task);
      continue;
    }
    const existingScore =
      (existing.completed ? 4 : 0) +
      (existing.cancelled ? 2 : 0) +
      (existing.completedAt ? 1 : 0);
    const nextScore =
      (task.completed ? 4 : 0) + (task.cancelled ? 2 : 0) + (task.completedAt ? 1 : 0);
    if (nextScore > existingScore) {
      byKey.set(key, task);
      continue;
    }
    if (nextScore === existingScore && task.id.localeCompare(existing.id) > 0) {
      byKey.set(key, task);
    }
  }
  return Array.from(byKey.values());
}

function dedupeProjectsForRead(input: Project[]): Project[] {
  const byKey = new Map<string, Project>();
  for (const project of input) {
    const key = `${(project.profileId ?? "").trim().toLowerCase()}::${project.name
      .trim()
      .toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, project);
      continue;
    }
    // Keep the most recent normalized ID to stabilize references.
    if (project.id.localeCompare(existing.id) > 0) {
      byKey.set(key, project);
    }
  }
  return Array.from(byKey.values());
}

function resolveEffectiveProfileId(profileIdQuery: unknown): string | null {
  const requested =
    typeof profileIdQuery === "string" && profileIdQuery.trim() !== ""
      ? profileIdQuery.trim()
      : null;
  if (requested && profiles.some((p) => p.id === requested)) return requested;
  if (profiles.length === 0) return null;
  if (profiles.length === 1) return profiles[0]!.id;
  const countsByProfile = new Map<string, number>();
  for (const t of tasks) {
    const pid = t.profileId ?? null;
    if (!pid) continue;
    countsByProfile.set(pid, (countsByProfile.get(pid) ?? 0) + 1);
  }
  const mostPopulated = profiles
    .map((p) => ({ id: p.id, count: countsByProfile.get(p.id) ?? 0 }))
    .sort((a, b) => b.count - a.count)[0];
  return mostPopulated?.id ?? profiles[0]!.id;
}

app.get("/api/tasks", (req, res) => {
  const { projectId, since, paginate, limit, offset, jumpToDate } = req.query;
  const effectiveProfileId = resolveEffectiveProfileId(req.query.profileId);

  let filtered = dedupeTasksForRead(tasks);

  if (effectiveProfileId) {
    filtered = filtered.filter((t) => (t.profileId ?? null) === effectiveProfileId);
  }

  if (typeof projectId === "string" && projectId.trim() !== "") {
    filtered = filtered.filter((t) => t.projectId === projectId);
  }

  if (typeof since === "string" && since.trim() !== "") {
    const sinceDate = new Date(`${since}T00:00:00`);
    if (!Number.isNaN(sinceDate.getTime())) {
      const sinceIso = isoDateLocal(sinceDate);
      const inWindow = filtered.filter((t) => {
        // Include tasks whose due date or completion date is on/after `since`.
        const dateIso = completionDateIsoLocalForTask(t) ?? t.dueDate ?? null;
        if (!dateIso) return true;
        return dateIso >= sinceIso;
      });

      // Keep one historical seed row per recurring series when a timeframe-bound fetch
      // would otherwise remove the entire series. The client expands recurring tasks
      // from existing rows; without a seed, valid future virtual occurrences disappear.
      const recurringSeedsBySeries = new Map<string, Task>();
      for (const t of filtered) {
        if (!isRepeatingTask(t) || t.cancelled || !t.dueDate) continue;
        const dateIso = completionDateIsoLocalForTask(t) ?? t.dueDate ?? null;
        if (dateIso && dateIso >= sinceIso) continue;
        const key = seriesKeyForTask(t);
        const existing = recurringSeedsBySeries.get(key);
        if (!existing || (existing.dueDate ?? "") < (t.dueDate ?? "")) {
          recurringSeedsBySeries.set(key, t);
        }
      }

      const mergedById = new Map<string, Task>();
      for (const t of inWindow) mergedById.set(t.id, t);
      for (const t of recurringSeedsBySeries.values()) {
        if (!mergedById.has(t.id)) mergedById.set(t.id, t);
      }
      filtered = Array.from(mergedById.values());
    }
  }

  const shouldPaginate = paginate === "1" || paginate === "true";
  const parsedLimit =
    typeof limit === "string" && Number.isFinite(Number(limit))
      ? Math.max(1, Math.min(5000, Math.trunc(Number(limit))))
      : 500;
  const parsedOffset =
    typeof offset === "string" && Number.isFinite(Number(offset))
      ? Math.max(0, Math.trunc(Number(offset)))
      : 0;

  if (!shouldPaginate) {
    res.json(filtered);
    return;
  }

  const sorted = filtered
    .slice()
    .sort((a, b) => {
      const ad = completionDateIsoLocalForTask(a) ?? a.dueDate ?? "";
      const bd = completionDateIsoLocalForTask(b) ?? b.dueDate ?? "";
      const d = bd.localeCompare(ad);
      if (d !== 0) return d;
      const at = a.dueTime ?? "";
      const bt = b.dueTime ?? "";
      const t = bt.localeCompare(at);
      if (t !== 0) return t;
      return b.id.localeCompare(a.id);
    });
  const total = sorted.length;
  let effectiveOffset = parsedOffset;
  if (typeof jumpToDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(jumpToDate)) {
    const idx = sorted.findIndex((t) => {
      const dateIso = completionDateIsoLocalForTask(t) ?? t.dueDate ?? "";
      // Start paging near the first task on/before the target date.
      return dateIso !== "" && dateIso <= jumpToDate;
    });
    if (idx >= 0) effectiveOffset = idx;
  }
  const items = sorted.slice(effectiveOffset, effectiveOffset + parsedLimit);
  const nextOffset = effectiveOffset + items.length;
  const hasMore = nextOffset < total;
  res.json({
    items,
    total,
    offset: effectiveOffset,
    limit: parsedLimit,
    hasMore,
    nextOffset: hasMore ? nextOffset : null
  });
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
    profileId: hasProjectId(parsed.data.projectId)
      ? profileIdForProjectId(parsed.data.projectId)
      : (parsed.data.profileId ?? null),
    labels: sortLabelsAsc(parsed.data.labels),
    link: parsed.data.link ? sortLinksAsc(parsed.data.link) : parsed.data.link
  };
  if (isShowcaseReadOnlyProfileId(sortedParsedData.profileId ?? null)) {
    return res.status(403).json({ error: SHOWCASE_READONLY_MESSAGE });
  }
  const seriesKey = seriesKeyForFields({
    profileId: sortedParsedData.profileId ?? null,
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
    id: makeTaskId(),
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
      profileId: task.profileId ?? null,
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
  if (task.parentId) {
    syncProjectIdForParent(task.parentId);
    await persistTasks();
  }
  const saved = tasks.find((t) => t.id === task.id) ?? task;
  res.status(201).json(saved);
});

function applyTaskUpdateInMemory(
  id: string,
  payload: unknown
):
  | {
      ok: true;
      updatedId: string;
      projectChanged: boolean;
    }
  | {
      ok: false;
      status: number;
      error?: unknown;
    } {
  const parsed = TaskSchema.safeParse({ ...(payload as Record<string, unknown>), id });
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.flatten() };
  }
  const sortedParsedData = {
    ...parsed.data,
    profileId: hasProjectId(parsed.data.projectId)
      ? profileIdForProjectId(parsed.data.projectId)
      : (parsed.data.profileId ?? null),
    labels: sortLabelsAsc(parsed.data.labels),
    link: parsed.data.link ? sortLinksAsc(parsed.data.link) : parsed.data.link
  };
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return { ok: false, status: 404 };
  const existing = tasks[index];
  if (isShowcaseReadOnlyProfileId(existing.profileId ?? null)) {
    return { ok: false, status: 403, error: SHOWCASE_READONLY_MESSAGE };
  }
  const repeating = !!sortedParsedData.repeat && sortedParsedData.repeat !== "none";
  const parentIdBefore = repeating ? existing.parentId ?? null : null;
  const seriesKey = seriesKeyForFields({
    profileId: sortedParsedData.profileId ?? null,
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
      ? (resolvedParentId === existing.parentId && existing.childId
          ? existing.childId
          : allocateNextChildId(resolvedParentId, seriesKey))
      : sortedParsedData.childId ?? existing.childId;

  const next: Task = {
    ...sortedParsedData,
    parentId: resolvedParentId,
    childId: resolvedChildId
  };
  if (isShowcaseReadOnlyProfileId(next.profileId ?? null)) {
    return { ok: false, status: 403, error: SHOWCASE_READONLY_MESSAGE };
  }
  if (next.completed) {
    next.completedAt = next.completedAt ?? existing.completedAt ?? new Date().toISOString();
  } else {
    next.completedAt = undefined;
  }
  if (next.durationMinutes === undefined) {
    next.durationMinutes = existing.durationMinutes;
  }
  tasks[index] = next;

  if (repeating && parentIdBefore) {
    const seriesMetadata: Partial<Task> = {
      title: next.title,
      description: next.description,
      priority: next.priority,
      projectId: next.projectId,
      profileId: next.profileId ?? null,
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
      if (t.parentId !== parentIdBefore) return t;
      return { ...t, ...seriesMetadata };
    });
  }

  if (tasks[index].parentId && tasks[index].durationMinutes !== undefined) {
    syncDurationMinutesForParent(tasks[index].parentId!, tasks[index].durationMinutes!);
  }
  const projectChanged = (existing.projectId ?? null) !== (next.projectId ?? null);
  return { ok: true, updatedId: id, projectChanged };
}

app.put("/api/tasks/:id", async (req, res) => {
  const id = req.params.id;
  const out = applyTaskUpdateInMemory(id, req.body);
  if (!out.ok) {
    if (out.status === 404) return res.sendStatus(404);
    return res.status(out.status).json({ error: out.error ?? "Update failed" });
  }
  await persistTasks();
  // Ensure parentId/childId determinism even when dueDate changes series prefix.
  await rebuildParentAndChildIdsDeterministic();

  const updatedAfterRebuild = tasks.find((t) => t.id === id);
  if (!updatedAfterRebuild) return res.sendStatus(404);
  const parentIdAfter = updatedAfterRebuild?.parentId ?? null;

  // Ensure project association stays consistent across the entire parent group.
  // If the edited occurrence changed project, treat that as an explicit "move series" action.
  const projectChanged = out.projectChanged;
  if (parentIdAfter) {
    if (projectChanged) {
      forceProjectIdForParent(parentIdAfter, updatedAfterRebuild.projectId ?? null);
    } else {
      syncProjectIdForParent(parentIdAfter);
    }
    await persistTasks();
  }
  const updated = tasks.find((t) => t.id === id) ?? updatedAfterRebuild;
  res.json(updated);
});

app.post("/api/tasks/batch-update", async (req, res) => {
  const body = z
    .object({
      updates: z.array(
        z.object({
          id: z.string().min(1),
          task: z.record(z.any())
        })
      )
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  if (body.data.updates.length === 0) {
    return res.json({ updated: [], failed: [] });
  }

  const updatedIds: string[] = [];
  const projectChangedById = new Map<string, boolean>();
  const failed: Array<{ id: string; status: number; error?: unknown }> = [];

  for (const entry of body.data.updates) {
    const out = applyTaskUpdateInMemory(entry.id, entry.task);
    if (!out.ok) {
      failed.push({ id: entry.id, status: out.status, error: out.error });
      continue;
    }
    updatedIds.push(out.updatedId);
    projectChangedById.set(out.updatedId, out.projectChanged);
  }

  if (updatedIds.length > 0) {
    await persistTasks();
    await rebuildParentAndChildIdsDeterministic();

    const parentAction = new Map<string, "force" | "sync">();
    for (const id of updatedIds) {
      const row = tasks.find((t) => t.id === id);
      if (!row?.parentId) continue;
      const mode = projectChangedById.get(id) ? "force" : "sync";
      const prev = parentAction.get(row.parentId);
      if (!prev || mode === "force") parentAction.set(row.parentId, mode);
    }
    for (const [parentId, mode] of parentAction.entries()) {
      const row = tasks.find((t) => t.parentId === parentId);
      if (!row) continue;
      if (mode === "force") forceProjectIdForParent(parentId, row.projectId ?? null);
      else syncProjectIdForParent(parentId);
    }
    if (parentAction.size > 0) {
      await persistTasks();
    }
  }

  const updated = updatedIds
    .map((id) => tasks.find((t) => t.id === id))
    .filter((t): t is Task => !!t);
  res.json({ updated, failed });
});

app.post("/api/tasks/batch-delete", async (req, res) => {
  const body = z
    .object({
      ids: z.array(z.string().min(1))
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const normalizedIds = body.data.ids.map((id) => (id.includes("::") ? id.split("::")[0] : id));
  const existing = new Set(tasks.map((t) => t.id));
  const deleteSet = new Set(normalizedIds.filter((id) => existing.has(id)));
  for (const taskId of deleteSet) {
    const row = tasks.find((t) => t.id === taskId);
    if (row && isShowcaseReadOnlyProfileId(row.profileId ?? null)) {
      return res.status(403).json({ error: SHOWCASE_READONLY_MESSAGE });
    }
  }
  const missingIds = normalizedIds.filter((id) => !existing.has(id));

  if (deleteSet.size > 0) {
    tasks = tasks.filter((t) => !deleteSet.has(t.id));
    await persistTasks();
    await rebuildParentAndChildIdsDeterministic();
  }

  res.json({ deletedIds: Array.from(deleteSet), missingIds });
});

app.patch("/api/tasks/:id/complete", (req, res) => {
  const id = req.params.id;
  const baseId = id.includes("::") ? id.split("::")[0] : id;
  const task = tasks.find((t) => t.id === id) ?? tasks.find((t) => t.id === baseId);
  if (!task) {
    // Return 200 with a marker instead of 404 to avoid noisy "Failed to load resource"
    // when the UI holds a stale/mutated id; client will reconcile with a refresh.
    return res.json({ id, missing: true });
  }
  if (isShowcaseReadOnlyProfileId(task.profileId ?? null)) {
    return res.status(403).json({ error: SHOWCASE_READONLY_MESSAGE });
  }
  task.completed = !task.completed;
  task.completedAt = task.completed ? new Date().toISOString() : undefined;
  void persistTasks();
  res.json(task);
});

app.delete("/api/tasks/:id", async (req, res) => {
  const id = req.params.id;
  const targetTask = tasks.find((t) => t.id === id);
  if (!targetTask) return res.sendStatus(404);
  if (isShowcaseReadOnlyProfileId(targetTask.profileId ?? null)) {
    return res.status(403).json({ error: SHOWCASE_READONLY_MESSAGE });
  }
  const before = tasks.length;
  tasks = tasks.filter((t) => t.id !== id);
  if (tasks.length === before) return res.sendStatus(404);
  await persistTasks();
  // Recompute series prefixes after deletion (earliest date may change).
  await rebuildParentAndChildIdsDeterministic();
  res.sendStatus(204);
});

function scopedDataForProfile(profileIdQuery: unknown): {
  scopedProfileId: string | null;
  scopedTasks: Task[];
  scopedProjects: Project[];
} {
  const scopedProfileId = resolveEffectiveProfileId(profileIdQuery);
  if (!scopedProfileId) {
    return {
      scopedProfileId: null,
      scopedTasks: dedupeTasksForRead(tasks),
      scopedProjects: dedupeProjectsForRead(projects)
    };
  }
  return {
    scopedProfileId,
    scopedTasks: dedupeTasksForRead(
      tasks.filter((t) => (t.profileId ?? null) === scopedProfileId)
    ),
    scopedProjects: dedupeProjectsForRead(
      projects.filter((p) => (p.profileId ?? null) === scopedProfileId)
    )
  };
}

app.get("/api/stats", (req, res) => {
  // Ensure the Progress UI always gets fresh data (avoid intermediary caching).
  res.setHeader("Cache-Control", "no-store");
  const { scopedProfileId, scopedTasks, scopedProjects } = scopedDataForProfile(req.query.profileId);
  const scopedCacheKey = scopedProfileId ?? "__all__";
  const cached = statsCache.get(scopedCacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  // Use local calendar dates so "today/streak/last7" match the UI date inputs
  // and update correctly in real time for the user's timezone.
  const toIsoLocal = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const addDaysLocal = (d: Date, days: number) => {
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

  const safeTasks = scopedTasks.filter((t) => !t.cancelled);
  // Lifetime completed tasks: used for totals (XP, level, milestones, points by priority).
  const completedAllTasks = safeTasks.filter((t) => t.completed);
  // Day-addressable completed tasks: used for daily/weekly timeline widgets.
  const completedTasksWithDate = completedAllTasks
    .filter((t) => t.completed)
    .map((t) => ({ task: t, completionDateIso: completionDateIsoLocalForTask(t) }))
    .filter(
      (
        row
      ): row is {
        task: Task;
        completionDateIso: string;
      } => !!row.completionDateIso
    );

  const completedToday = completedTasksWithDate.filter((t) => t.completionDateIso === todayIso);
  const allCompleted = completedAllTasks;

  const completionsByDay = new Map<string, number>();
  for (const t of completedTasksWithDate) {
    completionsByDay.set(
      t.completionDateIso,
      (completionsByDay.get(t.completionDateIso) ?? 0) + 1
    );
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
    (sum, t) => sum + scoreFor(t.task),
    0
  );
  const totalPoints = allCompleted.reduce(
    (sum, t) => sum + scoreFor(t),
    0
  );

  const level = 1 + Math.floor(totalPoints / 50);
  const pointsIntoLevel = totalPoints % 50;
  const xpToNext = pointsIntoLevel === 0 ? 50 : 50 - pointsIntoLevel;

  // Index completed tasks by their progress day (due date when set, else completion timestamp).
  const completedTasksByDay = (() => {
    const map = new Map<string, Task[]>();
    for (const row of completedTasksWithDate) {
      const iso = row.completionDateIso;
      const arr = map.get(iso) ?? [];
      arr.push(row.task);
      map.set(iso, arr);
    }
    // Stable ordering for "evidence": earlier dueTime first, then title.
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => {
        const at = a.dueTime ?? "";
        const bt = b.dueTime ?? "";
        if (at !== bt) return at.localeCompare(bt);
        return String(a.title ?? "").localeCompare(String(b.title ?? ""));
      });
      map.set(k, arr);
    }
    return map;
  })();

  type MilestoneUnlockEvidence = {
    dateIso: string;
    task?: {
      id: string;
      title: string;
      dueDate?: string;
      dueTime?: string;
      projectId?: string | null;
      projectName?: string;
      priority?: string;
    };
  };

  const taskEvidence = (dateIso: string): MilestoneUnlockEvidence["task"] => {
    const t = completedTasksByDay.get(dateIso)?.[0];
    if (!t) return undefined;
    const projectName =
      t.projectId != null ? scopedProjects.find((p) => p.id === t.projectId)?.name : undefined;
    return {
      id: t.id,
      title: t.title,
      dueDate: t.dueDate,
      dueTime: t.dueTime,
      projectId: t.projectId ?? null,
      projectName,
      priority: t.priority
    };
  };

  const streakDays = (() => {
    // Consecutive days ending today where the user completed >=1 task on that day.
    const completionDates = Array.from(completionsByDay.keys()).sort();
    if (completionDates.length === 0) return 0;

    const todayCount = completionsByDay.get(todayIso) ?? 0;
    // Streak must end on today by product definition.
    if (todayCount <= 0) return 0;

    const earliestCompletionIso = completionDates[0];
    let streak = 0;
    let cursor = new Date(`${todayIso}T12:00:00`);
    const earliest = new Date(`${earliestCompletionIso}T12:00:00`);

    while (cursor.getTime() >= earliest.getTime()) {
      const dayIso = toIsoLocal(cursor);
      const count = completionsByDay.get(dayIso) ?? 0;
      if (count <= 0) break;
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    return streak;
  })();

  const last7Days = (() => {
    // oldest -> newest
    const days: { date: string; completed: number; points: number }[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const iso = toIsoLocal(addDaysLocal(now, -i));
      const completed = completionsByDay.get(iso) ?? 0;
      const points = completedTasksWithDate
        .filter((t) => t.completionDateIso === iso)
        .reduce((sum, t) => sum + scoreFor(t.task), 0);
      days.push({ date: iso, completed, points });
    }
    return days;
  })();

  const pointsByPriority = (() => {
    const out = { low: 0, medium: 0, high: 0, urgent: 0 };
    for (const t of allCompleted) {
      out[t.priority] += scoreFor(t);
    }
    return out;
  })();

  const achievements = (() => {
    // Productive Day: complete 3 tasks due before 21:00 today
    const isBefore2100 = (time: string | undefined): boolean => {
      // All-day / no specific time counts toward “before 21:00” productivity.
      if (time == null || String(time).trim() === "") return true;
      const m = time.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return false;
      const hh = Number(m[1]);
      return hh < 21;
    };

    const earlyCount = completedToday.filter((t) => isBefore2100(t.task.dueTime)).length;
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

    // Shared per-day qualification logic (single source of truth):
    // A day qualifies if it achieves BOTH:
    // - Productive Day: >=3 tasks scheduled before 21:00 (or all-day)
    // - Daily Grinding: >=5 XP (priority points)
    const dayPoints = new Map<string, number>();
    const dayProductiveCount = new Map<string, number>();
    for (const row of completedTasksWithDate) {
      const iso = row.completionDateIso;
      dayPoints.set(iso, (dayPoints.get(iso) ?? 0) + scoreFor(row.task));
      if (isBefore2100(row.task.dueTime)) {
        dayProductiveCount.set(iso, (dayProductiveCount.get(iso) ?? 0) + 1);
      }
    }
    const dayQualifies = (iso: string): boolean => {
      const prod = dayProductiveCount.get(iso) ?? 0;
      const pts = dayPoints.get(iso) ?? 0;
      return prod >= 3 && pts >= dailyXpTarget;
    };

    const weeklyProgress = (() => {
      // Number of days in the last 7 days where BOTH:
      // - "Productive Day" is achieved (>=3 tasks before 21:00)
      // - "Daily Grinding" is achieved (>=5 XP gained that day)
      let count = 0;
      for (const day of last7Days) {
        const dayIso = day.date;
        if (dayQualifies(dayIso)) count += 1;
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

    // Monthly Grinding: within this calendar month, complete 4 full weeks where
    // every day in the week meets the "Consistency Builder day" definition.
    const monthlyGrinding = (() => {
      const dailyQualifies = new Map<string, boolean>();
      for (const iso of new Set<string>([
        ...Array.from(dayPoints.keys()),
        ...Array.from(dayProductiveCount.keys())
      ])) {
        dailyQualifies.set(iso, dayQualifies(iso));
      }

      const result = computeMonthlyGrinding(now, dailyQualifies);
      const progress = Math.min(4, result.weeksCompleted);
      return {
        id: "monthly_grinding",
        name: "Monthly Grinding",
        description:
          "In a single month, complete 4 full weeks where every day achieves both “Productive Day” and “Daily Grinding”.",
        progress,
        goal: 4,
        achieved: result.weeksCompleted >= 4,
        meta: { month: result.monthKey, weeksCompleted: result.weeksCompleted, weekStarts: result.evidenceWeekStarts }
      };
    })();

    // Yearly Grinding: within the calendar year (Jan..Dec), hit Monthly Grinding in every month.
    const yearlyGrinding = (() => {
      const dailyQualifies = new Map<string, boolean>();
      for (const iso of new Set<string>([
        ...Array.from(dayPoints.keys()),
        ...Array.from(dayProductiveCount.keys())
      ])) {
        dailyQualifies.set(iso, dayQualifies(iso));
      }

      const year = now.getFullYear();
      const result = computeYearlyGrinding(year, dailyQualifies);
      const progress = Math.min(12, result.monthsCompleted);
      return {
        id: "yearly_grinding",
        name: "Yearly Grinding",
        description:
          "In a single year (January to December), hit “Monthly Grinding” in every month.",
        progress,
        goal: 12,
        achieved: result.monthsCompleted >= 12,
        meta: {
          year: result.year,
          monthsCompleted: result.monthsCompleted,
          months: result.evidenceMonths.map((m) => m.month)
        }
      };
    })();

    // Daily XP: gain at least 5 experience points today.
    const dailyXp = {
      id: "daily_grinding",
      name: "Daily Grinding",
      description: "Grind at least 5 experience points today.",
      progress: Math.min(dailyXpTarget, pointsToday),
      goal: dailyXpTarget,
      achieved: pointsToday >= dailyXpTarget
    };

    return [earlyStarter, dailyXp, consistency, monthlyGrinding, yearlyGrinding];
  })();

  const milestoneAchievements = (() => {
    const completedCount = allCompleted.length;
    const xpGained = totalPoints;
    const levelValue = level;
    const levelProgressValue = level + pointsIntoLevel / 50;

    // Day streak milestones:
    // - early habit formation: 1/3/5/7 days
    // - monthly cadence: every ~30 days
    // - annual recognition: every 365 days (1y, 2y, 3y, ...)
    const streakBase = (() => {
      const base: number[] = [1, 3, 5, 7, 30, 60, 90, 180, 365];
      // Annual streaks (1y..50y)
      for (let y = 1; y <= 50; y += 1) base.push(365 * y);
      return base;
    })();
    const countBase = [1, 5, 10, 25, 100, 150, 250, 500, 750, 1000];
    const levelBase = [1, 2, 3, 4, 5, 10];

    const streak = buildMilestones({
      base: streakBase,
      current: streakDays,
      // Continue adding monthly targets beyond 1 year.
      extendFrom: 365,
      extendStep: 30,
      minCount: 150,
      maxCount: 150
    });
    const streakMilestonesFiltered = (() => {
      // Avoid redundant "almost annual" streak badges (e.g. 725 next to 730).
      // Keep annual milestones (365*n) and drop non-annual milestones that fall too close.
      const annualSet = new Set<number>();
      for (let y = 1; y <= 200; y += 1) annualSet.add(365 * y);
      const NEAR_DAYS = 20;
      const isAnnual = (n: number) => annualSet.has(n);
      const nearestAnnualDelta = (n: number) => {
        const y = Math.max(1, Math.round(n / 365));
        const candidates = [365 * (y - 1), 365 * y, 365 * (y + 1)].filter((v) => v > 0);
        let best = Number.POSITIVE_INFINITY;
        for (const a of candidates) best = Math.min(best, Math.abs(a - n));
        return best;
      };
      return (streak.milestones ?? []).filter((m) => isAnnual(m) || nearestAnnualDelta(m) > NEAR_DAYS);
    })();
    const streakAchievedFiltered = streakMilestonesFiltered.filter((m) => m <= streakDays);
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
    const levelsPrev = levelsUp.achieved.length
      ? levelsUp.achieved[levelsUp.achieved.length - 1]
      : 0;
    const levelsProgressToNext =
      levelsUp.next === null
        ? 1
        : Math.max(
            0,
            Math.min(
              1,
              (levelProgressValue - levelsPrev) /
                Math.max(1, levelsUp.next - levelsPrev)
            )
          );

    const compact = (arr: number[], tail = 6) =>
      arr.length <= tail ? arr : arr.slice(-tail);

    const unlocksForTasksCompleted = (() => {
      const achieved = (tasksCompleted.achieved ?? []).slice().sort((a, b) => a - b);
      const out: Record<string, MilestoneUnlockEvidence> = {};
      if (achieved.length === 0) return out;

      const rows = completedTasksWithDate
        .slice()
        .sort((a, b) => a.completionDateIso.localeCompare(b.completionDateIso));
      let count = 0;
      let i = 0;
      for (const row of rows) {
        count += 1;
        while (i < achieved.length && count >= achieved[i]!) {
          const m = achieved[i]!;
          out[String(m)] = { dateIso: row.completionDateIso, task: taskEvidence(row.completionDateIso) };
          i += 1;
        }
        if (i >= achieved.length) break;
      }
      return out;
    })();

    const unlocksForXp = (() => {
      const achieved = (xp.achieved ?? []).slice().sort((a, b) => a - b);
      const out: Record<string, MilestoneUnlockEvidence> = {};
      if (achieved.length === 0) return out;

      const rows = completedTasksWithDate
        .slice()
        .sort((a, b) => a.completionDateIso.localeCompare(b.completionDateIso));
      let sum = 0;
      let i = 0;
      for (const row of rows) {
        sum += scoreFor(row.task);
        while (i < achieved.length && sum >= achieved[i]!) {
          const m = achieved[i]!;
          out[String(m)] = { dateIso: row.completionDateIso, task: taskEvidence(row.completionDateIso) };
          i += 1;
        }
        if (i >= achieved.length) break;
      }
      return out;
    })();

    const unlocksForLevels = (() => {
      const achieved = (levelsUp.achieved ?? []).slice().sort((a, b) => a - b);
      const out: Record<string, MilestoneUnlockEvidence> = {};
      if (achieved.length === 0) return out;

      const rows = completedTasksWithDate
        .slice()
        .sort((a, b) => a.completionDateIso.localeCompare(b.completionDateIso));
      let sum = 0;
      let levelNow = 1;
      let i = 0;
      for (const row of rows) {
        sum += scoreFor(row.task);
        levelNow = 1 + Math.floor(sum / 50);
        while (i < achieved.length && levelNow >= achieved[i]!) {
          const m = achieved[i]!;
          out[String(m)] = { dateIso: row.completionDateIso, task: taskEvidence(row.completionDateIso) };
          i += 1;
        }
        if (i >= achieved.length) break;
      }
      return out;
    })();

    const unlocksForStreak = (() => {
      // Streak badges are based on the current streak ending today, so the unlock day is deterministic:
      // the day where the streak length first reached N.
      const achieved = (streak.achieved ?? []).slice().sort((a, b) => a - b);
      const out: Record<string, MilestoneUnlockEvidence> = {};
      if (achieved.length === 0 || streakDays <= 0) return out;

      const start = new Date(`${todayIso}T12:00:00`);
      start.setDate(start.getDate() - (streakDays - 1));
      for (const m of achieved) {
        if (m <= 0 || m > streakDays) continue;
        const d = new Date(start.getTime());
        d.setDate(d.getDate() + (m - 1));
        const iso = toIsoLocal(d);
        out[String(m)] = { dateIso: iso, task: taskEvidence(iso) };
      }
      return out;
    })();

    // "Badges earned" should match what the Badges modal displays (downsampled/capped tiers),
    // not the raw achieved milestone counts.
    const countUnlockedFromCapped = (milestones: number[], current: number) => {
      const capped = capMilestoneBadges(milestones, 150);
      return capped.reduce((acc, m) => acc + (current >= m ? 1 : 0), 0);
    };

    const baseBadgesUnlockedCount =
      countUnlockedFromCapped(streakMilestonesFiltered, streakDays) +
      countUnlockedFromCapped(tasksCompleted.milestones ?? [], completedCount) +
      countUnlockedFromCapped(xp.milestones ?? [], xpGained) +
      countUnlockedFromCapped(levelsUp.milestones ?? [], levelValue);

    // Total "badges earned" should align with the Badges modal total tiles:
    // - 4 milestone families * 150 tiers = 600
    // - plus the Badges-earned ladder itself (every 5 badges, up to 750) = 150 more tiles
    // The ladder unlock count is derived from the base unlocked count (meta progression).
    const badgesEarnedLadderUnlockedCount = Math.min(150, Math.floor(baseBadgesUnlockedCount / 5));
    const totalBadgesEarnedCount = baseBadgesUnlockedCount + badgesEarnedLadderUnlockedCount;

    const badgesEarned = buildBadgesEarnedMilestoneBlock(totalBadgesEarnedCount);

    const unlocksForBadgesEarned = (() => {
      type UnlockMeta = MilestoneUnlockEvidence & { source?: string };
      type UnlockEvent = {
        dateIso: string;
        task?: UnlockMeta["task"];
        source: string;
      };

      const events: UnlockEvent[] = [];
      const pushEvent = (source: string, meta: MilestoneUnlockEvidence | undefined) => {
        if (!meta?.dateIso) return;
        events.push({ dateIso: meta.dateIso, task: meta.task, source });
      };

      // Build chronological "base badge unlock" events from the four families.
      for (const m of streakAchievedFiltered) {
        pushEvent(`Streak days: ${m} days`, unlocksForStreak[String(m)]);
      }
      for (const m of tasksCompleted.achieved ?? []) {
        pushEvent(`Tasks completed: ${m} tasks`, unlocksForTasksCompleted[String(m)]);
      }
      for (const m of xp.achieved ?? []) {
        pushEvent(`XP gained: ${m} XP`, unlocksForXp[String(m)]);
      }
      for (const m of levelsUp.achieved ?? []) {
        pushEvent(`Levels up: Level ${m}`, unlocksForLevels[String(m)]);
      }

      // Sort by date (stable tie-breaker by source string).
      events.sort((a, b) => (a.dateIso !== b.dateIso ? a.dateIso.localeCompare(b.dateIso) : a.source.localeCompare(b.source)));

      const thresholds = badgesEarned.milestones.slice().sort((a, b) => a - b);
      const out: Record<string, UnlockMeta> = {};
      let baseUnlocked = 0;
      let ladderUnlocked = 0;
      let cursor = 0;

      const maybeFill = (ev: UnlockEvent) => {
        const total = baseUnlocked + ladderUnlocked;
        while (cursor < thresholds.length && total >= thresholds[cursor]!) {
          const t = thresholds[cursor]!;
          out[String(t)] = { dateIso: ev.dateIso, task: ev.task, source: ev.source };
          cursor += 1;
        }
      };

      // Each base event unlocks exactly 1 badge in base families.
      for (const ev of events) {
        baseUnlocked += 1;
        const nextLadder = Math.min(150, Math.floor(baseUnlocked / 5));
        if (nextLadder > ladderUnlocked) {
          ladderUnlocked = nextLadder;
        }
        maybeFill(ev);
        if (cursor >= thresholds.length) break;
      }

      return out;
    })();

    return {
      badgesEarned: {
        ...badgesEarned,
        unlockDetails: unlocksForBadgesEarned
      },
      streakDays: {
        id: "streak_days",
        name: "Day streaks",
        unit: "days",
        current: streakDays,
        next: streak.next,
        progressToNext: streak.progressToNext,
        achievedCount: streak.achievedCount,
        recentUnlocked: compact(streak.achieved),
        milestones: streakMilestonesFiltered,
        achieved: streakAchievedFiltered,
        unlockDetails: unlocksForStreak
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
        achieved: tasksCompleted.achieved,
        unlockDetails: unlocksForTasksCompleted
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
        achieved: xp.achieved,
        unlockDetails: unlocksForXp
      },
      levelsUp: {
        id: "levels_up",
        name: "Levels up",
        unit: "levels",
        current: levelValue,
        next: levelsUp.next,
        progressToNext: levelsProgressToNext,
        achievedCount: levelsUp.achievedCount,
        recentUnlocked: compact(levelsUp.achieved),
        milestones: levelsUp.milestones,
        achieved: levelsUp.achieved,
        unlockDetails: unlocksForLevels
      }
    };
  })();

  const payload = {
    profileId: scopedProfileId,
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
  };

  statsCache.set(scopedCacheKey, payload);
  res.json(payload);
});

app.get("/api/productivity-insights", (req, res) => {
  // Ensure Productivity Analysis always reflects the latest completed-task data
  // (avoid intermediary caching of this derived endpoint).
  res.setHeader("Cache-Control", "no-store");
  const { scopedProfileId, scopedTasks, scopedProjects } = scopedDataForProfile(req.query.profileId);
  const scopedCacheKey = scopedProfileId ?? "__all__";
  const cached = productivityCache.get(scopedCacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  const toIsoLocal = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const addDaysLocal = (d: Date, days: number) => {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + days);
    return x;
  };

  const safeTasks = scopedTasks.filter((t) => !t.cancelled && t.completed);
  const completedTasksWithDate = safeTasks
    .map((t) => ({ task: t, completionDateIso: completionDateIsoLocalForTask(t) }))
    .filter(
      (
        row
      ): row is {
        task: Task;
        completionDateIso: string;
      } => !!row.completionDateIso
    );

  if (completedTasksWithDate.length === 0) {
    res.json({ rows: [] });
    return;
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

  const completionsByDay = new Map<string, { completed: number; points: number }>();
  const completionsByDayProject = new Map<
    string,
    Map<string, { completed: number; points: number }>
  >();
  const UNASSIGNED_PROJECT_ID = "__unassigned__";
  for (const row of completedTasksWithDate) {
    const prev = completionsByDay.get(row.completionDateIso) ?? { completed: 0, points: 0 };
    completionsByDay.set(row.completionDateIso, {
      completed: prev.completed + 1,
      points: prev.points + scoreFor(row.task)
    });

    // Per-project breakdown:
    // - If a task has a projectId, count it there
    // - Otherwise, count it under an explicit "Unassigned" bucket so exports/pivots match charts.
    const perDay =
      completionsByDayProject.get(row.completionDateIso) ??
      new Map<string, { completed: number; points: number }>();
    const pidRaw = typeof row.task.projectId === "string" ? row.task.projectId.trim() : "";
    const pid = pidRaw ? pidRaw : UNASSIGNED_PROJECT_ID;
    const prevP = perDay.get(pid) ?? { completed: 0, points: 0 };
    perDay.set(pid, { completed: prevP.completed + 1, points: prevP.points + scoreFor(row.task) });
    completionsByDayProject.set(row.completionDateIso, perDay);
  }

  const allDates = Array.from(completionsByDay.keys()).sort();
  const firstDateIso = allDates[0];
  const lastDateIso = allDates[allDates.length - 1];
  const firstDate = new Date(`${firstDateIso}T12:00:00`);
  const lastDate = new Date(`${lastDateIso}T12:00:00`);

  // Precompute milestone thresholds so we can approximate "badges earned" over time
  // using the same progression model as the main stats endpoint.
  // Mirror the /api/stats streak milestone ladder so badge simulation stays consistent:
  // monthly (~30 days) plus explicit annual targets (365*n).
  const streakBase = (() => {
    const base: number[] = [1, 3, 5, 7, 30, 60, 90, 180, 365];
    for (let y = 1; y <= 50; y += 1) base.push(365 * y);
    return base;
  })();
  const countBase = [1, 5, 10, 25, 100, 150, 250, 500, 750, 1000];
  const levelBase = [1, 2, 3, 4, 5, 10];

  const uniqSorted = (arr: number[]) =>
    Array.from(new Set(arr)).sort((a, b) => a - b);

  const buildMilestones = (opts: {
    base: number[];
    current: number;
    extendFrom: number;
    extendStep: number;
    minCount?: number;
    maxCount?: number;
  }) => {
    const { base, current, extendFrom, extendStep, minCount = 20, maxCount } = opts;
    const out: number[] = [...base];
    const maxBase = base.length ? Math.max(...base) : extendFrom;
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
    return milestones;
  };

  const lifetimeCompletedCount = completedTasksWithDate.length;
  const lifetimeTotalPoints = completedTasksWithDate.reduce(
    (sum, row) => sum + scoreFor(row.task),
    0
  );
  const lifetimeLevel = 1 + Math.floor(lifetimeTotalPoints / 50);

  const streakMilestonesRaw = buildMilestones({
    base: streakBase,
    current: allDates.length,
    extendFrom: 365,
    extendStep: 30,
    minCount: 150,
    maxCount: 150
  });
  const streakMilestones = (() => {
    const annualSet = new Set<number>();
    for (let y = 1; y <= 200; y += 1) annualSet.add(365 * y);
    const NEAR_DAYS = 20;
    const isAnnual = (n: number) => annualSet.has(n);
    const nearestAnnualDelta = (n: number) => {
      const y = Math.max(1, Math.round(n / 365));
      const candidates = [365 * (y - 1), 365 * y, 365 * (y + 1)].filter((v) => v > 0);
      let best = Number.POSITIVE_INFINITY;
      for (const a of candidates) best = Math.min(best, Math.abs(a - n));
      return best;
    };
    return streakMilestonesRaw.filter((m) => isAnnual(m) || nearestAnnualDelta(m) > NEAR_DAYS);
  })();
  const tasksMilestones = buildMilestones({
    base: countBase,
    current: lifetimeCompletedCount,
    extendFrom: 1000,
    extendStep: 250,
    minCount: 150,
    maxCount: 150
  });
  const xpMilestones = buildMilestones({
    base: countBase,
    current: lifetimeTotalPoints,
    extendFrom: 1000,
    extendStep: 500,
    minCount: 150,
    maxCount: 150
  });
  const levelMilestones = buildMilestones({
    base: levelBase,
    current: lifetimeLevel,
    extendFrom: 10,
    extendStep: 5,
    minCount: 150,
    maxCount: 150
  });

  const unlockedStreak = new Set<number>();
  const unlockedTasks = new Set<number>();
  const unlockedXp = new Set<number>();
  const unlockedLevels = new Set<number>();

  const rows: {
    date: string;
    tasksCompleted: number;
    tasksCompletedCumulative: number;
    xpGained: number;
    xpGainedCumulative: number;
    level: number;
    badgesEarnedCumulative: number;
  }[] = [];

  const projectsById = new Map<string, string>();
  for (const p of scopedProjects) projectsById.set(p.id, p.name);
  const projectIdsSeen = new Set<string>();
  for (const dayMap of completionsByDayProject.values()) {
    for (const pid of dayMap.keys()) projectIdsSeen.add(pid);
  }
  const projectBreakdown = {
    projects: Array.from(projectIdsSeen)
      .sort((a, b) => (projectsById.get(a) ?? a).localeCompare(projectsById.get(b) ?? b))
      .map((id) => ({
        id,
        name:
          id === UNASSIGNED_PROJECT_ID
            ? "Unassigned"
            : projectsById.get(id) ?? "Unknown project"
      })),
    rows: [] as {
      date: string;
      tasksCompletedByProject: Record<string, number>;
      xpGainedByProject: Record<string, number>;
    }[]
  };

  let cursor = new Date(firstDate.getTime());
  let cumulativeTasks = 0;
  let cumulativeXp = 0;
  let currentStreak = 0;

  while (cursor.getTime() <= lastDate.getTime()) {
    const iso = toIsoLocal(cursor);
    const day = completionsByDay.get(iso) ?? { completed: 0, points: 0 };
    const perProject = completionsByDayProject.get(iso) ?? new Map<string, { completed: number; points: number }>();

    if (day.completed > 0) {
      currentStreak += 1;
    } else {
      currentStreak = 0;
    }

    cumulativeTasks += day.completed;
    cumulativeXp += day.points;
    const levelValue = 1 + Math.floor(cumulativeXp / 50);

    for (const m of streakMilestones) {
      if (currentStreak >= m && !unlockedStreak.has(m)) {
        unlockedStreak.add(m);
      }
    }
    for (const m of tasksMilestones) {
      if (cumulativeTasks >= m && !unlockedTasks.has(m)) {
        unlockedTasks.add(m);
      }
    }
    for (const m of xpMilestones) {
      if (cumulativeXp >= m && !unlockedXp.has(m)) {
        unlockedXp.add(m);
      }
    }
    for (const m of levelMilestones) {
      if (levelValue >= m && !unlockedLevels.has(m)) {
        unlockedLevels.add(m);
      }
    }

    const badgesEarnedCumulative =
      unlockedStreak.size + unlockedTasks.size + unlockedXp.size + unlockedLevels.size;

    rows.push({
      date: iso,
      tasksCompleted: day.completed,
      tasksCompletedCumulative: cumulativeTasks,
      xpGained: day.points,
      xpGainedCumulative: cumulativeXp,
      level: levelValue,
      badgesEarnedCumulative
    });

    if (projectBreakdown.projects.length > 0) {
      const tasksCompletedByProject: Record<string, number> = {};
      const xpGainedByProject: Record<string, number> = {};
      for (const { id } of projectBreakdown.projects) {
        const v = perProject.get(id);
        if (!v) continue;
        tasksCompletedByProject[id] = v.completed;
        xpGainedByProject[id] = v.points;
      }
      projectBreakdown.rows.push({ date: iso, tasksCompletedByProject, xpGainedByProject });
    }

    cursor = addDaysLocal(cursor, 1);
  }

  const payload = { profileId: scopedProfileId, rows, projectBreakdown };
  productivityCache.set(scopedCacheKey, payload);
  res.json(payload);
});

app.post("/api/admin/reload-data", async (_req, res) => {
  try {
    await loadData();
    res.json({
      ok: true,
      counts: { projects: projects.length, tasks: tasks.length, profiles: profiles.length },
      diagnostics: { profileBackfill: lastProfileBackfillDiagnostics }
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/admin/save-data", async (_req, res) => {
  try {
    // Defensive: if any duplicates exist in memory, keep the latest instance by id.
    projects = mergeProjects([], projects);
    tasks = mergeTasksPreferLatest([], tasks);
    profiles = mergeProfiles([], profiles);
    {
      const canonical = canonicalizeProfilesAndRemap(profiles, projects, tasks);
      profiles = canonical.profiles;
      projects = canonical.projects;
      tasks = canonical.tasks;
    }
    // Runtime persistence (split files).
    await persistProjects();
    await persistTasks();
    await persistProfiles();
    // Run standard normalization/dedupe to keep deterministic ids/series.
    await loadData();
    res.json({
      ok: true,
      counts: { projects: projects.length, tasks: tasks.length, profiles: profiles.length }
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/admin/export-data", async (req, res) => {
  const body = z
    .object({
      profilePasswords: z.record(z.string(), z.string()).optional()
    })
    .safeParse(req.body ?? {});
  if (!body.success) {
    return res.status(400).json({ ok: false, error: body.error.flatten() });
  }

  try {
    // Always export from a merged, deduped snapshot.
    const mergedProjects = mergeProjects([], projects);
    const mergedTasks = mergeTasksPreferLatest([], tasks);
    const mergedProfiles = mergeProfiles([], profiles);
    const profileIdSet = new Set(mergedProfiles.map((p) => p.id));
    const liveProjects = mergedProjects.filter(
      (p) => !p.profileId || profileIdSet.has(p.profileId)
    );
    const liveProjectIdSet = new Set(liveProjects.map((p) => p.id));
    const liveTasks = mergedTasks.filter((t) => {
      // Deleted-like tasks (cancelled) should never be exported.
      if (t.cancelled) return false;
      // Keep profile/project linkage consistent in export payload.
      if (t.profileId && !profileIdSet.has(t.profileId)) return false;
      if (t.projectId && !liveProjectIdSet.has(t.projectId)) return false;
      return true;
    });
    const liveProfileIds = new Set<string>();
    for (const p of liveProjects) {
      if (p.profileId) liveProfileIds.add(p.profileId);
    }
    for (const t of liveTasks) {
      if (t.profileId) liveProfileIds.add(t.profileId);
    }
    const liveProfiles = mergedProfiles.filter((p) => liveProfileIds.has(p.id));

    const profilePasswords = body.data.profilePasswords ?? {};
    const lockedProfiles = liveProfiles.filter((p) => !!p.passwordHash);
    const deniedProfileIds = new Set<string>();
    const deniedProfileNames: string[] = [];

    for (const p of lockedProfiles) {
      const password = profilePasswords[p.id];
      if (!password) {
        deniedProfileIds.add(p.id);
        deniedProfileNames.push(p.name);
        continue;
      }
      const valid = await verifyPassword(password, p.passwordHash!);
      if (!valid) {
        deniedProfileIds.add(p.id);
        deniedProfileNames.push(p.name);
      }
    }

    const exportProfiles = liveProfiles.filter((p) => !deniedProfileIds.has(p.id));
    const exportProjects = liveProjects.filter((p) => !deniedProfileIds.has(p.profileId ?? ""));
    const allowedProjectIds = new Set(exportProjects.map((p) => p.id));
    const exportTasks = liveTasks.filter((t) => {
      const profileAllowed = !deniedProfileIds.has(t.profileId ?? "");
      const projectAllowed = !t.projectId || allowedProjectIds.has(t.projectId);
      return profileAllowed && projectAllowed;
    });

    return res.json({
      ok: true,
      data: {
        app: "focista-schedulo",
        exportedAt: new Date().toISOString(),
        profiles: exportProfiles,
        projects: exportProjects,
        tasks: exportTasks
      },
      excludedLockedProfiles: deniedProfileNames
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/admin/sync-from-data", async (_req, res) => {
  try {
    const disk = await readSyncSourceFromDataDir();
    // Merge disk into memory, dedupe by id, keep "latest" by completedAt where available.
    projects = mergeProjects(projects, disk.projects);
    tasks = mergeTasksPreferLatest(tasks, disk.tasks);
    profiles = mergeProfiles(profiles, disk.profiles);
    {
      const canonical = canonicalizeProfilesAndRemap(profiles, projects, tasks);
      profiles = canonical.profiles;
      projects = canonical.projects;
      tasks = canonical.tasks;
    }
    await persistProjects();
    await persistTasks();
    await persistProfiles();
    await loadData();
    res.json({
      ok: true,
      filesRead: disk.filesRead,
      imported: {
        projects: disk.projects.length,
        tasks: disk.tasks.length,
        profiles: disk.profiles.length
      },
      counts: { projects: projects.length, tasks: tasks.length, profiles: profiles.length },
      diagnostics: { profileBackfill: lastProfileBackfillDiagnostics }
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/admin/import", async (req, res) => {
  const schema = z.object({
    format: z.enum(["json", "csv"]),
    content: z.string().min(1)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const { format, content } = parsed.data as { format: ImportFormat; content: string };

  try {
    let incomingProjects: Project[] = [];
    let incomingTasks: Task[] = [];
    let incomingProfiles: Profile[] = [];
    let droppedRows = { projects: 0, tasks: 0, profiles: 0 };
    let inferredProfileIds = { projects: 0, tasks: 0 };

    if (format === "json") {
      const raw = JSON.parse(content);
      // Accept export payload { app, exportedAt, projects, tasks, profiles }
      // and also loose arrays from runtime files (projects/tasks/profiles).
      const projectsRaw = Array.isArray(raw?.projects)
        ? raw.projects
        : isLooseProjectArray(raw)
          ? raw
          : [];
      const tasksRaw = Array.isArray(raw?.tasks)
        ? raw.tasks
        : isLooseTaskArray(raw)
          ? raw
          : [];
      const profilesRaw = Array.isArray(raw?.profiles)
        ? raw.profiles
        : isLooseProfileArray(raw)
          ? raw
          : [];

      const pSafe = z.array(ProjectSchema).safeParse(projectsRaw);
      const tSafe = z.array(TaskSchema).safeParse(tasksRaw);
      const profileSafe = z.array(ProfileSchema).safeParse(profilesRaw);
      const looseProfiles = parseProfilesLoose(Array.isArray(profilesRaw) ? profilesRaw : []);
      if (!pSafe.success && !tSafe.success && !profileSafe.success && looseProfiles.length === 0) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid JSON import payload: expected export object or loose array of projects/tasks/profiles"
        });
      }
      incomingProjects = pSafe.success ? pSafe.data : [];
      incomingTasks = tSafe.success ? tSafe.data : [];
      incomingProfiles = profileSafe.success ? profileSafe.data : looseProfiles;
      droppedRows = {
        projects: pSafe.success ? Math.max(0, projectsRaw.length - incomingProjects.length) : projectsRaw.length,
        tasks: tSafe.success ? Math.max(0, tasksRaw.length - incomingTasks.length) : tasksRaw.length,
        profiles: Math.max(0, profilesRaw.length - incomingProfiles.length)
      };
    } else {
      const parsedCsv = parseCsv(content);
      if (parsedCsv.headers.length === 0) {
        return res.status(400).json({ ok: false, error: "CSV import failed: empty file" });
      }
      const projectProfileHints = new Map<string, { name?: string; title?: string }>();
      const taskProfileHints = new Map<string, { name?: string; title?: string }>();
      for (const r of parsedCsv.rows) {
        const recordType = (r["recordType"] ?? "").trim().toLowerCase();
        if (recordType === "project") {
          const id = (r["id"] ?? r["projectId"] ?? "").trim();
          const name = (r["projectNameOnly"] ?? r["projectName"] ?? r["name"] ?? "").trim();
          if (!id || !name) continue;
          incomingProjects.push({
            id,
            name,
            profileId: (() => {
              const pid = (r["profileId"] ?? "").trim();
              return pid ? pid : null;
            })()
          });
          const hintName = (r["profileName"] ?? "").trim();
          const hintTitle = (r["profileTitle"] ?? "").trim();
          if (id && (hintName || hintTitle)) {
            projectProfileHints.set(id, {
              name: hintName || undefined,
              title: hintTitle || undefined
            });
          }
          continue;
        }
        if (recordType === "profile") {
          const id = (r["id"] ?? "").trim();
          const name = (r["profileName"] ?? r["name"] ?? "").trim();
          const title = (r["profileTitle"] ?? r["title"] ?? "").trim();
          if (!id || !name || !title) continue;
          const nowIso = new Date().toISOString();
          incomingProfiles.push({
            id,
            name,
            title,
            passwordHash: (r["passwordHash"] ?? "").trim() || undefined,
            createdAt: (r["createdAt"] ?? "").trim() || nowIso,
            updatedAt: (r["updatedAt"] ?? "").trim() || nowIso
          });
          continue;
        }
        if (recordType === "task") {
          const id = (r["id"] ?? "").trim();
          const title = (r["title"] ?? "").trim();
          const priority = (r["priority"] ?? "medium").trim() as Task["priority"];
          if (!id || !title) continue;
          incomingTasks.push({
            id,
            title,
            description: (r["description"] ?? "").trim() || undefined,
            priority: ["low", "medium", "high", "urgent"].includes(priority) ? priority : "medium",
            dueDate: (r["dueDate"] ?? "").trim() || undefined,
            dueTime: (r["dueTime"] ?? "").trim() || undefined,
            durationMinutes: parseIntOpt(r["durationMinutes"]),
            deadlineDate: (r["deadlineDate"] ?? "").trim() || undefined,
            deadlineTime: (r["deadlineTime"] ?? "").trim() || undefined,
            repeat: parseCsvRepeat(r["repeat"]),
            repeatEvery: parseIntOpt(r["repeatEvery"]),
            repeatUnit: parseCsvRepeatUnit(r["repeatUnit"]),
            labels: parsePipeArray(r["labels"]),
            location: (r["location"] ?? "").trim() || undefined,
            link: (() => {
              const arr = parsePipeArray(r["link"]);
              return arr.length ? arr : undefined;
            })(),
            reminderMinutesBefore: parseIntOpt(r["reminderMinutesBefore"]),
            profileId: (() => {
              const pid = (r["profileId"] ?? "").trim();
              return pid ? pid : null;
            })(),
            projectId: (() => {
              const pid = (r["projectId"] ?? "").trim();
              return pid ? pid : null;
            })(),
            completed: parseBool(r["completed"]) ?? false,
            completedAt: (r["completedAt"] ?? "").trim() || undefined,
            parentId: (r["parentId"] ?? "").trim() || undefined,
            childId: (r["childId"] ?? "").trim() || undefined,
            cancelled: parseBool(r["cancelled"])
          });
          const hintName = (r["profileName"] ?? "").trim();
          const hintTitle = (r["profileTitle"] ?? "").trim();
          if (id && (hintName || hintTitle)) {
            taskProfileHints.set(id, {
              name: hintName || undefined,
              title: hintTitle || undefined
            });
          }
          continue;
        }
      }

      const profileUniverse = mergeProfiles(profiles, incomingProfiles);
      const resolveProfileIdFromHint = (hint?: { name?: string; title?: string }): string | null => {
        if (!hint?.name && !hint?.title) return null;
        const byNameAndTitle = profileUniverse.find(
          (p) =>
            (!hint.name || normalizeProfileLabel(p.name) === normalizeProfileLabel(hint.name)) &&
            (!hint.title || normalizeProfileLabel(p.title) === normalizeProfileLabel(hint.title))
        );
        if (byNameAndTitle) return byNameAndTitle.id;
        if (hint.name) {
          const byName = profileUniverse.find(
            (p) => normalizeProfileLabel(p.name) === normalizeProfileLabel(hint.name)
          );
          if (byName) return byName.id;
        }
        return null;
      };
      const ensureProfileFromHint = (hint?: { name?: string; title?: string }): string | null => {
        const resolved = resolveProfileIdFromHint(hint);
        if (resolved) return resolved;
        const name = (hint?.name ?? "").trim();
        const title = (hint?.title ?? name).trim();
        if (!name || !title) return null;
        const nowIso = new Date().toISOString();
        const created: Profile = {
          id: makeProfileId(),
          name,
          title,
          createdAt: nowIso,
          updatedAt: nowIso
        };
        incomingProfiles.push(created);
        profileUniverse.push(created);
        return created.id;
      };

      incomingProjects = incomingProjects.map((p) => {
        if (hasProfileId(p.profileId)) return p;
        const inferred = ensureProfileFromHint(projectProfileHints.get(p.id));
        if (!inferred) return p;
        inferredProfileIds.projects += 1;
        return { ...p, profileId: inferred };
      });

      const projectProfileById = new Map(incomingProjects.map((p) => [p.id, p.profileId ?? null]));
      incomingTasks = incomingTasks.map((t) => {
        if (hasProfileId(t.profileId)) return t;
        const fromHint = ensureProfileFromHint(taskProfileHints.get(t.id));
        if (fromHint) {
          inferredProfileIds.tasks += 1;
          return { ...t, profileId: fromHint };
        }
        const fromProject = hasProjectId(t.projectId) ? projectProfileById.get(t.projectId) ?? null : null;
        if (hasProfileId(fromProject)) {
          inferredProfileIds.tasks += 1;
          return { ...t, profileId: fromProject };
        }
        return t;
      });

      // If import carries profiles but many task/project rows omit profileId entirely,
      // attach them to the sole imported profile for deterministic scoped visibility.
      if (incomingProfiles.length === 1) {
        const soleProfileId = incomingProfiles[0]!.id;
        incomingProjects = incomingProjects.map((p) =>
          hasProfileId(p.profileId) ? p : { ...p, profileId: soleProfileId }
        );
        const projectProfileByIdNext = new Map(incomingProjects.map((p) => [p.id, p.profileId ?? null]));
        incomingTasks = incomingTasks.map((t) => {
          if (hasProfileId(t.profileId)) return t;
          const fromProject = hasProjectId(t.projectId) ? projectProfileByIdNext.get(t.projectId) ?? null : null;
          if (hasProfileId(fromProject)) return { ...t, profileId: fromProject };
          return { ...t, profileId: soleProfileId };
        });
      }

      // Validate what we built (drop invalid rows)
      const safeProjects = z.array(ProjectSchema).safeParse(incomingProjects);
      incomingProjects = safeProjects.success ? safeProjects.data : [];
      const safeTasks = z.array(TaskSchema).safeParse(incomingTasks);
      incomingTasks = safeTasks.success ? safeTasks.data : [];
      const safeProfiles = z.array(ProfileSchema).safeParse(incomingProfiles);
      incomingProfiles = safeProfiles.success ? safeProfiles.data : parseProfilesLoose(incomingProfiles);
      droppedRows = {
        projects: safeProjects.success ? 0 : 1,
        tasks: safeTasks.success ? 0 : 1,
        profiles: safeProfiles.success ? 0 : 0
      };
    }

    // Guarantee profile records exist for any referenced non-null profileId in imported data.
    const ensuredProfilesById = new Map<string, Profile>();
    for (const p of profiles) ensuredProfilesById.set(p.id, p);
    for (const p of incomingProfiles) ensuredProfilesById.set(p.id, p);
    const ensuredById = new Set(ensuredProfilesById.keys());
    const nowIso = new Date().toISOString();
    const referencedProfileIds = new Set<string>();
    for (const p of incomingProjects) {
      if (hasProfileId(p.profileId)) referencedProfileIds.add(p.profileId);
    }
    for (const t of incomingTasks) {
      if (hasProfileId(t.profileId)) referencedProfileIds.add(t.profileId);
    }
    for (const pid of referencedProfileIds) {
      if (ensuredById.has(pid)) continue;
      incomingProfiles.push({
        id: pid,
        name: pid,
        title: pid,
        createdAt: nowIso,
        updatedAt: nowIso
      });
      ensuredById.add(pid);
    }

    // Final attachment pass:
    // 1) infer task profile from project profile when possible
    // 2) when exactly one imported profile exists, attach remaining null-profile entities to it
    const incomingProjectProfileById = new Map(incomingProjects.map((p) => [p.id, p.profileId ?? null]));
    incomingTasks = incomingTasks.map((t) => {
      if (hasProfileId(t.profileId)) return t;
      const fromProject = hasProjectId(t.projectId) ? incomingProjectProfileById.get(t.projectId) ?? null : null;
      if (hasProfileId(fromProject)) return { ...t, profileId: fromProject };
      return t;
    });
    if (incomingProfiles.length === 1) {
      const soleProfileId = incomingProfiles[0]!.id;
      incomingProjects = incomingProjects.map((p) =>
        hasProfileId(p.profileId) ? p : { ...p, profileId: soleProfileId }
      );
      const projectProfileByIdNext = new Map(incomingProjects.map((p) => [p.id, p.profileId ?? null]));
      incomingTasks = incomingTasks.map((t) => {
        if (hasProfileId(t.profileId)) return t;
        const fromProject = hasProjectId(t.projectId) ? projectProfileByIdNext.get(t.projectId) ?? null : null;
        if (hasProfileId(fromProject)) return { ...t, profileId: fromProject };
        return { ...t, profileId: soleProfileId };
      });
    }

    // Merge into in-memory state, then persist and run the standard load normalization/dedupe.
    const profileUniverseForDiagnostics = mergeProfiles(profiles, incomingProfiles);
    const profileNameById = new Map(profileUniverseForDiagnostics.map((p) => [p.id, p.name]));
    const importedTasksByProfileIdMap = new Map<string, number>();
    for (const t of incomingTasks) {
      const pid = t.profileId ?? "__null__";
      importedTasksByProfileIdMap.set(pid, (importedTasksByProfileIdMap.get(pid) ?? 0) + 1);
    }
    const importedTasksByProfileId = Object.fromEntries(importedTasksByProfileIdMap.entries());
    const importedTasksByProfileName = Object.fromEntries(
      Array.from(importedTasksByProfileIdMap.entries()).map(([pid, count]) => [
        pid === "__null__" ? "(none)" : profileNameById.get(pid) ?? pid,
        count
      ])
    );

    projects = mergeProjects(projects, incomingProjects);
    tasks = mergeTasksPreferLatest(tasks, incomingTasks);
    profiles = mergeProfiles(profiles, incomingProfiles);
    const canonical = canonicalizeProfilesAndRemap(profiles, projects, tasks);
    profiles = canonical.profiles;
    projects = canonical.projects;
    tasks = canonical.tasks;
    await persistProjects();
    await persistTasks();
    await persistProfiles();
    await loadData();

    res.json({
      ok: true,
      imported: {
        projects: incomingProjects.length,
        tasks: incomingTasks.length,
        profiles: incomingProfiles.length
      },
      inferredProfileIds,
      droppedRows,
      counts: { projects: projects.length, tasks: tasks.length, profiles: profiles.length },
      diagnostics: {
        profileBackfill: lastProfileBackfillDiagnostics,
        importedTasksByProfileId,
        importedTasksByProfileName
      }
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

