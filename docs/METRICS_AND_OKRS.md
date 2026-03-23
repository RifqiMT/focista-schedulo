# Metrics and OKRs — Focista Schedulo

**Last updated:** 2026-03-18  
**Owner:** Product

This document frames quarterly OKRs and the metrics used to measure them for the product team. Product metric definitions live in `PRODUCT_METRICS.md`. Variable definitions and formulas live in `VARIABLES.md`.

---

## Guiding Principles

- **Outcome over output** — OKRs measure user impact and product health, not feature count.
- **Leading and lagging** — Mix early behavior signals (e.g. calendar usage) with stable outcome metrics (e.g. WCST, streak).
- **Quality gates** — Reliability of recurrence, IDs, and calendar is a foundation; issues can block growth and trust.

---

## Objective 1 — Make planning-to-execution feel effortless

**Rationale:** Users should be able to capture tasks quickly, plan in calendar context, and complete work consistently.

### Key Results

| ID | Key result | Measurement |
|----|-------------|-------------|
| KR1.1 | Increase Weekly Completed, Scheduled Tasks (WCST) by 30% from baseline to target. | WCST (see PRODUCT_METRICS.md). |
| KR1.2 | At least 40% of active users open Day Agenda weekly (Calendar usage A2). | A2 metric. |
| KR1.3 | Reduce “time to first structured task” to under 60 seconds for new users (A1). | A1 + time-to-first-structured-task. |

### Inputs / Initiatives

- Improve task editor defaults and quick actions.
- Make calendar affordances clearer (hover states, entry legibility).
- Continue improving voice parsing accuracy and auto-stop behavior.

---

## Objective 2 — Make recurrence and calendar reliability world-class

**Rationale:** Recurrence, IDs, and calendar are trust foundations; unreliability drives churn.

### Key Results

| ID | Key result | Measurement |
|----|-------------|-------------|
| KR2.1 | Recurrence duplication rate ≤ 0.5% of sessions (Q1). | Q1 (PRODUCT_METRICS.md). |
| KR2.2 | Calendar correctness rate ≥ 99% for multi-day tasks (Q2). | Q2. |
| KR2.3 | Parent/child ID stability incidents reduced to near-zero (support/QA). | Incident tracking. |

### Inputs / Initiatives

- Regression tests for recurrence expansion and series normalization.
- Fixtures for multi-day calendar segmentation.
- Data migrations on startup remain deterministic and idempotent.

---

## Objective 3 — Strengthen motivation loops

**Rationale:** Progress feedback supports daily engagement and habit formation.

### Key Results

| ID | Key result | Measurement |
|----|-------------|-------------|
| KR3.1 | Increase average streakDays distribution median by 1 day. | stats.streakDays (VARIABLES.md). |
| KR3.2 | Increase pointsToday median by 20% among weekly active users. | stats.pointsToday. |

### Inputs / Initiatives

- Improve progress panel clarity and immediacy.
- Add meaningful badges or milestones (optional), based on consistent behavior patterns.

---

## Objective 4 — Improve portability and data ownership (planned)

**Rationale:** Users want data to be exportable and eventually syncable.

### Key Results

| ID | Key result | Measurement |
|----|-------------|-------------|
| KR4.1 | Export success rate ≥ 99% (no corrupted downloads). | Q3 (PRODUCT_METRICS.md). |
| KR4.2 | (Planned) Add import flow with validation and conflict handling. | Feature shipped. |

### Inputs / Initiatives

- Maintain reliable JSON/CSV export; add tests.
- Design and implement import flow when prioritized.

---

## Product Team Metrics Summary

| Metric type | Examples |
|-------------|----------|
| **North Star** | WCST (Weekly Completed, Scheduled Tasks). |
| **Activation** | A1 (first structured task), A2 (calendar usage). |
| **Engagement** | Recurrence adoption, voice adoption, tasks per active day. |
| **Retention** | 7-day return (planned), streak distribution. |
| **Quality** | Recurrence duplication rate, calendar correctness, export success. |
| **Motivation** | streakDays, pointsToday, level/XP. |

---

## OKR Governance Model

1. KR definitions must map to operational formulas in `PRODUCT_METRICS.md` and `VARIABLES.md`.
2. KR status updates follow monthly operating review cadence.
3. Any metric definition change requires versioned note in this document.
4. Delivery initiatives must map to requirements in `TRACEABILITY_MATRIX.md`.

---

## Quarter Execution Rhythm (Recommended)

- Week 1: Baseline and target reaffirmation
- Week 2-3: Initiative delivery and instrumentation validation
- Week 4: KPI review, retrospective, and KR confidence scoring

---

## Risk Signals for Escalation

Escalate when one or more conditions hold for two consecutive reporting cycles:

- Q1 recurrence duplication rate > 0
- Q2 calendar correctness drops below target
- R2 streak continuation trend declines with no corresponding scope change
- E3 recurrence adoption declines after recurrence-related releases

---

**Last updated:** 2026-03-23
