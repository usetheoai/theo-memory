# Discovery Plan: M11 — Routing governance & observability (per-(workspace,user) config + audit + dashboard)

- **Version:** v1.0
- **Slug:** `m11-routing-governance-observability`
- **Owner:** memory-core
- **Created:** 2026-07-22
- **Cycle:** discover (phase 1 → feeds `/discover-edge-cases` → `/discover-plan-confidence` → `/discover-execute`)

## Context

M8 gave the agent a per-write routing choice (global vs session under `(workspace, user)`); M9 promotes
durable session facts to global. Neither is **operable or auditable**: an operator cannot (a) configure
the routing policy per `(workspace, user)` (thresholds, LLM-on/off, default scope), nor (b) inspect
*why* a memory landed in a given scope. ROADMAP M11 is the M8–M11 initiative's "operable-in-production"
capstone: a per-`(workspace, user)` routing-policy config with fail-closed defaults + admin-scoped writes,
a queryable audit record of every routing/promotion decision (Princípio 3), and a dashboard — all with
cross-user isolation asserted (404 on another `(workspace, user)`'s config/audit).

The design must be **reuse-first** (Unbreakable Rule 9): the audit surface reuses the shipped
recall-trace governance machinery + M9's `consolidation_history`; config validation reuses `zod`; the
isolation boundary reuses the M8 `(workspace, user)` Principal + `composeFilters`. This discovery grounds
those reuse decisions against real mem0/graphiti prior art before any code.

## Objective

Produce a blueprint that grounds M11's **per-(workspace,user) routing-policy config surface**, its
**placement-decision audit trail**, and its **isolation hard gate** against real mem0/graphiti code and
the already-shipped theo-memory governance/isolation machinery.

**Measurable success:** every research question answered with a citation; the blueprint names (a) the
config shape + fail-closed defaults, (b) the audit-record shape reusing recall-trace/consolidation
machinery, (c) the isolation-read boundary — each mapped to a shipped theo-memory symbol OR an explicit
new-code ADR; 4 coverage corners populated; zero fabricated citations.

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

- **mem0** (`.claude/knowledge-base/references/mem0/`): `mem0/mem0/configs/` (config shape/defaults),
  `mem0/server/` (REST/dashboard surface), `mem0/tests/configs/` (config tests).
- **graphiti** (`.claude/knowledge-base/references/graphiti/`): `graphiti_core/search/search_config.py`
  + `search_config_recipes.py` (named-policy config pattern).

### Out-of-Scope (explicit)

- The theo-cloud dashboard UI implementation (cross-repo; rides M5 CD per the M4 precedent — split the checkbox).
- Any change to the M8 routing DIP or M9 consolidation policy themselves (M11 governs them, does not alter them).
- mem0/graphiti LLM-client, embedder, and graph-store internals (unrelated to config/audit/isolation).
- Vector-store / migration mechanics already shipped (schema.ts, migrations-runner.ts) beyond the new audit/config tables.

## ADRs

### D1 — Time budget + stop conditions

mem0: 3h; graphiti: 2h. Per-question stop: once a citation answers the question, STOP — do not spelunk
adjacent subsystems. Halt the corner when its questions are answered.

### D2 — Governance reuses the shipped recall-trace machinery, NOT a new audit engine (Rule 9)

The routing/promotion audit record is a governance artifact exactly like the shipped recall-trace
(`packages/core/src/domain/dip/recall-trace-store.ts` + `infrastructure/db/recall-trace/`). The blueprint
MUST evaluate reusing that store/retention/cron shape (workspace-scoped read, retention) before proposing
any new audit engine. **Alternative rejected:** a bespoke routing-audit engine (duplicates M4 governance).

### D3 — Config validation reuses `zod`; isolation reuses the M8 Principal (Rule 9)

Per-`(workspace, user)` config is validated with the shipped `zod` stack (as the REST layer already does)
and every config/audit read is scoped by the resolved `Principal{workspaceId, userId}` + `composeFilters`
(the M8 boundary) — a mis-scoped read returns 404. **No new isolation mechanism.**

## Research Questions

Six questions across the four corners (techniques ×3, tests ×1, deps ×1, tools ×1). Every source and method path is verified to exist on disk (checked 2026-07-22).

| # | Question | Corner | Source | Method | Expected answer shape |
|---|---|---|---|---|---|
| Q1 | How does mem0 shape a per-instance/per-user memory config (fields, defaults, where thresholds/LLM-toggles live) that theo-memory's per-(workspace,user) routing config can mirror? | techniques | `.claude/knowledge-base/references/mem0/` | Grep `class .*Config`, `default`, `threshold` in `mem0/mem0/configs/` | Read `mem0/mem0/configs/` config classes + defaults | Prose + citation: config field set + fail-closed defaults, mapped onto a theo-memory routing-policy config row keyed by `(workspace_id, user_id)` |
| Q2 | How does graphiti express a NAMED policy/config recipe (a reusable, versioned config preset) that could model theo-memory's default vs per-user routing policy? | techniques | `.claude/knowledge-base/references/graphiti/` | Grep `recipe`, `SearchConfig`, `COMBINED` in `graphiti_core/search/search_config_recipes.py` | Read `graphiti_core/search/search_config_recipes.py` + `search_config.py` | Named-preset pattern (default policy + overrides) mapped onto theo-memory's fail-closed default + per-(workspace,user) override |
| Q3 | Does either reference keep a QUERYABLE audit/history of a memory's placement/mutation decision (the "why placed here"), and what fields does it carry (who/when/what/why)? | techniques | `.claude/knowledge-base/references/mem0/`, `.claude/knowledge-base/references/graphiti/` | Grep `history`, `audit`, `event`, `reason` in `mem0/mem0/memory/` + `graphiti_core/` | Read the mem0 history/store path + any graphiti audit path | Honest verdict: audit-record field set (or its absence), mapped onto REUSING `recall-trace-store.ts` + M9 `consolidation_history` (Rule 9, ADR D2) |
| Q4 | How does a reference test per-config/per-tenant behavior + isolation of config reads (does one config not affect another scope)? | tests | `.claude/knowledge-base/references/mem0/` | Grep `config`, `user_id`, `isolat` in `mem0/tests/configs/` + `mem0/tests/` | Read `mem0/tests/configs/` + a per-user isolation test | Config/isolation test pattern mapped onto a theo-memory real-pgvector test: user B's config/audit read → 404 |
| Q5 | What runtime deps does config validation/serialization need in each ref (pydantic/etc.), and does theo-memory need any NEW dep (vs the shipped zod)? | deps | `.claude/knowledge-base/references/mem0/` | Grep `pydantic` in `mem0/pyproject.toml` | Read `mem0/pyproject.toml` | Dep list + recommendation: theo-memory reuses shipped `zod` — NO new dep (Rule 9) |
| Q6 | What is the REST/dashboard surface shape a memory product exposes for config + observability (endpoints, per-scope distribution view)? | tools | `.claude/knowledge-base/references/mem0/` | Glob + Grep `route`, `app`, `dashboard` in `mem0/server/` | Read `mem0/server/` REST entry + `mem0/server/dashboard/` | Endpoint/observability shape mapped onto theo-memory REST (`GET/PUT /v1/routing-policy`, `GET /v1/routing-audit`) + the theo-cloud dashboard split (M4 precedent) |

## Coverage Matrix

| Corner | Questions | Status |
|---|---|---|
| techniques | Q1, Q2, Q3 | mapped (3) |
| tests | Q4 | mapped (1) |
| deps | Q5 | mapped (1) |
| tools | Q6 | mapped (1) |

100% of corners covered; 6 questions total (within the 5–10 budget, ≤ 3 per corner).

## Halt-loop checkpoints

- Before marking a question done: the cited path resolves (Read succeeds) and the answer names the theo-memory reuse target OR an explicit new-code ADR.
- Before the blueprint is complete: the audit-record design cites either `recall-trace-store.ts` reuse OR an ADR justifying a new store; the isolation read cites the M8 `(workspace, user)` boundary.

## Acceptance Criteria

- Every research question answered with a `knowledge-base/references/` citation that resolves.
- The blueprint names: config shape + fail-closed defaults; audit-record shape (reuse-grounded); the 404 isolation-read boundary.
- 4 coverage corners populated; ≥ 1 ADR; zero fabricated citations.

## Global Definition of Done

- `/discover-plan-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS on this plan.
- Feeds `/discover-execute` to produce `knowledge-base/discoveries/blueprints/m11-routing-governance-observability-blueprint.md`.
- Per `.claude/rules/discover-plan-golden-rule.md`: no empty coverage corner, no fabricated `references/` citation, ≤ 15 questions.
