import path from "path";
import { createFsStorage } from "./fsStorage";
import type { DataStorage, StorageKind } from "./types";
import { createVercelBlobStorage } from "./vercelBlobStorage";

export type ResolveStorageOptions = {
  env?: NodeJS.ProcessEnv;
  /** Absolute path to local `backend/data` when using fs. */
  dataDir?: string;
};

function hasBlobCredentials(env: NodeJS.ProcessEnv): boolean {
  if (env.BLOB_READ_WRITE_TOKEN?.trim()) return true;
  if (env.BLOB_STORE_ID?.trim() && env.VERCEL_OIDC_TOKEN?.trim()) return true;
  return false;
}

/**
 * Resolve storage backend.
 * - `STORAGE_BACKEND=fs` → local JSON files (default for local dev)
 * - `STORAGE_BACKEND=vercel-blob` → Vercel Blob (requires token / OIDC)
 * - unset → auto: Blob when credentials exist, otherwise fs
 */
export function resolveStorageKind(env: NodeJS.ProcessEnv = process.env): StorageKind {
  const raw = (env.STORAGE_BACKEND ?? "").trim().toLowerCase();
  if (raw === "fs" || raw === "filesystem" || raw === "local") return "fs";
  if (raw === "vercel-blob" || raw === "blob") {
    if (!hasBlobCredentials(env)) {
      throw new Error(
        "STORAGE_BACKEND=vercel-blob requires BLOB_READ_WRITE_TOKEN " +
          "(or BLOB_STORE_ID + VERCEL_OIDC_TOKEN)."
      );
    }
    return "vercel-blob";
  }
  if (raw && raw !== "auto") {
    throw new Error(
      `Unknown STORAGE_BACKEND="${raw}". Use "fs", "vercel-blob", or leave unset for auto.`
    );
  }
  return hasBlobCredentials(env) ? "vercel-blob" : "fs";
}

export function createDataStorage(options: ResolveStorageOptions = {}): DataStorage {
  const env = options.env ?? process.env;
  const kind = resolveStorageKind(env);
  if (kind === "vercel-blob") {
    const prefix =
      env.BLOB_RUNTIME_PREFIX?.trim() || "focista-schedulo/runtime/";
    const accessRaw = (env.BLOB_ACCESS ?? "private").trim().toLowerCase();
    const access = accessRaw === "public" ? "public" : "private";
    return createVercelBlobStorage({ prefix, access, env });
  }
  const dataDir =
    options.dataDir ?? path.join(__dirname, "..", "..", "data");
  return createFsStorage(dataDir);
}
