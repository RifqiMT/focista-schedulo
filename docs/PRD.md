# Product Requirements Document (PRD)

**Last updated:** 2026-07-19  
**Owner:** Product

---

## 1) Product Summary

Focista Schedulo is a local-first productivity application designed to help users plan, execute, and track work through profile-scoped task and project organization, recurrence intelligence, calendar planning, gamified progress feedback, and portable data operations (including production-scale Blob transfers).

**Tagline:** Plan with clarity, focus without noise, and celebrate what you complete.

---

## 2) Problem Statement

Users struggle with:

- Fragmented planning between lists and calendar tools
- Unreliable recurring task behavior
- Context leakage between personal and work planning scopes
- Weak motivation loops after task completion
- Fragile import/export when datasets exceed serverless body limits
- Opaque failure messages that block recovery

Focista Schedulo addresses these through deterministic scheduling logic, scoped organization (profiles/projects), measurable progress insights, Blob-staged large transfers, and friendly root-cause error communication.

---

## 3) Product Goals

1. Deliver fast, reliable task management under active daily usage.
2. Ensure profile-aware data boundaries for tasks, projects, and progress.
3. Provide robust recurrence and historical task visibility.
4. Enable product learning through measurable metrics and trend analytics.
5. Preserve user data ownership with reliable import/export at production scale.
6. Keep demos safe via showcase read-only policy and clear blocked-action messaging.

---

## 4) Non-Goals (Current Scope)

- Multi-user collaborative editing
- External calendar sync (Google/Outlook bi-directional)
- Enterprise RBAC / workflow approvals
- Redis- or MongoDB-backed primary persistence
- Native mobile apps
- Multi-tenant SaaS billing / org administration

---

## 5) Target Users

- Professionals managing multiple workstreams
- Habit/routine-oriented users with recurrence-heavy planning
- Personal planners requiring structure and reminders
- Progress-motivated users who respond to streaks, badges, and charts
- Presenters who need a safe demo dataset (`Test` profile)

Detailed profiles: `USER_PERSONAS.md`.

---

## 6) Current Scope (Shipped / Active)

### 6.1 Profile Management

- Create/edit/delete/select profiles
- Optional password-protected profiles with lock indicator in selector
- Profile-scoped filtering for tasks, projects, and progress modules
- Showcase read-only behavior for profile named `Test` (UI + API)
- Password confirmation required for deleting password-protected profiles
- Staged boot progress (progress bar + status); production fast-path loads profiles before large tasks blob

### 6.2 Task Management

- Rich metadata fields (priority, due date/time, duration, repeat rules, labels, links, locations, reminders)
- Bulk actions: delete/move/update via batch endpoints
- Recurring task materialization and deterministic identity normalization
- Completion toggling with optimistic UI reconciliation
- Free-text **task search** across all attributes (AND token match)

### 6.3 Project Management

- Project CRUD with stable IDs
- Association integrity between project and task entities
- Profile-scoped listing and filtering

### 6.4 Planning Views

- List mode with status/timeframe controls
- Calendar month + day-agenda detail
- Historical task loading with pagination and jump-to-date support

### 6.5 Progress and Insights

- `/api/stats` for streak, XP, level, milestones, grinding, and the **current calendar week** completion series (local Monday–Sunday; legacy key `last7Days`)
- Per-day bar tooltips: completions, XP, per-task XP min/max/average, weekday-historical completion min/max/average
- `/api/productivity-insights` for trend visualization
- **Productivity Summary** (`/api/productivity-summary`, `/api/productivity-summary/ask`): Groq LLM narratives and task Q&A with optional Tavily web enrich; timelines include day, week, sprint, month, bi-month, quarter, semester, year, matching next-* forward ranges, and custom ranges
- Badges and milestone UI with high-resolution PNG export
- Modal titling: `Profile: Name - Title`; badge cards/exports emphasize profile **name**
- Achievement and milestone cards show short **plain-English `description`** lines from `/api/stats`
- Progress overlays use an **exclusive tooltip** slot; toasts are **single-slot** and dismiss open tooltips

### 6.6 Data Operations

- Import (JSON/CSV), including Blob staging via client upload + `blobPathname`
- **Per-row import validation** with soft coercion; invalid rows skipped and counted (does not drop entire arrays)
- Export (JSON/CSV/Both), including short-lived presigned Blob download URLs for large payloads
- When Blob is unavailable, large exports use **parts paging** (`/api/admin/export-tasks-page`) instead of hard `413`
- **Automated sync + save** after import (no manual Sync/Save header buttons)
- Quiet `reload-data` on tab return
- Admin endpoints retained for programmatic save/sync/reload
- Friendly root-cause error messaging for failed data operations (including `413`)
- **AI keys** header modal for optional browser-local Groq/Tavily keys with live validation

### 6.7 Persistence and Deployment

- Split runtime objects: `tasks.runtime.json`, `projects.runtime.json`, `profiles.runtime.json`
- Pluggable storage: `fs` (local) or `vercel-blob` (prod)
- Production topology: Vercel SPA (+ optional Services) + Node API + Vercel Blob
- Explicit non-use of Redis/MongoDB in current topology

---

## 7) Functional Requirements

