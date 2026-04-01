# Docs → Code Crosswalk — Focista Schedulo

**Last updated:** 2026-04-01  
**Owner:** Engineering (with Product)

This document is a **claim-by-claim crosswalk** between the documentation set and the current codebase. Use it as a fast verification checklist after shipping changes, refactors, or bug fixes.

---

## Canonical behavior references

- **Backend source of truth**: `backend/src/index.ts`
- **Frontend source of truth**: `frontend/src/`
- **Primary UI entry**: `frontend/src/App.tsx`

---

## Product overview (`README.md`, `docs/PRD.md`)

- **Task model (fields and rules)**
  - **Docs**: `docs/PRD.md` (Core Tasks), `docs/VARIABLES.md` (Task variables)
  - **Backend**: `TaskSchema` in `backend/src/index.ts`
  - **Frontend**: `Task` interface in `frontend/src/components/TaskBoard.tsx`

- **Projects**
  - **Docs**: `docs/PRD.md` (Projects)
  - **Backend**: `/api/projects` routes in `backend/src/index.ts`
  - **Frontend**: `frontend/src/components/ProjectSidebar.tsx`

- **Recurrence / series identity**
  - **Docs**: `docs/PRD.md` (Recurrence / Series Logic), `docs/ARCHITECTURE.md`
  - **Backend**: normalization pipeline in `loadData()` and related helpers in `backend/src/index.ts`
  - **Frontend**: repeat expansion/materialization in `frontend/src/components/TaskBoard.tsx` (`expandRepeatingTasks`, list/calendar horizons)

- **Calendar + day agenda**
  - **Docs**: `docs/PRD.md` (Calendar and Agenda)
  - **Frontend**: calendar segmentation logic in `frontend/src/components/TaskBoard.tsx` (`tasksByDate`, `renderDayAgenda`)

- **Voice input**
  - **Docs**: `docs/PRD.md` (Voice Input), `docs/USER_STORIES.md` (capture)
  - **Frontend**: `frontend/src/components/TaskEditorDrawer.tsx` (speech support, transcript parsing, field application)

- **Productivity Analysis**
  - **Docs**: `docs/PRD.md` (Productivity Analysis), `docs/API_CONTRACTS.md` (`/api/productivity-insights`)
  - **Backend**: `GET /api/productivity-insights` in `backend/src/index.ts`
  - **Frontend**: `frontend/src/components/ProductivityAnalysisModal.tsx`

---

## Data ownership (Import / Sync / Save / Export)

- **Import (JSON/CSV)**
  - **Docs**: `docs/API_CONTRACTS.md` (Admin → Import), `README.md` header section
  - **Backend**: `POST /api/admin/import` in `backend/src/index.ts`
  - **Frontend**: `importFromFile()` in `frontend/src/App.tsx`

- **Sync (merge from `backend/data/*.json`)**
  - **Docs**: `docs/API_CONTRACTS.md` (Admin → Sync-from-data), `docs/ARCHITECTURE.md` (Admin)
  - **Backend**: `POST /api/admin/sync-from-data` in `backend/src/index.ts`
  - **Frontend**: `syncAndMergeFromDataFolder()` in `frontend/src/App.tsx`

- **Save (persist & normalize)**
  - **Docs**: `docs/API_CONTRACTS.md` (Admin → Save), `README.md` header section
  - **Backend**: `POST /api/admin/save-data` in `backend/src/index.ts`
  - **Frontend**: `syncDataFromJson()` in `frontend/src/App.tsx`

- **Export**
  - **Docs**: `docs/PRD.md` (Export), `docs/API_CONTRACTS.md` (frontend integration)
  - **Frontend**: `exportAllData()` flow in `frontend/src/components/TaskBoard.tsx` (export dialog + download)

---

## Progress day / stats / charts bucketing (most error-prone)

- **Progress day definition**
  - **Docs**: `docs/PRODUCT_DOCUMENTATION_STANDARD.md` (glossary), `docs/VARIABLES.md`
  - **Backend**: `completionDateIsoLocalForTask()` in `backend/src/index.ts`
  - **Rule**: use **local day from `completedAt`** when available; fall back to **`dueDate`** for legacy records

- **Stats endpoint**
  - **Docs**: `docs/API_CONTRACTS.md` (`/api/stats`), `docs/VARIABLES.md` (`stats.*`)
  - **Backend**: `GET /api/stats` in `backend/src/index.ts`
  - **Frontend**: `frontend/src/components/GamificationPanel.tsx` fetches and displays stats

- **Productivity insights endpoint**
  - **Docs**: `docs/API_CONTRACTS.md` (`/api/productivity-insights`), `docs/VARIABLES.md` (ProductivityRow)
  - **Backend**: `GET /api/productivity-insights` in `backend/src/index.ts`
  - **Frontend**: `frontend/src/components/ProductivityAnalysisModal.tsx` renders charts + fullscreen

---

## Task editor field UX (single + multiple)

- **Labels / Location / Links multi-input**
  - **Docs**: `docs/PRD.md` (Core Tasks), `docs/VARIABLES.md`
  - **Frontend**: `frontend/src/components/TaskEditorDrawer.tsx`
    - Multi-input: newline/comma/semicolon parsing
    - Alias support: `Label=>value`, `Label -> value`, `Label | value`
    - Clickable preview chips for URL-like entries (links + location)

---

## Verification checklist (repeatable)

Run these after changing code or docs:

1. **Builds**
   - Backend: `npm run build` in `backend/`
   - Frontend: `npm run build` in `frontend/`

2. **Docs consistency scan**
   - Search docs for: `progress day`, `completedAt`, `dueDate`, `sync-from-data`, and verify definitions match `completionDateIsoLocalForTask()`.

3. **Smoke UX checks**
   - Import → Sync → Save → Export all work from the header without duplicates.
   - Productivity Analysis: “Tasks completed by project” legend Hide all / Show all and stats pills update live.
   - List view: multi-day tasks display date ranges consistently with calendar segmentation.

