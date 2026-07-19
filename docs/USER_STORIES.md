# User Stories

**Last updated:** 2026-07-19  
**Owner:** Product

---

## Purpose

Epic-based user stories and acceptance criteria aligned to shipped Focista Schedulo behavior. Story IDs are stable for traceability (`TRACEABILITY_MATRIX.md`).

---

## Epic 1: Profile-Scoped Planning

### US-101 Select active profile

As a user, I want to select an active profile so that my tasks/projects/progress reflect only that context.

**Acceptance criteria**

- Selecting a profile updates task/project/progress scope.
- Non-selected profile data is not shown in active views.

### US-102 Manage profile security

As a user, I want optional profile password protection so that sensitive profile data is access-controlled.

**Acceptance criteria**

- Profile can be configured with or without password.
- Locked profile data cannot be fully exported without correct credentials.

### US-103 Observe boot progress while profiles load

As a user, I want staged loading feedback so that I understand startup progress on large datasets.

**Acceptance criteria**

- Profile loading shows a progress bar and staged status messaging.
- Production boot may load profiles via a fast path before the large tasks blob.
- Expensive full sync/save is not forced on every boot.

---

## Epic 2: Core Task Execution

### US-201 Create structured task

As a user, I want to create a task with structured fields so that I can plan with precision.

**Acceptance criteria**

- Task creation supports key metadata fields.
- Created tasks appear in list/calendar under current profile scope.

### US-202 Update and complete task

As a user, I want to edit and toggle completion quickly so that execution remains frictionless.

**Acceptance criteria**

- Edit and complete actions update UI optimistically.
- Failure paths recover gracefully without data corruption.

### US-203 Bulk task operations

As a user, I want bulk update/delete/move so that maintenance is fast.

**Acceptance criteria**

- Multi-select operations run with batch endpoints.
- Result feedback includes success/failure counts.

---

## Epic 3: Recurrence and Historical Integrity

### US-301 Reliable recurring series

As a routine-oriented user, I want recurring tasks to stay consistent so that future planning is trustworthy.

**Acceptance criteria**

- Series identity remains deterministic after create/edit/reload.
- Duplicate same-series/same-date persistence is prevented.

### US-302 Historical task visibility

As a user, I want to load historical tasks progressively so that performance stays high and history remains accessible.

**Acceptance criteria**

- All-history scope supports pagination.
- Jump-to-date and load-more are available and stable.

---

## Epic 4: Productivity Feedback

### US-401 View progress summary

As a user, I want quick progress stats so that I can monitor momentum.

**Acceptance criteria**

- Stats endpoint provides current streak/XP/level/milestones.
- Progress display is profile-scoped and updates after mutations.

### US-402 Analyze productivity trends

As a user, I want historical productivity analysis so that I can improve planning behavior.

**Acceptance criteria**

- Insights endpoint powers trend charts and summary views.
- Data reflects completion logic consistently.

### US-403 Interpret the current week at a glance

As a progress-motivated user, I want a **calendar-week** completion chart so that I can compare Monday–Sunday execution in my local week.

**Acceptance criteria**

- Chart renders seven bars aligned to the **current** local Monday–Sunday window for the active profile scope.
- Data source documents the legacy `last7Days` key while behaving as a calendar-week series (see `API_CONTRACTS.md`).

### US-404 Understand a day in historical weekday context

As a user, I want rich bar tooltips so that I can see same-weekday completion patterns, not only the current week.

**Acceptance criteria**

- Tooltip shows counts, day XP, per-task XP min/max/average when completions exist.
- Tooltip includes weekday-historical min/max/average completion counts over the filtered timeline.

### US-405 Export and share badges

As a user, I want to export badge artwork so that I can share milestones outside the app.

**Acceptance criteria**

- PNG export produces high-resolution images; cards emphasize profile **name**; modal header may show **name and title** for consistency with other dialogs.

### US-406 See locked profiles in the selector

As a security-conscious user, I want a clear **lock** affordance on password-protected profiles so that I know which scope requires unlock or export credentials.

