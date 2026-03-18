# PRD — Focista Schedulo

**Last updated**: 2026-03-18  
**Owner**: Product (with Engineering + Design)  

## Product summary

**Focista Schedulo** helps people plan work with clarity, focus without noise, and celebrate what they complete. It combines rich task metadata, projects, recurring scheduling, calendar + agenda views, voice-to-form input, and lightweight gamification.

## Problem statement

People struggle to keep tasks:

- **Structured** (projects, priorities, reminders, deadlines, recurrence)
- **Actionable** (quick editing, bulk actions, moving tasks)
- **Visible** (calendar context and day timeline)
- **Motivating** (feedback loops and progress tracking)

## Target users

- **Busy professionals** juggling meetings and deliverables
- **Students / learners** managing repetitive routines and projects
- **Personal productivity users** who want organization without complexity

See `USER_PERSONAS.md` for details.

## Goals

- Make it fast to create tasks with enough structure to be useful.
- Provide clear day/week/month views and a reliable agenda timeline.
- Ensure recurring series are stable (IDs, “next occurrence”, edits, deletion).
- Provide immediate feedback (real-time updates; gamification).

## Non-goals (current)

- Multi-user accounts and collaboration
- Cloud sync across devices
- External calendar two-way sync (Google/Apple) with invitations
- Time zone-aware travel scheduling (advanced)

## Current scope (shipped)

### Core tasks

- Create/edit tasks in a drawer
- Rich metadata:
  - title, description
  - priority: low/medium/high/urgent
  - due date/time
  - **duration** (stored as minutes; input supports minutes/hours/days)
  - deadline date/time
  - labels, location
  - reminder offset (minutes before)
  - completion state
  - project association
- Bulk selection + bulk delete + move

### Projects

- Create, edit, delete projects
- Project IDs are standardized as `P1`, `P2`, … (backend-enforced)
- Deleting a project deletes its tasks

### Recurrence / series logic

- Repeat types:
  - none, daily, weekly, weekdays, weekends, monthly, quarterly, yearly, custom
- Custom recurrence:
  - repeatEvery + repeatUnit (day/week/month/quarter/year)
- Upcoming occurrences:
  - frontend generates at most one “upcoming occurrence” virtual card per series
  - virtual tasks are materialized on interaction
- IDs:
  - Parent ID standardized as `YYYYMMDD-N` (backend-enforced for one-time and recurring)
  - Child ID uses `${parentId}-${index}` for occurrences

### Calendar and agenda

- Month grid calendar
- Clicking a day opens a day agenda timeline with hourly schedule
- Multi-day durations are split into per-day segments

### Voice input

- One-button voice capture that auto-stops intelligently
- Voice transcript parsed to populate fields (date/time, duration, priority, labels, location, reminder, repeat)

### Export

- One-button export with format selection:
  - JSON (projects + tasks)
  - CSV single file (recordType=project/task)

### Gamification

- `/api/stats` calculates:
  - completedToday, pointsToday, totalPoints, level, xpToNext
- Points per priority:
  - low=1, medium=2, high=3, urgent=4
- UI updates via `pst:tasks-changed` events

## User experience

### Primary flows

- **Capture**: create a task quickly (text or voice) with a due date/time and duration.
- **Organize**: group tasks into projects; label and prioritize.
- **Plan**: use calendar month + day agenda to see time distribution.
- **Execute**: complete tasks; review progress and streak/XP.

### Key UX principles

- Maintain a calm interface (clear hierarchy, minimal cognitive load)
- Show the right defaults (Active tasks by default)
- Make actions predictable and reversible where possible

## Functional requirements

- **FR-1**: Task CRUD with validation (backend schema)
- **FR-2**: Project CRUD with stable ID format `P<number>`
- **FR-3**: Recurrence engine with one upcoming occurrence per series
- **FR-4**: Calendar month view + day agenda view
- **FR-5**: Voice-to-form parsing, auto-stop, and preview transcript
- **FR-6**: Export all data as JSON/CSV
- **FR-7**: Gamification stats and real-time updates

## Non-functional requirements

- **Reliability**: IDs stable across input methods and edits.
- **Performance**: fast local operations; lists and calendar render quickly.
- **Accessibility**: focus states, readable contrast, keyboard navigation for interactive controls.

## Analytics and metrics

See `PRODUCT_METRICS.md` and `METRICS_AND_OKRS.md`.

## Risks and mitigations

- **Recurring series edge cases**: DST, time parsing, duplication.
  - Mitigation: local-date normalization, backend ID enforcement, series normalization.
- **Speech recognition variability** across browsers.
  - Mitigation: degrade gracefully; allow manual corrections.
- **Single-user local persistence** limits portability.
  - Mitigation: document “local-only”; plan cloud sync separately.

## Roadmap (suggested)

- Week view calendar with drag-to-reschedule
- Task duration blocks with resize handles
- Search and advanced filters
- Dedicated “Completed insights” view (patterns, completion time)
- Cloud sync and authentication

