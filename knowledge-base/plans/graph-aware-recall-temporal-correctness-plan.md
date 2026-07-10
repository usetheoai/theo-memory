---
slug: graph-aware-recall-temporal-correctness
milestone_id: M0
created_at: 2026-07-10
goal: Graph-aware recall must never resurface t_invalid (superseded/evicted) memories and must honor asOf, reusing the shipped bi-temporal predicate, consistently across core/REST/MCP.
---

# Plan: Graph-aware recall temporal correctness (M0)

## Goal

Fix the correctness bug where `PgGraphExpansionStore`'s final SELECT joins `memories` **without** a temporal predicate — so 1–2 hop graph expansion resurfaces superseded/evicted memories — by reusing our shipped bi-temporal predicate (`composeTemporalWhere`, ADR-0011) **during the JOIN**, and thread `asOf` through the expansion so point-in-time graph recall matches the primary path. The predicate must be reused, not duplicated (DRY). The fix lands in one shared store and is proven to hold across core, REST `POST /v1/recall`, and the MCP `recall` tool.

## Baseline Context (deep review of current state)

**Git sha (HEAD at plan time):** `dcb978b` (branch `develop`). **Architecture boundary:** the temporal predicate lives behind the `GraphExpansionStore` DIP (infrastructure adapter), never leaked to callers (`architecture.md` §2). Callers pass `filters` (already carries `asOf`); the store applies the SQL.

### Files that will be touched

| File | LoC today | Last touch | Reason it exists |
|---|---|---|---|
| `packages/core/src/infrastructure/db/pg-graph-expansion-store.ts` | ~110 | `dcb978b` | **Bug site** — production `GraphExpansionStore`; final `JOIN memories m` SELECT (`:81-99`) OMITS the temporal predicate |
| `packages/core/src/infrastructure/db/pgvector-store.ts` | ~600 | `dcb978b` | Holds `composeTemporalWhere(asOf, startParamIndex)` at `:167-179` (module-private today) — the ADR-0011 predicate to reuse; used at `:514` |
| `packages/core/src/infrastructure/db/scoped-memory.ts` | ~520 | `dcb978b` | Routes `RecallOptions.asOf → Filters.asOf` (`:66`); invokes `expandByEntities({ …, filters, … })` |
| `packages/core/src/infrastructure/db/in-memory-graph-expansion-store.ts` | ~90 | `dcb978b` | In-memory `GraphExpansionStore` for unit tests; must mirror the temporal semantics (LSP) |
| `packages/core/src/infrastructure/db/in-memory-graph-expansion-store.test.ts` | (existing) | `dcb978b` | Unit tests to extend with temporal + asOf assertions |
| `packages/core/src/infrastructure/db/pgvector-store.test.ts` (or new `temporal-where.test.ts`) | (existing/NEW) | — | Unit test for the exported `composeTemporalWhere` |
| `tests/integration/**/graph-expansion-temporal.test.ts` | (NEW) | — | Integration vs real pgvector: no t_invalid resurfacing + asOf + REST + MCP |
| `CHANGELOG.md` | (existing) | — | Unbreakable Rule 6 |

### Current callers / dependents

| Symbol | Production callers | Test callers | Invariants to preserve |
|---|---|---|---|
| `composeTemporalWhere` (`pgvector-store.ts:167`) | primary recall path (`:514`) | pgvector tests | after export, ALSO used by the graph store; behavior unchanged for the primary caller (additive export) |
| `expandByEntities` (`pg-graph-expansion-store.ts:34`) | recall pipeline via `scoped-memory.ts` | in-memory-graph-expansion-store tests | fail-soft contract preserved; scope params `$1..$5` indices unchanged |
| `Filters.asOf` (`scope.ts`) | routed from `RecallOptions.asOf` (`scoped-memory.ts:66`) | recall tests | already reaches the store via `params.filters.asOf`; no DIP field added |

### Domain glossary

- **`t_invalid`** — soft-delete/supersession timestamp; a row is currently-valid iff `t_invalid IS NULL`.
- **seed CTE** — entities of the primary-hit memories; **hop-2 CTE** — entities edge-connected to seeds via `entity_edges`; **final SELECT** — re-materializes memories sharing expanded entities (`JOIN memories m`).
- **`composeTemporalWhere(asOf, startParamIndex)`** — returns `{sql, params, nextParamIndex}`: `t_invalid IS NULL` when `asOf` omitted; else the ADR-0011 bi-temporal clause with 2 bound params.

