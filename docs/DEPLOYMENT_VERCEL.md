# Production deployment on Vercel (full-stack guidance)

**Last updated:** 2026-07-22  
**Owner:** Engineering

---

## 1) What you are deploying

Focista Schedulo is a **split architecture**:

| Layer | Technology | Role |
|---|---|---|
| UI | React + Vite (`frontend/`) | Browser SPA; talks to HTTP APIs |
| API | Express + TypeScript (`backend/`) | Validates input, applies business rules, persists runtime entities |
| Storage (Prod) | **Neon Postgres Free** | Durable row store (`STORAGE_BACKEND=neon`); no Redis, no MongoDB |
| Storage (Dev) | Local disk `backend/data/` | Split JSON runtime files; hot-reload via `fs.watch` |

**Vercel hosts the static/Vite frontend** (and optionally the API via Vercel Services). Persistence in production uses **Neon** so the API host does **not** need a persistent disk volume.

**Recommended production topology**

1. **Vercel Services (same project / same domain):** Vite frontend + Express backend routed via `vercel.json` `services` + rewrites.
2. **Neon Free:** durable store (`STORAGE_BACKEND=neon` + `DATABASE_URL` pooled).
3. **Same-origin API:** leave `VITE_API_BASE_URL` unset so the SPA calls `/api` on the Vercel host.

```mermaid
flowchart LR
  Browser[Browser]
  Vercel[Vercel Services<br/>focista-schedulo.vercel.app]
  Neon[(Neon Postgres Free)]

  Browser --> Vercel
  Vercel -->|row upserts / SELECT| Neon
  Vercel -->|transfer_staging| Neon
```

Alternative **split hosting** (UI on Vercel, API elsewhere) still works: set `REQUIRE_VITE_API_BASE_URL=1` and `VITE_API_BASE_URL`, plus `FRONTEND_ORIGIN` on the API host.
---

## 2) “Local storage” in this product (current reality)

The app already uses the browser for **some** local persistence:

- **Active profile id** is stored in `localStorage` (`pst.activeProfileId` in `frontend/src/App.tsx`).
- **Import** reads a user-selected file in the browser, then posts content (or a Neon staging pathname) to `/api/admin/import`.
- **Export** requests a snapshot from `/api/admin/export-data` and downloads files in the browser.

**Important distinction**

- **Local-first UX** (files + browser storage for preferences) is already part of the experience.
- **Fully offline / no server** operation would require a large engineering effort (IndexedDB adapter). That is **not** shipped in the current codebase.

---

## 3) Frontend: Vercel configuration

### Repository layout

Use the Vercel project **Root Directory**: `frontend/`.

### Build settings

Configured in `frontend/vercel.json`:

- **Framework:** Vite
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **SPA rewrites:** unknown paths → `index.html`

### Required environment variable (Production)

Set in Vercel → Project → Settings → Environment Variables (**Production**):

| Name | Example | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `https://api.yourdomain.com` | Absolute origin of the Express API **without** a trailing slash |

At build time, Vite inlines this value. Production builds on Vercel **fail** if `VITE_API_BASE_URL` is missing or not an absolute URL (`frontend/vite.config.ts`).

**Development note:** leave `VITE_API_BASE_URL` unset locally so `window.location.origin` is used and the Vite dev proxy (`vite.config.ts`) continues to forward `/api` to `localhost:4000`.

**Same-origin Services note:** when UI and API share the Vercel host, leave `VITE_API_BASE_URL` unset so the SPA calls `/api` relative to the deployment origin.

---

## 4) Backend: production host checklist

### Process

- Run `npm run build` then `npm run start` (or run `ts-node-dev` only in dev).
- Expose port `4000` (or set `PORT`).
- Set `NODE_ENV=production` or `FOCISTA_ENV=production`.

### Persistence (Neon Postgres Free — no Redis / no MongoDB)

**Required for Vercel Prod:** without a Neon URL the API falls back to ephemeral `/tmp` `fs`, so writes/import/export do not survive cold starts.

1. Neon dashboard → create Free project → copy **pooled** connection string.  
2. Link to Vercel (from repo root):

```bash
DATABASE_URL='postgresql://USER:PASS@ep-….pooler….neon.tech/neondb?sslmode=require' npm run neon:link
```

Or set manually in Vercel → **Settings → Environment Variables** (backend / Production):  
   - `DATABASE_URL` = pooled URL (also accepts `POSTGRES_URL` from the Neon Vercel integration)  
   - `STORAGE_BACKEND` = `neon` (optional if `DATABASE_URL` is set)  
3. Redeploy. Verify:

```bash
curl -s https://focista-schedulo.vercel.app/health | jq .
# expect: storage=neon, neon.ok=true, ephemeralStorage=false
curl -s -X POST https://focista-schedulo.vercel.app/api/admin/storage-probe | jq .
# expect: ok=true, write/import/export/transferStaging true
```

Create a **Neon Free** project (region near your Vercel deployment). Use the **pooled** connection string on the API host.

| Name | Example | Purpose |
|---|---|---|
| `STORAGE_BACKEND` | `neon` | Force Neon persistence (recommended in Prod) |
| `DATABASE_URL` | `postgresql://…@ep-….neon.tech/neondb?sslmode=require` | **Pooled** Neon URL (`-pooler` host preferred) |
| `DATABASE_URL_UNPOOLED` | `postgresql://…@ep-….neon.tech/neondb?sslmode=require` | Optional; migrations / admin only |
| `NEON_FRESHNESS_TTL_MS` | `2000` | Cooldown between revision peeks |
| `NEON_TRANSFER_TTL_HOURS` | `2` | Staging row expiry |
| `NEON_STATEMENT_TIMEOUT_MS` | `15000` | Fail fast under cold/load |

