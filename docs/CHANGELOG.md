# Changelog — Focista Schedulo

**Last updated:** 2026-04-01  
**Owner:** Engineering (with Product)

This changelog tracks meaningful product, engineering, and documentation changes.

---

## [2026-04-01] Documentation pack — code alignment, Badges, and repo accuracy

### Changed

- **Progress day (canonical):** All product and variable docs now match `completionDateIsoLocalForTask()` in `backend/src/index.ts`: attribute completed work to **`dueDate`** when set; otherwise the **local calendar date** from **`completedAt`**. Updated `README.md`, `docs/PRD.md`, `docs/VARIABLES.md`, `docs/API_CONTRACTS.md`, `docs/ARCHITECTURE.md`, `docs/GUARDRAILS.md`, `docs/PRODUCT_DOCUMENTATION_STANDARD.md`, `docs/USER_STORIES.md`, `docs/USER_PERSONAS.md`, `docs/PRODUCT_METRICS.md`, `docs/README.md`, `docs/DOCS_CODE_CROSSWALK.md`.
- **Badges:** Documented full-viewport portaled Badges experience (`GamificationPanel`, `BadgesModalDialogBody`, `.badge-fs-pa-layer`), shared chrome patterns with Productivity Analysis, `.pa-close-round` close control, and `GET /api/stats` → `milestoneAchievements` data dependency. Added **US-7a**, **FR-12**, traceability row, design guidelines section, variables relationship chart updates.
- **API / ops:** Documented **10 MB** JSON body limit for admin/import flows (`docs/API_CONTRACTS.md`, `docs/GUARDRAILS.md`).
- **Repository:** Root `package.json` workspaces list corrected to **`backend`** and **`frontend`** only (removed unused `shared` entry). **Frontend** tech stack in `README.md` no longer lists Zod (backend retains Zod for validation).

### Docs

- Comprehensive pass on enterprise traceability, personas, stories, metrics data-quality checks, and crosswalk claims to reflect current UI and server behavior.
- Metadata consistency: root **README** uses the same top-of-file **Last updated** / **Owner** pattern as `docs/` plus the standard HTML footer; **ARCHITECTURE** header punctuation aligned; **API_CONTRACTS** and **DOCS_CODE_CROSSWALK** include the standard footer note.

---

## [2026-04-01] Backend ESLint (flat config) and lint-driven cleanup

### Added

- **`backend/eslint.config.mjs`** — ESLint 9 flat configuration with `@typescript-eslint` (recommended) and Node globals; devDependency **`globals`** for `eslint.config.mjs`.

### Changed

- **`npm run lint` (backend):** script is `eslint src` (no deprecated `--ext`).
- **`readJsonFilesFromDataDir`:** JSON parse typing uses `unknown` plus `isLooseProjectArray` / `isLooseTaskArray` guards instead of `any`.
- **CSV import:** `repeat` / `repeatUnit` cells parsed via **`parseCsvRepeat`** / **`parseCsvRepeatUnit`** (typed; invalid values fall back safely before Zod).
- Removed unused private helpers **`allocateNextParentId`**, **`seriesKeyIgnoringProject`**, **`syncSeriesIdentityAndDuration`** (superseded by deterministic rebuild / other paths).

### Docs

- **`docs/ARCHITECTURE.md`** — notes `eslint.config.mjs` under `backend/`.

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

## [2026-03-31] Progress attribution (historical note)

### Changed

- **Backend:** `completionDateIsoLocalForTask` attributes day-scoped analytics to **`dueDate`** when present; otherwise the **local calendar date** from **`completedAt`** (see function comment in `backend/src/index.ts`).
- **Docs (2026-04-01):** Product documentation was reconciled to this behavior across `VARIABLES.md`, `API_CONTRACTS.md`, `PRD.md`, `GUARDRAILS.md`, `ARCHITECTURE.md`, and related files (see top changelog entry).

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
- Stats semantics clarified and hardened: **progress day** uses **`dueDate`** when set, else local calendar date from **`completedAt`** (`completionDateIsoLocalForTask`).

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
