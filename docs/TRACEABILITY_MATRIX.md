# Enterprise Traceability Matrix

**Last updated:** 2026-05-04  
**Owner:** Product Operations

---

## Requirement-to-Implementation Matrix

| Req ID | Requirement | Persona | User Story | Primary Code Areas | Verification |
|---|---|---|---|---|---|
| FR-01 | Profile-scoped views | Persona A | US-101, US-406 | `frontend/src/App.tsx`, `frontend/src/components/ProfileManagement.tsx` (incl. lock indicator for protected profiles), backend profile/task/project filters | profile scope smoke tests |
| FR-02 | Task CRUD with recurrence support | Persona A/B | US-201, US-202, US-301 | `frontend/src/components/TaskBoard.tsx`, `TaskEditorDrawer.tsx`, `backend/src/index.ts` task routes | backend tests + manual CRUD validation |
| FR-03 | Project CRUD and associations | Persona A | US-201, US-203 | `ProjectSidebar.tsx`, backend project routes | project CRUD and scoped filter checks |
| FR-04 | Deterministic recurrence integrity | Persona B | US-301 | recurrence helpers in `backend/src/index.ts` | recurrence integrity regression suite |
| FR-05 | Calendar/day-agenda planning | Persona A/C | US-302 | `TaskBoard.tsx` calendar/day-agenda logic | UI functional verification |
| FR-06 | Batch operations performance | Persona A | US-203 | `/api/tasks/batch-update`, `/api/tasks/batch-delete`, TaskBoard bulk flows | latency and correctness checks |
| FR-07 | Progress and insights analytics | Persona C | US-401, US-402, US-403, US-404, US-405 | `/api/stats` (calendar-week `last7Days` series, weekday stats), `/api/productivity-insights`, `GamificationPanel.tsx`, `ProductivityAnalysisModal.tsx`, `badgePngExport.ts`, `BadgesModalDialogBody.tsx` | endpoint + UI parity checks; weekly bar/tooltip review; PNG export smoke |
| FR-08 | Data import/export/save/sync | Persona A/C | US-501, US-502, US-503 | admin routes in backend, header actions in `App.tsx`, export flows in `TaskBoard.tsx` | data operation smoke tests |
| FR-09 | Historical task navigation | Persona B/C | US-302 | paginated `/api/tasks` + history controls in `TaskBoard.tsx` | history loading/jump checks |
| FR-10 | Non-monolith runtime persistence | Persona A/B/C | US-503 | runtime file load/persist flow in `backend/src/index.ts` | persistence behavior audit |
| FR-11 | Friendly root-cause error feedback | Persona A/B/C/D | US-601 | `frontend/src/utils/friendlyError.ts`, toast usages in `App.tsx`, `TaskBoard.tsx`, `ProfileManagement.tsx` | manual error-path validation + UX review |
| FR-12 | Showcase read-only profile enforcement | Persona D | US-602 | read-only guards in `backend/src/index.ts`, UI disable gates in profile/project/task components | blocked mutation regression checks |

---

## Metrics Traceability

| Metric | Source | Formula Authority | Related Requirements |
|---|---|---|---|
| WCST | stats/insights data | `VARIABLES.md` + backend formulas | FR-02, FR-07 |
| EM-05 | Weekly chart interpretability | `last7Days` payload + tooltip fields | FR-07 |
| Action Latency Compliance | frontend timing + server timing headers | performance instrumentation | FR-06, FR-10 |
| Recurrence Integrity Rate | recurrence operation audit | backend recurrence rules | FR-04 |
| Export/Import Reliability | admin route outcomes | operational success ratio | FR-08 |

