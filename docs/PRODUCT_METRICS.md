# Product Metrics

**Last updated:** 2026-04-30  
**Owner:** Product Analytics

---

## North-Star Metric

### NSM-01: Weekly Completed Scoped Tasks (WCST)

- **Definition:** Number of completed tasks per week in active profile scope.
- **Why it matters:** Captures real execution, not just task creation.
- **Formula:** Weekly count of tasks where `completed = true`, grouped by progress day.

---

## Core Product Metrics

| Metric ID | Metric Name | Definition | Formula | Target Direction |
|---|---|---|---|---|
| PM-01 | Task Completion Velocity | Completed tasks per active week | count(completed tasks)/active week | Up |
| PM-02 | Profile Scope Integrity | Percentage of views without cross-profile leakage defects | 1 - (scope defects / scope checks) | Up |
| PM-03 | Recurrence Integrity Rate | Recurring operations without duplicate/missing defects | successful recurrence ops / total recurrence ops | Up |
| PM-04 | Action Latency Compliance | Share of critical actions under 1 second | actions < 1000ms / total critical actions | Up |
| PM-05 | Export Reliability | Successful export operations ratio | successful exports / export attempts | Up |
| PM-06 | Import Reliability | Successful imports without data corruption | successful imports / import attempts | Up |
| PM-07 | Error Clarity Coverage | Share of failed user actions surfaced with friendly root-cause copy | friendly errors / total surfaced errors | Up |
| PM-08 | Showcase Integrity | Share of blocked mutations correctly prevented for showcase profile | blocked showcase writes / showcase write attempts | Up |

---

## Secondary Engagement Metrics

| Metric ID | Metric Name | Definition |
|---|---|---|
| EM-01 | Streak Continuity | Distribution trend of `streakDays` |
| EM-02 | XP Gain Momentum | Weekly change in `pointsToday` and cumulative XP |
| EM-03 | Productivity Insight Usage | Frequency of productivity analysis feature use |
| EM-04 | Bulk Action Adoption | Share of task maintenance done through batch operations |

---

## Quality Metrics

| Metric ID | Metric Name | Definition |
|---|---|---|
| QM-01 | Data Write Safety | No invalid or destructive persistence events |
| QM-02 | API Contract Stability | Contract-breaking changes per release |
| QM-03 | Runtime Persistence Efficiency | Average write coalescing effectiveness under high activity |

---

## Reporting Cadence

- Weekly: PM-01, PM-04, EM-02
- Bi-weekly: PM-02, PM-03, QM-01
- Monthly: PM-05, PM-06, QM-02, QM-03

