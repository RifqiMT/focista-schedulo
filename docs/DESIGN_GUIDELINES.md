# Design Guidelines — Focista Schedulo

**Last updated:** 2026-03-18  
**Owner:** Design (with Engineering)

This document describes the visual system used in the application and how to extend it consistently. It covers theme palettes, typography, components, accessibility, and design-to-code mapping.

---

## Brand and Tone

- **Tone:** Calm, confident, “professional modern.”
- **Visual cues:** Clear hierarchy, strong hover and focus affordances, minimal clutter.
- **Tagline:** “Plan with clarity, focus without noise, and celebrate what you complete.”

---

## Theme: Indonesian Palette (White / Red / Gold)

The application uses a single theme with CSS custom properties defined in `frontend/src/styles.css` under `:root`.

### Core Surfaces and Borders

| Variable | Friendly name | Hex / value | Usage |
|----------|----------------|-------------|--------|
| `--bg` | Background | `#ffffff` | Page background. |
| `--surface` | Surface | `#fafafa` | Secondary surfaces. |
| `--surface-strong` | Strong surface | `#ffffff` | Cards, panels. |
| `--border-subtle` | Border subtle | `#e5e7eb` | Light dividers. |
| `--border-strong` | Border strong | `#d1d5db` | Card and panel borders. |

### Typography Colors

| Variable | Friendly name | Hex / value | Usage |
|----------|----------------|-------------|--------|
| `--text-main` | Primary text | `#111827` | Body and headings. |
| `--text-muted` | Muted text | `#6b7280` | Secondary copy, captions. |

### Brand Accents

| Variable | Friendly name | Hex / value | Usage |
|----------|----------------|-------------|--------|
| `--accent-red` | Red | `#ce1126` | Primary brand, header gradient end. |
| `--accent-red-hover` | Red hover | `#e63946` | Header gradient start, hover states. |
| `--accent-red-soft` | Red soft | `#fee2e2` | Soft backgrounds, active filter. |
| `--accent-gold` | Gold | `#facc15` | CTAs, focus outline, sidebar active. |
| `--accent-gold-soft` | Gold soft | `#fef3c7` | Soft backgrounds, sidebar active. |

### Header

- **Background:** Linear gradient `120deg`, `--accent-red-hover` → `--accent-red`.
- **Text:** White `#ffffff`; subtitle uses `rgba(254, 226, 226, 0.92)`.
- **Header group (buttons):** Border `rgba(255, 255, 255, 0.28)`, background `rgba(255, 255, 255, 0.12)`.

---

## Priority Color Palette

Priorities are visually distinct in task pills, calendar items, day agenda, and hovercard. Use the same mapping everywhere.

| Priority | Friendly name | Border / accent | Background (pill/card) | Text |
|----------|----------------|------------------|--------------------------|------|
| **low** | Low | `rgba(250, 204, 21, 0.95)` / `#7a4a00` | `rgba(250, 204, 21, 0.24)` | `#7a4a00` |
| **medium** | Medium | `rgba(147, 51, 234, 0.85)` | `rgba(233, 213, 255, 0.35)` | `rgba(88, 28, 135, 1)` |
| **high** | High | `rgba(249, 115, 22, 0.9)` | `rgba(255, 237, 213, 0.45)` | `rgba(154, 52, 18, 1)` |
| **urgent** | Urgent | `rgba(185, 28, 28, 1)` | `rgba(185, 28, 28, 0.16)` | `#7f1d1d` |

**Hovercard left border:** Same accent colors per priority (low: gold; medium: purple; high: orange; urgent: red).

**Day agenda event left border:** 6px solid using the same priority accent colors.

---

## Typography

- **Font family:** `system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`.
- **Body:** Inherits `color: var(--text-main)`.
- **Brand title:** `1rem`, `font-weight: 600`, white in header.
- **Brand subtitle:** `clamp(0.72rem, 1.6vw, 0.85rem)`, light red-tinted white in header.
- **Hovercard title:** `0.96rem`, `font-weight: 800`.
- **Section titles (hovercard):** `0.72rem`, `font-weight: 900`, uppercase, letter-spacing `0.08em`, muted.
- **Pills and badges:** Typically `0.7rem`–`0.72rem`, with `font-weight: 700`–`800` for priority.

---

## Layout Rules

- **Desktop:** 3-column grid: projects sidebar, main task board, gamification panel.
  - Sidebar: `clamp(220px, 18vw, 320px)`.
  - Main: `minmax(0, 1fr)`.
  - Panel: `clamp(260px, 22vw, 360px)`.
- **Breakpoints:**
  - ≤ 1280px: Tighter side rails.
  - ≤ 1024px: Single column; panel moves to bottom.
  - ≤ 820px / 520px: Header and spacing adjust for small screens.
- **Page padding:** `--page-pad-x`, `--page-pad-y` (clamp-based).

---

## Components

### Buttons

| Type | Use | Styling |
|------|-----|---------|
| **Primary** | Save, Create, irreversible confirmations. | Prominent background (e.g. gold gradient); visible hover and disabled states. |
| **Ghost** | Secondary actions (e.g. New project, view toggles, Sync data, Export). | Transparent or subtle background; in header: white border and light fill. |
| **Icon button** | Compact actions only. | Must have `aria-label`. |
| **Task action button** | Mark active, Move, Delete, Show occurrences. | Small, text-style; consistent with `.task-action-button`. |

### Pills and Badges

