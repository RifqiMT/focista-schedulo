# Variables Catalog — Focista Schedulo

**Last updated**: 2026-03-18  
**Owner**: Product Analytics (with Engineering)  

This document defines the key **variables** used across the product: stored fields, derived values, and product metrics. It is written to help product, analytics, and engineering align on meaning.

## Entities and storage

- **Backend persistence**: JSON files in `backend/data/`
  - `tasks.json` (source of truth for tasks)
  - `projects.json` (source of truth for projects)
- **Frontend derived variables**: built in React for calendar segmentation, grouping, sorting, and export formatting.

## Relationship chart (high level)

```mermaid
flowchart LR
  subgraph Backend
    P[Project<br/>id,name]
    T[Task<br/>id,parentId,childId,projectId,...]
    S[Stats (derived)<br/>completedToday,pointsToday,totalPoints,level,xpToNext]
  end

  subgraph Frontend
    TB[TaskBoard<br/>list + calendar]
    TE[TaskEditorDrawer<br/>voice -> draft fields]
    CE[CalendarEntry (derived)<br/>dateIso,startMin,endMin,isAllDay]
    EX[Export (derived)<br/>CSV/JSON]
  end

  P -- projectId --> T
  T -- tasks changed --> TB
  TB -- segment by date/duration --> CE
  TE -- save/update --> T
  T -- aggregate --> S
  TB -- generate --> EX
```

## Stored variables (Backend API model)

### Project

#### `project.id`

- **Friendly name**: Project ID
- **Definition**: Canonical identifier for a project.
- **Format**: `P<number>` (e.g., `P1`, `P2`)
- **Location**:
  - Sidebar project list
  - Task project indicator/pill
  - API: `/api/projects`
- **Source of truth**: Backend (standardized on load + creation)
- **Example**: `P3`

#### `project.name`

- **Friendly name**: Project name
- **Definition**: Human-readable project title.
- **Location**: Sidebar project list; move dialog
- **Source of truth**: Backend
- **Example**: `Work — Q2 Launch`

### Task

#### `task.id`

- **Friendly name**: Task ID
- **Definition**: Unique identifier for a task record.
- **Location**: Backend persistence and API.
- **Source of truth**: Backend
- **Example**: `t_1710a4...` (implementation-dependent)

#### `task.title`

- **Friendly name**: Title
- **Definition**: Short summary of what needs to be done.
- **Location**: Task cards (list/calendar), editor drawer
- **Source of truth**: Backend
- **Example**: `Prepare client proposal`

#### `task.description`

- **Friendly name**: Description
- **Definition**: Optional details/context for the task.
- **Location**: Editor drawer
- **Source of truth**: Backend
- **Example**: `Include pricing options and timeline.`

#### `task.priority`

- **Friendly name**: Priority
- **Definition**: Urgency/importance label used for sorting/visual legend and gamification points.
- **Allowed values**: `low | medium | high | urgent`
- **Location**:
  - Task card priority pill/legend
  - Calendar entry accent
  - Stats points calculation
- **Source of truth**: Backend
- **Example**: `high`

#### `task.dueDate`

- **Friendly name**: Due date
- **Definition**: Scheduled local date in ISO format for when work should happen.
- **Format**: `YYYY-MM-DD`
- **Location**: Task card; calendar month/day views
- **Source of truth**: Backend
- **Example**: `2026-03-20`

#### `task.dueTime`

- **Friendly name**: Due time
- **Definition**: Optional local time for start time within a day.
- **Format**: `HH:mm` (24-hour)
- **Location**: Task card; day agenda timeline
- **Source of truth**: Backend
- **Example**: `09:30`

#### `task.durationMinutes`

- **Friendly name**: Duration (minutes)
- **Definition**: Planned time length for the task, stored as minutes.
- **Constraints**: positive integer if set
- **Location**:
  - Task card duration pill (formatted)
  - Calendar day agenda block height
  - Calendar multi-day segmentation (spans across days)
- **Source of truth**: Backend (with series sync)
- **Example**: `90` (1h30m)

#### `task.deadlineDate`

- **Friendly name**: Deadline date
- **Definition**: Optional “must be done by” date, distinct from due schedule.
- **Format**: `YYYY-MM-DD`
- **Location**: Editor drawer; task metadata display
- **Source of truth**: Backend
- **Example**: `2026-03-25`

#### `task.deadlineTime`

- **Friendly name**: Deadline time
- **Definition**: Optional “must be done by” time for the deadline date.
- **Format**: `HH:mm`
- **Location**: Editor drawer; task metadata display
- **Source of truth**: Backend
- **Example**: `17:00`

#### `task.repeat`

- **Friendly name**: Repeat pattern
- **Definition**: Specifies recurrence type.
- **Allowed values**: `none | daily | weekly | weekdays | weekends | monthly | quarterly | yearly | custom`
- **Location**: Editor drawer; recurrence engine
- **Source of truth**: Backend
- **Example**: `weekly`

#### `task.repeatEvery`

- **Friendly name**: Repeat every (N)
- **Definition**: Custom recurrence interval (multiplier).
- **Constraints**: positive integer if set
- **Location**: Editor drawer
- **Source of truth**: Backend
- **Example**: `2` (every 2 weeks)