Schema is applied from `backend/src/storage/migrations/001_neon_core.sql` (profiles, projects, tasks, `runtime_meta`, `transfer_staging`).

Local `fs` remains the default when `DATABASE_URL` is absent (`STORAGE_BACKEND=fs` or unset/`auto`).

### Neon Free operator checklist

1. Create Neon project (region near Vercel).
2. Enable **pooled** connection; copy `DATABASE_URL` onto the API / Vercel Services env.
3. Leave **scale-to-zero** on (Free cannot disable).
4. Do **not** configure external pingers / cron keep-alive (burns CU-hours).
5. Autoscaling max ≤ 2 CU (Free cap).
6. Single primary branch for Prod; avoid extra long-lived branches.
7. Run migrations once (unpooled URL optional) if you prefer an explicit migrate step; otherwise first Neon storage use can ensure schema.

**Free-tier / serverless note:** On **Vercel**, Neon `persistDebounceMs` is **`0`** and completion toggles **await** flush before the response (timers are frozen after respond). Prefer batched UI mutations; avoid tight write loops. Expect cold-start latency after idle (~5 min scale-to-zero).

### Multi-isolate memory

When the API runs as multiple Vercel serverless isolates against one Neon database, each isolate tracks `tasks_revision` and reloads memory if another isolate wrote newer tasks—see `ARCHITECTURE.md` (`ensureTasksMemoryFresh`).

### CORS / browser security

| Name | Example | Purpose |
|---|---|---|
| `FRONTEND_ORIGIN` | `https://your-app.vercel.app` | Restrict CORS to your deployed UI origin |

**Required in production** (`NODE_ENV=production` or `FOCISTA_ENV=production`). If unset in production, the API process exits on startup.

### Productivity Summary (optional AI)

| Name | Example | Purpose |
|---|---|---|
| `GROQ_API_KEY` | `gsk_…` | Required for AI Summary / Ask routes |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Optional model override |
| `TAVILY_API_KEY` | `tvly-…` | Optional web enrich for tips / Ask |

These are **API-host secrets only** — never set `VITE_` prefixes for LLM keys.

---

## 5) Operational limitations to plan for

| Topic | Guidance |
|---|---|
| **SSE** (`/api/events`) | Works when UI and API share an origin **or** when API CORS allows the UI origin. Validate cross-origin EventSource from the Vercel domain. |
| **Large imports / exports** | Vercel Hobby caps serverless bodies (~4.5MB). Large **imports** use **client-side batched** `POST /api/admin/import-merge` (no multi-MB body). Optional Neon `transfer_staging` chunked upload remains available. Large **exports** prefer staging download or **parts** paging. |
| **Neon required for durable Prod** | Set **`DATABASE_URL`** (pooled) on the **backend** Vercel service. `/health` reports `storage`, `transferStaging`, `databaseUrlConfigured`, and `setupHint`. |
| **Neon Free compute** | 100 CU-hours / month; no keep-alive. Cold start after idle is expected. |
| **Neon Free storage** | 0.5 GB / project; prune staging; avoid duplicate full dumps. |
| **Hot reload** | `fs.watch` is **disabled** on Neon; use admin reload/sync or process restart after external DB edits. |
| **Secrets** | Never commit connection strings or `.env` files. Configure secrets in Vercel/API host dashboards only. |

---

## 6) Verification checklist (staging / Prod)

- [ ] UI loads from Vercel domain
- [ ] API `/health` reports `"storage":"neon"`
- [ ] Create/edit/complete/delete task works end-to-end
- [ ] Task complete survives refresh/reload on Vercel (no snap-back); failed persist shows friendly toast
- [ ] Import JSON + CSV works; post-import auto sync/save completes (no Sync/Save header buttons)
- [ ] Export JSON + CSV + Both works
- [ ] Large import via Neon staging (`stagingPathname`) works when payload exceeds inline limits
- [ ] Large export returns a usable staging download when applicable (else parts paging)
- [ ] `413` friendly messaging appears if transfer staging is misconfigured for oversized payloads
- [ ] Boot shows staged profile loading progress; profiles can load before large tasks working set
- [ ] Progress panel (`/api/stats`) matches active profile scope (calendar-week chart)
- [ ] Productivity insights (`/api/productivity-insights`) loads for the active profile
- [ ] Productivity Summary opens from Tasks toolbar; returns 503-friendly UI when `GROQ_API_KEY` unset; succeeds when configured
- [ ] SSE / Progress panel live updates work from the Vercel origin
- [ ] Neon tables populated (`tasks`, `projects`, `profiles`, `runtime_meta`); staging rows expire
- [ ] `FRONTEND_ORIGIN` set; `VITE_API_BASE_URL` set if split-hosted Production
- [ ] `DATABASE_URL` (pooled) set
- [ ] Optional: `GROQ_API_KEY` (+ `TAVILY_API_KEY`) configured for AI Summary in the API environment

---

## 7) Roadmap: true offline / IndexedDB “local storage”

If the goal is **no hosted API** in production:

1. Introduce a `StorageAdapter` interface (remote REST vs local IndexedDB).
2. Port merge/dedupe/import/export semantics carefully (today centralized in `backend/src/index.ts`).
3. Add conflict resolution UX for multi-tab usage.
4. Add automated tests for parity between modes.

This is a substantial project; do not assume it is implied by deploying the UI to Vercel alone.
