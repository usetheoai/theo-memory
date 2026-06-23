# Edge Case Review — graph-aware-recall

Date: 2026-06-22
Tasks analyzed: 7 (T1.1–T5.1)
Edge cases found: 4 (MUST FIX: 2, SHOULD TEST: 1, DOCUMENT: 1)

## MUST FIX

### EC-1: graph-connected memory already in the threshold pool ⇒ duplicate row
- **Affected task:** T3.1
- **Family:** State
- **Scenario:** `expandByEntities` returns a memory that is ALSO in `scored` (it passed threshold AND shares an entity). Without dedup, Step 8.7 appends it again ⇒ the same id appears twice in results.
- **Impact:** duplicate results, broken topK.
- **Suggested fix:** in Step 8.7, build a `Set(scored.map(r=>r.id))` and skip expansion rows whose id is already present. One guard.

### EC-2: cross-scope leak — connected memory in a DIFFERENT scope surfaces (IDOR-like)
- **Affected task:** T4.1 / T4.2
- **Family:** Permission
- **Scenario:** an entity is shared across scopes (e.g., two users both have entity "Python"). The traversal from user A's seed must NOT surface user B's memory just because they share an entity.
- **Impact:** cross-tenant/scope data leak — a correctness AND isolation defect.
- **Suggested fix:** the JOIN MUST filter the CANDIDATE memory by the recall `filters` (workspace + user/session/agent), not just the seed. Join `memories m ON m.id = me2.memory_id` with the scope predicate (the pg impl already plans scope filter via `entities`/`memories`; make the CANDIDATE-side scope filter explicit + test it).

## SHOULD TEST

### EC-3: graphExpand set but no store wired (and no pool to auto-default) ⇒ no-op
- **Affected task:** T3.1
- **Suggested test:** `recall(q, { graphExpand: {} })` with no `graphExpansionStore` + no pool ⇒ byte-identical to plain recall (the option alone is a no-op). Mirrors the adaptive EC-3.

## DOCUMENT

### EC-4: hub-entity fan-out (an entity linked to thousands of memories)
- **Affected task:** T4.1
- **Accepted risk:** bounded by `LIMIT` + 1-hop default + scope filter + index-backed JOIN (Drawbacks table). A per-entity fan-out cap is a follow-up if profiling shows hot entities. Documented; not addressed in v1.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T3.1 | 2 | 1 | 1 | 0 |
| T4.1 | 2 | 1 | 0 | 1 |

**Verdict:** PLAN OK (EC-1 dedup + EC-2 scope-isolation absorbed into T3.1/T4.1 acceptance; EC-3 added as test; EC-4 documented).
