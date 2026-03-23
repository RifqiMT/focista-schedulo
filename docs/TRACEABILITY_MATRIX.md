# Enterprise Traceability Matrix — Focista Schedulo

**Last updated:** 2026-03-23  
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
| Project Operator | US-5 | Manage projects and task associations | `ProjectSidebar.tsx`, `TaskBoard.tsx` | `GET/POST/PUT/DELETE /api/projects` | project lifecycle, cascade delete behavior | E2, KR-1.x | I | Engineering |
| Personal Planner | US-7 | Motivation loop (streak/XP/levels/badges) | `GamificationPanel.tsx`, `backend/src/index.ts` | `GET /api/stats` | formula correctness, realtime refresh | R2, KR-3.x | I | Product + Engineering |
| Personal Planner | US-12 | Data export (JSON/CSV) | `TaskBoard.tsx` (export) | client export from task/project datasets | export accuracy, format integrity | Q3, KR-4.x | I | Engineering |
| Multi-persona | US-3 | Voice input to autofill task form | `TaskEditorDrawer.tsx` | browser speech + parser outputs | parser precision, fallback safety | E4, KR-1.x | I | Product + Engineering |

---

## Requirement Group Mapping (PRD -> Implementation)

| PRD Group | Requirement Intent | Primary Implementation |
|-----------|--------------------|-------------------------|
| Core Tasks | Full metadata task lifecycle | `TaskEditorDrawer.tsx`, `TaskBoard.tsx`, `backend/src/index.ts` |
| Projects | Grouping, filtering, lifecycle operations | `ProjectSidebar.tsx`, `TaskBoard.tsx`, `backend/src/index.ts` |
| Recurrence | Stable series identity and predictable occurrence logic | `backend/src/index.ts`, `TaskBoard.tsx` |
| Calendar | Month context and day execution view | `TaskBoard.tsx` |
| Gamification | XP, level, streak, milestones, achievements | `GamificationPanel.tsx`, `backend/src/index.ts` |
| Export | User data ownership and portability | `TaskBoard.tsx` |

---

## Coverage Risks and Follow-ups

1. Add automated end-to-end tests for virtual future occurrence edit/complete/delete consistency.
2. Add telemetry event taxonomy to enable full instrumentation traceability for A1/A2/E2/E3/E4/R2/Q1/Q2/Q3.
3. Add release gate checklist linking this matrix to QA sign-off.

---

**Last updated:** 2026-03-23