#### `task.repeatUnit`

- **Friendly name**: Repeat unit
- **Definition**: Unit for custom recurrence.
- **Allowed values**: `day | week | month | quarter | year`
- **Location**: Editor drawer
- **Source of truth**: Backend
- **Example**: `week`

#### `task.labels`

- **Friendly name**: Labels
- **Definition**: Free-form tags for grouping and filtering.
- **Type**: string array
- **Location**: Task cards; editor drawer
- **Source of truth**: Backend
- **Example**: `["client", "proposal"]`

#### `task.location`

- **Friendly name**: Location
- **Definition**: Optional location context (place, URL, or meeting room).
- **Location**: Editor drawer; task display
- **Source of truth**: Backend
- **Example**: `Zoom` / `Office 12B`

#### `task.reminderMinutesBefore`

- **Friendly name**: Reminder lead time
- **Definition**: Minutes before due time/date to remind the user (UI-level representation).
- **Constraints**: non-negative integer if set
- **Location**: Editor drawer
- **Source of truth**: Backend
- **Example**: `15`

#### `task.projectId`

- **Friendly name**: Project association
- **Definition**: The project a task belongs to. `null` means “All tasks” (no project).
- **Format**: `P<number>` or `null`
- **Location**: Task project indicator; project filtering
- **Source of truth**: Backend
- **Example**: `P2`

#### `task.completed`

- **Friendly name**: Completed flag
- **Definition**: Whether the task has been completed.
- **Location**: Active vs completed views; stats
- **Source of truth**: Backend
- **Example**: `true`

#### `task.cancelled`

- **Friendly name**: Cancelled flag (series deletion guard)
- **Definition**: Marks a repeating task occurrence/series as cancelled so it does not reappear via recurrence expansion.
- **Location**: Recurrence expansion + delete logic
- **Source of truth**: Backend
- **Example**: `true`

#### `task.parentId`

- **Friendly name**: Series/parent ID
- **Definition**: Stable identifier for a task’s identity group. Used for:
  - grouping completed occurrences
  - ensuring recurring series consistency
  - consistent display across views
- **Format**: `YYYYMMDD-N` (e.g., `20260318-1`)
- **Source of truth**: Backend (standardized on load + on create/update)
- **Example**: `20260318-4`

#### `task.childId`

- **Friendly name**: Occurrence ID
- **Definition**: Identifier for a specific occurrence in a recurring series.
- **Format**: `${parentId}-${occurrenceNumber}` (e.g., `20260318-4-2`)
- **Source of truth**: Backend
- **Example**: `20260318-4-7`

## Derived variables (Frontend)

### `seriesKey`

- **Friendly name**: Series key
- **Definition**: A derived key used to identify repeating series membership when normalizing IDs.
- **Formula**: `projectId :: title :: repeat :: repeatEvery :: repeatUnit`
- **Location**: Backend series normalization functions; recurrence logic
- **Example**: `P2::Prepare report::weekly::::`

### `CalendarEntry`

- **Friendly name**: Calendar segment
- **Definition**: A per-day segment of a task, derived from dueDate/dueTime + durationMinutes.
- **Key fields**:
  - `dateIso` = calendar date the segment appears on
  - `startMin`/`endMin` = minutes since midnight (0..1440)
  - `isAllDay` = true if no time and spans whole day
  - `startsToday` = whether segment starts on its task’s start day
- **Location**: Calendar month view + day agenda timeline
- **Example**: A 36-hour task produces segments on two dates.

### `exportRow.recordType`

- **Friendly name**: Export record type
- **Definition**: Indicates whether a CSV row represents a project or task.
- **Allowed values**: `project | task`
- **Location**: Export CSV generator
- **Example**: `task`

## Derived variables (Backend stats)

### `stats.completedToday`

- **Friendly name**: Tasks completed today
- **Definition**: Count of tasks completed for the current local date.
- **Formula**: implementation-derived from persisted tasks (and completion timestamps if present; currently based on stored task states and backend logic).
- **Location**: `/api/stats` response; Progress panel
- **Example**: `5`

### `stats.pointsToday`

- **Friendly name**: Points earned today
- **Definition**: Sum of points for tasks completed today.
- **Formula**: \(\sum points(priority)\) for tasks completed today.
- **Points mapping**: low=1, medium=2, high=3, urgent=4
- **Location**: `/api/stats`; Progress panel
- **Example**: `11`

### `stats.totalPoints`

- **Friendly name**: Total points
- **Definition**: Lifetime sum of points for completed tasks.
- **Location**: `/api/stats`; Progress panel

### `stats.level`

- **Friendly name**: Level
- **Definition**: Gamification level derived from total points.
- **Formula**: `floor(totalPoints / 50) + 1`
- **Location**: Progress panel
- **Example**: totalPoints=120 → level=3

### `stats.xpToNext`

- **Friendly name**: XP to next level
- **Definition**: Remaining points to reach the next level boundary.
- **Formula**: `50 - (totalPoints % 50)`
- **Location**: Progress panel
- **Example**: totalPoints=120 → xpToNext=30

