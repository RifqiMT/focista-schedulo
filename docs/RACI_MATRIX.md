# RACI Matrix

**Last updated:** 2026-05-04  
**Owner:** Product Operations

---

## Purpose

Define clear responsibility ownership for product development, delivery governance, quality validation, and documentation maintenance.

Legend:

- **R** = Responsible (does the work)
- **A** = Accountable (final owner/sign-off)
- **C** = Consulted (two-way input)
- **I** = Informed (kept updated)

---

## Role Definitions

| Role | Description |
|---|---|
| Product Manager (PM) | Owns product scope, requirements, and release acceptance |
| Engineering Lead (Eng Lead) | Owns technical implementation quality and architectural decisions |
| Frontend Engineer (FE) | Owns frontend UX behavior, state logic, and interaction quality |
| Backend Engineer (BE) | Owns API behavior, data integrity, persistence, and performance safeguards |
| Designer (Design) | Owns UX/UI consistency, accessibility, and visual system quality |
| Product Analyst (Analytics) | Owns metrics, variable definitions, and OKR measurement logic |
| Product Ops (ProdOps) | Owns documentation governance, traceability, and release evidence integrity |

---

## Product and Delivery RACI

| Workstream | PM | Eng Lead | FE | BE | Design | Analytics | ProdOps |
|---|---|---|---|---|---|---|---|
| PRD updates and scope decisions | A/R | C | I | I | C | C | I |
| User persona and user story maintenance | A/R | C | I | I | C | C | I |
| Feature implementation (UI + API) | C | A | R | R | C | I | I |
| Profile scoping and policy enforcement | C | A | R | R | C | I | I |
| Recurrence integrity and data safeguards | I | A | C | R | I | C | I |
| Friendly error-message UX quality | C | A | R | R | C | I | I |
| Metrics and OKR definition updates | C | C | I | I | I | A/R | I |
| Traceability matrix maintenance | C | C | I | I | I | C | A/R |
| Design guideline governance | C | C | C | I | A/R | I | I |
| Release checklist completion | A | C | R | R | C | C | R |
| Changelog publication | C | C | I | I | I | I | A/R |

---

## Decision and Escalation Ownership

| Decision Area | Accountable | Escalation Path |
|---|---|---|
| Product scope trade-off | PM | PM -> Eng Lead -> Product Ops |
| Architecture/persistence strategy | Eng Lead | Eng Lead -> PM -> Product Ops |
| UX/accessibility standard changes | Design | Design -> PM -> Eng Lead |
| Metric definition disputes | Analytics | Analytics -> PM -> Product Ops |
| Release readiness conflict | PM + Eng Lead | PM/Eng Lead -> Product Ops |

