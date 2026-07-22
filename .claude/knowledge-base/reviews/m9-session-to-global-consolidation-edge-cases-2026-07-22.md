# Discover Edge Case Review — M9 session→global consolidation

Date: 2026-07-22
Discovery plan analyzed: `.claude/knowledge-base/discoveries/plans/m9-session-to-global-consolidation-plan.md`
Research questions analyzed: 6
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 3, DOCUMENT: 1)

The plan is structurally sound (SHIPPABLE_WITH_CAVEATS; zero fabricated citations; 4 corners covered). The edge cases below are about the *interpretation* the execute phase must get right — they are halt-loop checkpoints, not plan rewrites.

## SHOULD TEST (halt-loop checkpoints for /discover-execute)

### EC-1: mem0 consolidates per-write, NOT at session-end — do not mis-map the TRIGGER
- **Affected question:** Q1
- **Scenario:** mem0's ADD/UPDATE/DELETE decision fires on every `add()` (per-write, against the semantically-related subset), NOT as a session-boundary batch. M9's trigger is a session-boundary / `reflect` promotion. If the blueprint copies mem0's per-write trigger verbatim, it mis-frames M9.
- **Checkpoint:** the execute answer for Q1 MUST distinguish mem0's *decision algorithm* (ADD/UPDATE/DELETE/NONE — reusable) from its *trigger timing* (per-write — NOT what M9 wants). M9's trigger is theo-memory's shipped `ReflectionPolicy` (boundary/threshold/sleep-time), not mem0's per-write hook.

### EC-2: graphiti is graph-DB-native (Neo4j/Cypher) — extract the ALGORITHM, not the storage
- **Affected question:** Q2, Q4
- **Scenario:** graphiti's `resolve_edge_contradictions` + real-DB test harness are Neo4j/FalkorDB-based. theo-memory is Postgres-relational (Item 14 graph backend declined). Copying graphiti's storage/query shape would violate the locked "no graph DB" decision.
- **Checkpoint:** the execute answer for Q2/Q4 MUST extract the *temporal supersession algorithm* (valid_at/invalid_at on contradiction) and map it onto theo-memory's SHIPPED bi-temporal `t_valid`/`t_invalid` + `createIsolatedDb` pgvector harness — never propose a graph store.

### EC-3: the confirmation-count≥3 threshold may be theo-memory's OWN, not mem0/graphiti's
- **Affected question:** Q1, Q3
- **Scenario:** the M9 DoD promotion rule (`confirmation_count ≥ 3 OR LLM-judged OR agent-marked`) may not have a 1:1 analog in mem0/graphiti (mem0 uses the LLM UPDATE decision; graphiti uses dedup). If neither uses a count threshold, the blueprint must ground the threshold in theo-memory's OWN Princípio 1 (`confirmation_count`), not fabricate a reference for it.
- **Checkpoint:** if Q1/Q3 find no count-threshold analog, the blueprint states that honestly and grounds the `≥3` rule in `theo-memory/CLAUDE.md § Princípio 1` + the shipped `confirmation_count` column — an internal design choice, not a copied pattern.

## DOCUMENT (accepted)

### EC-4: ai-memory (the ROADMAP's cited pattern source) is not cloned
- **Accepted risk:** ADR D2 already handles this — ai-memory is cited conceptually only; the promotion pattern is grounded in mem0/graphiti (both cloned) + the internal machinery. No question targets ai-memory, so no fabricated citation. The execute phase does NOT attempt to read ai-memory.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|
| Q1 | 2 | 0 | 2 (EC-1, EC-3) | 0 |
| Q2 | 1 | 0 | 1 (EC-2) | 0 |
| Q3 | 1 | 0 | 1 (EC-3) | 0 |
| Q4 | 1 | 0 | 1 (EC-2) | 0 |
| Q5 | 0 | 0 | 0 | 0 |
| Q6 | 0 | 0 | 0 | 0 |
| (global) | 1 | 0 | 0 | 1 (EC-4) |

**Verdict:** DISCOVERY PLAN OK — no MUST FIX. The 3 SHOULD-TEST edge cases are absorbed as halt-loop checkpoints for `/discover-execute` (extract algorithm/decision, not trigger-timing/storage; ground the count threshold in Princípio 1 if no reference analog). Proceed to `/discover-execute`.
