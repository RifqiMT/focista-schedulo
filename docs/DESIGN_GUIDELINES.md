# Design Guidelines

**Last updated:** 2026-07-19  
**Owner:** Design + Frontend Engineering

---

## Purpose

Define the visual system, interaction standards, and accessibility baseline for Focista Schedulo. Source of truth for CSS tokens: `frontend/src/styles.css`.

---

## Design Principles

- Prioritize readability and planning clarity.
- Keep interaction density high but non-overwhelming.
- Preserve consistency across profile, task, project, and progress modules.
- Maintain accessibility as a baseline quality requirement.
- Prefer immediate, non-blocking feedback (toasts) over modal interruption for routine outcomes.
- Match chart and achievement **copy** to shipped formulas (calendar week ≠ rolling seven days unless explicitly intended).

---

## Theme Overview

The product ships a **light planning theme** optimized for daytime productivity work. There is **no separate dark theme** in the current codebase; do not document or ship dark-mode tokens without an explicit product decision.

### Core Theme Tokens (`:root`)

| Token | Friendly Name | Purpose | Value |
|---|---|---|---|
| `--bg` | App Background | Page canvas | `#ffffff` |
| `--surface` | Surface | Panels / secondary surfaces | `#fafafa` |
| `--surface-strong` | Strong Surface | Elevated/primary panels | `#ffffff` |
| `--border-subtle` | Subtle Border | Dividers, quiet edges | `#e5e7eb` |
| `--border-strong` | Strong Border | Emphasized outlines | `#d1d5db` |
| `--text-main` | Primary Text | Body and titles | `#111827` |
| `--text-muted` | Muted Text | Secondary labels, hints | `#6b7280` |
| `--accent-red` | Brand Red | Primary action / brand emphasis | `#ce1126` |
| `--accent-red-soft` | Soft Brand Red | Soft brand backgrounds | `#fee2e2` |
| `--accent-red-hover` | Brand Red Hover | Interactive hover emphasis | `#e63946` |
| `--accent-gold` | Accent Gold | Highlight / focus / success accent | `#facc15` |
| `--accent-gold-soft` | Soft Gold | Subtle highlighted background | `#fef3c7` |

### Typography

| Element | Guidance |
|---|---|
| Font stack | `system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif` |
| Body color | `var(--text-main)` |
| Secondary copy | `var(--text-muted)` |
| Density | Prefer scannable labels; avoid competing headline hierarchy in operational panels |

---

## Priority Color Mapping

Priority must be visually consistent across cards, pills, hovercards, and agenda entries.

| Priority | Visual Guidance | Representative Color |
|---|---|---|
| `low` | Warm yellow / gold subtle contrast | `rgba(250, 204, 21, 0.95)` |
| `medium` | Violet accent (distinct from status blue/green) | `rgba(147, 51, 234, 0.95)` |
| `high` | Orange accent | `rgba(249, 115, 22, 0.95)` |
| `urgent` | Strong red accent | `rgba(185, 28, 28, 1)` |

XP weights for the same priorities are documented in `VARIABLES.md` (`scoreFor`: 1/2/3/4).

---

## Toast / Feedback Palette

Toasts use local CSS variables on `.toast` variants:

| Toast Type | Accent | Soft / Ring |
|---|---|---|
| Default / neutral | `#64748b` | slate soft/ring |
| Success (`.toast--success`) | `#059669` | emerald soft/ring |
| Error (`.toast--error`) | `#be123c` | rose soft/ring |
| Info (`.toast--info`) | `#0369a1` | sky soft/ring |

**Rules**

- Error toasts must include user-friendly root cause and suggested next step (`friendlyError.ts`).
- Do not show status-only transport text for critical failures.
- Keep toast stack non-blocking (bottom-left, capped height).

---

## Component Guidelines

### Profile Hub (`ProfileManagement`)

- Keep profile actions compact and clearly discoverable.
- Display active profile identity consistently (`name` + `title` where space allows).
- Password-related controls should be explicit and reversible.
- Use a consistent **lock** icon next to password-protected profiles in selectors and summaries.
- When profile policy is read-only (`Test`), disable destructive controls and provide clear explanatory tooltips/toasts.
- Boot/loading: show **progress bar + staged status** while profiles (and subsequent tasks) load; avoid a blank shell with no feedback.

### Task Board (`TaskBoard`)

- Group controls by intent (search, timeframe, status, project association, bulk actions).
- Free-text search uses AND token semantics across all task attributes (`taskSearch.ts`).
- Avoid text clutter; preserve high scanability.
- Keep interaction latency feedback immediate through subtle non-blocking toasts.
- Do not expose manual Sync/Save header buttons; persistence ops are automated.

### Task Editor Drawer (`TaskEditorDrawer`)

- Field grouping order: identity → schedule → recurrence → context → associations.
- Validate progressively and keep error text concise.

### Project Sidebar (`ProjectSidebar`)

- Keep project list scannable; emphasize active project filter state.
- Honor showcase read-only disablement for create/edit/delete.

### Progress and Productivity (`GamificationPanel`, `ProductivityAnalysisModal`, `ProductivitySummaryModal`, badges)

