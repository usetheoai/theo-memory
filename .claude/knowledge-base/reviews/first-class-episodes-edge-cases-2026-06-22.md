# Discover Edge Case Review — first-class-episodes

Date: 2026-06-22
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/first-class-episodes-plan.md
Research questions analyzed: 6 (Q1-Q6)
Edge cases found: 3 (MUST FIX: 1, SHOULD TEST: 1, DOCUMENT: 1)

## MUST FIX

### EC-1: Q6 is a 4th `techniques` question → violates max-3-per-corner (discover-plan-confidence hard cap)
- **Affected question:** Q6 (mem0 negative comparison)
- **Family:** Coverage / Budget
- **Scenario:** `discover-plan-confidence`'s `check_plan_completeness` enforces ≤ 3 questions per corner. The plan maps Q1, Q2, Q3, AND Q6 to `techniques` (4) → fires `question_budget_violated` → caps the verdict at 70 (SHIPPABLE_WITH_CAVEATS at most), even though the plan is otherwise sound. The plan already self-notes this risk but does not fix it.
- **Impact:** the plan-gate caps below SHIPPABLE for a structural budget reason, not a substance one.
- **Suggested fix:** FOLD Q6 into Q3's Fase B as a sub-bullet ("…and confirm via grep that mem0 has NO episodic/message-log equivalent — negative evidence"), reducing `techniques` to exactly 3 (Q1, Q2, Q3). Net questions = 5 (Q1-Q3 techniques + Q4 tests + Q5 deps) + tools DEFER-CORNER.

## SHOULD TEST

### EC-2: Q2 assumes `schemas/message.py` carries the scope/group key
- **Affected question:** Q2 (episode boundary / grouping key)
- **Suggested halt-loop checkpoint:** before mapping Letta's grouping key → our `session_id`, confirm `schemas/message.py` actually declares the scope field(s) (`agent_id`/`run_id`/`group_id`); if the grouping lives in the manager's query filters instead of the schema, read `message_manager.py`'s list filter args as the authoritative source. Do not assert a mapping from an absent field.

## DOCUMENT

### EC-3: Letta's `message_manager` (temporal log) ≠ `passage_manager` (semantic archival) — Q3 must not conflate them
- **Accepted risk:** Letta has TWO distinct tiers — the temporal MESSAGE log (`message_manager.py`, cursor list) and the SEMANTIC archival PASSAGE tier (`passage_manager.py`, embedding search). M2's "episodic / message-log tier" maps to the TEMPORAL message log (list + scope + asOf), NOT a new semantic tier (TheMemory already has semantic `recall()`). Q3's job is to determine whether episode-scoped recall needs ANY embedding search at all, or is a pure temporal/bi-temporal list over our existing substrate. The blueprint MUST keep these separate so the implementation plan does not accidentally propose a second vector store (which would violate the roadmap's "no new storage engine" constraint). Recording as an explicit framing constraint for `/discover-execute`.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|
| Q1 | 0 | 0 | 0 | 0 |
| Q2 | 1 | 0 | 1 (EC-2) | 0 |
| Q3 | 1 | 0 | 0 | 1 (EC-3) |
| Q6 | 1 | 1 (EC-1) | 0 | 0 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (1 MUST FIX — fold Q6 into Q3 to satisfy the ≤3-per-corner budget; absorb EC-2 checkpoint + EC-3 framing note into v1.1, then /discover-plan-confidence).