### Architecture boundaries affected

Only the infrastructure adapter layer (`db/`). No domain/application change. The DIP (`GraphExpansionStore`) signature is unchanged — `asOf` flows through the existing `filters`.

## Coverage Matrix

| Requirement / gap | Task(s) |
|---|---|
| Never resurface `t_invalid` memories through graph expansion | T1.2 |
| Honor `asOf` (point-in-time) through expansion | T1.3 |
| Reuse the predicate, do not duplicate (DRY) | T1.1 |
| In-memory store mirrors the same temporal semantics (LSP) | T1.4 |
| Holds across REST `POST /v1/recall` | T2.1 |
| Holds across MCP `recall` tool | T2.2 |
| Fail-soft contract preserved under the new predicate | T2.1 |
| Existing suite green + CHANGELOG updated | T3.1 |

**Coverage: 8/8 requirements mapped (100%).**

## Dependencies

No new dependency (parsimony ladder rung 4 — reuse). Confirmed present:

| Package | Version (declared) | Use |
|---|---|---|
| `pg` | `^8.13.0` (`packages/core/package.json:102`) | parametrized SQL for the expansion query |
| `drizzle-orm` | `^0.45.0` | schema (no query change needed) |

No `package.json` edit. `/deps-audit` expected PASS (no declared dep added, no CVE surface).

## Prior Art

- Blueprint: `.claude/knowledge-base/discoveries/blueprints/graph-aware-recall-temporal-correctness-blueprint.md` (SHIPPABLE_WITH_CAVEATS 70).
- Predicate source: `pgvector-store.ts:167-179` (ADR-0011). Peer precedent: letta filters row-validity in-read (`.claude/knowledge-base/references/letta/letta/orm/base.py:18`).
- Prior graph-aware-recall design: `.claude/knowledge-base/discoveries/plans/graph-aware-recall-plan.md`.

## ADRs

### ADR-M0-1 — Reuse `composeTemporalWhere` (export it), apply DURING the JOIN

**Decision:** export `composeTemporalWhere` from `pgvector-store.ts` (or extract to a `temporal-where.ts` helper) and call it in the graph expansion's final SELECT, applying the predicate inside the `JOIN memories m` `WHERE`, not as a post-query filter.

**Rationale:** during-JOIN filtering is correct under `LIMIT`, consistent with the primary path, and reuses a single audited predicate (`architecture.md` §2 DIP; `parsimony-ladder.md` rung 4).

**Alternatives considered:**
- *(a) Duplicate the SQL literal in the graph store* — rejected: violates DRY; two copies of the bi-temporal predicate drift.
- *(b) Post-filter in application code after the query* — rejected: breaks `LIMIT` correctness (DB `LIMIT`s including invalid rows, app-filter under-returns) and diverges from the four sibling in-SQL paths.
- *(c) Add a new `asOf` field to `ExpandByEntitiesParams`* — rejected: `asOf` already arrives via `params.filters.asOf`; a new field is redundant surface (YAGNI) and a pre-release breaking DIP change.

**Consequences:** `composeTemporalWhere` becomes an exported symbol with its own unit test; the graph store gains `filters.asOf`-driven param binding.

### ADR-M0-2 — M0 filters only the final SELECT; edge-own bi-temporality stays M1

**Decision:** apply the temporal predicate only in the final candidate SELECT. Do NOT add temporal predicates to the hop-2 `entity_edges` CTE.

**Rationale:** minimal correct change; validity of an edge's endpoint memory is derived from the source memory via the final JOIN (`architecture.md` §3 cohesion; `parsimony-ladder.md` rung 1).

**Alternatives considered:**
- *(a) Also filter the hop-2 edge CTE by edge validity* — rejected: `entity_edges` has no `t_valid/t_invalid` (that is milestone M1); every hop-2 memory is re-materialized in the final `JOIN memories m`, so filtering there already excludes it.
- *(b) Also scope the seed CTE* — deferred: seeds originate from the already-temporally-filtered primary search, so they cannot be invalid in the current call graph; scoping is defensive hardening (YAGNI for M0), noted as an M1 follow-up.

