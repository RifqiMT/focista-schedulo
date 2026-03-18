# Product Metrics — Focista Schedulo

**Last updated**: 2026-03-18  
**Owner**: Product Analytics  

This document defines the product metrics used to evaluate the health and growth of Focista Schedulo. For OKRs, see `METRICS_AND_OKRS.md`.

## North Star Metric

### Weekly Completed, Scheduled Tasks (WCST)

- **Definition**: Count of tasks that are completed **and** had scheduling intent (has `dueDate`) per week.
- **Why it matters**: Measures users translating planning into execution (not just capturing tasks).
- **Formula**:
  - WCST = count(tasks where completed=true and dueDate is set) grouped by week
- **Instrumentation notes**:
  - Current implementation computes basic stats server-side; expanding this metric requires completion timestamps.

## Activation metrics

### A1 — First structured task created

- **Definition**: User creates their first task with at least 2 structured fields beyond title (e.g., dueDate, priority, projectId, repeat).
- **Success threshold**: within first session.

### A2 — Calendar usage

- **Definition**: User switches to Calendar view and opens Day Agenda at least once.

## Engagement metrics

### E1 — DAU/WAU (planned)

- **Definition**: Daily/weekly active usage.
- **Notes**: Requires user identity and telemetry (not currently shipped).

### E2 — Tasks created per active day

- **Definition**: Count of tasks created per day of usage.

### E3 — Recurrence adoption

- **Definition**: % of users who have at least one repeating task (repeat != none).

### E4 — Voice capture adoption

- **Definition**: % of users who use voice input at least once per week.

## Retention metrics

### R1 — 7-day return rate (planned)

- **Definition**: % of users who return within 7 days after first use.
- **Notes**: Requires user identity and telemetry.

### R2 — Streak continuation

- **Definition**: Distribution of completion streak days.
- **Source**: `/api/stats` (streakDays).

## Quality metrics

### Q1 — Recurrence duplication rate (goal: ~0)

- **Definition**: Count of duplicate upcoming occurrences shown for a series.
- **Detection**:
  - UI can detect multiple “virtual” entries for same `parentId` beyond 1
  - Backend can validate `childId` uniqueness for a `parentId`

### Q2 — Calendar correctness rate

- **Definition**: % of multi-day tasks that appear on all days they span.
- **Notes**: Verified through segmentation logic in calendar builder; can be tested with fixtures.

## Metric definitions and variables

See `VARIABLES.md` for:

- Priority-to-points mapping (low=1, medium=2, high=3, urgent=4)
- Level formula
- CalendarEntry segmentation definitions

