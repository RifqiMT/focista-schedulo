# User Stories — Focista Schedulo

**Last updated:** 2026-04-01  
**Owner:** Product

User stories are written in the format: **As a [role], I want [goal] so that [benefit].** Acceptance criteria define when the story is done.

---

## Capture and Edit Tasks

### US-1 Create a task (text)

As a user, I want to create a task with key details so I can plan and execute it.

**Acceptance criteria:**

- User can create a task with: title (required); description (optional); priority (optional); due date/time (optional); duration (optional); labels, locations, links (optional); reminder (optional); deadline (optional); project (optional).
- After save, the task appears in the list and, if scheduled, in the calendar.

### US-2 Edit a task

As a user, I want to edit a task so it stays accurate as my plan changes.

**Acceptance criteria:**

- Editing updates the task immediately in the list and calendar.
- Recurring tasks preserve series identity (stable Parent ID / Child ID).
- Duration and other definition-level changes propagate to series occurrences where applicable.
- Project association remains consistent across the series: tasks sharing the same Parent ID must share the same project.

### US-3 Use voice input to fill a task

As a user, I want to speak a task naturally so the app can fill fields for me.

**Acceptance criteria:**

- One button starts voice capture; capture stops automatically when speech ends.
- Parsed fields can include: priority, due date/time, duration, repeat pattern, reminder, labels, location.
- User can correct any field manually before saving.

### US-4 View full task details in a hovercard

As a user, I want to see full task details on hover so I can quickly check schedule, links, and locations without opening the editor.

**Acceptance criteria:**

- Hovering a task (or focusing the card **outside** interactive controls) shows a hovercard with grouped sections: Schedule, Details, Tags, Identifiers.
- The hovercard is **portaled** to the document body, follows the pointer, and clamps within the viewport.
- The hovercard **does not open** when the pointer enters directly on the row **checkbox** or **Complete / Move / Delete**; if already open, moving onto those controls **closes** it for that task.
- All relevant fields are shown (duration in human-readable form, e.g. “1 hour & 15 mins”).
- Links and locations are clickable and open in a new tab; alias shown when present.

---

## Projects

### US-5 Create and manage projects

As a user, I want to group tasks into projects so I can focus by context.

**Acceptance criteria:**

- User can create, rename, and delete projects.
- Project IDs remain in the format `P<number>`.
- Deleting a project deletes its tasks.

---

## Completion and Progress

### US-6 Complete and reactivate tasks

As a user, I want to complete tasks and reactivate them if needed.

**Acceptance criteria:**

- Completing a task moves it into completed views (or grouped completed section when Status = All).
- Reactivating returns the task to active without changing series identity.

### US-7 See progress and points

As a user, I want to see my progress so I feel motivated to continue.

**Acceptance criteria:**

- Progress panel shows tasks **counted today** (by **progress day**: **`dueDate`** when set; otherwise local day from **`completedAt`**), streak, level, and XP toward the next level.
- Points per completed task: low=1, medium=2, high=3, urgent=4. Lifetime **level** / **totalPoints** reflect all completed tasks.
- Stats update when tasks change (events + cache invalidation on persist; no manual refresh required for typical flows).

### US-7a Explore milestone badges

As a user, I want to browse my achievement milestones so I can see how streaks, completions, XP, and levels map to badge tiers.

**Acceptance criteria:**

- User opens **Badges** from the progress panel.
- Badges opens in a **full-viewport** portaled layer (consistent chrome with Productivity Analysis shell classes: overlay + chrome).
- Sections show streak, tasks completed, experience, and levels with expandable grids and hover detail where implemented.
- User can dismiss via **Close** (`.pa-close-round`), **Escape**, or backdrop click.

---

## Recurrence and List View

### US-8 Set a task to repeat and manage upcoming occurrences

As a user, I want recurring tasks to stay uncluttered by default while still allowing me to inspect upcoming occurrences when needed.

**Acceptance criteria:**

- For recurring series, list view stays compact by default and supports expanding occurrences for the selected timeframe.
- Future occurrences can be materialized and then opened, edited, moved, deleted, and completed like normal tasks.
- Recurring data remains stable under rapid interactions (no duplicate same-series/same-date persisted records).

### US-9 Expand repeating tasks to see occurrences

As a user, I want to expand repeating tasks in the list so I can see all related/child occurrence cards for the current timeframe.

**Acceptance criteria:**

- In list view (Today, Tomorrow, Week, etc.), repeating tasks show a “Show occurrences” / “Hide occurrences” control when there is at least one occurrence in the timeframe.
- Expanding shows occurrence cards (with optional child ID); works for both active and completed (grouped) repeating tasks, including when only one occurrence exists in the timeframe.

---

