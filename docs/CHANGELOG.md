# Changelog

**Last updated:** 2026-07-19  
**Owner:** Engineering

---

## 2026-07-19

### Changed — Production persistence (Neon Postgres)

- **Prod durable storage:** **Neon Postgres Free** (row-per-task + `payload jsonb`) is the production durable store for runtime persistence and large import/export staging. Local development remains `STORAGE_BACKEND=fs` (`backend/data/*.runtime.json`).
- Storage selection: `STORAGE_BACKEND=neon` (or auto) + pooled `DATABASE_URL`; optional `DATABASE_URL_UNPOOLED`, `NEON_FRESHNESS_TTL_MS`, `NEON_TRANSFER_TTL_HOURS`, `NEON_STATEMENT_TIMEOUT_MS`.
- Schema: `backend/src/storage/migrations/001_neon_core.sql` — `profiles`, `projects`, `tasks` (row-per-task), `runtime_meta`, `transfer_staging`.
- Freshness: `runtime_meta.tasks_revision` drives multi-isolate reloads (`ensureTasksMemoryFresh`) before task list/complete on Vercel.
- Transfer: `POST /api/admin/transfer-upload` + import `stagingPathname`; export `delivery: "staging"` / download via `GET /api/admin/export-download`; frontend `transferImport.ts`. Parts paging remains the fallback when staging is unavailable.
- Neon `persistDebounceMs` is **`0` when `VERCEL` is set**; ~200ms off-Vercel. Task complete **awaits** durable persist and fail-closes with rollback + `500` + UI toast.
- **Export output:** always one JSON file, one CSV file, or both — each file covers **all profiles'** entries (including cancelled tasks and empty profiles); locked profiles remain optional via password gate.
- **Vercel large import:** when Neon is configured, prefer **chunked Neon `transfer_staging`**; otherwise client-parsed **batched** `POST /api/admin/import-merge` (avoids `FUNCTION_PAYLOAD_TOO_LARGE`).
- **Neon capabilities:** `GET /health` reports `neon.ok` + write/import/export/transferStaging; `POST /api/admin/storage-probe` verifies migrate + write; `npm run neon:link` wires `DATABASE_URL` to Vercel.
- **Neon schema on serverless:** core DDL is embedded in `neonMigrations.ts` (no runtime `dist/migrations/*.sql` file dependency). Task filter indexes use jsonb expression indexes (generated columns removed — Postgres immutability).
- **Vercel storage selection:** when `DATABASE_URL` / `POSTGRES_URL` is set, Neon is preferred even if stale `STORAGE_BACKEND=fs` remains (override with `VERCEL_ALLOW_FS=1`).

### Removed

- Vercel Blob runtime adapter, Blob transfer helpers, `blobPathname` routes, and related frontend/backend dependencies.
- Documentation scrub: purged leftover object-store persistence aliases and deprecated env-variable rows (runtime path is Neon/`fs` only).

### Fixed

- **Task completion durability on Vercel:** `PATCH /api/tasks/:id/complete` awaits Neon persist before responding (serverless freezes timers after the response).
- **Multi-isolate Neon freshness:** isolates reload in-memory tasks when remote `tasks_revision` is newer—prevents completion snap-back.
- Virtual recurring occurrences no longer use a temporary July-2026 force-complete backfill; synthesized occurrences start incomplete.

### Added — Productivity Summary (AI)

- **Productivity Summary** (AI): Tasks toolbar **Summary** opens a modal for period summaries and task Q&A via Groq + optional Tavily web enrich.
- **AI keys** header action: users can enter Groq/Tavily keys in browser localStorage; live validation via `POST /api/ai-keys/validate` (keys never logged).
- Backend: `productivitySummaryService.ts` with timelines (day, week, sprint, month, bi-month, quarter, semester, year, next_* ranges, custom); routes `POST /api/productivity-summary` and `POST /api/productivity-summary/ask`.
- Env: `GROQ_API_KEY`, optional `GROQ_MODEL`, `TAVILY_API_KEY` (server-only).

### Changed — Product UX and reliability

- Productivity Summary UX polish: clearer timeline labels, stale-timeline banner, copy summary, ⌘/Ctrl+Enter, This/Next period offset, degraded local brief when Groq fails (`degraded: true`).
- Admin import reliability: JSON/CSV per-row validation with soft coercion; skipped rows counted accurately (`droppedRows`).
- Large export: Dev allows larger inline payloads; Prod prefers Neon staging, else **parts** paging (`/api/admin/export-tasks-page`)—no hard `413` on export.
- Productivity Analysis: Raw/Average dual-series palette; nice Y-axis ticks without duplicate compact labels.
- Task search indexes all task attributes with AND token match.
- Dead-code cleanup: unused exports/types, superseded CSS/keyframes; corrected variable naming (`droppedRows`, `export.delivery` includes `auto` / `staging`).
- Follow-up dead-code pass: removed deprecated Blob import aliases, unused `isTransferChunkPathname` / `resetNeonSqlCache`, unused Neon `timeoutMs` stub, file-private type exports, orphan PA keyframes; renamed docs `toast.singleSlot` → `enqueueToast` (single-slot).

### Added (tests)

