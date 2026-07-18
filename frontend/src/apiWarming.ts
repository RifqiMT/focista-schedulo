import { apiFetch } from "./apiClient";

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Fetch with retries while the Vercel backend warms the large tasks blob (HTTP 503 + warming).
 */
export async function apiFetchWarming(
  input: string,
  init?: RequestInit,
  opts?: { retries?: number; delayMs?: number }
): Promise<Response> {
  const retries = opts?.retries ?? 12;
  const delayMs = opts?.delayMs ?? 2500;
  let last: Response | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await apiFetch(input, init);
    last = res;
    if (res.status !== 503) return res;
    let warming = false;
    try {
      const body = (await res.clone().json()) as { warming?: boolean };
      warming = Boolean(body?.warming);
    } catch {
      warming = false;
    }
    if (!warming || attempt === retries) return res;
    await sleep(delayMs);
  }
  return last!;
}
