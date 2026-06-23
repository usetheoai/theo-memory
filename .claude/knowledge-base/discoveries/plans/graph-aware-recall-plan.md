# Discovery Plan: Graph-aware recall (entity-graph-augmented retrieval)

> **Version 1.0** — Opportunistic (evolves the shipped entity-relation-extraction feature; project-owner direction 2026-06-22 "evolve the existing entity-graph, NOT a graph-DB backend"). Investigates how to make `recall()` use the ALREADY-POPULATED `entities` + `memory_entities` + `entity_edges` Postgres tables to expand/boost retrieval (1–2 hop entity traversal), as an OPT-IN seam in the recall pipeline — default OFF (byte-unchanged), zero new dependency, NO poly-store. The blueprint must decide the DIP shape, the traversal SQL + hop policy, the seam (boost-vs-pool-expansion), the fail-soft + observability contract, and the GOAL test.

**Slug:** `graph-aware-recall`
**Owner:** project-owner (via /goal)
**Created:** 2026-06-22
**Time budget:** 2h (per-project breakdown in ADR D1)

## Context

The entity-relation-extraction feature shipped the relational entity graph: `entities` (nodes per scope), `memory_entities` (M:N memory↔entity link, `0018_entity_nodes.sql`, indexed on `entity_id`), and `entity_edges` (relation triples, `0019_entity_edges.sql`, indexed on source/target). These power the dashboard graph view but **do NOT influence `recall()`** — retrieval today is purely semantic + BM25 + entity-boost-flag + threshold (`packages/core/src/domain/retrieval/pipeline.ts`). Project-owner declined Item 14 (graph-DB backend) and directed evolving the EXISTING relational graph (CLAUDE.md competitive matrix "graph WITHOUT poly-store"). This discovery decides how to traverse the existing tables (1–2 hops) to surface memories connected by shared entities — mirroring the proven opt-in-DIP seam pattern shipped 5× (reranker, ontology, embedder-registry, adaptive-retrieval, diversify). Honors `CLAUDE.md § Princípio 2` (priorização/diversidade > volume) + `§ Princípio 3` (auditability). The reference clones are thin here: mem0's depth-1 clone does NOT ship its graph module; letta has no entity-graph-boosted recall — the design is original, grounded in our own schema + DIP precedent.

## Objective

