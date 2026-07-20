# Implementation Validation: explainable-recall

**Date:** 2026-07-20
**Overall:** FAIL
**Total checks:** 11 (PASS: 4, FAIL: 4, SKIP: 2)

## Checks

### progress_schema — `PASS`


### checkpoint_consistency — `PASS`


### npm test — `FAIL`


```
...; updatedAt ExtraConfigColumn<...>; }'.
 ❯ packages/core/src/infrastructure/db/schema.ts:255:26
    253|     index('idx_memories_user_attributed_to')
    254|       .on(table.userId, table.attributedTo)
    255|       .where(sql`${table.attributedTo} IS NOT NULL`),
       |                          ^
    256|     // skills-subject-prefix-index M2 / SEC-1 — partial composite supp…
    257|     // cross-repo skills listing's `agent_id LIKE '{subject}:%'` prefi…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯


```

### npm run typecheck — `FAIL`


```

```

### npm run lint — `FAIL`


```

```

### coverage — `SKIP`

- Reason: no 'test:coverage' script in package.json

### wiring_triad — `PASS`

- Total tasks: 5
- Verification: independent recheck of `check_wiring.py`
- Symbols derived from diff: 59
- Symbols independently resolved: 54
- Pillar (a) fails (uncalled symbols): 0
- Self-reported pillar (a) pass (claim, audited): 4

### acceptance_criteria — `FAIL`

- [HIGH] file_size_exceeded: `packages/core/src/domain/errors.ts` has 554 lines, exceeding the plan's <= 500-line acceptance criterion.
- [HIGH] file_size_exceeded: `packages/core/src/infrastructure/db/schema.ts` has 726 lines, exceeding the plan's <= 500-line acceptance criterion.
- [HIGH] file_size_exceeded: `CHANGELOG.md` has 778 lines, exceeding the plan's <= 500-line acceptance criterion.
- [HIGH] file_size_exceeded: `packages/core/src/domain/retrieval/pipeline.ts` has 661 lines, exceeding the plan's <= 500-line acceptance criterion.
- [HIGH] file_size_exceeded: `packages/core/src/infrastructure/db/scoped-memory.ts` has 593 lines, exceeding the plan's <= 500-line acceptance criterion.
- [LOW] criterion_requires_human_evidence: 16 acceptance criterion(s) cannot be machine-verified and need explicit evidence in review (not a silently-ticked box): `recall_traces` created idempotently; re-running migrations is a no-op; Indexes on `recall_id` and `(workspace_id, created_at)` present; `record`→`getByRecallId` round-trip preserves breakdown + drop-reason + null composite; `maxRowsPerRecall` cap enforced

### test_obligations — `PASS`


### patterns_consumption — `N/A`

- Reason: plan cites no *-patterns skill

### code_quality — `SKIP`

- Reason: /code-quality script unavailable or invocation failed

## Handoff decision

Implementation FAILS at least one gate. Loop back to /implement to address.
