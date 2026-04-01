# API Contracts — Focista Schedulo

**Last updated:** 2026-04-01  
**Owner:** Engineering  
**Base URL (development):** `http://localhost:4000` (frontend dev server proxies `/api` from port `5173`)

This document summarizes REST endpoints, request and response shapes, and validation rules. Canonical schemas are implemented with **Zod** in `backend/src/index.ts`.

---

## Conventions

- **Content-Type:** `application/json` for bodies; JSON responses unless noted.
- **Errors:** `4xx` / `5xx` with JSON `{ ok?: boolean, error?: string }` where applicable; some deletes return `204 No Content`.
- **Caching:** `GET /api/stats` and `GET /api/productivity-insights` use in-memory caches. Caches are cleared **before** awaited file writes in `persistTasks` / `persistProjects`, and again at the **end** of `loadData()`, so responses never lag behind in-memory task state after mutations or disk reload.

---

## Health

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/health` | `{ status: "ok", service: "focista-schedulo-backend" }` |

---

## Projects

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/api/projects` | — | `Project[]` |
| `POST` | `/api/projects` | `{ name: string }` | Created `Project` |
| `PUT` | `/api/projects/:id` | `{ name: string }` | Updated `Project` |
| `DELETE` | `/api/projects/:id` | — | `204`; deletes project and all tasks with `projectId` |

### Project schema

| Field | Type | Notes |
|-------|------|--------|
| `id` | `string` | Normalized to `P1`, `P2`, … on load and create |
| `name` | `string` | Min length 1 |

---

## Tasks

| Method | Path | Query / Body | Response |
|--------|------|--------------|----------|
| `GET` | `/api/tasks` | `?projectId=<id>` optional | `Task[]` |
| `POST` | `/api/tasks` | Task payload (see schema) | Created `Task` |
| `PUT` | `/api/tasks/:id` | Partial/full task | Updated `Task` |
| `PATCH` | `/api/tasks/:id/complete` | — | Toggles `completed`; may materialize recurring instances |
| `DELETE` | `/api/tasks/:id` | — | `204` or cancellation for series rules |

### Task schema (summary)

| Field | Type | Notes |
|-------|------|--------|
| `id` | `string` | Required |
| `title` | `string` | Min length 1 |
| `description` | `string` | Optional |
| `priority` | `"low" \| "medium" \| "high" \| "urgent"` | |
| `dueDate` | `string` | Optional ISO date `YYYY-MM-DD` |
| `dueTime` | `string` | Optional `HH:mm` |
| `durationMinutes` | `number` | Optional positive integer |
| `deadlineDate` / `deadlineTime` | `string` | Optional |
| `repeat` | enum | `none`, `daily`, `weekly`, `weekdays`, `weekends`, `monthly`, `quarterly`, `yearly`, `custom` |
| `repeatEvery` / `repeatUnit` | `number` / enum | For `custom` |
| `labels` | `string[]` | |
| `location` | `string` | Optional |
| `link` | `string[]` | Optional list of URLs |
| `reminderMinutesBefore` | `number` | Optional non-negative |
| `projectId` | `string \| null` | |
| `completed` | `boolean` | |
| `completedAt` | `string` | Optional ISO datetime |
| `parentId` / `childId` | `string` | Optional series identity |
| `cancelled` | `boolean` | Optional |

Full validation: `TaskSchema` in `backend/src/index.ts`.

### Data integrity invariant (project association)

- Tasks that share the same `parentId` (series identity) are enforced to share the same `projectId`.
- This prevents parent/child/occurrence records from drifting into different projects and keeps project-scoped filters consistent.

---

## Stats (gamification)

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/stats` | See below |

### Response shape (`GET /api/stats`)

| Field | Type | Description |
|-------|------|-------------|
| `completedToday` | `number` | Completed tasks whose **progress day** is local today (local day from `completedAt` when available; otherwise fallback to `dueDate` for legacy records) |
| `streakDays` | `number` | Consecutive days ending today with ≥1 task counting on that day (same progress-day rule) |
| `level` | `number` | `1 + floor(totalPoints / 50)` |
| `pointsToday` | `number` | Sum of priority points for tasks whose progress day is today |
| `totalPoints` | `number` | Lifetime sum of priority points |
| `xpToNext` | `number` | Points until next level boundary |
| `last7Days` | `{ date, completed, points }[]` | Rolling seven-day series |
| `pointsByPriority` | `{ low, medium, high, urgent }` | Lifetime points by priority weight |
| `achievements` | `{ id, name, description, progress, goal, achieved }[]` | Challenge-style achievements |
| `milestoneAchievements` | object | `streakDays`, `tasksCompleted`, `xpGained`, `levelsUp` blocks with milestones and progress |

**Priority points:** low=1, medium=2, high=3, urgent=4.

**Progress day (stats & productivity buckets):** Use the local calendar day from **`completedAt`** when available; fall back to **`dueDate`** only for legacy records missing `completedAt`.

---

## Productivity insights

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/productivity-insights` | `{ rows: ProductivityRow[], projectBreakdown?: ProjectBreakdown }` |

