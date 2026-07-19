# Enterprise Traceability Matrix

**Last updated:** 2026-07-19  
**Owner:** Product Operations

---

## Purpose

Map functional and non-functional requirements to personas, user stories, primary code areas, verification methods, and related metrics. Update this matrix in the same delivery window as requirement or implementation changes.

---

## Requirement-to-Implementation Matrix

| Req ID | Requirement | Persona | User Story | Primary Code Areas | Verification | Related Metrics |
|---|---|---|---|---|---|---|
| FR-01 | Profile-scoped views | A, E | US-101, US-406 | `App.tsx`, `ProfileManagement.tsx`, backend profile/task/project filters | Profile scope smoke tests | PM-02 |
| FR-02 | Task CRUD with recurrence support | A, B | US-201, US-202, US-301 | `TaskBoard.tsx`, `TaskEditorDrawer.tsx`, task routes in `backend/src/index.ts` | Backend tests + manual CRUD | PM-01, PM-03 |
| FR-03 | Project CRUD and associations | A | US-201, US-203 | `ProjectSidebar.tsx`, project routes | Project CRUD + scoped filters | PM-02 |
| FR-04 | Deterministic recurrence integrity | B | US-301 | Recurrence helpers in `backend/src/index.ts` | Recurrence regression suite | PM-03 |
| FR-05 | Calendar/day-agenda planning | A, C | US-302 | `TaskBoard.tsx` calendar/day-agenda | UI functional verification | PM-01 |
| FR-06 | Batch operations performance | A | US-203 | `/api/tasks/batch-update`, `/api/tasks/batch-delete`, TaskBoard bulk flows | Latency + correctness checks | PM-04, EM-04 |
| FR-07 | Progress and insights analytics | C | US-401, US-402, US-403, US-404, US-405 | `/api/stats`, `/api/productivity-insights`, `GamificationPanel.tsx`, `ProductivityAnalysisModal.tsx`, `badgePngExport.ts`, `BadgesModalDialogBody.tsx`, grinding/milestone modules | Endpoint + UI parity; tooltip/PNG smoke | NSM-01, EM-01–EM-07 |
| FR-21 | AI Productivity Summary + task Q&A | C | US-409, US-410 | `/api/productivity-summary`, `/api/productivity-summary/ask`, `productivitySummaryService.ts`, `ProductivitySummaryModal.tsx`, Tasks toolbar Summary | Period digest + missing-key 503; ask grounded answers; degraded local brief | EM-03, EM-09 |
| FR-08 | Data import/export + automated save/sync | A, C, E | US-501, US-502, US-503 | Admin routes; Import/Export in `App.tsx` / `TaskBoard.tsx`; `autoSyncAndSave` | Data operation smoke tests | PM-05, PM-06, QM-01 |
| FR-09 | Historical task navigation | B, C | US-302 | Paginated `/api/tasks` + history controls in `TaskBoard.tsx` | History loading/jump checks | PM-01 |
| FR-10 | Non-monolith runtime persistence | A, B, C, E | US-503 | `backend/src/storage/*`, load/persist in `index.ts` | Persistence audit + storage unit tests | QM-03 |
| FR-11 | Friendly root-cause error feedback | A–E | US-601 | `frontend/src/utils/friendlyError.ts`; toast usages | Error-path validation | PM-07 |
| FR-12 | Showcase read-only profile enforcement | D | US-602 | Read-only guards in `backend/src/index.ts`; UI disable gates | Blocked mutation regression | PM-08 |
| FR-13 | Vercel Prod split hosting + Neon store | A, E | US-503 | `frontend/vercel.json`, `vite.config.ts`, env wiring, `DEPLOYMENT_VERCEL.md`, `neonStorage.ts` | Vercel build guard + `/health` storage check | QM-02 |
| FR-14 | Large-payload import/export via Neon staging | A, E | US-504 | `transferStaging.ts`, `transferImport.ts`, `/api/admin/transfer-upload`, import/export admin routes, `/api/admin/export-tasks-page` | Large payload smoke; parts fallback; `413` messaging | PM-09 |
| FR-15 | Calendar-week progress chart + rich tooltips | C | US-403, US-404 | `/api/stats` `last7Days` builder; `GamificationPanel.tsx` | Weekly bar/tooltip review | EM-05 |
| FR-16 | Badge PNG export + modal naming | C | US-405 | `badgePngExport.ts`, `BadgesModalDialogBody.tsx` | PNG export smoke | EM-06 |
| FR-17 | Lock affordance for protected profiles | A | US-406 | `ProfileManagement.tsx` | Visual lock review | PM-02 |
| FR-18 | Staged profile boot progress + fast-path load | E | US-103 | `App.tsx` / `ProfileManagement.tsx` load orchestration; profiles runtime fast path | Boot UX validation | PM-10 |
| FR-19 | Plain-English achievement/milestone descriptions | C | US-407 | `/api/stats` achievement + milestone `description` fields; `badgesEarnedMilestone.ts`; `GamificationPanel.tsx` | Copy/UI parity vs `VARIABLES.md` | EM-05 |
| FR-20 | Exclusive tooltip + single-toast feedback | A–E | US-408 | `uiExclusiveOverlay.ts`; `App.tsx` `enqueueToast`; TaskBoard / GamificationPanel / ProductivityAnalysisModal | Overlay exclusivity smoke | PM-07 |
| FR-22 | Per-row import validation + soft coercion | A, E | US-412, US-501 | `backend/src/importParse.ts`; admin import in `index.ts` | importParse unit tests + import toast skip counts | PM-06, QM-01 |
| FR-23 | Comprehensive task search (AND tokens) | A | US-411 | `frontend/src/utils/taskSearch.ts`; TaskBoard search input | taskSearch unit tests + UI smoke | PM-01 |
| FR-24 | Browser-local AI keys + live validation | C, E | US-413 | `aiKeys.ts`, `AiKeysModal.tsx`, `POST /api/ai-keys/validate` | Format + live validate smoke; never-log check | EM-09 |

