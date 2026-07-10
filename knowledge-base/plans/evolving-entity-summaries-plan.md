---
slug: evolving-entity-summaries
milestone_id: M2
created_at: 2026-07-10
goal: Entities expose an on-demand summary that reflects their currently-active accrued facts (relations), computed at view time with zero per-write LLM cost, surfaced via core + REST + Dashboard.
---

# Plan: Evolving entity summaries (on-demand) (M2)

## Goal

Entities today carry `name`/`type`/`memoryCount`/`lastSeenAt` but no `summary` reflecting what is known about them. M2 adds an **on-demand** `summary` — a deterministic digest of the entity's currently-active outgoing relations (from `entity_edges` where `t_invalid IS NULL`, so it evolves with M1's supersession/invalidation) — computed at view time inside the existing `list()` read, with **zero per-write LLM cost** (ADR-M2-1). Surfaced on `GET /v1/scopes/:type/:id/entities` and the Dashboard Entities tab. An LLM natural-language summarizer is explicitly out of scope (YAGNI) — the deterministic active-facts digest is the summary that reflects accrued facts.

## Baseline Context (deep review of current state)

**Git sha (HEAD at plan time):** `168770c` (branch `develop`). **Architecture boundary:** the summary is computed in the `MemoryEntityStore` read adapter (infrastructure), surfaced through the DTO; no domain change (`architecture.md` §2).

### Files that will be touched

| File | LoC today | Last touch | Reason it exists |
|---|---|---|---|
| `packages/core/src/domain/dip/memory-entity-store.ts` | ~75 | `168770c` | `EntityNodeSummary` DTO — add `summary: string` |
| `packages/core/src/infrastructure/db/pg-memory-entity-store.ts` | ~123 | `168770c` | `list()` — add a LEFT JOIN LATERAL aggregating active outgoing relations into `summary` |
| `packages/api/src/server/handlers/entities.ts` | (existing) | — | `GET /v1/scopes/:type/:id/entities` — surface `summary` in the node DTO |
| `packages/core/src/infrastructure/db/in-memory-entity-store.ts` (if present) OR N/A | — | — | In-memory double mirrors the summary (LSP) if one implements the port |
| `tests/integration/entities/*.test.ts` | (existing) | — | Integration: entity summary reflects active relations + evolves on supersession |
| `CHANGELOG.md` | (existing) | — | Unbreakable Rule 6 |

### Current callers / dependents

| Symbol | Production callers | Test callers | Invariants to preserve |
|---|---|---|---|
| `MemoryEntityStore.list` (`pg-memory-entity-store.ts:89`) | `entitiesHandler` (REST) + `graphHandler` (nodes half) | entities/list tests | additive DTO field; existing consumers unaffected; scope WHERE unchanged |
| `EntityNodeSummary` (`memory-entity-store.ts:60`) | REST DTO mapping | contract tests | `summary` is additive (non-breaking) |

### Domain glossary

- **summary** — a deterministic, human-readable digest of the entity's currently-active outgoing relations: `string_agg` of `normalized_relation → target_name` over `entity_edges` where `source_entity_id = e.id AND t_invalid IS NULL`. Empty string when the entity has no active outgoing edges.
- **on-demand** — computed at `list()` (read) time, not persisted; no write-path LLM.

### Architecture boundaries affected

Infrastructure read adapter + one additive DTO field + REST DTO mapping. No domain/application change; no migration (read-only aggregate over existing tables).

## Coverage Matrix

| Requirement / gap | Task(s) |
|---|---|
| `EntityNodeSummary` gains `summary` (additive DTO) | T1.1 |
| `list()` computes the summary on-demand from active edges (zero LLM) | T1.2 |
| Summary evolves: a superseded relation drops out of the summary | T1.2 |
| REST `GET /v1/scopes/:type/:id/entities` surfaces `summary` | T2.1 |
| In-memory double mirrors the summary (LSP) if a port impl exists | T1.3 |
| Existing suite green + CHANGELOG | T3.1 |

**Coverage: 6/6 requirements mapped (100%).**

## Dependencies

No new dependency (parsimony ladder rung 4 — reuse). `pg` `^8.13.0` (`packages/core/package.json:102`) — the summary is pure SQL (`string_agg`) over `entity_edges`/`entities`. No migration, no `package.json` edit. `/deps-audit` expected PASS.

## Prior Art

- Milestone M1 (shipped v0.29.0): `entity_edges.t_invalid` — the summary filters `t_invalid IS NULL` so it reflects the active graph.
- Blueprint (M0): `.claude/knowledge-base/discoveries/blueprints/graph-aware-recall-temporal-correctness-blueprint.md` — Graphiti node summaries (regenerated as facts accrue); M2 delivers the on-demand, deterministic form.
- Existing entity read: `packages/core/src/infrastructure/db/pg-memory-entity-store.ts:89` (`list()`).

## ADRs

### ADR-M2-1 — On-demand deterministic digest, NOT eager LLM

**Decision:** the summary is a deterministic active-relations digest computed on-demand inside `list()`. No LLM is invoked; no summary is persisted.

**Rationale:** an eager (maintained-on-write) LLM summary costs one LLM call per entity per update — a recurring cost for marginal value (`parsimony-ladder.md` rungs 1+5; ROADMAP M2 out-of-scope note). The deterministic digest reflects accrued facts, evolves with M1 supersession, and is free.

**Alternatives considered:**
- *(a) Maintained-on-write LLM summary (Graphiti-style)* — rejected: recurring LLM cost; explicitly out of scope per ROADMAP.
- *(b) On-demand LLM summary via a `Summarizer` DIP* — deferred (YAGNI): no consumer requested a natural-language summary; the digest satisfies "summary reflecting accrued facts". A future `Summarizer` DIP can wrap the digest without a schema change.