## Calendar and Agenda

### US-10 View tasks on a calendar and drill into a day agenda

As a user, I want a calendar view so I can see when tasks happen and plan my day.

**Acceptance criteria:**

- Month grid shows tasks on their respective dates.
- Clicking a day opens an agenda view with tasks on an hourly timeline.
- Multi-day tasks appear on every day they span; duration is shown in human-readable form where relevant.
- Timeframe selector supports historical/current/future/custom ranges (`yesterday`, `last_*`, `today`, `next_*`, `custom`, `all`) and reflects them in both list and calendar.

---

## Data and Links

### US-11 Add multiple links and locations to a task

As a user, I want to add one or more links and locations to a task so I can quickly open references and places.

**Acceptance criteria:**

- Task can have multiple links (stored as array); optional alias per link (e.g. `Alias=>URL`).
- Task can have multiple locations; the UI stores multiple location tokens in one backend field using a **pipe-delimited** encoding (`loc1|loc2|...`).
- Each location token may be plain text or `Label=>URL` alias; only real URLs get an “Open” link (no automatic map for non-URL text).
- Links and locations appear as clickable chips in the editor and in the hovercard; they open in a new tab.

### US-12 Export my data

As a user, I want to export my data so I can back it up or use it elsewhere.

**Acceptance criteria:**

- One export entry point; user can choose JSON or CSV.
- Export includes projects and tasks.
- Exported files can be imported back later (see US-12a) without corrupting or duplicating series data.

### US-12a Import my data (backup/restore)

As a user, I want to import a previously exported file so I can restore my tasks and projects (or migrate them) safely.

**Acceptance criteria:**

- User can import a `.json` or `.csv` export from the header Import action.
- Import merges duplicates defensively and normalizes data (project IDs, series IDs, and recurring occurrence integrity).
- After import, the UI refreshes tasks and projects without requiring a manual page refresh.

### US-13 Bulk delete and move

As a user, I want bulk actions so I can clean up and reorganize quickly.

**Acceptance criteria:**

- User can select multiple tasks.
- User can move selected tasks to another project.
- User can bulk delete selected tasks.

### US-14 Review productivity trends

As a user, I want to see how my completions, experience, level, and milestones evolve over time so I can reflect on consistency and progress.

**Acceptance criteria:**

- User can open **Productivity Analysis** from the progress panel.
- Modal loads data from `GET /api/productivity-insights` and supports choosing a historical window and timeframe aggregation.
- Charts cover tasks completed (per period and cumulative), XP, level, and cumulative milestone-style badge counts as implemented.
- User can expand a chart to fullscreen where provided; chart tooltips are fully readable (not clipped by scroll containers).
- Rolling-average overlays appear where the UI defines a second series.
- While in fullscreen, **Escape** closes fullscreen and returns to the modal.
- While in fullscreen (and not typing in an input), **ArrowLeft/ArrowRight** switches to the previous/next chart.

---

## Story-to-Requirement Mapping (Summary)

| Story IDs | Requirement Group | Primary Components / APIs |
|-----------|-------------------|----------------------------|
| US-1, US-2, US-4 | Core task lifecycle and details visibility (incl. portaled hover) | `TaskEditorDrawer.tsx`, `TaskBoard.tsx`, `POST/PUT /api/tasks` |
| US-5 | Project lifecycle and task grouping | `ProjectSidebar.tsx`, `/api/projects` |
| US-6, US-7, US-7a, US-14 | Completion, motivation loop, badges, productivity trends | `TaskBoard.tsx`, `GamificationPanel.tsx`, `BadgesModalDialogBody.tsx`, `ProductivityAnalysisModal.tsx`, `/api/tasks/:id/complete`, `/api/stats`, `/api/productivity-insights` |
| US-8, US-9 | Recurrence and occurrence management | `TaskBoard.tsx`, `backend/src/index.ts` recurrence logic |
| US-10 | Calendar and day-agenda planning | `TaskBoard.tsx` calendar/day agenda rendering |
| US-11, US-12 | Context and data ownership | links/locations UI, export workflow |
| US-13 | High-speed list maintenance | bulk selection, move, delete actions |

---

## Coverage Status

- Implemented: US-1 through US-14, US-7a (Badges)
- Highest regression sensitivity: US-6, US-8, US-9, US-10
- Verification priority per release:
  1. Complete/reactivate (including future recurring occurrences)
  2. Recurrence identity and expansion behavior
  3. Calendar rendering and day-agenda segmentation
  4. Export integrity (JSON/CSV)
  5. Productivity insights parity with stats priority weights and **progress-day** bucketing (`dueDate` first, else `completedAt` local day)

---

<!-- Last updated is listed at the top of this document. -->
