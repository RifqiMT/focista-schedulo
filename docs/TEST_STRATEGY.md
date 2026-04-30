# Test Strategy

**Last updated:** 2026-04-30  
**Owner:** Engineering + QA

---

## Purpose

Provide a practical and auditable testing strategy that validates functional correctness, data integrity, profile scoping, recurrence behavior, and user-facing error quality.

---

## Test Layers

| Layer | Scope | Current Mechanism |
|---|---|---|
| Unit tests | isolated logic (profile security/service, badge rules, recurrence utilities) | backend `vitest` |
| Integration tests | route behavior and persistence invariants | backend route-level verification (manual + scripted) |
| UI regression checks | task/project/profile flows, filters, calendar/day agenda | frontend manual smoke suite |
| Documentation verification | requirement-to-code consistency | traceability + crosswalk audit |

---

## Critical Regression Suite

1. **Profile integrity**
   - Profile-scoped views do not leak tasks/projects/progress.
   - Password-protected profile deletion requires correct password.
2. **Showcase policy**
   - `Test` profile blocks create/edit/delete on profiles/projects/tasks.
   - Backend returns `403` even if UI is bypassed.
3. **Recurrence integrity**
   - Repeating tasks remain deterministic across edit/delete/reload.
   - No duplicate same-series/same-date persistence after imports.
4. **Data operations**
   - Import/export/save/sync complete successfully and preserve scope links.
   - `Both` export emits JSON and CSV outputs.
5. **Error clarity**
   - Failure paths show friendly root-cause toasts.
   - No status-only generic error text in key user flows.

---

## Quality Gates

- Lint: no blocking lint errors on changed files.
- Test: backend test suite passes.
- Manual smoke: profile/project/task CRUD and progress paths validated.
- Docs: changelog + traceability + affected docs updated.

---

## Evidence Template (Per Release)

- Test run command outputs (`npm run test`, lint/build where applicable)
- Manual scenario checklist with pass/fail status
- Any known issues with risk classification and mitigation owner

