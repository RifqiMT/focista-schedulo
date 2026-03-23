# Focista Schedulo

**Plan with clarity, focus without noise, and celebrate what you complete.**

Focista Schedulo is a cross-platform task and schedule management application built for professionals, students, and personal productivity users. It combines **rich task metadata**, **project grouping**, **recurring scheduling**, **calendar and day-agenda views**, **voice-to-form input**, **export**, and **lightweight gamification** in a single, focused experience.

---

## Product Overview

Focista Schedulo helps users keep tasks **structured** (projects, priorities, reminders, deadlines, recurrence), **actionable** (quick editing, bulk actions, move between projects), **visible** (calendar context and day timeline), and **motivating** (progress feedback, points, levels, and streaks).

### Key Benefits

- **Clarity** — One place to see the month and drill into a day agenda with hourly blocks and multi-day task segmentation.
- **Stability** — Recurring series use stable Parent ID and Child ID so edits and completion stay predictable.
- **Speed** — Create and edit tasks via form or voice; bulk select, move, and delete to maintain lists quickly.
- **Ownership** — Export all data as JSON or CSV with one click; data is stored locally by default.

### Core Features

| Area | Capabilities |
|------|--------------|
| **Tasks** | Title, description, priority (low/medium/high/urgent), due date/time, duration, repeat patterns, labels, locations, links, reminder, deadline, completion state, project association. Task hovercard shows full details with grouped sections and clickable links/locations. |
| **Projects** | Create, rename, delete projects. Stable IDs (`P1`, `P2`, …). Deleting a project removes its tasks. Filter the task list by project. |
| **Recurrence** | None, daily, weekly, weekdays, weekends, monthly, quarterly, yearly, custom (repeat every N days/weeks/months/quarters/years). One upcoming occurrence per series; expand to see related/child occurrences in list view (Today, Tomorrow, Week, etc.). |
| **Calendar** | Month grid and day-agenda timeline (hourly). Multi-day tasks split into per-day segments. Click a day to open agenda. |
| **Voice input** | One-button capture with auto-stop; transcript parsed to fill priority, date/time, duration, repeat, reminder, labels, location. |
| **Export** | JSON (projects + tasks) or CSV (record type: project/task). |
| **Gamification** | Points per completed task (low=1, medium=2, high=3, urgent=4), level and XP-to-next, streak days, optional achievements and milestones. |

---

## Tech Stack

| Layer | Technologies |
|-------|----------------|
| **Backend** | Node.js, Express, TypeScript, Zod (validation), JSON-file persistence |
| **Frontend** | React 18, Vite, TypeScript, React Router, Zod |
| **Workspaces** | npm workspaces: `backend`, `frontend`, optional `shared` |

---

## Repository Structure

```
focista-schedulo/
├── backend/          # Express API, persistence, migrations, stats
│   ├── src/index.ts  # Server, schemas, recurrence, normalization
│   └── data/         # tasks.json, projects.json (created on first run)
├── frontend/         # React SPA
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── styles.css
│   │   └── components/
│   │       ├── TaskBoard.tsx      # List, calendar, day agenda, export, hovercard
│   │       ├── TaskEditorDrawer.tsx
│   │       ├── ProjectSidebar.tsx
│   │       └── GamificationPanel.tsx
│   └── index.html
├── docs/             # Product and engineering documentation
└── package.json      # Root scripts (dev, build, lint)
```

---

## Running the Application

### Prerequisites

- Node.js 18+ and npm

### Development

From the repository root:

```bash
npm install
npm run dev
```

- **Backend** runs at `http://localhost:4000`
- **Frontend** runs at `http://localhost:5173` (proxies `/api` to the backend)

Open the URL printed by the frontend dev server (typically `http://localhost:5173`).

### Build

```bash
npm run build
```

Builds both backend and frontend. Backend output is in `backend/dist/`; frontend output is in `frontend/dist/`.

### Lint

```bash
npm run lint
```

Runs ESLint for backend and frontend.

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/PRD.md](docs/PRD.md) | Product requirements and scope |
| [docs/PRODUCT_DOCUMENTATION_STANDARD.md](docs/PRODUCT_DOCUMENTATION_STANDARD.md) | How we write and maintain product docs |
| [docs/USER_PERSONAS.md](docs/USER_PERSONAS.md) | Target user personas |
| [docs/USER_STORIES.md](docs/USER_STORIES.md) | User stories and acceptance criteria |
| [docs/VARIABLES.md](docs/VARIABLES.md) | Variable catalog (fields, metrics, formulas, locations) |
| [docs/PRODUCT_METRICS.md](docs/PRODUCT_METRICS.md) | Product metrics definitions |
| [docs/METRICS_AND_OKRS.md](docs/METRICS_AND_OKRS.md) | OKRs and product team metrics |
| [docs/DESIGN_GUIDELINES.md](docs/DESIGN_GUIDELINES.md) | Design system, themes, components |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture and API |
| [docs/TRACEABILITY_MATRIX.md](docs/TRACEABILITY_MATRIX.md) | Enterprise traceability matrix across persona, story, requirement, code, test, and metrics |
| [docs/GUARDRAILS.md](docs/GUARDRAILS.md) | Business and technical guardrails for safe, scalable product development |

---

## Key Concepts

- **Task** — A unit of work with optional scheduling and metadata (priority, duration, repeat, labels, locations, links, reminder, deadline, project).
- **Project** — A grouping container for tasks; stable IDs `P1`, `P2`, …
- **Series** — A repeating task pattern (recurrence). Identified by a stable **Parent ID** (`YYYYMMDD-N`).
- **Occurrence** — A single instance of a series; may have a **Child ID** (`${parentId}-${index}`). In list view, repeating tasks can be expanded to show occurrence cards.
- **Calendar view** — Month grid plus day-agenda timeline (hourly). Multi-day tasks are segmented per day.
- **Voice input** — Speech-to-form autofill in the task editor (priority, date/time, duration, repeat, reminder, labels, location).
- **Hovercard** — Popover on task hover showing full task details (schedule, details, tags, identifiers) with clickable links and locations.

Data is persisted to JSON files under `backend/data/`, so data survives restarts and the stack remains easy to read and extend.

---

**Last updated:** 2026-03-23
