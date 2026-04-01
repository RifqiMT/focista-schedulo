# Documentation Index — Focista Schedulo

**Last updated:** 2026-04-01

This folder contains product, design, and engineering documentation for Focista Schedulo. All documents are kept up to date with the current codebase and product scope.

---

## Start here

- **[../README.md](../README.md)** — Product overview, benefits, features, tech stack, how to run the app, and key concepts.

---

## Product

| Document | Description |
|----------|-------------|
| [PRD.md](PRD.md) | Product requirements: problem statement, target users, goals, current scope, functional and non-functional requirements, UX, risks, roadmap. |
| [USER_PERSONAS.md](USER_PERSONAS.md) | Target user personas: Project Operator, Routine Builder, Personal Planner. |
| [USER_STORIES.md](USER_STORIES.md) | User stories and acceptance criteria for capture, projects, completion, recurrence, calendar, export, and gamification. |
| [PRODUCT_METRICS.md](PRODUCT_METRICS.md) | Product metrics: North Star (WCST), activation, engagement, retention, quality. |
| [METRICS_AND_OKRS.md](METRICS_AND_OKRS.md) | OKRs and product-team metrics with key results and initiatives. |
| [TRACEABILITY_MATRIX.md](TRACEABILITY_MATRIX.md) | Enterprise-style traceability across personas, stories, requirements, code modules, APIs, tests, and metrics/KRs. |
| [GUARDRAILS.md](GUARDRAILS.md) | Business and technical guardrails: constraints, risk controls, data handling boundaries, and operating limits. |
| [CHANGELOG.md](CHANGELOG.md) | Historical development log with major releases, fixes, and documentation milestones. |

---

## Design

| Document | Description |
|----------|-------------|
| [DESIGN_GUIDELINES.md](DESIGN_GUIDELINES.md) | Design system: theme palettes (Indonesian Red/Gold), priority colors, typography, components (buttons, pills, task cards, hovercard, drawer, calendar), accessibility, design-to-code mapping. |

---

## Engineering

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture: repo structure, runtime topology, data model, persistence and migrations, recurrence and identity, API surface, frontend state sync, build and dev. |
| [API_CONTRACTS.md](API_CONTRACTS.md) | API contracts: health, projects, tasks, stats, productivity insights, admin reload. |
| [VARIABLES.md](VARIABLES.md) | Variable catalog: stored and derived variables with friendly name, definition, formula, location in app, source of truth, example; includes relationship chart. |
| [DOCS_CODE_CROSSWALK.md](DOCS_CODE_CROSSWALK.md) | Claim-by-claim crosswalk mapping docs to current code artifacts and a repeatable verification checklist. |

---

## Standards

| Document | Description |
|----------|-------------|
| [PRODUCT_DOCUMENTATION_STANDARD.md](PRODUCT_DOCUMENTATION_STANDARD.md) | How we write and maintain product docs: document set, ownership, writing principles, required template sections, versioning, naming and terminology. |

---

## Documentation Coverage and Status

| Area | Coverage status | Notes |
|------|------------------|-------|
| Product overview and scope | Complete | Canonical source: `PRD.md` |
| Personas and user stories | Complete | Aligned to shipped and near-term roadmap |
| Variables and formulas | Complete | Includes relationship chart and app-location mapping |
| Product metrics and OKRs | Complete | Includes operational definitions and ownership |
| Design system and component guidance | Complete | Includes color palettes, states, and accessibility |
| Architecture and API | Complete | Current backend/frontend implementation reflected |
| Traceability matrix | Complete | New enterprise matrix added |
| Guardrails and constraints | Complete | New business/technical guardrails added |
| Recurrence and timeframe parity | Complete | Horizon-based recurrence + full timeframe taxonomy documented |
| Progress-day / streak semantics | Complete | **Completion-time-first** bucketing for daily stats and productivity (`completedAt` local day, then `dueDate` as legacy fallback); lifetime points/level unchanged |
| Productivity insights API and charts | Complete | `/api/productivity-insights`, `ProductivityAnalysisModal`, variables documented |
| Task hovercard portal + control suppression | Complete | Portaled hovercard; suppressed on checkbox/actions; **pointer-events** pass-through so row actions work when overlapped |

---

**Last updated:** 2026-04-01
