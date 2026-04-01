# Changelog — Focista Schedulo

**Last updated:** 2026-04-01  
**Owner:** Engineering (with Product)

This changelog tracks meaningful product, engineering, and documentation changes.

---

## [2026-03-31] Project association integrity for series (parent/child consistency)

### Changed

- **Backend:** Enforced the invariant that tasks sharing the same `parentId` must share the same `projectId` (canonicalized within each parent group). This prevents “child/occurrence drift” where subtasks/childtasks appear under a different project than their parent series.
- **Frontend:** Normalized tasks on load so any tasks sharing the same `parentId` are displayed with the same `projectId`, ensuring filters and grouping remain consistent even for legacy data.

### Docs

- Updated `VARIABLES.md`, `ARCHITECTURE.md`, `GUARDRAILS.md`, `TRACEABILITY_MATRIX.md`, `USER_STORIES.md`, and `API_CONTRACTS.md` to document the project association invariant and its implications for filtering and recurrence integrity.

---

## [2026-03-31] Data ownership UX — Import/Save actions and toast notifications

### Added

- **Frontend:** App-level `Toaster` notification system for success/error/info feedback driven by the `pst:toast` event.
- **Backend:** `POST /api/admin/save-data` endpoint to persist current in-memory state and re-run normalization via reload.

### Changed

- **Docs:** Updated `README.md`, `docs/API_CONTRACTS.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN_GUIDELINES.md`, `docs/USER_STORIES.md`, `docs/TRACEABILITY_MATRIX.md`, and `docs/VARIABLES.md` to document:
  - header **Import / Save / Export** behaviors,
  - toast notification UX,
  - productivity-insights optional `projectBreakdown` payload.

---

## [2026-04-01] Comprehensive documentation audit (product + engineering)

### Changed

- Refreshed **README.md**, **docs/README.md** (coverage table), **PRODUCT_DOCUMENTATION_STANDARD.md** (glossary: hovercard, **Progress day**), **PRD.md** (gamification: progress-day + cache invalidation), **ARCHITECTURE.md** (stats/productivity cache lifecycle; productivity row bucketing), **API_CONTRACTS.md** (cache + field descriptions for `completedToday` / streak / `pointsToday`), **VARIABLES.md** (mermaid edge label; new **`task.completedAt`** and **`completionDateIsoLocalForTask`** entries), **DESIGN_GUIDELINES.md** (hovercard pointer-events), **GUARDRAILS.md** (overlay hit-testing), **TRACEABILITY_MATRIX.md** (Q4 recurring integrity row aligns with gap-fill + no forced re-complete), **USER_PERSONAS.md**, **USER_STORIES.md** (US-7), **PRODUCT_METRICS.md** (Q4 definition), **METRICS_AND_OKRS.md** (metadata date).
- All “**Last updated**” stamps in this audit set normalized to **2026-04-01** where files were touched.

### Docs

- Single narrative across the doc pack: **completion-time-first** progress bucketing for day-scoped analytics (local day from `completedAt`, with `dueDate` as legacy fallback); **lifetime** points/level semantics unchanged; **API** cache cleared on persist start and after `loadData()`.

---

## [2026-03-31] Progress attribution — due date first

### Changed

- **Backend:** `completionDateIsoLocalForTask` (used by `GET /api/stats` and `GET /api/productivity-insights`) now attributes completed tasks to the **local calendar day from `completedAt`** when available; legacy records fall back to **`dueDate`**.
- **Docs:** Updated `VARIABLES.md`, `API_CONTRACTS.md`, `PRD.md` (FR-10), `GUARDRAILS.md`, `ARCHITECTURE.md`, `PRODUCT_DOCUMENTATION_STANDARD.md` to match.

---

## [2026-03-31] Documentation — Productivity Analysis, API contracts, and UX alignment

### Added

- `docs/API_CONTRACTS.md` — canonical route and schema references for health, projects, tasks, stats, productivity-insights, admin reload, caching, and client integration events (e.g. `pst:open-export`).

### Changed