**Consequences:** M0 closes the resurfacing bug with the smallest correct diff; M1 owns edge-own windows.

## Phase 1 — Core fix (the store)

### T1.1 — Export/extract `composeTemporalWhere` for reuse

#### Why this step
The predicate must be reused, not copy-pasted (DRY). It is module-private today; the graph store lives in a different file and needs it.

#### TDD
- RED: `test_composeTemporalWhere_is_importable_and_builds_both_branches` — imports the (now-exported) `composeTemporalWhere`; GIVEN `composeTemporalWhere(undefined, 6)` THEN it returns `{ sql: 't_invalid IS NULL', params: [], nextParamIndex: 6 }`; GIVEN `composeTemporalWhere(new Date('2026-01-01'), 6)` THEN `params.length === 2` AND `nextParamIndex === 8` AND `sql` contains both `t_valid` and `t_invalid`. Fails initially: symbol not exported.
- GREEN: add `export` to `composeTemporalWhere` (or move to `temporal-where.ts` and re-export). Minimal.
- REFACTOR: co-locate the exported return type `TemporalWhere` if extracted.

#### Concurrency tests
(none — single-threaded)

### T1.2 — Apply the temporal predicate in the expansion final SELECT (THE BUG FIX)

#### Why this step
Closes the resurfacing bug: the final SELECT (`pg-graph-expansion-store.ts:88-92`) currently returns superseded memories.

#### TDD
- RED: `test_expandByEntities_does_not_return_t_invalid_memory` — GIVEN a shared-entity memory whose `t_invalid` is set (superseded), WHEN `expandByEntities({ seedMemoryIds, filters, hops:1, limit })` runs, THEN `results.every(r => r.result.id !== supersededId)`. Written for both in-memory and real-pgvector integration. Fails on current code (memory IS returned).
- GREEN: in `pg-graph-expansion-store.ts`, compute `const temporal = composeTemporalWhere(filters.asOf, 6)` (scope params are `$1..$5`); AND the temporal clause into the final SELECT `WHERE` on the `m` alias; push `...temporal.params` into `params2` before `limit`; set `LIMIT $${temporal.nextParamIndex}`.
- REFACTOR: keep seed CTE `$1` and scope `$2..$5` indices unchanged; keep the SQL readable.

#### Concurrency tests
(none — single-threaded)

### T1.3 — Honor `asOf` (point-in-time) through expansion

#### Why this step
Point-in-time graph recall must match the primary path (DoD).

#### TDD
- RED: `test_expandByEntities_asOf_returns_state_valid_at_instant` — GIVEN a memory with `t_valid=T0`, `t_invalid=T2`, WHEN `filters.asOf=T1` (T0<T1<T2) THEN the memory IS returned; WHEN `filters.asOf=T3` (>T2) THEN it is NOT. Assert both branches.
- GREEN: covered by T1.2's `composeTemporalWhere(filters.asOf, …)` asOf branch — this task adds the asserting tests + verifies param binding order.
- REFACTOR: none beyond T1.2.

#### Concurrency tests
(none — single-threaded)

### T1.4 — In-memory store mirrors the temporal semantics

#### Why this step
Unit tests use `InMemoryGraphExpansionStore`; it must not diverge from the pg store (LSP — substitutable).

#### TDD
- RED: `test_in_memory_expansion_honors_t_invalid_and_asOf` — same two assertions as T1.2/T1.3 against `InMemoryGraphExpansionStore`. Fails until it filters by `t_invalid`/`asOf`.
- GREEN: apply the equivalent JS predicate (currently-valid iff `t_invalid == null`; with `asOf`, `t_valid <= asOf < t_invalid`) in the in-memory expansion.
- REFACTOR: extract a tiny `isValidAt(row, asOf)` helper if it reduces duplication.

#### Concurrency tests
(none — single-threaded)

## Phase 2 — Surface parity

### T2.1 — REST `POST /v1/recall` honors the temporal filter through graphExpand

#### Why this step
The fix is in the shared store, but the DoD requires an integration test proving REST callers get it — and that the fail-soft contract is preserved.

