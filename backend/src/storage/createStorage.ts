import { createFsStorage } from "./fsStorage";
import { getDatabaseUrl } from "./neonClient";
import { createNeonStorage } from "./neonStorage";
import type { DataStorage, StorageKind } from "./types";
import path from "path";

export type ResolveStorageOptions = {
  env?: NodeJS.ProcessEnv;
  /** Absolute path to local `backend/data` when using fs. */
  dataDir?: string;
};

function isTruthy(v: string | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

/**
 * Resolve storage backend.
 * - `STORAGE_BACKEND=fs` → local JSON files (default for local dev)
 * - `STORAGE_BACKEND=neon` → Neon Postgres (requires DATABASE_URL)
 * - On Vercel: if a DB URL is present, prefer Neon (ignore stale STORAGE_BACKEND=fs
 *   unless `VERCEL_ALLOW_FS=1`)
 * - unset/`auto` → Neon when DB URL exists, otherwise fs
 */
export function resolveStorageKind(env: NodeJS.ProcessEnv = process.env): StorageKind {
  const raw = (env.STORAGE_BACKEND ?? "").trim().toLowerCase();
  const dbUrl = getDatabaseUrl(env);
  const onVercel = Boolean(env.VERCEL);

  // Prod on Vercel must not silently use ephemeral fs when Neon is configured.
  if (onVercel && dbUrl && !isTruthy(env.VERCEL_ALLOW_FS)) {
    return "neon";
  }

  if (raw === "fs" || raw === "filesystem" || raw === "local") return "fs";
  if (raw === "neon" || raw === "postgres" || raw === "postgresql") {
    if (!dbUrl) {
      throw new Error(
        "STORAGE_BACKEND=neon requires DATABASE_URL (or POSTGRES_URL) — pooled Neon connection string."
      );
    }
    return "neon";
  }
  if (raw === "vercel-blob" || raw === "blob") {
    throw new Error(
      'STORAGE_BACKEND=vercel-blob is no longer supported. Use "neon" with DATABASE_URL, or "fs" for local.'
    );
  }
  if (raw && raw !== "auto") {
    throw new Error(
      `Unknown STORAGE_BACKEND="${raw}". Use "fs", "neon", or leave unset for auto.`
    );
  }
  return dbUrl ? "neon" : "fs";
}

export function createDataStorage(options: ResolveStorageOptions = {}): DataStorage {
  const env = options.env ?? process.env;
  const kind = resolveStorageKind(env);
  if (kind === "neon") {
    return createNeonStorage({ env });
  }
  const dataDir = options.dataDir ?? path.join(__dirname, "..", "..", "data");
  return createFsStorage(dataDir);
}
