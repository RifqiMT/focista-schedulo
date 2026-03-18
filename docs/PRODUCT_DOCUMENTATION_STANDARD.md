# Product Documentation Standard (Focista Schedulo)

## Purpose

This standard defines how we write, structure, and maintain product documentation for **Focista Schedulo** so it stays:

- **Current** with the shipped product
- **Readable** by product, design, and engineering
- **Actionable** for decision-making, delivery, and onboarding

## Document set and responsibilities

| Document | Audience | Ownership | Update cadence |
|---|---|---|---|
| `README.md` | Everyone | Engineering | Every meaningful change |
| `docs/PRD.md` | Product, Design, Engineering | Product | Monthly + major features |
| `docs/USER_PERSONAS.md` | Product, Design | Product | Quarterly |
| `docs/USER_STORIES.md` | Product, Engineering | Product | Sprint planning |
| `docs/PRODUCT_METRICS.md` | Product | Product Analytics | Monthly |
| `docs/METRICS_AND_OKRS.md` | Product Leadership | Product | Quarterly |
| `docs/DESIGN_GUIDELINES.md` | Design, Engineering | Design | Quarterly + theme changes |
| `docs/ARCHITECTURE.md` | Engineering | Engineering | Every architectural change |
| `docs/VARIABLES.md` | Product, Analytics, Engineering | Product Analytics | Monthly + model changes |

## Writing principles

- **Single source of truth**: Every claim must map to either the current UI, the API, or a tracked plan in PRD.
- **Prefer plain language**: Use short paragraphs, clear headings, and consistent terminology.
- **Define before you use**: Every metric/variable should be defined once in `docs/VARIABLES.md`.
- **Separate “shipped” vs “planned”**:
  - **Shipped**: present in the current UI/API.
  - **Planned**: explicitly labeled with status (e.g., “Planned”, “In discovery”).
- **Avoid ambiguity**:
  - Use examples and specify edge cases (time zones, recurring tasks, id formats).
- **Traceability**:
  - Architecture docs should reference the key files and endpoints.

## Required template sections

### PRD (`docs/PRD.md`)

- **Problem statement**
- **Target users**
- **Goals / Non-goals**
- **Scope (MVP / Current / Next)**
- **Functional requirements**
- **Non-functional requirements**
- **User experience**
- **Analytics / Metrics**
- **Risks and mitigations**
- **Open questions**

### Variables (`docs/VARIABLES.md`)

For every variable (field, metric, derived value):

- **Variable name** (code / API)
- **Friendly name**
- **Definition**
- **Formula** (if derived)
- **Location in app** (UI sections)
- **Source of truth** (backend vs frontend-derived)
- **Example**

### Design Guidelines (`docs/DESIGN_GUIDELINES.md`)

- **Theme palettes** (with hex codes)
- **Typography**
- **Component rules** (buttons, pills, cards, drawers, calendar)
- **Accessibility** (contrast, focus)
- **Interaction states** (hover, active, disabled)

## Versioning and change management

- Every doc should include:
  - **Last updated** date
  - **Owner** section
- If a doc conflicts with behavior:
  - Fix the docs within the same change set, or
  - Add a “Known mismatch” note with a fix target date.

## Naming and terminology

Use the following canonical terms:

- **Task**: a unit of work with optional scheduling and metadata.
- **Project**: a grouping container for tasks.
- **Series**: a repeating task pattern (recurring).
- **Occurrence**: a specific instance of a series.
- **Calendar view**: month grid + day agenda timeline.
- **Voice input**: speech-to-form autofill in the task editor.

