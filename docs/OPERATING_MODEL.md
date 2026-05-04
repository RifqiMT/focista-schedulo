# Operating Model

**Last updated:** 2026-05-04  
**Owner:** Product Operations + Engineering Management

---

## Purpose

Define how product, engineering, design, and analytics collaborate to deliver reliable releases with documentation, traceability, and quality evidence.

---

## Team Responsibilities

| Function | Primary Responsibilities |
|---|---|
| Product | PRD ownership, scope decisions, persona/story updates, release acceptance |
| Engineering | implementation, API/data integrity, performance, technical guardrails |
| Design | interaction quality, visual consistency, accessibility, component standards |
| Analytics | variables/metrics definitions, OKR instrumentation, KPI review |
| Product Ops | traceability matrix, changelog governance, release documentation completeness |

---

## Decision Rights

- **Scope decisions:** Product (with Design/Engineering input)
- **Architecture decisions:** Engineering (with Product impact sign-off)
- **Metric definitions:** Analytics + Product co-approval
- **Guardrail exceptions:** Product + Engineering joint approval required

---

## Release Workflow

1. Confirm intended scope in `PRD.md`.
2. Verify requirement coverage in `TRACEABILITY_MATRIX.md`.
3. Validate quality evidence against `TEST_STRATEGY.md`.
4. Reconcile variable and metric definitions (`VARIABLES.md`, `PRODUCT_METRICS.md`), API shapes (`API_CONTRACTS.md`), and the docs-code crosswalk when payloads or formulas change.
5. Update changelog and documentation index.
6. Release only after documentation completeness gate passes.

---

## Governance Cadence

- Weekly: product/engineering sync, risk and metric review.
- Bi-weekly: quality and defect trend review.
- Monthly: PRD and roadmap reconciliation.
- Release-close: full docs and traceability audit.

---

## Escalation Policy

Escalate immediately when any of the following occurs:

- Cross-profile data leakage regression
- Recurrence integrity failure at scale
- Save/sync/import/export data corruption risk
- Security-sensitive workflow bypass risk

