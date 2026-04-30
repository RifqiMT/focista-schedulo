# Design Guidelines

**Last updated:** 2026-04-30  
**Owner:** Design + Frontend Engineering

---

## Design Principles

- Prioritize readability and planning clarity.
- Keep interaction density high but non-overwhelming.
- Preserve consistency across profile, task, project, and progress modules.
- Maintain accessibility as a baseline quality requirement.

---

## Color Palette (Current Theme)

| Token | Purpose | Value |
|---|---|---|
| `--bg` | app background | `#ffffff` |
| `--surface` | panels/cards secondary | `#fafafa` |
| `--text-main` | primary text | `#111827` |
| `--text-muted` | secondary text | `#6b7280` |
| `--accent-red` | brand/action emphasis | `#ce1126` |
| `--accent-red-hover` | interactive hover emphasis | `#e63946` |
| `--accent-gold` | highlight/focus/success accent | `#facc15` |
| `--accent-gold-soft` | subtle highlighted background | `#fef3c7` |

---

## Priority Color Mapping

| Priority | Visual Guidance |
|---|---|
| low | warm yellow subtle contrast |
| medium | violet accent |
| high | orange accent |
| urgent | strong red accent |

The same priority semantics must be reused across cards, pills, hovercards, and agenda entries.

---

## Component Guidelines

### Profile Hub
- Keep profile actions compact and clearly discoverable.
- Display active profile identity consistently.
- Password-related controls should be explicit and reversible.
- When profile policy is read-only (e.g., `Test`), disable destructive controls and provide clear explanatory tooltips/toasts.

### Task Board
- Group controls by intent (search, timeframe, status, project association, bulk actions).
- Avoid text clutter; preserve high scanability.
- Keep interaction latency feedback immediate through subtle non-blocking toasts.
- Error toasts must include user-friendly root cause and suggested next step, not status-only transport text.

### Task Editor Drawer
- Field grouping order: identity -> schedule -> recurrence -> context -> associations.
- Validate progressively and keep error text concise.

### Progress and Productivity
- Present summary KPIs first, deep analysis second.
- Badge/milestone visuals should reinforce progression without distracting from task execution.

---

## Accessibility Standards

- Keyboard navigable controls for all core actions.
- Visible focus states on actionable elements.
- Color is never the sole state communicator.
- Maintain legible contrast in all panels and overlays.
- Disabled states must remain visually clear and semantically announced where possible.

---

## Responsive Layout Guidance

- Desktop: left rail (profile/project), center task board, right progress rail.
- Tablet/mobile: stacked layout with predictable control grouping.
- Maintain parity of critical actions across breakpoints.

