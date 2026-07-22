# Focista Schedulo

**Last updated:** 2026-07-22  
**Owner:** Product + Engineering  
**Version:** 0.1.0  
**Tagline:** Plan with clarity, focus without noise, and celebrate what you complete.

Focista Schedulo is a local-first productivity platform for structured planning and reliable execution. It combines profile-aware task management, deterministic recurrence, calendar and day-agenda planning, bulk operations, productivity analytics, AI productivity summaries, and gamification in one cohesive experience.

---

## Product Overview

Focista Schedulo helps users:

- Organize work by **profile**, **project**, and **priority**
- Plan realistically with **date/time**, **duration**, and **calendar context**
- Execute quickly using **bulk operations** and low-friction editing
- Measure momentum through **stats**, **streaks**, **milestones**, **badges**, and **historical productivity charts**
- Retain ownership of data through **JSON/CSV import and export**, including large-payload transfers via **Neon `transfer_staging`** in production

### Primary Benefits

| Benefit | What it means in practice |
|---|---|
| **Control** | Profile-scoped tasks, projects, and progress prevent cross-context leakage. Optional password locks protect sensitive scopes. |
| **Reliability** | Recurring series use deterministic parent/child identity; merge/dedupe and per-row import guards protect data; Vercel completions await durable Neon persist. |
| **Speed** | Neon selective row upserts (or local split-file) runtime persistence avoids monolith write bottlenecks; batch APIs reduce round-trips. |
| **Ownership** | Import/export (JSON, CSV, or Both) keeps datasets portable; locked-profile export requires credentials. |
| **Clarity** | Friendly error messages explain root cause and next steps; showcase profile `Test` is read-only for demos. |
| **Motivation** | XP, levels, streaks, calendar-week completions + XP charts, grinding milestones, badge PNG export, and AI Productivity Summary reinforce completion. |
| **Insight** | Period summaries and natural-language Ask over profile-scoped tasks (Groq + optional Tavily). |

---

## Core Capabilities

| Domain | Current Capability |
|---|---|
| Profiles | Create/edit/delete/select; optional password lock; lock indicator in selector; profile-scoped visibility; staged boot progress bar. |
| Tasks | Rich metadata (title, description, priority, due schedule, duration, repeat, reminder, labels, location, links); bulk update/move/delete; optimistic completion. |
| Projects | Stable project IDs, CRUD, profile-scoped listing, project-based filtering. |
| Recurrence | Daily/weekly/monthly/quarterly/yearly/custom intervals with deterministic normalization and occurrence handling. |
| Planning UI | List + calendar month + day-agenda timeline with timeframe filters; free-text search across all task attributes (AND tokens). |
| Productivity | `/api/stats` and `/api/productivity-insights` power progress, milestones, badges, and trend charts. **Productivity Summary** (`/api/productivity-summary*`) adds Groq + optional Tavily AI overviews and task Q&A (degrades to local brief when needed). |
| Gamification | Streaks, XP/levels, Consistency Builder, Monthly/Yearly Grinding, badges-earned milestones, badge PNG export. |
| Data Ops | Import/export with Neon staging or export **parts** paging; **per-row** import validation; **automated** sync + save after import; **AI keys** header for optional browser-local secrets. |

### Progress surface (calendar week and tooltips)

- The **Progress** panel includes two **current calendar week** charts (local **Monday–Sunday**), scoped to the active profile (or all profiles when unscoped): **This week** (completions) and **XP this week** (`last7Days[].points`).
- **Today** uses a shared champagne-amber accent (pulse + “Today” pill); day columns keep fixed bar footprints.
- Hovering a day shows a **rich tooltip**: tasks completed and XP for that day, **per-task XP (priority) min/max/average**, and **weekday-historical** completion min/max/average.
- Badges export as high-resolution PNG; cards show the **profile name**; modal headers use **`Profile: Name - Title`**.
- Achievement and milestone cards show short **plain-English descriptions** from `/api/stats`.
- Progress uses an **exclusive tooltip** slot; toasts are **one at a time** and dismiss open tooltips.
- **Productivity Summary** (Tasks toolbar): AI period summaries and task Q&A via Groq + optional Tavily. Configure keys via header **AI keys** (saved in this browser) or server env.

