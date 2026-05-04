# API Contracts

**Last updated:** 2026-05-04  
**Owner:** Engineering

Base local backend URL: `http://localhost:4000`

---

## Health

- `GET /health`

---

## Profiles

- `GET /api/profiles`
- `POST /api/profiles`
- `PUT /api/profiles/:id`
- `POST /api/profiles/:id/unlock`
- `DELETE /api/profiles/:id`

---

## Projects

- `GET /api/projects` (optional `profileId`)
- `POST /api/projects`
- `PUT /api/projects/:id`
- `DELETE /api/projects/:id`

---

## Tasks

- `GET /api/tasks` (supports profile/project/time scope and pagination controls)
- `POST /api/tasks`
- `PUT /api/tasks/:id`
- `PATCH /api/tasks/:id/complete`
- `DELETE /api/tasks/:id`
- `POST /api/tasks/batch-update`
- `POST /api/tasks/batch-delete`

---

## Progress and Insights

- `GET /api/stats`
- `GET /api/productivity-insights`
- `GET /api/events` (SSE version/event updates)

### `GET /api/stats`

- **Query:** optional `profileId` — omit or pass sentinel for all profiles (see backend `scopedDataForProfile`).
- **Caching:** response sets `Cache-Control: no-store`; server may use an in-memory stats cache keyed by scoped profile (invalidated around mutations).
- **Time basis:** “today”, streaks, and weekly buckets use the **server machine’s local calendar** (`toIsoLocal`), matching date pickers and progress UI in normal single-user local deployments.

**Weekly series (`last7Days`):** The response field **`last7Days`** is a legacy name. It is an array of **seven** objects for the **current calendar week Monday–Sunday** (local), ordered Monday → Sunday. Each element includes:

| Field | Type | Description |
|---|---|---|
| `date` | string | `YYYY-MM-DD` |
| `completed` | number | Task completions on that progress day |
| `points` | number | Sum of priority-based XP for those completions |
| `taskXpMin` | number \| null | Min per-task XP that day |
| `taskXpMax` | number \| null | Max per-task XP that day |
| `taskXpAvg` | number \| null | Average per-task XP that day |
| `weekdayTaskMin` | number | Historical min completions for this weekday (see `VARIABLES.md`) |
| `weekdayTaskMax` | number | Historical max for this weekday |
| `weekdayTaskAvg` | number | Historical average for this weekday |

Other top-level fields (illustrative, not exhaustive): `totalPoints`, `level`, `xpToNext`, `completedToday`, `streakDays`, `pointsByPriority`, milestone structures, `achievements`, badge-related data — refer to `backend/src/index.ts` and `VARIABLES.md` for full catalogs.

---

## Admin/Data Operations

- `POST /api/admin/reload-data`
- `POST /api/admin/save-data`
- `POST /api/admin/export-data`
- `POST /api/admin/sync-from-data`
- `POST /api/admin/import`

---

## Response/Performance Notes

- APIs include robust validation and structured error responses.
- Performance instrumentation includes server timing header:
  - `X-Server-Time-Ms`
- Runtime persistence is split-file based for operational actions.
- Read-only policy note: mutation endpoints return `403` for data under showcase profile `Test`.
- Password-protected profile deletion note: `DELETE /api/profiles/:id` validates supplied password before deletion.