**Acceptance criteria**

- Workspace profile dropdown/summary shows a lock indicator for protected profiles (see `ProfileManagement`).

---

### US-407 Read plain-English achievement and milestone goals

As a progress-motivated user, I want short plain-English descriptions on achievement and milestone cards so that I understand goals without reading technical formula language.

**Acceptance criteria**

- Achievement cards render `description` from `/api/stats`.
- Milestone cards render optional `description` under the card title (including badges-earned).
- Copy matches the canonical strings documented in `VARIABLES.md`.

### US-408 Non-competing feedback overlays

As a user, I want tooltips and toasts not to stack confusingly so that I can read one feedback surface at a time.

**Acceptance criteria**

- At most one custom tooltip/hovercard is visible app-wide (`uiExclusiveOverlay`).
- Enqueueing a toast dismisses any active exclusive tooltip.
- The toast queue retains a single toast (replace, do not stack).

### US-409 Generate an AI productivity summary

As a progress-motivated user, I want an AI summary of my to-do list for a chosen timeline so that I can reflect on what I finished and what remains.

**Acceptance criteria**

- Tasks toolbar exposes **Summary** next to Add task.
- User can select a timeline unit (day, week, sprint, month, bi-month, quarter, semester, year, custom) and a **This / Next** offset where supported.
- `POST /api/productivity-summary` returns a professional, cohesive plain-English narrative grounded in profile-scoped task digests (Groq).
- When open or overdue tasks exist in the digest, the summary includes dedicated **Open tasks** and/or **Overdue tasks** sections listing each task’s name and ID.
- Optional Tavily web enrich can add cited tips without inventing task facts.
- Missing `GROQ_API_KEY` returns a clear 503; UI shows a friendly message.

### US-410 Ask questions about my tasks

As a user, I want to ask natural-language questions about my to-do list so that I can find overdue, priority, or period-specific work without scanning manually.

**Acceptance criteria**

- Summary modal includes an Ask chat grounded in the selected timeline’s task digest.
- `POST /api/productivity-summary/ask` answers in professional plain English from task data only; admits when data is missing.
- When answers involve open or overdue work, responses list relevant tasks with name and ID.
- Optional Tavily enrich applies only when the user enables web context.
- When Groq is unavailable, a local digest answer may return with `degraded: true` instead of a hard failure.

### US-411 Search tasks by any attribute

As a multi-context professional, I want free-text search across all task attributes so that I can find work quickly without relying only on filters.

**Acceptance criteria**

- Search matches title, description, labels, project/profile names, priority, dates/times, duration, reminder, repeat, location, links, status, and ids.
- Every whitespace token must match (AND semantics).
- Search is scoped to the currently visible task set / active profile context in TaskBoard.

### US-413 Manage AI keys in the browser

As a user, I want to enter Groq and optional Tavily keys in the app so that Productivity Summary works without server-only secrets on every host.

**Acceptance criteria**

- Header **AI keys** opens a modal for Groq (required for Summary) and Tavily (optional).
- Keys are stored in `pst.aiKeys` localStorage; never logged by the API.
- Format checks run while typing; live validation uses `POST /api/ai-keys/validate`.
- Status pills communicate ready / needed / checking states.

---

## Epic 5: Data Portability and Safety

### US-501 Import data safely

As a user, I want to import JSON/CSV data so that I can restore/migrate datasets.

**Acceptance criteria**

- Import validates input and merges without destructive overwrites.
- Profiles/projects/tasks are persisted correctly after import.
- After a successful import, sync and save run **automatically** (quiet path acceptable).

### US-412 Import without losing valid rows

As a reliability-conscious operator, I want import to skip only malformed rows so that minor data issues do not discard my entire dataset.

**Acceptance criteria**

- JSON/CSV import uses per-row validation (`importParse.ts`) with soft coercion for common quirks (labels, link, duration, priority).
- Invalid rows are skipped and counted; valid rows still persist.
- Import toast reports skipped-row counts accurately.

### US-502 Export data safely

