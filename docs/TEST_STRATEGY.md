# Test Strategy

**Last updated:** 2026-07-18  
**Owner:** Engineering + QA

---

## Purpose

Provide a practical and auditable testing strategy that validates functional correctness, data integrity, profile scoping, recurrence behavior, transfer reliability, and user-facing error quality.

---

## Test Layers

| Layer | Scope | Current Mechanism |
|---|---|---|
| Unit tests | Isolated logic (profile security/service, badge rules, grinding, Blob helpers, storage selection) | Backend `vitest` |
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
| `blobTransfer.test.ts` | Blob transfer utilities |
| `storage/storage.test.ts` | Storage kind resolution / adapters |

**Commands:** `npm run test` (root) or `npm --workspace backend run test`

**Gap (documented):** Automated frontend component/E2E suite is not yet established; UI coverage is manual smoke until added.

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
4. **Data operations**
   - Import/export complete successfully and preserve scope links.
   - `Both` export emits JSON and CSV outputs.
   - Post-import **auto sync/save** runs without Sync/Save header buttons.
   - Large transfer path: Blob upload + `blobPathname` import; large export via presigned URL when configured.
   - `413` surfaces friendly guidance when Blob transfer unavailable.
5. **Error clarity**
   - Failure paths show friendly root-cause toasts.
   - No status-only generic error text in key user flows.
6. **Progress surface**
   - `/api/stats` `last7Days` has seven entries for the **current local Monday–Sunday** and aligns with completion counts by progress day.
   - Weekly chart tooltips expose day totals, per-task XP spread, and weekday-historical stats.
   - Badge PNG export completes without layout regression (cards vs. modal header naming).
7. **Boot UX**
   - Profile load shows progress bar / staged status.
   - Production path can load profiles before large tasks blob without requiring boot-time full sync/save.
8. **Persistence topology**
   - `/health` reports expected storage kind.
   - Split runtime objects remain the write path (fs or Blob).

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
- Blob transfer validation notes when releasing Prod topology changes
- Any known issues with risk classification and mitigation owner

---

## Related Documents

- Release checklist: `RELEASE_CHECKLIST_TEMPLATE.md`
- Traceability: `TRACEABILITY_MATRIX.md`
- Guardrails: `GUARDRAILS.md`
