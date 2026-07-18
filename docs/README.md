# Focista Schedulo Documentation Index

**Last updated:** 2026-07-18  
**Owner:** Product Operations

This index provides a complete map of product, engineering, design, analytics, and governance documentation for Focista Schedulo.

---

## How to Use This Suite

1. Start with the root [`README.md`](../README.md) for product overview and local/prod setup.
2. Use `PRD.md` + `USER_PERSONAS.md` + `USER_STORIES.md` for scope and acceptance.
3. Use `VARIABLES.md` + `PRODUCT_METRICS.md` + `METRICS_AND_OKRS.md` for measurement.
4. Use `ARCHITECTURE.md` + `API_CONTRACTS.md` + `DEPLOYMENT_VERCEL.md` for implementation and ops.
5. Use `TRACEABILITY_MATRIX.md` + `GUARDRAILS.md` + `CHANGELOG.md` for release governance.
6. Follow `PRODUCT_DOCUMENTATION_STANDARD.md` whenever docs or behavior change.

---

## Core Product Documents

| File | Purpose |
|---|---|
| `PRD.md` | Product requirements, scope, goals, non-goals, release readiness. |
| `USER_PERSONAS.md` | Persona archetypes, goals, pain points, success outcomes. |
| `USER_STORIES.md` | Epic-based user stories and acceptance criteria. |
| `PRODUCT_DOCUMENTATION_STANDARD.md` | Documentation governance, update policy, and quality standard. |

---

## Analytics and Metrics

| File | Purpose |
|---|---|
| `VARIABLES.md` | Comprehensive variable catalog: names, definitions, formulas, locations, examples, and relationships. |
| `PRODUCT_METRICS.md` | Product KPI dictionary and measurement model. |
| `METRICS_AND_OKRS.md` | Team OKRs, targets, ownership, and review cadence. |

---

## Design and UX Governance

| File | Purpose |
|---|---|
| `DESIGN_GUIDELINES.md` | Theme palettes, component standards, interaction patterns, accessibility. |

---

## Engineering and Platform

| File | Purpose |
|---|---|
| `ARCHITECTURE.md` | Current system architecture, runtime topology, data flow, persistence strategy. |
| `API_CONTRACTS.md` | API endpoint contracts, request/response shapes, and integration notes. |
| `DEPLOYMENT_VERCEL.md` | Vercel SPA + Node API + Vercel Blob Prod topology, env vars, and verification checklist. |
| `DOCS_CODE_CROSSWALK.md` | Trace map between documentation claims and concrete code locations. |
| `OPERATING_MODEL.md` | Team operating model for release governance, ownership, and decision rights. |
| `TEST_STRATEGY.md` | Unit/integration/E2E expectations, regression gates, and quality evidence templates. |

---

## Governance and Compliance

| File | Purpose |
|---|---|
| `TRACEABILITY_MATRIX.md` | Enterprise-style mapping from requirement to implementation and verification. |
| `GUARDRAILS.md` | Technical/business constraints and safe-delivery boundaries. |
| `CHANGELOG.md` | Historical development log and notable release changes. |
| `RACI_MATRIX.md` | Responsibility assignment model across Product/Engineering/Design/Analytics/Ops. |
| `RELEASE_CHECKLIST_TEMPLATE.md` | Standard release sign-off checklist template for quality and documentation completeness. |
| `releases/` | Dedicated folder for serial release artifacts and draft/final release checklists. |

---

## Coverage Statement

The documentation suite covers:

- Product overview, business value, feature logic, and user impact
- Runtime architecture, persistence strategy (fs / Vercel Blob), and API behavior
- Large-payload Blob staging for import/export and automated sync/save semantics
- Persona and story-driven product development
- Metric/OKR frameworks with definitions and ownership
- Variables and cross-variable lineage with relationship diagrams
- Design system and UI/UX operating standards
- Traceability and guardrails for enterprise-grade development discipline
- Operating model, release accountability, and decision governance
- Testing strategy, quality gates, and evidence expectations

---

## Currency Note

Baseline aligned to shipped behavior as of **2026-07-18**, including:

- Automated sync/save (no manual Sync/Save header buttons)
- Blob-staged large import/export
- Staged profile boot progress and production fast-path profile loading
- Calendar-week progress series under legacy key `last7Days`
- Pluggable `fs` / `vercel-blob` storage without Redis/MongoDB
