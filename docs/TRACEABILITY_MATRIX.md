# Enterprise Traceability Matrix — Focista Schedulo

**Last updated:** 2026-04-01  
**Owner:** Product Operations (with Engineering and QA)

---

## Purpose

This matrix provides end-to-end traceability from customer intent to product outcomes:

- Persona -> Story -> Requirement -> Code/API -> Test -> Metric/OKR
- Coverage status for release readiness
- Ownership accountability for maintenance

---

## Legend

- `I` = Implemented
- `P` = Partially implemented
- `N` = Not implemented / planned

---

## Matrix

| Persona | Story ID | Requirement | Code / Component | API / Data Contract | Test Focus | Metric / KR | Status | Owner |
|--------|----------|-------------|------------------|---------------------|------------|-------------|--------|-------|
| Project Operator | US-1 | Create structured task with metadata | `frontend/src/components/TaskEditorDrawer.tsx`, `frontend/src/components/TaskBoard.tsx` | `POST /api/tasks`, `TaskSchema` | validation, save reliability, field integrity | A1, E2 | I | Engineering |
| Project Operator | US-2 | Edit task fields and preserve consistency | `TaskEditorDrawer.tsx`, `TaskBoard.tsx` | `PUT /api/tasks/:id` | update correctness, id consistency | Q1, Q2 | I | Engineering |
| Routine Builder | US-8 | Recurrence creation and persistence | `TaskEditorDrawer.tsx`, `backend/src/index.ts` | `repeat`, `repeatEvery`, `repeatUnit`, `parentId`, `childId` | recurrence generation, parent/child rebuild | E3, Q1, KR-2.x | I | Engineering |
| Routine Builder | US-9 | Expand and manage recurring occurrences | `TaskBoard.tsx` (expand/collapse, virtual materialization) | `POST /api/tasks`, `PATCH /api/tasks/:id/complete` | materialization, complete/edit future occurrences | Q1, Q2 | I | Engineering |
| Personal Planner | US-10 | Calendar month + day agenda visibility | `TaskBoard.tsx` (calendar/day agenda) | `GET /api/tasks` | timeline segmentation, overlap layout | A2, Q2 | I | Engineering + Design |
| Personal Planner | US-6 | Mark complete / mark active | `TaskBoard.tsx`, `GamificationPanel.tsx` | `PATCH /api/tasks/:id/complete`, `GET /api/stats` | optimistic update recovery, duplicate prevention | WCST, E2, R2 | I | Engineering |
| Routine Builder | US-8/US-9 | Deterministic recurrence normalization and dedupe | `backend/src/index.ts` | startup load normalization + task writes | same-series/date duplicate prevention, sequence stability | Q1, KR-2.x | I | Engineering |
| Routine Builder | US-8/US-9 | Recurring series completion integrity (gap-fill + no forced re-complete) | `backend/src/index.ts` | `enforceSequentialCompletionForRepeatingSeries`: materialize missing dates up to latest completed; do not overwrite existing occurrence completion on reload | user mark-active preserved; gap dates filled when completing later occurrence | Q4, KR-2.x | I | Engineering |
| Personal Planner | US-10 | Historical/current/future/custom timeframe parity | `TaskBoard.tsx`, `App.tsx` | `TimeScope` values + derived range boundaries | filter consistency across list/calendar | A2, KR-1.x | I | Engineering + Product |
| Project Operator | US-5 | Manage projects and task associations | `ProjectSidebar.tsx`, `TaskBoard.tsx` | `GET/POST/PUT/DELETE /api/projects` | project lifecycle, cascade delete behavior | E2, KR-1.x | I | Engineering |
| Personal Planner | US-7 | Motivation loop (streak/XP/levels/badges) | `GamificationPanel.tsx`, `backend/src/index.ts` | `GET /api/stats` | formula correctness, realtime refresh | R2, KR-3.x | I | Product + Engineering |
| Personal Planner | US-12 | Data export (JSON/CSV) | `TaskBoard.tsx` (export) | client export from task/project datasets | export accuracy, format integrity | Q3, KR-4.x | I | Engineering |
| Multi-persona | US-3 | Voice input to autofill task form | `TaskEditorDrawer.tsx` | browser speech + parser outputs | parser precision, fallback safety | E4, KR-1.x | I | Product + Engineering |
| Personal Planner | US-14 | Productivity trends and insights charts | `ProductivityAnalysisModal.tsx`, `GamificationPanel.tsx` | `GET /api/productivity-insights`, `Task` completion dataset | cumulative series correctness, tooltip readability, cache invalidation | E5, KR-3.3 | I | Product + Engineering |
| Project Operator | US-4 | Task hovercard without blocking row actions | `TaskBoard.tsx` (portal, control suppression) | `GET /api/tasks` (read-only display) | hover target rules, viewport clamp | Q2 | I | Engineering |

---

## Requirement Group Mapping (PRD -> Implementation)

| PRD Group | Requirement Intent | Primary Implementation |
|-----------|--------------------|-------------------------|
| Core Tasks | Full metadata task lifecycle | `TaskEditorDrawer.tsx`, `TaskBoard.tsx`, `backend/src/index.ts` |
| Projects | Grouping, filtering, lifecycle operations | `ProjectSidebar.tsx`, `TaskBoard.tsx`, `backend/src/index.ts` |
| Recurrence | Stable series identity and predictable occurrence logic | `backend/src/index.ts`, `TaskBoard.tsx` |
| Calendar | Month context and day execution view | `TaskBoard.tsx` |
| Gamification | XP, level, streak, milestones, achievements | `GamificationPanel.tsx`, `backend/src/index.ts` |
| Productivity Analysis | Historical completion / XP / level / milestone charts | `ProductivityAnalysisModal.tsx`, `backend/src/index.ts` (`/api/productivity-insights`) |
| Export | User data ownership and portability | `TaskBoard.tsx` |

---

## Coverage Risks and Follow-ups

1. Add automated end-to-end tests for quarter/custom timeframe transitions across month boundaries and leap years.
2. Add telemetry event taxonomy to enable full instrumentation traceability for A1/A2/E2/E3/E4/R2/Q1/Q2/Q3/Q4.
3. Add release gate checklist linking this matrix to QA sign-off and recurrence integrity audit output.

---

**Last updated:** 2026-04-01
