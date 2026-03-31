# PRD — Focista Schedulo

**Last updated:** 2026-04-01  
**Owner:** Product (with Engineering and Design)

---

## Product Summary

**Focista Schedulo** helps people plan work with clarity, focus without noise, and celebrate what they complete. It combines rich task metadata, projects, recurring scheduling, calendar and day-agenda views, voice-to-form input, export, and lightweight gamification in a single, focused application.

---

## Problem Statement

People struggle to keep tasks:

- **Structured** — Projects, priorities, reminders, deadlines, and recurrence are often scattered or inconsistent across tools.
- **Actionable** — Quick editing, bulk actions, and moving tasks between contexts are cumbersome in many to-do apps.
- **Visible** — Calendar context and a clear day timeline are missing or hard to use.
- **Motivating** — Feedback loops and progress tracking are absent or superficial.

Focista Schedulo addresses these by providing one place to capture, organize, schedule, and complete tasks with stable recurrence behavior and clear visual feedback.

---

## Target Users

- **Busy professionals** juggling meetings and deliverables across projects.
- **Students and learners** managing repetitive routines and study projects.
- **Personal productivity users** who want organization without unnecessary complexity.

See `USER_PERSONAS.md` for detailed personas.

---

## Goals

- Make it **fast** to create tasks with enough structure to be useful.
- Provide **clear** day, week, and month views and a reliable agenda timeline.
- Ensure **recurring series** are stable (IDs, next occurrence, edits, deletion and cancellation).
- Deliver **immediate feedback** (real-time updates, gamification stats).

---

## Non-Goals (Current)

- Multi-user accounts and collaboration
- Cloud sync across devices
- Two-way sync with external calendars (Google, Apple) and invitations
- Time-zone-aware travel scheduling (advanced)
- Native mobile apps (current focus is web)

---

## Current Scope (Shipped)

### Core Tasks

- Create and edit tasks in a drawer.
- **Rich metadata:**
  - Title, description
  - Priority: low, medium, high, urgent
  - Due date and time
  - **Duration** (stored as minutes; UI supports minutes, hours, days; hovercard and overview use human-readable format: e.g., 15 min → “15 mins”, 60 → “1 hour”, 75 → “1 hour & 15 mins”, 1440 → “1 day”, weeks and months where applicable)
  - Deadline date and time
  - **Labels** (array)
  - **Locations** (single field in API; UI can support multiple values; plain text or URL with optional alias, e.g. `Alias=>https://...`; no automatic Google Maps for non-URL text)
  - **Links** (array of URLs per task; optional alias per link, e.g. `Alias=>URL`; normalized and shown as clickable chips in editor and hovercard)
  - Reminder offset (minutes before)
  - Completion state
  - Project association
- **Task hovercard:** On hover (or non-interactive focus), a **portaled** popover shows full task details: schedule, details, tags, and identifiers. Links and locations are clickable (open in new tab). Position follows the pointer and clamps to the viewport. The hovercard **does not appear** when the pointer or focus is on the row **checkbox** or **action buttons** (Complete / Move / Delete); moving onto those controls dismisses an open hovercard for that row.
- **Task cards (list view):** Show title, date, time, duration, priority, project, Parent ID, and labels (no description, repeat, link, or virtual pill on the card itself).
- **Bulk selection:** Bulk delete and move tasks to another project.

### Projects

- Create, edit, delete projects.
- Project IDs are standardized as `P1`, `P2`, … (backend-enforced).
- Deleting a project deletes its tasks.

### Recurrence / Series Logic

- **Repeat types:** none, daily, weekly, weekdays, weekends, monthly, quarterly, yearly, custom.
- **Custom recurrence:** repeatEvery + repeatUnit (day, week, month, quarter, year).
- **Upcoming occurrences:** Frontend uses horizon-based virtual generation (multi-year) and materializes occurrences on interaction.
- **IDs:** Parent ID format `YYYYMMDD-N` (backend-enforced); Child ID is sequence-stable per occurrence after backend normalization.
- **List view expand:** Repeating tasks (Today, Tomorrow, Week, etc.) show a “Show occurrences” / “Hide occurrences” control; expanding displays related/child occurrence cards. Works for both active and completed (grouped) repeating tasks, including when there is only one occurrence in the timeframe.

### Calendar and Agenda

- Month grid calendar.
- Clicking a day opens a day-agenda timeline with hourly schedule.
- Multi-day durations are split into per-day segments.

### Voice Input

- One-button voice capture with auto-stop.
- Transcript parsed to populate priority, date/time, duration, labels, location, reminder, repeat.

### Export

- One-button export with format selection: JSON (projects + tasks) or CSV (recordType: project | task).

### Gamification

- `/api/stats` provides: completedToday, pointsToday, totalPoints, level, xpToNext, streakDays, last7Days, achievements and milestoneAchievements (streak, tasks completed, XP, levels).
- Points per priority: low=1, medium=2, high=3, urgent=4.
- **Progress day:** Day-scoped fields (e.g. completedToday, streak, last7Days, achievement thresholds tied to “today”) bucket each **completed** task by **`dueDate`** when set; if there is no due date, by the **local calendar day** of **`completedAt`**. **totalPoints** and **level** remain lifetime aggregates over all completed tasks.
- Responses are cached in memory and invalidated when task/project data is persisted or reloaded from disk.
- UI updates via `pst:tasks-changed` events and focus/visibility refresh patterns.

### Productivity Analysis

