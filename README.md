# Focista Schedulo

**Last updated:** 2026-04-09  
**Owner:** Engineering (with Product)

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
| **Recurrence** | None, daily, weekly, weekdays, weekends, monthly, quarterly, yearly, custom (repeat every N days/weeks/months/quarters/years). Uses horizon-based virtual generation (multi-year) with on-demand materialization and deterministic series identity repair. |
| **Calendar** | Month grid and day-agenda timeline (hourly). Multi-day tasks split into per-day segments. Click a day to open agenda. |
| **Voice input** | One-button capture with auto-stop; transcript parsed to fill priority, date/time, duration, repeat, reminder, labels, location. |
| **Export** | JSON (projects + tasks) or CSV (record type: project/task). |
| **Gamification** | Points per completed task (low=1, medium=2, high=3, urgent=4), level and XP-to-next (lifetime `totalPoints`), streak days, achievements, and milestone tiers. **Badges** opens as a **full-viewport** portaled layer (shared shell patterns with Productivity Analysis: `.pa-fs-overlay`, `.pa-fs-chrome`); milestone grids with expand/collapse; close control matches Productivity Analysis (round **×** via `.pa-close-round`). **Day buckets** (today, streak, last 7 days, productivity charts) use **progress day**: **`dueDate`** when set; if there is **no** due date, the **local calendar day of `completedAt`**. |
| **Productivity Analysis** | Modal from the progress panel: time-range controls, daily/weekly/monthly/quarterly/annual views, multi-chart insights (`/api/productivity-insights`), optional per-project breakdown, fullscreen charts with keyboard navigation, rolling-average overlays where applicable. |
| **Task details hover** | Large hovercard portaled to `document.body`, follows pointer with on-screen clamping; **does not open** over row checkbox or action buttons (Complete / Move / Delete); closes via global pointer logic when leaving task UI + hovercard. |

---

## Tech Stack

| Layer | Technologies |
|-------|----------------|
| **Backend** | Node.js, Express, TypeScript, Zod (validation), JSON-file persistence |
| **Frontend** | React 18, Vite 6, TypeScript, React Router |
| **Workspaces** | npm workspaces: `backend`, `frontend` |

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
│   │       ├── TaskBoard.tsx           # List, calendar, day agenda, export, hovercard
│   │       ├── TaskEditorDrawer.tsx   # Create/edit, voice, labels, links
│   │       ├── ProjectSidebar.tsx
│   │       ├── GamificationPanel.tsx      # Stats, Badges, opens Productivity Analysis
│   │       ├── BadgesModalDialogBody.tsx  # Badges grid + hovercard (full-viewport shell)
│   │       ├── ProductivityAnalysisModal.tsx
│   │       ├── Toaster.tsx
│   │       └── (helpers) fullscreenApi.ts, productivityAnalysisFullscreen.ts, badgeFullscreen.ts
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
| [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md) | REST contracts, schemas, caching, integration events |
| [docs/TRACEABILITY_MATRIX.md](docs/TRACEABILITY_MATRIX.md) | Enterprise traceability matrix across persona, story, requirement, code, test, and metrics |
| [docs/GUARDRAILS.md](docs/GUARDRAILS.md) | Business and technical guardrails for safe, scalable product development |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Historical development and release log |

---

## Key Concepts

- **Task** — A unit of work with optional scheduling and metadata (priority, duration, repeat, labels, locations, links, reminder, deadline, project).
- **Project** — A grouping container for tasks; stable IDs `P1`, `P2`, …
- **Series** — A repeating task pattern (recurrence). Identified by a stable **Parent ID** (`YYYYMMDD-N`).
- **Occurrence** — A single instance of a series; may have a **Child ID** (`${parentId}-${index}`). In list view, repeating tasks can be expanded to show occurrence cards.
- **Calendar view** — Month grid plus day-agenda timeline (hourly). Multi-day tasks are segmented per day.
- **Timeframe scopes** — `yesterday`, `today`, `tomorrow`, `last_week`, `week`, `next_week`, `sprint`, `last_month`, `month`, `next_month`, `last_quarter`, `quarter`, `next_quarter`, `custom`, `all`.
- **Voice input** — Speech-to-form autofill in the task editor (priority, date/time, duration, repeat, reminder, labels, location).
- **Hovercard** — Portaled popover near the pointer with full task details (schedule, details, tags, identifiers) and clickable links/locations. Suppressed while using the row checkbox or action buttons (Complete / Move / Delete). The card uses non-blocking hit-testing so row actions remain clickable when the card overlaps them (links inside the card stay clickable).
- **Productivity Analysis** — Charts over historical completion rows from `/api/productivity-insights` (tasks, XP, level, badge milestones), opened from the progress panel.
- **Progress day** — For `/api/stats` and `/api/productivity-insights`, each **completed** task is attributed to a calendar day using **`dueDate`** when it is set; if **`dueDate`** is absent, the app uses the **local calendar date** from **`completedAt`**. Tasks with neither date do not appear in day-scoped series but still contribute to lifetime **totalPoints** and **level**.
- **Toast** — Lightweight, non-blocking notification used for success/error/info feedback (e.g., export, import, save, materialization). Implemented via the `pst:toast` event and displayed by the app-level `Toaster`.

**Header:**

- **Import** calls `POST /api/admin/import` (JSON/CSV) and triggers refresh events.
- **Sync** calls `POST /api/admin/sync-from-data` to sync & merge from `backend/data/*.json` (dedupes by id and keeps latest values), then triggers refresh events.
- **Save** calls `POST /api/admin/save-data` to persist current in-memory state to `backend/data/*.json`, then reload + normalize.
- **Export** dispatches `pst:open-export` for the task board export flow.

**Real-time Progress:** The Progress panel refreshes via Server‑Sent Events `GET /api/events` (`dataVersion`) plus UI-driven refresh events, so updates are seamless after any persisted change (task/project CRUD, imports, sync-from-data, reloads).

**API caching:** `GET /api/stats` and `GET /api/productivity-insights` use in-memory caches cleared when tasks/projects persist or when data is reloaded from disk, so the Progress panel stays aligned with the latest task state.

**Badge export (PNG):** The Badges modal includes an **Export PNG** action for **unlocked** badges. Exports are high-resolution with **transparent background** and use export-only layout tweaks (badge art dominant; badge label + star number in one row; no “Unlocked” text).

Data is persisted to JSON files under `backend/data/`, so data survives restarts and the stack remains easy to read and extend.

<!-- Last updated is listed at the top of this document. -->
