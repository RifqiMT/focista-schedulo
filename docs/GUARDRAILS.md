# Product and Engineering Guardrails

**Last updated:** 2026-05-04  
**Owner:** Product + Engineering

---

## Business Guardrails

- **User-facing copy accuracy:** Achievement or chart labels must match shipped formulas (e.g. any text implying a rolling seven-day window must match code, or be revised). Prefer a single source of truth documented in `VARIABLES.md`.
- Keep profile data boundaries strict; no cross-profile leakage.
- Preserve user data ownership with reliable import/export capability.
- Prioritize execution reliability over feature volume.
- Avoid introducing behavior changes without documentation and changelog updates.
- Preserve showcase integrity: profile `Test` acts as read-only during demonstrations.

---

## Technical Guardrails

- **API field names vs. semantics:** Some response keys are historical (e.g. `last7Days` carrying a **calendar-week** series). Do not rename lightly without a coordinated frontend migration; when behavior changes, update `API_CONTRACTS.md`, `VARIABLES.md`, and consumer components in the same release.
- Runtime persistence must remain non-monolith for high-frequency operations.
- Validate all mutation payloads before persistence.
- Avoid destructive save/sync patterns that can wipe valid datasets.
- Preserve deterministic recurrence identity (parent/child normalization).
- Maintain graceful recovery on API mutation failures.
- Any read-only business policy must be enforced server-side, not UI-only.
- Centralize user-facing error interpretation to ensure clear root-cause messaging.

---

## Performance Guardrails

- Target: majority of core actions under 1 second in normal local usage.
- Batch operations are preferred over N individual mutation calls.
- Avoid redundant foreground refetches after successful optimistic updates.
- Any potentially degrading change must include before/after measurement evidence.

---

## Security and Privacy Guardrails

- Never store plaintext secrets/passwords in repository files.
- Use hashed profile passwords only where lock is enabled.
- Block or constrain sensitive export behavior for locked profiles without valid credentials.

---

## Delivery Guardrails

Before release:

1. Verify task/project/profile CRUD under active profile scope.
2. Verify recurrence create/edit/complete/delete integrity.
3. Verify import/export/save/sync critical flows.
4. Verify progress/insights correctness.
5. Update docs + traceability + changelog in same release cycle.