---

## Non-Functional Requirement Traceability

| NFR ID | Requirement | Primary Evidence | Verification |
|---|---|---|---|
| NFR-01 | Sub-1s perceived core actions (local) | Timing instrumentation | PM-04 sampling |
| NFR-02 | Non-monolith runtime writes | Split runtime objects | Storage audit |
| NFR-03 | Validated, corruption-resistant writes | Zod + merge/dedupe | QM-01 |
| NFR-04 | Graceful degradation on API failure | Optimistic UI + friendly errors | Manual failure injection |
| NFR-05 | Traceable, auditable docs | This matrix + crosswalk | Release docs gate |
| NFR-06 | Actionable error messages | `friendlyError.ts` | PM-07 audit |
| NFR-07 | No Redis/Mongo required in current Prod | Architecture + deployment docs (Neon) | Architecture review |
| NFR-08 | Respect Neon/body limits; Vercel debounce `0` | Debounce + Neon staging + awaited complete | PM-09, QM-01 |
| NFR-09 | Production env hardening | `FRONTEND_ORIGIN`, `VITE_API_BASE_URL`, `DATABASE_URL` | Deploy checklist |
| NFR-10 | AI keys never logged | Guardrails + validate route | EM-09 |
| NFR-11 | AI Summary degraded brief | `degraded: true` path | EM-09 |
| NFR-12 | Await complete persist on Vercel | `PATCH .../complete` + debounce test | QM-01, US-202 |
| NFR-13 | Multi-isolate tasks freshness | `ensureTasksMemoryFresh` / `tasks_revision` | QM-01, FR-02 |

---

## Metrics Traceability

| Metric | Source | Formula Authority | Related Requirements |
|---|---|---|---|
| NSM-01 WCST | Stats/insights data | `VARIABLES.md` + backend formulas | FR-02, FR-07 |
| EM-05 | Weekly chart interpretability | `last7Days` payload + tooltip fields | FR-07, FR-15 |
| EM-06 | Badge export adoption | PNG export actions | FR-16 |
| EM-07 | Monthly grinding attainment | `monthlyGrinding` / `yearlyGrinding` | FR-07 |
| PM-04 | Action latency compliance | Frontend timing + `X-Server-Time-Ms` | FR-06, FR-10 |
| PM-09 | Large transfer success | Neon transfer staging admin flows | FR-14 |
| PM-10 | Boot progress completeness | Boot UX path | FR-18 |
| PM-03 | Recurrence integrity rate | Backend recurrence rules | FR-04 |
| EM-09 | Productivity Summary usage | Summary/Ask actions | FR-21, FR-24 |
| PM-05 / PM-06 | Export/import reliability | Admin route outcomes + importParse skip accounting | FR-08, FR-14, FR-22 |

---

## Coverage Checklist (Release)

- [ ] Every FR in `PRD.md` appears in this matrix
- [ ] Every new US ID is linked to at least one FR
- [ ] Code paths match `DOCS_CODE_CROSSWALK.md`
- [ ] Verification evidence recorded in release checklist
- [ ] Metrics columns updated when KPIs change

---

## Related Documents

- PRD: `PRD.md`
- Stories: `USER_STORIES.md`
- Crosswalk: `DOCS_CODE_CROSSWALK.md`
- Metrics: `PRODUCT_METRICS.md`
- Changelog: `CHANGELOG.md`
