# Neon Free schema decision

**Date:** 2026-07-19  
**Status:** Selected  
**Parent plan:** [`2026-07-19-neon-postgres.md`](./2026-07-19-neon-postgres.md)

---

## Verdict

**Ship row-per-entity schema immediately. Do not use a whole-document `runtime_documents` jsonb payload store as the primary Prod model.**

Canonical task shape stays one JSON object per task (round-trip compatible with today’s `TaskSchema`), stored as **`tasks.payload jsonb`**, with **generated stored columns** for indexes. Profiles/projects are small real tables. Import/export staging lives in Neon (`transfer_staging`).

---

## Evidence (local dataset)

| Metric | Value |
|---|---|
| Tasks | ~22,975 |
| Compact JSON size | ~9.5 MB |
| Gzip of full dump | ~0.38 MB |
| Avg task JSON | ~413 bytes |
| Profiles / projects | 5 / 8 |
| Dominant profiles | ~11.5k tasks each (2 profiles) |
| Hot durable path | `PATCH .../complete` → today rewrites entire tasks file |

Access pattern today (and kept after cutover):

1. Boot → load working set into memory  
2. Reads (`GET /api/tasks`, stats, recurrence) → **in-memory** filters (complex series logic)  
3. Mutations → update memory → **persist durable store**  
4. Multi-isolate → peek revision / mtime → reload if stale  

SQL does **not** need to reimplement recurrence. It must make **durable writes cheap** on Neon Free (0.5 GB, 100 CU-hours, scale-to-zero).

---

## Options compared

| Option | Storage on Free | Cost of one complete | Fit |
|---|---|---|---|
| **A. Single `runtime_documents` row** (Phase A in early plan) | Excellent (~gzip-sized TOAST) | **Rewrite ~9.5 MB jsonb** every time | Fast adapter, **bad Free-tier write tax** — reject as primary |
| **B. Row-per-task + `payload jsonb` + generated filter cols** | Fine (~few–10 MB + indexes ≪ 512 MB) | **Update ~1 row (~0.5 KB)** + bump revision | **Selected** |
| **C. Fully normalized** (labels/link junction tables, every scalar typed) | Similar | Similar to B for complete | Extra migration/code; little gain while memory remains SoT for reads — defer |

**Selected: Option B.**

---

## Selected schema

```sql
-- See: backend/src/storage/migrations/001_neon_core.sql

profiles (
  id, name, title, password_hash, created_at, updated_at
)

projects (
  id, name, profile_id → profiles(id)
)

tasks (
  id PK,
  payload jsonb NOT NULL,           -- full TaskSchema object (canonical)
  -- generated STORED from payload (no dual-write drift):
  profile_id, project_id, completed, cancelled,
  due_date, parent_id, priority,
  updated_at timestamptz
)

runtime_meta (
  key PK,           -- 'tasks_revision' | 'projects_revision' | 'profiles_revision'
  value bigint
)

transfer_staging (
  id, pathname UNIQUE, content, byte_size, created_at, expires_at
)
```

### Why generated columns

- Indexes on `profile_id`, `due_date`, `completed`, `parent_id` without maintaining two sources of truth  
- Complete path updates **`payload` only**; generated cols follow automatically  
- Boot/reload: `SELECT payload FROM tasks` → `Task[]` (same as parsing JSON file)

### Why keep `payload jsonb` (not only typed columns)

- Exact round-trip with existing Zod/`Task` type and import/export  
- Optional/rare fields (`location`, `link`, `repeatEvery`, …) stay schema-flexible  
- In-memory algorithm code unchanged

### Freshness (multi-isolate)

```text
ensureTasksMemoryFresh:
  SELECT value FROM runtime_meta WHERE key = 'tasks_revision'
  if remote > localRevision → reload tasks from SELECT payload
```

Bump `tasks_revision` in the **same transaction** as task writes.

### Persist strategies (adapter)

| Mutation | SQL |
|---|---|
| Complete / single patch | `UPDATE tasks SET payload = $1::jsonb, updated_at = now() WHERE id = $2` + revision++ |
| Create | `INSERT` + revision++ |
| Delete | `DELETE` + revision++ |
| Batch update/delete | Single transaction, many rows + one revision bump |
| Rare full rebuild (import/repair) | `TRUNCATE tasks` / bulk `COPY` or multi-row insert in transaction |

Debounce can stay short; complete still **awaits** flush on Vercel.

### Transfer staging

- Large import → write `transfer_staging` → import job reads `content` → delete row  
- Large export → write staging → `GET /api/admin/export-download/:id` streams text → TTL prune  
- Prefer **parts** export when payload is huge to save Neon storage/egress on Free  

---

## Neon Free operator settings (tied to this schema)

1. Pooled `DATABASE_URL` (`-pooler`) for the API  
2. Scale-to-zero left **on** (Free) — no keep-alive cron  
3. `statement_timeout` ≈ 15s on sessions  
4. One Prod branch; avoid idle extra branches  
5. After import, `VACUUM (ANALYZE) tasks` once  

---

## Explicitly not chosen

- **Primary whole-document jsonb store** for tasks — same write amplification as rewriting entire runtime JSON files  
- **Dual-write** to two durable backends — burns both quotas  
- **SQL-only reads without memory** — would require rewriting recurrence/stats; out of scope  

---

## Implementation order (schema-first)

1. Land `001_neon_core.sql` (this decision)  
2. Implement `neonStorage` / task repository against this schema  
3. Migrate data: JSON file/export → `INSERT` profiles, projects, tasks  
4. Wire transfer staging + admin routes  
5. Docs/guardrails update  

Optional later: drop unused generated indexes if unused; add partial index `WHERE completed = false` if SQL filtering is introduced.
