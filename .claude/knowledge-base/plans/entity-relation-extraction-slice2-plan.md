---
slug: entity-relation-extraction-slice2
created_at: 2026-06-20
goal: Extract entity relations (edges) on remember() and serve them via GET /graph as {nodes,edges}.
---

# Plan: Entity Relation Extraction (edges) + Graph View — Slice 2

> **Version 1.1** (edge-case MUST-FIX absorbed 2026-06-20: EC-1 `memory_count`-always-1 design defect → `source_memory_id` moved INTO the UNIQUE; EC-2 non-deterministic endpoint resolution → `ORDER BY created_at LIMIT 1`; EC-3 per-memory edge cap; EC-4 relation-length guard. See `entity-relation-extraction-slice2-edge-cases-2026-06-20.md`.)

> **Version 1.0** — Slice 1 (`entity-extraction-nodes-slice1`, shipped v0.10.0 + v0.10.1) populates the `entities` table with NODES (PROPER/QUOTED/COMPOUND/NOUN) and serves them via `GET /v1/scopes/:type/:id/entities`. Slice 2 adds the EDGES half: the existing write-pipeline LLM call is extended to ALSO emit relation triples `{source, relationship, destination}`; a new `entity_edges` Postgres table stores them with `source_memory_id` provenance; a new `MemoryGraphStore` DIP persists + reads edges; and a new `GET /v1/scopes/:type/:id/graph` returns `{nodes, edges}`. NO graph database (Item 14 stays FROZEN) — two relational tables + JOINs cover the 1–2 hop dashboard view. The theo-cloud gateway + dashboard graph view is a sequenced cross-repo follow-up (after this merges).

## Goal

> "Enable a memory consumer to retrieve the relations between extracted entities so that a `{nodes, edges}` graph can be rendered without a graph database, measured by the GOAL integration test `remember('John Smith works at Google') → GET /graph` returning an edge `John Smith --works_at--> Google` against real `ankane/pgvector:v0.5.1`."

## Context

CTO live session 2026-06-19 asked for a Mem0-style entity-graph experience WITHOUT adopting a graph DB. The discovery cycle produced blueprint `entity-relation-extraction-no-graphdb` (`/discover-confidence` SHIPPABLE 100) which split the work: Slice 1 = nodes (compromise), Slice 2 = edges (LLM triples) + graph view. Slice 1 shipped (v0.10.0 `remember()` populates `entities`; v0.10.1 closed the `infer:false` + recall-edge + perf fixes). The `entities` tab in the dashboard now shows real nodes but no relations. Slice 2 closes the "graph" half: the edges between nodes + the `{nodes,edges}` REST surface that a frontend graph view consumes.

