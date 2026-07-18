# Changelog

**Last updated:** 2026-07-18  
**Owner:** Engineering

---

## 2026-07-18

### Documentation

- Comprehensive documentation suite audit and refresh aligned to shipped July 17–18 behavior and professional product documentation standards.
- Updated: root `README.md`, `docs/README.md`, `PRODUCT_DOCUMENTATION_STANDARD.md`, `PRD.md`, `USER_PERSONAS.md`, `USER_STORIES.md` (incl. US-103, US-504), `VARIABLES.md` (expanded catalog + relationship diagram), `PRODUCT_METRICS.md`, `METRICS_AND_OKRS.md` (incl. Objective 6), `DESIGN_GUIDELINES.md`, `TRACEABILITY_MATRIX.md` (FR-13–FR-18), `GUARDRAILS.md`, `ARCHITECTURE.md`, `API_CONTRACTS.md`, `DEPLOYMENT_VERCEL.md`, `DOCS_CODE_CROSSWALK.md`, `OPERATING_MODEL.md`, `TEST_STRATEGY.md`, `RACI_MATRIX.md`, `RELEASE_CHECKLIST_TEMPLATE.md`.

### Fixed

- Vercel Prod import/export for large payloads: stage via **Vercel Blob** (client upload + `blobPathname` import; export returns a short-lived presigned download URL) to avoid Hobby ~4.5MB serverless body limits (HTTP 413).

### Changed

- Removed manual **Sync** and **Save** header buttons. Sync/save now run automatically after import (not on every boot).
- Profile loading shows a **progress bar + staged status**; Vercel boot loads profiles via a fast path before the large tasks blob, and skips expensive boot-time sync/save.
- Dead-code cleanup: removed unused backend helpers (`mergeTasks`, `makeCache`, `startOfWeekMondayIso`, `createImportClientToken`), unused logo assets, superseded Profile/Projects/Productivity CSS (~1k lines), and corrected `VARIABLES.md` profile ID / friendly-error examples.

---

## 2026-07-17

### Added

- Pluggable persistence adapters: local `fs` and **Vercel Blob** (`backend/src/storage/`), selected via `STORAGE_BACKEND` / Blob credentials.
- Production hardening: require `FRONTEND_ORIGIN` when `NODE_ENV`/`FOCISTA_ENV` is production; require `VITE_API_BASE_URL` on Vercel Production builds when split-hosted.
- Storage kind exposed on `GET /health`.

### Changed

- Prod topology (Option A): Vercel SPA + Node API + **Vercel Blob** for durable runtime JSON (explicitly **no Redis / no MongoDB**).
- Updated `docs/DEPLOYMENT_VERCEL.md`, `ARCHITECTURE.md`, `GUARDRAILS.md`, env examples, and `frontend/vercel.json`.

---

## 2026-05-04

### Documentation

- Documentation suite refresh aligned with shipped **progress** behavior: calendar-week weekly chart (JSON key `last7Days`), rich bar tooltips (per-task XP and weekday-historical stats), badge PNG export and modal naming, and profile **lock** affordance.
- Updated: `PRODUCT_DOCUMENTATION_STANDARD.md` (§4.1 variables/API discipline), `PRD.md`, `USER_PERSONAS.md`, `USER_STORIES.md` (US-403–US-406), `VARIABLES.md` (relationship diagram + `/api/stats` weekly fields), `API_CONTRACTS.md` (`GET /api/stats` contract notes), `DESIGN_GUIDELINES.md`, `GUARDRAILS.md` (copy vs. implementation; legacy API keys), `TRACEABILITY_MATRIX.md`, `PRODUCT_METRICS.md`, `METRICS_AND_OKRS.md`, `DOCS_CODE_CROSSWALK.md`, `ARCHITECTURE.md`, `TEST_STRATEGY.md`, `OPERATING_MODEL.md`, `RACI_MATRIX.md`, `RELEASE_CHECKLIST_TEMPLATE.md`, `releases/README.md`.
- Callout: some achievement **UI copy** may still say “last 7 days” while eligibility iterates the calendar-week series—documented in `VARIABLES.md` / `GUARDRAILS.md` for product alignment.

### Product

- Progress: calendar-week stats, rich tooltips, badges export enhancements (see commit history for implementation detail).

---

## 2026-04-30

### Added

- Production-oriented Vercel deployment guide: `docs/DEPLOYMENT_VERCEL.md`.
- Configurable API origin for split hosting: `frontend/src/apiClient.ts`, `frontend/.env.example`, `frontend/vercel.json`.
- Optional strict CORS for production API: `FRONTEND_ORIGIN` (`backend/src/index.ts`, `backend/.env.example`).

### Changed

- Shifted runtime persistence to split files (`tasks.runtime.json`, `projects.runtime.json`, `profiles.runtime.json`) for non-monolith operational performance.
- Updated save/sync behavior alignment so runtime operations do not depend on unified monolith persistence.
- Optimized high-frequency frontend task flows:
  - concurrent batch creation
  - batch deletion for recurring series
  - reduced heavy visible refreshes after optimistic updates
- Added performance diagnostics:
  - backend API timing header (`X-Server-Time-Ms`)
  - frontend slow-action logging instrumentation
- Added profile-gated performance toggle available only for profile name `Rifqi Tjahyono`.
- Added showcase read-only enforcement for profile `Test` across profile/project/task mutation paths (frontend and backend).
- Added password confirmation requirement for deleting password-protected profiles.
- Added centralized friendly error-message formatter to improve toaster root-cause clarity for failed actions.
- Added export `Both` mode for one-action JSON+CSV export.

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
