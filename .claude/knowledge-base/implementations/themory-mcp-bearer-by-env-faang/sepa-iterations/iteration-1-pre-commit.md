# SEPA — Iteration 1 / Task T1.1 + T1.2 / Phase Pre-COMMIT

## Plan recap
- T1.1: 4 RED integration tests + EC-1 absorption (5th test for whitespace-only)
- T1.2: 1 regression-guard test for ADR D1 Tier-1 (--transport=stdio wins over env)
- Both in same NEW file `tests/integration/agent-tools/env-driven-transport-selection.test.ts` (175 lines)

## Findings

- **[CRITICAL]** Plan ↔ test-output mismatch: Plan T1.1 AC declared "All 4 tests FAIL" but empirical run shows 2 FAIL (load-bearing contract) + 4 PASS (regression-preservation invariants for stdio-default + empty-string + whitespace + flag-precedence). The 4 PASS tests are legitimate invariant guards — they lock current behavior so T2.x cannot regress it. This shape IS TDD-compliant; the plan AC text is stale relative to EC-1 absorption in plan v1.1. MUST disclose in commit body OR amend plan AC. Honest disclosure > false PASS.

- **[CRITICAL]** Test count mismatch: file has 6 it() blocks (5 T1.1 + 1 T1.2), plan declared 5 total. Extra one is the EC-1 whitespace test correctly inferred from v1.1 absorption but plan T1.1 Tasks line never updated from "4 assertions" → "5". Disclose + add followup to amend plan.

- **[MAJOR]** Conventional commit scope `(mcp)` acceptable. `(T1.1+T1.2)` multi-task ID matches cycle convention.
- **[MAJOR]** Plan T1.2 DoD satisfied — regression-guard comment present at lines 152-154.
- **[MAJOR]** Inquebrável Rule 9 cleared — zero paper-name hits (grepped Stripe/Vercel/Mem0/Letta/LangMem/MemGPT/Voyager/Honcho/Cognee/Graphiti/CoALA/ProcMEM).
- **[MAJOR]** Pre-RED absorptions present: vi.mock module-mock pattern, vi.stubEnv discipline beforeEach + unstubAllEnvs afterEach, EC-1 whitespace test added.
- **[MAJOR]** File size 175 LoC, under 200-LoC plan budget.
- **[MAJOR]** PRIORITY 0 rationale (a)-(d) must appear in commit body — main session enforces.
- **[MAJOR]** Wiring triad sanity: pillar (a) N/A (RED-only, deferred to T2.x); pillar (b) self (this IS the integration test); pillar (c) N/A (no metrics declared).

- **[MINOR]** Test isolation: doesn't stub THEOMEM_HTTP_PORT/HOST but mocks short-circuit before bind. Not flaky-causing. Cleanup candidate in T4.x or follow-up.
- **[MINOR]** `void Pool;` workaround at file foot — code smell. Acceptable RED-phase; cleanup in T2.x REFACTOR or follow-up.

- **[INFO]** No Co-Authored-By trailer in proposed message subject.
- **[INFO]** RED-phase honesty: VALID TDD SHAPE. 2 FAILs are load-bearing contract; 4 PASSes are regression-preservation invariants. Plan AC text is stale; code is correct.

## Recommended action

1. PROCEED WITH COMMIT with body including:
   - `## TDD shape (honest disclosure)` section explaining the 2 FAIL + 4 PASS shape and why it's TDD-compliant
   - Both T1.1 and T1.2 references
   - PRIORITY 0 hardening boilerplate verbatim
   - NO Co-Authored-By trailer

2. LOG FOLLOWUP to amend plan T1.1 § Tasks + § AC for stale text (not blocking this commit).

3. DO NOT amend plan in this commit — atomicity discipline.

VERDICT: APPROVED for proceeding conditional on (1).
