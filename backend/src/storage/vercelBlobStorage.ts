import { get, list, put } from "@vercel/blob";
import type { DataStorage, StorageJsonEntry } from "./types";

export type VercelBlobStorageOptions = {
  /** Folder prefix inside the Blob store, e.g. `focista-schedulo/runtime/`. */
  prefix: string;
  /** Must match the Blob store access mode created in the Vercel dashboard. */
  access: "private" | "public";
  /** Optional env override (tests); defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
};

function joinPrefix(prefix: string, name: string): string {
  const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return `${normalized}${name}`;
}

function basenameFromPathname(pathname: string, prefix: string): string {
  const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
  if (pathname.startsWith(normalized)) return pathname.slice(normalized.length);
  const slash = pathname.lastIndexOf("/");
  return slash >= 0 ? pathname.slice(slash + 1) : pathname;
}

async function streamToUtf8(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

/**
 * Persists runtime JSON objects in Vercel Blob (Hobby free tier compatible).
 * Not a database: each dirty flush rewrites whole JSON files (same model as local disk).
 */
export function createVercelBlobStorage(options: VercelBlobStorageOptions): DataStorage {
  const { prefix, access } = options;
  const env = options.env ?? process.env;

  return {
    kind: "vercel-blob",
    // Coalesce writes aggressively — Hobby free tier limits advanced ops (uploads).
    // On Vercel serverless, debounce must be 0: timers after the response are frozen.
    persistDebounceMs: env.VERCEL ? 0 : 1500,

    async ensureReady() {
      // Blob stores need no mkdir; credential errors surface on first read/write.
    },

    async readText(name: string) {
      const pathname = joinPrefix(prefix, name);
      try {
        const result = await get(pathname, { access, useCache: false });
        if (!result || result.statusCode !== 200 || !result.stream) return null;
        return await streamToUtf8(result.stream);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Treat missing blobs as empty; rethrow auth/config failures.
        if (/not found|404|BlobNotFound/i.test(message)) return null;
        console.error("[storage:vercel-blob] read failed", { pathname, error: message });
        throw err;
      }
    },

    async writeText(name: string, content: string) {
      const pathname = joinPrefix(prefix, name);
      const bytes = Buffer.byteLength(content, "utf8");
      try {
        await put(pathname, content, {
          access,
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: "application/json; charset=utf-8",
          // Minimum allowed by Blob; keep short so overwrites become visible quickly.
          cacheControlMaxAge: 60,
          // Large runtime dumps (tasks can be multi-MB) benefit from multipart.
          multipart: bytes > 4 * 1024 * 1024
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[storage:vercel-blob] write failed", { pathname, bytes, error: message });
        throw err;
      }
    },

    async listSyncJsonEntries() {
      const entries: StorageJsonEntry[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({
          prefix: prefix.endsWith("/") ? prefix : `${prefix}/`,
          cursor,
          limit: 1000
        });
        for (const blob of page.blobs) {
          const name = basenameFromPathname(blob.pathname, prefix);
          const lower = name.toLowerCase();
          if (!lower.endsWith(".json") || lower === "focista-unified-data.json") continue;
          entries.push({
            name,
            mtimeMs: blob.uploadedAt instanceof Date ? blob.uploadedAt.getTime() : Date.now()
          });
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    }
  };
}
