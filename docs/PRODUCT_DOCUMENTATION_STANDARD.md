# Product Documentation Standard

**Last updated:** 2026-05-04  
**Owner:** Product (with Design + Engineering)

This standard defines how product documentation is authored, reviewed, versioned, and maintained for Focista Schedulo.

---

## 1) Documentation Objectives

All documentation must be:

- **Accurate:** Reflect shipped behavior and active roadmap truthfully.
- **Traceable:** Map business requirements to code, tests, and metrics.
- **Actionable:** Enable PM, design, engineering, and QA decisions.
- **Maintainable:** Structured for repeatable updates across releases.

---

## 2) Required Documentation Set

The following files are mandatory and must remain current:

- `README.md`
- `docs/README.md`
- `docs/PRD.md`
- `docs/USER_PERSONAS.md`
- `docs/USER_STORIES.md`
- `docs/VARIABLES.md`
- `docs/PRODUCT_METRICS.md`
- `docs/METRICS_AND_OKRS.md`
- `docs/DESIGN_GUIDELINES.md`
- `docs/TRACEABILITY_MATRIX.md`
- `docs/GUARDRAILS.md`
- `docs/ARCHITECTURE.md`
- `docs/API_CONTRACTS.md`
- `docs/DEPLOYMENT_VERCEL.md`
- `docs/DOCS_CODE_CROSSWALK.md`
- `docs/CHANGELOG.md`
- `docs/OPERATING_MODEL.md`
- `docs/TEST_STRATEGY.md`
- `docs/RACI_MATRIX.md`
- `docs/RELEASE_CHECKLIST_TEMPLATE.md`

---

## 3) Structural Format Rules

Each document must include:

1. `Last updated` date
2. Document `Owner`
3. Purpose/scope section
4. Clear headings and stable section hierarchy
5. Cross-links to related docs where relevant

---

## 4) Writing Quality Rules

- Use precise, professional wording.
- Distinguish clearly between:
  - **Shipped behavior**
  - **Planned behavior**
- Avoid ambiguous phrases without scope/timeframe.
- For formulas and metrics, include explicit definitions and examples.
- For API behavior, include contract-level request/response summaries.

### 4.1 Variables and API shape discipline

When stats, task fields, or API payloads change in code:

1. Update `docs/VARIABLES.md` (definitions, formulas, locations, examples) and extend the Mermaid relationship diagram if new links appear.
2. Update `docs/API_CONTRACTS.md` when request/response shapes or semantics change (note field names that diverge from behavior, e.g. calendar-week stats under a legacy key).
3. Update `docs/DOCS_CODE_CROSSWALK.md` and `docs/TRACEABILITY_MATRIX.md` so requirements and verification stay aligned.
4. Add a dated entry to `docs/CHANGELOG.md` describing doc and product impact.

---

## 5) Change Management Policy

When behavior changes in code:

1. Update affected docs in the same delivery window.
2. Add an entry in `CHANGELOG.md`.
3. Update traceability links (requirements -> code -> verification).
4. Reconcile variable and metric definitions if formulas changed.

---

## 6) Ownership and Cadence

| Document Group | Primary Owner | Minimum Cadence |
|---|---|---|
| Product strategy and requirements | Product | Monthly or major release |
| Design guidelines | Design | Quarterly or UI-system change |
| Architecture/API | Engineering | Every architecture/API change |
| Variables/metrics/OKRs | Product Analytics + Product | Monthly |
| Governance/traceability/guardrails | Product Ops + Engineering | Every release |

---

## 7) Release Readiness Documentation Gate

A release is not documentation-complete unless:

- PRD reflects final shipped scope
- API contracts reflect current route behaviors
- Variables and metrics formulas match implementation
- Traceability matrix includes changed requirements
- Changelog records notable changes and impact

---

## 8) Professional Product Documentation Baseline

The complete documentation suite must continuously cover:

- Product overview and business benefit
- Feature and workflow logic
- Technical architecture and persistence model
- Business/technical limitations and guardrails
- KPI and OKR measurement logic
- Requirement-to-implementation traceability

---

## 9) Error Communication Standard

All user-facing failure communication must:

- Explain probable root cause in plain language.
- Include a safe next-step instruction (`retry`, `check password`, `validate file format`, etc.).
- Avoid exposing only raw transport errors (for example, status-only messages without context).
- Preserve security by excluding sensitive internals (tokens, hashes, stack traces).

---

## 10) Source-Code Documentation Expectations

For complex logic paths, source files should include concise comments that clarify:

- Why an invariant exists (for example, profile scoping, recurrence determinism, read-only constraints).
- Why a fallback or recovery branch is necessary (import fallback, profile visibility bootstrap).
- Why a tradeoff was chosen (non-monolith runtime persistence, batch mutation flow).

---

## 11) Release Artifact Checklist (Mandatory)

Before considering a release documentation-complete, all of the following must exist and be updated:

- Product and technical overview (`README.md`, `docs/ARCHITECTURE.md`, `docs/API_CONTRACTS.md`)
- Product planning artifacts (`docs/PRD.md`, `docs/USER_PERSONAS.md`, `docs/USER_STORIES.md`)
- Analytics artifacts (`docs/VARIABLES.md`, `docs/PRODUCT_METRICS.md`, `docs/METRICS_AND_OKRS.md`)
- Governance artifacts (`docs/TRACEABILITY_MATRIX.md`, `docs/GUARDRAILS.md`, `docs/CHANGELOG.md`)
- Operating-quality artifacts (`docs/OPERATING_MODEL.md`, `docs/TEST_STRATEGY.md`)

