import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

function assertProductionApiBaseUrl(): void {
  // Same-origin Vercel full-stack deploys leave VITE_API_BASE_URL unset (apiClient uses window.origin).
  // Set REQUIRE_VITE_API_BASE_URL=1 only for split hosting (UI on Vercel, API elsewhere).
  if (process.env.VERCEL_ENV !== "production") return;
  if (process.env.REQUIRE_VITE_API_BASE_URL !== "1") return;
  const apiBase = process.env.VITE_API_BASE_URL?.trim();
  if (!apiBase) {
    throw new Error(
      "VITE_API_BASE_URL is required for split-host Vercel production builds " +
        "(absolute API origin, no trailing slash). Or unset REQUIRE_VITE_API_BASE_URL for same-origin."
    );
  }
  if (!/^https?:\/\//i.test(apiBase)) {
    throw new Error(
      `VITE_API_BASE_URL must be an absolute http(s) URL (received: "${apiBase}").`
    );
  }
}

assertProductionApiBaseUrl();

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true
      }
    }
  }
});
