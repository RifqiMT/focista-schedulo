# Focista Schedulo Documentation Index

**Last updated:** 2026-07-22  
**Owner:** Product Operations

This index provides a complete map of product, engineering, design, analytics, and governance documentation for Focista Schedulo.

**Currency:** Last full docs-code audit **2026-07-22**. Product truths: Neon Postgres Free (Prod) / `fs` (local); selective task upserts; dual calendar-week Progress charts; AI Productivity Summary; per-row import; exclusive tooltip + single toast.

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
| `DEPLOYMENT_VERCEL.md` | Vercel SPA + Node API + Neon Postgres Prod topology, env vars, and verification checklist. |
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
| `plans/` | Architecture decision and implementation plans (e.g. Neon Postgres migration). |

---

## Coverage Statement

The documentation suite covers:

- Product overview, business value, feature logic, and user impact
- Runtime architecture, persistence strategy (fs / Neon Postgres), and API behavior
- Large-payload Neon staging for import/export and automated sync/save semantics
- Persona and story-driven product development
- Metric/OKR frameworks with definitions and ownership
- Variables and cross-variable lineage with relationship diagrams
- Design system and UI/UX operating standards
- Traceability and guardrails for enterprise-grade development discipline
- Operating model, release accountability, and decision governance
- Testing strategy, quality gates, and evidence expectations

---

## Currency Note

Baseline aligned to shipped behavior as of **2026-07-19**, including:

- Automated sync/save (no manual Sync/Save header buttons)
- Neon-staged large import/export and export **parts** paging fallback
- Per-row import validation with soft coercion
- Staged profile boot progress and production fast-path profile loading
- Calendar-week progress series under legacy key `last7Days`
- Pluggable `fs` / `neon` storage without Redis/MongoDB
- Neon on Vercel: debounce `0`, awaited task-complete persist, multi-isolate tasks freshness reload
- Plain-English achievement/milestone descriptions; exclusive tooltip + single-toast feedback
- AI Productivity Summary / Ask (Groq + optional Tavily) with degraded local brief and browser AI keys
- Comprehensive free-text task search (AND tokens)
- Analysis chart nice Y-axis ticks and Raw/Average dual-series palette
