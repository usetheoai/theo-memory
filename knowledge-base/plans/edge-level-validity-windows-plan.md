---
slug: edge-level-validity-windows
milestone_id: M1
created_at: 2026-07-10
goal: Give entity_edges their own bi-temporal validity (t_valid/t_invalid) with deterministic automatic invalidation (forget-propagation + same-source-relation supersession), reusing the M0 temporal predicate, and filter graph traversal + graph surfaces by edge validity across core/REST/MCP/Dashboard.
---

# Plan: Edge-level validity windows + fact invalidation (M1)

## Goal

`entity_edges` today carries only `created_at` — an edge outlives the memory that produced it and a contradicting edge ("Kendra loves Adidas" → "Kendra loves Nike") silently coexists with the old one. M1 adds bi-temporal validity to edges (`t_valid`/`t_invalid`), with **deterministic** automatic invalidation — (a) forget-propagation: forgetting a memory invalidates the edges it produced; (b) supersession: an incoming edge with the same scope + source entity + relation but a **different** target invalidates the prior edge (history preserved, not deleted). Graph traversal (the hop-2 `entity_edges` CTE that M0 deferred per ADR-M0-2) and the graph surfaces filter by edge validity. Reuses the M0 `composeTemporalWhere` predicate (DRY). No LLM invalidation engine (KISS) — the deterministic rules cover the fact-supersession case; ambiguous semantic contradictions stay out of scope (documented).

## Baseline Context (deep review of current state)

**Git sha (HEAD at plan time):** `d66609e` (branch `develop`). **Architecture boundary:** edge persistence + invalidation live behind the `MemoryGraphStore` DIP; traversal behind `GraphExpansionStore`; both infrastructure adapters (`architecture.md` §2).

### Files that will be touched

| File | LoC today | Last touch | Reason it exists |
|---|---|---|---|
| `packages/core/src/infrastructure/db/migrations/0022_entity_edge_validity.sql` | (NEW) | — | Adds `entity_edges.t_valid` (default now) + `t_invalid` (nullable) + partial index |
| `packages/core/src/infrastructure/db/pg-memory-graph-store.ts` | ~130 | `d66609e` | `upsertEdges` — add supersession-invalidation before insert; add `invalidateEdgesByMemory` |
| `packages/core/src/domain/dip/memory-graph-store.ts` | ~65 | `d66609e` | `MemoryGraphStore` DIP — add `invalidateEdgesByMemory(memoryId, filters)` method |
| `packages/core/src/infrastructure/db/pg-graph-expansion-store.ts` | ~120 | `d66609e` | Hop-2 `entity_edges` CTE — filter edges by `t_invalid`/`asOf` (completes ADR-M0-2) |
| `packages/core/src/infrastructure/db/temporal-where.ts` | ~45 | `a4cd944` | Reused predicate builder (M0) — applied to `entity_edges` (`ee.` prefix) |
| `packages/core/src/infrastructure/db/local-memory.ts` | ~260 | `d66609e` | `forget` soft-delete (`t_invalid = NOW()`) — call `invalidateEdgesByMemory` after |
| `packages/api/src/server/handlers/graph.ts` | (existing) | — | `GET /v1/scopes/:type/:id/graph` — filter to active edges (+ optional `includeSuperseded`) |
| `packages/mcp/src/tools/*graph*` (if a graph tool exists) OR N/A | — | — | MCP graph surface parity (verify; wire only if a gap) |
| `CHANGELOG.md` | (existing) | — | Unbreakable Rule 6 |

### Current callers / dependents

| Symbol | Production callers | Test callers | Invariants to preserve |
|---|---|---|---|
| `MemoryGraphStore.upsertEdges` (`pg-memory-graph-store.ts:35`) | write pipeline (entity/edge extraction) | memory-graph-store tests | fail-soft (edge failure NEVER fails remember()); ON CONFLICT dedup unchanged |
| `PgGraphExpansionStore` hop-2 CTE (`pg-graph-expansion-store.ts:64-83`) | recall pipeline | graph-expansion tests | scope confinement unchanged; add temporal filter on `ee` |
| `local-memory.ts` forget (`:187` PgEvictor soft-delete) | `Memory.forget` | forget tests | soft-delete contract preserved; edge invalidation is additive + fail-soft |
| `graphHandler` (`app.ts:371`) | REST `GET /v1/scopes/:type/:id/graph` | graph handler tests | active-edges-only default; backward-compatible shape |

