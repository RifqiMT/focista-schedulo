# Operating Model

**Last updated:** 2026-07-22  
**Owner:** Product Operations + Engineering Management

---

## Purpose

Define how product, engineering, design, and analytics collaborate to deliver reliable releases with documentation, traceability, and quality evidence.

---

## Team Responsibilities

| Function | Primary Responsibilities |
|---|---|
| Product | PRD ownership, scope decisions, persona/story updates, release acceptance |
| Engineering | Implementation, API/data integrity, performance, technical guardrails, storage/transfer reliability |
| Design | Interaction quality, visual consistency, accessibility, component standards |
| Analytics | Variables/metrics definitions, OKR instrumentation, KPI review |
| Product Ops | Traceability matrix, changelog governance, release documentation completeness |

---

## Decision Rights

- **Scope decisions:** Product (with Design/Engineering input)
- **Architecture decisions:** Engineering (with Product impact sign-off)
- **Metric definitions:** Analytics + Product co-approval
- **Guardrail exceptions:** Product + Engineering joint approval required
- **Persistence topology changes** (e.g. introducing Redis/Mongo): Architecture decision + Product sign-off + docs gate

---

## Release Workflow

1. Confirm intended scope in `PRD.md`.
2. Verify requirement coverage in `TRACEABILITY_MATRIX.md`.
3. Validate quality evidence against `TEST_STRATEGY.md`.
4. Reconcile variable and metric definitions (`VARIABLES.md`, `PRODUCT_METRICS.md`), API shapes (`API_CONTRACTS.md`), and the docs-code crosswalk when payloads or formulas change.
5. Confirm deployment/env implications (`DEPLOYMENT_VERCEL.md`) when topology or transfer paths change.
6. Update changelog and documentation index.
7. Release only after documentation completeness gate passes (`PRODUCT_DOCUMENTATION_STANDARD.md`).

---

## Governance Cadence

| Cadence | Focus |
|---|---|
| Weekly | Product/engineering sync; risk and metric review |
| Bi-weekly | Quality and defect trend review |
| Monthly | PRD and roadmap reconciliation; OKR check-in |
| Release-close | Full docs and traceability audit |

---

## Escalation Policy

Escalate immediately when any of the following occurs:

- Cross-profile data leakage regression
- Recurrence integrity failure at scale
- Save/sync/import/export data corruption risk (including Neon transfer staging failures)
- Security-sensitive workflow bypass risk
- Production boot inability to reach interactive state
- Unexpected introduction of Redis/Mongo or monolith runtime writes

---

## Related Documents

- RACI: `RACI_MATRIX.md`
- Test strategy: `TEST_STRATEGY.md`
- Release template: `RELEASE_CHECKLIST_TEMPLATE.md`
- Guardrails: `GUARDRAILS.md`
