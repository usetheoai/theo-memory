# Blueprint: Graph-aware recall (entity-graph-augmented retrieval)

**Slug:** `graph-aware-recall`
**Discovery plan:** `.claude/knowledge-base/discoveries/plans/graph-aware-recall-plan.md`
**Date:** 2026-06-22
**/discover-confidence verdict:** SHIPPABLE (0 hard caps)

## Context

Evolves the shipped entity-relation-extraction feature (project-owner direction 2026-06-22: evolve the existing Postgres entity-graph, NOT a graph-DB backend — Item 14 declined). The relational graph is populated — `entities` (nodes), `memory_entities` (M:N memory↔entity, `0018_entity_nodes.sql`), `entity_edges` (relation triples, `0019_entity_edges.sql`) — but does NOT influence `recall()` (today purely semantic + BM25 + threshold, `packages/core/src/domain/retrieval/pipeline.ts`). This blueprint decides how to traverse those tables (1–2 hops, JOINs only) to surface memories connected by shared entities / relations — as an OPT-IN recall seam mirroring the shipped reranker (Item 23). ZERO new dependency, NO poly-store.

## Objective

Decide the DIP shape, the traversal SQL + hop policy, the pipeline seam, the fail-soft + observability contract, and the GOAL test for opt-in graph-aware recall, so `cycle-plan` implements it with zero re-scoping.

## Executive summary

A new **`GraphExpansionStore` DIP** (1 method `expandByEntities`) traverses the EXISTING tables via JOINs: from the threshold-passing seed memory ids → `memory_entities` → shared `entity_id`s (+ optionally one `entity_edges` hop) → back to `memory_entities` → **related memory ids weighted by shared-entity count**. A new pipeline **Step 8.7** (after threshold/assess, before topK; the reranker Step 8.5 seam template) calls it OPT-IN (`RecallOptions.graphExpand` + `createLocalMemory({ graphExpansionStore })`), POOL-EXPANDS by fetching the connected rows not already in the pool (via the existing `VectorStore` batch-get by id), assigns each a graph-derived score, merges + re-sorts. DEFAULT OFF (byte-unchanged). Fail-soft (a traversal error degrades to the non-graph pool + `recall_graph_failed`) + a `recall_graph_expanded` event (Princípio 3). ISP preserved: `MemoryGraphStore` (2 methods) is NOT widened; the new read concern is its own port. The clones confirm originality: mem0's depth-1 clone does not ship its graph module; letta has no entity-graph-boosted passage recall.

## Coverage Corner 1 — Integration Tests

**Q4 — shipped opt-in GOAL-test shape.** `tests/integration/reranker.test.ts:34-40` is the template: `import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory'`; isolated DB; `describe.skipIf(ROOT_PG_URI === '')`; a deterministic queue-LLM so STORED text == fixture while the feature runs real; assertions that prove the stage FIRED + is not a passthrough. Graph-aware GOAL skeleton (real `ankane/pgvector:v0.5.1`):
- Seed two memories that share an entity (the entity extraction links them in `memory_entities`), where memory B is BELOW the similarity threshold for the query but memory A (the top result) shares an entity with B.
- With `graphExpand` ON: B surfaces in the results (pool-expanded via the shared entity) + `recall_graph_expanded` emitted.
- DEFAULT (no `graphExpand`, no store): B stays dropped — byte-identical to today.

To control entity linking deterministically, the GOAL either (a) uses the real extraction pipeline with fixtures whose entities overlap, or (b) seeds `memory_entities` directly + a stub graph-expansion store. Decision deferred to the plan (real-extraction is more faithful; direct-seed is more deterministic — likely a stub `GraphExpansionStore` returning the known linked id, with a SEPARATE pgvector integration test for the real JOIN SQL).

**Q5 — fail-soft + observability.** `memory-event.ts:16` is a typed `MEMORY_EVENTS` union consumed by `emitEvent(tracer, event, attrs)` (no-op when tracer undefined). The reranker fail-soft pattern (`pipeline.ts` Step 8.5): wrap the stage in `try { … } catch { emitEvent('recall_rerank_failed'); return <original pool> }`. Graph-aware copies it: a traversal/fetch error degrades to the non-graph pool + emits `recall_graph_failed`; a successful expansion emits `recall_graph_expanded{seeds, expanded, hops}`. New literals append to the union.

## Coverage Corner 2 — Dependencies

