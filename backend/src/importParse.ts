import { z } from "zod";

export type ImportDropCounts = {
  projects: number;
  tasks: number;
  profiles: number;
};

function asRecord(row: unknown): Record<string, unknown> | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  return row as Record<string, unknown>;
}

function coerceOptionalPositiveInt(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return undefined;
  return n;
}

function coerceOptionalNonNegInt(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return undefined;
  return n;
}

function coerceLabels(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s.trim() !== "");
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    if (s.includes("|")) return s.split("|").map((x) => x.trim()).filter(Boolean);
    return [s];
  }
  return [];
}

function coerceLink(v: unknown): string[] | undefined {
  if (v == null || v === "") return undefined;
  if (Array.isArray(v)) {
    const arr = v.map((x) => String(x).trim()).filter(Boolean);
    return arr.length ? arr : undefined;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return undefined;
    if (s.includes("|")) {
      const arr = s.split("|").map((x) => x.trim()).filter(Boolean);
      return arr.length ? arr : undefined;
    }
    return [s];
  }
  return undefined;
}

function coerceNullableId(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function coerceBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(s)) return true;
    if (["false", "0", "no", "n", ""].includes(s)) return false;
  }
  if (v == null) return fallback;
  return fallback;
}

const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

/**
 * Soft-coerce common export/hand-edit quirks so one malformed field does not
 * fail Zod for an otherwise valid task (critical for Vercel prod imports).
 */
export function coerceTaskImportRow(row: unknown): unknown {
  const r = asRecord(row);
  if (!r) return row;
  const priorityRaw = String(r.priority ?? "medium").trim().toLowerCase();
  const out: Record<string, unknown> = {
    ...r,
    id: String(r.id ?? "").trim(),
    title: String(r.title ?? "").trim(),
    priority: PRIORITIES.has(priorityRaw) ? priorityRaw : "medium",
    labels: coerceLabels(r.labels),
    projectId: Object.prototype.hasOwnProperty.call(r, "projectId")
      ? coerceNullableId(r.projectId)
      : null,
    completed: coerceBool(r.completed, false),
    profileId: Object.prototype.hasOwnProperty.call(r, "profileId")
      ? coerceNullableId(r.profileId)
      : r.profileId
  };

  if (r.description != null) out.description = String(r.description);
  if (r.dueDate != null && String(r.dueDate).trim()) out.dueDate = String(r.dueDate).trim();
  if (r.dueTime != null && String(r.dueTime).trim()) out.dueTime = String(r.dueTime).trim();
  if (r.deadlineDate != null && String(r.deadlineDate).trim()) {
    out.deadlineDate = String(r.deadlineDate).trim();
  }
  if (r.deadlineTime != null && String(r.deadlineTime).trim()) {
    out.deadlineTime = String(r.deadlineTime).trim();
  }
  if (r.location != null && String(r.location).trim()) out.location = String(r.location).trim();
  if (r.completedAt != null && String(r.completedAt).trim()) {
    out.completedAt = String(r.completedAt).trim();
  }
  if (r.parentId != null && String(r.parentId).trim()) out.parentId = String(r.parentId).trim();
  if (r.childId != null && String(r.childId).trim()) out.childId = String(r.childId).trim();
  if (r.cancelled != null) out.cancelled = coerceBool(r.cancelled, false);

  const duration = coerceOptionalPositiveInt(r.durationMinutes);
  if (duration != null) out.durationMinutes = duration;
  else delete out.durationMinutes;

  const repeatEvery = coerceOptionalPositiveInt(r.repeatEvery);
  if (repeatEvery != null) out.repeatEvery = repeatEvery;
  else delete out.repeatEvery;

  const reminder = coerceOptionalNonNegInt(r.reminderMinutesBefore);
  if (reminder != null) out.reminderMinutesBefore = reminder;
  else delete out.reminderMinutesBefore;

  const link = coerceLink(r.link);
  if (link) out.link = link;
  else delete out.link;

  return out;
}

export function coerceProjectImportRow(row: unknown): unknown {
  const r = asRecord(row);
  if (!r) return row;
  return {
    ...r,
    id: String(r.id ?? "").trim(),
    name: String(r.name ?? r.projectNameOnly ?? r.projectName ?? "").trim(),
    profileId: Object.prototype.hasOwnProperty.call(r, "profileId")
      ? coerceNullableId(r.profileId)
      : r.profileId
  };
}

export function coerceProfileImportRow(row: unknown): unknown {
  const r = asRecord(row);
  if (!r) return row;
  const name = String(r.name ?? r.profileName ?? "").trim();
  const title = String(r.title ?? r.profileTitle ?? name).trim();
  const nowIso = new Date().toISOString();
  return {
    ...r,
    id: String(r.id ?? "").trim(),
    name,
    title,
    createdAt:
      typeof r.createdAt === "string" && r.createdAt.trim() ? r.createdAt.trim() : nowIso,
    updatedAt:
      typeof r.updatedAt === "string" && r.updatedAt.trim() ? r.updatedAt.trim() : nowIso,
    passwordHash:
      typeof r.passwordHash === "string" && r.passwordHash.trim()
        ? r.passwordHash.trim()
        : undefined
  };
}

export function parseImportArrayPerRow<T>(
  rows: unknown[],
  schema: z.ZodType<T>,
  coerce?: (row: unknown) => unknown
): { ok: T[]; dropped: number } {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: [], dropped: 0 };

  // Fast path: whole array valid (common for clean Focista exports).
  const batched = z.array(schema).safeParse(rows);
  if (batched.success) return { ok: batched.data, dropped: 0 };

  const ok: T[] = [];
  let dropped = 0;
  for (const row of rows) {
    const candidate = coerce ? coerce(row) : row;
    const parsed = schema.safeParse(candidate);
    if (parsed.success) ok.push(parsed.data);
    else dropped += 1;
  }
  return { ok, dropped };
}
