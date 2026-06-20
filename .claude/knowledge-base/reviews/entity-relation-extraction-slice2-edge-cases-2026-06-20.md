# Edge Case Review — entity-relation-extraction-slice2

Date: 2026-06-20
Tasks analyzed: 6 (T1.1, T2.0, T2.1, T2.2, T3.1, T3.2, T4.1)
Edge cases found: 6 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

### EC-1: `memory_count` is structurally always 1 under the planned UNIQUE + single `source_memory_id` column

- **Affected task:** T1.1 (UNIQUE arbiter) + T2.1 (`listEdges` aggregate) + ADR D3
- **Family:** State / Format
- **Scenario:** ADR D3 + T1.1 put `source_memory_id` OUTSIDE the dedup UNIQUE (key = `(scope, source_entity_id, normalized_relation, target_entity_id)`) and store ONE `source_memory_id` per edge row. When the SAME triple is asserted from memory B, `ON CONFLICT DO UPDATE` keeps the row (and its FIRST `source_memory_id`). `listEdges` then computes `count(DISTINCT source_memory_id)` over a row that only ever holds ONE memory id → `memory_count` is ALWAYS 1, contradicting Objective #9 + Coverage row 9 ("dedup edges across memories with `memory_count`").
- **Impact:** the `memory_count` on every edge is wrong (frozen at 1); the "this relation seen across N memories" signal — the whole point of edge aggregation — is dead. Silent wrong data (Princípio 3 violation).
- **Suggested fix:** put `source_memory_id` INSIDE the UNIQUE arbiter — `UNIQUE (workspace_id, COALESCE scope…, source_entity_id, normalized_relation, target_entity_id, source_memory_id)` → one edge row per (triple, memory); `listEdges` does `count(DISTINCT source_memory_id) … GROUP BY source_entity_id, normalized_relation, target_entity_id`. No link table needed (the edge row IS the provenance). Update D3, T1.1 UNIQUE, T2.1 upsert (ON CONFLICT becomes idempotent per (triple, memory)), and T2.1's dedup-across-memories test (`memory_count==2` now holds because there are 2 provenance rows).

### EC-2: endpoint resolution is non-deterministic when `compromise` POS labels create two node rows with the same `normalized_key`

- **Affected task:** T2.1 (`resolveEntityId`)
- **Family:** State
- **Scenario:** slice-1's KNOWN issue (documented in `extract.test.ts` F-M4) — `compromise` labels "John Smith" PROPER in one call and COMPOUND in another. EC-1-type-in-identity (`entities` UNIQUE includes `type`) then keeps TWO node rows with the SAME `normalized_key='john_smith'` but different `type`. The planned resolution `SELECT id FROM entities WHERE … normalized_key = $1` returns MULTIPLE rows; `.rows[0]` picks one by Postgres' arbitrary order → an edge endpoint resolves to a different node id across runs → edges can attach to the "wrong" John Smith node, splitting the graph non-deterministically.
- **Impact:** flaky edge endpoints; an edge may point at the PROPER node while the listing shows the COMPOUND node → the frontend can't match the edge to a visible node.
- **Suggested fix:** make resolution deterministic — `SELECT id FROM entities WHERE … normalized_key = $1 ORDER BY created_at ASC LIMIT 1` (always the earliest node for that key). One line in `resolveEntityId`. Add a SHOULD-TEST asserting two same-key/different-type nodes resolve to the SAME (earliest) id.

## SHOULD TEST

### EC-3: no per-memory edge cap — a pathological LLM response can spawn unbounded edge rows + endpoint-resolution queries

- **Affected task:** T2.2 (build `EdgeToLink[]`)
- **Family:** Input / Boundary / Resource
- **Scenario:** slice-1 caps nodes at `MAX_ENTITIES_PER_MEMORY = 50` (EC-3 of slice 1). The edge path has NO equivalent cap. An LLM that hallucinates 500 triples → 500 edges × 2 resolution queries each per memory → resource amplification.
- **Suggested test:** `test('edge linking caps at MAX_EDGES_PER_MEMORY')` — feed >cap relations, assert ≤ cap edges persisted. Fix: `const MAX_EDGES_PER_MEMORY = 50; relations.slice(0, MAX_EDGES_PER_MEMORY)` in `linkEntities` (mirror the node cap, one line).

### EC-4: unbounded `relation` string length

- **Affected task:** T2.2 (normalize relation) / T1.1 (`relation text`)
- **Family:** Input / Format
- **Scenario:** the LLM emits a sentence-as-relation ("works at the company that was founded by…") → a 200-char predicate is stored verbatim; useless as a graph edge label + noise in the listing.
- **Suggested test:** `test('over-long relation is dropped or truncated')` — assert a relation > N chars (e.g. 64) is skipped by the required-key/length guard. Fix: extend the T2.2 guard to `r.relationship.length >= 1 && r.relationship.length <= 64` (one condition; mirror the slice-1 EC-2 name-length guard).

## DOCUMENT

### EC-5: `infer:false` verbatim writes produce NO edges (no LLM call)

- **Affected task:** T2.2
- **Accepted risk:** edges come from the extraction LLM call (ADR D1); the `infer:false` fast-path makes no LLM call so it cannot produce relations. This is honest + inherent (mirrors the pre-v0.10.1 node limitation, but for edges it is permanent by design — there is no deterministic relation extractor). Already noted in the plan Drawbacks; keep the CHANGELOG note explicit so consumers know verbatim writes are nodes-only.

### EC-6: self-edge (source == target after normalization)

- **Affected task:** T1.1 / T2.1
- **Accepted risk:** "Google is part of Google" → a self-loop edge. D3 allows it (rare but valid). The frontend graph view renders self-loops fine. No fix; document that self-edges are permitted (not filtered) so a reviewer doesn't flag it as a bug.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 2 | 1 (EC-1) | 0 | 1 (EC-6) |
| T2.1 | 1 | 1 (EC-2) | 0 | 0 |
| T2.2 | 3 | 0 | 2 (EC-3, EC-4) | 1 (EC-5) |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 0 | 0 | 0 | 0 |
| T4.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — 2 MUST FIX (EC-1 design defect: `memory_count` always 1; EC-2 non-deterministic endpoint resolution). Both are small, surgical (UNIQUE-arbiter change + a deterministic `ORDER BY … LIMIT 1` + a per-memory-edge cap). EC-3/EC-4 fold into existing T2.2 guards as SHOULD-TEST. EC-5/EC-6 are documented accepted risks. No scope change, no new phases.
