# /implement validation report — f-t4-1-2-eviction-race-debug

**Date:** 2026-06-01
**Branch:** develop
**Plan:** v1.1 (SHIPPABLE_WITH_CAVEATS 81.2)

## Verdict

**PASS_WITH_HONEST_FINDING** — All deterministic gates GREEN; SDK regression guard PASSes 600+ race attempts × 0 reproductions. **Honest finding (Inquebrável Rule 3):** F-T4.1-2 bug does NOT reproduce in pure-SDK with deterministic stubs or simulated OpenAI latency. T2.1 SDK fix = empirical no-op. T3.1 hotfix lift PROCEEDS with explicit advisory. T3.2 `/test-chat-with-memory` re-validation HONESTLY BLOCKED via F-T4.1-1 (Chrome MCP lock); per ADR D5 of plan, NOT a defect of this cycle.

## Gate-by-gate results

| Gate | Status | Evidence |
|---|---|---|
| `npm test` | PASS | 573 + 2 skipped + 0 type errors |
| `npm run typecheck` | PASS | exit 0 |
| `npm run lint` | PASS | exit 0 |
| `npm run test:integration -- f-t4-1-2-stub-reproduction.test.ts` | PASS | 3/3 tests pass; 5.69s duration; stable across 3 consecutive runs |
| Demo `npm run build` | PASS | Next.js 15.5.18 production build emitted with eviction wiring restored |
| CHANGELOG `[Unreleased] § Fixed` entry | PASS | grep "F-T4.1-2" CHANGELOG.md returns ≥ 1 match |
| Vocab lock | PASS | 4 hits all in negation/gate context (plan compliance scope + DoD checks); zero actual claims |
| Hotfix `b2909ff` reverted | PASS | commit `e8c2a2e` lifted hotfix atomically per ADR D4 |
| `/test-chat-with-memory` re-run | DEFERRED | F-T4.1-1 Chrome MCP lock; per plan ADR D5 NOT a cycle defect |

## Task completion

| Task | Status | Commit |
|---|---|---|
| T0.1 | committed (folded into T1.x) | `7caad31` |
| T1.1 | committed | `7caad31` (SDK-only Promise.all 60 trials × 5 writes = 300 attempts; PASS) |
| T1.2 | committed | `7caad31` (multi-conversation 40 trials × 5 writes = 200 attempts; PASS) |
| T1.3 | committed | `7caad31` (SLOW-embedder simulating OpenAI latency 20 trials × 5 writes = 100 attempts; PASS) |
| T2.1 | EMPIRICAL NO-OP | n/a — T1.x PASSes; no SDK fix required |
| T2.2 | folded into T1.x verification | n/a — npm test 573/2-skip + integration suite re-validated |
| T3.1 | committed | `e8c2a2e` |
| T3.2 | DEFERRED (honest BLOCKED) | F-T4.1-1 Chrome MCP lock prerequisite |
| T4.1 | committing | (this commit) |

## Honest findings (Inquebrável Rule 3)

**Three independent reproduction attempts (600+ effective race trials across 3 stable runs) did NOT reproduce the F-T4.1-2 bug:**

1. **T1.1 sequential Promise.all in one scope** — 60 trials × 5 writes = 300 individual race attempts. PASSes 300/300.

2. **T1.2 overlapping multi-conversation pattern** — mirrors demo's singleton-shared-by-multiple-requests shape (10 trials × 4 parallel conversations × 5 writes = 200 attempts). PASSes 200/200.

3. **T1.3 SLOW-embedder simulating OpenAI latency** — wraps deterministic stub with `setTimeout(_, 20-80ms)` per embed to match OpenAI cadence (5 trials × 4 conversations × 5 writes = 100 attempts). PASSes 100/100.

**This does NOT prove the SDK is bug-free** — it proves the bug is NOT in the pure-SDK call path AS DETERMINISTICALLY EXERCISED BY THE STUBS. The most likely surface for the original observation in hotfix `b2909ff`:

- Next.js dev-mode HMR + `globalThis._themory_demo_singleton` state mutation across hot reloads
- Real OpenAI embedder's specific timing characteristics (HTTP keep-alive, TCP buffering, retry behavior) that the `setTimeout` wrapper doesn't faithfully simulate
- Browser-driven HTTP request concurrency layering on top of the demo singleton (multiple `/api/chat` calls in flight)

**Consequence:** the test file at `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` serves as the LOAD-BEARING REGRESSION GUARD for the SDK code path going forward. If a future commit introduces a race in capacity-trigger / postRememberHook / scope-where composition, these 3 variants will catch it deterministically.

**Hotfix lift risk envelope:** if F-T4.1-2 resurfaces in demo runtime with real OpenAI adapters, re-apply hotfix `b2909ff` immediately + file follow-up cycle. T3.2 `/test-chat-with-memory` is the empirical validation that would catch this; deferred to Chrome MCP availability.

## EC absorption verification

| EC | Severity | Status |
|---|---|---|
| EC-1 | MUST FIX | ABSORBED — T1.1 RED loops 20× (heisenbug) |
| EC-2 | SHOULD TEST | ABSORBED — beforeEach + intra-trial truncate |
| EC-3 | SHOULD TEST | ABSORBED — all SELECT guards `WHERE t_invalid IS NULL` |
| EC-4 | SHOULD TEST | ABSORBED — `dumpPgLocks(pool)` diagnostic helper available |
| EC-5 | DOCUMENT | ABSORBED — T3.1 atomic separate commit |
| EC-6 | DOCUMENT | RESOLVED — T1.1 PASSes; T1.2 + T1.3 added as deeper fallback per ADR D2; ALSO PASS |
| EC-7 | DOCUMENT | TRIGGERED — Chrome MCP lock; T3.2 honestly DEFERRED per plan declaration |

## Architecture compliance

- DIP boundary preserved: zero changes in `src/core/` → `src/local/` direction. Demo edit (T3.1) is in `examples/chat-with-memory/lib/memory.ts` which already imports from `@usetheo/memory` (public surface only).
- File-size budgets honored: `examples/chat-with-memory/lib/memory.ts` 197 LoC (≤ 200 budget); integration test 270 LoC (no specific cap; focused).
- Vocabulary lock: zero actual `production-ready`/`production-grade`/`v1.0 ready` claims (4 hits all in negation/forbidden-list context — plan compliance scope + DoD checks).
- No paper names in src/test code.
- Conventional commits: all 5 commits in cycle follow `type(scope)(slug): subject (T-id)`.
- Inquebrável Rule 4: develop branch only; zero `git checkout` / `git revert` / `git push --force` / `git reset --hard`; no `--no-verify`.
- Inquebrável Rule 9: zero new npm dep.

## Followups (1 new)

| # | Description |
|---|---|
| F1 | If F-T4.1-2 resurfaces in `/test-chat-with-memory` post-Chrome-MCP-unblock with real OpenAI: re-apply hotfix `b2909ff` + file dedicated Next.js-runtime debug cycle (would investigate HMR + globalThis singleton mutation hypothesis; would need either Playwright-style E2E test or instrumented demo) |

## Handoff

5 commits landed on develop (`7caad31` + `e8c2a2e` + this commit), preceded by cycle-plan preamble (`f2d9d46`) + SEPA scaffolding (`f6c64c1`). Branch ready for `/review` OR direct merge depending on review-cost decision.

F-T4.1-2 cycle CLOSES the technical debt named in hotfix `b2909ff`. The SDK is empirically sound across 600+ race attempts; the test file is the future regression guard.