### Profile selector and boot UX

- Password-protected profiles show a **lock indicator** in the workspace profile dropdown and summary.
- Profile loading shows a **progress bar with staged status**; on Vercel, profiles load via a fast path before the large tasks working set.

---

## Latest Production Behaviors (Current Baseline)

- **Showcase read-only mode:** Profile named `Test` is mutation-blocked (frontend + backend) for profiles, projects, and tasks.
- **Security-sensitive deletion:** Deleting a password-protected profile requires password confirmation and backend verification.
- **Friendly error standard:** Toasts resolve backend root-cause messages and provide guidance by HTTP status class (`400`, `401`, `403`, `413`, `5xx`, etc.).
- **Export flexibility:** `JSON`, `CSV`, and `Both`; locked-profile inclusion requires password validation.
- **Large transfer path:** When Neon is configured, production imports prefer **Neon `transfer_staging`** (chunked upload). Large exports use staging off-Vercel or **parts** paging on Vercel (response body limits). Without Neon, batched `import-merge` still works against ephemeral `/tmp` on Vercel.
- **Automated persistence ops:** Sync/save run automatically after import (not on every boot for expensive paths); manual Sync/Save header buttons are removed.
- **Profile-first integrity:** Tasks, projects, progress, and insights remain scoped by active profile with resilient fallback visibility.

---

## Tech Stack

| Layer | Stack |
|---|---|
| Backend | Node.js, Express 4, TypeScript, Zod, compression, CORS |
| Frontend | React 18, Vite 6, TypeScript, React Router 6, html-to-image |
| Persistence | Pluggable `DataStorage`: local `fs` or **Neon Postgres Free** (row-per-task) |
| Tooling | npm workspaces (`backend`, `frontend`), ESLint, Vitest |
| Deployment | Vercel (SPA + optional Services) + Node API + Neon |

---

## Repository Structure

```text
focista-schedulo/
├── backend/
│   ├── src/
│   │   ├── index.ts                 # API, stats, recurrence, admin routes
│   │   ├── profileService.ts        # Profile CRUD + unlock
│   │   ├── profileSecurity.ts       # scrypt password hashing
│   │   ├── monthlyGrinding.ts       # Monthly grinding formula
│   │   ├── yearlyGrinding.ts        # Yearly grinding formula
│   │   ├── badgesEarnedMilestone.ts # Badges-earned milestone tiers
│   │   ├── capMilestoneBadges.ts    # Milestone list capping
│   │   ├── transferStaging.ts       # Large import/export Neon staging helpers
│   │   ├── exportEntities.ts        # Export filtering helpers
│   │   └── storage/                 # fs + neon adapters + migrations
│   └── data/                        # Local *.runtime.json (dev)
├── docs/
│   ├── plans/                       # Architecture plans (Neon migration, etc.)
│   └── …                            # Product documentation suite
├── frontend/
│   ├── src/
│   │   ├── App.tsx                  # Shell, import/export, auto sync/save
│   │   ├── apiClient.ts             # API base URL resolution
│   │   ├── transferImport.ts        # Client upload for large imports (Neon staging)
│   │   ├── uiExclusiveOverlay.ts    # Single tooltip/hovercard slot
│   │   ├── components/              # UI modules
│   │   ├── utils/friendlyError.ts   # User-facing error formatter
│   │   └── styles.css               # Design tokens and themes
│   └── vercel.json
├── docs/                            # Professional documentation suite
├── package.json                     # Workspace scripts
└── vercel.json
```

---

## Runtime Persistence Model

The product uses a **non-monolith runtime** strategy:

| Store | Role |
|---|---|
| Neon `tasks` (row-per-task) / local `tasks.runtime.json` | Primary task store for high-frequency mutations |
| Neon `projects` / local `projects.runtime.json` | Project store |
| Neon `profiles` / local `profiles.runtime.json` | Profile store (fast-path load in production) |
| Neon `runtime_meta` | Multi-isolate freshness (`tasks_revision`, …) |
| Neon `transfer_staging` | Temporary large import/export payloads |
| `focista-unified-data.json` | Interchange snapshot for import/export/admin (not primary runtime write path) |

