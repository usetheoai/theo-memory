# Discover Edge Case Review — dashboard-phase2-skills-bitemporal-attribution

Date: 2026-06-19
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/dashboard-phase2-skills-bitemporal-attribution-plan.md
Research questions analyzed: 7
Edge cases found: 6 (MUST FIX: 0, SHOULD TEST: 4, DOCUMENT: 2)

All 23 cited `.claude/knowledge-base/references/` paths were verified to resolve (Glob/ls). All load-bearing premises were spot-checked: mem0 `add()` exists (main.py:573 sync, :2003 async) with `agent_id`/`run_id`/`actor_id` params (utils.py:233-236, hashed at :210-213); mem0 `history()` exists (main.py:1573, :2985); letta `tool_manager.py` has 15 CRUD `def`s; letta passages carry `created_at` (passage_manager.py:176+); mem0 storage history tests exist (test_storage.py:71+); letta e2b/modal are OPTIONAL extras (pyproject.toml:132-133). **No fabricated citation, no unanswerable question, no missing path → no MUST FIX.**

## MUST FIX

(none — the plan is structurally sound and every premise verified)

## SHOULD TEST

### EC-2: Q1 Fase B can blow budget reading all 15 `tool_manager` methods
- **Affected question:** Q1
- **Suggested halt-loop checkpoint:** Cap Q1 Fase B to the identity/create/list-bearing methods (the ones relevant to a dashboard BROWSE surface — create, list/get, and the hash/name identity path in `ast_parsers.py`). Do NOT read update/delete/execute/count internals — they belong to Q4 (tests) / Q6 (deps), not Q1.

### EC-3: Q3 attribution contract lives in a HELPER, not in `add()` itself
- **Affected question:** Q3
- **Suggested halt-loop checkpoint:** Q3 Fase B MUST read the actor-handling helper (`mem0/mem0/memory/utils.py` around the `ENTITY_PARAMS`/encoded-ids block at :100/:210), not only the two `add()` bodies (main.py:573/:2003). The where-stored/where-validated answer is in the helper; reading `add()` alone returns an incomplete contract.

### EC-5: Q1 scope creep into the Letta agent-loop / tool_executor / tool_sandbox
- **Affected question:** Q1 (and the techniques corner generally)
- **Suggested halt-loop checkpoint:** Q1 is `tool_manager` + `functions/` ONLY (modeling/identity/persistence). `tool_executor/` and `tool_sandbox/` are consulted ONLY by Q6 (deps). If Q1 Fase A starts surfacing executor/sandbox hotspots, stop — that is Q6's territory; prevents the "how skills work" question ballooning into the whole execution subsystem.

### EC-6: Q2 spans 4 files across 2 projects — heaviest single question
- **Affected question:** Q2
- **Suggested halt-loop checkpoint:** Timebox Q2 within the Mem0 budget for the Mem0 half (history) and the Letta budget for the Letta half (passages/archive). If the Letta archive half exceeds budget, mark the Letta-temporal sub-answer BLOCKED "budget exhausted" and keep the Mem0 history answer (the load-bearing one for our `t_valid/t_invalid` mapping) — do NOT drop both.

## DOCUMENT

### EC-1: `asOf` is ALREADY in the REST surface — the gap is wiring, not a new endpoint
- **Accepted risk / refinement:** the plan's Context flagged "no REST `asOf` parameter on `POST /v1/recall` today (verify)". Verified: `RecallBody.asOf` EXISTS at `packages/api/src/server/schemas.ts:72` (`z.string().datetime().optional()`). So the bi-temporal gap is purely **gateway client (`recallRequest`/`RecallOptions` lack `asOf`) + dashboard wiring** — NOT a missing TheMemory endpoint. The Q2 research (how Mem0/Letta model temporal) stays valid as design input, but the blueprint's asOf recommendation should state "wiring-only, REST already accepts it" per ADR D3's REST-gap framing. (Skill-scope `asOf` remains deferred per EC-9 of v1.1.)

### EC-4: read-only skills browser needs ZERO sandbox deps — already evidenced
- **Accepted risk:** Q6's "lightest read-only path" verdict is already supported — Letta's execution deps (`e2b-code-interpreter`, `modal`) are OPTIONAL pyproject extras (pyproject.toml:132-133), not core. A dashboard skills BROWSE surface (list/inspect, no execution) inherits none of them. Low risk; Q6 confirms rather than discovers. Keep as a fast confirmation, not a deep dive.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 2 | 0 | 2 (EC-2, EC-5) | 0 |
| Q2 | 2 | 0 | 1 (EC-6) | 1 (EC-1) |
| Q3 | 1 | 0 | 1 (EC-3) | 0 |
| Q4 | 0 | 0 | 0 | 0 |
| Q5 | 0 | 0 | 0 | 0 |
| Q6 | 1 | 0 | 0 | 1 (EC-4) |
| Q7 | 0 | 0 | 0 | 0 |

**Verdict:** DISCOVERY PLAN OK

The plan is execution-ready. The 4 SHOULD TEST items are Fase-B scoping/budget guards (absorb into the plan's Halt-loop Checkpoints to keep `/discover-execute` from over-reading the large Letta tool subsystem); the 2 DOCUMENT items refine the blueprint's expected answers (asOf = wiring-only; read-only skills = zero sandbox deps). No MUST FIX → no blocking rewrite required.