**DEFER-CORNER (deps) — ZERO new dependency (confirmed).** The traversal is pure SQL (JOINs over the 3 EXISTING tables: `memory_entities` indexed on `entity_id` per `0018`, `entity_edges` indexed on source/target per `0019`). Row fetch for expanded ids reuses the EXISTING `VectorStore` batch-get-by-id (`pgvector-store.ts:545` `WHERE id IN (SELECT DISTINCT unnest($1::uuid[]))`). The in-memory mirror for tests is plain TS. No graph DB, no graph library. Mirrors the reranker/ontology/adaptive zero-dep precedent. `/deps-audit` confirms in cycle-plan.

## Coverage Corner 3 — Tools

**DEFER-CORNER (tools) — no new build/test/lint tooling (confirmed).** The feature is a read DIP (`packages/core/src/domain/dip/graph-expansion-store.ts` NEW) + a pgvector impl (a JOIN query) + an in-memory impl + a pipeline-seam wiring + an opt-in `RecallOptions.graphExpand` field + a config slot. Reuses vitest + the pgvector integration harness + the `@usetheo/memory/*` build. No new CLI/container/linter. Same footprint as the reranker/adaptive cycles. NO new migration (the tables + indexes already exist).

## Coverage Corner 4 — Techniques

**Q1 — schema traversal feasibility (JOINs only).** Confirmed against the DDL:
- `memory_entities(memory_id, entity_id)` PK + INDEX on `entity_id` (`0018_entity_nodes.sql:14`) → cheap entity→memories and memory→entities lookups.
- `entities` carry scope columns (`user_id`/`session_id`/`agent_id` + `workspace_id`, `0018`) → scope-filter the traversal.
- `entity_edges(source_entity_id, target_entity_id, ...)` + INDEX on each (`0019_entity_edges.sql:18-19`) → 1 relation hop.
- **1-hop shared-entity expansion:** `memory_entities me1 (me1.memory_id = ANY(seeds)) JOIN memory_entities me2 ON me2.entity_id = me1.entity_id JOIN memories m ON m.id = me2.memory_id AND <scope filters> WHERE me2.memory_id <> ALL(seeds) GROUP BY me2.memory_id ORDER BY count(DISTINCT me1.entity_id) DESC LIMIT k`. All indexed; bounded by `LIMIT`.
- **2-hop relation expansion (opt-in deeper):** insert `entity_edges ee ON (ee.source_entity_id = me1.entity_id OR ee.target_entity_id = me1.entity_id)` then resolve the other endpoint → `memory_entities`. Bounded to 2 hops (≥3 risks fan-out; out of scope per plan).

**Q2 — pipeline seam.** `pipeline.ts` Step 8 builds `scored` (threshold-passing), then the opt-in Step 8.5 reranker / 8.6 adaptive operate on it before topK. Graph-aware = **Step 8.7** at the same post-threshold seam: take the top-N `scored` ids as seeds → `expandByEntities` → for related ids NOT in `scored`, batch-fetch their rows via `deps.vectorStore` → assign a graph score (e.g., `min(seedTopScore, base) * f(sharedEntities)` OR a fixed below-top band so graph hits never outrank genuine semantic hits — ADR decision) → merge into the pool → re-sort → topK. **Boost-vs-expansion decision:** POOL-EXPANSION (fetch new rows) is required because the GOAL value is surfacing below-threshold connected memories; a pure boost of in-pool members cannot surface them. Ordering vs reranker/diversify: graph-expand runs BEFORE rerank/diversify so they operate on the expanded pool (or is mutually-exclusive — ADR).

**Q3 — DIP shape + clone baseline.** `MemoryGraphStore` (`dip/memory-graph-store.ts`) is exactly 2 methods (`upsertEdges` + `listEdges`) with an explicit ISP note "this port is exactly 2 methods and does NOT duplicate node listing". Widening it would break that discipline → a NEW dedicated read port:
```ts
interface GraphExpansionStore {
  expandByEntities(params: {
    seedMemoryIds: readonly string[];
    filters: Filters;            // scope (workspace + user/session/agent)
    hops: 1 | 2;
    limit: number;
  }): Promise<readonly { memoryId: string; sharedEntities: number }[]>;
}
```
1 method, ISP-clean, async, default impl `PgvectorGraphExpansionStore` (the JOIN) behind a subpath OR co-located with the pgvector store (ADR — the store already owns the pool; likely a method on the pgvector store wired via the new DIP). Opt-in via `RecallOptions.graphExpand?: { hops?: 1|2; limit?; }` + `createLocalMemory({ graphExpansionStore })`. **Clones (honest baseline):** mem0's depth-1 reference clone does NOT ship a graph-memory module under `mem0/memory/`; letta `services/` has archive/passage/block managers but no entity-graph-boosted recall. Graph-aware recall is original to TheMemory among the clones; prior art is our own schema + the opt-in-DIP precedent.

