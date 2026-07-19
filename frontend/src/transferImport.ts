import { apiUrl } from "./apiClient";

/** Stay under Vercel Hobby request body limits (~4.5MB). */
const INLINE_IMPORT_MAX_BYTES = 3_000_000;

/** Must stay under Vercel FUNCTION_PAYLOAD_TOO_LARGE (~4.5MB). */
const TRANSFER_CHUNK_BYTES = 2_000_000;

function isVercelHost(): boolean {
  return typeof window !== "undefined" && /\.vercel\.app$/i.test(window.location.hostname);
}

async function readUploadError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (/FUNCTION_PAYLOAD_TOO_LARGE|Request Entity Too Large|payload too large/i.test(text)) {
    return "Import is too large for a single Vercel request. The app will retry with smaller chunks—if this persists, redeploy the latest build with chunked Neon staging.";
  }
  try {
    const json = JSON.parse(text) as { error?: string; message?: string };
    if (json.error) return json.error;
    if (json.message) return json.message;
  } catch {
    // ignore
  }
  if (text.trim()) return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
  return `Transfer upload failed (${res.status})`;
}

async function postTransferChunk(opts: {
  pathname: string;
  chunk: Blob;
  index: number;
  total: number;
}): Promise<void> {
  const res = await fetch(apiUrl("/api/admin/transfer-upload"), {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Staging-Pathname": opts.pathname,
      "X-Chunk-Index": String(opts.index),
      "X-Chunk-Total": String(opts.total)
    },
    body: opts.chunk
  });
  if (!res.ok) {
    throw new Error(await readUploadError(res));
  }
  const out = (await res.json().catch(() => null)) as { complete?: boolean } | null;
  const isLast = opts.index === opts.total - 1;
  if (isLast && out && out.complete === false) {
    throw new Error("Transfer staging did not finalize the last chunk.");
  }
}

/**
 * Upload an import file via Neon transfer staging in ≤2MB chunks
 * (avoids Vercel Hobby FUNCTION_PAYLOAD_TOO_LARGE), then return pathname for import.
 */
export async function uploadImportFileToStaging(file: File): Promise<string> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_") || "import.bin";
  const pathname = `focista-schedulo/imports/${Date.now()}-${safeName}`;
  const total = Math.max(1, Math.ceil(file.size / TRANSFER_CHUNK_BYTES));

  for (let index = 0; index < total; index += 1) {
    const start = index * TRANSFER_CHUNK_BYTES;
    const end = Math.min(file.size, start + TRANSFER_CHUNK_BYTES);
    const chunk = file.slice(start, end);
    await postTransferChunk({ pathname, chunk, index, total });
  }

  return pathname;
}

export function shouldStageImport(file: File): boolean {
  // On Vercel, stage early — never POST multi-MB bodies inline to serverless.
  if (isVercelHost()) {
    return file.size > 256 * 1024;
  }
  return file.size > INLINE_IMPORT_MAX_BYTES;
}

/** @deprecated Use uploadImportFileToStaging */
export const uploadImportFileToBlob = uploadImportFileToStaging;
/** @deprecated Use shouldStageImport */
export const shouldStageImportViaBlob = shouldStageImport;
