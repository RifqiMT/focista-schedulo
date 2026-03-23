# User Personas — Focista Schedulo

**Last updated:** 2026-03-23  
**Owner:** Product

This document describes the primary user personas for Focista Schedulo. Personas inform feature prioritization, UX decisions, and messaging.

---

## Persona 1 — The Project Operator

**Profile:** Mid-level professional managing multiple deliverables, meetings, and cross-team dependencies. Works from a mix of desktop and browser; needs a single place to see what’s due when and to adjust quickly when scope changes.

**Primary goals:**

- Keep tasks organized by project and priority.
- Plan the day realistically using duration and calendar context.
- Move and update tasks quickly when priorities shift.

**Key behaviors:**

- Creates tasks in batches per project.
- Uses calendar and day agenda to decide what fits today vs. tomorrow.
- Tracks completion and streaks for motivation.
- Uses bulk move and delete to keep lists manageable.

**Pain points:**

- To-do lists feel noisy without a calendar view.
- Recurring admin tasks duplicate or drift over time.
- Editing recurring series is often unreliable in other tools.

**What success looks like:**

- One view to see the month and drill into a day agenda.
- Recurring tasks stay stable and predictable; can expand to see occurrences.
- Bulk operations make maintenance easy; hovercard gives full details without opening the editor.

---

## Persona 2 — The Routine Builder

**Profile:** Student or learner building habits (study, exercise, language practice). Relies on repetition and consistency; wants recurring planning to stay clean while still being able to inspect upcoming horizons when needed.

**Primary goals:**

- Set up recurring tasks and focus only on the next one.
- Capture tasks quickly, including via voice.
- Feel rewarded for consistency (streaks, points, levels).

**Key behaviors:**

- Uses weekdays/weekends and custom intervals (e.g., every 2 weeks).
- Completes tasks on mobile or laptop quickly.
- Checks progress and streak daily.

**Pain points:**

- Recurrence systems often generate many upcoming tasks at once, which feels overwhelming.
- Voice capture in other apps often fails to fill structured fields correctly.

**What success looks like:**

- Simple recurring setup; list remains collapsed by default while upcoming horizon occurrences can be expanded and inspected.
- Voice input reliably fills date/time, duration, and priority.
- Progress panel and streaks provide clear, immediate feedback.

---

## Persona 3 — The Personal Planner

**Profile:** Individual managing life admin, errands, and personal goals. Wants to remember deadlines and reminders, tag tasks with labels and locations, and avoid overloading weekends using the calendar.

**Primary goals:**

- Never miss a deadline or reminder.
- Tag tasks with labels and locations (and links) for context.
- Use calendar to balance load across the week.

**Key behaviors:**

- Uses reminders and deadlines for time-sensitive tasks.
- Switches between list and calendar views.
- Exports data occasionally for backup or analysis.

**Pain points:**

- Multi-day tasks and time blocks are hard to see clearly.
- Inconsistent IDs or recurrence behavior reduce trust in the tool.

**What success looks like:**

- Calendar reflects multi-day duration correctly with clear segments.
- Export is one click with format choice (JSON/CSV).
- Links and locations are easy to add and open from the hovercard or editor.

---

## Persona Prioritization and Coverage

| Persona | Priority | Primary Epics | Current Coverage |
|--------|----------|---------------|------------------|
| Project Operator | P0 | Task CRUD, projects, bulk actions, calendar/day agenda | Strong |
| Routine Builder | P0 | Recurrence, complete/reactivate loops, progress and milestones, voice capture | Strong |
| Personal Planner | P1 | Labels/locations/links, reminders, export, calendar balancing | Strong |

---

## Jobs-to-be-Done (JTBD)

1. When my day changes quickly, I want to reprioritize and move tasks fast so I can keep momentum.
2. When I rely on routines, I want recurrence to behave predictably so I can trust future planning.
3. When I manage personal commitments, I want schedule visibility and reminders so nothing critical slips.

---

## Anti-Personas (Out of Current Scope)

- Large multi-team PMO requiring enterprise workflow approvals.
- Real-time collaborative teams needing shared editing and role-based permissions.
- Compliance-heavy organizations requiring cloud audit trail and policy controls.

---

**Last updated:** 2026-03-23