- `taskCompletePersist.test.ts` — Neon debounce `0` on Vercel / positive off-Vercel.
- `transferStaging.test.ts` — staging pathname prefixes and inline size caps.
- `exportEntities.test.ts` — export filtering by denied profile IDs.
- Expanded `storage/storage.test.ts` for `fs` / `neon` selection.
- Productivity Summary period/digest coverage (28 cases in service tests).

### Documentation

- Full suite aligned to Neon topology: README, Architecture, Deployment, Guardrails, Variables, API contracts, PRD (FR-13/14, NFR-12/13), Traceability, Stories (US-504), Test strategy, Crosswalk, metrics (PM-09), plans under `docs/plans/` (Implemented).
- Completeness for AI Summary (US-409/410/413, FR-21/24), import resilience (FR-22, US-412), task search (FR-23, US-411), exclusive tooltip / single-toast, and calendar-week progress semantics.
- Follow-up audit: reorganized changelog; indexed `docs/plans/`; Mermaid `tasks_revision` link; Design cold-start note; exportEntities in crosswalk/tests; Neon Free limit guardrails.

---

## 2026-07-18

### Documentation

- Comprehensive documentation suite audit and refresh aligned to shipped July 17–18 behavior and professional product documentation standards.
- Updated: root `README.md`, `docs/README.md`, `PRODUCT_DOCUMENTATION_STANDARD.md`, `PRD.md`, `USER_PERSONAS.md`, `USER_STORIES.md` (incl. US-103, US-504), `VARIABLES.md` (expanded catalog + relationship diagram), `PRODUCT_METRICS.md`, `METRICS_AND_OKRS.md` (incl. Objective 6), `DESIGN_GUIDELINES.md`, `TRACEABILITY_MATRIX.md` (FR-13–FR-18), `GUARDRAILS.md`, `ARCHITECTURE.md`, `API_CONTRACTS.md`, `DEPLOYMENT_VERCEL.md`, `DOCS_CODE_CROSSWALK.md`, `OPERATING_MODEL.md`, `TEST_STRATEGY.md`, `RACI_MATRIX.md`, `RELEASE_CHECKLIST_TEMPLATE.md`.

### Fixed

- Task completion and isolate-memory hardening on the then-current Prod store (superseded the same day by Neon migration — see 2026-07-19).

### Added

- Exclusive overlay helper `frontend/src/uiExclusiveOverlay.ts`: at most one custom tooltip/hovercard is visible app-wide; toasts dismiss the active tooltip.
- Milestone blocks expose a `description` field (e.g. badges-earned: “Rewards for collecting badges themselves (every 5 badges).”).
- Header Import/Export actions use icon + label (`header-action-btn`) for clearer data-ops affordances.

### Changed

- Achievement and milestone cards now use short plain-English descriptions (achievements via `/api/stats` copy; milestones show a `description` line under each card title).
- Toast queue is **single-toast** (replace, do not stack up to four).
- Removed manual **Sync** and **Save** header buttons. Sync/save now run automatically after import (not on every boot).
- Profile loading shows a **progress bar + staged status**; Vercel boot loads profiles via a fast path before the large tasks working set, and skips expensive boot-time sync/save.

---

## 2026-07-17

### Added

- Pluggable persistence adapters and production hardening (`FRONTEND_ORIGIN`, `VITE_API_BASE_URL` for split hosting).
- Storage kind exposed on `GET /health`.

### Changed

- Prod topology: Vercel SPA + Node API + durable store (later finalized as **Neon Postgres**; see 2026-07-19). Explicitly **no Redis / no MongoDB**.

---

## 2026-05-04

### Documentation

- Documentation suite refresh aligned with shipped **progress** behavior: calendar-week weekly chart (JSON key `last7Days`), rich bar tooltips (per-task XP and weekday-historical stats), badge PNG export and modal naming, and profile **lock** affordance.

### Product

- Progress: calendar-week stats, rich tooltips, badges export enhancements (see commit history for implementation detail).

---

## 2026-04-30

### Added

- Production-oriented Vercel deployment guide: `docs/DEPLOYMENT_VERCEL.md`.
- Configurable API origin for split hosting: `frontend/src/apiClient.ts`, `frontend/.env.example`, `frontend/vercel.json`.
- Optional strict CORS for production API: `FRONTEND_ORIGIN`.

### Changed

- Shifted runtime persistence to split files (`tasks.runtime.json`, `projects.runtime.json`, `profiles.runtime.json`) for non-monolith operational performance (local `fs`; Prod later moved to Neon rows).
- Showcase read-only enforcement for profile `Test`; password confirmation for deleting protected profiles; friendly error formatter; export `Both` mode.

### Documentation

- Comprehensive documentation suite audit and refresh across product, analytics, design, and governance artifacts.

---

## Earlier History (Summary)

Notable prior themes (2026-03 through 2026-04):

- Gamification expansion, badges, realtime progress
- Productivity analysis and progress semantics
- Recurring-task reliability and data integrity
- Fullscreen UX, import/save refinements
- Enterprise-grade documentation foundations
- Repository flatten and content restore

Refer to git history for commit-level detail prior to 2026-04-30.
