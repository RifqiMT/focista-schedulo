# User Stories

**Last updated:** 2026-05-04  
**Owner:** Product

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

## Epic 5: Data Portability and Safety

### US-501 Import data safely
As a user, I want to import JSON/CSV data so that I can restore/migrate datasets.

**Acceptance criteria**
- Import validates input and merges without destructive overwrites.
- Profiles/projects/tasks are persisted correctly after import.

### US-502 Export data safely
As a user, I want export controls so that I can keep ownership of my data.

**Acceptance criteria**
- Export supports JSON and CSV.
- Locked profile data export follows password verification rules.

### US-503 Save and sync without monolith runtime coupling
As a user, I want runtime operations to remain fast while still supporting interchange formats.

**Acceptance criteria**
- Runtime persistence uses split files.
- Sync-from-data and save workflows do not force monolith runtime writes.

---

## Epic 6: Error Clarity and Demo Safety

### US-601 User-friendly error feedback
As a user, I want failure messages in plain language so that I understand the root cause and what to do next.

**Acceptance criteria**
- Failed actions do not show status-only messages without context.
- Error copy includes probable cause plus a suggested corrective action.

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