| ID | Requirement |
|---|---|
| FR-01 | Profile-scoped data views for tasks/projects/progress |
| FR-02 | Full task CRUD with validation and recurrence support |
| FR-03 | Project CRUD with stable identity and filtering |
| FR-04 | Deterministic recurrence normalization and duplicate prevention |
| FR-05 | List + calendar + day-agenda planning workflows |
| FR-06 | Bulk task actions with efficient backend mutation paths |
| FR-07 | Gamification and productivity analytics endpoints |
| FR-08 | Data import/export plus automated save/sync admin operations |
| FR-09 | Historical tasks availability and navigation |
| FR-10 | Performance-oriented runtime persistence (non-monolith) |
| FR-11 | User-friendly, root-cause error feedback for failed actions |
| FR-12 | Showcase read-only profile policy enforcement (`Test`) |
| FR-13 | Vercel Prod split hosting with Blob durable store |
| FR-14 | Large-payload import/export via Vercel Blob staging (export parts fallback when Blob unavailable) |
| FR-15 | Calendar-week progress chart with rich weekday tooltips |
| FR-16 | Badge PNG export and consistent modal naming |
| FR-17 | Lock affordance for password-protected profiles |
| FR-18 | Staged profile boot progress and production fast-path loading |
| FR-19 | Plain-English achievement and milestone descriptions on Progress cards |
| FR-20 | Exclusive tooltip/hovercard slot and single-toast feedback layering |
| FR-21 | AI Productivity Summary and task Q&A (Groq + optional Tavily) |
| FR-22 | Per-row import validation with soft coercion (skip invalid rows only) |
| FR-23 | Comprehensive free-text task search with AND token semantics |
| FR-24 | Browser-local AI keys management with live provider validation |

---

## 8) Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-01 | Core actions should target sub-1s perceived response in normal local conditions |
| NFR-02 | Runtime persistence must avoid monolith write bottlenecks |
| NFR-03 | Data writes must be validated and corruption-resistant |
| NFR-04 | UI interactions must degrade gracefully on transient API failures |
| NFR-05 | Architecture and docs must remain traceable and auditable |
| NFR-06 | Error messages must be understandable and actionable for non-technical users |
| NFR-07 | Production must not require Redis/MongoDB or a mandatory API disk volume when Blob is configured |
| NFR-08 | Blob debounce and transfer paths must respect free-tier upload/body limits |
| NFR-09 | `FRONTEND_ORIGIN` required in production; `VITE_API_BASE_URL` required for split-host Production builds |
| NFR-10 | Groq/Tavily secrets never logged; prefer server env, allow optional browser-local keys for Summary |
| NFR-11 | AI Summary must degrade to local digest brief when Groq is unavailable (`degraded: true`) rather than hard-failing when a brief can be built |

---

## 9) Business Guidelines

- Prioritize reliability and trust over cosmetic feature expansion.
- Keep data ownership local-first with explicit user-controlled import/export.
- Maintain profile separation semantics as a product integrity requirement.
- Preserve showcase integrity for demos and training.
- Ship documentation and changelog updates with behavior changes.

---

## 10) Technical Guidelines

- Validate all inbound mutation payloads (Zod-backed contracts).
- Use batch endpoints for high-frequency multi-item operations.
- Coalesce persistence writes where safe; use longer debounce on Blob.
- Keep recurrence identity deterministic across startup/reload/mutation paths.
- Enforce read-only profile safeguards at API level (never UI-only).
- Prefer Blob staging over raising serverless body limits for large transfers; fall back to export **parts** paging when Blob is unavailable.
- Do not rename legacy API keys lightly (`last7Days`); document semantic divergence.
- Never log Groq/Tavily API keys (server or client-supplied).
- Import must validate **per row** so one bad record cannot discard an entire array.

---

## 11) Success Metrics

- Faster core action completion times
- Reduced recurrence integrity defects
- Improved daily/weekly engagement depth
- Stable export/import success rates (including Blob-staged paths)
- High friendly-error coverage on failure paths
- Zero showcase mutation escapes

Detailed definitions: `PRODUCT_METRICS.md` and `METRICS_AND_OKRS.md`.

---

## 12) Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Recurrence regression under complex edits | Deterministic normalization + regression tests |
| Performance degradation with growth | Batch operations + non-monolith runtime persistence |
| Data inconsistency across profile scope | Profile-aware API filtering and validation |
| Documentation drift | Documentation standard + traceability updates per release |
| Unclear failure communication | Centralized friendly error formatter |
| Large import/export HTTP 413 on Hobby | Blob staging (`blobPathname` / presigned download) |
| Blob free-tier upload pressure | Longer Blob write debounce; avoid boot-time full sync/save |

---

## 13) Release Readiness Checklist

- Functional requirements verified (including FR-13–FR-24)
- Core NFR checks completed
- Variable/metric definitions reconciled
- Traceability matrix updated
- Guardrails and API contracts current
- Changelog entry published
- Deployment env vars verified for target topology

---

## 14) Related Documents

- Personas: `USER_PERSONAS.md`
- Stories: `USER_STORIES.md`
- Architecture: `ARCHITECTURE.md`
- Guardrails: `GUARDRAILS.md`
- Traceability: `TRACEABILITY_MATRIX.md`
