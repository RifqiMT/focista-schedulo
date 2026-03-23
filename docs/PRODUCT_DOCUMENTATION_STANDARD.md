# Product Documentation Standard — Focista Schedulo

**Last updated:** 2026-03-18  
**Owner:** Product (with Design and Engineering)

---

## Purpose

This standard defines how we write, structure, and maintain product documentation for **Focista Schedulo** so that it remains:

- **Current** with the shipped product and codebase
- **Readable** by product, design, and engineering
- **Actionable** for decision-making, delivery, and onboarding

All documentation should reflect the most up-to-date and comprehensive information about product overview, benefits, features, logic, business guidelines, tech guidelines, tech stack, and other important elements.

---

## Document Set and Responsibilities

| Document | Audience | Ownership | Update cadence |
|----------|----------|-----------|----------------|
| `README.md` (root) | Everyone | Engineering | Every meaningful product or repo change |
| `docs/README.md` | Everyone | Product | When doc set changes |
| `docs/PRD.md` | Product, Design, Engineering | Product | Monthly and on major features |
| `docs/USER_PERSONAS.md` | Product, Design | Product | Quarterly |
| `docs/USER_STORIES.md` | Product, Engineering | Product | Sprint planning and feature release |
| `docs/PRODUCT_METRICS.md` | Product, Analytics | Product Analytics | Monthly |
| `docs/METRICS_AND_OKRS.md` | Product Leadership | Product | Quarterly |
| `docs/DESIGN_GUIDELINES.md` | Design, Engineering | Design | Quarterly and on theme/component changes |
| `docs/ARCHITECTURE.md` | Engineering | Engineering | On architectural or API changes |
| `docs/VARIABLES.md` | Product, Analytics, Engineering | Product Analytics | Monthly and on model/schema changes |
| `docs/TRACEABILITY_MATRIX.md` | Product, Design, Engineering, QA | Product Ops | Every sprint and release |
| `docs/GUARDRAILS.md` | Product, Engineering, Security | Product + Engineering | Quarterly and on major capability changes |
| `docs/PRODUCT_DOCUMENTATION_STANDARD.md` | All | Product | When standards change |

---

## Writing Principles

1. **Single source of truth** — Every claim must map to the current UI, API, or a tracked plan in the PRD. Avoid contradicting the codebase.
2. **Plain language** — Use short paragraphs, clear headings, and consistent terminology. Prefer active voice.
3. **Define before use** — Every metric and variable is defined once in `docs/VARIABLES.md` with a friendly name, definition, formula (if derived), location in the app, and example.
4. **Shipped vs planned** — Clearly separate:
   - **Shipped:** Present in the current UI/API.
   - **Planned:** Explicitly labeled (e.g., “Planned”, “In discovery”, “Roadmap”).
5. **Avoid ambiguity** — Use examples and specify edge cases (time zones, recurring tasks, ID formats, multi-link and multi-location behavior).
6. **Traceability** — Architecture and tech docs should reference key files and endpoints.

---

## Required Template Sections

### PRD (`docs/PRD.md`)

- Product summary and problem statement
- Target users (with pointer to personas)
- Goals and non-goals
- Scope (MVP / current shipped / next)
- Core features and functional requirements
- Non-functional requirements
- User experience (primary flows, key UX principles)
- Analytics and metrics (pointer to metrics docs)
- Risks and mitigations
- Open questions and roadmap

### Variables (`docs/VARIABLES.md`)

For every variable (field, metric, derived value):

- **Variable name** (code / API)
- **Friendly name**
- **Definition**
- **Formula** (if derived)
- **Location in app** (UI sections and components)
- **Source of truth** (backend vs frontend-derived)
- **Example**
- **Relationships** (e.g., used by which other variables or components); maintain a high-level relationship chart

### Design Guidelines (`docs/DESIGN_GUIDELINES.md`)

- Theme palettes (with hex codes and usage)
- Typography (families, sizes, weights)
- Component rules (buttons, pills, cards, drawers, calendar, hovercard)
- Priority and status color mapping
- Accessibility (contrast, focus, keyboard)
- Interaction states (hover, active, disabled)

### User Personas (`docs/USER_PERSONAS.md`)

- Profile, primary goals, key behaviors
- Pain points and what success looks like
- Optional: quote or scenario

### User Stories (`docs/USER_STORIES.md`)

- Format: “As a [role], I want [goal] so that [benefit].”
- Acceptance criteria per story
- Grouped by epic/area (capture, projects, recurrence, calendar, export, gamification, etc.)

### Product Metrics (`docs/PRODUCT_METRICS.md`)

- North Star and key product metrics
- Definitions, formulas, instrumentation notes
- Pointers to VARIABLES.md for underlying fields

### Metrics and OKRs (`docs/METRICS_AND_OKRS.md`)

- Guiding principles (outcome over output, leading/lagging)
- Objectives and key results
- Inputs and initiatives

### Traceability Matrix (`docs/TRACEABILITY_MATRIX.md`)

- Explicit lineage from persona -> user story -> requirement -> code artifact -> API -> test -> metric/KR
- Coverage status (implemented / partial / planned)
- Release criticality and owner for each requirement group

### Guardrails (`docs/GUARDRAILS.md`)

- Product guardrails (scope boundaries, anti-goals, acceptable use)
- Technical guardrails (performance, reliability, data integrity, security)
- Operational guardrails (monitoring, rollback, incident response)
- AI/voice guardrails (input quality, parsing ambiguity, fallback behavior)

### Architecture (`docs/ARCHITECTURE.md`)

- Overview and repository structure
- Runtime topology (diagram)
- Data model summary and persistence
- Recurrence and identity strategy
- API surface and frontend state synchronization
- Build and dev commands

---

## Versioning and Change Management

- Every document includes:
  - **Last updated** date
  - **Owner** (role or team)
- If a doc conflicts with actual behavior:
  - Fix the docs in the same change set as the code, or
  - Add a “Known mismatch” note with a target fix date.

---

## Naming and Terminology

Use these canonical terms consistently:

| Term | Definition |
|------|-------------|
| **Task** | A unit of work with optional scheduling and metadata. |
| **Project** | A grouping container for tasks (e.g., Work, Personal). |
| **Series** | A repeating task pattern (recurrence). |
| **Occurrence** | A specific instance of a series (may have Child ID). |
| **Parent ID** | Stable identifier for a task or series: `YYYYMMDD-N`. |
| **Child ID** | Identifier for an occurrence within a series: `${parentId}-${index}`. |
| **Calendar view** | Month grid plus day-agenda timeline. |
| **Day agenda** | Hourly timeline for a single day. |
| **Voice input** | Speech-to-form autofill in the task editor. |
| **Hovercard** | Popover on task hover showing full task details. |
| **List view** | Task list with optional timeframe and status filters; repeating tasks can be expanded to show occurrences. |

---

**Last updated:** 2026-03-23
