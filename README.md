# Focista Schedulo

**Last updated:** 2026-04-30  
**Owner:** Product + Engineering  
**Tagline:** Plan with clarity, focus without noise, and celebrate what you complete.

Focista Schedulo is a local-first productivity platform for structured planning and reliable execution. It combines profile-aware task management, deterministic recurrence, calendar/day-agenda planning, bulk operations, productivity analytics, and gamification in one cohesive experience.

---

## Product Overview

Focista Schedulo helps users:

- Organize work by **profile**, **project**, and **priority**
- Plan realistically with **date/time**, **duration**, and **calendar context**
- Execute quickly using **bulk operations** and low-friction editing
- Measure momentum through **stats**, **streaks**, **milestones**, and **historical productivity charts**

### Primary Benefits

- **Control:** Profile-scoped tasks/projects/progress prevent cross-context leakage.
- **Reliability:** Recurring series are normalized with deterministic parent/child identity.
- **Speed:** Runtime persistence uses split files to avoid monolith write bottlenecks.
- **Ownership:** Import/export workflows support JSON/CSV interoperability.

---

## Core Capabilities

| Domain | Current Capability |
|---|---|
| Profiles | Create/edit/delete/select profiles; optional password lock; profile-scoped visibility for tasks/projects/progress. |
| Tasks | Rich metadata: title, description, priority, due schedule, duration, repeat, reminder, labels, location, links, project/profile associations. |
| Projects | Stable project IDs, CRUD operations, profile-scoped listing, project-based filtering. |
| Recurrence | Daily/weekly/monthly/quarterly/yearly/custom intervals with deterministic normalization and occurrence handling. |
| Planning UI | List + calendar month + day-agenda timeline with timeframe filters and historical loading controls. |
| Productivity | `/api/stats` and `/api/productivity-insights` power progress summaries, milestones, badges, and trend charts. |
| Data Ops | Import, sync-from-data, save, export, reload with merge/dedupe safeguards and validation. |

---

## Latest Production Behaviors (Current Baseline)

- **Showcase read-only mode:** Profile named `Test` is explicitly read-only for create/update/delete flows across profiles, projects, and tasks (frontend + backend enforced).
- **Security-sensitive deletion:** Deleting a password-protected profile requires password confirmation in the delete popup and backend verification.
- **Friendly error communication standard:** Error toasts resolve backend root-cause messages and provide user-friendly guidance by status class (`400`, `401`, `403`, `5xx`, etc.).
- **Export flexibility:** Export supports `JSON`, `CSV`, and `Both` modes, with locked-profile data inclusion controlled by password validation.
- **Profile-first integrity:** Tasks, projects, progress, and insights remain scoped by active profile with fallback logic for resilient visibility.

---

## Tech Stack

| Layer | Stack |
|---|---|
| Backend | Node.js, Express, TypeScript, Zod, file-based local persistence |
| Frontend | React 18, Vite 6, TypeScript, React Router |
| Tooling | npm workspaces (`backend`, `frontend`), ESLint, Vitest, TypeScript |

---

## Repository Structure

```text
focista-schedulo/
├── backend/
│   ├── src/index.ts
│   ├── src/profileService.ts
│   ├── src/profileSecurity.ts
│   └── data/
│       ├── tasks.runtime.json
│       ├── projects.runtime.json
│       ├── profiles.runtime.json
│       └── focista-unified-data.json   # interchange snapshot for import/export workflows
├── frontend/
│   ├── src/App.tsx
│   ├── src/components/
│   └── src/styles.css
├── docs/
└── package.json
```

---

## Runtime Persistence Model

The product uses a **non-monolith runtime** strategy:

- Runtime operations (task/project/profile CRUD, completion, move, etc.) persist to:
  - `backend/data/tasks.runtime.json`
  - `backend/data/projects.runtime.json`
  - `backend/data/profiles.runtime.json`
- Unified JSON (`focista-unified-data.json`) is treated as **interchange-oriented** for import/export/admin workflows, not as the primary runtime write path.

This reduces write amplification and improves responsiveness during high-frequency actions.

---

## Local Development

### Prerequisites

- Node.js 18+
- npm 9+

### Commands

```bash
npm run setup:dev
npm run verify:dev
npm run dev
```

- Backend: `http://localhost:4000`
- Frontend: `http://localhost:5173` (with `/api` proxy)

### Ready Workflow

```bash
npm run ready:dev
```

---

## Documentation Suite

All professional product documentation artifacts are maintained in `docs/`:

- [docs/README.md](docs/README.md)
- [docs/PRODUCT_DOCUMENTATION_STANDARD.md](docs/PRODUCT_DOCUMENTATION_STANDARD.md)
- [docs/PRD.md](docs/PRD.md)
- [docs/USER_PERSONAS.md](docs/USER_PERSONAS.md)
- [docs/USER_STORIES.md](docs/USER_STORIES.md)
- [docs/VARIABLES.md](docs/VARIABLES.md)
- [docs/PRODUCT_METRICS.md](docs/PRODUCT_METRICS.md)
- [docs/METRICS_AND_OKRS.md](docs/METRICS_AND_OKRS.md)
- [docs/DESIGN_GUIDELINES.md](docs/DESIGN_GUIDELINES.md)
- [docs/TRACEABILITY_MATRIX.md](docs/TRACEABILITY_MATRIX.md)
- [docs/GUARDRAILS.md](docs/GUARDRAILS.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md)
- [docs/DOCS_CODE_CROSSWALK.md](docs/DOCS_CODE_CROSSWALK.md)
- [docs/CHANGELOG.md](docs/CHANGELOG.md)
- [docs/OPERATING_MODEL.md](docs/OPERATING_MODEL.md)
- [docs/TEST_STRATEGY.md](docs/TEST_STRATEGY.md)
- [docs/RACI_MATRIX.md](docs/RACI_MATRIX.md)
- [docs/RELEASE_CHECKLIST_TEMPLATE.md](docs/RELEASE_CHECKLIST_TEMPLATE.md)

---

## Business and Technical Principles

- **Profile integrity:** Features must honor active profile boundaries.
- **Data safety:** All write payloads are validated; merge/dedupe prevents drift and accidental duplication.
- **Performance-first iteration:** Batch endpoints, debounced persistence, and reduced redundant refresh cycles are preferred implementation patterns.
- **Local ownership:** Users retain control of their data through explicit import/export capability.
- **Human-centered recoverability:** User-facing failures must explain probable root cause and next best action without exposing raw technical noise.