## Cross-cutting comparison

| Dimension | mem0 (clone) | letta | TheMemory (proposed) |
|---|---|---|---|
| Entity-graph-augmented recall | ABSENT (graph module not in depth-1 clone) | ABSENT (passage recall, no entity graph) | `expandByEntities` 1–2 hop pool-expansion |
| Storage | (n/a here) | — | EXISTING 3 Postgres tables, JOINs only (no poly-store) |
| Opt-in / default-OFF | — | — | mirrors shipped reranker DIP |
| Fail-soft | — | — | mirrors `recall_rerank_failed` |
| New dependency | — | — | ZERO |

## ADRs

### D1 — New `GraphExpansionStore` DIP (1 method); do NOT widen `MemoryGraphStore`
**Decision:** a dedicated read port `expandByEntities`. **Rationale:** ISP — `MemoryGraphStore`'s own JSDoc locks it at 2 methods (upsert+list); recall-time traversal is a distinct read concern. **Alternatives:** widen `MemoryGraphStore` (rejected — breaks the documented ISP cap); reuse `MemoryEntityStore` (rejected — that owns node listing, not traversal). **Consequences:** a new DIP + a pgvector impl + an in-memory impl.

### D2 — Traversal via JOINs over the existing tables; 1 hop default, 2 hops opt-in; bounded by LIMIT
**Decision:** shared-entity self-join (1 hop) default; `entity_edges` adds an opt-in 2nd hop; always `LIMIT`-bounded + scope-filtered. **Rationale:** the indexes (`memory_entities_entity_id_idx`, `entity_edges_source/target_idx`) make it cheap; ≥3 hops risk fan-out (YAGNI). **Alternatives:** recursive CTE arbitrary depth (rejected — fan-out, YAGNI); graph DB (rejected — Item 14 declined). **Consequences:** deterministic, index-backed; the hop count is an opt-in knob.

### D3 — Step 8.7 POOL-EXPANSION (fetch connected rows), graph score banded below genuine semantic hits
**Decision:** expand the pool with connected rows fetched by id; assign them a graph-derived score capped so they never outrank a genuine top semantic hit. **Rationale:** the value is surfacing below-threshold connected memories (a pure boost can't); banding the score preserves precision (Princípio 2 — priorização). **Alternatives:** boost-in-pool-only (rejected — can't surface new memories); unbounded graph score (rejected — would let weak graph links outrank strong semantic hits). **Consequences:** the pipeline batch-fetches by id via `VectorStore`; the score function is documented + tested.

### D4 — Opt-in + default-OFF + fail-soft + observable events
**Decision:** `RecallOptions.graphExpand` + `createLocalMemory({ graphExpansionStore })`, active only when BOTH wired; default OFF (byte-unchanged); fail-soft to the non-graph pool; emit `recall_graph_expanded` + `recall_graph_failed`. **Rationale:** the proven contract shipped 5×. Princípio 3 auditability. **Alternatives:** on-by-default (rejected — breaks byte-unchanged); throw-on-error (rejected — a non-critical enhancement must never fail recall). **Consequences:** 2 new event literals; a wired store bypasses the recall cache (the cache key does not encode graph expansion — like rerank).

## Recommendations (one per research question)

- **Q1 →** ship the shared-entity self-join (1 hop) + optional `entity_edges` 2nd hop, scope-filtered + LIMIT-bounded.
- **Q2 →** Step 8.7 pool-expansion at the post-threshold seam; batch-fetch connected rows via `VectorStore`; band the graph score below genuine semantic hits.
- **Q3 →** new `GraphExpansionStore` DIP (1 method); pgvector impl = the JOIN; in-memory impl for tests; do NOT widen `MemoryGraphStore`. Design is original among the clones.
- **Q4 →** GOAL test (real pgvector): a shared-entity below-threshold memory surfaces with `graphExpand` on; default unchanged.
- **Q5 →** 2 new event literals (`recall_graph_expanded` / `recall_graph_failed`) + the reranker fail-soft wrapper.

## Blocked questions

None — all 5 answered (Q3's clone confirm-or-deny is a confirmed-absent finding). deps + tools DEFER-CORNER'd with rationale.
