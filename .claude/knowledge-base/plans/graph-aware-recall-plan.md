---
slug: graph-aware-recall
milestone_id: GraphAwareRecall
created_at: 2026-06-22
goal: Add an opt-in GraphExpansionStore DIP + a pipeline Step 8.7 that pool-expands recall with memories connected by shared entities (1-2 hop JOINs over the existing entities/memory_entities/entity_edges tables), default OFF, fail-soft + 2 observable events, measured by a GOAL integration test against real pgvector.
---

# Plan: graph-aware-recall

> **Version 1.0** — evolves the shipped entity-relation-extraction feature (project-owner direction 2026-06-22: evolve the existing Postgres entity-graph, NOT a graph-DB backend). Adds an OPT-IN `GraphExpansionStore` DIP + a recall pipeline **Step 8.7** that POOL-EXPANDS results with memories connected by shared entities (1-hop default / 2-hop opt-in) via JOINs over the EXISTING `entities` / `memory_entities` / `entity_edges` tables — DEFAULT OFF (byte-unchanged), fail-soft, 2 new observable events. Structural mirror of the shipped cross-encoder reranker (Item 23). Grounded in `graph-aware-recall-blueprint.md` (SHIPPABLE, 0 hard caps). ZERO new dependency, NO poly-store, NO migration.

## Goal

> "Add `GraphExpansionStore` DIP (`expandByEntities(seedMemoryIds, filters, hops, limit)`) + a `PgGraphExpansionStore` (JOIN over the existing 3 tables) + an in-memory impl, wired opt-in via `createLocalMemory({ graphExpansionStore })` + `RecallOptions.graphExpand`, default OFF, fail-soft, emitting `recall_graph_expanded`/`recall_graph_failed`, measured by `tests/integration/graph-aware-recall.test.ts`: against real `ankane/pgvector:v0.5.1`, a memory connected by a SHARED ENTITY to the top result but BELOW the similarity threshold SURFACES when `graphExpand` is set (+ `recall_graph_expanded` emitted); a plain `recall()` with no `graphExpand` is byte-identical to today."

## Context

