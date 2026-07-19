# API Contracts

**Last updated:** 2026-07-19  
**Owner:** Engineering

Base local backend URL: `http://localhost:4000`

In production, the browser resolves the API origin via `frontend/src/apiClient.ts` (`VITE_API_BASE_URL` when split-hosted; same-origin `/api` when co-hosted).

---

## Conventions

- Mutation payloads are Zod-validated.
- Showcase profile `Test` mutations return **`403`** with a readable reason.
- Password-protected profile deletion requires verified password.
- Responses may include performance header **`X-Server-Time-Ms`**.
- Runtime persistence is **Neon rows** (Prod) or split JSON files (local `fs`) for `tasks` / `projects` / `profiles` — not a monolith primary write path.

---

## Health

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | `storage`, `ephemeralStorage`, `transferStaging`, `databaseUrlConfigured`, `setupHint`, and `neon.ok` + `neon.capabilities` (`write` / `import` / `export` / `transferStaging`) |
| `POST` | `/api/admin/storage-probe` | Verifies Neon migrate + write/delete probe row; `503` when Neon unset |

---

## Profiles

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/profiles` | List profiles |
| `GET` | `/api/profiles/task-counts` | Task counts by profile |
| `POST` | `/api/profiles` | Create profile |
| `PUT` | `/api/profiles/:id` | Update profile |
| `POST` | `/api/profiles/:id/unlock` | Verify unlock password |
| `DELETE` | `/api/profiles/:id` | Delete; password required when locked |

---

## Projects

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/projects` | Optional `profileId` filter |
| `POST` | `/api/projects` | Create project |
| `PUT` | `/api/projects/:id` | Update project |
| `DELETE` | `/api/projects/:id` | Delete project |

---

## Tasks

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/tasks` | Profile/project/time scope and pagination; on Neon/Vercel, may reload tasks if `tasks_revision` is newer |
| `POST` | `/api/tasks` | Create task (incl. recurrence materialization paths) |
| `PUT` | `/api/tasks/:id` | Update task |
| `PATCH` | `/api/tasks/:id/complete` | Toggle completion; **awaits** persist on Vercel; may `500` + rollback if save fails; freshness reload before mutate |
| `DELETE` | `/api/tasks/:id` | Delete task |
| `POST` | `/api/tasks/batch-update` | Bulk update / move |
| `POST` | `/api/tasks/batch-delete` | Bulk delete |

---

## Progress and Insights

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/stats` | Progress, XP, streaks, milestones, weekly series |
| `GET` | `/api/productivity-insights` | Historical productivity aggregates |
| `POST` | `/api/productivity-summary` | AI period summary (Groq; optional Tavily) |
| `POST` | `/api/productivity-summary/ask` | AI Q&A over profile-scoped tasks |
| `POST` | `/api/ai-keys/validate` | Live Groq/Tavily key validation (never logged) |
| `GET` | `/api/events` | SSE version/event updates |

### `POST /api/productivity-summary`

- **Body:** `{ profileId?, period, startDate?, endDate?, enrichWithWeb? }`
- **`period`:** `day` \| `week` \| `sprint` \| `month` \| `bimonth` \| `quarter` \| `semester` \| `year` \| `next_day` \| `next_week` \| `next_sprint` \| `next_month` \| `next_quarter` \| `next_semester` \| `next_year` \| `custom`
- **Custom:** requires `startDate` and `endDate` (`YYYY-MM-DD`, inclusive, start ≤ end).
- **Body (optional):** `groqApiKey`, `tavilyApiKey` — browser-local keys from **AI keys** header; preferred over server env when present. Never logged.
- **Secrets:** client keys or `GROQ_API_KEY` required; `TAVILY_API_KEY` / client Tavily optional for web enrich.
- **Response:** `{ ok, summary, range, stats, sources, model, enriched, degraded? }`
- **`degraded: true`:** local digest brief returned because Groq failed (rate limit / outage); still `200`.
- **Errors:** `400` invalid range; `503` missing Groq key; rare `502`/`500` only if the request fails before a local brief can be built.

### `POST /api/ai-keys/validate`

- **Body:** `{ provider: "groq" | "tavily", apiKey }` (`apiKey` max 512 chars).
- **Behavior:** format check, then a lightweight live provider request. Keys are never logged or stored.
- **Response:** `{ ok, provider, valid, reason? }`
- Rate-limit responses from the provider may return `valid: true` with an explanatory `reason`.

### `POST /api/productivity-summary/ask`

- **Body:** `{ profileId?, question, period?, startDate?, endDate?, enrichWithWeb? }`
- **`question`:** 1–2000 characters.
- **Default scope:** current sprint window when `period` omitted.
- **Web enrich:** only when `enrichWithWeb: true`.
- **Response:** `{ ok, answer, range, stats, sources, model, enriched, degraded? }`
- **`degraded: true`:** local digest answer when Groq is unavailable.

