# SEPA Pre-RED Brief — iteration 2, T1.1, MODE=TIGHT

**Task:** T1.1 Metric primitives (BLEU + F1 + exact-match)
**Verdict:** PROCEED to RED

## Key recommendations absorbed

1. **BLEU weights parameterizable** — default `[0.25, 0.25, 0.25, 0.25]` (uniform 4-gram per benchmark literature)
2. **EC-7 absorption** — 4 empty/whitespace cases: empty pred, empty ref, both empty, whitespace-only — all return 0
3. **F1 SQuAD convention** — both-empty → 1.0, only-one-empty → 0
4. **Exact-match** — `.normalize('NFC')` for unicode robustness
5. **`natural` is optionalDependency** (package.json:111) — lazy import + `describe.skipIf(!naturalAvailable)` guard
6. **boundary-check.sh** permits writes under `src/benchmarks/` (new top-level dir, no rule blocks)
7. **vitest.contract.config.ts** already widened in T0.1 commit `dae0cd7` to cover `src/benchmarks/**/__tests__/`

## Test file plan
- bleu.test.ts — 6 tests (perfect/partial/empty×3/whitespace) with describe.skipIf
- f1.test.ts — 7 tests (perfect/partial/zero/both-empty=1/one-empty=0/case/whitespace)
- exact-match.test.ts — 5 tests (case-insensitive/whitespace-trim/NFC/empty=empty/distinct)
