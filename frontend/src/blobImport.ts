import { upload } from "@vercel/blob/client";
import { apiUrl } from "./apiClient";

/** Stay under Vercel Hobby request body limits (~4.5MB). */
const INLINE_IMPORT_MAX_BYTES = 3_000_000;

/**
 * Upload an import file via Vercel Blob client upload (bypasses serverless body limits),
 * then return the staged pathname for `/api/admin/import`.
 */
export async function uploadImportFileToBlob(file: File): Promise<string> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_") || "import.bin";
  const blob = await upload(`focista-schedulo/imports/${safeName}`, file, {
    access: "private",
    handleUploadUrl: apiUrl("/api/admin/blob-upload"),
    multipart: file.size > 4 * 1024 * 1024,
    contentType: file.type || "application/octet-stream"
  });
  return blob.pathname;
}

export function shouldStageImportViaBlob(file: File): boolean {
  // On Vercel same-origin deploys, prefer Blob for anything that might approach platform limits.
  if (typeof window !== "undefined" && /\.vercel\.app$/i.test(window.location.hostname)) {
    return file.size > 512 * 1024;
  }
  return file.size > INLINE_IMPORT_MAX_BYTES;
}
