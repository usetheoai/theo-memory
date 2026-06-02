# Implementation contract — v0-8-fixes-cycle-1

**Plan:** `.claude/knowledge-base/plans/v0-8-fixes-cycle-1-plan.md` v1.3
**Verdict:** SHIPPABLE_WITH_CAVEATS 72.4 (M2 deterministic; PROVISIONAL_v1 calibration)
**Started:** 2026-06-02
**Branch:** develop
**Started HEAD:** 8d00aa4 (cycle-plan artifacts commit)
**Max iterations:** 50
**Time budget:** 8h

## Pre-condition audit (Step 1)

- [x] Plan exists at the declared path
- [x] Branch `develop` (not `main`)
- [x] Tree clean post `8d00aa4` commit
- [x] npm 11.12.1 available
- [x] package.json present
- [x] Node v20.19.2 satisfies `engines.node = >=20.0.0`
- [x] Plan verdict ≥ SHIPPABLE_WITH_CAVEATS (72.4)
- [x] SEPA agent + paired knowledge skill spawned (Step 2.5)
- [x] Halt-loop driver written

## Task list (ordered per dep graph + SEPA knowledge skill recommendation)

| Order | Task ID | Status | Depends on | Summary | Acceptance gate |
|---|---|---|---|---|---|
| 1 | T0.1 | pending | — | BLOCKER fix — Drift-T1.1-1 deferral (replace `bleu.ts` with `BleuMetricUnavailable` throw stub; drop `PerQueryRecord.bleu`; remove BLEU from runner pipeline; rewrite bleu.test.ts as 1 unconditional throw test) | `npm test -- src/benchmarks/metrics/__tests__/bleu.test.ts` 0 skipped; throw asserted |
| 2 | T1.1 | pending | T0.1 | Integration test reset() column repair (agent_id → user_id) + 2-block isolation regression test | `tests/integration/benchmarks/themory-adapter-pg.test.ts` 2 it() blocks pass clean |
| 3 | T2.1 | pending | — | Move `process.exitCode = 1` from library to CLI; 3 run-*.ts gain `.then((r) => process.exit(r.aborted ? 1 : 0))` | grep `src/benchmarks/` zero `process.exitCode =` matches |
| 4 | T2.2 | pending | — | result-aggregator.ts JSDoc honesty + per-question span attrs `latencyMs ?? 0` + `modelUsed ?? 'unknown'` (EC-8 coalesce) | span attribute test asserts both fields present |
| 5 | T3.1 | pending | — | Promote Tokenizer to 11th DIP (`src/core/dip/tokenizer.ts`); update 10 import paths; extend public-paths.test.ts (EC-3 + EC-9); EC-10 scopedUserId regression | Tokenizer importable from `@usetheo/memory` AND `@usetheo/memory/contract`; 10 import paths updated |
| 6 | T3.2 | pending | — | Extract `benchmarks/scripts/_runner-scaffold.ts` from 3 run-*.ts; extend eslint.config.ts glob to `benchmarks/scripts/**/*.ts` (EC-4) | 3 run-*.ts each ≤ 80 LoC; scaffold linted |
| 7 | T1.2 | pending | T3.2 | Smoke judge panel parameterization in scaffold; EC-6 cycling modulo length contract; smoke e2e asserts WRONG path | 3 RED tests pass (smoke WRONG + cycling contract) |
| 8 | T1.3 | pending | — | Downloader RED tests (EC-6+EC-8); fetch cleanup via vi.unstubAllGlobals (EC-7); vitest contract glob extension; config-parity sentinel verified (EC-5) | 3 downloader tests pass; config-parity sentinel green |
| 9 | T4.1 | pending | T0.1, T2.1, T3.1, T3.2 | NEW sibling drift-trail file (Drift-T1.1-1/T2.1-2/T4.1-2/T4.1-3/T8.x-2 — EC-2 absorbed); NEW deferred-minors trail (D8); 3 paper-name JSDoc cleanups; D3 guard widening (F-tests-10) | Source plan UNTOUCHED (git diff zero); 2 NEW trail files present; D3 guard scans `src/benchmarks/**/*.ts` recursive |
| 10 | Phase 5 | pending | T0.1..T4.1 | Final Integration Validation chain: npm test/typecheck/lint/coverage + matrix-publication test + runtime-metric grep proofs | All gates green; per-task DoD checkboxes all TRUE |

## Quality gates per task (mandatory)

Each task's TDD cycle MUST:
1. RED phase: write failing test first
2. GREEN phase: minimal code; max 3 retry
3. REFACTOR phase: SOLID/Clean Code/DRY rules applied
4. WIRING phase: triad check (pillar a static caller, b integration test, c runtime metric)
5. COMMIT phase: atomic commit `{type}({scope}): {desc}\n\nT{N.M}: ref\nWiring: a={p|d} b={p|d} c={p|n/a}`

Per session memory `no_coauthored_by_in_commits.md`: NEVER include `Co-Authored-By:` trailer.

## SEPA artifacts

- Agent: `.claude/agents/implement-v0-8-fixes-cycle-1-2026-06-02/sepa.md`
- Paired knowledge skill: `.claude/skills/implement-v0-8-fixes-cycle-1-sepa-knowledge/SKILL.md`
- Per-iteration logs: `.claude/knowledge-base/implementations/v0-8-fixes-cycle-1/sepa-iterations/iteration-{N}-{phase}.md`

## Halt conditions

Per `cycle-implement.md § Stop conditions`:
1. Task fails GREEN 3× → BLOCKED
2. iterations_used >= 50 → emit promise with honest BLOCKED tasks
3. External dep missing → halt; surface
4. Plan-task assumes behavior contradicted by reality → halt; loop to cycle-plan
5. Real-tree validation surfaces HIGH/CRITICAL CVE on declared dep → halt; loop to cycle-plan

Promise `IMPLEMENTATION_COMPLETE` only emitted when ALL 9 tasks committed AND Phase 5 gates green.
