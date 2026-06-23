# Edge Case Review — skills-subject-prefix-index

Date: 2026-06-23
Tasks analyzed: 3 (T1.1, T1.2, T1.3)
Edge cases found: 4 (MUST FIX: 1, SHOULD TEST: 1, DOCUMENT: 2)

## MUST FIX

### EC-1: EXPLAIN with a bound `$param` LIKE pattern may produce a generic plan → no `Index Cond` → false-fail
- **Affected task:** T1.1 (the behavioral EXPLAIN test)
- **Family:** Format / Timing (query-planning)
- **Scenario:** Postgres can only rewrite `LIKE` into an index range scan (`col ~>=~ 'alice:' AND col ~<~ 'alice;'`) when the pattern is a **constant known at plan time** — it must SEE the prefix to compute the range bounds. If the EXPLAIN is written as `EXPLAIN ... agent_id LIKE $2` with the pattern passed as a bind parameter, and Postgres builds a GENERIC plan (pattern unknown), the LIKE degrades to a post-scan `Filter` and the `Index Cond` assertion FALSE-FAILS — even though the index is correct and production works.
- **Impact:** the GOAL test red-fails on a test artifact (generic plan), blocking the cycle despite a correct index. Rework / debugging the planner instead of the code.
- **Suggested fix:** in the EXPLAIN test, interpolate the prefix as a **LITERAL** constant (controlled test value, no injection risk): `EXPLAIN SELECT id FROM memories WHERE t_invalid IS NULL AND kind='skill' AND workspace_id='default' AND agent_id LIKE 'alice:%'` — so the planner deterministically sees the constant prefix and emits the `Index Cond`. (The `workspace_id`/`kind` constants likewise as literals.) Keep `SET enable_seqscan = off`.

## SHOULD TEST

### EC-2: planner may choose a Bitmap Index Scan rather than a plain Index Scan
- **Affected task:** T1.1
- **Suggested test:** assert on `/Index Cond/` + the index NAME substring (`idx_memories_skill_subject_prefix`) — NOT on a specific scan-node string like `Index Scan using`. Both `Index Scan using idx_...` and `Bitmap Index Scan on idx_...` carry an `Index Cond`; asserting the node type would be brittle. (Already the plan's intent — this confirms the assertion must stay scan-type-agnostic.)

## DOCUMENT

### EC-3: `pg_indexes.indexdef` opclass visibility + `enable_seqscan=off` obviates `ANALYZE`
- **Accepted risk / fact:** `pg_indexes.indexdef` reconstructs the CREATE INDEX and DOES include a NON-default opclass verbatim (`agent_id text_pattern_ops`) — so the structural assertion is valid and collation-independent (it inspects the shipped artifact, not the plan). And because the behavioral test forces `enable_seqscan=off`, the planner is steered regardless of (stale) row estimates, so no `ANALYZE` of the freshly-seeded table is needed for determinism.

### EC-4: production query benefits because node-postgres uses UNNAMED prepared statements (custom plan per call)
- **Accepted risk / fact:** `listSkillsBySubject` calls `this.pool.query(sql, params)` — node-postgres sends this as an UNNAMED extended-protocol statement, which Postgres plans FRESH each execution with the actual parameter value bound (a custom plan). The actual `'{subject}:%'` value is therefore known at plan time on every call → the LIKE is rewritten to an index range → the new index IS used in production. The generic-plan-ignores-LIKE pitfall only afflicts NAMED prepared statements promoted to a generic plan after ≥5 executions (not used here). This is WHY the index closes SEC-1 in production, not only in the literal-pattern test. Worth one sentence in the plan's glossary/notes.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 4 | 1 | 1 | 2 |
| T1.2 | 0 | 0 | 0 | 0 |
| T1.3 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1 (literal-pattern EXPLAIN) into T1.1 TDD; EC-4 as a one-line note. EC-2/EC-3 confirm existing intent. No new tasks, no scope change.