As a user, I want export controls so that I can keep ownership of my data.

**Acceptance criteria**

- Export supports JSON, CSV, and Both.
- Locked profile data export follows password verification rules.

### US-503 Save and sync without monolith runtime coupling

As a user, I want runtime operations to remain fast while still supporting interchange formats.

**Acceptance criteria**

- Runtime persistence uses split files (or Vercel Blob equivalents).
- Sync-from-data and save workflows do not force monolith runtime writes.
- Sync and save run **automatically** after import; manual Sync/Save header buttons are not shown.
- Quiet reload-data may run on tab return without requiring a header button.

### US-504 Transfer large datasets via Blob staging

As a production user, I want large import/export to succeed despite serverless body limits so that backups and migrations remain reliable.

**Acceptance criteria**

- Large imports may upload to Vercel Blob and call `/api/admin/import` with `blobPathname` (exactly one of `content` or `blobPathname`).
- Large exports may return a short-lived presigned Blob download URL instead of an inline body.
- When Blob transfer is unavailable and an **import** payload exceeds limits, API returns clear `413` guidance; UI surfaces friendly next steps.
- Large **exports** without Blob use parts paging so download still completes.
- `/api/admin/blob-upload` supports client upload handoff when configured.

---

## Epic 6: Error Clarity and Demo Safety

### US-601 User-friendly error feedback

As a user, I want failure messages in plain language so that I understand the root cause and what to do next.

**Acceptance criteria**

- Failed actions do not show status-only messages without context.
- Error copy includes probable cause plus a suggested corrective action.
- Status classes including `413` have dedicated friendly guidance.

### US-602 Showcase profile protection

As a showcase presenter, I want the `Test` profile to be read-only so that demo datasets remain unchanged.

**Acceptance criteria**

- Create/update/delete for profiles/projects/tasks are blocked when active/target profile is `Test`.
- Backend returns clear `403` with readable reason; frontend mirrors with disabled controls and informational toasts.

### US-603 Secure profile deletion confirmation

As a privacy-conscious user, I want password confirmation before deleting a protected profile so that destructive actions remain controlled.

**Acceptance criteria**

- Delete confirmation popup prompts for password for protected profiles.
- Backend verifies password before deletion; wrong password yields clear, non-technical error text.

---

## Story Index (Quick Reference)

| ID | Epic | Title |
|---|---|---|
| US-101 | 1 | Select active profile |
| US-102 | 1 | Manage profile security |
| US-103 | 1 | Observe boot progress while profiles load |
| US-201 | 2 | Create structured task |
| US-202 | 2 | Update and complete task |
| US-203 | 2 | Bulk task operations |
| US-301 | 3 | Reliable recurring series |
| US-302 | 3 | Historical task visibility |
| US-401 | 4 | View progress summary |
| US-402 | 4 | Analyze productivity trends |
| US-403 | 4 | Interpret the current week at a glance |
| US-404 | 4 | Understand a day in historical weekday context |
| US-405 | 4 | Export and share badges |
| US-406 | 4 | See locked profiles in the selector |
| US-407 | 4 | Read plain-English achievement and milestone goals |
| US-408 | 4 | Non-competing feedback overlays |
| US-409 | 4 | Generate an AI productivity summary |
| US-410 | 4 | Ask questions about my tasks |
| US-411 | 4 | Search tasks by any attribute |
| US-413 | 4 | Manage AI keys in the browser |
| US-501 | 5 | Import data safely |
| US-412 | 5 | Import without losing valid rows |
| US-502 | 5 | Export data safely |
| US-503 | 5 | Save and sync without monolith runtime coupling |
| US-504 | 5 | Transfer large datasets via Blob staging |
| US-601 | 6 | User-friendly error feedback |
| US-602 | 6 | Showcase profile protection |
| US-603 | 6 | Secure profile deletion confirmation |

---

## Related Documents

- Personas: `USER_PERSONAS.md`
- PRD: `PRD.md`
- Traceability: `TRACEABILITY_MATRIX.md`
