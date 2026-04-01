# Product and Technical Guardrails — Focista Schedulo

**Last updated:** 2026-04-01  
**Owner:** Product + Engineering

---

## Objective

This document defines the non-negotiable boundaries for product development, delivery, and operation to keep Focista Schedulo reliable, understandable, and safe.

---

## Business Guardrails

1. **Clarity first**  
   Features must reduce planning ambiguity. Any addition that increases cognitive load without measurable value should be rejected.

2. **Execution over novelty**  
   Prioritize flows that help users complete tasks faster and with fewer errors.

3. **Data ownership as baseline**  
   Users must be able to export their data in standard formats. No lock-in behavior.

4. **No hidden behavior changes**  
   Changes to completion, recurrence, project assignment, or date logic must be documented and communicated in release notes.

5. **Shipped vs planned must be explicit**  
   Documentation and UI language must clearly distinguish available features from roadmap items.

---

## Product Scope Guardrails

- In-scope:
  - Task and project management
  - Recurrence, calendar/day agenda, voice-to-form, export, progress gamification
- Out-of-scope (current phase):
  - Multi-user collaboration
  - Cloud account sync
  - External billing or payment workflows

---

## Data and Privacy Guardrails

1. **Local-first persistence**
   - Source-of-truth files: `backend/data/tasks.json`, `backend/data/projects.json`.
   - Data must remain readable and recoverable via JSON export.

2. **Minimal PII handling**
   - Do not introduce unnecessary personal identifiers.
   - Voice transcription outputs are used only for task-field extraction in current scope.

3. **Schema integrity**
   - All API writes must pass Zod validation.
   - Backward-compatible migration behavior required for new fields.

4. **Request size**
   - JSON bodies are capped (currently **10 MB**) to support imports without risking unbounded memory; very large datasets should use chunked workflows or external tooling (planned if needed).

5. **Data repair safety**
   - Repair logic may deduplicate invalid duplicates but must preserve user intent and avoid destructive field drops.

---

## Engineering Guardrails

1. **Deterministic recurrence identity**
   - Parent/child IDs must remain stable and predictable.
   - Rebuild logic cannot create duplicate active occurrences for the same series/date.

2. **Project association integrity (parent/child consistency)**
   - All tasks that share the same `parentId` must also share the same `projectId`.
   - Any change that could allow a child/occurrence to drift into a different project is considered a data-integrity bug.

3. **Mutation reliability**
   - Completion/edit/delete operations must be idempotent under rapid interaction.
   - UI optimistic updates must have recovery path on API failure.

4. **Time semantics**
   - Day-based metrics and streak logic must use local calendar semantics.
   - **Progress day** for stats and productivity (`completionDateIsoLocalForTask`): use **`dueDate`** when set; otherwise the **local calendar date** from **`completedAt`**. Tasks without both are excluded from day buckets (lifetime points/level still count all completions).
   - UTC conversion must not silently shift daily outcomes.

5. **Performance baseline**
   - Primary views should remain responsive with hundreds of tasks.
   - Avoid heavy synchronous computation on each render.

6. **Observability readiness**
   - Critical flows must be testable and diagnosable with clear failure points.

7. **Recurrence horizon and materialization safety**
   - Virtual horizon expansion must remain bounded and performant.
   - Materialization must dedupe in-flight requests to prevent duplicate persisted tasks.

---

## UX and Accessibility Guardrails

1. **Keyboard and focus support**
   - Major controls must be operable by keyboard.
   - Focus state visibility is required on interactive components.

2. **Color usage discipline**
   - Priority/status colors must not be the sole information channel.
   - Keep contrast and readability acceptable for default themes.

3. **Error handling**
   - Failed writes should not appear as successful actions.
   - UI should recover to consistent state after transient failure.

4. **Overlays and popovers**
   - Task hovercards must use a portal root so they stack above the grid and avoid clipping.
   - Hovercards must not block checkbox toggles or row actions: suppress open behavior on those controls **and** use CSS passthrough (`pointer-events`) so overlapping card chrome does not eat clicks meant for row buttons.
   - Productivity Analysis and other modals must trap focus and restore focus on close.

---

## Release Guardrails

- A release touching core data logic is blocked unless all are true:
  1. Task CRUD + recurrence manual verification complete
  2. Future occurrence complete/edit/delete verification complete
  3. `GET /api/stats` checked for streak/XP/level consistency
  4. Export JSON/CSV sanity check complete
  5. `/api/productivity-insights` parity with modal charts verified when analysis ships
  6. Documentation updated (`PRD`, `VARIABLES`, `API_CONTRACTS`, metrics, and if relevant this file)

---

## Decision Escalation Rules

Escalate to Product + Engineering lead when any proposal:

- breaks backwards data compatibility,
- alters point/level/streak formulas,
- changes recurrence identity rules,
- introduces external data transmission beyond current local-first model.

---

<!-- Last updated is listed at the top of this document. -->
