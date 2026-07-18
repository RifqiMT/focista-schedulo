# Metrics and OKRs

**Last updated:** 2026-07-18  
**Owner:** Product

---

## Purpose

Define product-team Objectives and Key Results (OKRs) for Focista Schedulo, with supporting metrics, ownership, and review cadence. KPI definitions live in `PRODUCT_METRICS.md`; formula authority lives in `VARIABLES.md`.

---

## OKR Cycle Guidance

| Field | Guidance |
|---|---|
| Cycle | Quarterly (adjust KR baselines after each release train) |
| Review | Weekly risk sync; monthly KR check-in; quarter-end retrospective |
| Evidence | Prefer measured signals (stats, test runs, transfer logs) over anecdotes |
| Guardrail | Do not optimize a KR in ways that violate `GUARDRAILS.md` |

---

## Objective 1: Make daily execution fast and reliable

**Owner:** Engineering Lead (Accountable), Backend + Frontend (Responsible)

### Key Results

| KR | Statement | Supporting Metrics | Example Target Evidence |
|---|---|---|---|
| KR1.1 | ≥ 90% of critical actions complete under 1 second in normal local usage | PM-04 | Timing logs / `X-Server-Time-Ms` sample |
| KR1.2 | Reduce recurrence-related defect reports by 50% from previous baseline | PM-03 | Defect tracker before/after |
| KR1.3 | Achieve ≥ 99% save/sync operation success in release validation (including auto post-import path) | QM-01, PM-06 | Release checklist evidence |

---

## Objective 2: Strengthen profile-scoped planning trust

**Owner:** Product Manager (Accountable), Engineering (Responsible)

### Key Results

| KR | Statement | Supporting Metrics | Example Target Evidence |
|---|---|---|---|
| KR2.1 | Zero cross-profile data visibility regressions per release | PM-02 | Scope smoke tests |
| KR2.2 | ≥ 95% profile flow success across create/edit/lock/unlock/export paths | PM-05, PM-06 | Manual + API checks |
| KR2.3 | Profile-scoped progress reflects current state in <2 seconds post-mutation | PM-04, EM-01 | Stats refresh after complete |

---

## Objective 3: Improve measurable productivity outcomes

**Owner:** Product + Analytics

### Key Results

| KR | Statement | Supporting Metrics | Example Target Evidence |
|---|---|---|---|
| KR3.1 | Increase WCST by 20% quarter-over-quarter | NSM-01, PM-01 | Weekly completion series |
| KR3.2 | Increase median streak length by 1 day | EM-01 | `streakDays` distribution |
| KR3.3 | Increase productivity analysis feature adoption by 30% | EM-03, EM-05 | Modal open proxies |
| KR3.4 | Increase badge PNG export adoption by 15% among Progress users | EM-06 | Export action counts when instrumented |

---

## Objective 4: Maintain enterprise-grade documentation and traceability

**Owner:** Product Ops (Accountable), Product + Engineering (Consulted)

### Key Results

| KR | Statement | Supporting Metrics | Example Target Evidence |
|---|---|---|---|
| KR4.1 | 100% of major feature changes reflected in docs and changelog before release close | QM-04 | `CHANGELOG.md` + PRD/stories |
| KR4.2 | 100% of functional requirements mapped in traceability matrix | Traceability coverage | `TRACEABILITY_MATRIX.md` |
| KR4.3 | Zero unresolved doc-to-code mismatches in release audit | QM-04 | `DOCS_CODE_CROSSWALK.md` checklist |

---

## Objective 5: Improve failure communication quality

**Owner:** Frontend Engineering (Responsible), Product (Accountable)

### Key Results

| KR | Statement | Supporting Metrics | Example Target Evidence |
|---|---|---|---|
| KR5.1 | 100% of top user-facing failure paths use friendly root-cause messages | PM-07 | Error-path audit |
| KR5.2 | Reduce “unclear error” user feedback incidents by 60% | PM-07 (qualitative companion) | Feedback triage |
| KR5.3 | Keep showcase profile mutation-block correctness at 100% | PM-08 | `Test` regression suite |
| KR5.4 | 100% of shipped achievement/milestone cards expose plain-English `description` | EM-08 | `/api/stats` + UI audit |

---

## Objective 6: Make production data operations resilient at scale

**Owner:** Engineering Lead (Accountable), Backend (Responsible)

### Key Results

| KR | Statement | Supporting Metrics | Example Target Evidence |
|---|---|---|---|
| KR6.1 | ≥ 95% success for Blob-staged large import/export when configured | PM-09 | Prod/staging transfer logs |
| KR6.2 | Zero releases that introduce Redis/Mongo as required Prod persistence without architecture approval | Guardrail compliance | Architecture review |
| KR6.3 | ≥ 99% of production boots reach interactive state with staged progress feedback | PM-10 | Boot UX validation |

---

## Metric-to-OKR Map

| Metric | Objectives |
|---|---|
| NSM-01 WCST | O3 |
| PM-01 … PM-04 | O1, O2, O3 |
| PM-05, PM-06, PM-09 | O2, O6 |
| PM-07, PM-08 | O5 |
| PM-10 | O6 |
| EM-01 … EM-07 | O3 |
| QM-01 … QM-05 | O1, O4, O6 |

---

## Review Cadence

| Forum | Frequency | Focus |
|---|---|---|
| Product/Engineering sync | Weekly | Risks, KR blockers, latency/integrity |
| Quality review | Bi-weekly | Defects, showcase, error clarity |
| Analytics review | Monthly | WCST, streaks, adoption proxies |
| Docs/traceability audit | Release-close | KR4.* evidence |
| Quarter retrospective | Quarterly | Reset baselines; retire or raise KRs |

---

## Related Documents

- Product metrics: `PRODUCT_METRICS.md`
- Variables: `VARIABLES.md`
- Operating model: `OPERATING_MODEL.md`
- RACI: `RACI_MATRIX.md`
