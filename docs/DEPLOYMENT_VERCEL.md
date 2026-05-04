# Production deployment — Vercel (frontend) + API host

**Last updated:** 2026-05-04  
**Owner:** Engineering

---

## 1) Architecture decision

Focista Schedulo is a **full-stack** product:

| Layer | Runtime needs |
| --- | --- |
| **Frontend** | Static SPA (ideal for **Vercel**). |
| **Backend** | Long-lived **Express** server, **filesystem JSON** persistence, **SSE** (`/api/events`), large import bodies. |

Vercel is optimized for static sites and short-lived serverless/edge functions. The current backend **requires a writable data directory** and a persistent process for SSE. Therefore:

- **Deploy the React app on Vercel.**
- **Deploy the Express API on a host that supports a Node server + persistent disk** (or migrate storage to a database/object store in a future phase).

This document describes the **recommended split**: Vercel + external API.

---

## 2) Frontend on Vercel

### Production URL (this project)

After a successful production deploy, Vercel assigns a stable **production alias** such as:

- `https://focista-schedulo.vercel.app`

Each deploy also receives a unique deployment URL (shown in the Vercel dashboard and CLI). Use the production alias for sharing and bookmarks.

**Important:** Keep `vercel.json` limited to the **Vite frontend build** only. Do not enable Vercel “multi-service” auto-detection for the Express app unless you have intentionally migrated the API to Vercel-compatible serverless or another supported runtime; a root `npm run build` that includes the backend TypeScript project can fail on CI if types or install layout differ from local machines.

### Repository layout

- Monorepo root: `focista-schedulo/`
- `vercel.json` at repo root configures install/build/output for the **frontend** workspace.

### Required environment variable (production build)

| Variable | Example | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `https://api.yourdomain.com` | Origin of the Express API **without** trailing slash. Injected at **build** time into the SPA. |

In the Vercel project:

1. **Settings → Environment Variables**
2. Add `VITE_API_BASE_URL` for **Production** (and Preview if you use a staging API).
3. Redeploy after changing this value (Vite bakes it into the client bundle).

If `VITE_API_BASE_URL` is **not** set, the client falls back to `window.location.origin` (correct for local dev with the Vite proxy, **incorrect** for a static-only Vercel deploy unless you add a separate reverse proxy).

### Vercel project settings

| Setting | Value |
| --- | --- |
| Root Directory | Repository root (`focista-schedulo` if the repo root is the monorepo) |
| Framework Preset | *Other* (build is driven by `vercel.json`) |
| Build Command | *(from `vercel.json`)* `npm run build --workspace focista-schedulo-frontend` |
| Output Directory | `frontend/dist` |
| Install Command | `npm install` |

### Custom domain

Add your apex or `www` domain under **Domains**. Point DNS as instructed by Vercel.

---

## 3) Backend API host (not Vercel)

Choose one pattern:

### Option A — PaaS with persistent disk (simplest migration)

Examples: **Railway**, **Render** (with disk), **Fly.io** (volume), **Google Cloud Run** (volume).

1. **Build:** `npm run build --workspace focista-schedulo-backend`
2. **Start:** `npm run start --workspace focista-schedulo-backend` (runs `node dist/index.js`)
3. **Working directory:** repo root or `backend/` with correct `DATA_DIR` (see below).
4. **Environment:** `PORT` provided by platform; ensure `backend/data/` exists and is on a **persistent** volume mounted at `backend/data`.

### Option B — VPS (Docker)

Use a single container with Node, copy `backend/dist` + `backend/package.json` + production `node_modules`, mount a volume at `/app/backend/data`.

### Data directory

The server resolves data under `backend/data/` (see `backend/src/index.ts`). For production:

- Mount persistent storage so `tasks.runtime.json`, `projects.runtime.json`, `profiles.runtime.json`, and optional `focista-unified-data.json` survive restarts.
- **Do not** rely on container ephemeral filesystem for production data.

### CORS

The backend uses open CORS today (`cors()`). For stricter production, restrict to your Vercel URL and custom domain via `ALLOWED_ORIGINS` (future hardening).

---

## 4) Connectivity checklist

- [ ] API HTTPS URL works (`GET /health` or equivalent).
- [ ] `VITE_API_BASE_URL` set on Vercel to that origin.
- [ ] Browser: no mixed content (both HTTPS).
- [ ] CORS allows the Vercel deployment URL (and preview URLs if needed).
- [ ] SSE: `EventSource` targets the same API origin via `apiUrl("/api/events")` — corporate proxies must allow SSE.

---

## 5) Build commands reference (local parity)

```bash
# From monorepo root
npm install
npm run build --workspace focista-schedulo-frontend
npm run build --workspace focista-schedulo-backend
```

---

## 6) Security notes

- Never commit API keys or tokens; use Vercel/host env vars only.
- Do not commit `backend/data/*.json` (already gitignored).
- Rotate any credentials that were ever pasted into chat or committed by mistake.

---

## 7) Future improvements (optional)

- Single-origin production via a reverse proxy (nginx) in front of API + static files.
- Replace file persistence with Postgres/S3 for multi-instance and serverless-friendly APIs.
- Tighten CORS to explicit allowlist.
