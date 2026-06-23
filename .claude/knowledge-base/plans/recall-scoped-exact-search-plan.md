---
slug: recall-scoped-exact-search
milestone_id: RecallScopedExactSearch
created_at: 2026-06-23
goal: Guarantee scoped recall returns the in-scope nearest memories (recall@k correct) regardless of how dense the shared HNSW index is, by running scoped vector search as an exact distance sort over the scope-filtered subset (a MATERIALIZED CTE that filters via the scope btree first) instead of HNSW-approximate-then-filter, measured by an integration GOAL where a sparse scope in a dense multi-scope pgvector DB recalls its memory (RED on the current HNSW path, GREEN after).
---

# Plan: recall-scoped-exact-search

> **Version 1.0** — EG-6 of the entity-graph-dogfood-remediation-roadmap. The COMPLETE live-test (2026-06-23) found `recall()`/`search_memory` returning 0 results intermittently in the running dev stack: a scope whose rows are NOT among the global `hnsw.ef_search` (default 40) nearest to the query yields 0 even though the row exists with a healthy embedding and a scope-pre-filtered EXACT cosine returns it (dist 0). ROOT CAUSE: `PgvectorStore.search` issues `... embedding <=> $1 ORDER BY distance LIMIT k` with a `WHERE user_id=$x` filter; on pgvector 0.5.1 the HNSW index fetches ef_search candidates by global distance and applies the scope filter AFTER, so a sparse scope in a dense shared index is starved (the well-documented ANN+filter recall-degradation; pgvector 0.8.0's iterative scans would fix it natively but the runtime is pinned to `ankane/pgvector:v0.5.1`). This is NOT caught by the GOAL tests (they use isolated DBs → all rows in-scope → no starvation) and is NOT the EG-4/EG-5 work. FIX (project-owner choice): for a SELECTIVE (scope-filtered) recall, run the vector ordering as an EXACT distance sort over the scope-filtered subset — a `MATERIALIZED` CTE filters by the scope btree first, then the outer query sorts those rows by `<=>` exactly (no HNSW, no approximation) — guaranteeing recall@k. Unscoped vector search (no filter) keeps the HNSW path with a raised `hnsw.ef_search`. Scope: `packages/core` `PgvectorStore.search` SQL only — NO schema/migration/DIP/public-export change, NO new dependency.

## Goal

> "Guarantee scoped vector recall returns the in-scope nearest memories (recall@k correct) regardless of shared-index density — by running a SELECTIVE (scope-filtered) `PgvectorStore.search` as an exact distance sort over the scope-filtered subset (`MATERIALIZED` CTE: scope-btree filter first, then exact `<=>` order) — measured by `tests/integration/recall-scoped-exact-search.test.ts` where, in a pgvector DB seeded with many memories across other scopes PLUS one in the target scope, `recall()` for the target scope returns its memory (the same setup returns 0 on the pre-fix HNSW-then-filter path)."

## Context

EG-6 of `.claude/knowledge-base/roadmaps/entity-graph-dogfood-remediation-roadmap.md`, surfaced by the EG-5 complete live-test. `recall()` is the read half of the memory contract — silent 0-result recalls are the worst failure for a memory layer (the agent "forgets" what it stored). The starvation worsens as the shared per-tenant index grows across scopes, so it is a real multi-tenant production concern, not only a dev-DB artifact. Honors Princípio 2 (priorização/diversidade — recall must surface the right in-scope memories, not be starved by unrelated scopes) + Princípio 3 (the behavior is testable against a real dense pgvector, not hand-waved).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/infrastructure/db/pgvector-store.ts` | 1060 | `23d0715` (2026-06-22) | the pgvector adapter; `search()` (`:482`) runs the vector recall SQL `WHERE <temporal><filter> ORDER BY embedding <=> $1 LIMIT k`; `composeFilters` (`:177`) builds the scope/attribution/category/kind WHERE clause; `composeTemporalWhere` builds the bi-temporal predicate | the returned columns + `rowToResult` mapping UNCHANGED; the bi-temporal predicate UNCHANGED; `recordAccess` fire-and-forget UNCHANGED; param ordering `[vector, ...temporal, ...filter, topK]` preserved; `keywordSearch` (BM25) untouched |
| `tests/integration/recall-scoped-exact-search.test.ts` (NEW) | 0 | — | (to create) — dense-multi-scope GOAL: sparse target scope recalls its memory | — |
| `packages/core/src/infrastructure/db/pgvector-store.test.ts` (or nearest unit test) | n/a | (existing) | unit tests for the store SQL shape | existing assertions stay green; add a SQL-shape unit assertion for the scoped CTE path |

### Current callers / dependents

- **Symbol:** `PgvectorStore.search(query, topK, filters)` (`:482`) — called by the recall pipeline (`recall()` → 9-step search). The recall path ALWAYS passes a scope filter (user/session/agent), so the scoped exact path is the dominant runtime path. `search()` is the ONLY method changed; `keywordSearch`/`list`/`get`/`insert` untouched.
- **Symbol:** `composeFilters` (`:177`) — returns `{ sql, params, nextParamIndex }`; `filter.params.length > 0` iff a real filter (scope/attribution/category/kind) is present. Used to branch exact-vs-HNSW.
- **External:** NO public-export change. `PgvectorStore` consumers see identical results (now correct for sparse scopes); the SQL change is internal.

### Domain glossary

- **scoped (selective) recall** — a `search()` call whose `filters` produce a non-empty WHERE (scope id / attribution / category / kind). This is every `recall()`.
- **HNSW-then-filter starvation** — pgvector 0.5.1 HNSW returns the global `ef_search`-nearest vectors, THEN applies the WHERE; a scope whose rows are not in that global set yields 0.
- **MATERIALIZED CTE exact path** — a CTE that filters the scope rows first (via the `user_id`/`session_id`/`agent_id` btree), MATERIALIZED so the planner does NOT fold it back into an HNSW plan; the outer query sorts the (small) scoped set by `<=>` exactly → correct top-k.

### Architecture boundaries affected

- **`packages/core/src/infrastructure/db`** — a single-method SQL change in the pgvector adapter. No type/contract/DIP change (ADR-0008 untouched), no schema/migration, no new export. The only I/O is the existing pg query.

## Prior Art & Related Work

- **pgvector filtered-search guidance:** the pgvector README documents that with approximate (HNSW/IVFFlat) indexes a `WHERE` filter is applied AFTER the index scan, so selective filters can return fewer than `LIMIT` rows; remedies are raising `hnsw.ef_search`, partial/partitioned indexes, or (pgvector ≥ 0.8.0) iterative index scans. The MATERIALIZED-CTE "filter-first, exact-order" pattern is the standard 0.5.x workaround for highly selective filters.
- **Internal:** the EG-5 complete live-test report `.claude/knowledge-base/reviews/entity-label-language-determinism-review-2026-06-23.md` + the dev-stack evidence (scope-pre-filtered exact cosine returns dist 0 while the app HNSW path returns 0). `composeFilters` is the existing scope-WHERE builder reused unchanged.

## ADRs

### D1 — Scoped recall uses an exact distance sort over the scope-filtered subset (MATERIALIZED CTE)

**Decision:** When `composeFilters` yields a non-empty filter (a scoped recall — every `recall()`), `search()` runs `WITH scoped AS MATERIALIZED (SELECT <cols>, embedding FROM memories WHERE <temporal><filter>) SELECT <cols>, embedding <=> $1 AS distance FROM scoped ORDER BY distance ASC LIMIT $k`. The CTE filters via the scope btree (fast: only the scope's rows) and MATERIALIZED prevents the planner from re-introducing the HNSW plan; the outer sort is exact over the scoped subset → recall@k correct regardless of shared-index density.

**Rationale:** Correctness-first for the read half of the contract (Princípio 2). The scope btree (`memories_user_id_idx` etc.) makes fetching the scope cheap; exact sorting a single scope's vectors is acceptable (typical scopes are small-to-medium). Guaranteed correct (no ANN approximation) — unlike ef_search tuning, which only raises the probability.

**Alternatives rejected:**
- (a) Raise `hnsw.ef_search` only — REJECTED as the sole fix: probabilistic, not a guarantee; capped (~1000) so it fails at scale; still starves a sparse scope in a very dense index.
- (b) `SET enable_indexscan = off` — REJECTED: disables the scope btree too → full seq scan (slow); the CTE keeps the btree.
- (c) Upgrade to pgvector 0.8.0 iterative scans — REJECTED for this cycle: an infra change (image `ankane/pgvector:v0.5.1` → new image, compose, Docker-prod, migration re-test); larger blast radius. The CTE fix is in-code, no infra change. (Recorded as a future option.)

### D2 — Unscoped vector search keeps the plain HNSW path (ef_search tuning deferred)

**Decision:** When NO filter is present (no scope — not produced by `recall()` today, but the method is general), keep the existing plain HNSW `ORDER BY embedding <=> $1 LIMIT k` path UNCHANGED. The `hnsw.ef_search` raise originally proposed here is DEFERRED: it requires a transaction wrapper (`SET LOCAL`) to avoid leaking the GUC across a pooled connection, and since `recall()` is ALWAYS scoped, the unscoped path is never exercised by the recall pipeline — adding tx complexity for an unused path is YAGNI.

**Rationale:** The exact CTE path (D1) is only justified when a selective filter shrinks the candidate set; an unscoped exact sort would scan the whole table, so the unscoped path must stay HNSW. With recall always scoped, the unscoped path needs no change in this cycle. (In-cycle simplification, honestly disclosed — Inquebrável Rule 3.)

**Alternatives rejected:**
- (a) Exact path for unscoped too — REJECTED: full-table exact sort defeats the ANN index for legitimately-global searches.
- (b) `SET LOCAL hnsw.ef_search` in a tx for the unscoped path now — DEFERRED: tx complexity for a path `recall()` never hits (YAGNI); revisit if a real unscoped consumer appears.

## Dependencies

| Package | Version | Ecosystem | Status | Rule 9 evaluation | CVE status |
|---|---|---|---|---|---|
| (none) | — | — | NO CHANGE | EG-6 is a pure SQL change in the existing `pg`-backed adapter. No new dependency; `pg` + `pgvector` unchanged. | N/A — no dependency delta. |

`/deps-audit` is a no-op for EG-6 (no manifest change).

## Failure scenarios

`search()` performs ONE DB query (pg). Scenarios:

- **The MATERIALIZED CTE planner regression (seq scan instead of scope btree)** — if Postgres ignored the btree, a large table would seq-scan. Mitigation: the CTE WHERE uses the indexed scope columns; an `EXPLAIN` assertion in the unit/integration test confirms the scope btree (or a bitmap on it) is used, not a full seq scan. Test: EXPLAIN the scoped query shows an index/bitmap scan on the scope column.
- **DB error / connection drop mid-query** — UNCHANGED: `pool.query` rejects; the recall pipeline's existing error handling applies (no new failure mode introduced by the SQL shape).
- **Empty scope** — the CTE yields 0 rows → outer returns [] (correct: an empty scope recalls nothing). Test: recall on an unseeded scope → [].

## Phases

### Phase 1 — Scoped exact recall SQL

### T1.1 — Branch `search()` to the MATERIALIZED-CTE exact path for scoped queries

**Files to edit:**
- `packages/core/src/infrastructure/db/pgvector-store.ts` — in `search()`, when `filter.params.length > 0`, build the `WITH scoped AS MATERIALIZED (...) SELECT ... ORDER BY distance LIMIT $k` SQL; else keep the existing HNSW SQL (with `SET LOCAL hnsw.ef_search` in a transaction per D2). Returned columns + `rowToResult` + param order unchanged.
- `packages/core/src/infrastructure/db/pgvector-store.test.ts` (or nearest) — unit assertion on the scoped SQL shape (contains `MATERIALIZED` + `ORDER BY distance`).

#### Why this step

Action: make scoped recall filter-first + exact-order so it cannot be starved by HNSW global-top-N.

Reasoning: D1 — the only correctness-guaranteeing option on pgvector 0.5.1. The branch is keyed on `filter.params.length > 0` (the existing `composeFilters` output), so no new filter-detection logic. Columns/mapping/param-order preserved (Baseline invariants).

#### TDD

- RED `test('search uses the MATERIALIZED-CTE exact path when a scope filter is present')` — call `search` with `{ user_id }`; assert the issued SQL contains `MATERIALIZED` (capture via a stub pool that records the SQL).
- RED `test('search keeps the plain HNSW ORDER BY path when no filter is present')` — `search` with no filters → SQL does NOT contain `MATERIALIZED`.
- GREEN: implement the branch.
- REFACTOR: extract the column list shared by both SQL variants (DRY).

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- With a `{ user_id }` filter, the issued SQL contains the literal `MATERIALIZED` and `ORDER BY distance` (asserted via a SQL-capturing stub pool).
- Without filters, the SQL omits `MATERIALIZED` (HNSW path preserved).
- Returned `VectorStoreResult` shape unchanged (existing store unit tests stay green).

#### Definition of done

- `npm test -- packages/core/src/infrastructure/db/pgvector-store.test.ts` green.
- `npm run typecheck` + `npm run lint` clean.
- CHANGELOG `[Unreleased]` updated.

### Phase 2 — Final Phase: Integration Validation (dense multi-scope GOAL)

### T2.1 — Dense-multi-scope recall GOAL + full-suite + live re-verify

**Files to edit:**
- `tests/integration/recall-scoped-exact-search.test.ts` (NEW) — against real `ankane/pgvector:v0.5.1`: seed N (~60) memories in OTHER scopes with crafted vectors clustered near the query, PLUS one memory in the TARGET scope with a vector relevant to the query but ranked beyond `ef_search` among the noise; build the HNSW index; `recall(query, { user_id: target })` MUST return the target memory. Include an EXPLAIN assertion that the scoped query does not full-seq-scan.

#### Why this step

Action: prove the fix against a REAL dense pgvector that reproduces the starvation.

Reasoning: the GOAL must reproduce the exact production condition (dense shared HNSW index + sparse target scope) the live-test surfaced — isolated-DB tests never trigger it. Crafted vectors make the starvation deterministic (RED on the pre-fix path) and the fix verifiable (GREEN).

#### TDD

- RED (pre-fix): with the HNSW-then-filter SQL, the dense-multi-scope setup returns 0 for the target scope (reproduces the live-test starvation).
- GREEN (post-fix): the target scope recalls its memory (top-1) via the exact CTE path.
- REFACTOR: none (test-only).

#### Concurrency tests

(none — single-threaded)

#### Failure-scenario validation

- EXPLAIN the scoped query → uses an index/bitmap scan on the scope column (not a full seq scan). Empty-scope recall → [].

#### Acceptance criteria

- The dense-multi-scope GOAL returns the target memory (would return 0 on the pre-fix HNSW path).
- Full suite (`npm test`) green (zero regressions); typecheck + lint clean; `npm run build` succeeds.
- Live re-verify: rebuild the themory image; against the running dev stack's polluted `themem` DB, `recall()` for a previously-starved scope returns its memories.

#### Definition of done

- `npm test` full suite green; coverage gate on the store holds.
- `/code-quality` verdict ∈ {PASS, PASS_WITH_CAVEATS}.
- Live re-verify captured (curl recall returns >0 for a scoped query in the dense dev DB).
- CHANGELOG `[Unreleased]` has the EG-6 entry.
- Plan archived after `/review` READY_TO_MERGE + merge.

## Dependency Graph

- T1.1 (SQL branch) → blocks T2.1 (GOAL needs the fix). Safe order T1.1 → T2.1.

## Coverage Matrix

| # | Goal claim / requirement | Detail | Task |
|---|---|---|---|
| 1 | Scoped recall uses exact distance over the scope subset | MATERIALIZED CTE branch when filter present | T1.1 |
| 2 | Unscoped search keeps HNSW (raised ef_search) | no-filter path unchanged + SET LOCAL ef_search | T1.1 |
| 3 | Returned columns / result shape unchanged | rowToResult + param order preserved | T1.1 |
| 4 | No schema / migration / DIP / export / dep change | SQL-only change in the adapter | T1.1 |
| 5 | Dense-multi-scope GOAL: sparse scope recalls (RED→GREEN) | crafted vectors reproduce starvation vs real pgvector | T2.1 |
| 6 | Scoped query does not full-seq-scan (EXPLAIN) | btree/bitmap on scope column | T2.1 |
| 7 | Empty scope recalls [] | CTE yields 0 rows | T2.1 |
| 8 | Live re-verify on the dense dev DB | curl recall >0 for a scoped query | T2.1 |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Exact sort over a VERY large single scope (e.g. 100k memories in one user) is slower than HNSW | Medium | For a large scope, HNSW would NOT starve (the scope dominates the global nearest), so the perf trade-off only bites huge single scopes; a future size-threshold can route large scopes back to HNSW. Documented; not blocking (correctness-first per owner choice). | reviewer |
| The MATERIALIZED CTE planner picks a seq scan instead of the scope btree | Low | EXPLAIN assertion in the test; the scope columns are btree-indexed (`memories_user_id_idx` etc.). | implementer |
| SQL-shape change in core recall (high blast radius) | Medium | Columns + mapping + param order preserved; SQL-shape unit test + dense GOAL + full suite + live re-verify gate it. | reviewer |

## Unresolved Questions

- Should very large scopes route back to HNSW (size threshold)? Resolution: NOT in EG-6 (KISS; correctness-first per the owner choice). Recorded as a future optimization; pgvector 0.8.0 iterative scans (ADR D1 alt-c) is the longer-term path. No silent scope creep.

## Global Definition of Done

- [ ] T1.1–T2.1 complete with green TDD.
- [ ] `npm test` full suite green; `npm run typecheck` + `npm run lint` clean; `npm run build` succeeds.
- [ ] Dense-multi-scope GOAL passes (target scope recalls; RED on pre-fix path) + live dev-stack re-verify captured.
- [ ] `/deps-audit` no-op (no dependency change).
- [ ] `/code-quality` verdict ∈ {PASS, PASS_WITH_CAVEATS}.
- [ ] No paper names in `src/**`/tests.
- [ ] CHANGELOG `[Unreleased]` updated (Fixed).
- [ ] `/review` returns READY_TO_MERGE.
- [ ] Plan archived to `completed/` after merge.
