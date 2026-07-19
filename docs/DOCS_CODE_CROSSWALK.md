# Docs-Code Crosswalk

**Last updated:** 2026-07-19  
**Owner:** Engineering + Product Operations

This file maps documentation artifacts to the primary implementation locations.

---

| Documentation Area | Primary Code References |
|---|---|
| Product shell and orchestration | `frontend/src/App.tsx` |
| API base URL / split hosting | `frontend/src/apiClient.ts`, `frontend/.env.example`, `frontend/vercel.json`, `frontend/vite.config.ts` |
| Profile management and scope | `frontend/src/components/ProfileManagement.tsx`, profile routes in `backend/src/index.ts`, `profileService.ts`, `profileSecurity.ts` |
| Task CRUD and list/calendar UX | `frontend/src/components/TaskBoard.tsx`, task routes in `backend/src/index.ts` |
| Task editor and parsing | `frontend/src/components/TaskEditorDrawer.tsx` |
| Project management | `frontend/src/components/ProjectSidebar.tsx`, project routes in `backend/src/index.ts` |
| Progress panel, weekly completions + XP charts, today highlight, tooltips, badges | `GamificationPanel.tsx`, `BadgesModalDialogBody.tsx`, `badgePngExport.ts`; `/api/stats` (incl. calendar-week `last7Days`) in `backend/src/index.ts`; `--chart-*` / `--weekly-*` in `styles.css` |
| Task editor save progress + await persist | `TaskEditorDrawer.tsx` (`saveStage`/`saveProgress`); `TaskBoard.tsx` async `onSave` |
| Selective Neon task upsert | `persistTasks({ ids })` on create/update/batch + `rebuildParentAndChildIdsDeterministic` in `backend/src/index.ts`; `neonStorage.ts` |
| Grinding and badge milestones | `monthlyGrinding.ts`, `yearlyGrinding.ts`, `badgesEarnedMilestone.ts`, `capMilestoneBadges.ts` |
| Productivity analysis | `ProductivityAnalysisModal.tsx`, `/api/productivity-insights` |
| Productivity Summary (AI) | `ProductivitySummaryModal.tsx`, `productivitySummaryService.ts`, `/api/productivity-summary`, `/api/productivity-summary/ask` |
| Local AI keys | `aiKeys.ts`, `AiKeysModal.tsx`, header **AI keys** in `App.tsx`; `POST /api/ai-keys/validate` |
| Per-row import validation | `backend/src/importParse.ts` (+ `importParse.test.ts`); admin import in `index.ts` |
| Task free-text search | `frontend/src/utils/taskSearch.ts` (+ test); TaskBoard search |
| Analysis chart Y-axis | `frontend/src/utils/chartYAxis.ts` (`niceYDomain`, `buildYTicks`); `ProductivityAnalysisModal.tsx` |
| Export parts paging | `POST /api/admin/export-tasks-page`; export `delivery: "parts"` in `index.ts` / App export flow |
| Fullscreen helpers | `fullscreenApi.ts`, `badgeFullscreen.ts`, `productivityAnalysisFullscreen.ts` |
| Runtime persistence model | `backend/src/storage/*` (`neonStorage.ts`, `createStorage.ts`, `neonClient.ts`), persistence helpers in `backend/src/index.ts`, local `backend/data/*.runtime.json` |
| Neon schema / migrations | `backend/src/storage/migrations/001_neon_core.sql`; `ensureNeonMigrations` in `neonClient.ts` |
| Vercel task complete durability | `PATCH /api/tasks/:id/complete` awaits `persistTasks`; Neon `persistDebounceMs=0` when `VERCEL`; `taskCompletePersist.test.ts` |
| Multi-isolate Neon freshness | `ensureTasksMemoryFresh` / `tasks_revision` in `backend/src/index.ts` + `neonStorage.ts` (list + complete) |
| Automated sync/save (no header buttons) | `autoSyncAndSave` in `frontend/src/App.tsx` (post-import; quiet reload-data on tab return) |
| Large import/export Neon staging | `backend/src/transferStaging.ts`, `frontend/src/transferImport.ts`, `/api/admin/transfer-upload`, `/api/admin/export-download`, `/api/admin/import` (`stagingPathname`), `/api/admin/export-data` |
| Export entity filtering | `backend/src/exportEntities.ts` (+ `exportEntities.test.ts`) |
| Import/export/sync/save admin flows | Admin routes in `backend/src/index.ts`; Import/Export in `App.tsx` / `TaskBoard.tsx` |
| Performance instrumentation | Action logging in `TaskBoard.tsx`; `X-Server-Time-Ms` middleware in backend |
| Friendly error root-cause formatting | `frontend/src/utils/friendlyError.ts`, integrated in `App.tsx`, `TaskBoard.tsx`, `ProfileManagement.tsx` |
| Showcase read-only policy | Mutation guards in `backend/src/index.ts`; UI disable gates in profile/project/task components |
| Production CORS lock | `FRONTEND_ORIGIN` in `backend/src/index.ts`, `backend/.env.example` |
| Neon Prod store | `DATABASE_URL`, `STORAGE_BACKEND=neon`, `backend/src/storage/neonStorage.ts` |
| Design tokens | `frontend/src/styles.css` `:root` and component theme rules |
| Toast system | `frontend/src/components/Toaster.tsx` + toast CSS; **single-toast** queue in `App.tsx` `enqueueToast` |
| Exclusive tooltips / hovercards | `frontend/src/uiExclusiveOverlay.ts` (`claimExclusiveTooltip`, `dismissExclusiveTooltip`); consumers in `TaskBoard.tsx`, `GamificationPanel.tsx`, `ProductivityAnalysisModal.tsx` |
| Achievement / milestone plain-English copy | Achievement + milestone `description` fields in `backend/src/index.ts` `/api/stats`; `badgesEarnedMilestone.ts`; rendered in `GamificationPanel.tsx` |
| Header Import/Export actions | `App.tsx` `header-action-btn` + styles in `styles.css` |

