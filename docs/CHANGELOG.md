# Changelog

**Last updated:** 2026-07-19  
**Owner:** Engineering

---

## 2026-07-19

### Added

- **Productivity Summary** (AI): Tasks toolbar **Summary** opens a modal for period summaries and task Q&A via Groq + optional Tavily web enrich.
- **AI keys** header action (next to Import): users can enter Groq/Tavily keys and save them in browser localStorage for Productivity Summary.
- Backend: `productivitySummaryService.ts` with timeline periods (day, week, sprint, month, bi-month, quarter, semester, year, custom); routes `POST /api/productivity-summary` and `POST /api/productivity-summary/ask`.
- Env: `GROQ_API_KEY`, optional `GROQ_MODEL`, `TAVILY_API_KEY` (server-only).
- Unit tests for period resolution and task digests (16 cases).

### Changed

- Productivity Summary UX polish: clearer timeline labels, stale-timeline banner when the period changes after generate, copy summary, ⌘/Ctrl+Enter shortcuts, edge-fade timeline scroller, and summary action bar.
- Productivity Summary LLM output: stronger plain-English status brief prompts; digests now include explicit open/overdue task lists with name + ID, and summaries/Ask answers must render dedicated Open tasks / Overdue tasks sections when those lists are present.
- Productivity Summary resilience: leaner digests, smaller completion budget, Groq fallback model on rate limits, and local digest brief/answer when AI is unavailable (`degraded: true`).
- Productivity Summary timelines: added forward ranges — next day, next week, next sprint, next month, next quarter, next half year, next year.
- Productivity Summary timeline UI: period unit chips + **This | Next** offset (Concept A) instead of a long flat chip list.
- AI keys modal refresh: solid Summary-aligned shell, Groq/Tavily status pills, provider cards with inline reveal, dirty-state Save, and ⌘/Ctrl+Enter.
- AI key auto-validation: format checks while typing plus live Groq/Tavily verification via `POST /api/ai-keys/validate` (keys never logged).
- Admin import reliability: JSON/CSV now coerce common quirks and validate **per row** so one bad task/profile no longer drops an entire array (critical on Vercel Prod). Skipped rows are counted accurately in the import toast.
- Large export without Blob: Dev allows larger inline payloads; Prod falls back to **parts** paging (`/api/admin/export-tasks-page`) when Blob staging is unavailable—no more hard `413` on export.
- Productivity Analysis dual-series charts: Raw (brand red) and Average (blue) now share one palette across lines, legends, tooltips, and PNG export; raw no longer fades to pink when both series are shown.
- Productivity Analysis Y-axis: nice tick grid with even spacing; no duplicate compact labels (e.g. stacked "14k") or uneven endpoint gaps.
- Task search indexes all task attributes (title, description, labels, project/profile names, priority, dates/times, duration, reminder, repeat, location, links, status, ids)—AND token match.
- Productivity Summary modal visual refresh: elevated header meta chips, sliding Overview/Ask control, web-tips switch, completion ring, richer empty/loading states, and refined Ask composer—still on the solid Analysis shell (no glass).
- Productivity Summary modal clipping fix: fit dialog inside viewport (`calc(100dvh - …)`), scroll the body instead of `overflow: hidden`, and keep Sources fully reachable.

### Documentation

- Suite sync for Productivity Summary: README, PRD, personas, stories (US-409/US-410), API contracts, architecture, variables, design, guardrails, traceability, metrics, deployment, crosswalk, tests, changelog.
- Completeness pass: FR-22–FR-24, US-411–US-413, importParse/taskSearch/chartYAxis/export-parts crosswalk, CSS namespace table, NFR-10/11, and remaining docs bumped to **2026-07-19**.

---

## 2026-07-18

### Documentation

- Comprehensive documentation suite audit and refresh aligned to shipped July 17–18 behavior and professional product documentation standards.
- Updated: root `README.md`, `docs/README.md`, `PRODUCT_DOCUMENTATION_STANDARD.md`, `PRD.md`, `USER_PERSONAS.md`, `USER_STORIES.md` (incl. US-103, US-504), `VARIABLES.md` (expanded catalog + relationship diagram), `PRODUCT_METRICS.md`, `METRICS_AND_OKRS.md` (incl. Objective 6), `DESIGN_GUIDELINES.md`, `TRACEABILITY_MATRIX.md` (FR-13–FR-18), `GUARDRAILS.md`, `ARCHITECTURE.md`, `API_CONTRACTS.md`, `DEPLOYMENT_VERCEL.md`, `DOCS_CODE_CROSSWALK.md`, `OPERATING_MODEL.md`, `TEST_STRATEGY.md`, `RACI_MATRIX.md`, `RELEASE_CHECKLIST_TEMPLATE.md`.

### Fixed

- Vercel Prod import/export for large payloads: stage via **Vercel Blob** (client upload + `blobPathname` import; export returns a short-lived presigned download URL) to avoid Hobby ~4.5MB serverless body limits (HTTP 413).

### Added

- Exclusive overlay helper `frontend/src/uiExclusiveOverlay.ts`: at most one custom tooltip/hovercard is visible app-wide; toasts dismiss the active tooltip.
- Milestone blocks expose a `description` field (e.g. badges-earned: “Rewards for collecting badges themselves (every 5 badges).”).
- Header Import/Export actions use icon + label (`header-action-btn`) for clearer data-ops affordances.

### Changed

- Achievement and milestone cards now use short plain-English descriptions (achievements via `/api/stats` copy; milestones show a `description` line under each card title).
- Toast queue is **single-toast** (replace, do not stack up to four).
- Removed manual **Sync** and **Save** header buttons. Sync/save now run automatically after import (not on every boot).
- Profile loading shows a **progress bar + staged status**; Vercel boot loads profiles via a fast path before the large tasks blob, and skips expensive boot-time sync/save.
- Dead-code cleanup: removed unused backend helpers (`mergeTasks`, `makeCache`, `startOfWeekMondayIso`, `createImportClientToken`), unused logo assets, superseded Profile/Projects/Productivity CSS (~1k lines), and corrected `VARIABLES.md` profile ID / friendly-error examples.
- Follow-up dead-code pass: removed unused TaskEditorDrawer link/location formatters, unused `fsOverlayPeak` / `started` locals, superseded PA/tooltip/drawer CSS (~1.6k lines), and corrected `BLOB_RUNTIME_PREFIX` docs location.

### Documentation

- Follow-up suite sync for exclusive tooltips, single-toast UX, achievement/milestone `description` fields, and header action patterns (README, PRD, personas, stories, VARIABLES, design, API, architecture, traceability, guardrails, crosswalk, tests).

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
