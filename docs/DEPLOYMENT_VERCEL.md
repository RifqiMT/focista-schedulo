# Production deployment on Vercel (full-stack guidance)

**Last updated:** 2026-04-30  
**Owner:** Engineering

---

## 1) What you are deploying

Focista Schedulo is a **split architecture** today:

| Layer | Technology | Role |
|---|---|---|
| UI | React + Vite (`frontend/`) | Browser SPA; talks to HTTP APIs |
| API | Express + TypeScript (`backend/`) | Validates input, applies business rules, persists JSON runtime files |

**Vercel is ideal for the static/Vite frontend.** The Express API is **not** a drop-in Vercel serverless app in this repository: it relies on a long-running Node process and **writable JSON files** under `backend/data/`. Vercel’s default serverless runtime does **not** provide durable, writable local disk the way this backend expects.

**Recommended production topology**

1. **Vercel:** host the built frontend (`frontend/dist`).
2. **A Node-capable host with persistent storage:** host the backend (examples: Fly.io volume, Render disk, Railway volume, a small VPS).  
3. **Environment wiring:** the browser calls the API using `VITE_API_BASE_URL` (see below).

This preserves **all features**, including **import** and **export**, because those flows are implemented in the API and/or orchestrated from the UI against the API.

---

## 2) “Local storage” in this product (current reality)

The app already uses the browser for **some** local persistence:

- **Active profile id** is stored in `localStorage` (`pst.activeProfileId` in `frontend/src/App.tsx`).
- **Import** reads a user-selected file in the browser, then posts content to `/api/admin/import`.
- **Export** requests a snapshot from `/api/admin/export-data` and downloads blobs in the browser.

**Important distinction**

- **Local-first UX** (files + browser storage for preferences) is already part of the experience.
- **Fully offline / no server** operation would require a large engineering effort: porting persistence, merge/dedupe, recurrence normalization, stats, and admin routes to a client-side store (for example **IndexedDB**) or bundling a different storage backend. That is **not** shipped in the current codebase.

If you need **100% browser-only** production (no hosted API), treat it as a **separate product milestone** and plan explicit work for a client-side repository layer.

---

## 3) Frontend: Vercel configuration

### Repository layout

Use the Vercel project **Root Directory**: `frontend/`.

### Build settings

- **Install command:** `npm install` (workspace installs can be handled at repo root; simplest is install in `frontend/` if you deploy only that folder)
- **Build command:** `npm run build`
- **Output directory:** `dist`

### SPA routing

`frontend/vercel.json` rewrites unknown paths to `index.html` so React Router (if used at root) and direct URL loads work.

### Required environment variable (production)

Set in Vercel → Project → Settings → Environment Variables (Production):

| Name | Example | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `https://api.yourdomain.com` | Absolute origin of the Express API **without** a trailing slash |

At build time, Vite inlines this value. The UI uses `frontend/src/apiClient.ts` so all `/api/...` calls resolve to your API host.

**Development note:** leave `VITE_API_BASE_URL` unset locally so `window.location.origin` is used and the Vite dev proxy (`vite.config.ts`) continues to forward `/api` to `localhost:4000`.

---

## 4) Backend: production host checklist

### Process

- Run `npm run build` then `npm run start` (or run `ts-node-dev` only in dev).
- Expose port `4000` (or set `PORT`).

### Persistence

- Ensure `backend/data/` is on a **persistent volume** (otherwise restarts wipe tasks/projects/profiles).
- Keep `focista-unified-data.json` behavior aligned with your operational policy (interchange/import/export workflows).

### CORS / browser security

The backend supports an optional strict origin:

| Name | Example | Purpose |
|---|---|---|
| `FRONTEND_ORIGIN` | `https://your-app.vercel.app` | Restrict CORS to your deployed UI origin |

If unset, the server remains open (`cors()` default) which is convenient for local dev but looser for production.

---

## 5) Operational limitations to plan for

| Topic | Guidance |
|---|---|
| **SSE** (`/api/events`) | Works when UI and API share an origin **or** when API supports CORS for EventSource from the UI origin. Cross-origin SSE can be sensitive to proxies; validate in staging. |
| **Large imports** | Backend sets a large JSON body limit for imports; still validate infra timeouts (reverse proxy / platform limits). |
| **Secrets** | Never commit tokens or `.env` files. Configure secrets in Vercel/host dashboards only. |

---

## 6) Verification checklist (staging)

- [ ] UI loads from Vercel domain
- [ ] API health responds from API domain
- [ ] Create/edit/complete/delete task works end-to-end
- [ ] Import JSON + CSV works
- [ ] Export JSON + CSV + Both works
- [ ] Progress panel (`/api/stats`) matches active profile scope
- [ ] Productivity insights (`/api/productivity-insights`) loads for the active profile

---

## 7) Roadmap: true offline / IndexedDB “local storage”

If the goal is **no hosted API** in production:

1. Introduce a `StorageAdapter` interface (remote REST vs local IndexedDB).
2. Port merge/dedupe/import/export semantics carefully (today centralized in `backend/src/index.ts`).
3. Add conflict resolution UX for multi-tab usage.
4. Add automated tests for parity between modes.

This is a substantial project; do not assume it is implied by deploying the UI to Vercel alone.
