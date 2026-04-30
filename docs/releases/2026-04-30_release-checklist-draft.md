# Release Checklist Draft — 2026-04-30

**Status:** Draft  
**Owner:** Product + Engineering  
**Template Source:** `docs/RELEASE_CHECKLIST_TEMPLATE.md`

---

## 1) Release Metadata

- Release name/version: Focista Schedulo (documentation + safety hardening update)
- Release window/date: 2026-04-30
- Release owner: Product + Engineering
- Scope summary:
  - Password-confirmed deletion for protected profiles
  - Showcase read-only policy enforcement for profile `Test`
  - Friendly root-cause error messaging standard in critical toasts
  - Documentation suite expansion and governance hardening
- Primary risk areas:
  - Read-only policy false positives/negatives
  - Error message consistency across all mutation paths
  - Documentation-to-code alignment drift

---

## 2) Functional Verification

- [x] Profile management flows validated (create/edit/delete/select/lock/unlock)
- [x] Profile scoping verified (tasks/projects/progress stay within active profile)
- [x] Showcase profile policy (`Test`) verified as read-only for mutations
- [x] Task CRUD verified in list/calendar/day agenda views
- [x] Recurring task flows verified (create/edit/complete/delete/materialize)
- [x] Bulk actions verified (batch update/move/delete)
- [x] Project CRUD and association integrity verified
- [x] Import/sync/save/export flows verified (`JSON`, `CSV`, `Both`)

Notes:

- Showcase safeguards implemented in both UI and backend guards to prevent bypass.
- Export and profile-delete security behaviors now communicate clearer root cause.

---

## 3) Non-Functional and Quality Gates

- [x] Lint passes for changed files
- [ ] Test suite passes (`npm run test`)
- [ ] Build succeeds (`npm run build`)
- [x] No critical regressions in manual smoke test
- [x] Core action performance reviewed against target (<1s perceived where applicable)
- [x] Error toasts in critical failure paths are user-friendly and root-cause clear

Evidence links/log references:

- Lint checked after changes to frontend/backend/docs artifacts.
- Remaining automated test/build verification pending execution in release-close run.

---

## 4) Data Integrity and Security

- [x] No unintended schema/persistence drift
- [x] No cross-profile data leakage observed
- [x] Password-protected profile deletion requires password validation
- [x] Locked-profile export behavior validated with correct/incorrect passwords
- [x] No secrets introduced in repository changes

---

## 5) Documentation Completeness

- [x] `README.md` updated if behavior changed
- [x] `docs/PRD.md` updated for scope/requirement changes
- [x] `docs/USER_PERSONAS.md` and `docs/USER_STORIES.md` updated as needed
- [x] `docs/VARIABLES.md` updated for new/changed variables or formulas
- [x] `docs/PRODUCT_METRICS.md` and `docs/METRICS_AND_OKRS.md` reconciled
- [x] `docs/TRACEABILITY_MATRIX.md` updated
- [x] `docs/GUARDRAILS.md` updated when constraints changed
- [x] `docs/CHANGELOG.md` updated with release highlights

---

## 6) Sign-Off

- Product sign-off: ____________________ Date: __________
- Engineering sign-off: ________________ Date: __________
- Design sign-off (if applicable): ______ Date: __________
- Analytics sign-off (if applicable): ____ Date: __________
- Product Ops sign-off: ________________ Date: __________

