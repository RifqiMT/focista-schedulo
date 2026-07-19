/**
 * Large import/export staging via Neon `transfer_staging`.
 * Inline size caps still apply on Vercel Hobby HTTP body limits (~4.5MB).
 */

/** Stay under Vercel Hobby request/response body limits (~4.5MB). */
export const INLINE_TRANSFER_MAX_BYTES = 3_000_000;

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