---

## Verification Checklist

- [ ] Docs mention Neon row-per-task (or local `fs`) persistence — not monolith runtime; no Redis/Mongo in Prod
- [ ] Docs mention `fs` vs `neon` backends (`STORAGE_BACKEND`, `DATABASE_URL`)
- [ ] Docs mention Neon staging for large import/export (`stagingPathname`, transfer-upload, parts fallback, `413`)
- [ ] Docs mention Vercel Neon debounce `0`, awaited task-complete persist, and multi-isolate `tasks_revision` freshness
- [ ] Docs mention automated sync/save and absence of Sync/Save header buttons
- [ ] Docs mention staged boot progress / production profile fast-path
- [ ] Profile-scoped behavior reflected in product and technical docs
- [ ] API route inventory matches backend route declarations
- [ ] Metrics/variable formulas match current backend calculations
- [ ] Weekly progress: `last7Days` in `/api/stats` is documented as a **calendar-week** (Mon–Sun) series, not a rolling seven-day window
- [ ] Achievement/milestone `description` fields and canonical copy table are documented in `VARIABLES.md` / `API_CONTRACTS.md`
- [ ] Exclusive tooltip + single-toast behavior is documented in Design, Architecture, Guardrails, and Stories (US-408)
- [ ] Productivity Summary + AI keys + degraded mode documented (FR-21/FR-24, US-409/410/413)
- [ ] Per-row import + task search + chart Y-axis + export parts documented (FR-22/23, US-411/412)
- [ ] Traceability matrix includes FR-13–FR-24 and related US IDs

---

## Related Documents

- Index: `README.md`
- Traceability: `TRACEABILITY_MATRIX.md`
- Changelog: `CHANGELOG.md`
- Documentation standard: `PRODUCT_DOCUMENTATION_STANDARD.md`
- Neon plan: `plans/2026-07-19-neon-postgres.md`
