# SEPA initial brief — entity-relation-extraction-slice2 (2026-06-20)

Verdict: PROCEED. Highest-risk task: T2.1 (both EC-1 memory_count + EC-2 determinism converge there; GOAL test does NOT catch EC-1 since it asserts edge surfaces not memory_count — the `upsertEdges_aggregates_memory_count_across_memories` RED test is the only guard).

## EC-1 satisfying shape
- T1.1 UNIQUE arbiter MUST end in `source_memory_id` (8 cols).
- T2.1 `listEdges`: `count(DISTINCT ee.source_memory_id) … GROUP BY se.name, ee.relation, te.name` (NOT group by source_memory_id; NOT count(*)).
- `ON CONFLICT` arbiter MUST match the UNIQUE column-for-column.

## EC-2 satisfying shape
- `resolveEntityId`: `… WHERE normalized_key=$2 ORDER BY created_at ASC LIMIT 1` (ASC = earliest; bare LIMIT 1 / DESC / unordered .rows[0] = HALT).

## Cross-task traps
- T1.1→T2.1 (table must exist; journal/snapshot sync or runMigrations skips 0019).
- T2.0→T2.1+T2.2 (types from domain/index.ts before pipeline/handler import).
- stale-dist: `npm run build:core` before integration.
- MEMORY_EVENTS: count==23 AND exact strings `entity_edge_linked`/`entity_edge_linking_failed` in same commit as count test.

## Top gaming vectors
1. Fail-soft via separate try/catch — edge linking MUST be inside the existing linkEntities try/catch; throwing-stub test must be real.
2. Pillar (a) faked: factory wired but run-server NOT injecting → /graph always D6 fallback. Require BOTH run_server_injects + GOAL.
3. Pillar (c): metric from unit mock not real-pg GOAL run. Require entity_edge_linked observed in THEOMEM_PG_URI run.

## Per-task scrutiny
T1.1 arbiter last col + FK CASCADE + journal sync · T2.0 exactly 2 methods + 23 events · T2.1 EC-2 ORDER BY ASC + EC-1 count DISTINCT + ON CONFLICT match · T2.2 inside try/catch + EC-3 cap 50 + EC-4 len≤64 + ≤500 LoC via linkEdges helper · T3.1 composes both ports (no graph() method) + D6 + subject scope · T3.2 run-server injects (not just factory) · T4.1 edge surfaces (robust) + entity_edge_linked non-zero + build:core first.
