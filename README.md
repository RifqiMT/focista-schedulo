# Focista Schedulo

Plan with clarity, focus without noise, and celebrate what you complete.

Focista Schedulo is a cross-platform to-do application focused on **rich task metadata**, **project grouping**, **recurring scheduling**, **calendar + day agenda views**, **voice-to-form input**, **export**, and **light gamification**.

## Packages

- `backend` – Node + Express + TypeScript API
- `frontend` – React + Vite + TypeScript SPA

## Documentation

- `docs/PRD.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN_GUIDELINES.md`
- `docs/VARIABLES.md`
- `docs/PRODUCT_METRICS.md` and `docs/METRICS_AND_OKRS.md`
- `docs/USER_PERSONAS.md` and `docs/USER_STORIES.md`

## Running in development

From the repository root:

```bash
npm install
npm run dev
```

Open the URL printed by the frontend dev server (typically `http://localhost:5173`).

## Key concepts

- **Tasks**: title, description, priority, due date/time, duration, repetition, labels, location, reminder offset, deadline, completion state, optional project.
- **Projects**: groups of tasks with stable IDs `P1`, `P2`, ...
- **Recurring series**: stable `parentId` (`YYYYMMDD-N`) and `childId` (`${parentId}-${index}`) across edits/completion/reactivation.
- **Calendar**: month view + day agenda timeline (hourly) with multi-day duration segmentation.
- **Voice input**: speak naturally to populate task fields (priority, date/time, duration, repeat, reminder, labels, location).
- **Export**: one-button export of all projects + tasks to JSON or CSV.
- **Gamification**: points per completed task (low=1, medium=2, high=3, urgent=4), plus level/XP and streak indicators.

The backend currently persists tasks and projects to JSON files under `backend/data`, so your data survives restarts while keeping the code easy to read and extend.

