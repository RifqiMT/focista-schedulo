# Product Metrics — Focista Schedulo

**Last updated:** 2026-03-18  
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
| **Definition** | Count or rate of duplicate upcoming occurrences shown for a single series. |
| **Detection** | UI can detect multiple “virtual” entries for the same `parentId` beyond one; backend can validate `childId` uniqueness per `parentId`. |
| **Target** | Near zero. |

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
| Engagement (E1-E4) | Product Analytics | Product | Weekly |
| Retention (R1, R2) | Product Analytics | Product | Monthly |
| Quality (Q1-Q3) | Engineering | Product | Weekly + release gate |

---

## Data Quality Checks

Before metrics are consumed for decisions:

1. Validate no duplicate task IDs in persisted data.
2. Validate no duplicate recurring occurrences in the same series/date.
3. Validate local-date correctness for daily calculations (`completedToday`, `streakDays`, `last7Days`).
4. Validate milestone and level formulas in `/api/stats`.

---

## Instrumentation Backlog (Planned)

- Formal event taxonomy and naming convention.
- Dashboard mapping by audience (PM, engineering, leadership).
- Baseline/target snapshots by quarter.
- SLA for metric refresh latency and data quality alerts.

---

**Last updated:** 2026-03-23
