import path from "path";
import { createFsStorage } from "./fsStorage";
import { getDatabaseUrl } from "./neonClient";
import { createNeonStorage } from "./neonStorage";
import type { DataStorage, StorageKind } from "./types";

export type ResolveStorageOptions = {
  env?: NodeJS.ProcessEnv;
  /** Absolute path to local `backend/data` when using fs. */
  dataDir?: string;
};

/**
 * Resolve storage backend.
 * - `STORAGE_BACKEND=fs` → local JSON files (default for local dev)
 * - `STORAGE_BACKEND=neon` → Neon Postgres (requires DATABASE_URL)
 * - unset/`auto` → Neon when DATABASE_URL exists, otherwise fs
 */
export function resolveStorageKind(env: NodeJS.ProcessEnv = process.env): StorageKind {
  const raw = (env.STORAGE_BACKEND ?? "").trim().toLowerCase();
  if (raw === "fs" || raw === "filesystem" || raw === "local") return "fs";
  if (raw === "neon" || raw === "postgres" || raw === "postgresql") {
    if (!getDatabaseUrl(env)) {
      throw new Error("STORAGE_BACKEND=neon requires DATABASE_URL (pooled Neon connection string).");
    }
    return "neon";
  }
  if (raw && raw !== "auto") {
    throw new Error(
      `Unknown STORAGE_BACKEND="${raw}". Use "fs", "neon", or leave unset for auto.`
    );
  }
  return getDatabaseUrl(env) ? "neon" : "fs";
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