- Present summary KPIs first, deep analysis second. AI Productivity Summary lives in the **Tasks** toolbar (not Progress), so Progress actions stay Analysis · Badges.
- **Analysis dual-series charts:** Raw = brand red (`#ce1126`, dashed when Average is also shown); Average = blue (`#2563eb`). Legend dots, tooltips, chart strokes, and PNG export must use the same tokens (`--pa-chart-raw` / `--pa-chart-avg`).
- **Weekly chart:** seven bars for the **current local Monday–Sunday**; label/helper copy must not imply a rolling “last seven days” window unless product intentionally aligns copy with implementation.
- **Bar tooltips:** structure as (1) day totals, (2) per-task XP spread, (3) weekday-historical comparison.
- **Productivity Summary modal:** solid Analysis shell; sliding Overview / Ask control; meta chips; web-tips switch; timeline as unit chips + This/Next offset; Ready/Key status with live dot; metric cards + completion ring; brief bar with copy/time; Open/Overdue prose sections; refined Ask composer. No glass.
- **AI keys modal:** solid shell with status pills, provider cards, inline show-hide, automatic format + live key validation, dirty-state Save. No glass.
- Badge/milestone visuals reinforce progression without distracting from task execution.
- **Badges modal:** header pattern `Profile: Name - Title`; exported PNG cards may use **name only**—keep this distinction intentional.
- Support fullscreen chart/badge experiences via existing fullscreen helpers without covering critical chrome unexpectedly.

### Toaster (`Toaster`)

- Support success/error/info variants with shared motion (`toast-enter`).
- Prefer concise titles + one supporting sentence.
- **Single toast at a time:** the queue replaces rather than stacking multiple toasts.
- Showing a toast must **dismiss any active exclusive tooltip/hovercard** so feedback layers never compete (`dismissExclusiveTooltip` in `enqueueToast`).

### Exclusive tooltips and hovercards

- At most **one** custom tooltip/hovercard may be visible app-wide (`claimExclusiveTooltip` / `dismissExclusiveTooltip` in `uiExclusiveOverlay.ts`).
- Consumers: task hovercards (`TaskBoard`), weekly-bar and badge tooltips (`GamificationPanel`), analysis chart tooltips (`ProductivityAnalysisModal`).
- Claiming a new tooltip dismisses the previous owner; releasing on cleanup clears the slot only if still owned.

### Header data actions

- Import/Export use `header-action-btn` with glyph + label for scannable data ops.
- Keep tooltips/titles explaining merge behavior and export formats; do not reintroduce Sync/Save buttons.

### Achievements and milestones (Progress)

- Each achievement card shows **name + plain-English description** from `/api/stats`.
- Each milestone card shows **name + optional `description` line** under the title (`.milestone-desc` / `.achievement-desc`).
- Keep copy short, actionable, and aligned with formulas in `VARIABLES.md`.

### CSS namespaces (component themes)

| Prefix | Surface | Notes |
|---|---|---|
| `:root` tokens | Global light theme | `--bg`, `--accent-red`, `--accent-gold`, etc. |
| `--toast-*` | Toaster variants | Success emerald, error rose, info sky |
| `--pa-chart-raw` / `--pa-chart-avg` | Analysis dual-series | Raw brand red `#ce1126`; Average blue `#2563eb` |
| `aik-*` | AI Keys modal | Status pills `.is-ready` / `.is-needed` / `.is-checking`; solid shell |
| `ps-*` | Productivity Summary modal | Tabs, period chips, metrics, completion ring `--ps-rate`, prose, Ask composer |
| `header-action-*` | Header Import/Export/AI keys | Glyph + label buttons |

---

## Layout Guidance

| Breakpoint | Layout |
|---|---|
| Desktop | Left rail (profile/project), center task board, right progress rail |
| Tablet / mobile | Stacked layout with predictable control grouping |
| Parity | Maintain critical actions across breakpoints |

---

## Motion Guidance

- Use short, purposeful transitions (toast enter ~240ms ease-out).
- Prefer subtle feedback over decorative motion.
- Do not animate in ways that obscure form validation or error text.

---

## Accessibility Standards

- Keyboard navigable controls for all core actions.
- Visible focus states on actionable elements (gold outline accents are common for focus).
- Color is never the sole state communicator (pair with icons/text, especially lock and read-only).
- Maintain legible contrast in all panels and overlays.
- Disabled states must remain visually clear and semantically announced where possible.
- Modal dialogs (Analysis, Badges) must trap focus appropriately and expose accessible names.

---

## Content / Copy Standards

- Prefer plain language over jargon in user-facing errors **and** achievement/milestone descriptions.
- Align Progress/achievement wording with formula semantics (`VARIABLES.md`). Canonical shipped achievement strings are listed there.
- Showcase blocks should explain **why** the action is blocked (demo integrity), not only that it failed.

---

## Related Documents

- Variables: `VARIABLES.md`
- Personas: `USER_PERSONAS.md`
- Guardrails: `GUARDRAILS.md`
- Stories: `USER_STORIES.md` (US-403–US-406, US-103)