Governance: CLAUDE.md "Amendment 2026-06-20 — Entity + relation extraction (NO graph DB) UNFROZEN" already re-classifies BOTH slices as in-scope under PRIORITY 0 (it explicitly names "Slice 2 = relations/edges + `{nodes,edges}` graph view"). No new amendment required. Item 14 (`@usetheo/memory/graph` backend) stays FROZEN — a 1–2 hop view needs only JOINs (blueprint D2).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/extraction/prompt.ts` | 107 | `ab62443` (2026-06-10) | Composes the additive-extraction LLM prompt + `AdditiveExtractionSchema` (zod) | `memory[]` shape + `linked_memory_ids` string-coercion contract MUST stay; new `relations` field is OPTIONAL (back-compat: LLMs that omit it still parse) |
| `packages/core/src/domain/extraction/pipeline.ts` | 599 | `cd8cb29` (2026-06-20) | 8-phase write pipeline; Phase 7 `linkEntities()` (shared by infer:true + infer:false) | Phase 7 fail-soft invariant (a remember() NEVER fails on linking failure); EC-1 dedup; `entityBoost`-gated port presence |
| `packages/core/src/domain/dip/memory-graph-store.ts` (NEW) | 0 | — | (file to be created) — the edges DIP | — |
| `packages/core/src/infrastructure/db/pg-memory-graph-store.ts` (NEW) | 0 | — | (file to be created) — `PgMemoryGraphStore` impl | — |
| `packages/core/src/infrastructure/db/schema.ts` | 596 | `b02bbf9` (2026-06-20) | drizzle schema (entities + memory_entities live here from 0018) | additive only; existing tables/columns unchanged |
| `packages/core/src/infrastructure/db/migrations/0019_entity_edges.sql` (NEW) | 0 | — | (file to be created) — additive migration | additive; no DROP/ALTER of existing columns |
| `packages/core/src/infrastructure/db/factory.ts` | 267 | `a80a4e6` (2026-06-20) | `createLocalMemory`; wires Phase 7 ports when `entityBoost !== false` + PgvectorStore | existing entity wiring (`:175-185`) unchanged; graph store wired the SAME way (same gate) |
| `packages/core/src/domain/memory-event.ts` | 96 | `a80a4e6` (2026-06-20) | `MEMORY_EVENTS` typed union (21 literals) | additive: append 2 new literals; existing literals unchanged |
| `packages/core/src/domain/index.ts` | 177+ | `a80a4e6` (2026-06-20) | domain barrel — exports `MemoryEntityStore`, `EntityToLink`, `EntityNodeSummary` | additive re-exports for the new DIP types |
| `packages/core/src/index.ts` | 172 | `a80a4e6` (2026-06-20) | core public barrel — exports `PgMemoryEntityStore` | additive: export `PgMemoryGraphStore` |
| `packages/api/src/server/handlers/graph.ts` (NEW) | 0 | — | (file to be created) — `GET /graph` handler | — |
| `packages/api/src/server/app.ts` | 344 | `f108c99` (2026-06-20) | `createServer`; registers `/entities` route (`:322`); `AppOptions.memoryEntityStore` (`:138`) | existing routes unchanged; add `/graph` route + optional `memoryGraphStore` option (back-compat: omitted → 501 or empty per ADR D6) |
| `packages/api/src/server/openapi-registration.ts` | 412 | `9617f25` (2026-06-19) | OpenAPI 3.1 path registry; `/entities` at `:200` | additive: register `/graph` path |
| `packages/cli/src/run-server.ts` | — | (slice-1 F-M1) | `themory server` injects `PgMemoryEntityStore` | inject `PgMemoryGraphStore` the same way (production graph served) |
| `packages/core/src/infrastructure/llms/stub.ts` | — | `a80a4e6` (2026-06-20) | deterministic LLM stub for tests | extend to optionally emit `relations` for the edge GOAL/unit tests |
| `tests/integration/entities/graph.test.ts` (NEW) | 0 | — | (file to be created) — GOAL test | — |
| `packages/core/src/domain/extraction/prompt.test.ts` (NEW or existing) | — | — | schema unit tests | — |

### Current callers / dependents

- **Symbol:** `AdditiveExtractionSchema` / `generateAdditiveExtractionPrompt` in `prompt.ts`
  - Callers (production): `packages/core/src/domain/extraction/pipeline.ts` (`:331`, `:357`), re-exported via `packages/core/src/domain/index.ts`
  - Callers (tests): `packages/core/src/infrastructure/llms/stub.ts` (mirrors the shape), extraction pipeline tests
  - External (other repos): no — internal extraction contract
- **Symbol:** `MEMORY_EVENTS` in `memory-event.ts`
  - Callers (production): `pipeline.ts` (every `emitEvent`), `domain/index.ts` re-export
  - Callers (tests): a contract test asserts the literal count (was 20→21 in slice 1; will become 23)
- **Symbol:** `entitiesHandler` + `AppOptions.memoryEntityStore` in `app.ts`
  - Callers (production): `app.ts:322`; `packages/cli/src/run-server.ts` injects the store
  - Callers (tests): `tests/integration/entities/*.test.ts`, `packages/api` handler tests
- **Symbol:** `createLocalMemory` factory entity wiring (`factory.ts:175-185`)
  - Callers (production): `packages/core/src/index.ts` barrel; all SDK consumers
  - Callers (tests): every integration test that builds a Memory

### Domain glossary

- **node** — an extracted entity (a row in `entities`): `(scope, type, normalized_key)` unique; surfaced as `EntityNodeSummary`.
- **edge / triple** — a relation between two nodes: `{source, relationship, destination}` (Mem0 shape, `mem0/memory/utils.py:78`); stored as a row in `entity_edges` with `source_memory_id` provenance.
- **normalized_key** — `lowercase + spaces→underscores` of a surface name; the per-scope dedup key (slice-1 `normalizeEntityKey`, reused for the predicate + endpoint resolution).
- **Phase 7** — the fail-soft entity-linking phase of the write pipeline (`linkEntities()`); Slice 2 extends it with edge linking after node linking.
- **endpoint resolution** — mapping an edge's `source`/`destination` surface name to an existing entity node id via `(scope, normalized_key)` (reuses slice-1 resolution).

### Architecture boundaries affected

- **domain/dip → infrastructure/db** (DIP, per `architecture.md`): a NEW domain port `MemoryGraphStore` (interface in `domain/dip/`), implemented by `PgMemoryGraphStore` in `infrastructure/db/`. Direction respected (infra depends on domain, never reverse). Mirrors slice-1 `MemoryEntityStore` exactly.
- **domain/extraction (high) → domain/dip (abstraction)**: `pipeline.ts` Phase 7 calls the NEW port through `ExtractionDeps.memoryGraphStore?` (optional, like `memoryEntityStore?`). No infra import in the domain.
- **packages/api → @usetheo/memory/contract**: the `/graph` handler imports `MemoryGraphStore` type from the contract barrel (same as `/entities` imports `MemoryEntityStore`).
- **ADR-0008 per-DIP method-count census**: adds one DIP `MemoryGraphStore` (2 methods) — ISP-clean (≤2), consistent with the ADR (`MemoryEntityStore` = 2). `MemoryEntityStore` is NOT widened (stays 2 methods) — edges live in their own port (SRP).

## Prior Art & Related Work

- **Internal blueprint** `entity-relation-extraction-no-graphdb` (`/discover-confidence` SHIPPABLE 100):
  - Triple shape + normalization — `Blueprint §"Technique 2 — Relation (triple) representation + normalization (Q2)"` (cites `mem0/mem0/memory/utils.py:78,271-291`).
  - Relational persistence + endpoint resolution — `Blueprint §"Technique 3"` (cites `letta/letta/orm/identity.py:24-38` UNIQUE + `mem0/mem0/memory/main.py:868` normalized-key dedup).
  - `{nodes,edges}` REST shape — `Blueprint §"Recommendations 4"` (node-listing aggregation from `mem0/server/routers/entities.py:46-66`; edges half is OUR synthesis, EC-2 honest note: no OSS precedent).
  - ADR D1 (relations reuse the existing LLM call) + ADR D2 (two Postgres tables, no graph DB).
- **Internal plan** `entity-extraction-nodes-slice1` (shipped) — Slice 2 reuses: `CompromiseEntityExtractor`, `PgMemoryEntityStore`, `normalizeEntityKey`, the shared `linkEntities` Phase 7 helper, the additive-migration discipline (0018), the `entityBoost`-gated fail-soft port pattern, the `ON CONFLICT … DO UPDATE … RETURNING id` single-round-trip upsert (v0.10.1 item 3).
- **Reference (shape only)** `mem0/mem0/memory/utils.py:271-291` — the normalize-triple required-key guard (`source`/`relationship`/`destination`) reused as the malformed-triple skip.
- **Blocked half (honest, EC-1)** — the relation-EXTRACTION prompt lives in Mem0's absent `mem0[graph]` extra (`Blueprint §"Blocked questions"`). The extraction step is OURS by design (reuse our LLM call), so the missing reference does not block.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `compromise` | `^14.15.1` | npm (optional, lazy) | Node extraction (slice 1) — NODES only; reused unchanged. Edges come from the LLM, not compromise (ADR D1). |
| `pg` | `^8.13.0` | npm | Postgres driver for the `entity_edges` table + the `PgMemoryGraphStore` impl (T2.1). |
| `zod` | `^3.25.0` | npm | Extend `AdditiveExtractionSchema` with the optional `relations` field (T2.2). |
| `drizzle-orm` | `^0.45.0` | npm | `entity_edges` schema definition + migration 0019 (T1.1). |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | | Slice 2 reuses the slice-1 stack entirely — no new dependency. Edge extraction reuses the EXISTING LLM call (ADR D1); persistence reuses `pg` + `drizzle`; no graph DB (ADR D2, Item 14 FROZEN). |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

`npm audit` on the installed tree reports 0 vulnerabilities across these deps (2026-06-20). No CVE, no new dep, no version bump — Rule 9 satisfied by NOT adding anything (the existing stack covers nodes+edges; a graph DB was explicitly rejected per ADR D2).

## Objective

- [ ] A NEW `entity_edges` table (migration 0019, additive) stores `(source_entity_id, relation, target_entity_id, source_memory_id, scope, normalized_relation)` with a per-scope UNIQUE dedup constraint.
- [ ] The existing extraction LLM call emits OPTIONAL `relations: [{source, relationship, destination}]`; `AdditiveExtractionSchema` parses them back-compatibly.
- [ ] Phase 7 (`linkEntities`) extends to link edges AFTER nodes (fail-soft), resolving endpoints by `(scope, normalized_key)`; malformed/unresolvable triples are skipped with an OTel event.
- [ ] A NEW `MemoryGraphStore` DIP (2 methods: `upsertEdges`, `listEdges`) + `PgMemoryGraphStore` default impl.
- [ ] A NEW `GET /v1/scopes/:type/:id/graph` returns `{nodes, edges}` (nodes via `MemoryEntityStore.list`, edges via `MemoryGraphStore.listEdges`).
- [ ] `themory server` injects `PgMemoryGraphStore` (production graph served, mirrors slice-1 F-M1).
- [ ] GOAL test: `remember('John Smith works at Google') → GET /graph` returns the `John Smith --works_at--> Google` edge vs real pgvector.

## ADRs

### D1 — Relations from the EXISTING extraction LLM call (one call, optional field)

- **Decision:** extend `AdditiveExtractionSchema` with an OPTIONAL `relations: [{source, relationship, destination}]` field; the same Phase-2 LLM call that extracts facts ALSO emits triples. `compromise` continues to extract NODES only (slice 1); EDGES come from the LLM (blueprint D1).
- **Rationale:** Não Reinvente (mirror Mem0's triple shape) + KISS (no second LLM call, no second NLP stack) + the field is optional so existing prompts/stubs stay backward-compatible.
- **Alternatives considered:** (a) a SECOND dedicated relation-extraction LLM call — REJECTED: doubles cost + latency per `remember()`; the existing call already has the text + context. (b) derive relations heuristically from `compromise` POS — REJECTED: compromise gives nodes, not typed predicates; would reinvent a relation extractor poorly.
- **Consequences:** edges are only produced on the `infer:true` path (the `infer:false` verbatim path makes no LLM call, so it has no relations — honest, documented). Nodes still extracted on both paths (v0.10.1 item 2).

### D2 — A NEW `MemoryGraphStore` DIP (edges), NOT widening `MemoryEntityStore`

- **Decision:** edges get their own port `MemoryGraphStore` with 2 methods (`upsertEdges`, `listEdges`). `MemoryEntityStore` stays at 2 methods (nodes only).
- **Rationale:** SRP + ISP (ADR-0008 per-DIP ≤2 methods discipline). The entities port owns the `entities`/`memory_entities` aggregate; the graph port owns `entity_edges`. The `/graph` handler COMPOSES both (nodes from entity store, edges from graph store).
- **Alternatives considered:** (a) widen `MemoryEntityStore` to 4 methods (`upsertEdges`+`graph`) — REJECTED: ISP violation; the read side already returns nodes via `list()`, so a `graph()` would duplicate it. (b) one `MemoryGraphStore.graph()` returning `{nodes,edges}` — REJECTED: would re-query nodes that `MemoryEntityStore.list` already serves (DRY); composition at the handler is cleaner.
- **Consequences:** one new DIP in the ADR-0008 census; the handler depends on BOTH ports (both optional — graceful per D6).

### D3 — `entity_edges` table: 2 FKs to `entities` + `source_memory_id` provenance IN the UNIQUE (EC-1)

- **Decision:** `entity_edges(id, source_entity_id FK→entities, target_entity_id FK→entities, relation, normalized_relation, source_memory_id FK→memories, workspace_id, user_id, session_id, agent_id, created_at)`. Dedup UNIQUE on `(workspace_id, COALESCE scope…, source_entity_id, normalized_relation, target_entity_id, source_memory_id)` — **`source_memory_id` IS part of the arbiter** (EC-1 fix): one edge row per (triple, memory). FK `source_memory_id ON DELETE CASCADE` + FKs to `entities ON DELETE CASCADE`. `memory_count` = `count(DISTINCT source_memory_id) GROUP BY (source_entity_id, normalized_relation, target_entity_id)` at read time (T2.1 `listEdges`).
- **Rationale:** a triple is 3 columns + provenance (blueprint D2). Putting `source_memory_id` in the key makes the SAME triple from N memories produce N provenance rows → `memory_count` aggregates correctly (the whole point of edge aggregation). Edge case EC-1 caught the v1.0 defect: with `source_memory_id` OUTSIDE the key + a single column, `count(DISTINCT source_memory_id)` was frozen at 1. Endpoint FKs guarantee referential integrity; CASCADE on memory delete keeps the graph consistent with `forget()` (Princípio 3). Re-asserting the same triple from the same memory → ON CONFLICT idempotent.
- **Alternatives considered:** (a) `source_memory_id` outside the UNIQUE + a separate `memory_edges` link table (mirror slice-1 `memory_entities`) — REJECTED: the edge row already IS the provenance unit (unlike a shared node); a link table is needless indirection (KISS). (b) store endpoint NAMES (denormalized) instead of FKs — REJECTED: breaks referential integrity, can't CASCADE. (c) no UNIQUE — REJECTED: re-asserting the same triple from the same memory would spam duplicate rows.
- **Consequences:** an edge requires BOTH endpoints to exist as nodes first (resolution can fail → skip, per D5). Additive migration 0019, no change to 0018 tables.

### D4 — `GET /v1/scopes/:type/:id/graph` returns `{nodes, edges}` composed from both ports

- **Decision:** new route; handler returns `{ nodes: EntityNodeSummary[] (via MemoryEntityStore.list), edges: EdgeSummary[] (via MemoryGraphStore.listEdges) }`. `EdgeSummary = {source: string, relation: string, target: string, memory_count: number}` (source/target = entity NAMES, byte-compatible with node `id`).
- **Rationale:** mirrors the slice-1 entities aggregation (`entities.py:46-66`); the edges half is OUR synthesis (no OSS precedent — EC-2 honest). Names (not ids) on the wire so the frontend can match edges to node `id`s without a second lookup.
- **Alternatives considered:** (a) return endpoint UUIDs — REJECTED: forces the frontend to join; node listing already keys by name. (b) extend `/entities` to also return edges — REJECTED: breaks the existing `{entities:[…]}` response contract (slice-1 consumers + dashboard).
- **Consequences:** a new public REST surface (pre-release additive, acceptable). OpenAPI registered.

### D5 — Edge linking is fail-soft inside Phase 7; malformed/unresolvable triples are skipped with an OTel event

- **Decision:** after node linking, `linkEntities` resolves each triple's endpoints by `(scope, normalized_key)`; required-key guard (`source`/`relationship`/`destination` present + non-empty, mirror `utils.py:282`); endpoints that don't resolve to an existing node → skip that edge. The whole edge block is inside the SAME try/catch as nodes (a remember() NEVER fails on edge linking). New events `entity_edge_linked` + `entity_edge_linking_failed`.
- **Rationale:** Princípio 3 (auditability) + ADR D3 of slice 1 (fail-soft) + honesty (an LLM may name an endpoint compromise didn't extract — skipping is honest, not silent corruption).
- **Alternatives considered:** (a) auto-create missing endpoint nodes from the triple — REJECTED: those nodes would lack an embedding (the node path embeds names) → would need a special path; skip is simpler + honest (YAGNI). (b) fail the remember() on a malformed triple — REJECTED: violates the fail-soft invariant.
- **Consequences:** edges only form between nodes compromise actually extracted; coverage bounded by node extraction quality (documented limitation, acceptable for a dashboard view).

### D6 — `memoryGraphStore` is an OPTIONAL `AppOptions` field; absent → `/graph` returns nodes + empty edges

- **Decision:** `AppOptions.memoryGraphStore?` like `memoryEntityStore?`. When the graph store is absent, `/graph` returns `{ nodes: (via entity store or attributed fallback), edges: [] }`. When BOTH stores are absent, nodes use the slice-1 `attributed_to` fallback and edges are `[]`.
- **Rationale:** back-compat + Strangler-Fig (mirrors slice-1 ADR D4): a server not wired for graph still answers `/graph` honestly (empty edges) rather than 404/500.
- **Alternatives considered:** (a) 501 when the port is absent — REJECTED: the nodes half is still serviceable; an empty-edges graph is a valid graph. (b) require the port (no optional) — REJECTED: breaks existing `createServer` callers.
- **Consequences:** `themory server` must inject the port (T3.x) for production to serve real edges (mirrors slice-1 F-M1).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| LLM may emit relations whose endpoints `compromise` did NOT extract as nodes → those edges are silently dropped | Medium | D5 fail-soft skip + `entity_edge_linking_failed` OTel event records the drop count (auditable, not silent); documented limitation in CHANGELOG | impl |
| Edge extraction adds tokens to every `infer:true` extraction prompt (LLM cost) | Low | relations field is optional + small; same single call (no extra round-trip per D1); measure prompt-token delta in integration | impl |
| `infer:false` verbatim path produces NO edges (no LLM call) | Low | honest + documented (mirrors the inherent infer:false limitation); nodes still extracted | impl |
| `compromise` POS non-determinism (PROPER vs COMPOUND, slice-1 known issue) can make an endpoint resolve to a different node row across calls → an edge endpoint may resolve inconsistently | Medium | resolution is by `normalized_key` (case/space-insensitive), which is stable across POS labels; GOAL test asserts the edge surfaces, not an exact row count (mirrors slice-1 F-M4 robustness) | impl |
| New public REST surface `/graph` is pre-release breaking surface area | Low | additive only; `{nodes,edges}` shape locked in D4; OpenAPI-registered; Status stays Pre-release | owner |

## Unresolved Questions

- Q1 — Should an edge whose endpoint node does not yet exist auto-create the node (with a deferred embedding) instead of being skipped? (D5 chooses skip; revisit if recall@graph is too low in dogfooding.)
- Q2 — RESOLVED by EC-1 (edge-case review): the UNIQUE INCLUDES `source_memory_id` (one row per (triple, memory)); `memory_count` = `count(DISTINCT source_memory_id) GROUP BY triple` at read time. The v1.0 "exclude source_memory_id" design was a defect (memory_count frozen at 1). T1.1 locks the new constraint.
- Q3 — The theo-cloud gateway SDK + BFF proxy + dashboard graph view (cytoscape/react-flow) is a CROSS-REPO follow-up sequenced AFTER this theo-memory plan merges (cross-repo order: theo-memory before theo-cloud). It is NOT in this plan's scope — tracked as a sibling theo-cloud plan. (Confirmed: keeps this plan in-repo + GOAL test self-contained against pgvector.)

## Dependency Graph

```
Phase 1 (schema + migration 0019) ──▶ Phase 2 (extraction + DIP + impl) ──▶ Phase 3 (REST + wiring) ──▶ Phase 4 (Integration Validation / GOAL)
         │                                      │
         │                                      ▼
         └────────────────────────────▶ T2.1 (schema-backed: edges table must exist before the store impl)
```

Phase 1 blocks Phase 2 (the store impl needs the table). Phase 2 blocks Phase 3 (the handler needs the port + impl). Phase 3 blocks Phase 4 (GOAL needs the wired route). Within Phase 2, T2.0 (schema/DIP types) blocks T2.1/T2.2 (impl + pipeline).

---

## Phase 1: Schema + additive migration

**Objective:** create the `entity_edges` table (drizzle schema + raw SQL migration 0019) without altering any existing table.

### T1.1 — Add `entity_edges` to the drizzle schema + migration 0019

#### Objective
Define the `entity_edges` table with 2 entity FKs, `source_memory_id` provenance FK, scope columns, `relation` + `normalized_relation`, and a per-scope dedup UNIQUE.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — adds a `entityEdges` drizzle table to `schema.ts` + a hand-authored additive `0019_entity_edges.sql` migration + the drizzle journal entry, mirroring how `memory_entities` was added in 0018.
2. **Why it is necessary now** — the store impl (T2.1) and every downstream test needs the table to exist; per ADR D3 the edge is relational data with referential integrity (FKs + CASCADE), so the schema is the foundation phase. Migration must be additive (Inquebrável + slice-1 additive discipline) so existing deployments upgrade cleanly.

#### Evidence
- `packages/core/src/infrastructure/db/schema.ts:596` — entities + memory_entities tables added in 0018 (the pattern to mirror).
- `packages/core/src/infrastructure/db/migrations/0018_entity_nodes.sql` — the additive precedent.
- `Blueprint §"D2"` — `entity_edges(id, source_entity_id, target_entity_id, relation, source_memory_id, created_at)` + UNIQUE precedent (`letta/letta/orm/identity.py:24`).

#### Files to edit
```
packages/core/src/infrastructure/db/schema.ts — add entityEdges table (drizzle)
packages/core/src/infrastructure/db/migrations/0019_entity_edges.sql (NEW) — additive DDL
packages/core/src/infrastructure/db/migrations/meta/_journal.json — drizzle journal entry for 0019
packages/core/src/infrastructure/db/migrations/meta/0019_snapshot.json (NEW) — drizzle snapshot
packages/core/src/infrastructure/db/schema.test.ts — RED: assert entity_edges columns + dim/constraint shape
```

#### Deep file dependency analysis
- `schema.ts` (596 LoC today, defines entities/memory_entities) — add `entityEdges` pgTable; downstream `pg-memory-graph-store.ts` (NEW) reads it; `runMigrations` applies the SQL.
- `0019_entity_edges.sql` (NEW) — applied by the existing `runMigrations(pool)` path; must be idempotent-safe additive (CREATE TABLE IF NOT EXISTS + CREATE UNIQUE INDEX).
- The journal + snapshot keep `drizzle-kit` in sync (slice-1 lesson: journal must be updated or migrate desyncs).

#### Deep Dives
- Columns: `id uuid pk default gen_random_uuid()`, `source_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE`, `target_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE`, `relation text NOT NULL`, `normalized_relation text NOT NULL`, `source_memory_id uuid REFERENCES memories(id) ON DELETE CASCADE`, `workspace_id text NOT NULL DEFAULT 'default'`, `user_id text`, `session_id text`, `agent_id text`, `created_at timestamptz NOT NULL DEFAULT now()`.
- Dedup UNIQUE (EC-1 — `source_memory_id` IS in the key so `memory_count` aggregates correctly): `UNIQUE (workspace_id, COALESCE(user_id,''), COALESCE(session_id,''), COALESCE(agent_id,''), source_entity_id, normalized_relation, target_entity_id, source_memory_id)` — one row per (triple, memory); the same triple from N memories → N rows → `count(DISTINCT source_memory_id)` = N at read time.
- Invariant: additive only — no ALTER/DROP on entities/memory_entities/memories.
- Edge case: self-edge (source == target) allowed (an entity related to itself is rare but valid); empty `relation` rejected at the store layer (T2.1), not the DB.

#### Tasks
1. Add `entityEdges` pgTable to `schema.ts`.
2. Hand-author `0019_entity_edges.sql` (additive CREATE TABLE + UNIQUE INDEX).
3. Add the drizzle journal + snapshot entry for 0019.
4. RED test in `schema.test.ts` asserting the column set + the UNIQUE arbiter + the FK CASCADE.

#### TDD
```
RED:     entity_edges_table_has_expected_columns() — const cols = await introspectColumns('entity_edges'); expect(cols).toContain('source_entity_id'); expect(cols).toContain('normalized_relation')
RED:     entity_edges_unique_arbiter_present() — const hasUnique = await uniqueIndexExists('entity_edges'); expect(hasUnique).toBe(true)
GREEN:   Implement schema + migration + journal
REFACTOR: None expected
VERIFY:  npx vitest run --config vitest.contract.config.ts packages/core/src/infrastructure/db/schema.test.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — schema definition is declarative; the concurrent-upsert race is exercised in T2.1.

#### Acceptance Criteria
- [ ] `entity_edges` table created by `runMigrations` against real `ankane/pgvector:v0.5.1`.
- [ ] Migration is additive (no ALTER/DROP of 0018/earlier objects); `drizzle` journal in sync.
- [ ] UNIQUE arbiter + 3 FKs present — verified by `schema.test.ts` introspecting `entity_edges` (2× `entities` CASCADE, 1× `memories` CASCADE).
- [ ] Pass: lint zero warnings on changed files; size ≤ 500 lines (schema.ts stays under budget — adding ~20 lines).

#### DoD (Definition of Done)
- [ ] `npx vitest run --config vitest.contract.config.ts` green
- [ ] `npm run test:type` zero errors
- [ ] `runMigrations(pool)` applies `0019_entity_edges.sql` cleanly on a fresh DB (integration setup green).
- [ ] CHANGELOG `[Unreleased]` Added entry

---

## Phase 2: Relation extraction + MemoryGraphStore DIP + impl

**Objective:** the LLM emits triples; Phase 7 links edges (fail-soft); a new port persists + reads them.

### T2.0 — `MemoryGraphStore` DIP + `EdgeToLink`/`EdgeSummary` types + 2 new MEMORY_EVENTS

#### Objective
Declare the domain port + DTOs for edges; append `entity_edge_linked` + `entity_edge_linking_failed` to `MEMORY_EVENTS`.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — creates `domain/dip/memory-graph-store.ts` (interface `MemoryGraphStore` with `upsertEdges` + `listEdges`, plus `EdgeToLink`, `EdgeSummary`, params), re-exports from `domain/index.ts`, and appends the 2 OTel events.
2. **Why it is necessary now** — ADR D2 puts edges in their own port; defining the contract first (DIP) lets the pipeline (T2.2) and the impl (T2.1) depend on the abstraction, not the concrete (DIP direction per `architecture.md`). Events first so the fail-soft paths (T2.1/T2.2) can emit typed events.

#### Evidence
- `packages/core/src/domain/dip/memory-entity-store.ts:54-67` — the sibling port shape to mirror (2 methods, persist + read).
- `packages/core/src/domain/memory-event.ts:68` — `entity_linking_failed` precedent (the event to mirror for edges).
- `ADR-0008 §"MemoryEntityStore — 2 methods"` — the ISP discipline this DIP follows.

#### Files to edit
```
packages/core/src/domain/dip/memory-graph-store.ts (NEW) — MemoryGraphStore + EdgeToLink + EdgeSummary + params
packages/core/src/domain/index.ts — re-export the new DIP + types
packages/core/src/domain/memory-event.ts — append 'entity_edge_linked', 'entity_edge_linking_failed'
packages/core/src/domain/memory-event.test.ts — RED: MEMORY_EVENTS length == 23
packages/core/src/domain/dip/memory-graph-store.test.ts (NEW) — RED: type-shape contract test
```

#### Deep file dependency analysis
- `memory-graph-store.ts` (NEW) — pure interface + types; imported by `pipeline.ts` (port slot), `pg-memory-graph-store.ts` (impl), `packages/api` handler.
- `domain/index.ts` — re-exports for `@usetheo/memory/contract` (the api package imports the type from there).
- `memory-event.ts` — appending 2 literals changes the count contract test (20→21 in slice 1; now 21→23).

#### Deep Dives
- `EdgeToLink = { sourceName: string; relation: string; normalizedRelation: string; targetName: string }` (names; the impl resolves to ids).
- `UpsertEdgesParams = { memoryId: string; workspaceId: string; filters: Filters; edges: readonly EdgeToLink[] }`.
- `EdgeSummary = { source: string; relation: string; target: string; memoryCount: number }`.
- `ListEdgesParams = { workspaceId: string; filters: Filters }`.
- `MemoryGraphStore { upsertEdges(p: UpsertEdgesParams): Promise<void>; listEdges(p: ListEdgesParams): Promise<readonly EdgeSummary[]> }`.

#### Tasks
1. Create `memory-graph-store.ts` with the interface + DTOs.
2. Re-export from `domain/index.ts`.
3. Append 2 events to `MEMORY_EVENTS`.
4. RED tests: event count == 23; DIP type-shape compiles.

#### TDD
```
RED:     memory_events_has_23_literals() — expect(MEMORY_EVENTS.length).toBe(23)
RED:     memory_graph_store_shape() — const stub: MemoryGraphStore = makeStub(); expect(typeof stub.upsertEdges).toBe('function'); expect(typeof stub.listEdges).toBe('function')
GREEN:   Implement the DIP + events
REFACTOR: None expected
VERIFY:  npx vitest run --config vitest.contract.config.ts packages/core/src/domain/memory-event.test.ts packages/core/src/domain/dip/memory-graph-store.test.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — pure interface + type declarations; no shared mutable state.

#### Acceptance Criteria
- [ ] `MemoryGraphStore` exported from `@usetheo/memory/contract`.
- [ ] `MEMORY_EVENTS` length == 23; both new literals present.
- [ ] `MemoryGraphStore` is ISP-clean — exactly 2 methods (`upsertEdges`, `listEdges`) per ADR-0008 census.
- [ ] Pass: lint — `npx eslint <changed files>` returns 0 warnings; size — every changed file ≤ 500 lines.

#### DoD
- [ ] `npx vitest run --config vitest.contract.config.ts` green; `npm run test:type` returns 0 errors; CHANGELOG `[Unreleased]` Added entry present.

### T2.1 — `PgMemoryGraphStore` impl (`upsertEdges` + `listEdges`)

#### Objective
Implement the edge persistence: resolve endpoint names → entity ids by `(scope, normalized_key)`, INSERT edges with the single-round-trip ON CONFLICT pattern, and the listEdges read (JOIN + `memory_count`).

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — creates `pg-memory-graph-store.ts` implementing the DIP against `entity_edges`, reusing slice-1's `(scope, normalized_key)` resolution + the v0.10.1 `ON CONFLICT … DO UPDATE … RETURNING id` single-round-trip idiom.
2. **Why it is necessary now** — the pipeline (T2.2) calls this port; without the impl the GOAL test can't surface edges. It depends on Phase 1's table (blocker).

#### Evidence
- `packages/core/src/infrastructure/db/pg-memory-entity-store.ts:54-90` — the sibling impl: per-memory tx, `ON CONFLICT … DO UPDATE … RETURNING id` (v0.10.1 item 3), F-M2 embedding guard, `memory_entities` link.
- `Blueprint §"Technique 3"` — endpoint resolution by `(scope, normalized_key)` UNIQUE (`letta/identity.py:24`).
- `Blueprint §"Recommendation 4"` — `memory_count` aggregation shape (`mem0/server/routers/entities.py:46-66`).

#### Files to edit
```
packages/core/src/infrastructure/db/pg-memory-graph-store.ts (NEW) — PgMemoryGraphStore
packages/core/src/index.ts — export PgMemoryGraphStore
packages/core/src/infrastructure/db/index.ts — re-export PgMemoryGraphStore
tests/integration/entities/graph.test.ts (NEW, partial) — RED: upsertEdges dedups + listEdges aggregates (real pg)
```

#### Deep file dependency analysis
- `pg-memory-graph-store.ts` (NEW) — depends on `pg.Pool`, the `MemoryGraphStore` DIP (T2.0), the `entity_edges` table (T1.1), and reuses `normalizeEntityKey` (slice-1) for endpoint + relation normalization.
- `index.ts` barrels — additive exports; consumed by `factory.ts` (T3.2) + `tests`.

#### Deep Dives
- `upsertEdges`: for each edge, in ONE per-memory tx:
  1. resolve `source_entity_id` = `SELECT id FROM entities WHERE workspace + COALESCE(scope) + normalized_key = normalizeEntityKey(sourceName) ORDER BY created_at ASC LIMIT 1` (EC-2 — deterministic when `compromise` POS non-determinism created two same-key/different-type node rows; always the earliest); same for target. If EITHER is null → skip this edge (D5 unresolvable).
  2. `INSERT INTO entity_edges (...) VALUES (..., source_memory_id) ON CONFLICT (<arbiter incl. source_memory_id>) DO UPDATE SET relation = entity_edges.relation RETURNING id` (touch-to-return single round-trip per v0.10.1 item 3; the arbiter now includes `source_memory_id` per EC-1 so re-asserting the SAME triple from the SAME memory is idempotent, while a DIFFERENT memory yields a NEW provenance row).
- `listEdges`: `SELECT se.name AS source, ee.relation, te.name AS target, count(DISTINCT ee.source_memory_id) AS memory_count FROM entity_edges ee JOIN entities se ON se.id = ee.source_entity_id JOIN entities te ON te.id = ee.target_entity_id WHERE <scope COALESCE> GROUP BY se.name, ee.relation, te.name ORDER BY memory_count DESC` — `count(DISTINCT source_memory_id)` is correct now that each (triple, memory) is its own row (EC-1).
- Invariant: never throw on a single unresolvable edge — skip + let the pipeline emit the event (the throw-safety is at the pipeline try/catch; the store skips unresolvable endpoints gracefully).
- Edge case: empty `relation` after normalize → skip; self-edge allowed.

#### Pseudo-code / Signatures
```pseudocode
async upsertEdges({ memoryId, workspaceId, filters, edges }):
  client = await pool.connect()
  try:
    await client.query('BEGIN')
    for e in edges:
      # EC-2: resolution is ORDER BY created_at ASC LIMIT 1 (deterministic on duplicate keys)
      srcId = resolveEntityId(client, workspaceId, filters, e.normalizedSourceKey)
      tgtId = resolveEntityId(client, workspaceId, filters, e.normalizedTargetKey)
      if srcId is null or tgtId is null: continue   # D5 unresolvable → skip
      if e.normalizedRelation.length < 1: continue
      # arbiter includes source_memory_id (EC-1) → idempotent per (triple, memory)
      await client.query(INSERT ... ON CONFLICT (...) DO UPDATE SET relation = entity_edges.relation RETURNING id, [..., memoryId])
    await client.query('COMMIT')
  catch: await client.query('ROLLBACK'); throw
  finally: client.release()

# Example
input:  edges=[{source:'John Smith', relation:'works at', destination:'Google'}], scope=user:dave
effect: one entity_edges row (john_smith --works_at--> google), source_memory_id=memoryId
```

#### TDD
```
RED:     upsertEdges_persists_edge_between_existing_nodes() — seed 2 nodes, upsert 1 edge; const edges = await store.listEdges(p); expect(edges.length).toBe(1) (real pg)
RED:     upsertEdges_skips_unresolvable_endpoint() — edge to a non-existent node; const edges = await store.listEdges(p); expect(edges.length).toBe(0) (no throw)
RED:     upsertEdges_aggregates_memory_count_across_memories() — same triple from 2 memories; const mc = edges[0].memoryCount; expect(mc).toBe(2) (EC-1)
RED:     resolveEntityId_deterministic_on_duplicate_key() — seed 2 nodes same normalized_key different type; const first = await resolveTwice(); expect(first).toBe(earliestId) (EC-2)
GREEN:   Implement PgMemoryGraphStore
REFACTOR: extract resolveEntityId helper if duplicated with entity store
VERIFY:  THEOMEM_PG_URI=... npx vitest run --config vitest.integration.config.ts tests/integration/entities/graph.test.ts
```

#### Concurrency tests (only when applicable)

Race detector / concurrent test: two concurrent `upsertEdges` of the SAME triple (`Promise.all`) → exactly ONE `entity_edges` row (ON CONFLICT arbiter), no duplicate-key throw. Mirrors slice-1 F-H2 (`list.test.ts` concurrent same-entity upsert). This is a happens-before invariant single-threaded TDD never exercises.

#### Acceptance Criteria
- [ ] `upsertEdges` resolves endpoints by `(scope, normalized_key)`, single round-trip ON CONFLICT, skips unresolvable.
- [ ] `listEdges` returns `{source, relation, target, memoryCount}` aggregated, scope-filtered.
- [ ] Concurrent same-triple `upsertEdges` (`Promise.all`) → exactly 1 row (`graph.test.ts` race test green).
- [ ] Pass: coverage 100% on the impl critical path; lint 0; size ≤ 500.

#### DoD
- [ ] `THEOMEM_PG_URI=… npx vitest run --config vitest.integration.config.ts tests/integration/entities/graph.test.ts` green vs real pgvector; `npm run test:type` returns 0 errors; CHANGELOG `[Unreleased]` Added entry present.

### T2.2 — Extend extraction schema + prompt + Phase 7 edge linking

#### Objective
The LLM emits optional `relations`; `linkEntities` links edges after nodes (fail-soft); endpoints resolved against the nodes just persisted.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — adds optional `relations` to `AdditiveExtractionSchema` + prompt instruction; threads the parsed relations into `ExtractionDeps` flow; extends `linkEntities` to call `memoryGraphStore.upsertEdges` after node linking (same fail-soft try/catch); emits `entity_edge_linked`/`entity_edge_linking_failed`.
2. **Why it is necessary now** — this is the actual extraction→persistence wiring; without it no edges are produced from `remember()`. Depends on T2.0 (port) + T2.1 (impl) + T1.1 (table).

#### Evidence
- `packages/core/src/domain/extraction/prompt.ts:96-105` — `AdditiveExtractionSchema` (the schema to extend, optional field for back-compat).
- `packages/core/src/domain/extraction/pipeline.ts:524-569` (post-refactor `linkEntities`) — the fail-soft Phase 7 helper to extend.
- `mem0/mem0/memory/utils.py:282` — the required-key guard (`source`/`relationship`/`destination`) to mirror.

#### Files to edit
```
packages/core/src/domain/extraction/prompt.ts — add optional relations to schema + prompt text
packages/core/src/domain/extraction/pipeline.ts — thread relations; extend linkEntities w/ edge linking; add memoryGraphStore? to ExtractionDeps
packages/core/src/infrastructure/llms/stub.ts — extend stub to optionally emit relations (for tests)
packages/core/src/domain/extraction/prompt.test.ts — RED: schema parses relations + back-compat (omitted relations still valid)
packages/core/src/domain/extraction/pipeline.test.ts (or existing) — RED: linkEntities emits edge events; fail-soft on store throw
```

#### Deep file dependency analysis
- `prompt.ts` — `AdditiveExtractionSchema` gains `relations: z.array(z.object({source,relationship,destination})).optional()`; the SYSTEM_PROMPT gains one line describing the relations output. Back-compat: optional means existing stubs/LLMs that omit it still parse (invariant).
- `pipeline.ts` — `ExtractionDeps.memoryGraphStore?` added (mirrors `memoryEntityStore?`); the Phase-2 parse result's `relations` flow into `linkEntities`; edge linking runs ONLY when `memoryGraphStore !== undefined` AND there are relations. The infer:false path passes no relations (no LLM) — honest.
- `stub.ts` — a `relationsLlm(...)` helper for deterministic edge tests.

#### Deep Dives
- Schema: `relations: z.array(z.object({ source: z.string(), relationship: z.string(), destination: z.string() })).optional()`.
- `linkEntities` signature gains `relations?: readonly {source,relationship,destination}[]`. After node linking succeeds, build `EdgeToLink[]`: cap at `MAX_EDGES_PER_MEMORY = 50` (EC-3, mirror the node cap), normalize relation + endpoint keys via `normalizeEntityKey`, required-key + length guard (`source`/`relationship`/`destination` all non-empty AND `relationship.length <= 64` — EC-4), then `memoryGraphStore.upsertEdges`. Wrap in the SAME try/catch (edge failure emits `entity_edge_linking_failed`, never fails remember()).
- Invariant: a remember() NEVER throws because edge linking failed (fail-soft, mirrors node linking).
- Edge case: relations present but node linking found 0 nodes → endpoints won't resolve → all edges skipped (D5); relations malformed (`[{}]`) → required-key guard drops them (mirror utils.py:282); >50 relations → capped (EC-3); over-long predicate → dropped (EC-4); self-edge (source==target) allowed (EC-6).

#### Pseudo-code / Signatures
```pseudocode
# inside linkEntities, after node upsertAndLink succeeds for an item:
if memoryGraphStore and relations and relations.length > 0:
  edges = relations
    .filter(r => r.source && r.relationship && r.destination)         # required-key guard
    .map(r => ({ sourceName: r.source, relation: r.relationship,
                 normalizedRelation: normalizeKey(r.relationship),
                 targetName: r.destination,
                 normalizedSourceKey: normalizeKey(r.source),
                 normalizedTargetKey: normalizeKey(r.destination) }))
  if edges.length > 0:
    await memoryGraphStore.upsertEdges({ memoryId: item.id, workspaceId, filters, edges })
    emitEvent(tracer, 'entity_edge_linked', { edge_count: edges.length })
# all inside the existing Phase-7 try/catch → catch emits 'entity_edge_linking_failed'
```

#### TDD
```
RED:     schema_parses_optional_relations() — const parsed = AdditiveExtractionSchema.safeParse(withRelations); expect(parsed.success).toBe(true)
RED:     schema_backcompat_no_relations() — const parsed = AdditiveExtractionSchema.safeParse(noRelations); expect(parsed.success).toBe(true)
RED:     link_entities_emits_edge_event_on_relations() — const calls = stubStore.upsertEdgesCalls; expect(calls).toBe(1); expect(events).toContain('entity_edge_linked')
RED:     link_entities_failsoft_on_edge_store_throw() — const result = await remember(text); expect(result).toBeDefined(); expect(events).toContain('entity_edge_linking_failed')
RED:     link_entities_caps_edges_at_max() — const passed = stubStore.lastEdgeCount; expect(passed).toBeLessThanOrEqual(50) (EC-3)
RED:     link_entities_drops_overlong_or_malformed_relation() — const passed = stubStore.lastEdgeCount; expect(passed).toBe(0) (EC-4)
GREEN:   Implement schema + prompt + pipeline edge linking
REFACTOR: keep linkEntities cohesive (extract buildEdges helper if it grows)
VERIFY:  npx vitest run --config vitest.contract.config.ts packages/core/src/domain/extraction/prompt.test.ts packages/core/src/domain/extraction/pipeline.test.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded) at the pipeline orchestration layer; the concurrent-upsert race is covered by T2.1's race test.

#### Acceptance Criteria
- [ ] `AdditiveExtractionSchema` parses optional `relations` AND back-compat (omitted) still valid.
- [ ] `linkEntities` links edges after nodes, fail-soft, emits the 2 events.
- [ ] Malformed/unresolvable triples skipped without throw — asserted by `pipeline.test.ts` (`[{}]` + missing-endpoint cases → 0 edges).
- [ ] Pass: coverage 100% on the new branch; lint 0; size: pipeline.ts stays ≤ 500 — if the edge block pushes it over, extract `linkEdges` helper (note: pipeline.ts is 599 today; adding the edge block REQUIRES a helper-extraction refactor to honor the budget — do it in this task).

#### DoD
- [ ] `npx vitest run --config vitest.contract.config.ts` green; `npm run test:type` returns 0 errors; CHANGELOG `[Unreleased]` Changed/Added entry present.

---

## Phase 3: REST `/graph` + production wiring

**Objective:** `GET /v1/scopes/:type/:id/graph` returns `{nodes,edges}`; factory + server inject the graph store.

### T3.1 — `GET /v1/scopes/:type/:id/graph` handler + route + OpenAPI

#### Objective
A handler that composes nodes (`MemoryEntityStore.list` / attributed fallback) + edges (`MemoryGraphStore.listEdges` / empty) into `{nodes, edges}`.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — creates `handlers/graph.ts`, registers `app.get('/v1/scopes/:type/:id/graph', ...)`, adds `AppOptions.memoryGraphStore?`, registers the OpenAPI path.
2. **Why it is necessary now** — the GOAL test reads edges over REST; the dashboard graph view (cross-repo follow-up) consumes this exact shape. Depends on T2.0 (type) + T2.1 (impl).

#### Evidence
- `packages/api/src/server/handlers/entities.ts:59-119` — the sibling handler (scope parse, port branch + attributed fallback) to mirror.
- `packages/api/src/server/app.ts:138,322` — `AppOptions.memoryEntityStore?` + route registration pattern.
- `packages/api/src/server/openapi-registration.ts:200` — the `/entities` OpenAPI registration to mirror.

#### Files to edit
```
packages/api/src/server/handlers/graph.ts (NEW) — graphHandler(c, memory, memoryEntityStore?, memoryGraphStore?)
packages/api/src/server/app.ts — AppOptions.memoryGraphStore?; register /graph route
packages/api/src/server/openapi-registration.ts — register /graph path + {nodes,edges} response schema
packages/api/src/server/handlers/graph.test.ts (NEW) — RED: {nodes,edges} shape; empty edges when graph store absent (D6)
```

#### Deep file dependency analysis
- `graph.ts` (NEW) — imports `MemoryEntityStore`, `MemoryGraphStore` from `@usetheo/memory/contract`; reuses the scope-parse + `filtersFor` logic (extract a shared helper OR duplicate the tiny switch — DRY vs KISS: duplicate the 6-line `filtersFor` is acceptable per DRY-is-knowledge, but prefer importing from a shared `_scope-filters.ts` if entities.ts is refactored; keep KISS — duplicate is fine for 6 lines).
- `app.ts` — additive option + route; existing routes untouched.
- `openapi-registration.ts` — additive path.

#### Deep Dives
- Response: `{ nodes: [{id, scope_type, memory_count, last_seen_at}], edges: [{source, relation, target, memory_count}] }`.
- D6 branches: graph store present → real edges; absent → `edges: []`. Entity store present → real nodes; absent → attributed fallback nodes (reuse entities handler logic or call it).
- Invariant: scope = SUBJECT (same cross-tenant-leak rationale as entities.ts); workspace from principal.

#### TDD
```
RED:     graph_returns_nodes_and_edges() — const body = await res.json(); expect(body.nodes.length).toBeGreaterThan(0); expect(body.edges.length).toBeGreaterThan(0)
RED:     graph_empty_edges_when_graph_store_absent() — const body = await res.json(); expect(body.edges).toEqual([]) (D6)
RED:     graph_invalid_scope_type_404() — const status = res.status; expect(status).toBe(404)
GREEN:   Implement graphHandler + route + openapi
REFACTOR: None expected
VERIFY:  cd packages/api && npx vitest run src/server/handlers/graph.test.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded) request handler; no shared mutable state across requests.

#### Acceptance Criteria
- [ ] `GET /graph` returns `{nodes,edges}`; D6 empty-edges fallback works.
- [ ] OpenAPI registers `/v1/scopes/{type}/{id}/graph` — asserted by `graph.test.ts` against `GET /v1/openapi.json`.
- [ ] Pass: lint — `npx eslint <changed files>` returns 0 warnings; size — every changed file ≤ 500 lines.

#### DoD
- [ ] `cd packages/api && npx vitest run` green (190+ tests); `npm run test:type` returns 0 errors; CHANGELOG `[Unreleased]` Added entry present.

### T3.2 — Wire `PgMemoryGraphStore` in the factory + `themory server`

#### Objective
`createLocalMemory` exposes/threads the graph store; `themory server` injects it so production serves real edges (mirrors slice-1 F-M1).

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — in `factory.ts`, when `entityBoost !== false` AND PgvectorStore, also construct `PgMemoryGraphStore` and thread it into `ExtractionDeps.memoryGraphStore`; in `run-server.ts`, inject `memoryGraphStore: new PgMemoryGraphStore(pool)` into `createServer`.
2. **Why it is necessary now** — without factory wiring, `remember()` never links edges (the port is undefined); without server injection, `/graph` always takes the empty-edges fallback in production (the slice-1 F-M1 lesson: the read port must be wired or the goal isn't met in the real server).

#### Evidence
- `packages/core/src/infrastructure/db/factory.ts:175-185` — the entity-port wiring to mirror (same `entityBoost`/PgvectorStore gate).
- slice-1 review F-M1 (`entity-extraction-nodes-slice1-review-2026-06-20.md:29`) — the "read port has no production caller" finding; the fix injected the store in run-server.ts. Same gate here.

#### Files to edit
```
packages/core/src/infrastructure/db/factory.ts — construct + thread PgMemoryGraphStore (same entityBoost gate)
packages/core/src/infrastructure/db/config.ts — add memoryGraphStore? to the config type (mirror memoryEntityStore?)
packages/cli/src/run-server.ts — inject memoryGraphStore into createServer
packages/cli/src/run-server.test.ts — RED: createServer called with memoryGraphStore (mock)
tests/integration/entities/graph.test.ts — extend: factory default-ON wires edges end-to-end
```

#### Deep file dependency analysis
- `factory.ts` (267 LoC) — additive wiring next to the entity port; downstream every `createLocalMemory` consumer gets edges by default (entityBoost on).
- `config.ts` — additive optional field.
- `run-server.ts` — mirrors the slice-1 F-M1 injection; `run-server.test.ts` mock must add `PgMemoryGraphStore` (slice-1 lesson: the mock of `@usetheo/memory` needs the new export or the test breaks).

#### Deep Dives
- Gate: `config.entityBoost !== false && config.vectorStore instanceof PgvectorStoreClass` → `memoryGraphStore: config.memoryGraphStore ?? new PgMemoryGraphStore(config.vectorStore.poolForEviction)` (mirror the entity port exactly).
- Invariant: a consumer MAY inject their own `memoryGraphStore`; default uses the same pool as the entity store.

#### TDD
```
RED:     run_server_injects_graph_store() — const opts = createServerMock.lastCall; expect(opts.memoryGraphStore).toBeDefined()
RED:     factory_default_on_wires_edges() — createLocalMemory (no port) + remember(relation text); const edges = await store.listEdges(p); expect(edges.length).toBeGreaterThan(0) (real pg)
GREEN:   Implement factory + config + run-server wiring
REFACTOR: None expected
VERIFY:  cd packages/cli && npx vitest run src/run-server.test.ts ; THEOMEM_PG_URI=... npx vitest run --config vitest.integration.config.ts tests/integration/entities/graph.test.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded) wiring; factory + server construction is sequential.

#### Acceptance Criteria
- [ ] Factory wires `PgMemoryGraphStore` under the same gate as the entity port.
- [ ] `themory server` injects it (production serves real edges).
- [ ] `run-server.test.ts` mock updated; cli suite green.
- [ ] Pass: lint — `npx eslint <changed files>` returns 0 warnings; size — every changed file ≤ 500 lines.

#### DoD
- [ ] `cd packages/cli && npx vitest run` green AND `THEOMEM_PG_URI=… npx vitest run --config vitest.integration.config.ts tests/integration/entities/` green; `npm run test:type` returns 0 errors; CHANGELOG `[Unreleased]` Added entry present.

---

## Phase 4: Integration Validation (MANDATORY)

**Objective:** the GOAL test passes end-to-end vs real pgvector; all gates green.

### T4.1 — GOAL test + full validation chain

#### Objective
`remember('John Smith works at Google')` (infer:true, relations-emitting LLM stub) → Phase 7 links the edge → `GET /v1/scopes/user/:id/graph` returns the `John Smith --works_at--> Google` edge.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — the end-to-end GOAL test in `tests/integration/entities/graph.test.ts` exercising the full chain (factory default-ON → remember → REST /graph) against real `ankane/pgvector:v0.5.1`; then runs the full validation chain.
2. **Why it is necessary now** — the plan's Goal metric IS this test; it proves the wiring fires in a real workload (not just unit-mocked).

#### Evidence
- `tests/integration/entities/extract.test.ts:61-138` — the slice-1 GOAL test structure to mirror (createLocalMemory + remember + createServer + fetch).
- `Blueprint §"Goal"` — the `{nodes,edges}` round-trip is the deliverable.

#### Files to edit
```
tests/integration/entities/graph.test.ts — GOAL test (full chain) + the T2.1/T3.2 cases consolidated
```

#### Deep file dependency analysis
- `graph.test.ts` — uses a `relationsLlm` stub (returns `{memory:[{id,text}], relations:[{source:'John Smith', relationship:'works at', destination:'Google'}]}`); `fixedEmbedder` (1536 zeros, slice-1 pattern); real `pg.Pool`; `runMigrations` + TRUNCATE between tests.

#### Deep Dives
- The stub must return BOTH a memory fact (so a node gets persisted + the memory row exists for provenance) AND the relation; compromise also extracts "John Smith"/"Google" as nodes from the fact text → endpoints resolve.
- Robustness (slice-1 F-M4 lesson): assert the edge SURFACES (`source==='John Smith' && target==='Google'`), not an exact row count (compromise POS non-determinism); scope assertions by `user_id`.
- Invariant: GOAL test gated by `THEOMEM_PG_URI` (skip when unset).

#### TDD
```
RED:     goal_remember_to_graph_edge() — remember('John Smith works at Google'); const edge = body.edges.find(matchesJohnGoogle); expect(edge).toBeDefined(); expect(edge.target).toBe('Google')
GREEN:   (implementation already done in Phases 1-3; this test must pass)
REFACTOR: None expected
VERIFY:  THEOMEM_PG_URI=... npx vitest run --config vitest.integration.config.ts tests/integration/entities/
```

#### Concurrency tests (only when applicable)

Covered by T2.1's race detector / concurrent test — concurrent same-triple `upsertEdges` (`Promise.all`) → 1 row. No additional race surface in the GOAL test itself.

#### Acceptance Criteria
- [ ] GOAL test `goal_remember_to_graph_edge()` green vs real `ankane/pgvector:v0.5.1`.
- [ ] entities + graph integration suite green — `tests/integration/entities/` runs slice-1 11 + new graph tests at 100% pass.
- [ ] `npx vitest run --config vitest.contract.config.ts` + `cd packages/api && npx vitest run` + `cd packages/cli && npx vitest run` green; `npm run test:type` 0 errors; `npx eslint` 0 warnings; no-paper-names grep clean.

#### DoD
- [ ] full chain green; CHANGELOG finalized; plan ready for `/review`.

### Execution

```
npm run test:type                                                  # zero type errors
npx vitest run --config vitest.contract.config.ts                  # core contract
cd packages/api && npx vitest run                                  # api (190+)
cd packages/cli && npx vitest run                                  # cli
THEOMEM_PG_URI=postgres://themem:themem@localhost:15432/themem \
  npx vitest run --config vitest.integration.config.ts tests/integration/entities/   # GOAL + edges (real pgvector)
npx eslint <changed files>                                         # zero warnings
```

### Acceptance Criteria

- [ ] All suites green — `npx vitest run --config vitest.contract.config.ts` + `cd packages/api && npx vitest run` + `cd packages/cli && npx vitest run` + `tests/integration/entities/`.
- [ ] Coverage ≥ 90% on changed files (critical paths: edge upsert/link 100%)
- [ ] `npm run test:type` returns 0 errors; `npx eslint <changed files>` returns 0 warnings.
- [ ] Runtime-metric proof — `entity_edge_linked` observed in the GOAL integration run
- [ ] Failure scenarios green — see `## Failure scenarios`

### If Validation Fails

1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures (rebuild `dist` via `npm run build:core` before integration — slice-1 stale-dist lesson).
3. Re-run the chain.
4. Pre-existing issues logged in the PR, not blocking.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `entity_edges` table (additive migration 0019) | T1.1 | drizzle schema + 0019 SQL + journal |
| 2 | Relations from the existing LLM call (optional schema field) | T2.2 | `AdditiveExtractionSchema.relations` optional + prompt |
| 3 | Phase 7 edge linking, fail-soft, endpoint resolution | T2.2 | `linkEntities` edge block + try/catch + skip unresolvable |
| 4 | `MemoryGraphStore` DIP (2 methods) | T2.0 | new port + DTOs + 2 events |
| 5 | `PgMemoryGraphStore` impl (upsert single round-trip + listEdges aggregate) | T2.1 | impl + race test |
| 6 | `GET /graph` `{nodes,edges}` | T3.1 | handler + route + OpenAPI |
| 7 | Production wiring (factory + `themory server`) | T3.2 | factory gate + run-server injection (F-M1 parity) |
| 8 | GOAL: remember→/graph edge vs real pgvector | T4.1 | end-to-end GOAL test |
| 9 | Dedup edges across memories (memory_count) | T1.1 (UNIQUE) + T2.1 (listEdges) | per-scope UNIQUE + COUNT DISTINCT |
| 10 | Fail-soft + auditability (2 new events) | T2.0 + T2.2 | `entity_edge_linked` / `entity_edge_linking_failed` |
| 11 | infer:false has no edges (honest) | T2.2 | documented; no LLM on that path |
| 12 | EC-1 — `memory_count` always 1 (design defect) | T1.1, T2.1, D3 | `source_memory_id` IN the UNIQUE; `count(DISTINCT source_memory_id) GROUP BY triple` |
| 13 | EC-2 — non-deterministic endpoint resolution (duplicate normalized_key) | T2.1 | resolution `ORDER BY created_at ASC LIMIT 1` |
| 14 | EC-3 — no per-memory edge cap | T2.2 | `MAX_EDGES_PER_MEMORY = 50` slice |
| 15 | EC-4 — unbounded relation length | T2.2 | required-key + `relationship.length <= 64` guard |
| 16 | EC-5 — infer:false no edges (accepted) | T2.2 | documented in Drawbacks + CHANGELOG |
| 17 | EC-6 — self-edge allowed (accepted) | T1.1, T2.1 | not filtered; documented |

**Coverage: 17/17 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — contract + api + cli + integration entities/graph green
- [ ] Zero type errors — `npm run test:type`
- [ ] Zero lint warnings — `npx eslint` on changed files
- [ ] File-size budget respected (≤ 500 LoC/file; pipeline.ts edge block via `linkEdges` helper extraction)
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] Backward compatibility preserved — `relations` optional; `/entities` unchanged; `MemoryEntityStore` unchanged; migration additive
- [ ] Plan-specific: `MEMORY_EVENTS` count == 23; `MemoryGraphStore` ISP-clean (2 methods); ADR-0008 census footer updated (1 new DIP)
- [ ] Runtime-metric proof — `entity_edge_linked` non-zero in the GOAL integration run
- [ ] Plan archived — after `/review` READY_TO_MERGE + PR merged, move to `knowledge-base/plans/completed/`

## Failure scenarios (when I/O external)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres:entity_edges` (DB) | endpoint entity row absent (edge references a non-extracted node) | upsertEdges with an endpoint name not in `entities` | edge skipped; no throw; `entity_edge_linking_failed` NOT fired for a clean skip (the skip is expected, not an error) — the whole-phase event `entity_edge_linked` reports linked count |
| `postgres:entity_edges` (DB) | upsert throws mid-batch (e.g. constraint/connection) | inject a throwing graph store stub in the pipeline test | Phase 7 catch fires; `entity_edge_linking_failed` emitted; `remember()` STILL resolves (fail-soft invariant) |
| extraction `LLM` (HTTP, via existing call) | LLM omits `relations` entirely | stub returns `{memory:[...]}` with no relations | schema parses (optional); 0 edges; nodes still linked (back-compat) |
| extraction `LLM` | LLM emits malformed triple `[{}]` | stub returns `relations:[{}]` | required-key guard drops it; no throw; 0 edges |
| `postgres:entity_edges` (DB) | concurrent same-triple upsert | `Promise.all` of two identical upsertEdges | exactly ONE row (ON CONFLICT arbiter); no duplicate-key error |

## Final Phase: Integration Validation (MANDATORY)

Covered by T4.1 above — the GOAL test + full validation chain against real `ankane/pgvector:v0.5.1`. The plan is NOT done until `THEOMEM_PG_URI=… vitest tests/integration/entities/` is green AND the `entity_edge_linked` event is observed in that run.
