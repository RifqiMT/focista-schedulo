import { apiFetch } from "./apiClient";

/** Stay under Vercel Hobby ~4.5MB request bodies. */
const TASK_BATCH_SIZE = 400;
const PROJECT_BATCH_SIZE = 500;

export type BatchedImportFormat = "json" | "csv";

type ImportProfile = {
  id: string;
  name: string;
  title: string;
  passwordHash?: string;
  createdAt: string;
  updatedAt: string;
};

type ImportProject = { id: string; name: string; profileId?: string | null };
type ImportTask = Record<string, unknown> & { id: string };

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseExportCsv(text: string): {
  profiles: ImportProfile[];
  projects: ImportProject[];
  tasks: ImportTask[];
} {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { profiles: [], projects: [], tasks: [] };
  const headers = splitCsvLine(lines[0]!).map((h) => h.trim());
  const profiles: ImportProfile[] = [];
  const projects: ImportProject[] = [];
  const tasks: ImportTask[] = [];
  const nowIso = new Date().toISOString();

  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]!);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });
    const recordType = (row.recordType ?? "").trim().toLowerCase();
    if (recordType === "profile") {
      const id = (row.id ?? "").trim();
      const name = (row.name ?? row.profileName ?? "").trim();
      const title = (row.profileTitle ?? row.title ?? "").trim();
      if (!id || !name || !title) continue;
      profiles.push({
        id,
        name,
        title,
        passwordHash: (row.passwordHash ?? "").trim() || undefined,
        createdAt: (row.createdAt ?? "").trim() || nowIso,
        updatedAt: (row.updatedAt ?? "").trim() || nowIso
      });
      continue;
    }
    if (recordType === "project") {
      const id = (row.id ?? row.projectId ?? "").trim();
      const name = (row.projectNameOnly ?? row.projectName ?? row.name ?? "").trim();
      if (!id || !name) continue;
      const profileId = (row.profileId ?? "").trim();
      projects.push({ id, name, profileId: profileId || null });
      continue;
    }
    if (recordType === "task") {
      const id = (row.id ?? "").trim();
      const title = (row.title ?? "").trim();
      if (!id || !title) continue;
      const labels = (row.labels ?? "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      const link = (row.link ?? "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      tasks.push({
        id,
        title,
        description: row.description || undefined,
        priority: (row.priority || "medium") as string,
        dueDate: row.dueDate || undefined,
        dueTime: row.dueTime || undefined,
        durationMinutes: row.durationMinutes ? Number(row.durationMinutes) : undefined,
        repeat: row.repeat || undefined,
        repeatEvery: row.repeatEvery ? Number(row.repeatEvery) : undefined,
        repeatUnit: row.repeatUnit || undefined,
        labels,
        location: row.location || undefined,
        link: link.length ? link : undefined,
        reminderMinutesBefore: row.reminderMinutesBefore
          ? Number(row.reminderMinutesBefore)
          : undefined,
        profileId: (row.profileId ?? "").trim() || null,
        projectId: (row.projectId ?? "").trim() || null,
        completed: /^(1|true|yes)$/i.test(row.completed ?? ""),
        completedAt: undefined,
        parentId: row.parentId || undefined,
        childId: row.childId || undefined,
        cancelled: /^(1|true|yes)$/i.test(row.cancelled ?? "")
      });
    }
  }

  return { profiles, projects, tasks };
}

function parseExportJson(text: string): {
  profiles: unknown[];
  projects: unknown[];
  tasks: unknown[];
} {
  const raw = JSON.parse(text) as Record<string, unknown>;
  return {
    profiles: Array.isArray(raw.profiles) ? raw.profiles : [],
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    tasks: Array.isArray(raw.tasks) ? raw.tasks : []
  };
}

async function postMerge(body: Record<string, unknown>): Promise<{
  ok: boolean;
  error?: string;
  counts?: { profiles: number; projects: number; tasks: number };
  merged?: { profiles: number; projects: number; tasks: number };
}> {
  const res = await apiFetch("/api/admin/import-merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    error?: unknown;
    counts?: { profiles: number; projects: number; tasks: number };
    merged?: { profiles: number; projects: number; tasks: number };
  } | null;
  if (!res.ok || !json?.ok) {
    const err =
      typeof json?.error === "string"
        ? json.error
        : `Import batch failed (${res.status})`;
    throw new Error(err);
  }
  return {
    ok: true,
    counts: json.counts,
    merged: json.merged
  };
}

/**
 * Parse the file in the browser and merge in small API batches.
 * Works on Vercel Hobby without transfer_staging / without posting a multi-MB body.
 */
export async function importFileInBatches(
  file: File,
  format: BatchedImportFormat
): Promise<{
  imported: { profiles: number; projects: number; tasks: number };
  counts: { profiles: number; projects: number; tasks: number };
}> {
  const text = await file.text();
  const parsed =
    format === "json" ? parseExportJson(text) : parseExportCsv(text);

  const profiles = parsed.profiles;
  const projects = parsed.projects;
  const tasks = parsed.tasks;

  if (!profiles.length && !projects.length && !tasks.length) {
    throw new Error("Import file contained no profiles, projects, or tasks.");
  }

  let imported = { profiles: 0, projects: 0, tasks: 0 };

  if (profiles.length) {
    const out = await postMerge({ profiles });
    imported.profiles += out.merged?.profiles ?? profiles.length;
  }

  for (let i = 0; i < projects.length; i += PROJECT_BATCH_SIZE) {
    const chunk = projects.slice(i, i + PROJECT_BATCH_SIZE);
    const out = await postMerge({ projects: chunk });
    imported.projects += out.merged?.projects ?? chunk.length;
  }

  for (let i = 0; i < tasks.length; i += TASK_BATCH_SIZE) {
    const chunk = tasks.slice(i, i + TASK_BATCH_SIZE);
    const out = await postMerge({ tasks: chunk });
    imported.tasks += out.merged?.tasks ?? chunk.length;
  }

  const final = await postMerge({ finalize: true });
  return {
    imported,
    counts: final.counts ?? {
      profiles: profiles.length,
      projects: projects.length,
      tasks: tasks.length
    }
  };
}

/**
 * Prefer batched merge on Vercel only when Neon transfer staging is unavailable.
 * When Neon is configured, large imports should use chunked staging instead.
 */
export function shouldUseBatchedImport(
  file: File,
  opts?: { neonTransferStaging?: boolean }
): boolean {
  if (opts?.neonTransferStaging) {
    // Neon staging handles large files; keep batches for huge browser-parse fallbacks only.
    return false;
  }
  if (typeof window !== "undefined" && /\.vercel\.app$/i.test(window.location.hostname)) {
    return file.size > 256 * 1024;
  }
  return file.size > 3_000_000;
}
