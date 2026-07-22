# Discover Edge Case Review — m8-workspace-user-isolation-routing

Date: 2026-07-21
Discovery plan analyzed: knowledge-base/discoveries/plans/m8-workspace-user-isolation-routing-plan.md
Research questions analyzed: 7
Edge cases found: 4 (MUST FIX: 3, SHOULD TEST: 0, DOCUMENT: 1)

## MUST FIX

### EC-1: Q6 mem0 pgvector store path was conditional ("if present")
- **Affected question:** Q6
- **Family:** Reference path / Citation
- **Scenario:** During `/discover-execute`, Q6's Fase B says "read the pgvector store class (if present)". A conditional path lets the loop skip the store-native-enforcement answer.
- **Impact:** the "native vs app-layer enforcement" verdict for mem0 would be under-evidenced.
- **Suggested fix:** the store EXISTS — `mem0/vector_stores/pgvector.py` (verified). Make it a firm citation, not conditional.

### EC-2: Q4 assumes a named cross-user isolation test that does not exist by that name
- **Affected question:** Q4
- **Family:** Method / Interpretation
- **Scenario:** `tests/memory/` has `test_main.py`, `test_storage.py`, `test_memory_utils.py` — but NO file named for user-isolation. A naive grep for a dedicated isolation test returns nothing → Q4 gets spuriously BLOCKED.
- **Impact:** the "how they PROVE isolation" corner (tests) would report BLOCKED when the evidence actually lives inside `test_main.py` / the `_build_filters_and_metadata` unit tests.
- **Suggested fix:** point Q4's Fase A at `tests/memory/test_main.py` + `test_storage.py` for `user_id`/`agent_id`/`filters`/`actor_id` assertions, with an explicit fallback: "if no dedicated cross-user test exists, capture how `_build_filters_and_metadata` scoping is unit-asserted and record the ABSENCE of a dedicated cross-user negative test as a finding (a gap M8 must close, not copy)."

### EC-3: Q3 attribution field was under-specified (message `role`) — the real field is `actor_id`
- **Affected question:** Q3
- **Family:** Interpretation / Method
- **Scenario:** Q3 guessed attribution = message `role` (user/assistant). mem0 actually persists a query-time-filterable **`actor_id`** (`main.py:292` "For query-time filtering"; `:366` `resolved_actor_id`). Reading only `role` would miss the real, borrowable attribution primitive.
- **Impact:** Q3's attribution answer would be weaker than the code offers — and `actor_id` maps almost 1:1 onto theo-memory's `attributed_to`, the exact M8 primitive.
- **Suggested fix:** retarget Q3's method to `actor_id` (`main.py:287-366` actor-filtering precedence block) as the primary attribution primitive; message `role` is only the extraction input.

## SHOULD TEST

(none — the halt-loop checkpoints in the plan already cover path-existence and per-question Fase A budget.)

## DOCUMENT

### EC-4: graphiti `group_id` is a SINGLE partition key, not a composite `(tenant, user, session)`
- **Accepted risk:** `nodes.py:96` — `group_id: str = Field(description='partition of the graph')`; `delete_by_group_id(group_id: str)`. graphiti models ONE partition id, not a 3-part composite. This is not a plan break — graphiti is consulted as the **single-key contrast + the composite-INDEX technique** (put the partition key in EVERY index: `graph_queries.py:32-64`). The blueprint must frame graphiti's lesson as "partition key present in every index / query filter", NOT as a source for a 3-part `(workspace, user, session)` key. theo-memory's composite key is the NOVEL part M8 designs; mem0's `(user_id | run_id) + actor_id` is the closer analog for the key shape. Record this framing as an ADR in the blueprint.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 0 | 0 | 0 | 0 |
| Q2 | 1 (shared EC-4) | 0 | 0 | 1 |
| Q3 | 1 | 1 | 0 | 0 |
| Q4 | 1 | 1 | 0 | 0 |
| Q5 | 1 (shared EC-4) | 0 | 0 | 1 |
| Q6 | 1 | 1 | 0 | 0 |
| Q7 | 0 | 0 | 0 | 0 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT — absorb EC-1, EC-2, EC-3 (MUST FIX) into plan v1.1; add EC-4 as a blueprint-framing ADR.
