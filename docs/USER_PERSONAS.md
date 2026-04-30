# User Personas

**Last updated:** 2026-04-30  
**Owner:** Product

---

## Persona A: Multi-Context Professional

**Profile:** Knowledge worker balancing personal and professional responsibilities, often switching context multiple times per day.

**Primary goals:**

- Keep work/personal plans separated and clear
- Re-prioritize quickly when schedules shift
- Track execution quality over time

**Pain points:**

- Task leakage between contexts
- Slow bulk operations
- Inconsistent recurring task behavior

**Success criteria:**

- Profile-based scoping remains strict
- Common actions complete quickly
- Recurring workflows stay predictable

---

## Persona B: Routine Builder

**Profile:** User with high recurrence density (daily habits, weekly routines, periodic checklists).

**Primary goals:**

- Create robust recurring patterns
- Mark/undo completion confidently
- Maintain historical visibility

**Pain points:**

- Duplicate/missing recurring entries
- Hard-to-debug recurrence state

**Success criteria:**

- Deterministic parent/child normalization
- Historical recurrence remains complete and accessible

---

## Persona C: Progress-Motivated Planner

**Profile:** User motivated by measurable progress, streaks, and milestone progression.

**Primary goals:**

- See daily momentum and longer-term productivity trends
- Use badges/milestones as behavioral reinforcement

**Pain points:**

- Metrics that feel disconnected from task activity
- Progress UI not reflecting latest state quickly

**Success criteria:**

- Stats and productivity analysis remain reliable and profile-aware
- Milestone feedback is timely and understandable

---

## Persona-to-Feature Alignment

| Persona | Highest Value Features |
|---|---|
| Multi-Context Professional | profiles, project filters, bulk edit/move/delete, calendar planning |
| Routine Builder | recurrence engine, historical loading, completion robustness |
| Progress-Motivated Planner | stats, productivity insights, badges, streaks |

---

## Persona D: Showcase Presenter / Demo Owner

**Profile:** Team member conducting demos, internal showcases, or training sessions where baseline datasets must remain unchanged.

**Primary goals:**

- Demonstrate app flows safely without corrupting seeded data
- Prevent accidental changes in the demo profile
- Communicate failures clearly when an action is intentionally blocked

**Pain points:**

- Accidental edits/deletes during live demos
- Ambiguous error messages that confuse audience confidence

**Success criteria:**

- Dedicated read-only profile behavior is enforced in frontend and backend
- Blocked actions return user-friendly root-cause feedback

