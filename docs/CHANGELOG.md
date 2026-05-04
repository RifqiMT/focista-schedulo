# Changelog

**Last updated:** 2026-04-30  
**Owner:** Engineering

---

## 2026-05-04

### Added

- Vercel-oriented production deployment: root `vercel.json`, `docs/DEPLOYMENT_VERCEL.md`, and `frontend/.env.example`.
- `frontend/src/apiOrigin.ts` with `apiUrl()` so REST and SSE target `VITE_API_BASE_URL` when the SPA and API are on different origins.

---

## 2026-04-30

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

