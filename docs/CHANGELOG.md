# Changelog

**Last updated:** 2026-05-04  
**Owner:** Engineering

---

## 2026-05-04

### Documentation

- Documentation suite refresh aligned with shipped **progress** behavior: calendar-week weekly chart (JSON key `last7Days`), rich bar tooltips (per-task XP and weekday-historical stats), badge PNG export and modal naming, and profile **lock** affordance.
- Updated: `PRODUCT_DOCUMENTATION_STANDARD.md` (§4.1 variables/API discipline), `PRD.md`, `USER_PERSONAS.md`, `USER_STORIES.md` (US-403–US-406), `VARIABLES.md` (relationship diagram + `/api/stats` weekly fields), `API_CONTRACTS.md` (`GET /api/stats` contract notes), `DESIGN_GUIDELINES.md`, `GUARDRAILS.md` (copy vs. implementation; legacy API keys), `TRACEABILITY_MATRIX.md`, `PRODUCT_METRICS.md`, `METRICS_AND_OKRS.md`, `DOCS_CODE_CROSSWALK.md`, `ARCHITECTURE.md`, `TEST_STRATEGY.md`, `OPERATING_MODEL.md`, `RACI_MATRIX.md`, `RELEASE_CHECKLIST_TEMPLATE.md`, `releases/README.md`.
- Callout: some achievement **UI copy** may still say “last 7 days” while eligibility iterates the calendar-week series—documented in `VARIABLES.md` / `GUARDRAILS.md` for product alignment.

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

- Comprehensive documentation suite audit and refresh:
  - root `README.md`
  - `docs/README.md`
  - `PRODUCT_DOCUMENTATION_STANDARD.md`
  - `PRD.md`
  - `USER_PERSONAS.md`
  - `USER_STORIES.md`
  - `VARIABLES.md`
  - `PRODUCT_METRICS.md`
  - `METRICS_AND_OKRS.md`
  - `DESIGN_GUIDELINES.md`
  - `TRACEABILITY_MATRIX.md`
  - `GUARDRAILS.md`
  - `ARCHITECTURE.md`
  - `API_CONTRACTS.md`
  - `DOCS_CODE_CROSSWALK.md`
  - `OPERATING_MODEL.md`
  - `TEST_STRATEGY.md`
  - `RACI_MATRIX.md`
  - `RELEASE_CHECKLIST_TEMPLATE.md`

