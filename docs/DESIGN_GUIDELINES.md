# Design Guidelines — Focista Schedulo

**Last updated**: 2026-03-18  
**Owner**: Design (with Engineering)  

This document describes the visual system used in the app and how to extend it consistently.

## Brand and tone

- **Tone**: calm, confident, “professional modern”
- **Visual cues**: clear hierarchy, strong hover/focus affordances, minimal clutter

## Theme: Indonesian palette (White / Red / Gold)

These are the canonical CSS variables defined in `frontend/src/styles.css`:

### Core surfaces

- **Background**: `--bg` = `#ffffff`
- **Surface**: `--surface` = `#fafafa`
- **Strong surface**: `--surface-strong` = `#ffffff`
- **Borders**:
  - `--border-subtle` = `#e5e7eb`
  - `--border-strong` = `#d1d5db`

### Typography colors

- **Primary text**: `--text-main` = `#111827`
- **Muted text**: `--text-muted` = `#6b7280`

### Brand accents

- **Red**: `--accent-red` = `#ce1126`
- **Red hover**: `--accent-red-hover` = `#e63946`
- **Red soft**: `--accent-red-soft` = `#fee2e2`
- **Gold**: `--accent-gold` = `#facc15`
- **Gold soft**: `--accent-gold-soft` = `#fef3c7`

## Layout rules

- **3-column desktop layout**: projects sidebar, main task board, progress panel
- **Responsive**: collapses to single-column under ~1024px width

## Components

### Buttons

- **Primary button**
  - Use for “Save”, “Create”, and irreversible confirmations
  - Must have visible hover and disabled states
- **Ghost button**
  - Secondary actions (e.g., New project, view toggles)
- **Icon button**
  - Only for compact actions; must have `aria-label`

### Task cards

- **Card surface**: `--surface-strong` with border `--border-strong`
- **Hover behavior**: stronger shadow + subtle lift + clearer border/outline
- **Metadata pills**:
  - Due date/time
  - Duration
  - Priority (distinct colors)
  - Project association

### Priority legend and colors

Priorities must be visually distinct in:

- task pills in list view
- calendar items
- day agenda event accents

If extending priority styling, keep:

- **High contrast** against white surface
- **Consistent mapping** across all views

### Drawer (Task Editor)

- Always show:
  - title + description
  - scheduling (due date/time) + duration
  - repeat controls
  - reminders/deadlines
  - labels/location/project
- **Voice input**:
  - show capture status clearly
  - show transcript preview and allow corrections

### Calendar month view

- **Cell hover/focus** must be obvious (outline/border change)
- **Items** should be scannable:
  - compact line height
  - priority accent
  - truncated title with tooltip/expansion via click

### Day agenda

- **Timeline**: hourly grid with clear tick labels
- **Events**: height proportional to `durationMinutes`
- **Multi-day tasks**: show continuation segments consistently

## Accessibility

- Provide **focus outlines** for keyboard navigation.
- Use sufficient contrast for text on red header and on gold accents.
- Avoid using color alone to convey meaning (use labels/pills).

## Design-to-code mapping (where to change)

- **Theme variables + most component styles**: `frontend/src/styles.css`
- **Header branding + layout**: `frontend/src/App.tsx` and `frontend/src/styles.css`
- **Calendar + agenda**: `frontend/src/components/TaskBoard.tsx` and calendar-related CSS

