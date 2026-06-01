---
name: implement-f-t4-1-2-eviction-race-debug-sepa-knowledge
description: Paired knowledge skill for SEPA agent on /implement halt-loop for plan f-t4-1-2-eviction-race-debug. Invoke when SEPA needs to cite (a) Postgres race-condition debug patterns, (b) Promise.all concurrency analysis idioms, (c) pgvector + advisory-lock interaction semantics, (d) eviction-pipeline composition correctness, (e) hotfix-lift atomicity patterns, or (f) cross-reference grep on plan/ADRs/EC absorption. WebSearch enabled for canonical race-debug references (postgres.org docs, postgresql wiki, martinfowler.com on concurrency, kerl.org pg notes).
allowed-tools: Read, Glob, Grep, WebSearch, WebFetch
model: opus
---

# Knowledge librarian — SEPA paired skill for f-t4-1-2-eviction-race-debug

## Plan goal (verbatim)

> Reproduce + root-cause + fix the F-T4.1-2 eviction race condition (`Promise.all([userScoped.remember, sessionScoped.remember])` with `createLocalMemory({ eviction })` enabled causes user-scope rows to be lost / `user_id = NULL`), measured by the new integration test passing AGAINST eviction-enabled config + `/test-chat-with-memory` Group B returning verdict `READY 33/33` after the hotfix `b2909ff` is lifted.

## ADR summary

| ID | Decision |
|---|---|
| D1 | Test path `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` (exact ADR-DEFER landing site from PR #25) |
| D2 | SDK-only reproduction FIRST; demo-path fallback only if SDK PASSes |
| D3 | Fix at shallowest layer that reproduces |
| D4 | Hotfix lift = separate atomic commit AFTER GREEN |
| D5 | `/test-chat-with-memory` re-run = closure gate |
| D6 | Zero new npm deps (Rule 9) |

## EC absorptions (7 ECs)

- EC-1 MUST FIX: T1.1 RED loops 20× to maximize race-condition reproduction probability
- EC-2: beforeEach TRUNCATE + per-trial fresh state
- EC-3: all SELECT queries guard `WHERE t_invalid IS NULL` (v0-4b T7.1 BREAKING)
- EC-4: optional `dumpPgLocks(pool)` diagnostic helper for post-mortem
- EC-5: hotfix mid-cycle lift may cause demo regression visible to users — ATOMIC commit mitigates
- EC-6: T1.1 may PASS (no SDK reproduction) → T1.2 mandatory then; bisection design
- EC-7: Chrome MCP lock (F-T4.1-1) may block T3.2 → surface honestly

## Project rules

- `architecture.md § 3 DIP`, `§ 7 Module hygiene` (no `any`, no `console.log` in production)
- `testing.md § Pyramid` (this is integration tier), `§ Determinism` (use deterministic stubs)
- `cycle-implement.md § Hard gates` (wiring triad)
- `cycle-review.md § Hard gates` (no plan drift; commit-body invariants)
- `no-paper-names-in-code.md`
- `dogfood-golden-rule.md` (vocab lock)

## Domain keywords for WebSearch

- PostgreSQL concurrent INSERT race, pg advisory lock pattern
- Node Promise.all sequential vs parallel awaiting semantics
- pgvector vector(N) column NaN/NULL rejection
- SQL UPDATE WHERE race conditions in capacity-trigger eviction
- Deterministic-seed integration testing for race conditions

## Critical surfaces

1. **Race-condition flakiness signal** — if test passes 17/20 trials post-fix, the fix is incomplete
2. **`src/local/eviction/capacity-based-trigger.ts:CapacityBasedTrigger.fire(scope, now)`** invoked as postRememberHook
3. **`src/local/eviction/scope-where.ts:advisoryLockKey(scope)`** kind-namespaced lock keys (v0.4b-fixes T3.1 EC-5)
4. **The two HYPOTHESES** (per plan § The HYPOTHESIS):
   - Hypothesis 4: scope-where leakage during concurrent INSERT marks wrong rows
   - Hypothesis 5: demo `resolveEviction` mutates shared factory state
   - Hypothesis 6: advisory-lock key collision

## Cost budget

- Mode A (plan recap): ~500 tokens/call
- Mode B (WebSearch refresh): ~3k tokens; used 0-2× cycle (race-debug patterns relatively well-known)
- Mode C (cross-reference grep): ~500 tokens
- Net SEPA via this skill: ~25k tokens/cycle
