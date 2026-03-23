# Changelog — Focista Schedulo

**Last updated:** 2026-03-23  
**Owner:** Engineering (with Product)

This changelog tracks meaningful product, engineering, and documentation changes.

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

**Last updated:** 2026-03-23