- Documentation suite aligned with **Productivity Analysis** (`GET /api/productivity-insights`, modal charts) and **portaled task hovercards** (pointer positioning, suppression on row checkbox and action controls):
  - `README.md`, `docs/README.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/VARIABLES.md` (relationship diagrams and productivity variable tables), `docs/DESIGN_GUIDELINES.md`, `docs/USER_STORIES.md` (including US-14), `docs/TRACEABILITY_MATRIX.md`, `docs/PRODUCT_DOCUMENTATION_STANDARD.md`.
- Product metrics and OKRs extended for analysis engagement (**E5**, **KR3.3**): `docs/PRODUCT_METRICS.md`, `docs/METRICS_AND_OKRS.md`.
- Guardrails updated for overlays/popovers and release checks: `docs/GUARDRAILS.md`.

### Docs

- Central index and traceability rows updated so persona and story coverage reference productivity insights parity with `/api/stats` caching semantics where applicable.

---

## [2026-03-23] Reliability and Documentation Expansion

### Added

- `docs/TRACEABILITY_MATRIX.md` with enterprise lineage from persona to metric.
- `docs/GUARDRAILS.md` defining product, technical, and operational constraints.
- `docs/CHANGELOG.md` for structured historical development tracking.
- Extended timeframe taxonomy in product behavior (`yesterday`, `last_week`, `last_month`, `last_quarter`, `quarter`, `next_quarter`, `custom`).

### Changed

- Expanded documentation suite:
  - `README.md`
  - `docs/README.md`
  - `docs/PRODUCT_DOCUMENTATION_STANDARD.md`
  - `docs/PRD.md`
  - `docs/USER_PERSONAS.md`
  - `docs/USER_STORIES.md`
  - `docs/VARIABLES.md`
  - `docs/PRODUCT_METRICS.md`
  - `docs/METRICS_AND_OKRS.md`
  - `docs/DESIGN_GUIDELINES.md`
  - `docs/ARCHITECTURE.md`
- Strengthened recurrence/future-task interaction reliability in:
  - `frontend/src/components/TaskBoard.tsx`
  - `backend/src/index.ts`
- Improved realtime progress synchronization and milestone behavior in:
  - `frontend/src/components/GamificationPanel.tsx`
  - `backend/src/index.ts`
- Recurrence model updated to horizon-based virtual occurrence generation with interaction-time materialization and deduplicated in-flight writes.
- Stats semantics clarified and hardened to use completion-date (`completedAt`) local-day precedence with fallback handling for legacy records.

### Fixed

- Future recurring occurrence completion/edit behavior made more resilient under rapid interactions.
- Backend load normalization and deduplication safeguards to prevent inconsistent duplicated task records.
- Local-date metrics calculation consistency for day-based stats and streak display.
- Multi-year streak computation no longer capped to one-year history.

### Docs

- Added explicit release-readiness, guardrail, and traceability guidance.
- Improved variable lineage and metrics governance notes.
- Added component state matrix and accessibility validation checklist.

---

## [2026-03-18] Foundation Documentation and Product Scope Baseline

### Added

- Initial comprehensive set of product/design/engineering documents:
  - `docs/PRD.md`
  - `docs/USER_PERSONAS.md`
  - `docs/USER_STORIES.md`
  - `docs/VARIABLES.md`
  - `docs/PRODUCT_METRICS.md`
  - `docs/METRICS_AND_OKRS.md`
  - `docs/DESIGN_GUIDELINES.md`
  - `docs/ARCHITECTURE.md`
  - `docs/PRODUCT_DOCUMENTATION_STANDARD.md`
  - `docs/README.md`

### Changed

- Root `README.md` updated to serve as product and developer entry point.

---

## Change Categories

- **Added**: New capabilities, files, or major documented artifacts.
- **Changed**: Significant behavior, architecture, or specification updates.
- **Fixed**: Bug fixes and reliability corrections.
- **Docs**: Documentation-only improvements and governance updates.

---

<!-- Last updated is listed at the top of this document. -->
