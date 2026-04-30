# Variables Documentation

**Last updated:** 2026-04-30  
**Owner:** Product Analytics + Engineering

This catalog defines core application variables with professional, implementation-aligned descriptions.

---

## Variable Relationship Chart

```mermaid
flowchart LR
  Profile[Profile]
  Project[Project]
  Task[Task]
  Stats[Stats API]
  Insights[Productivity Insights API]
  UI[TaskBoard/Gamification UI]

  Profile --> Project
  Profile --> Task
  Project --> Task
  Task --> Stats
  Task --> Insights
  Stats --> UI
  Insights --> UI
```

---

## Entity Variables

### Profile Variables

| Variable Name | Friendly Name | Definition | Formula | App Location | Example |
|---|---|---|---|---|---|
| `profile.id` | Profile Identifier | Unique profile key used for scoping projects/tasks/progress. | n/a | backend profile routes, frontend active profile state | `pf_01` |
| `profile.name` | Profile Name | User-facing profile label. | n/a | Profile hub UI, profile scoping header | `Rifqi Tjahyono` |
| `profile.title` | Profile Title | Secondary profile descriptor. | n/a | Profile hub, active profile display | `Product Builder` |
| `profile.passwordHash` | Profile Security Hash | Optional hashed password for locked profile access/export control. | hash(password) | backend profile security layer | `$scrypt$...` |

### Project Variables

| Variable Name | Friendly Name | Definition | Formula | App Location | Example |
|---|---|---|---|---|---|
| `project.id` | Project Identifier | Stable project key. | normalized sequence | project sidebar, task association | `P3` |
| `project.name` | Project Name | User-defined project label. | n/a | project sidebar, filters, move dialog | `Workstream Alpha` |
| `project.profileId` | Project Profile Scope | Profile owner of project. | n/a | backend filters + frontend project loading | `pf_01` |

### Task Variables

| Variable Name | Friendly Name | Definition | Formula | App Location | Example |
|---|---|---|---|---|---|
| `task.id` | Task Identifier | Unique persisted task ID. | n/a | task CRUD APIs and list rendering | `t_89ab` |
| `task.title` | Task Title | Primary actionable label for a task. | n/a | task card, editor, hovercard | `Prepare sprint plan` |
| `task.priority` | Priority | Urgency level for planning and XP scoring. | enum | task UI + stats scoring | `high` |
| `task.dueDate` | Scheduled Date | Planned day for execution. | n/a | list/calendar/progress bucketing | `2026-05-02` |
| `task.dueTime` | Scheduled Time | Planned start time. | n/a | day agenda/time displays | `09:00` |
| `task.durationMinutes` | Duration Minutes | Planned effort duration. | n/a | editor, agenda blocks, hover details | `90` |
| `task.repeat` | Recurrence Type | Repeat strategy for recurring tasks. | enum | recurrence logic and UI | `weekly` |
| `task.repeatEvery` | Recurrence Interval | Custom repeat interval factor. | n/a | custom repeat settings | `2` |
| `task.repeatUnit` | Recurrence Unit | Unit for custom interval. | enum | recurrence settings | `week` |
| `task.labels` | Labels | Categorization tags. | n/a | chips, search/filter context | `["deep-work","planning"]` |
| `task.location` | Location Value | Optional location context text/URL payload. | n/a | hovercard/editor | `Office` |
| `task.link` | External Links | Optional list of reference links. | n/a | hovercard/editor | `["https://example.com"]` |
| `task.profileId` | Task Profile Scope | Profile owner of task. | project/profile derived integrity rule | backend scope filters, frontend active profile | `pf_01` |
| `task.projectId` | Task Project Scope | Project association for grouping/filtering. | n/a | project filters and cards | `P3` |
| `task.completed` | Completion Flag | Completion state for execution and scoring. | boolean toggle | list status filters, stats APIs | `true` |
| `task.completedAt` | Completion Timestamp | Completion event timestamp. | now() on complete | analytics/recovery logic | `2026-04-30T12:01:00.000Z` |
| `task.parentId` | Series Parent ID | Deterministic recurring-series parent key. | normalization function | recurrence grouping | `20260430-3` |
| `task.childId` | Series Child ID | Sequence identifier within recurring series. | normalization function | occurrence-level operations | `7` |

---

## Derived and Formula Variables

| Variable Name | Friendly Name | Definition | Formula | App Location | Example |
|---|---|---|---|---|---|
| `completionDateIsoLocalForTask` | Progress Day | Day bucket key for completed task metrics. | `dueDate` else local date(`completedAt`) | backend stats and insights | `2026-04-30` |
| `stats.totalPoints` | Lifetime XP | Total weighted points over completed tasks. | sum(priorityWeight(task.priority)) | `/api/stats` | `420` |
| `stats.level` | Gamification Level | Progress level based on lifetime XP. | `1 + floor(totalPoints / 50)` | `/api/stats`, gamification UI | `9` |
| `stats.xpToNext` | XP To Next Level | Remaining points until next level threshold. | `50 - (totalPoints % 50)` (or 50) | `/api/stats` | `30` |
| `stats.completedToday` | Completed Today | Completed tasks mapped to today’s progress day. | count(progressDay == today) | gamification panel | `4` |
| `stats.streakDays` | Streak Days | Consecutive days with >=1 completion. | backward count over progressDay buckets | gamification panel | `6` |
| `activeProfileName` | Active Profile Name | Currently selected profile name used for policy gates in UI. | lookup(profile.id == activeProfileId).name | `TaskBoard.tsx`, `ProjectSidebar.tsx` | `Test` |
| `isShowcaseReadOnlyActive` | Showcase Read-only Flag | Boolean guard that disables mutation interactions for profile `Test`. | `lower(trim(activeProfileName)) == "test"` | `TaskBoard.tsx`, `ProjectSidebar.tsx`, `ProfileManagement.tsx` | `true` |
| `SHOWCASE_READONLY_MESSAGE` | Showcase Policy Message | Canonical backend message for blocked read-only profile mutations. | constant string | `backend/src/index.ts` | `Showcase mode: profile "Test" is read-only...` |
| `friendlyErrorMessage` | Friendly Error Message | Human-readable error root cause shown in toaster UI. | `backendError || fallbackByStatus(httpStatus)` | `frontend/src/utils/friendlyError.ts` | `Verification failed. Please re-check your password...` |

---

## Notes on Source of Truth

- Runtime entity truth is persisted in split runtime JSON files:
  - `tasks.runtime.json`
  - `projects.runtime.json`
  - `profiles.runtime.json`
- Metrics truth is computed server-side from persisted runtime entities.
- Unified JSON is interchange-oriented and not the primary runtime mutation store.
- Error-message source of truth is the shared friendly formatter in `frontend/src/utils/friendlyError.ts`.

