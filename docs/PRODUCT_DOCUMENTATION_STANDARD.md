# Product Documentation Standard

**Last updated:** 2026-07-19  
**Owner:** Product (with Design + Engineering)

This standard defines how product documentation is authored, reviewed, versioned, and maintained for Focista Schedulo.

---

## 1) Documentation Objectives

All documentation must be:

- **Accurate:** Reflect shipped behavior and active roadmap truthfully.
- **Traceable:** Map business requirements to code, tests, and metrics.
- **Actionable:** Enable PM, design, engineering, and QA decisions.
- **Maintainable:** Structured for repeatable updates across releases.
- **Comprehensive:** Cover product overview, benefits, features, logics, business/tech guidelines, stacks, and limitations.

---

## 2) Required Documentation Set

The following files are mandatory and must remain current:

| Path | Role |
|---|---|
| `README.md` | Product and engineering entry point |
| `docs/README.md` | Documentation index |
| `docs/PRD.md` | Requirements, scope, NFRs, readiness |
| `docs/USER_PERSONAS.md` | Persona archetypes and success outcomes |
| `docs/USER_STORIES.md` | Epics, stories, acceptance criteria |
| `docs/VARIABLES.md` | Variable catalog, formulas, Mermaid relationships |
| `docs/PRODUCT_METRICS.md` | Product KPI dictionary |
| `docs/METRICS_AND_OKRS.md` | Team OKRs and review cadence |
| `docs/DESIGN_GUIDELINES.md` | Themes, palettes, component standards |
| `docs/TRACEABILITY_MATRIX.md` | Requirement → code → verification |
| `docs/GUARDRAILS.md` | Business and technical limitations |
| `docs/ARCHITECTURE.md` | Runtime topology and persistence |
| `docs/API_CONTRACTS.md` | Endpoint contracts and semantics |
| `docs/DEPLOYMENT_VERCEL.md` | Production topology and env vars |
| `docs/DOCS_CODE_CROSSWALK.md` | Docs ↔ implementation map |
| `docs/CHANGELOG.md` | Historical development log |
| `docs/OPERATING_MODEL.md` | Collaboration and release governance |
| `docs/TEST_STRATEGY.md` | Test layers and quality gates |
| `docs/RACI_MATRIX.md` | Responsibility assignment |
| `docs/RELEASE_CHECKLIST_TEMPLATE.md` | Release sign-off template |

---

## 3) Structural Format Rules

Each document must include:

1. `Last updated` date (ISO `YYYY-MM-DD`)
2. Document `Owner`
3. Purpose/scope section (or equivalent opening)
4. Clear headings and stable section hierarchy
5. Cross-links to related docs where relevant

Optional but preferred for analytics and architecture docs:

- Explicit formulas and examples
- Mermaid diagrams for relationships or topology

---

## 4) Writing Quality Rules

- Use precise, professional wording.
- Distinguish clearly between:
  - **Shipped behavior**
  - **Planned behavior**
- Avoid ambiguous phrases without scope/timeframe.
- For formulas and metrics, include explicit definitions and examples.
- For API behavior, include contract-level request/response summaries.
- Prefer tables for catalogs (variables, metrics, requirements, RACI).

### 4.1 Variables and API shape discipline

When stats, task fields, or API payloads change in code:

1. Update `docs/VARIABLES.md` (definitions, formulas, locations, examples) and extend the Mermaid relationship diagram if new links appear.
2. Update `docs/API_CONTRACTS.md` when request/response shapes or semantics change (note field names that diverge from behavior, e.g. calendar-week stats under legacy key `last7Days`).
3. When achievement or milestone **user-facing copy** changes, update the canonical description table in `VARIABLES.md` and the Progress sections of Design Guidelines / PRD / Stories.
4. Update `docs/DOCS_CODE_CROSSWALK.md` and `docs/TRACEABILITY_MATRIX.md` so requirements and verification stay aligned.
5. Add a dated entry to `docs/CHANGELOG.md` describing doc and product impact.

### 4.2 Persistence and transfer discipline

When storage backends, debounce policy, or import/export transfer paths change:

1. Update `ARCHITECTURE.md`, `DEPLOYMENT_VERCEL.md`, `GUARDRAILS.md`, and `VARIABLES.md` (env/storage variables).
2. Document Neon transfer staging (`stagingPathname`, staging download URL) and body-size limits (`413`) explicitly.
3. Clarify automated sync/save vs. any remaining admin endpoints.
4. On Vercel serverless, document debounce=`0` and which mutations **await** flush before respond (especially task complete) plus multi-isolate freshness behavior.