- **Entry:** Progress panel (gamification) opens a modal for deeper **historical** trends.
- **Data:** `GET /api/productivity-insights` returns a daily time series of completed-task counts, cumulative completions, XP (per day and cumulative), implied **level** from cumulative XP, and **cumulative badge-milestone unlocks** derived from the same milestone families as stats (server-side simulation across the user’s completion history).
- **UX:** Configurable day window and timeframe aggregation (daily, weekly, monthly, quarterly, annual where applicable); multiple charts (tasks, XP, level, badges); optional fullscreen per chart with keyboard navigation; dual series (raw + rolling average) on supported charts; chart tooltips portaled to avoid clipping.

### Empty State and Filters

- “No tasks yet” only when the current view (list or calendar, timeframe, status filter, grouped-by-parent) truly has no tasks to show.
- Filters: Timeframe (`yesterday`, `today`, `tomorrow`, `last_week`, `week`, `next_week`, `sprint`, `last_month`, `month`, `next_month`, `last_quarter`, `quarter`, `next_quarter`, `custom`, `all`), View (List, Calendar), Status (Active, Completed, All).

---

## User Experience

### Primary Flows

- **Capture** — Create a task quickly (form or voice) with due date/time and duration.
- **Organize** — Group tasks into projects; add labels, priority, locations, and links.
- **Plan** — Use calendar month and day agenda to see time distribution.
- **Execute** — Complete tasks; review progress, streak, and XP in the progress panel.
- **Review** — Hover tasks for full details (without obstructing row actions); expand repeating tasks in list view to see occurrences; open Productivity Analysis for long-range trends.

### Key UX Principles

- Calm interface with clear hierarchy and minimal cognitive load.
- Sensible defaults (e.g., Active tasks by default).
- Actions predictable and reversible where possible.
- Links and locations open in a new tab from hovercard and editor.

---

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-1 | Task CRUD with validation (backend schema). |
| FR-2 | Project CRUD with stable ID format `P<number>`. |
| FR-3 | Recurrence engine with virtual horizon generation, deterministic series identity repair, and list expand for occurrences. |
| FR-4 | Calendar month view and day-agenda view; multi-day segmentation. |
| FR-5 | Voice-to-form parsing, auto-stop, and transcript preview. |
| FR-6 | Export all data as JSON or CSV. |
| FR-7 | Gamification stats and real-time updates. |
| FR-8 | Task hovercard with full details and clickable links/locations; portaled rendering; pointer-aligned placement with viewport clamping; suppressed for row checkbox and action buttons. |
| FR-9 | Multi-link and multi-location (UI) with normalization and alias support where applicable. |
| FR-10 | Streak/day metrics and progress charts attribute completions to **`dueDate`** when set; undated tasks use **`completedAt`** (local day). |
| FR-11 | Productivity Analysis modal consuming `/api/productivity-insights` with range controls, aggregations, fullscreen charts, and non-clipped chart tooltips. |

---

## Non-Functional Requirements

- **Reliability** — IDs stable across input methods and edits; recurrence and calendar behavior consistent.
- **Performance** — Fast local operations; lists and calendar render quickly; reduced re-renders and heavy work.
- **Accessibility** — Focus states, readable contrast, keyboard navigation for interactive controls.

---

## Analytics and Metrics

See `PRODUCT_METRICS.md` and `METRICS_AND_OKRS.md`.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-------------|
| Recurring series edge cases (DST, time parsing, duplication) | Local-date normalization, backend ID enforcement, series normalization. |
| Speech recognition variability across browsers | Graceful degradation; allow manual corrections. |
| Single-user local persistence limits portability | Document “local-only”; plan cloud sync as a separate initiative. |

---

## Roadmap (Suggested)

- Week view calendar with drag-to-reschedule
- Task duration blocks with resize handles
- Search and advanced filters (already partially present; refine and document)
- Deeper “completion patterns” analytics (time-of-day, project breakdown) beyond current productivity series
- Cloud sync and authentication

---

## Requirements Traceability Summary

This PRD is governed together with:

- `docs/USER_PERSONAS.md` for user context
- `docs/USER_STORIES.md` for delivery-level acceptance criteria
- `docs/TRACEABILITY_MATRIX.md` for persona -> story -> requirement -> code -> test -> metric lineage
- `docs/GUARDRAILS.md` for business and technical boundaries

---

## Release Readiness Criteria

A release is considered ready only when:

1. Scope requirements are verified in both UI and API behavior.
2. Data integrity checks pass (schema validity, recurrence consistency, no duplicate IDs).
3. Core metrics remain correct (`completedToday`, `streakDays`, `level`, `xpToNext`, milestone progress).
4. Productivity insights rows stay consistent with **due-date-first** progress bucketing and priority-point rules.
5. Export paths (JSON/CSV) remain reliable.
6. Related product documentation is updated in the same release train.

---

## Assumptions and Constraints Register

| ID | Assumption / Constraint | Impact | Owner | Status |
|----|--------------------------|--------|-------|--------|
| AC-01 | Local-first JSON persistence remains the primary storage strategy | Fast setup and high data ownership | Engineering | Active |
| AC-02 | Single-user product model is the current operational scope | Collaboration flows are intentionally deferred | Product | Active |
| AC-03 | Voice input quality depends on browser speech capabilities | Requires manual fallback and correction UX | Product + Engineering | Active |
| AC-04 | Recurrence identity (`parentId`, `childId`) must remain deterministic | Core to complete/edit reliability | Engineering | Active |

---

**Last updated:** 2026-04-01