### `ProductivityRow`

Daily aggregates used by **Productivity Analysis** (`ProductivityAnalysisModal.tsx`). Built from **completed** tasks only (`!cancelled && completed`).

| Field | Type | Description |
|-------|------|-------------|
| `date` | `string` | Local ISO date `YYYY-MM-DD` |
| `tasksCompleted` | `number` | Count completed that day |
| `tasksCompletedCumulative` | `number` | Running sum of completions from first to this day |
| `xpGained` | `number` | Sum of priority points that day |
| `xpGainedCumulative` | `number` | Running sum of XP |
| `level` | `number` | Level implied by cumulative XP on that day |
| `badgesEarnedCumulative` | `number` | Count of unique milestone thresholds crossed (streak, tasks, XP, level families) |

If there are no qualifying completions, `rows` is `[]`.

### `ProjectBreakdown` (optional)

When there are projects and completed tasks associated with projects, the response includes a `projectBreakdown` payload to support per-project analysis views.

| Field | Type | Description |
|-------|------|-------------|
| `projects` | `{ id: string, name: string }[]` | Projects included in the breakdown legend. |
| `rows` | `{ date: string, tasksCompletedByProject: Record<string, number>, xpGainedByProject: Record<string, number> }[]` | Per-day per-project counts/XP (points) keyed by `projectId`. |

---

## Admin

| Method | Path | Response |
|--------|------|----------|
| `POST` | `/api/admin/reload-data` | `{ ok: true, counts: { projects, tasks } }` or `{ ok: false, error }` |
| `POST` | `/api/admin/save-data` | `{ ok: true, counts: { projects, tasks } }` or `{ ok: false, error }` |
| `POST` | `/api/admin/sync-from-data` | `{ ok: true, filesRead, imported: { projects, tasks }, counts: { projects, tasks } }` or `{ ok: false, error }` |
| `POST` | `/api/admin/import` | `{ ok: true, imported: { projects, tasks }, counts: { projects, tasks } }` or `{ ok: false, error }` |

Reloads JSON from disk without extra persistence. Intended for maintenance and recovery workflows (e.g., after manual edits in `backend/data/*.json`).

### Save (`POST /api/admin/save-data`)

Persists current in-memory `projects` and `tasks` into `backend/data/*.json`, then runs the same normalization pipeline as startup (via `loadData()`). This is used by the header **Save** action to:

- merge duplicates defensively
- normalize IDs and series identity deterministically
- ensure aggregate caches align with persisted state

### Import (`POST /api/admin/import`)

Imports **JSON** or **CSV** exports and merges them into current persisted data. The backend then runs the same normalization and dedupe logic as startup `loadData()`:

- project ID resequencing (`P1..Pn`) + task reference migration
- series parent/child ID normalization
- duplicate ID cleanup + same-series same-date collapse

Request body:

```json
{ "format": "json" | "csv", "content": "<file text>" }
```

Accepted formats:

- **JSON**: export payload `{ app, exportedAt, projects: Project[], tasks: Task[] }` (as produced by Export JSON)
- **CSV**: a single file with both `recordType=project` and `recordType=task` rows (as produced by Export CSV)

### Sync-from-data (`POST /api/admin/sync-from-data`)

Synces from JSON files in `backend/data/` into the server’s in-memory state, then persists and normalizes.

- Reads `*.json` files from `backend/data/` (oldest → newest by file mtime)
- Extracts `projects` and `tasks` payloads where present
- Merges/dedupes by id (keeps the latest values when duplicates exist)
- Persists to `backend/data/projects.json` and `backend/data/tasks.json`
- Runs the standard normalization pipeline (`loadData()`)

---

## Frontend integration

- **Task / project refresh:** Custom events `pst:tasks-changed`, `pst:projects-changed`.
- **Export:** `pst:open-export` (handled in `TaskBoard`).

---

## Versioning

- Breaking changes to field names or enum values require a **major** bump in release notes, `CHANGELOG.md`, and updates to `VARIABLES.md` and this file.
