const GENERIC_ERROR_PATTERNS = [/^request failed/i, /^network error/i, /^\[object object\]$/i];

function isMeaningfulMessage(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const text = input.trim();
  if (!text) return false;
  return !GENERIC_ERROR_PATTERNS.some((rx) => rx.test(text));
}

function fallbackByStatus(status: number): string {
  if (status === 400) return "Some input is invalid. Please check the required fields and try again.";
  if (status === 401) return "Verification failed. Please re-check your password or credentials.";
  if (status === 403) return "This action is not allowed for your current profile or role.";
  if (status === 404) return "The requested item was not found. It may have been removed already.";
  if (status === 409) return "This action conflicts with existing data. Please refresh and retry.";
  if (status === 413)
    return "This file is too large for a single API request. On Vercel, imports use chunked Neon staging automatically—retry after redeploying the latest build. Large exports use staging or pages.";
  if (status === 422) return "The data format is invalid. Please verify the file structure and values.";
  if (status === 429) return "Too many requests. Please wait a moment, then try again.";
  if (status === 503) return "The workspace is still warming up. Please wait a moment and try again.";
  if (status >= 500) return "Server issue detected. Please try again in a moment.";
  return `Request failed (${status}). Please try again.`;
}

function messageFromPayloadText(text: string): string | null {
  if (/FUNCTION_PAYLOAD_TOO_LARGE|Request Entity Too Large/i.test(text)) {
    return "This upload exceeds Vercel’s request size limit. Retry import after deploying chunked Neon staging (≤2MB chunks).";
  }
  return null;
}

export async function getFriendlyErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  const platform = messageFromPayloadText(text);
  if (platform) return platform;

  let jsonPayload: unknown = null;
  try {
    jsonPayload = text ? JSON.parse(text) : null;
  } catch {
    jsonPayload = null;
  }
  const directError =
    jsonPayload && typeof jsonPayload === "object" ? (jsonPayload as any).error : null;
  const nestedMessage =
    jsonPayload && typeof jsonPayload === "object" ? (jsonPayload as any).message : null;

  if (isMeaningfulMessage(directError)) return directError.trim();
  if (isMeaningfulMessage(nestedMessage)) return nestedMessage.trim();
  if (text.trim() && !text.trim().startsWith("<")) {
    const cleaned = text.replace(/\s+/g, " ").trim().slice(0, 240);
    if (isMeaningfulMessage(cleaned)) return cleaned;
  }

  return fallbackByStatus(res.status);
}