### `GET /api/stats`

- **Query:** optional `profileId` — omit or pass sentinel for all profiles (see backend `scopedDataForProfile`).
- **Caching:** `Cache-Control: no-store`; server may use an in-memory stats cache keyed by scoped profile (invalidated around mutations).
- **Time basis:** “today”, streaks, and weekly buckets use the **server machine’s local calendar** (`toIsoLocal`).

**Weekly series (`last7Days`):** The response field **`last7Days`** is a legacy name. It is an array of **seven** objects for the **current calendar week Monday–Sunday** (local), ordered Monday → Sunday. Each element includes:

| Field | Type | Description |
|---|---|---|
| `date` | string | `YYYY-MM-DD` |
| `completed` | number | Task completions on that progress day |
| `points` | number | Sum of priority-based XP for those completions |
| `taskXpMin` | number \| null | Min per-task XP that day |
| `taskXpMax` | number \| null | Max per-task XP that day |
| `taskXpAvg` | number \| null | Average per-task XP that day |
| `weekdayTaskMin` | number | Historical min completions for this weekday |
| `weekdayTaskMax` | number | Historical max for this weekday |
| `weekdayTaskAvg` | number | Historical average for this weekday |

Other top-level fields (illustrative): `totalPoints`, `level`, `xpToNext`, `completedToday`, `streakDays`, `pointsByPriority`, milestone structures, achievements, grinding blocks — see `VARIABLES.md` and `backend/src/index.ts`.

**Priority XP weights:** `low=1`, `medium=2`, `high=3`, `urgent=4`.

**Level formula:** `level = 1 + floor(totalPoints / 50)`; `xpToNext` as documented in `VARIABLES.md`.

**Achievements:** each item includes `id`, `name`, `description` (plain English), `progress`, `goal`, `achieved`. Canonical descriptions are listed in `VARIABLES.md`.

**Milestones:** blocks such as `streakDays`, `tasksCompleted`, `xpGained`, `levelsUp`, and badges-earned include `description` (plain English) plus progress fields. Example badges-earned: `"Rewards for collecting badges themselves (every 5 badges)."`.

---

## Admin / Data Operations

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/admin/reload-data` | Reload runtime from storage (used for quiet tab-return refresh) |
| `POST` | `/api/admin/save-data` | Persist in-memory state to storage |
| `POST` | `/api/admin/sync-from-data` | Sync from interchange/data sources |
| `POST` | `/api/admin/transfer-upload` | Chunked binary upload into Neon `transfer_staging` (headers: `X-Staging-Pathname`, `X-Chunk-Index`, `X-Chunk-Total`; ≤2MB/chunk) |
| `GET` | `/api/admin/export-download` | Download a previously staged export payload from Neon |
| `POST` | `/api/admin/export-data` | Export JSON snapshot; may return inline, staging download, or parts manifest |
| `POST` | `/api/admin/export-tasks-page` | Page of export tasks (used when `delivery: "parts"`) |
| `POST` | `/api/admin/import` | Import JSON/CSV; body must include exactly one of `content` or `stagingPathname` |

### Import body shape (conceptual)

```json
{
  "format": "json",
  "content": "... optional inline ...",
  "stagingPathname": "focista-schedulo/imports/... optional staged ..."
}
```

Validation rule: **exactly one** of `content` or `stagingPathname`.

Import parsing validates **per row** (with soft coercion for common quirks such as missing `labels`, string `link`, `durationMinutes: 0`). Invalid rows are skipped and reported in `droppedRows`; a single bad row must not discard the rest of that entity array.

### Export delivery

`POST /api/admin/export-data` returns one of:

- **`inline`** — full `{ profiles, projects, tasks }` in the JSON body (local Dev allows up to ~24MB; Vercel ~3MB).
- **`staging`** — staged in Neon `transfer_staging` with a short-lived download URL (requires `DATABASE_URL` / Neon storage).
- **`parts`** — profiles/projects inline; client pages tasks via `POST /api/admin/export-tasks-page` (no staging required).

Neon staging is preferred when available; if staging fails or Neon is unset, export falls back to inline or parts instead of hard-failing with `413`.

### Client automation note

The UI no longer exposes manual Sync/Save header buttons. After import, the client runs **`autoSyncAndSave`** (sync-from-data then save-data). Admin endpoints remain available for programmatic/ops use.

---

## Response / Performance Notes

- Prefer batch task endpoints for multi-item operations.
- Neon persistence uses moderate write debounce on long-running hosts; on **Vercel**, Neon debounce is **`0`** and completion must await flush.
- SSE (`/api/events`) requires compatible CORS/origin configuration in split hosting.

---

## Related Documents

- Variables: `VARIABLES.md`
- Architecture: `ARCHITECTURE.md`
- Deployment: `DEPLOYMENT_VERCEL.md`
- Crosswalk: `DOCS_CODE_CROSSWALK.md`