### Domain glossary

- **edge `t_valid`/`t_invalid`** — bi-temporal window on `entity_edges`; an edge is currently-active iff `t_invalid IS NULL`.
- **forget-propagation** — soft-deleting a memory sets `t_invalid` on the edges whose `source_memory_id` = that memory.
- **supersession** — an incoming edge `(scope, source_entity, relation, target≠prior)` sets `t_invalid` on the prior active edge with the same `(scope, source_entity, normalized_relation)` and a different target.
- **`composeTemporalWhere`** — the shared M0 predicate builder, reused with the `ee.` column prefix.

### Architecture boundaries affected

Infrastructure adapter layer + one DIP method addition (`invalidateEdgesByMemory`) + REST handler filter. No domain-logic change. The DIP grows by one method (ISP-safe, additive).

## Coverage Matrix

| Requirement / gap | Task(s) |
|---|---|
| `entity_edges` gains `t_valid`/`t_invalid` (migration) | T1.1 |
| Forget-propagation: forget memory invalidates its edges | T1.2 |
| Supersession: same source+relation, different target invalidates prior edge | T1.3 |
| Graph traversal hop-2 filters edges by validity + asOf (completes ADR-M0-2) | T1.4 |
| Reuse `composeTemporalWhere` for edges (DRY) | T1.4 |
| REST graph surface shows active edges (opt-in superseded) | T2.1 |
| MCP/Dashboard graph parity (active vs superseded) | T2.2 |
| Fail-soft: edge invalidation never fails remember()/forget() | T1.2, T1.3 |
| Existing suite green + CHANGELOG | T3.1 |

**Coverage: 9/9 requirements mapped (100%).**

## Dependencies

No new dependency (parsimony ladder rung 4 — reuse). Confirmed present:

| Package | Version (declared) | Use |
|---|---|---|
| `pg` | `^8.13.0` (`packages/core/package.json:102`) | parametrized SQL for the migration + invalidation |
| `drizzle-orm` | `^0.45.0` | schema declaration for the new columns |

No dependency added. `/deps-audit` expected PASS.

## Prior Art

- Milestone M0 (shipped v0.28.0): `composeTemporalWhere` in `packages/core/src/infrastructure/db/temporal-where.ts`; ADR-M0-2 explicitly deferred edge-own bi-temporality + hop-2 CTE filtering to M1.
- Blueprint (M0): `.claude/knowledge-base/discoveries/blueprints/graph-aware-recall-temporal-correctness-blueprint.md` — studied REDACTED fact-invalidation (invalidate, do not delete; preserve history).
- Existing edge model: `packages/core/src/infrastructure/db/migrations/0019_entity_edges.sql`.

## ADRs

### ADR-M1-1 — Deterministic invalidation only (no LLM engine)

**Decision:** automatic invalidation is deterministic: forget-propagation + same-(scope,source_entity,relation)/different-target supersession. No LLM is invoked to judge semantic contradiction.

**Rationale:** the fact-supersession case ("X loves A" → "X loves B") is structurally detectable (same subject+predicate, new object) — KISS, deterministic, no recurring LLM cost (`parsimony-ladder.md` rungs 1+5). Reuses the distillation contradiction philosophy without forking its LLM path.

**Alternatives considered:**
- *(a) LLM-judged edge contradiction (REDACTED-style)* — rejected for M1: recurring cost + non-determinism; the deterministic rules cover the common case. Documented as a future option, not built (YAGNI).
- *(b) Delete the superseded edge* — rejected: loses history; bi-temporal requires invalidate-not-delete (Princípio 3 auditability).

**Consequences:** ambiguous semantic contradictions (different predicate wording, same meaning) are NOT auto-invalidated in M1 — documented limitation.

### ADR-M1-2 — Edge validity is its OWN column, filtered in traversal + reused predicate

**Decision:** add `t_valid`/`t_invalid` to `entity_edges`; filter the hop-2 CTE by edge validity using the reused `composeTemporalWhere` (with `ee.` prefix); forget also propagates to edges so edge validity is not solely derived from the source memory.

**Rationale:** completes what M0 ADR-M0-2 deferred; makes edge validity first-class + queryable without a memories JOIN (`architecture.md` §3). DRY reuse of the M0 predicate.

