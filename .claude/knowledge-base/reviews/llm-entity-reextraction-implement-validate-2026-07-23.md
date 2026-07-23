# Implementation Validation: llm-entity-reextraction

**Date:** 2026-07-23
**Overall:** FAIL
**Total checks:** 11 (PASS: 7, FAIL: 1, SKIP: 1)

## Checks

### progress_schema — `PASS`


### checkpoint_consistency — `PASS`


### npm test — `FAIL`


```
45 values (44 prior + entity_gc_collected, #110)
AssertionError: expected [ 'extraction_started', …(46) ] to have a length of 45 but got 47

- Expected
+ Received

- 45
+ 47

 ❯ packages/core/src/domain/memory-event.test.ts:12:27
     10| describe('MEMORY_EVENTS', () => {
     11|   test('has 45 values (44 prior + entity_gc_collected, #110)', () => {
     12|     expect(MEMORY_EVENTS).toHaveLength(45);
       |                           ^
     13|   });
     14|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[41/41]⎯


```

### npm run typecheck — `PASS`


### npm run lint — `PASS`


### coverage — `SKIP`

- Reason: no 'test:coverage' script in package.json

### wiring_triad — `PASS`

- Total tasks: 6
- Verification: independent recheck of `check_wiring.py`
- Symbols derived from diff: 128
- Symbols independently resolved: 101
- Pillar (a) fails (uncalled symbols): 0
- Self-reported pillar (a) pass (claim, audited): 0

### acceptance_criteria — `WARN`

- [LOW] criterion_requires_human_evidence: 2 acceptance criterion(s) cannot be machine-verified and need explicit evidence in review (not a silently-ticked box): `python3 .claude/skills/implement/scripts/run_validation.py llm-entity-reextraction` exit 0 (inclui /code-quality ∉ {FAIL_HARD, INVALID}).; Benchmark T4.1: as 2 queries canônicas re-executadas retornam `all_caps_tokens <= 10` E `very_short_names <= 10` (conjunto não-supersedido) E `memories_without_graph` elegíveis = 0; relatório commitado em `knowledge-base/audits/m13-entity-noise-post-backfill-*.md`.

### test_obligations — `PASS`


### patterns_consumption — `N/A`

- Reason: plan cites no *-patterns skill

### code_quality — `PASS`


## Handoff decision

Implementation FAILS at least one gate. Loop back to /implement to address.
