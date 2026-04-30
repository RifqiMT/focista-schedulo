# API Contracts

**Last updated:** 2026-04-30  
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

