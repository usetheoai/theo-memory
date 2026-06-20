# Edge Case Review — entity-extraction-nodes-slice1

Date: 2026-06-20
Tasks analyzed: 6 (T1.1, T1.2, T2.1, T3.1, T4.1, T5.1)
Edge cases found: 7 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: `normalized_key` collision across DIFFERENT entity types under the same scope
- **Affected task:** T2.1, T3.1
- **Family:** State / Format
- **Scenario:** "Apple" the PROPER noun and "apple" the NOUN normalize to the same `normalized_key` (`apple`). The UNIQUE `(workspace_id, scope, normalized_key)` would merge two semantically different entities into one row, OR (if type is in the key) split what should be one. The plan's UNIQUE does not mention `type`.
- **Impact:** silent entity merge/duplication; `memory_count` wrong.
- **Suggested fix:** include `type` in the dedup identity — either add `type` to the UNIQUE `(workspace_id, scope, type, normalized_key)`, OR (simpler, Mem0-aligned) drop `type` from identity and keep the FIRST type seen (document the choice in T2.1). Decide explicitly in T2.1's DoD.

### EC-2: empty / whitespace-only entity name after normalization
- **Affected task:** T1.2, T3.1
- **Family:** Input
- **Scenario:** an extracted candidate that is all punctuation/whitespace normalizes to `''` → an `entities` row with empty `name`/`normalized_key`, and an embedding of empty string.
- **Impact:** junk node in the listing; wasted embedding call.
- **Suggested fix:** in `CompromiseEntityExtractor` (T1.2), drop candidates whose normalized form is empty or length < 2; add a RED test `test('blank/punct-only candidate is dropped')`.

## SHOULD TEST

### EC-3: very long memory text → unbounded entity count per memory
- **Affected task:** T3.1
- **Suggested test:** `test('entity extraction caps at N entities per memory')` — assert a per-memory cap (e.g. 50) so a pathological input cannot spawn thousands of rows + embedding calls. Mirrors the eviction long-tail discipline.

### EC-4: entityBoost default — does the existing factory pass it?
- **Affected task:** T3.1
- **Suggested test:** `test('createLocalMemory defaults entityBoost so Phase 7 runs by default')` — confirm the gate defaults to ON (ADR-0007) and the wiring actually threads it to Phase 7; otherwise the feature silently never runs.

### EC-5: embedding dimension mismatch entities vs memories
- **Affected task:** T2.1
- **Suggested test:** `test('entities.embedding uses the same MAX_EMBEDDING_DIM as memories')` — the entities table already declares `vector(MAX_EMBEDDING_DIM)`; assert the entity embedder path produces the same dim (a 384 vs 1536 mismatch would fail the insert).

## DOCUMENT

### EC-6: no backfill of pre-existing memories
- **Accepted risk:** entities populate forward-only (already an Unresolved-Question resolution in the plan + mirrors v1.1 attributed_to no-backfill honesty). Existing memories show no entities until re-remembered. Disclose in CHANGELOG.

### EC-7: `memory_count` reflects links, not distinct source memories if a memory mentions an entity twice
- **Accepted risk:** the `memory_entities` PK `(memory_id, entity_id)` already dedups within a memory (one link per memory-entity pair), so `count(memory_id)` = distinct memories. No action; the PK is the guard. Noted so a reviewer does not "fix" a non-bug.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 1 | 1 (EC-2) | 0 | 0 |
| T2.1 | 3 | 1 (EC-1) | 2 (EC-5) | 0 |
| T3.1 | 3 | 1 (EC-1/EC-2 persist) | 2 (EC-3, EC-4) | 0 |
| T4.1 | 0 | 0 | 0 | 0 |
| T5.1 | 0 | 0 | 0 | 0 |
| (global) | 2 | 0 | 0 | 2 (EC-6, EC-7) |

**Verdict:** PLAN NEEDS ADJUSTMENT — 2 MUST FIX (EC-1 type-in-dedup-identity, EC-2 empty-name guard), both small (a UNIQUE-key decision + a drop-filter + 2 tests). Absorb into T1.2/T2.1/T3.1 then re-run `/plan-confidence`.
