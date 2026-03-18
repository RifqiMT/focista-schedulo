# User Stories — Focista Schedulo

**Last updated**: 2026-03-18  
**Owner**: Product  

## Capture and edit tasks

### US-1 Create a task (text)

As a user, I want to create a task with key details so I can plan and execute it.

**Acceptance criteria**

- User can create a task with:
  - title (required)
  - description (optional)
  - priority (optional)
  - due date/time (optional)
  - duration (optional)
  - labels/location (optional)
  - reminder (optional)
  - deadline (optional)
  - project association (optional)
- After save, the task appears in the list and (if scheduled) in the calendar.

### US-2 Edit a task

As a user, I want to edit a task so it stays accurate as my plan changes.

**Acceptance criteria**

- Editing updates the task immediately in the list/calendar.
- Recurring tasks preserve their series identity (stable parent/child IDs).
- Duration changes propagate to series occurrences where applicable.

### US-3 Use voice input to fill a task

As a user, I want to speak a task naturally so the app can fill fields for me.

**Acceptance criteria**

- One button starts voice capture; capture stops automatically when speech ends.
- Parsed fields can include:
  - priority
  - due date/time
  - duration
  - repeat pattern
  - reminder
  - labels and location
- User can still manually correct fields before saving.

## Projects

### US-4 Create and manage projects

As a user, I want to group tasks into projects so I can focus by context.

**Acceptance criteria**

- User can create, rename, and delete projects.
- Project IDs remain consistent in the `P<number>` format.
- Deleting a project deletes its tasks.

## Completion and progress

### US-5 Complete and reactivate tasks

As a user, I want to complete tasks and re-activate them if needed.

**Acceptance criteria**

- Completing a task moves it into completed views.
- Reactivating returns it to active tasks without changing its series identity.

### US-6 See progress and points

As a user, I want to see my progress so I feel motivated to continue.

**Acceptance criteria**

- Progress panel shows tasks completed today, streak, level, and XP.
- Points awarded per completed task:
  - low=1, medium=2, high=3, urgent=4
- Stats update when tasks change (no manual refresh required).

## Recurrence and calendar

### US-7 Set a task to repeat and only see the next occurrence

As a user, I want recurring tasks to show only the next upcoming occurrence so my list doesn’t get cluttered.

**Acceptance criteria**

- For a recurring series, the UI shows the active instance and a single next upcoming occurrence.
- Upcoming occurrence behaves like a normal task: can be opened, edited, and completed.

### US-8 View tasks on a calendar and drill into a day agenda

As a user, I want a calendar view so I can see when tasks happen and plan my day.

**Acceptance criteria**

- Month grid shows tasks on their respective dates.
- Clicking a day opens an agenda view showing tasks on an hourly timeline.
- Multi-day tasks appear on every day they span.

## Data management

### US-9 Export my data

As a user, I want to export my data so I can back it up or analyze it elsewhere.

**Acceptance criteria**

- One export entry point.
- User can choose JSON or CSV.
- Export includes both projects and tasks.

### US-10 Bulk delete and move

As a user, I want bulk actions so I can clean up and reorganize faster.

**Acceptance criteria**

- User can select multiple tasks.
- User can move selected tasks to a different project (subject to guardrails).
- User can bulk delete selected tasks.