### 4.3 Feedback-layer discipline

When toast or tooltip behavior changes:

1. Document exclusive-overlay and single-toast invariants in Design Guidelines, Guardrails, Architecture, and Stories.
2. Keep `uiExclusiveOverlay.ts` as the single source of exclusivity unless an approved redesign replaces it.

### 4.4 AI and secrets discipline

When Productivity Summary, Ask, or AI key flows change:

1. Update `API_CONTRACTS.md`, `VARIABLES.md` (periods, digests, `degraded`, `pst.aiKeys`), and deployment env tables.
2. Document never-log key policy and client vs server key precedence in Guardrails.
3. Keep degraded local-brief behavior explicit in PRD NFRs and Test Strategy.
4. Add/adjust stories (US-409–US-413) and FR-21/FR-24–FR-26 as needed.

---

## 5) Change Management Policy

When behavior changes in code:

1. Update affected docs in the same delivery window.
2. Add an entry in `CHANGELOG.md`.
3. Update traceability links (requirements → code → verification).
4. Reconcile variable and metric definitions if formulas changed.
5. Do not close a release with unresolved docs-code mismatches in `DOCS_CODE_CROSSWALK.md`.

---

## 6) Ownership and Cadence

| Document Group | Primary Owner | Minimum Cadence |
|---|---|---|
| Product strategy and requirements | Product | Monthly or major release |
| Design guidelines | Design | Quarterly or UI-system change |
| Architecture/API/deployment | Engineering | Every architecture/API change |
| Variables/metrics/OKRs | Product Analytics + Product | Monthly |
| Governance/traceability/guardrails | Product Ops + Engineering | Every release |

---

## 7) Release Readiness Documentation Gate

A release is not documentation-complete unless:

- PRD reflects final shipped scope
- API contracts reflect current route behaviors (including Neon transfer admin routes)
- Variables and metrics formulas match implementation
- Traceability matrix includes changed requirements
- Guardrails reflect current technical/business limits
- Changelog records notable changes and impact
- Crosswalk verification checklist passes

---

## 8) Professional Product Documentation Baseline

The complete documentation suite must continuously cover:

- Product overview and business benefit
- Feature and workflow logic
- Technical architecture and persistence model
- Business/technical limitations and guardrails
- KPI and OKR measurement logic
- Requirement-to-implementation traceability
- Design system tokens and component interaction standards
- Operating model, RACI, test strategy, and release evidence

---

## 9) Error Communication Standard

All user-facing failure communication must:

- Explain probable root cause in plain language.
- Include a safe next-step instruction (`retry`, `check password`, `validate file format`, `configure DATABASE_URL`, etc.).
- Avoid exposing only raw transport errors (for example, status-only messages without context).
- Preserve security by excluding sensitive internals (tokens, hashes, stack traces).
- Cover body-limit failures (`413`) with guidance to use Neon staging or reduce payload size.

---

## 10) Source-Code Documentation Expectations

For complex logic paths, source files should include concise comments that clarify:

- Why an invariant exists (profile scoping, recurrence determinism, read-only constraints).
- Why a fallback or recovery branch is necessary (import fallback, profile visibility bootstrap, Neon transfer staging).
- Why a tradeoff was chosen (non-monolith runtime persistence, Neon debounce on serverless, calendar-week under `last7Days`).

Do not add noisy comments that restate obvious code.

---

## 11) Release Artifact Checklist (Mandatory)

Before considering a release documentation-complete, all of the following must exist and be updated:

- Product and technical overview (`README.md`, `docs/ARCHITECTURE.md`, `docs/API_CONTRACTS.md`)
- Product planning artifacts (`docs/PRD.md`, `docs/USER_PERSONAS.md`, `docs/USER_STORIES.md`)
- Analytics artifacts (`docs/VARIABLES.md`, `docs/PRODUCT_METRICS.md`, `docs/METRICS_AND_OKRS.md`)
- Governance artifacts (`docs/TRACEABILITY_MATRIX.md`, `docs/GUARDRAILS.md`, `docs/CHANGELOG.md`)
- Operating-quality artifacts (`docs/OPERATING_MODEL.md`, `docs/TEST_STRATEGY.md`, `docs/RACI_MATRIX.md`)
- Design artifact (`docs/DESIGN_GUIDELINES.md`)
- Deployment artifact (`docs/DEPLOYMENT_VERCEL.md`) when topology or env vars change

---

## 12) Related Documents

- Index: `docs/README.md`
- Crosswalk: `docs/DOCS_CODE_CROSSWALK.md`
- Release template: `docs/RELEASE_CHECKLIST_TEMPLATE.md`
