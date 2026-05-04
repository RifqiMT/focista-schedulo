/**
 * Resolves absolute URLs for REST and SSE calls.
 *
 * - **Local dev:** leave `VITE_API_BASE_URL` unset. Uses `window.location.origin`
 *   so Vite’s dev-server proxy (`/api` → backend) keeps working.
 * - **Production (e.g. Vercel):** set `VITE_API_BASE_URL` to your API origin, e.g.
 *   `https://api.yourdomain.com` (no trailing slash). The SPA and API may live on
 *   different hosts; CORS must allow the frontend origin on the backend.
 */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)
    ?.trim()
    .replace(/\/$/, "");
  if (base) return `${base}${normalized}`;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${normalized}`;
  }
  return normalized;
}
