# Product and Engineering Guardrails

**Last updated:** 2026-07-19  
**Owner:** Product + Engineering

---

## Purpose

Define the technical and business limitations that bound safe product development for Focista Schedulo. Treat exceptions as explicit, jointly approved decisions (Product + Engineering), documented in the changelog.

---

## Business Guardrails

- **User-facing copy accuracy:** Achievement or chart labels must match shipped formulas. Prefer a single source of truth documented in `VARIABLES.md` (including the canonical achievement description table).
- Keep profile data boundaries strict; no cross-profile leakage.
- Preserve user data ownership with reliable import/export capability (including large Blob-staged transfers in production).
- Prioritize execution reliability over feature volume.
- Avoid introducing behavior changes without documentation and changelog updates.
- Preserve showcase integrity: profile `Test` acts as read-only during demonstrations.
- Do not position the product as multi-user collaborative or as an enterprise RBAC system while those remain non-goals.
- Feedback layers must not compete: **one exclusive tooltip** and **one toast** at a time.

---

## Technical Guardrails

- **API field names vs. semantics:** Some response keys are historical (e.g. `last7Days` carrying a **calendar-week** series). Do not rename lightly without a coordinated frontend migration; when behavior changes, update `API_CONTRACTS.md`, `VARIABLES.md`, and consumer components in the same release.
- Runtime persistence must remain non-monolith for high-frequency operations (split `tasks` / `projects` / `profiles` JSON objects).
- Production durable store is **Vercel Blob** (or local `fs` in development) — do **not** introduce Redis or MongoDB without an approved architecture change.
- Unified JSON (`focista-unified-data.json`) is interchange-oriented; do not reintroduce it as the primary high-frequency write path.
- Validate all mutation payloads before persistence (Zod).
- Avoid destructive save/sync patterns that can wipe valid datasets.
- Preserve deterministic recurrence identity (parent/child normalization).
- Maintain graceful recovery on API mutation failures.
- Any read-only business policy must be enforced server-side, not UI-only.
- Centralize user-facing error interpretation to ensure clear root-cause messaging.
- Large import/export on constrained serverless body limits must use **Blob staging** when available (`blobPathname` / presigned download). When Blob is unavailable, large **exports** must fall back to **parts** paging (`/api/admin/export-tasks-page`) rather than failing with `413`.
- Import must never fail an entire entity array because of one malformed row; coerce common quirks and drop invalid rows individually (`droppedRows` in the response).
- Do not force expensive full sync/save on every application boot in production; prefer post-import automation and quiet reload patterns.
- **LLM secrets are server-only by default:** `GROQ_API_KEY` and `TAVILY_API_KEY` must never be exposed as `VITE_*`. Users may optionally store keys in **browser localStorage** (`pst.aiKeys`) via the **AI keys** header and send them only to `/api/productivity-summary*` and `/api/ai-keys/validate`. Never log client or server API keys.
- AI summaries must be grounded in profile-scoped task digests; do not invent completed work. Cap highlight lists to bound latency/cost.
- Missing Groq configuration must fail closed with `503` and a clear operator message — not a silent empty hallucination.
- Long-running Node API process is required for in-memory working set and SSE; do not assume purely stateless per-request diskless compute without redesign.

---

## Performance Guardrails

- Target: majority of core actions under 1 second in normal local usage.
- Batch operations are preferred over N individual mutation calls.
- Avoid redundant foreground refetches after successful optimistic updates.
- Use longer persistence debounce on Blob (~1500ms) than local fs (~40ms) on long-running hosts to protect free-tier upload quotas.
- On **Vercel serverless**, Blob `persistDebounceMs` must be **`0`**, and durability-critical mutations (especially task complete) must **await** persist before returning success—never rely on fire-and-forget timers after the response.
- Prefer Blob multi-isolate freshness checks before task list/complete so in-memory state does not overwrite newer Blob writes from another isolate.
- Any potentially degrading change must include before/after measurement evidence (see Performance Guardrail rule).
- Profile-gated performance diagnostics may exist for specific profile names; do not expose noisy logging to all users by default.

---

## Security and Privacy Guardrails

- Never store plaintext secrets/passwords in repository files.
- Never commit `.env.local`, tokens, or Blob credentials.
- Use hashed profile passwords only where lock is enabled (scrypt).
- Block or constrain sensitive export behavior for locked profiles without valid credentials.
- Require password confirmation for deleting password-protected profiles.
- Require `FRONTEND_ORIGIN` in production API environments.
- Exclude tokens, hashes, and stack traces from user-facing error toasts.
- Never log Groq/Tavily API keys (server env or client-supplied `groqApiKey` / `tavilyApiKey`).
- Format-validate AI keys before live provider pings (`POST /api/ai-keys/validate`).

---

## Data and Transfer Guardrails

- Import must merge/dedupe rather than blindly overwrite without safeguards.
- Import must validate **per row** (`importParse.ts`) so one malformed row cannot discard an entire array; report skip counts accurately.
- Export modes: JSON, CSV, Both — document and test each.
- When Blob transfer is not configured and **import** payloads exceed limits, return clear `413` with actionable guidance. Large **exports** must use parts paging instead of failing.
- Import body must provide **exactly one** of `content` or `blobPathname`.
- Treat presigned export URLs as short-lived; do not log them in durable public logs.

---

## Delivery Guardrails

Before release:

1. Verify task/project/profile CRUD under active profile scope.
2. Verify recurrence create/edit/complete/delete integrity.
3. Verify import/export and **automated** sync/save critical flows (including Blob staging when targeting Prod).
4. Verify progress/insights correctness (calendar-week series + tooltips).
5. Verify showcase `Test` blocks mutations at API and UI.
6. Verify friendly errors on top failure paths (including `413`).
7. Update docs + traceability + changelog in the same release cycle.
8. Confirm deployment env vars for the target topology (`DEPLOYMENT_VERCEL.md`).
9. Verify Productivity Summary / Ask (including missing-key and degraded paths) when AI is in scope.
10. Verify task search AND matching and per-row import skip accounting.

---

## Explicit Non-Goals (Do Not Build Without Re-scoping)

- Multi-user real-time collaborative editing
- Bi-directional Google/Outlook calendar sync
- Enterprise RBAC / approval workflows
- Redis/Mongo as primary persistence in current topology
- Dark mode theme system (not shipped)

---

## Related Documents

- PRD non-goals: `PRD.md`
- Architecture constraints: `ARCHITECTURE.md`
- Deployment: `DEPLOYMENT_VERCEL.md`
- Documentation standard: `PRODUCT_DOCUMENTATION_STANDARD.md`
