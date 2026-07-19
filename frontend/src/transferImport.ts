import { apiUrl } from "./apiClient";

/** Stay under Vercel Hobby request body limits (~4.5MB). */
const INLINE_IMPORT_MAX_BYTES = 3_000_000;

/**
 * Upload an import file via Neon transfer staging (bypasses serverless body limits),
 * then return the staged pathname for `/api/admin/import`.
 */
export async function uploadImportFileToStaging(file: File): Promise<string> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_") || "import.bin";
  const pathname = `focista-schedulo/imports/${Date.now()}-${safeName}`;
  const res = await fetch(apiUrl("/api/admin/transfer-upload"), {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Staging-Pathname": pathname
    },
    body: file
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = `Transfer upload failed (${res.status})`;
    try {
      const json = JSON.parse(text) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      if (text) message = text.slice(0, 240);
    }
    throw new Error(message);
  }
  const out = (await res.json().catch(() => null)) as { pathname?: string } | null;
  return out?.pathname || pathname;
}

export function shouldStageImport(file: File): boolean {
  // On Vercel same-origin deploys, prefer staging for anything that might approach platform limits.
  if (typeof window !== "undefined" && /\.vercel\.app$/i.test(window.location.hostname)) {
    return file.size > 512 * 1024;
  }
  return file.size > INLINE_IMPORT_MAX_BYTES;
}
