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
  if (status === 413) return "The uploaded data is too large. Please split it into smaller files.";
  if (status === 422) return "The data format is invalid. Please verify the file structure and values.";
  if (status === 429) return "Too many requests. Please wait a moment, then try again.";
  if (status >= 500) return "Server issue detected. Please try again in a moment.";
  return `Request failed (${status}). Please try again.`;
}

export async function getFriendlyErrorMessage(res: Response): Promise<string> {
  const jsonPayload = await res.json().catch(() => null);
  const directError = jsonPayload && typeof jsonPayload === "object" ? (jsonPayload as any).error : null;
  const nestedMessage =
    jsonPayload && typeof jsonPayload === "object" ? (jsonPayload as any).message : null;

  if (isMeaningfulMessage(directError)) return directError.trim();
  if (isMeaningfulMessage(nestedMessage)) return nestedMessage.trim();

  return fallbackByStatus(res.status);
}