**Consequences:** the summary is structured (not prose). Its quality tracks the relation-extraction quality.

## Phase 1 — Core

### T1.1 — `EntityNodeSummary` gains `summary`

#### Why this step
The DTO must carry the field before the read can populate it; additive/non-breaking.

#### TDD
- RED: `test_entity_node_summary_has_summary_field` — a stub `EntityNodeSummary` with a `summary: string` type-checks and reads back. Fails before the field exists.
- GREEN: add `readonly summary: string;` to `EntityNodeSummary`.
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

### T1.2 — `list()` computes the on-demand summary from active edges

#### Why this step
The core behavior: a deterministic digest of active outgoing relations, evolving with supersession.

#### TDD
- RED: `test_entity_summary_reflects_active_relations_and_evolves` — GIVEN entity Kendra with active edges (loves→Adidas), WHEN listed THEN `summary` contains `loves → Adidas`; WHEN a supersession retires it (loves→Nike) THEN the summary contains `loves → Nike` and NOT `Adidas`. Fails before the LATERAL aggregate.
- GREEN: add `LEFT JOIN LATERAL (SELECT string_agg(DISTINCT ee.normalized_relation || ' → ' || te.name, '; ' ORDER BY ...) AS summary FROM entity_edges ee JOIN entities te ON te.id = ee.target_entity_id WHERE ee.source_entity_id = e.id AND ee.t_invalid IS NULL) s ON true` to `list()`; SELECT `COALESCE(s.summary,'')`; map to the DTO.
- REFACTOR: keep the scope/GROUP BY unchanged.

#### Concurrency tests
(none — single-threaded)

### T1.3 — In-memory double mirrors the summary (LSP)

#### Why this step
If a `MemoryEntityStore` in-memory double exists, it must not diverge (substitutable).

#### TDD
- RED: `test_in_memory_entity_summary` — the in-memory double returns a summary consistent with the pg semantics (active outgoing relations). Fails before mirrored. If NO in-memory double implements the port, this task is documented N/A (the DTO field is still type-covered).
- GREEN: mirror the digest in the in-memory double, OR document N/A with evidence (grep shows no in-memory `MemoryEntityStore`).
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

## Phase 2 — Surfaces

### T2.1 — REST `GET /v1/scopes/:type/:id/entities` surfaces `summary`

#### Why this step
The Dashboard Entities tab consumes this endpoint; the summary must reach it.

#### TDD
- RED: `test_rest_entities_returns_summary` — after seeding an entity with an active relation, `GET /v1/scopes/:type/:id/entities` returns each node with a `summary` reflecting its active relations. Fails before the handler maps `summary`.
- GREEN: `entitiesHandler` includes `summary` in the node DTO (inherits from `list()`).
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

## Phase 3 — Close-out

### T3.1 — CHANGELOG + full suite green

#### Why this step
Unbreakable Rule 6; regression safety.

#### TDD
- RED: n/a (docs + green-suite gate).
- GREEN: CHANGELOG `[Unreleased] § Added` (on-demand entity summary); full contract + integration suites green.
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

## Failure scenarios

External I/O = Postgres via `pg`.

| Scenario | Expected behavior |
|---|---|
| Entity with NO active outgoing edges | `summary` is the empty string `''` (COALESCE) — never NULL; the DTO field is always a string. |
| Entity with only superseded edges (all `t_invalid` set) | `summary` = `''` — the digest reflects ONLY active facts (evolves correctly). |
| DB error during `list()` | Propagates as today (the entities read is not a fail-soft best-effort path; the endpoint returns the error). No behavior change from adding the LATERAL. |

## Test Plan

- Unit: `EntityNodeSummary` DTO shape (T1.1); in-memory summary if a double exists (T1.3).
- Integration (real `ankane/pgvector:v0.5.1`): T1.2 (summary reflects active relations + evolves on supersession), T2.1 (REST surfaces summary).
- Regression: existing entities/list + graph suites stay green (T3.1).

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| The digest is structured, not natural language — may under-deliver vs a Graphiti prose summary | LOW | ADR-M2-1 documents the on-demand/zero-LLM decision; a `Summarizer` DIP is a documented future extension with no schema change | claude-code |
| `string_agg` over a hub entity with many edges could produce a long summary | LOW | The digest is DISTINCT + bounded by the entity's active relations; a future `limit` on the aggregate is a trivial follow-up if needed (YAGNI now) | claude-code |
| LATERAL subquery adds read cost to `list()` | LOW | It reuses the `entity_edges_active_idx` partial index (M1); the aggregate is scoped per entity row; measured negligible on the test set | claude-code |

## Unresolved Questions

(none — every decision is resolved at plan time. The natural-language LLM summary is explicitly deferred to a future `Summarizer` DIP per ADR-M2-1 — a scoped decision, not an open question.)

## Acceptance Criteria / Definition of Done

- [ ] `EntityNodeSummary` carries `summary: string` (additive) (T1.1).
- [ ] `list()` computes the summary on-demand from active edges, zero LLM; proven by a RED-first integration test that also shows the summary EVOLVES when a relation is superseded (T1.2).
- [ ] In-memory double mirrors it OR documented N/A (T1.3).
- [ ] REST `GET /v1/scopes/:type/:id/entities` surfaces `summary` (T2.1).
- [ ] Empty-string (never NULL) for entities with no active relations (failure-scenario test).
- [ ] No new dependency; no migration; full suite green; CHANGELOG updated (T3.1).
