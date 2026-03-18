# Metrics and OKRs — Focista Schedulo

**Last updated**: 2026-03-18  
**Owner**: Product  

This document frames quarterly OKRs and the metrics used to measure them. Product metric definitions live in `PRODUCT_METRICS.md`.

## Guiding principles

- **Outcome over output**: OKRs measure user impact, not feature count.
- **Leading + lagging**: mix early behavior signals with stable outcome metrics.
- **Quality gates**: reliability issues (recurrence/IDs/calendar) can block growth.

## Objective 1 — Make planning-to-execution feel effortless

**Rationale**: Users should be able to capture tasks quickly, plan in calendar context, and complete consistently.

### Key Results

- **KR1.1**: Increase WCST (Weekly Completed, Scheduled Tasks) by 30% (baseline → target).
- **KR1.2**: At least 40% of active users open Day Agenda weekly (Calendar usage A2).
- **KR1.3**: Reduce “time to first structured task” to under 60 seconds for new users (A1).

### Inputs / initiatives

- Improve task editor defaults and quick actions
- Make calendar affordances clearer (hover states, entry legibility)
- Continue improving voice parsing accuracy and auto-stop behavior

## Objective 2 — Make recurrence and calendar reliability world-class

**Rationale**: Recurrence/IDs/calendar are trust foundations; if they are unreliable, users churn.

### Key Results

- **KR2.1**: Recurrence duplication rate ≤ 0.5% of sessions (Q1).
- **KR2.2**: Calendar correctness rate ≥ 99% for multi-day tasks (Q2).
- **KR2.3**: Parent/child ID stability incidents reduced to near-zero (support/QA).

### Inputs / initiatives

- Regression tests for recurrence expansion and series normalization
- Fixtures for multi-day calendar segmentation
- Data migrations on startup remain deterministic and idempotent

## Objective 3 — Strengthen motivation loops

**Rationale**: Progress feedback increases daily engagement and habit formation.

### Key Results

- **KR3.1**: Increase average streakDays distribution median by 1 day.
- **KR3.2**: Increase pointsToday median by 20% among weekly active users.

### Inputs / initiatives

- Improve progress panel clarity and immediacy
- Add meaningful badges (optional), based on consistent behavior patterns

## Objective 4 — Improve portability and data ownership (planned)

**Rationale**: Users want their data to be exportable and eventually syncable.

### Key Results

- **KR4.1**: Export success rate ≥ 99% (no corrupted downloads).
- **KR4.2** (planned): Add import flow with validation and conflict handling.