- **Local development:** `backend/data/` with `STORAGE_BACKEND=fs` (default without `DATABASE_URL`).
- **Production:** Neon Postgres Free (`STORAGE_BACKEND=neon` + pooled `DATABASE_URL`).
- Debounce: ~40ms on `fs`, ~200ms on Neon off-Vercel; **`0`** on Vercel so awaited flushes complete.

See `docs/DEPLOYMENT_VERCEL.md` and `docs/ARCHITECTURE.md`.

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

| Service | Default URL |
|---|---|
| Backend | `http://localhost:4000` |
| Frontend | `http://localhost:5173` (proxies `/api`) |

### Ready workflow

```bash
npm run ready:dev
```

Runs setup, then lint, test, and build.

---

## Production Deployment (Vercel + API + Neon)

See **[docs/DEPLOYMENT_VERCEL.md](docs/DEPLOYMENT_VERCEL.md)**:

- Deploy the **Vite frontend** (and optionally API via Vercel Services).
- Persist runtime entities in **Neon Postgres Free**.
- Set **`FRONTEND_ORIGIN`** on the API in production.
- For split hosting, set **`VITE_API_BASE_URL`** on Vercel Production builds.
- Configure **`DATABASE_URL`** (pooled) for runtime persistence and large import/export staging.

Redis, MongoDB, and external object-store persistence are **not** part of the current topology.

---

## Documentation Suite

Professional product documentation lives in `docs/`:

| Document | Purpose |
|---|---|
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/PRODUCT_DOCUMENTATION_STANDARD.md](docs/PRODUCT_DOCUMENTATION_STANDARD.md) | Doc governance and quality gates |
| [docs/PRD.md](docs/PRD.md) | Product requirements |
| [docs/USER_PERSONAS.md](docs/USER_PERSONAS.md) | Target personas |
| [docs/USER_STORIES.md](docs/USER_STORIES.md) | Epics, stories, acceptance criteria |
| [docs/VARIABLES.md](docs/VARIABLES.md) | Variable catalog, formulas, relationships |
| [docs/PRODUCT_METRICS.md](docs/PRODUCT_METRICS.md) | Product KPI dictionary |
| [docs/METRICS_AND_OKRS.md](docs/METRICS_AND_OKRS.md) | Team OKRs |
| [docs/DESIGN_GUIDELINES.md](docs/DESIGN_GUIDELINES.md) | Themes, palettes, component UX |
| [docs/TRACEABILITY_MATRIX.md](docs/TRACEABILITY_MATRIX.md) | Requirement → code → verification |
| [docs/GUARDRAILS.md](docs/GUARDRAILS.md) | Business and technical limitations |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture |
| [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md) | API inventory and contracts |
| [docs/DEPLOYMENT_VERCEL.md](docs/DEPLOYMENT_VERCEL.md) | Production deployment |
| [docs/DOCS_CODE_CROSSWALK.md](docs/DOCS_CODE_CROSSWALK.md) | Docs ↔ code map |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Historical development log |
| [docs/OPERATING_MODEL.md](docs/OPERATING_MODEL.md) | Team operating model |
| [docs/TEST_STRATEGY.md](docs/TEST_STRATEGY.md) | Testing and quality gates |
| [docs/RACI_MATRIX.md](docs/RACI_MATRIX.md) | Responsibility matrix |
| [docs/RELEASE_CHECKLIST_TEMPLATE.md](docs/RELEASE_CHECKLIST_TEMPLATE.md) | Release sign-off template |

---

## Business and Technical Principles

- **Profile integrity:** Features must honor active profile boundaries.
- **Data safety:** Validate writes; merge/dedupe prevents drift and accidental duplication.
- **Performance-first iteration:** Prefer batch endpoints, debounced persistence, and reduced redundant refresh cycles. No regressions without measurement evidence.
- **Local ownership:** Users retain control through explicit import/export.
- **Human-centered recoverability:** Failures explain probable root cause and next best action without exposing secrets or stack traces.
- **Documentation parity:** Behavior changes ship with matching docs, variables, traceability, and changelog updates.

---

## Related Quick Links

- Variables and formulas: `docs/VARIABLES.md`
- API routes: `docs/API_CONTRACTS.md`
- Guardrails: `docs/GUARDRAILS.md`
- Changelog: `docs/CHANGELOG.md`