The entity-relation-extraction feature shipped the relational entity graph: `entities` (nodes), `memory_entities` (M:N memory↔entity, `0018_entity_nodes.sql`, indexed on `entity_id`), `entity_edges` (relation triples, `0019_entity_edges.sql`, indexed on source/target). They power the dashboard graph view but do NOT influence `recall()` (today semantic + BM25 + threshold, `packages/core/src/domain/retrieval/pipeline.ts`). The blueprint decided to mirror the SHIPPED opt-in-DIP seam — the reranker (`dip/reranker.ts`, pipeline Step 8.5) — adding a Step 8.7 graph-expansion stage that traverses the existing tables (JOINs only) to surface memories connected by shared entities. Honors `CLAUDE.md § Princípio 2` (priorização/diversidade > volume) + `§ Princípio 3` (auditability). ISP: `MemoryGraphStore` (2 methods) is NOT widened (its JSDoc locks the cap) — graph-expansion is a new read port.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariant to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/dip/graph-expansion-store.ts` (NEW) | 0 | — | `GraphExpansionStore` DIP (1 method) + param/result types | 1 method (ISP, ADR-0008); domain-pure (returns `VectorStoreResult` + weight) |
| `packages/core/src/domain/dip/graph-expansion-store.test-d.ts` (NEW) | 0 | — | type-level contract test | — |
| `packages/core/src/domain/memory-event.ts` | 149 | — | typed `MEMORY_EVENTS` union + `emitEvent` | append 2 literals (`recall_graph_expanded`/`recall_graph_failed`) |
| `packages/core/src/domain/options.ts` | 293 | — | `RecallOptions` (`rerank?`/`adaptive?` opt-in precedents) | additive `graphExpand?` toggle; default-OFF |
| `packages/core/src/domain/retrieval/pipeline.ts` | 425 | — | 9-step search; Step 8.5 reranker + Step 8.6 adaptive seams | additive Step 8.7 graph-expansion; default path byte-unchanged |
| `packages/core/src/infrastructure/db/scoped-memory.ts` | 538 | — | `recall()` → `retrieveResults` (cache + pipeline) | thread `graphExpansionStore` into pipeline deps; cache bypass when wired |
| `packages/core/src/infrastructure/db/config.ts` | 176 | — | `LocalMemoryConfig` (`reranker`/`retrievalPolicy` slot precedents) | additive `graphExpansionStore?` slot |
| `packages/core/src/infrastructure/db/factory.ts` | (exists) | — | auto-instantiates `PgMemoryGraphStore` from the pool (`:195`) | auto-default `PgGraphExpansionStore` from the pool when graphExpand is wired (mirror) |
| `packages/core/src/infrastructure/db/pg-graph-expansion-store.ts` (NEW) | 0 | — | `PgGraphExpansionStore` — the JOIN over the 3 tables | scope-filtered + LIMIT-bounded; returns connected rows + sharedEntities |
| `packages/core/src/infrastructure/db/in-memory-graph-expansion-store.ts` (NEW) | 0 | — | in-memory mirror for unit tests | byte-parity with the pg impl semantics |
| `packages/core/src/infrastructure/db/*graph-expansion*.test.ts` (NEW) | 0 | — | unit tests | — |
| `tests/integration/graph-aware-recall.test.ts` (NEW) | 0 | — | GOAL: shared-entity below-threshold memory surfaces + default-unchanged vs real pgvector | — |
| `tests/integration/p0-audit/{exports-contract,full-public-surface}.test.ts` | (exist) | — | export-count snapshots (core 55) | reconcile core 55→56 (DIP type export) |

### Current callers / dependents

- **`MemoryGraphStore` DIP** (`dip/memory-graph-store.ts`) — exactly 2 methods (`upsertEdges`+`listEdges`), JSDoc-locked ISP cap. NOT widened; graph-expansion is a separate port.
- **`Reranker` DIP** (`dip/reranker.ts`) + **pipeline Step 8.5** — the opt-in-DIP + post-threshold seam + fail-soft template.
- **`VectorStoreResult`** (`dip/vector-store.ts`, already imported in `pipeline.ts`) — the domain row DTO the `GraphExpansionStore` returns (no coupling to pipeline internals).
- **pgvector schema** — `memory_entities (memory_id, entity_id)` PK + `entity_id` index (`0018:14`); `entity_edges` source/target indexes (`0019:18-19`); `entities` scope columns.
- **`factory.ts:195`** — auto-instantiates `PgMemoryGraphStore(pool)`; the template for auto-defaulting `PgGraphExpansionStore`.
- **`MEMORY_EVENTS`** + `emitEvent` — the observability surface.

### Domain glossary
- **graph expansion** — given the threshold-passing seed memories, traverse the entity graph (shared entities, 1 hop; relation edges, opt-in 2nd hop) to find OTHER memories connected to them, and POOL-EXPAND the recall result with those (scored below genuine semantic hits).
- **shared-entity weight** — `count(DISTINCT shared entity)` between a candidate memory and the seed set; the graph relevance signal.
- **pool-expansion (vs boost)** — fetching connected memories NOT already in the threshold pool (the value: surfacing below-threshold connected memories), as opposed to merely re-scoring in-pool members.
- **opt-in / default-OFF** — no `graphExpand` option + no `graphExpansionStore` config ⇒ pipeline byte-identical to today.

### Architecture boundaries affected

- **DIP layer (`packages/core/src/domain/dip/`)** — a NEW `GraphExpansionStore` port is declared here (architecture.md § 3: domain declares, infra implements; no domain→infra import). It returns the domain `VectorStoreResult` DTO, not a pipeline-internal type.
- **Retrieval domain (`pipeline.ts`)** — Step 8.7 consumes the `GraphExpansionStore` TYPE only (DIP-clean) at the same post-threshold seam as the reranker.
- **Infrastructure (`infrastructure/db/`)** — `PgGraphExpansionStore` (the JOIN) + `InMemoryGraphExpansionStore` (test mirror) implement the port. NO new migration (the tables + indexes already exist).
- **Composition root (`factory.ts` + `scoped-memory.ts`)** — the `graphExpansionStore?` DIP instance is injected here (mirrors the `memoryGraphStore` auto-default) + threaded into the pipeline deps; high-level recall depends on the abstraction.
- **Public API surface (`package.json#exports` + `/contract`)** — additive: the DIP TYPE (zero-runtime) re-exported from `/contract`; no new subpath needed (the pg/in-memory impls are wired via factory, not a consumer subpath — same as `MemoryGraphStore`).

## Prior Art & Related Work

- **Internal (load-bearing):** the cross-encoder reranker (Item 23) + adaptive-retrieval (Item 13) cycles — the opt-in-DIP + post-threshold seam + fail-soft + GOAL-test pattern. The entity-relation-extraction cycle — the `entities`/`memory_entities`/`entity_edges` schema + the `MemoryGraphStore`/`MemoryEntityStore` DIPs + the ISP cap.
- **External:** graph-augmented retrieval / GraphRAG patterns (entity-linked expansion) — cited as the technique family; TheMemory's twist is doing it over a relational store (no graph DB), per the "graph WITHOUT poly-store" thesis.
- **Clones (confirmed-absent baseline):** mem0's depth-1 reference clone does not ship its graph module under `mem0/memory/`; letta `services/` has passage/archive/block managers but no entity-graph-boosted recall. Graph-aware recall is original to TheMemory among the clones.

## Dependencies

No new dependency. The traversal is pure SQL over 3 existing tables; the in-memory mirror is plain TS; the row DTO (`VectorStoreResult`) + event surface already exist. Mirrors the reranker/ontology/adaptive zero-dep precedent. `/deps-audit` confirms below.

| Dependency | Version | New? | Rule 9 evaluation |
|---|---|---|---|
| (none) | — | No | The feature is a DIP + a JOIN query + a pipeline seam; no library needed. No graph DB (Item 14 declined). No alternatives to evaluate because no dependency is introduced. |

## ADRs

### D1 — New `GraphExpansionStore` DIP (1 method); do NOT widen `MemoryGraphStore`
**Decision:** a dedicated read port `expandByEntities(params): Promise<readonly GraphExpansionRow[]>` where `GraphExpansionRow = { result: VectorStoreResult; sharedEntities: number }`.
**Rationale:** ISP — `MemoryGraphStore`'s JSDoc locks it at 2 methods (upsert+list); recall-time traversal is a distinct read concern. Returning the domain `VectorStoreResult` (not a pipeline-internal type) keeps the DIP domain-pure AND lets the pipeline build result rows WITHOUT a second fetch round-trip (refines blueprint D1's "ids+weights then fetch" → "rows+weights in one query"; strictly fewer round-trips).
**Alternatives:** widen `MemoryGraphStore` (rejected — breaks documented ISP cap); return ids+weights then batch-fetch via `VectorStore` (rejected — needs a new VectorStore method + a 2nd round-trip); reuse `MemoryEntityStore` (rejected — owns node listing, not traversal).
**Consequences:** a new DIP + pg impl + in-memory impl + the DIP type exported from `/contract`.

### D2 — Traversal via JOINs; 1 hop default, 2 hops opt-in; LIMIT + scope bounded
**Decision:** 1-hop shared-entity self-join default; `entity_edges` adds an opt-in 2nd hop; always `LIMIT`-bounded + scope-filtered (workspace + user/session/agent).
**Rationale:** the indexes (`memory_entities_entity_id_idx`, `entity_edges_source/target_idx`) make it cheap; ≥3 hops risk fan-out (YAGNI).
**Alternatives:** recursive CTE arbitrary depth (rejected — fan-out/YAGNI); graph DB (rejected — Item 14 declined).
**Consequences:** deterministic, index-backed; hop count is an opt-in knob (`graphExpand.hops`).

### D3 — Step 8.7 pool-expansion; graph score BANDED below genuine semantic hits
**Decision:** Step 8.7 (after threshold/Step 8 + adaptive Step 8.6, before rerank/diversify/topK) calls `expandByEntities` with the top-N `scored` ids as seeds; for returned rows NOT already in `scored`, assigns a graph score = `min(lowestSeedScore, threshold) * (sharedEntities / (sharedEntities + 1))` (strictly below the lowest genuine threshold-passing score so a graph hit NEVER outranks a real semantic hit), merges + re-sorts + topK.
**Rationale:** the value is surfacing below-threshold connected memories (pure boost can't); banding preserves precision (Princípio 2). Running before rerank/diversify lets them operate on the expanded pool.
**Alternatives:** boost-in-pool-only (rejected — can't surface new rows); unbounded graph score (rejected — weak graph links would outrank strong semantic hits).
**Consequences:** the score function is documented + unit-tested; graph hits append at the tail, ordered by shared-entity weight.
**EC-1 absorption (edge-case-plan):** Step 8.7 dedups against the existing pool — rows whose id is already in `scored` are skipped (a `Set(scored.ids)` guard) so a connected-AND-threshold-passing memory is never duplicated.
**Score-formula refinement (review F-xval-2):** the shipped band is `floor * GRAPH_SCORE_BAND_FACTOR(0.999) * (sharedEntities/(sharedEntities+1))` where `floor = min(score)` over the WHOLE threshold-passing pool. Contract-equivalent to the ADR's `min(lowestSeedScore, threshold) * f(...)` (post-threshold `lowestSeedScore >= threshold`, so both guarantee strictly-below); the named constant + full-pool floor make the "never outrank a genuine hit" invariant explicit.

### D5 — Candidate-side scope isolation (no cross-scope leak)
**Decision:** the traversal JOIN filters the CANDIDATE memory by the recall `filters` (workspace + user/session/agent), not only the seed. A memory in a DIFFERENT scope that merely shares an entity is NEVER surfaced.
**Rationale:** entities can be shared across scopes; surfacing another scope's memory is an isolation defect (IDOR-like). Scope-confinement is non-negotiable (Princípio 3 + multi-tenant isolation).
**Alternatives:** filter only by the seed scope (rejected — the candidate could still be cross-scope); post-filter in the pipeline (rejected — leaks at the SQL boundary; filter at the source).
**Consequences:** the pg JOIN + the in-memory impl both apply the candidate-side scope predicate; EC-2 isolation is unit + integration tested.

### D4 — Opt-in + default-OFF + fail-soft + 2 observable events + cache bypass
**Decision:** `RecallOptions.graphExpand?: { hops?: 1|2; limit?: number }` + `createLocalMemory({ graphExpansionStore })` (auto-defaulted from the pool like `memoryGraphStore`); active only when a store is wired AND `graphExpand` is set; default OFF (byte-unchanged). Fail-soft (a traversal/build error degrades to the non-graph pool + `recall_graph_failed`); `recall_graph_expanded{seeds, expanded, hops}` on success. A wired+requested graph-expand BYPASSES the recall cache (the cache key does not encode graph expansion — mirrors rerank).
**Rationale:** the proven contract shipped 5×. Princípio 3 auditability.
**Alternatives:** on-by-default (rejected — breaks byte-unchanged); throw-on-error (rejected — non-critical enhancement must never fail recall).
**Consequences:** 2 new event literals; cache-applicability gains a `graphExpand === undefined` clause.

## Dependency Graph

```
T1.1 (DIP) ─┬─> T2.1 (events + RecallOptions.graphExpand)
            └─> T4.1 (pg impl) + T4.2 (in-memory impl) ── depend on T1.1
T2.1 ─> T3.1 (pipeline Step 8.7 + scoped-memory thread + cache bypass + fail-soft + events)
T3.1, T4.1, T4.2 ─> T4.3 (config slot + factory auto-default + DIP type export + count reconcile)
T4.3 ─> T5.1 (GOAL integration + full gate)
```

Phases 1→2→3→4→5 sequential; T4.1/T4.2 may parallelize with T2.1/T3.1 (depend on T1.1 only).

## Phase 1 — GraphExpansionStore DIP

### T1.1 — `GraphExpansionStore` DIP + type-level contract

#### Why this step
**Action:** create `dip/graph-expansion-store.ts` — the `GraphExpansionStore` interface (1 method `expandByEntities`) + `ExpandByEntitiesParams` + `GraphExpansionRow` ({ result: VectorStoreResult; sharedEntities: number }), JSDoc citing ADR D1 + the ISP discipline (do NOT widen MemoryGraphStore).
**Reasoning:** the DIP is the spine; every downstream task depends on its shape. Mirrors the `Reranker`/`MemoryGraphStore` DIP shape (ISP-minimal, async, DIP-boundary discipline architecture.md § 3).

#### TDD
- RED: `graph-expansion-store.test-d.ts` — `expandByEntities` returns `Promise<readonly GraphExpansionRow[]>`; params shape `{seedMemoryIds, filters, hops, limit}`; `GraphExpansionRow.result` is `VectorStoreResult`.
- GREEN: declare the interface + types.
- REFACTOR: JSDoc citing ADR D1 + ADR-0008.

#### Files to edit
- `packages/core/src/domain/dip/graph-expansion-store.ts` (NEW)
- `packages/core/src/domain/dip/graph-expansion-store.test-d.ts` (NEW)

#### Deep file dependency analysis
Imports `VectorStoreResult` (`dip/vector-store.js`) + `Filters` (`scope.js`). No runtime deps — pure type module, bundle-neutral.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `GraphExpansionStore` has exactly 1 method (ISP, ADR-0008 cap).
- [ ] Returns `VectorStoreResult` rows + sharedEntities weight (domain-pure).
- [ ] `tsc -p tsconfig.contract.json` clean.

#### DoD
- [ ] `npx tsc --noEmit -p tsconfig.contract.json` clean; CHANGELOG `[Unreleased] § Added` started.

## Phase 2 — Events + opt-in option

### T2.1 — 2 `MEMORY_EVENTS` literals + `RecallOptions.graphExpand`

#### Why this step
**Action:** append `recall_graph_expanded` + `recall_graph_failed` to `MEMORY_EVENTS` + add `RecallOptions.graphExpand?: { hops?: 1|2; limit?: number }` to `options.ts`.
**Reasoning:** the observability surface (Princípio 3) + the opt-in toggle must exist before the pipeline emits/consumes them. Mirrors the `recall_rerank_failed` literal + the `rerank?` toggle.

#### TDD
- RED: `memory-event.test.ts` — assert the 2 new literals + length; `options.test-d.ts` — assert `RecallOptions['graphExpand']` shape.
- GREEN: append literals + toggle.
- REFACTOR: JSDoc on each (when fired / default-OFF).

#### Files to edit
- `packages/core/src/domain/memory-event.ts` + `memory-event.test.ts`
- `packages/core/src/domain/options.ts` + `options.test-d.ts`

#### Deep file dependency analysis
Appending literals widens `MemoryEvent` (additive). `RecallOptions.graphExpand` is optional → no breaking change. The `RecallOptions` interface ends at the `}` AFTER the `adaptive?` block (verify the insert lands INSIDE `RecallOptions`, lines 73-end — NOT in `GetAllOptions`; the adaptive-retrieval cycle hit exactly this mis-anchor bug, so confirm the closing brace).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] 2 new literals present; `MemoryEvent` widened; length snapshot updated.
- [ ] `RecallOptions.graphExpand` optional; default-OFF preserved; lands inside `RecallOptions`.

#### DoD
- [ ] `npx vitest run --config vitest.contract.config.ts packages/core/src/domain/memory-event.test.ts packages/core/src/domain/options.test-d.ts` green; `tsc -p tsconfig.contract.json` clean (the authoritative type gate — NOT the vitest typecheck subset).

## Phase 3 — Pipeline Step 8.7 + wiring

### T3.1 — pipeline Step 8.7 pool-expansion (fail-soft + events) + scoped-memory thread + cache bypass

#### Why this step
**Action:** in `pipeline.ts`, after Step 8 (+ Step 8.6 adaptive), add Step 8.7: when `deps.graphExpansionStore` wired AND `options.graphExpand` set, call `expandByEntities({ seedMemoryIds: scored.slice(0,seedN).ids, filters, hops, limit })`; for returned rows NOT in `scored`, build ScoredRows with the banded graph score (ADR D3), merge + re-sort; emit `recall_graph_expanded`. Wrap fail-soft → on throw emit `recall_graph_failed`, return the original pool. In `scoped-memory.ts`, thread `graphExpansionStore` into the pipeline deps + add `options.graphExpand === undefined` to `cacheApplicable`.
**Reasoning:** the Step 8.7 stage IS the feature. Reuses the reranker fail-soft try/catch pattern + the adaptive Step 8.6 rebind pattern.

#### TDD
- RED: pipeline unit test with a stub `GraphExpansionStore` — returns a connected row not in `scored` ⇒ it surfaces in results (tail-ordered, banded score) + `recall_graph_expanded`; store throws ⇒ normal results, no crash, `recall_graph_failed`; no store/option ⇒ default pool byte-unchanged. scoped-memory test — graphExpand wired ⇒ cache bypassed.
- GREEN: implement Step 8.7 + thread + bypass.
- REFACTOR: extract `applyGraphExpansionStage` (mirror `applyRerankStage`).

#### Files to edit
- `packages/core/src/domain/retrieval/pipeline.ts` + `retrieval-pipeline.test.ts`
- `packages/core/src/infrastructure/db/scoped-memory.ts` + a scoped-memory façade test

#### Deep file dependency analysis
`pipeline.ts` already imports `emitEvent` + holds `scored` (mutable via the adaptive rebind precedent) + `VectorStoreResult`. Step 8.7 maps `GraphExpansionRow.result` → ScoredRow via the existing rowToItem path. Default path guarded by `graphExpansionStore !== undefined && options?.graphExpand !== undefined` → byte-unchanged.

#### Concurrency tests
(none — single-threaded)

#### Failure scenarios
- **Graph traversal query fails** (DB error / connection reset): the Step 8.7 try/catch emits `recall_graph_failed{error}` + returns the non-graph pool — recall NEVER fails on a graph-store outage (fail-soft, ADR D4). Reproduced in the pipeline unit test via a throwing stub store.
- **Empty expansion** (no connected memories): returns the original pool, no `recall_graph_expanded` event (no-op discipline).

#### Acceptance criteria
- [ ] Connected below-threshold row surfaces (tail, banded < lowest seed score) + `recall_graph_expanded`.
- [ ] EC-1: a connected row already in the threshold pool is NOT duplicated (id-dedup against `scored`) — asserted `expect(results.map(r=>r.id))` has no duplicate.
- [ ] EC-3: `graphExpand` set but no store wired ⇒ byte-identical to plain recall (option-without-store is a no-op).
- [ ] Store throws ⇒ normal results, recall never crashes, `recall_graph_failed`.
- [ ] No store/option ⇒ byte-identical default (regression).
- [ ] graphExpand wired ⇒ recall cache bypassed.

#### DoD
- [ ] `npx vitest run --config vitest.contract.config.ts packages/core/src/domain/retrieval-pipeline.test.ts` + scoped-memory test green.

## Phase 4 — Impls + config

### T4.1 — `PgGraphExpansionStore` (the JOIN)

#### Why this step
**Action:** `pg-graph-expansion-store.ts` — `expandByEntities` runs the scope-filtered, LIMIT-bounded JOIN (1 hop: `memory_entities` self-join on `entity_id`; 2 hop: + `entity_edges`), projecting the connected memory rows (same projection as `search`, via `rowToResult`) + `count(DISTINCT shared entity)` as `sharedEntities`, excluding the seed ids.
**Reasoning:** the real traversal. Reuses the pg pool + `rowToResult` projection.

#### TDD
- RED: (covered by the T5.1 GOAL against real pgvector — a pg-only SQL impl is integration-tested, per the testing pyramid for DB adapters).
- GREEN: implement the JOIN.
- REFACTOR: parametrize hops; JSDoc citing ADR D2; no-paper-names.

#### Files to edit
- `packages/core/src/infrastructure/db/pg-graph-expansion-store.ts` (NEW)

#### Deep file dependency analysis
Constructed with a `pg.Pool` (mirror `PgMemoryGraphStore`). Uses `rowToResult` (export or replicate the projection). Scope filter via COALESCE on user/session/agent + workspace (mirror existing scoped queries).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] 1-hop returns memories sharing ≥1 entity with seeds, scope-filtered, excluding seeds, LIMIT-bounded, ordered by sharedEntities desc.
- [ ] 2-hop additionally follows `entity_edges`.
- [ ] EC-2: the CANDIDATE memory is filtered by the recall scope (workspace + user/session/agent) — a same-entity memory in a DIFFERENT scope is NEVER returned (cross-scope isolation; tested in T5.1 with a second-scope memory sharing the entity).

#### DoD
- [ ] Exercised by T5.1 GOAL vs real pgvector.

### T4.2 — `InMemoryGraphExpansionStore` + unit tests

#### Why this step
**Action:** an in-memory mirror (over the in-memory store's entity links) so the traversal logic is unit-tested without a DB, AND the pipeline unit tests have a real (non-stub) impl option.
**Reasoning:** testing pyramid — fast deterministic unit coverage of the traversal semantics.

#### TDD
- RED: `in-memory-graph-expansion-store.test.ts` — seed memory↔entity links; 1-hop returns shared-entity memories with correct weights, excludes seeds, respects limit.
- GREEN: implement.
- REFACTOR: JSDoc.

#### Files to edit
- `packages/core/src/infrastructure/db/in-memory-graph-expansion-store.ts` (NEW)
- `packages/core/src/infrastructure/db/in-memory-graph-expansion-store.test.ts` (NEW)

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `expandByEntities` returns exactly the memories sharing ≥1 entity with the seeds, with `sharedEntities` equal to the count of shared entities, the seed ids excluded, and the result length ≤ `limit` — asserted by `in-memory-graph-expansion-store.test.ts` (`expect(rows.map(r=>r.result.id))` excludes seeds; `expect(rows[0].sharedEntities).toBe(2)`).

#### DoD
- [ ] `npx vitest run --config vitest.contract.config.ts packages/core/src/infrastructure/db/in-memory-graph-expansion-store.test.ts` green (≥ 3 assertions: shared-entity weight, seed exclusion, limit cap).

### T4.3 — config slot + factory auto-default + DIP type export + count reconcile

#### Why this step
**Action:** add `graphExpansionStore?: GraphExpansionStore` to `LocalMemoryConfig`; in factory auto-default `PgGraphExpansionStore(pool)` when the vector store has a pool (mirror `memoryGraphStore` `:195`); export the DIP type from `/contract` (`domain/index.ts`); reconcile the p0-audit core export count 55→56.
**Reasoning:** wires the DIP instance end-to-end (the wiring triad caller) + public type for consumers.

#### TDD
- RED: `exports-contract.test.ts` + `full-public-surface.test.ts` — core export count 56; DIP type importable from `/contract`.
- GREEN: config slot + factory default + type export.
- REFACTOR: JSDoc on the config slot.

#### Files to edit
- `packages/core/src/infrastructure/db/config.ts`
- `packages/core/src/infrastructure/db/factory.ts`
- `packages/core/src/infrastructure/db/scoped-memory.ts` (pass `graphExpansionStore` into pipeline deps — may already be in T3.1)
- `packages/core/src/domain/index.ts`
- `tests/integration/p0-audit/exports-contract.test.ts` + `full-public-surface.test.ts`

#### Deep file dependency analysis
`LocalMemoryConfig` gains an optional slot (additive). Factory spreads `...config` so the slot flows to scoped-memory. The DIP type export is ONE statement (count +1 → 56).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `createLocalMemory({ graphExpansionStore })` makes a `graphExpand` recall invoke the wired store (asserted by the T5.1 GOAL surfacing the connected row); when omitted, the factory instantiates `PgGraphExpansionStore(pool)` (asserted: `graphExpand` recall surfaces the row WITHOUT an explicit store in config).
- [ ] `import { GraphExpansionStore } from '@usetheo/memory/contract'` resolves (type), and `grep -c '^export ' packages/core/src/domain/index.ts` equals 56 — asserted by `exports-contract.test.ts` (`expect(blocks.length).toBe(56)`).

#### DoD
- [ ] `tsc` + build clean; p0-audit export tests green.

## Phase 5 — Integration Validation

### T5.1 — GOAL integration test + full gate

#### Why this step
**Action:** `tests/integration/graph-aware-recall.test.ts` against real `ankane/pgvector:v0.5.1`: seed memory A (matches the query, top result) + memory B (does NOT match the query → below threshold) where A and B SHARE an entity (via the real extraction OR by direct `memory_entities` seed). With `graphExpand` ON: B surfaces + `recall_graph_expanded`. DEFAULT (no graphExpand): B absent (byte-unchanged). Then the full validation gate.
**Reasoning:** THE GOAL — proves the feature works end-to-end + the default is unchanged. Exercises `PgGraphExpansionStore`'s real JOIN.

#### TDD
- RED: the GOAL test (skipIf no `THEOMEM_PG_URI`).
- GREEN: (feature implemented P1-4; this asserts end-to-end).
- REFACTOR: honest caveat comment on the entity-link seeding approach.

#### Files to edit
- `tests/integration/graph-aware-recall.test.ts` (NEW)

#### Deep file dependency analysis
Composes `createLocalMemory({ graphExpansionStore: new PgGraphExpansionStore(pool) })` + a queue-LLM stub + a crafted embedder (A near query, B far). Entity link: either via the real entity extraction (if a stub entity extractor links A+B to a shared entity) OR a direct `INSERT INTO memory_entities`. Real pgvector via `runMigrations`.

#### Concurrency tests
(none — single-threaded)

#### Failure scenarios
- **Graph store query failure** — asserted fail-soft at the unit level (T3.1); the GOAL covers the happy + default paths. The pgvector JOIN failure path degrades to the non-graph pool (no recall crash).

#### Acceptance criteria
- [ ] graphExpand ON ⇒ shared-entity below-threshold B surfaces + `recall_graph_expanded`.
- [ ] DEFAULT ⇒ B absent (byte-identical).
- [ ] Contract suite green; `/code-quality` PASS; `tsc`/build/lint clean.

#### DoD
- [ ] `npx vitest run --config vitest.integration.config.ts tests/integration/graph-aware-recall.test.ts` green vs real pgvector.
- [ ] CHANGELOG `[Unreleased] § Added` notes the feature.

## Coverage Matrix

| Goal claim | Task(s) |
|---|---|
| `GraphExpansionStore` DIP (1 method, expandByEntities) | T1.1 |
| 2 observable events + `RecallOptions.graphExpand` opt-in | T2.1 |
| pipeline Step 8.7 pool-expansion (banded score, fail-soft) | T3.1 |
| `PgGraphExpansionStore` (JOIN over existing tables) | T4.1 |
| in-memory impl + unit tests | T4.2 |
| config slot + factory auto-default + DIP type export | T4.3 |
| GOAL: shared-entity below-threshold surfaces + default-unchanged vs real pgvector | T5.1 |
| default OFF / byte-unchanged | T3.1 (regression) + T5.1 (default scenario) |
| ZERO new dependency / NO migration | Dependencies section + /deps-audit |

**Coverage: 9/9 goal claims mapped (100%).**

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Pool-expansion surfaces lower-precision rows (recall↑ precision↓) | MEDIUM | OPT-IN + banded score (graph hits ALWAYS rank below genuine semantic hits, ADR D3) + LIMIT-bounded + `recall_graph_expanded` observable. Default OFF. | impl |
| Step 8.7 touching `scored` risks a default-path regression | HIGH | Branch guarded by `graphExpansionStore !== undefined && options.graphExpand !== undefined`; T3.1 + T5.1 default scenario assert byte-identical output; existing pipeline tests stay green. | impl |
| The JOIN fan-out on a densely-connected entity (e.g., a hub entity linked to thousands of memories) | MEDIUM | `LIMIT`-bounded + 1-hop default + scope-filtered; 2-hop is explicit opt-in. The query is index-backed. A future cap on per-entity fan-out is a follow-up if profiling shows hot entities. | impl |

## Unresolved Questions

(none — every decision is resolved at plan time. The GOAL's entity-link seeding approach (real extraction vs direct `memory_entities` INSERT) is an implementation detail resolved in T5.1 — direct seed is acceptable for determinism, with the real JOIN exercised by `PgGraphExpansionStore`.)

## Failure scenarios

The NEW code touches the DB via ONE new read query (the graph traversal JOIN). Failure mode + handling:
- **Graph traversal JOIN fails** (DB error / timeout / connection reset): Step 8.7 is wrapped fail-soft — emits `recall_graph_failed{error}` and returns the non-graph pool; recall NEVER fails on a graph-store outage (ADR D4). Reproduced in T3.1 via a throwing stub store.
- **Empty expansion** (no connected memories in scope): returns the original pool, no event (no-op discipline).
The existing semantic-recall path (pgvector search) is unchanged.

## Global Definition of Done

- [ ] All tasks T1.1 → T5.1 complete with green TDD.
- [ ] `tsc -p tsconfig.contract.json` + `npm run build` (exactOptionalPropertyTypes) clean.
- [ ] Contract suite green; GOAL integration green vs real `ankane/pgvector:v0.5.1`.
- [ ] `/code-quality graph-aware-recall` PASS (0 hard/soft caps).
- [ ] Default-OFF byte-unchanged proven (T3.1 regression + T5.1 default scenario).
- [ ] ZERO new dependency (deps-audit PASS); NO new migration.
- [ ] No paper names in `src/**` (GraphRAG/etc. cite the plan/blueprint, not code).
- [ ] CHANGELOG `[Unreleased] § Added` updated.
- [ ] `/review` READY_TO_MERGE.
- [ ] Plan archived after merge.
