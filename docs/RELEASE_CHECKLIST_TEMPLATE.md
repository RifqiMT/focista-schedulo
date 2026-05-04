# Release Checklist Template

**Last updated:** 2026-05-04  
**Owner:** Product Operations + Engineering

---

## Usage

Copy this template for each release (for example, `docs/releases/2026-05-xx.md`) and complete all sections before release sign-off.

---

## 1) Release Metadata

- Release name/version:
- Release window/date:
- Release owner:
- Scope summary:
- Primary risk areas:

---

## 2) Functional Verification

- [ ] Profile management flows validated (create/edit/delete/select/lock/unlock)
- [ ] Profile scoping verified (tasks/projects/progress stay within active profile)
- [ ] Showcase profile policy (`Test`) verified as read-only for mutations
- [ ] Task CRUD verified in list/calendar/day agenda views
- [ ] Recurring task flows verified (create/edit/complete/delete/materialize)
- [ ] Bulk actions verified (batch update/move/delete)
- [ ] Project CRUD and association integrity verified
- [ ] Import/sync/save/export flows verified (`JSON`, `CSV`, `Both`)

Notes:

---

## 3) Non-Functional and Quality Gates

- [ ] Lint passes for changed files
- [ ] Test suite passes (`npm run test`)
- [ ] Build succeeds (`npm run build`)
- [ ] No critical regressions in manual smoke test
- [ ] Core action performance reviewed against target (<1s perceived where applicable)
- [ ] Error toasts in critical failure paths are user-friendly and root-cause clear

Evidence links/log references:

---

## 4) Data Integrity and Security

- [ ] No unintended schema/persistence drift
- [ ] No cross-profile data leakage observed
- [ ] Password-protected profile deletion requires password validation
- [ ] Locked-profile export behavior validated with correct/incorrect passwords
- [ ] No secrets introduced in repository changes

---

## 5) Documentation Completeness

- [ ] `README.md` updated if behavior changed
- [ ] `docs/PRD.md` updated for scope/requirement changes
- [ ] `docs/USER_PERSONAS.md` and `docs/USER_STORIES.md` updated as needed
- [ ] `docs/VARIABLES.md` updated for new/changed variables or formulas
- [ ] `docs/PRODUCT_METRICS.md` and `docs/METRICS_AND_OKRS.md` reconciled
- [ ] `docs/TRACEABILITY_MATRIX.md` updated
- [ ] `docs/GUARDRAILS.md` updated when constraints changed
- [ ] `docs/CHANGELOG.md` updated with release highlights

---

## 6) Sign-Off

- Product sign-off: ____________________ Date: __________
- Engineering sign-off: ________________ Date: __________
- Design sign-off (if applicable): ______ Date: __________
- Analytics sign-off (if applicable): ____ Date: __________
- Product Ops sign-off: ________________ Date: __________

