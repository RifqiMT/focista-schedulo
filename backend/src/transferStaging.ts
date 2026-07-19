/**
 * Large import/export staging via Neon `transfer_staging`.
 * Inline size caps still apply on Vercel Hobby HTTP body limits (~4.5MB).
 *
 * Large imports must use **chunked** POST /api/admin/transfer-upload so each
 * request stays under the platform payload cap (Blob client upload is gone).
 */

/** Stay under Vercel Hobby request/response body limits (~4.5MB). */
export const INLINE_TRANSFER_MAX_BYTES = 3_000_000;

/**
 * Max bytes per transfer-upload request on Vercel (leave headroom under ~4.5MB).
 * Client and server both enforce this for chunked imports.
 */
export const TRANSFER_UPLOAD_CHUNK_MAX_BYTES = 2_000_000;

/**
 * Local / non-Vercel APIs are not bound by Hobby body caps. Keep a generous
 * but finite ceiling so a runaway export cannot exhaust memory.
 */
export const LOCAL_INLINE_TRANSFER_MAX_BYTES = 24_000_000;

/** Default page size for part-based export when staging is unavailable. */
export const EXPORT_TASKS_PAGE_SIZE = 300;

export function inlineExportMaxBytes(isVercelRuntime: boolean): number {
  return isVercelRuntime ? INLINE_TRANSFER_MAX_BYTES : LOCAL_INLINE_TRANSFER_MAX_BYTES;
}

export function isImportStagingPathname(pathname: string): boolean {
  return pathname.startsWith("focista-schedulo/imports/");
}

export function isExportStagingPathname(pathname: string): boolean {
  return pathname.startsWith("focista-schedulo/exports/");
}

export function transferChunkPathname(pathname: string, index: number): string {
  return `${pathname}__chunk__${index}`;
}

export function isTransferChunkPathname(pathname: string): boolean {
  return pathname.includes("__chunk__");
}

/** Assemble ordered binary chunks into a UTF-8 string (import JSON/CSV). */
export function assembleTransferChunks(chunks: Buffer[]): string {
  return Buffer.concat(chunks).toString("utf8");
}

export function parseChunkMeta(headers: {
  index?: string | null;
  total?: string | null;
}): { index: number; total: number } | null {
  const indexRaw = headers.index?.trim();
  const totalRaw = headers.total?.trim();
  if (indexRaw == null || totalRaw == null || indexRaw === "" || totalRaw === "") {
    return null;
  }
  const index = Number(indexRaw);
  const total = Number(totalRaw);
  if (!Number.isInteger(index) || !Number.isInteger(total)) return null;
  if (total < 1 || index < 0 || index >= total) return null;
  return { index, total };
}
