# API Contracts

**Last updated:** 2026-07-18  
**Owner:** Engineering

Base local backend URL: `http://localhost:4000`

In production, the browser resolves the API origin via `frontend/src/apiClient.ts` (`VITE_API_BASE_URL` when split-hosted; same-origin `/api` when co-hosted).

---

## Conventions

- Mutation payloads are Zod-validated.
- Showcase profile `Test` mutations return **`403`** with a readable reason.
- Password-protected profile deletion requires verified password.
- Responses may include performance header **`X-Server-Time-Ms`**.
- Runtime persistence is split-object based (`tasks` / `projects` / `profiles`), not monolith-primary.

---

## Health

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | Includes storage kind (e.g. `"storage":"vercel-blob"` or `"fs"`) |

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
| `GET` | `/api/tasks` | Profile/project/time scope and pagination controls |
| `POST` | `/api/tasks` | Create task (incl. recurrence materialization paths) |
| `PUT` | `/api/tasks/:id` | Update task |
| `PATCH` | `/api/tasks/:id/complete` | Toggle completion |
| `DELETE` | `/api/tasks/:id` | Delete task |
| `POST` | `/api/tasks/batch-update` | Bulk update / move |
| `POST` | `/api/tasks/batch-delete` | Bulk delete |

---

## Progress and Insights

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/stats` | Progress, XP, streaks, milestones, weekly series |
| `GET` | `/api/productivity-insights` | Historical productivity aggregates |
| `GET` | `/api/events` | SSE version/event updates |

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

---

## Admin / Data Operations

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/admin/reload-data` | Reload runtime from storage (used for quiet tab-return refresh) |
| `POST` | `/api/admin/save-data` | Persist in-memory state to storage |
| `POST` | `/api/admin/sync-from-data` | Sync from interchange/data sources |
| `POST` | `/api/admin/blob-upload` | Client upload handoff for large transfers |
| `POST` | `/api/admin/export-data` | Export JSON/CSV/Both; may return presigned Blob URL for large payloads |
| `POST` | `/api/admin/import` | Import JSON/CSV; body must include exactly one of `content` or `blobPathname` |

### Import body shape (conceptual)

```json
{
  "format": "json",
  "content": "... optional inline ...",
  "blobPathname": "focista-schedulo/imports/... optional staged ..."
}
```

Validation rule: **exactly one** of `content` or `blobPathname`.

### Export / transfer errors

- If payload exceeds inline limits and Blob transfer is unavailable → **`413`** with actionable message.
- Frontend maps `413` via `friendlyError.ts`.

### Client automation note

The UI no longer exposes manual Sync/Save header buttons. After import, the client runs **`autoSyncAndSave`** (sync-from-data then save-data). Admin endpoints remain available for programmatic/ops use.

---

## Response / Performance Notes

- Prefer batch task endpoints for multi-item operations.
- Blob persistence uses longer write debounce than local `fs`.
- SSE (`/api/events`) requires compatible CORS/origin configuration in split hosting.

---

## Related Documents

- Variables: `VARIABLES.md`
- Architecture: `ARCHITECTURE.md`
- Deployment: `DEPLOYMENT_VERCEL.md`
- Crosswalk: `DOCS_CODE_CROSSWALK.md`
