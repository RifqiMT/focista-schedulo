# Product Metrics — Focista Schedulo

**Last updated:** 2026-04-01  
**Owner:** Product Analytics

This document defines the product metrics used to evaluate the health and growth of Focista Schedulo. For OKRs and product-team metrics, see `METRICS_AND_OKRS.md`. For variable definitions and formulas, see `VARIABLES.md`.

---

## North Star Metric

### Weekly Completed, Scheduled Tasks (WCST)

| Attribute | Value |
|-----------|--------|
| **Definition** | Count of tasks that are **completed** and had scheduling intent (i.e. `dueDate` is set), grouped by week. |
| **Why it matters** | Measures users translating planning into execution, not just capturing tasks. |
| **Formula** | WCST = count(tasks where `completed === true` and `dueDate` is set) per week. |
| **Instrumentation** | Current implementation computes basic stats server-side; full WCST may require completion timestamps or explicit week grouping. |

---

## Activation Metrics

### A1 — First structured task created

| Attribute | Value |
|-----------|--------|
| **Definition** | User creates their first task with at least two structured fields beyond title (e.g. dueDate, priority, projectId, repeat). |
| **Success threshold** | Within first session. |
| **Notes** | Requires event instrumentation (planned). |

### A2 — Calendar usage

| Attribute | Value |
|-----------|--------|
| **Definition** | User switches to Calendar view and opens Day Agenda at least once. |
| **Notes** | Indicates adoption of planning workflow. |

---

## Engagement Metrics

### E1 — DAU/WAU (planned)

| Attribute | Value |
|-----------|--------|
| **Definition** | Daily and weekly active usage. |
| **Notes** | Requires user identity and telemetry (not currently shipped). |

### E2 — Tasks created per active day

| Attribute | Value |
|-----------|--------|
| **Definition** | Count of tasks created per day of usage. |
| **Notes** | Can be approximated from backend data if creation timestamps are available. |

### E3 — Recurrence adoption

| Attribute | Value |
|-----------|--------|
| **Definition** | Percentage of users (or sessions) that have at least one repeating task (`repeat !== "none"`). |
| **Notes** | Proxy for “planning ahead” behavior. |

### E4 — Voice capture adoption

| Attribute | Value |
|-----------|--------|
| **Definition** | Percentage of users who use voice input at least once per week (or per session). |
| **Notes** | Requires voice-usage instrumentation (planned). |

### E5 — Productivity Analysis engagement

| Attribute | Value |
|-----------|--------|
| **Definition** | Share of sessions (or users, when telemetry exists) that open **Productivity Analysis** at least once per week. |
| **Why it matters** | Indicates demand for historical completion, points, and streak context beyond the live stats strip. |
| **Source (current)** | Feature is shipped; session-level counts require instrumentation. Proxy: support/feedback and optional client event `pst:open-productivity` when added. |
| **Related API** | `GET /api/productivity-insights` (see `docs/API_CONTRACTS.md`, `VARIABLES.md`). |

---

## Retention Metrics

### R1 — 7-day return rate (planned)

| Attribute | Value |
|-----------|--------|
| **Definition** | Percentage of users who return within 7 days after first use. |
| **Notes** | Requires user identity and telemetry. |

### R2 — Streak continuation

| Attribute | Value |
|-----------|--------|
| **Definition** | Distribution of completion streak days (`streakDays`). |
| **Source** | `GET /api/stats` → `streakDays`. |
| **Notes** | Higher median streak indicates sustained engagement. |

---

## Quality Metrics

### Q1 — Recurrence duplication rate (goal: ~0)

| Attribute | Value |
|-----------|--------|
| **Definition** | Count or rate of duplicate persisted occurrences for the same logical series/date pair. |
| **Detection** | Backend integrity checks detect same-series same-date duplicates; UI materialization flow prevents duplicate real tasks under concurrent actions. |
| **Target** | Near zero. |

### Q4 — Recurring completion integrity (gap-fill + user toggles)

| Attribute | Value |
|-----------|--------|
| **Definition** | Recurring series behavior stays trustworthy: completing a later occurrence can **materialize missing prior dates** as completed, but **existing** occurrences are **not** forced back to completed on reload after the user marked them active. |
| **Detection** | QA on series with partial completion + mark-active on middle occurrences; verify `loadData` / file-watch reload does not revert intentional inactive rows. |
| **Target** | No unintended flips of saved completion state; gap-fill still creates missing persisted rows when appropriate. |

### Q2 — Calendar correctness rate

| Attribute | Value |
|-----------|--------|
| **Definition** | Percentage of multi-day tasks that appear on all days they span. |
| **Notes** | Verified via segmentation logic in calendar builder; can be tested with fixtures. |

### Q3 — Export success rate

| Attribute | Value |
|-----------|--------|
| **Definition** | Percentage of export attempts that produce a valid, uncorrupted file. |
| **Target** | ≥ 99%. |

---

## Metric Definitions and Variable References

See `VARIABLES.md` for:

- Priority-to-points mapping (low=1, medium=2, high=3, urgent=4)
- Level formula: `1 + floor(totalPoints / 50)`
- XP to next: `50 - (totalPoints % 50)` (or 50 when divisible)
- CalendarEntry segmentation definitions
- `stats.completedToday`, `stats.pointsToday`, `stats.totalPoints`, `stats.streakDays`

---

## Metric Ownership and Reporting Cadence

| Metric Group | Primary Owner | Secondary Owner | Reporting Cadence |
|--------------|---------------|-----------------|-------------------|
| Activation (A1, A2) | Product | Engineering | Weekly |
| Engagement (E1-E5) | Product Analytics | Product | Weekly |
| Retention (R1, R2) | Product Analytics | Product | Monthly |
| Quality (Q1-Q3) | Engineering | Product | Weekly + release gate |

---

## Data Quality Checks

Before metrics are consumed for decisions:

1. Validate no duplicate task IDs in persisted data.
2. Validate no duplicate recurring occurrences in the same series/date.
3. Validate local-date correctness for daily calculations (`completedToday`, `streakDays`, `last7Days`).
4. Validate milestone and level formulas in `/api/stats`.
5. When validating analysis releases, confirm `/api/productivity-insights` series match the Productivity Analysis modal charts (same windows and field semantics as `VARIABLES.md`).

---

## Instrumentation Backlog (Planned)

- Formal event taxonomy and naming convention.
- Dashboard mapping by audience (PM, engineering, leadership).
- Baseline/target snapshots by quarter.
- SLA for metric refresh latency and data quality alerts.

---

**Last updated:** 2026-04-01
