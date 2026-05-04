# Product Requirements Document (PRD)

**Last updated:** 2026-05-04  
**Owner:** Product

---

## 1) Product Summary

Focista Schedulo is a local-first productivity application designed to help users plan, execute, and track work through profile-scoped task/project organization, recurrence intelligence, calendar planning, and gamified progress feedback.

---

## 2) Problem Statement

Users struggle with:

- fragmented planning between lists and calendar tools
- unreliable recurring task behavior
- context leakage between personal/work planning scopes
- weak motivation loops after task completion

Focista Schedulo addresses these through deterministic scheduling logic, scoped organization (profiles/projects), and measurable progress insights.

---

## 3) Product Goals

1. Deliver fast, reliable task management under active daily usage.
2. Ensure profile-aware data boundaries for tasks, projects, and progress.
3. Provide robust recurrence and historical task visibility.
4. Enable product learning through measurable metrics and trend analytics.

---

## 4) Non-Goals (Current Scope)

- Multi-user collaborative editing
- External calendar sync (Google/Outlook bi-directional)
- Enterprise RBAC/workflow approvals
- Cloud-first distributed architecture

---

## 5) Target Users

- Professionals managing multiple workstreams
- Habit/routine-oriented users with recurrence-heavy planning
- Personal planners requiring structure and reminders

Detailed profiles are documented in `USER_PERSONAS.md`.

---

## 6) Current Scope (Shipped / Active)

### 6.1 Profile Management

- Create/edit/delete/select profiles
- Optional password-protected profiles
- Profile-scoped filtering for tasks, projects, and progress modules
- Showcase read-only behavior for profile named `Test` (mutation-blocked by UI and API)
- Password confirmation required for deleting password-protected profiles

### 6.2 Task Management

- Rich metadata fields (priority, due date/time, duration, repeat rules, labels, links, locations, reminders)
- Bulk actions: delete/move/update
- Recurring task materialization and deterministic identity normalization
- Completion toggling with optimistic UI reconciliation

### 6.3 Project Management

- Project CRUD with stable IDs
- Association integrity between project and task entities

### 6.4 Planning Views

- List mode with status/timeframe controls
- Calendar month + day-agenda detail
- Historical task loading with pagination and jump-to-date support

### 6.5 Progress and Insights

- `/api/stats` for streak, XP, level, milestones, and the **current calendar week** completion series (local Monday–Sunday; exposed under the legacy response key `last7Days`)
- Per-day bar tooltips: completions and XP for that day, per-task XP (priority score) min/max/average, and **weekday-historical** completion min/max/average across the filtered timeline
- `/api/productivity-insights` for trend visualization and longitudinal analysis
- Badges and milestone UI with **high-resolution PNG export**; modal titling uses `Profile: Name - Title` while badge cards and exports emphasize **profile name** for legibility
- Profile selector surfaces a **lock indicator** for password-protected profiles

### 6.6 Data Operations

- Import (JSON/CSV)
- Export (JSON/CSV/Both)
- Save
- Sync-from-data
- Reload-data
- Friendly root-cause error messaging for failed data operations

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
| FR-08 | Data import/export/save/sync admin operations |
| FR-09 | Historical tasks availability and navigation |
| FR-10 | Performance-oriented runtime persistence (non-monolith) |
| FR-11 | User-friendly, root-cause error feedback for failed actions |
| FR-12 | Showcase read-only profile policy enforcement (`Test`) |

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

---

## 9) Business Guidelines

- Prioritize reliability and trust over cosmetic feature expansion.
- Keep data ownership local-first with explicit user-controlled import/export.
- Maintain profile separation semantics as a product integrity requirement.

---

## 10) Technical Guidelines

- Validate all inbound mutation payloads (Zod-backed contracts).
- Use batch endpoints for high-frequency multi-item operations.
- Coalesce persistence writes where safe.
- Keep recurrence identity deterministic across startup/reload/mutation paths.
- Enforce read-only profile safeguards at API level (never UI-only enforcement).

---

## 11) Success Metrics

- Faster core action completion times
- Reduced recurrence integrity defects
- Improved daily/weekly engagement depth
- Stable export/import success rates

Detailed definitions: `PRODUCT_METRICS.md` and `METRICS_AND_OKRS.md`.

---

## 12) Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Recurrence regression under complex edits | deterministic normalization + regression tests |
| Performance degradation with growth | batch operations + non-monolith runtime persistence |
| Data inconsistency across profile scope | profile-aware API filtering and validation |
| Documentation drift | documentation standard + traceability updates per release |
| Unclear failure communication | centralized friendly error formatter and status-aware fallback copy |

---

## 13) Release Readiness Checklist

- Functional requirements verified
- Core NFR checks completed
- Variable/metric definitions reconciled
- Traceability matrix updated
- Changelog entry published