#### TDD
- RED: `test_rest_recall_graphExpand_excludes_t_invalid` — POST `/v1/recall` with `graphExpand` enabled against real pgvector; a superseded memory linked by a shared entity is NOT in the response; plus an `asOf` variant. Fails on current code.
- GREEN: verify `asOf` + `graphExpand` flow from the REST handler into `filters` (routed via `scoped-memory.ts:66`); wire only if a gap is found.
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

### T2.2 — MCP `recall` tool honors the temporal filter

#### Why this step
DoD requires MCP parity evidence.

#### TDD
- RED: `test_mcp_recall_graphExpand_excludes_t_invalid` — drive the MCP `recall` handler with `graphExpand`; assert the superseded memory is absent. Fails on current code.
- GREEN: verify the MCP tool passes `asOf`/`graphExpand` into core recall; wire only if a gap is found.
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

## Phase 3 — Close-out

### T3.1 — CHANGELOG + full suite green

#### Why this step
Unbreakable Rule 6; regression safety.

#### TDD
- RED: n/a (documentation + green-suite gate).
- GREEN: add `CHANGELOG.md [Unreleased] § Fixed` entry; run the full core suite + integration; all green.
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

## Failure scenarios

External I/O = Postgres via `pg`. Scenarios:

| Scenario | Expected behavior |
|---|---|
| DB connection error / timeout during the expansion query | Graph expansion is **fail-soft** (existing ADR — a traversal error emits the `graph-aware-recall` fail-soft event and recall returns primary results without expansion). The temporal predicate MUST preserve this — the added SQL must not convert a fail-soft path into a hard failure. Test: inject a query error, assert recall still returns primary hits. |
| Invalid `asOf` (NaN Date) reaching the store | Rejected at the boundary before the store (`scoped-memory.ts:272` throws `InvalidScope`) — the store never receives a NaN asOf. Negative test asserts the typed error + message (`testing.md` §4.1). |
| `asOf` omitted (common path) | `composeTemporalWhere` returns `t_invalid IS NULL` (currently-valid) — default, zero extra params. |

## Test Plan

- Unit: `composeTemporalWhere` both branches (T1.1); in-memory expansion temporal semantics (T1.4).
- Integration (real `ankane/pgvector:v0.5.1` via `npm run test:integration` / `vitest.integration.config.ts`): T1.2 (no t_invalid resurfacing), T1.3 (asOf point-in-time), T2.1 (REST), T2.2 (MCP).
- Regression: full existing graph-aware-recall suite stays green (T3.1).

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Param-index renumbering bug: splicing temporal params shifts `LIMIT`'s positional index; an off-by-one produces a runtime SQL error | HIGH | Reuse `composeTemporalWhere`'s `nextParamIndex` for `LIMIT` (never hardcode); integration test exercises BOTH asOf-set and asOf-omitted branches so a wrong index fails loudly | claude-code |
| Behavior change for callers relying on stale inclusion (fewer results after the fix) | MEDIUM | This is the bug being fixed; grep confirms only the recall pipeline calls it; CHANGELOG documents it; pre-release, acceptable | claude-code |
| In-memory/pg divergence (LSP): fixing only the pg store leaves unit tests green while integration differs | MEDIUM | T1.4 fixes the in-memory store with the same assertions as T1.2/T1.3 | claude-code |

## Unresolved Questions

(none — every decision is resolved at plan time. The fix shape, predicate reuse, and param indexing are locked by the blueprint; seed/hop-2 CTE scoping is explicitly deferred to M1 per ADR-M0-2 — a scoped decision, not an open question.)

## Acceptance Criteria / Definition of Done

- [ ] `composeTemporalWhere` is exported and unit-tested for both branches (T1.1).
- [ ] `expandByEntities` (pg + in-memory) never returns a `t_invalid`-set memory; proven by a RED-first integration test (T1.2, T1.4).
- [ ] `expandByEntities` honors `asOf` with the point-in-time assertions passing (T1.3).
- [ ] REST `POST /v1/recall` and MCP `recall` each have an integration test asserting the temporal filter (T2.1, T2.2).
- [ ] Fail-soft contract preserved (failure-scenario test).
- [ ] No new dependency added; `package.json` unchanged.
- [ ] Full suite green; `CHANGELOG.md [Unreleased] § Fixed` updated (T3.1).