- **Pill:** Rounded `999px`, small padding, `0.7rem` font; use `.pill` and `.pill.subtle` for neutral pills.
- **Priority pills:** Use `.priority-low`, `.priority-medium`, `.priority-high`, `.priority-urgent` for consistent colors.
- **Status pill (Active filter):** `.task-filter-active` — red-tinted background and border.
- **Completed badge:** Blue for “ACTIVE”, green for “COMPLETED” in hovercard.

### Task Cards

- **Surface:** `--surface-strong` with `--border-strong` (or subtle).
- **Left bar:** 3px rounded bar; green gradient for active, blue/gray for completed.
- **Hover (active):** Stronger border (red tint), light red-tinted background, lift, shadow.
- **Focus:** 2px outline using gold accent.
- **Completed:** Reduced opacity, strikethrough title, muted text.
- **Metadata on card:** Title, date, time, duration, priority, project, Parent ID, labels only (no description, repeat, or link on card).

### Task Hovercard

- **Position:** Fixed, cursor-driven; placement logic keeps card on screen (left/right, above/below).
- **Size:** `min(500px, calc(100vw - 24px))`, max-height `min(82vh, 720px)`, scrollable.
- **Style:** Rounded `1rem`, border, left border 6px by priority; soft gradient overlay; section titles (Schedule, Details, Tags, Identifiers).
- **Content:** One row per field where applicable; links and locations as clickable chips (new tab).
- **Duration:** Human-readable (e.g. “1 hour & 15 mins”) via `formatDurationMinutesForOverview`.

### Drawer (Task Editor)

- **Sections:** Title and description; scheduling (due date/time, duration); repeat; reminders and deadlines; labels, locations, links; project.
- **Inputs:** Link, labels, and location inputs empty by default so users can type new values without clearing.
- **Voice input:** Clear capture state and transcript preview; allow corrections before save.
- **Chips:** Labels, locations, links as chips with delete; locations/links support alias format; only real URLs get “Open” link.

### Calendar

- **Month grid:** Cell hover/focus obvious (outline or border change).
- **Items:** Compact line height, priority accent, truncated title; click opens day agenda.
- **Day agenda:** Hourly grid; events height proportional to `durationMinutes`; multi-day tasks show continuation segments.
- **Today pill:** Distinct style (e.g. `.calendar-today-pill`).

### Sidebar

- **Active item:** `.sidebar-item-active` — gold gradient background, red text, red dot.
- **Hover:** Light red-tinted background, slight lift, shadow.

---

## Accessibility

- **Focus:** Provide visible focus outlines (e.g. 2px gold for task cards; outline-offset for clarity).
- **Contrast:** Ensure sufficient contrast for text on red header and on gold accents (white or dark text as defined).
- **Meaning:** Do not use color alone to convey meaning; use labels or pills (e.g. “HIGH”, “COMPLETED”).
- **Keyboard:** All interactive controls (buttons, filters, task actions) must be keyboard accessible.
- **ARIA:** Icon-only buttons must have `aria-label`; groups should have `role="group"` and `aria-label` where appropriate.

---

## Interaction States

| State | Guidance |
|-------|----------|
| **Hover** | Clear change (border, background, lift, or shadow). |
| **Active / pressed** | Slightly stronger than hover where applicable. |
| **Focus** | Visible outline; do not remove outline. |
| **Disabled** | Reduced opacity (e.g. 0.65); `cursor: not-allowed`. |

---

## Design-to-Code Mapping

| Element | File(s) |
|---------|---------|
| Theme variables and global styles | `frontend/src/styles.css` (`:root`, `body`) |
| Header, layout, sidebar, task board | `frontend/src/App.tsx`, `frontend/src/styles.css` |
| Task cards, list, calendar, day agenda, hovercard | `frontend/src/components/TaskBoard.tsx` + `.task-card`, `.task-hovercard`, `.day-agenda-*`, `.calendar-*` in `styles.css` |
| Task editor drawer, form fields, chips | `frontend/src/components/TaskEditorDrawer.tsx` + drawer and form classes in `styles.css` |
| Projects sidebar | `frontend/src/components/ProjectSidebar.tsx` + `.sidebar*` in `styles.css` |
| Progress panel | `frontend/src/components/GamificationPanel.tsx` + `.gamification-panel` in `styles.css` |
| Priority and status colors | `frontend/src/styles.css` (`.priority-*`, `.task-hovercard[data-priority]`, `.task-filter-active`, etc.) |

---

## Component State Matrix (Enterprise Summary)

| Component | Required States |
|-----------|-----------------|
| Task card | default, hover, selected, completed, focused |
| Task editor drawer | closed, open, voice-listening, validation error, saving |
| Project sidebar item | default, hover, active, focused |
| Progress milestone card | default, hover tooltip, loading fallback |
| Badge modal | closed, open, section expanded/collapsed, hovercard visible |
| Calendar day cell | empty, has tasks, selected, today, out-of-month |

---

## Accessibility Validation Checklist

1. Keyboard navigation reaches all actionable controls.
2. Focus indicator is visible on cards, buttons, chips, and modal controls.
3. Status communication includes text labels (not color-only).
4. Milestone/badge info remains understandable when hover is unavailable.
5. Color contrast remains acceptable for primary text and actionable controls.

---

## Design Guardrails

- Do not introduce new semantic colors without documenting purpose and usage.
- Do not mix interaction patterns for equivalent controls (e.g., button vs clickable text without rationale).
- Preserve density and scanability in task list; avoid adding dense decorative-only UI.

---

**Last updated:** 2026-03-23
