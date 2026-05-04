/**
 * API base URL for production split-hosting (e.g. UI on Vercel, API on Render/Fly).
 *
 * - Dev: leave unset — requests use `window.location.origin` so Vite's `/api` proxy works.
 * - Prod: set `VITE_API_BASE_URL` to your backend origin (no trailing slash), e.g. `https://api.example.com`
 */
const configuredBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/$/, "");

export function getApiOrigin(): string {
  if (configuredBase) return configuredBase;
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "";
}

/** Absolute URL for an API path (must start with `/api/...`). */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const origin = getApiOrigin();
  return origin ? `${origin}${normalized}` : normalized;
}

export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const url = input.startsWith("/api/") ? apiUrl(input) : input;
  return fetch(url, init);
}
