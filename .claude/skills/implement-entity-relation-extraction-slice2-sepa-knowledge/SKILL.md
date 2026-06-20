---
name: implement-entity-relation-extraction-slice2-sepa-knowledge
description: Paired knowledge layer for the SEPA of /implement plan entity-relation-extraction-slice2 (entity edges + graph view, no graph DB). Holds the distilled watch-list (EC-1 source_memory_id IN the UNIQUE; EC-2 deterministic resolution; fail-soft Phase 7; ADR-0008 ISP 2-method DIP; additive migration 0019; MEMORY_EVENTS 21→23) so the SEPA agent can refresh its domain context. Generated 2026-06-20 by /implement.
---

# SEPA knowledge — entity-relation-extraction-slice2

This is the SEPA's knowledge cache for Slice 2 (edges/relations + `{nodes,edges}` graph, NO graph DB).

## The 2 absorbed MUST-FIX (highest scrutiny)

- **EC-1** — `entity_edges` UNIQUE arbiter INCLUDES `source_memory_id` → one row per (triple, memory) → `memory_count = count(DISTINCT source_memory_id) GROUP BY triple` is correct. Outside-the-key + single column = `memory_count` frozen at 1 (silent wrong data). Verify T1.1 UNIQUE + T2.1 listEdges together.
- **EC-2** — `resolveEntityId` uses `ORDER BY created_at ASC LIMIT 1` (compromise POS non-determinism → two nodes same normalized_key different type → bare `.rows[0]` is non-deterministic).

## Invariants

- Fail-soft Phase 7: edge linking inside the SAME try/catch as node linking; remember() never throws on edge failure; `entity_edge_linking_failed` on catch.
- ADR-0008 ISP: `MemoryGraphStore` = exactly 2 methods; `MemoryEntityStore` NOT widened; `/graph` handler composes both ports.
- DIP direction: port in `domain/dip/`, impl in `infrastructure/db/`; domain imports the port, never the infra class.
- Additive migration 0019 (no ALTER/DROP of 0018); drizzle journal + snapshot in sync.
- MEMORY_EVENTS 21 → 23 (append `entity_edge_linked`, `entity_edge_linking_failed`); count test → 23.
- EC-3 `MAX_EDGES_PER_MEMORY = 50`; EC-4 relation required-key + `length <= 64`.
- pipeline.ts ≤ 500 LoC → extract `linkEdges` helper.
- Stale dist: `npm run build:core` before integration tests.
- No paper names in `src/**`.

## Slice-1 precedents to mirror

- `pg-memory-entity-store.ts` — `ON CONFLICT … DO UPDATE SET name = entities.name RETURNING id` (single round-trip, v0.10.1); F-M2 zero-embedding guard.
- `linkEntities` in `pipeline.ts` — fail-soft Phase 7 shared by infer:true + infer:false.
- `entities.ts` handler — Strangler-Fig port branch + scope parse + attributed fallback.
