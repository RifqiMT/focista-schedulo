# User Personas

**Last updated:** 2026-07-19  
**Owner:** Product

---

## Purpose

Define the primary user archetypes for Focista Schedulo, including goals, pain points, workflows, and success outcomes that drive requirements, stories, and metrics.

---

## Persona A: Multi-Context Professional

**Name archetype:** Alex Rivera  
**Profile:** Knowledge worker balancing personal and professional responsibilities, often switching context multiple times per day.

**Primary goals**

- Keep work/personal plans separated and clear
- Re-prioritize quickly when schedules shift
- Track execution quality over time
- Export or back up datasets without friction

**Pain points**

- Task leakage between contexts
- Slow bulk operations
- Inconsistent recurring task behavior
- Confusing lock/unlock states when switching profiles

**Typical workflows**

1. Select active profile (notice lock if protected)
2. Filter by project and timeframe
3. Bulk-move or complete tasks after a planning session
4. Export JSON/CSV (or Both) for backup

**Success criteria**

- Profile-based scoping remains strict
- Common actions complete quickly (sub-1s perceived locally)
- Recurring workflows stay predictable
- Locked profiles are **visually obvious** in the selector
- Large exports succeed via Neon staging when needed

**Highest-value features**

Profiles, project filters, bulk edit/move/delete, calendar planning, import/export

---

## Persona B: Routine Builder

**Name archetype:** Jordan Lee  
**Profile:** User with high recurrence density (daily habits, weekly routines, periodic checklists).

**Primary goals**

- Create robust recurring patterns
- Mark/undo completion confidently
- Maintain historical visibility without slowdowns

**Pain points**

- Duplicate or missing recurring entries
- Hard-to-debug recurrence state after imports
- Historical views that feel incomplete or unstable

**Typical workflows**

1. Create a repeating series with interval rules
2. Complete today’s occurrence from list or day agenda
3. Jump to historical dates to review adherence
4. Reload quietly when returning to a tab after idle time

**Success criteria**

- Deterministic parent/child normalization
- Historical recurrence remains complete and accessible
- Pagination and jump-to-date remain stable
- Import merge does not create same-series/same-date duplicates

**Highest-value features**

Recurrence engine, historical loading, completion robustness, day-agenda timeline

---

## Persona C: Progress-Motivated Planner

**Name archetype:** Sam Okonkwo  
**Profile:** User motivated by measurable progress, streaks, and milestone progression.

**Primary goals**

- See daily momentum and longer-term productivity trends
- Use badges/milestones as behavioral reinforcement
- Share badge artwork externally

**Pain points**

- Metrics that feel disconnected from task activity
- Progress UI not reflecting latest state quickly
- Charts that imply the wrong time window (rolling 7 days vs calendar week)

**Typical workflows**

1. Complete prioritized tasks during the day
2. Review Progress panel: streak, XP, calendar-week completions + XP charts
3. Hover bars for weekday-historical context
4. Open Analysis for longitudinal trends; open **Summary** for AI period overviews and task Q&A; export badges as PNG

**Success criteria**

- Stats, productivity analysis, and AI summaries remain reliable and profile-aware
- Milestone feedback is timely and understandable
- Achievement and milestone cards use short plain-English descriptions that match shipped formulas
- The **current-week** completion chart and **weekday-context** tooltips make daily performance interpretable without exporting data
- Badge PNG export includes clear profile naming
- Progress tooltips do not compete with toasts (exclusive overlay + single toast)

**Highest-value features**

Stats, productivity insights, AI Productivity Summary (Groq/Tavily), badges, streaks, weekly progress chart, PNG badge export, grinding milestones

---

## Persona D: Showcase Presenter / Demo Owner

**Name archetype:** Priya Nair  
**Profile:** Team member conducting demos, internal showcases, or training sessions where baseline datasets must remain unchanged.

**Primary goals**

- Demonstrate app flows safely without corrupting seeded data
- Prevent accidental changes in the demo profile
- Communicate failures clearly when an action is intentionally blocked

**Pain points**

- Accidental edits/deletes during live demos
- Ambiguous error messages that confuse audience confidence

**Typical workflows**

1. Switch to profile `Test`
2. Walk through list/calendar/progress read paths
3. Attempt a mutation only to show the read-only guard in action

**Success criteria**

- Dedicated read-only profile behavior is enforced in frontend and backend
- Blocked actions return user-friendly root-cause feedback (`403`)
- Demo dataset remains unchanged across sessions

**Highest-value features**

Showcase read-only policy, friendly error toasts, lock/read-only affordances

---

## Persona E: Reliability-Conscious Operator

**Name archetype:** Casey Nguyen  
**Profile:** Power user or maintainer who cares about persistence correctness, deployment health, and recoverability (including production Neon configuration).

**Primary goals**

- Trust that runtime data survives restarts and deploys
- Recover from failed imports with clear guidance
- Understand storage topology (fs vs Neon) without guessing

**Pain points**

- Silent data loss on bad save/sync patterns
- Opaque `413` failures on large transfers
- Boot that feels stuck without progress feedback

**Typical workflows**

1. Observe staged boot progress while profiles/tasks load
2. Import a large JSON via Neon staging
3. Confirm auto sync/save completed quietly
4. Verify `/health` storage kind in production

**Success criteria**

- Split runtime persistence remains the write path
- Large import/export succeeds when `DATABASE_URL` and Neon staging are configured
- Boot progress communicates stages; expensive boot sync/save is avoided
- Failures cite actionable next steps (connection string, format, password)

**Highest-value features**

Storage adapters, Neon transfer staging, auto sync/save, boot progress, `/health`, deployment docs

---

## Persona-to-Feature Alignment

| Persona | Highest Value Features |
|---|---|
| Multi-Context Professional | Profiles, project filters, bulk edit/move/delete, calendar planning, export Both, task search |
| Routine Builder | Recurrence engine, historical loading, completion robustness |
| Progress-Motivated Planner | Stats, insights, badges, streaks, weekly completions + XP charts, PNG export, AI Productivity Summary / Ask |
| Showcase Presenter | Read-only `Test` profile, friendly blocked-action messaging |
| Reliability-Conscious Operator | Neon persistence/transfer, parts export fallback, per-row import, auto sync/save, boot progress, health, AI keys |

---

## Related Documents

- Requirements: `PRD.md`
- Stories: `USER_STORIES.md`
- Metrics: `PRODUCT_METRICS.md`
- Design: `DESIGN_GUIDELINES.md`