Decide the contract + seam for an opt-in graph-aware recall so `cycle-plan` implements it with zero re-scoping. Measurable success criteria for the blueprint:

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/` OR TheMemory's own source (resolvable paths)
- [ ] Cross-cutting comparison table populated for every in-scope reference project
- [ ] Recommendations section provides at least one concrete decision proposal per in-scope research question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| TheMemory OWN source (primary evidence) | `packages/core/src/infrastructure/db/migrations/0018_entity_nodes.sql` + `0019_entity_edges.sql`, `packages/core/src/domain/dip/{memory-graph-store,memory-entity-store}.ts`, `packages/core/src/domain/retrieval/pipeline.ts`, `packages/core/src/infrastructure/db/{pgvector-store,scoped-memory}.ts`, `packages/core/src/domain/dip/reranker.ts`, `packages/core/src/domain/memory-event.ts`, `tests/integration/reranker.test.ts` | The schema (traversal feasibility), the existing graph DIPs (ISP discipline — must NOT widen `MemoryGraphStore`), the recall pipeline seam, the opt-in-DIP + fail-soft + GOAL-test patterns are ALL here. Load-bearing prior art. |
| `.claude/knowledge-base/references/mem0/` | `mem0/memory/` | Confirm-or-deny an entity-graph-augmented search pattern (honest baseline; the depth-1 clone may not ship the graph module). |
| `.claude/knowledge-base/references/letta/` | `letta/services/` | Confirm-or-deny any relation/graph-boosted passage recall. |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| A graph-DB backend (Apache AGE / Neo4j / `@usetheo/memory/graph`) | <!-- DEFER-CORNER: techniques | Item 14 was explicitly DECLINED by the project owner (2026-06-22, `themory-item14-graph-backend-declined`). The whole point is graph traversal over the EXISTING 2 Postgres tables via JOINs — NO poly-store. --> |
| Re-extraction / changing how entities/edges are WRITTEN | this discovery is READ-side only; the write pipeline (entity extraction) is unchanged |
| Arbitrary-depth (≥3 hop) traversal | bounded to 1–2 hops (a dashboard-grade neighborhood); deeper traversal risks fan-out blowup + is YAGNI |
| `.claude/knowledge-base/references/*/docs/`, build artifacts | not source of truth |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** TheMemory own source: 1.25h (the schema + DIPs + seam + test patterns live here); mem0: 0.5h; letta: 0.25h.

**Rationale:** the load-bearing prior art is our own schema + the opt-in-DIP seam precedent; the clones get a bounded confirm-or-deny (the graph-search pattern is likely absent in the depth-1 clones).

**Alternatives considered:** equal split (rejected — wastes budget on thin clones); our-source-only (rejected — must honestly check the clones first).

**Stop condition — per question:** Fase A empty after 3 query-variant retries → mark BLOCKED "Fase A exhausted", continue. For the mem0/letta "does graph-boosted recall exist?" questions, a confirmed-absent finding IS the answer (not a BLOCK).

**Stop condition — per project:** budget exhausted with questions pending → mark BLOCKED "budget exhausted", advance. If all remaining are done/blocked → `<promise>BLUEPRINT_BLOCKED</promise>` (never `BLUEPRINT_COMPLETE` from a blocked state).

**Anti-pattern:** NEVER fabricate a Fase B answer for an exhausted Fase A (Rule 3).

**Consequences:** the blueprint leans on our own schema + DIP precedent; the clones contribute a confirmed-absence baseline.

### D2 — Investigation depth

**Decision:** Read end-to-end for the 2 migrations + the 2 graph DIPs + `pipeline.ts` + `reranker.ts`/`reranker.test.ts` (the templates copied); Grep-then-Read for mem0/letta (confirm-or-deny).

**Rationale:** the traversal SQL must be grounded in the EXACT schema (indexes, FK, M:N link); the seam + DIP + GOAL-test must be copied faithfully from the reranker precedent.

**Alternatives considered:** Grep-only (rejected — SQL feasibility needs the full DDL); Read-all-clones (rejected — budget).

**Consequences:** the blueprint's traversal + DIP + seam recommendations are line-exact against our own source.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Does the schema support a 1–2 hop entity traversal from a set of seed memory ids to related memory ids, via JOINs only (no graph DB)? Which indexes make it cheap? | techniques | TheMemory own | grep `CREATE TABLE\|CREATE INDEX\|FOREIGN KEY` in `0018_entity_nodes.sql` + `0019_entity_edges.sql` | Read both migrations end-to-end | The exact JOIN path (memories→memory_entities→entities→[entity_edges→]memory_entities→memories) + the indexes that bound cost |
| Q2 | What is the recall-pipeline seam for a graph-expansion stage, and how does the shipped reranker hook the post-threshold seam (the template)? | techniques | TheMemory own | grep `Step 8\|rerank\|threshold\|scored\|topK` in `pipeline.ts` | Read `pipeline.ts` (Step 8 + the reranker Step 8.5 stage) | The seam (after threshold/assess, before topK) + boost-vs-pool-expansion mechanics |
| Q3 | What opt-in-DIP shape fits WITHOUT widening the existing `MemoryGraphStore` (ISP, ADR-0008), and do mem0/letta implement graph-augmented recall (honest baseline)? | techniques | TheMemory own + mem0/letta | grep `interface MemoryGraphStore\|listEdges\|upsertEdges` (ours) + `graph\|relation\|hop\|expand` (clones) | Read both graph DIPs + the ISP note; read any mem0/letta graph-recall hit | A NEW dedicated read DIP (1 method) vs widening; opt-in `RecallOptions.graphExpand` + config slot; + confirmed presence/absence in the clones |
| Q4 | How is a shipped opt-in recall stage's GOAL test structured (real `ankane/pgvector:v0.5.1`, default-byte-unchanged, stage-actually-fired)? | tests | TheMemory own | grep `describe.skipIf\|createLocalMemory\|rerank:\|expect(` in `reranker.test.ts` | Read `reranker.test.ts` end-to-end | GOAL skeleton: a graph-linked memory (below similarity threshold) surfaces with `graphExpand` on; default unchanged |
| Q5 | What is the fail-soft + observability-event contract for an opt-in recall stage (event union, fail-soft never-fails-recall)? | tests | TheMemory own | grep `recall_rerank_failed\|emitEvent\|MEMORY_EVENTS` in `memory-event.ts` + `pipeline.ts` | Read the event union + the reranker fail-soft catch | New event literal (`recall_graph_expanded`) + the fail-soft wrapper pattern |

## Coverage Matrix

| Question | Corner | Method (Fase A) | Method (Fase B) | Status |
|---|---|---|---|---|
| Q1 | techniques | grep schema DDL | Read 2 migrations | planned |
| Q2 | techniques | grep pipeline seam | Read pipeline.ts | planned |
| Q3 | techniques | grep graph DIPs + clones | Read 2 DIPs + ISP note + clone hits | planned |
| Q4 | tests | grep GOAL-test shape | Read reranker.test | planned |
| Q5 | tests | grep event/fail-soft | Read memory-event + pipeline | planned |
| (deps) | deps | — | — | DEFER-CORNER (zero new dep) |
| (tools) | tools | — | — | DEFER-CORNER (no new tooling) |

**Coverage: 4/4 corners covered (100%)** — techniques + tests populated; deps + tools explicitly DEFER-CORNER'd below.

<!-- DEFER-CORNER: deps | the traversal is pure SQL (JOINs over 3 EXISTING tables) + an in-memory mirror for tests — ZERO new dependency (no graph DB, no graph library), mirroring the reranker/ontology/adaptive zero-dep precedent. A formal deps-audit runs in cycle-plan regardless. -->

<!-- DEFER-CORNER: tools | the feature is a read DIP + a pipeline-seam wiring + an opt-in RecallOptions field + (maybe) one query method on the pgvector store; it adds NO new build/test/lint tooling (reuses vitest + the pgvector integration harness). No tooling question to investigate. -->

Question budget: 5 total. Per-corner: techniques ×3 (Q1-Q3), tests ×2 (Q4-Q5). deps + tools DEFER-CORNER'd. Within 5 ≤ N ≤ 10 and ≤ 3/corner; every non-deferred corner ≥ 1.

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Every cited path (`.claude/knowledge-base/references/{...}` OR `packages/core/...`) exists | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A budget | Fase A returned ≥ 1 hotspot OR 3 retries | After 3 retries empty, mark BLOCKED "Fase A exhausted" (Q4 clone-absence is the ANSWER) |
| After answering Qx | Blueprint section under Qx has ≥ 1 citation | Re-iterate Qx (1 retry) |
| Before promising complete | All 4 corners populated (deps/tools via DEFER-CORNER rationale) | Refuse promise, continue |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly BLOCKED with reason (Q4 absence is an answer)
- [ ] All four coverage corners have populated sections in the blueprint (deps/tools via DEFER-CORNER)
- [ ] Every citation points to a real `.claude/knowledge-base/references/{...}` OR `packages/core/...` path
- [ ] At least one ADR section synthesizes decisions (traversal SQL/hops; seam boost-vs-expansion; DIP locus; fail-soft + event; GOAL test)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/graph-aware-recall-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → execute → confidence → improve if needed → confidence re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered (or DEFER-CORNER'd)
- [ ] ADRs reference at least one principle from project rules (KISS/YAGNI/DIP/ISP) or a rule file — and CLAUDE.md Princípio 2 + Princípio 3