**Alternatives considered:**
- *(a) Keep deriving edge validity from source memory only (M0 status quo)* — rejected: cannot express an edge invalidated independently of its single source memory (the supersession case), which is the milestone's point.
- *(b) A separate edge-history table* — rejected: two columns on `entity_edges` are simpler (KISS) and match the memories bi-temporal shape.

**Consequences:** the hop-2 CTE gains a temporal predicate; the migration is additive (nullable/defaulted, non-destructive per the project's migration discipline).

## Phase 1 — Core (schema + invalidation + traversal)

### T1.1 — Migration: `entity_edges.t_valid` + `t_invalid`

#### Why this step
Bi-temporal validity needs the columns first; additive + non-destructive.

#### TDD
- RED: `test_migration_adds_edge_validity_columns` — after `runMigrations`, `information_schema.columns` shows `entity_edges.t_valid` (NOT NULL default now) and `t_invalid` (nullable); a partial index `WHERE t_invalid IS NULL` exists. Fails before the migration file exists.
- GREEN: add `0022_entity_edge_validity.sql` (ALTER TABLE ADD COLUMN t_valid timestamptz DEFAULT now() NOT NULL, ADD COLUMN t_invalid timestamptz; CREATE INDEX partial) + drizzle schema update.
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

### T1.2 — Forget-propagation: invalidate a memory's edges on forget

#### Why this step
An edge must not outlive the memory that produced it (the derivable case made explicit + fail-soft).

#### TDD
- RED: `test_forget_invalidates_source_memory_edges` — GIVEN a remembered memory M with an extracted edge E (`source_memory_id = M`), WHEN `forget(M)` runs, THEN E's `t_invalid` is set (`SELECT t_invalid FROM entity_edges WHERE source_memory_id = M` is non-null). Fails before the propagation is wired.
- GREEN: add `MemoryGraphStore.invalidateEdgesByMemory(memoryId, filters)` (`UPDATE entity_edges SET t_invalid = now() WHERE source_memory_id = $1 AND t_invalid IS NULL` scoped); call it from `local-memory.ts` forget AFTER the memory soft-delete, wrapped fail-soft (edge failure never fails forget).
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

### T1.3 — Supersession: contradicting edge invalidates the prior

#### Why this step
The milestone's core: "Kendra loves Adidas" then "Kendra loves Nike" — the old edge is invalidated, history preserved.

#### TDD
- RED: `test_new_edge_supersedes_prior_same_source_relation_different_target` — GIVEN an active edge (src=Kendra, rel=loves, tgt=Adidas), WHEN an edge (src=Kendra, rel=loves, tgt=Nike) is upserted, THEN the Adidas edge's `t_invalid` is set AND the Nike edge is active. A re-assertion of the SAME triple does NOT invalidate (idempotent). Fails before supersession is wired.
- GREEN: in `upsertEdges`, before inserting, `UPDATE entity_edges SET t_invalid = now() WHERE (scope) AND source_entity_id = $ AND normalized_relation = $ AND target_entity_id <> $ AND t_invalid IS NULL`.
- REFACTOR: keep the UPDATE inside the existing BEGIN/COMMIT tx (atomic with the insert).

#### Concurrency tests
(none — single-threaded)

### T1.4 — Graph traversal hop-2 filters edges by validity + asOf (reuse M0 predicate)

#### Why this step
Completes ADR-M0-2: a superseded edge must not expand the entity set; asOf honored on edges.

#### TDD
- RED: `test_expandByEntities_hop2_excludes_superseded_edge` — GIVEN a 2-hop path through a superseded edge, WHEN `expandByEntities({hops:2})` runs, THEN the memory reachable ONLY via the superseded edge is NOT returned; with `asOf` before the edge's `t_invalid`, it IS. Fails before the hop-2 CTE filters `ee`.
- GREEN: in `pg-graph-expansion-store.ts`, apply `composeTemporalWhere(filters.asOf, N, 'ee.')` to the hop-2 `entity_edges` UNION branches.
- REFACTOR: keep param indexing coherent (reuse `nextParamIndex`).

#### Concurrency tests
(none — single-threaded)

## Phase 2 — Surfaces

### T2.1 — REST graph endpoint filters to active edges (opt-in superseded)

#### Why this step
`GET /v1/scopes/:type/:id/graph` must show the current graph (active edges), with an opt-in to see superseded (audit).

#### TDD
- RED: `test_rest_graph_excludes_superseded_edges_by_default` — after a supersession, `GET /v1/scopes/:type/:id/graph` returns only the active edge; `?includeSuperseded=true` returns both (superseded flagged). Fails before the handler filters.
- GREEN: `graphHandler` + `MemoryGraphStore` read filters `t_invalid IS NULL` by default; add the `includeSuperseded` query param.
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

### T2.2 — MCP / Dashboard graph parity

#### Why this step
Consistency: the MCP/Dashboard graph views must reflect active-vs-superseded like REST.

#### TDD
- RED: `test_mcp_graph_reflects_edge_validity` (if an MCP graph tool exists) OR a documented N/A with the Dashboard consuming the REST `includeSuperseded` param. Assert the active-only default.
- GREEN: verify the MCP graph path (if any) reads active edges; wire only if a gap. Dashboard consumes the REST param (no core change).
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

## Phase 3 — Close-out

### T3.1 — CHANGELOG + full suite green

#### Why this step
Unbreakable Rule 6; regression safety.

#### TDD
- RED: n/a (docs + green-suite gate).
- GREEN: CHANGELOG `[Unreleased] § Added` (edge bi-temporality) + `§ Fixed` (superseded edges no longer expand); full contract + integration suites green.
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

## Failure scenarios

External I/O = Postgres via `pg`.

| Scenario | Expected behavior |
|---|---|
| Edge-invalidation query errors during forget | **Fail-soft** — forget of the memory still succeeds; edge-invalidation failure is logged/evented, never propagates (mirrors the graph-write fail-soft). Test: inject error, assert forget still soft-deletes the memory. |
| Edge-invalidation errors during upsertEdges (write pipeline) | Fail-soft — a `remember()` NEVER fails on edge-linking/invalidation failure (existing invariant). Test asserts remember() still returns. |
| asOf invalid (NaN) reaching the traversal | Rejected at the recall boundary (pre-M0 guard, `scoped-memory.ts`) — the store never receives NaN. |
| Migration re-run (idempotency) | `ADD COLUMN IF NOT EXISTS` / drizzle journal guards — re-run is a no-op. |

## Test Plan

- Unit: supersession detection logic; edge `isValidAt` mirror in the in-memory graph store (if present).
- Integration (real `ankane/pgvector:v0.5.1`): T1.1 (columns), T1.2 (forget-propagation), T1.3 (supersession + idempotent re-assert), T1.4 (hop-2 excludes superseded + asOf), T2.1 (REST graph active-only + includeSuperseded).
- Regression: existing graph-aware-recall + entities/graph suites stay green (T3.1).

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Supersession heuristic (same source+relation, different target) may invalidate a legitimately co-valid edge (e.g. "likes Adidas AND Nike") | MEDIUM | Scope the rule to a documented, conservative case; the DoD test covers the intended supersession; multi-valued relations are a documented limitation (ADR-M1-1) — future opt-in per-relation cardinality | claude-code |
| Migration on a large `entity_edges` table (ADD COLUMN with default) | MEDIUM | `t_valid DEFAULT now()` is a metadata-only default in PG ≥ 11 (no table rewrite); partial index created CONCURRENTLY-safe pattern per the repo's migration runbook | claude-code |
| Edge-invalidation turning a fail-soft path hard | HIGH | Every invalidation call wrapped so a failure never fails remember()/forget(); failure-scenario tests assert this | claude-code |

## Unresolved Questions

(none — every decision is resolved at plan time. LLM-judged semantic contradiction is explicitly out of scope per ADR-M1-1; multi-valued-relation cardinality is a documented limitation, a scoped decision, not an open question.)

## Acceptance Criteria / Definition of Done

- [ ] Migration `0022_entity_edge_validity.sql` adds `t_valid`/`t_invalid` + partial index (T1.1).
- [ ] Forgetting a memory invalidates its edges; proven by a RED-first integration test (T1.2).
- [ ] A contradicting edge (same source+relation, different target) invalidates the prior; re-asserting the same triple is idempotent (T1.3).
- [ ] Graph traversal hop-2 excludes superseded edges and honors `asOf` (reused predicate) (T1.4).
- [ ] REST graph shows active edges by default + opt-in `includeSuperseded` (T2.1); MCP/Dashboard parity (T2.2).
- [ ] Fail-soft preserved for both remember() and forget() (failure-scenario tests).
- [ ] No new dependency; full suite green; CHANGELOG updated (T3.1).
