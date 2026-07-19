# Test Strategy

**Last updated:** 2026-07-19  
**Owner:** Engineering + QA

---

## Purpose

Provide a practical and auditable testing strategy that validates functional correctness, data integrity, profile scoping, recurrence behavior, transfer reliability, and user-facing error quality.

---

## Test Layers

| Layer | Scope | Current Mechanism |
|---|---|---|
| Unit tests | Isolated logic (profile security/service, badge rules, grinding, transfer staging, storage selection / Neon) | Backend `vitest` |
| Unit tests | Task free-text search haystack / token matching | Frontend `vitest` (`src/utils/taskSearch.test.ts`) |
| Integration tests | Route behavior and persistence invariants | Backend route-level verification (manual + scripted) |
| UI regression checks | Task/project/profile flows, filters, calendar/day agenda, Progress | Frontend manual smoke suite |
| Documentation verification | Requirement-to-code consistency | Traceability + crosswalk audit |

### Current backend unit test inventory

| Test file | Coverage |
|---|---|
| `monthlyGrinding.test.ts` | Monthly grinding weeks |
| `yearlyGrinding.test.ts` | Yearly grinding months |
| `badgesEarnedMilestone.test.ts` | Badges-earned milestone block |
| `capMilestoneBadges.test.ts` | Milestone capping algorithm |
| `profileService.test.ts` | Profile CRUD + password flows |
| `profileSecurity.test.ts` | Password hashing/verification |
| `transferStaging.test.ts` | Neon transfer staging helpers (pathname prefixes, inline caps) |
| `exportEntities.test.ts` | Export filtering by denied profile IDs |
| `storage/storage.test.ts` | Storage kind resolution (`fs` / `neon` / reject invalid backend) |
| `productivitySummaryService.test.ts` | Period ranges, digests, progress-date semantics, degraded local brief |
| `importParse.test.ts` | Per-row import validation and soft coercion |
| `taskCompletePersist.test.ts` | Neon debounce is `0` on Vercel; positive off-Vercel |

### Current frontend unit test inventory

| Test file | Coverage |
|---|---|
| `utils/taskSearch.test.ts` | Haystack indexing; AND token match |
| `utils/chartYAxis.test.ts` | `niceYDomain` / `buildYTicks` spacing and label dedupe |

**Commands:**
- Backend: `npm run test` (root) or `npm --workspace backend run test`
- Frontend utils: `npm --workspace frontend run test`

**Gap (documented):** Automated frontend component/E2E suite is not yet established; UI coverage is mostly manual smoke. Pure utils (task search, chart Y-axis) use frontend `vitest`.

---

## Critical Regression Suite

1. **Profile integrity**
   - Profile-scoped views do not leak tasks/projects/progress.
   - Password-protected profile deletion requires correct password.
   - Lock indicator visible for protected profiles.
2. **Showcase policy**
   - `Test` profile blocks create/edit/delete on profiles/projects/tasks.
   - Backend returns `403` even if UI is bypassed.
3. **Recurrence integrity**
   - Repeating tasks remain deterministic across edit/delete/reload.
   - No duplicate same-series/same-date persistence after imports.
   - Virtual occurrences are not force-completed by temporary date backfills.
4. **Data operations**
   - Import/export complete successfully and preserve scope links.
   - `Both` export emits JSON and CSV outputs.
   - Post-import **auto sync/save** runs without Sync/Save header buttons.
   - Large transfer path: Neon `transfer-upload` + `stagingPathname` import; large export via staging download when configured.
   - `413` surfaces friendly guidance when Neon transfer staging unavailable.
5. **Error clarity**
   - Failure paths show friendly root-cause toasts.
   - No status-only generic error text in key user flows.
   - Task complete persist failures toast and refresh (no silent snap-back).
6. **Progress surface**
   - `/api/stats` `last7Days` has seven entries for the **current local Monday–Sunday** and aligns with completion counts by progress day.
   - Progress shows **This week** (completions) and **XP this week** (`points`) charts; today is calendar-date matched with shared `--chart-today*` accent.
   - Weekly chart tooltips expose day totals, per-task XP spread, and weekday-historical stats.
   - Achievement/milestone cards show plain-English `description` lines matching `VARIABLES.md`.
   - Badge PNG export completes without layout regression (cards vs. modal header naming).
7. **Boot UX**
   - Profile load shows progress bar / staged status.
   - Production path can load profiles before large tasks working set without requiring boot-time full sync/save.
8. **Persistence topology**
   - `/health` reports expected storage kind (`neon` or `fs`).
   - Neon row tables (or local split runtime files) remain the write path.
   - On Vercel: Neon debounce `0`; complete awaits persist; freshness reload via `tasks_revision` before list/complete (`taskCompletePersist.test.ts`).
   - Create/update/batch use selective `persistTasks({ ids })` (touched set only); task editor awaits save and blocks dismiss while saving.
   - Storage selection requires `DATABASE_URL` for `neon`; invalid backend values are rejected.
9. **Feedback layering**
   - Exclusive tooltip slot: opening a new tooltip dismisses the previous; toasts dismiss tooltips.
   - Single toast queue (no multi-toast stack).
10. **Productivity Summary (AI)**
   - Period resolution covers day/week/sprint/month/bimonth/quarter/semester/year, next_* forward ranges, and custom (unit-tested).
   - Missing `GROQ_API_KEY` → `503` with clear message; UI surfaces friendly guidance.
   - Generate summary and Ask stay profile-scoped; empty digests do not invent completions.
   - Optional Tavily enrich fails soft (summary/ask still returns from task data).

---

## Quality Gates

- Lint: no blocking lint errors on changed files.
- Test: backend test suite passes.
- Build: `npm run build` succeeds.
- Manual smoke: profile/project/task CRUD and progress paths validated.
- Docs: changelog + traceability + affected docs updated.

---

## Evidence Template (Per Release)

- Test run command outputs (`npm run test`, lint/build where applicable)
- Manual scenario checklist with pass/fail status
- Neon transfer / staging validation notes when releasing Prod topology changes
- Any known issues with risk classification and mitigation owner

---

## Related Documents

- Release checklist: `RELEASE_CHECKLIST_TEMPLATE.md`
- Traceability: `TRACEABILITY_MATRIX.md`
- Guardrails: `GUARDRAILS.md`
