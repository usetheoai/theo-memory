# SEPA Pre-RED Brief — iteration 7, T5.1, MODE=TIGHT

**Task:** T5.1 LongMemEval THE GOAL TEST (PRIMARY per ADR D2)
**Verdict:** PROCEED with 3 drifts documented

## CRITICAL design fix absorbed (Drift-T5.1-1)
SEPA caught: cost-tracker uses `adapter.name` ('themory'/'mem0'/'zep'/'letta') → looks up pricing-table.json → finds 0-rate rows → silently reports $0 cost. EC-3 anti-silent-$0 violated.

**Fix:** Add `modelUsed: string` field to SearchResult. Adapter records which LLM model did answer synthesis. Cost-tracker uses `result.modelUsed`, not `adapter.name`. Remove adapter-name rows from pricing-table.json (architecturally wrong).

Scope: ~20 LoC across:
- src/core/dip/benchmark-adapter.ts (add modelUsed field)
- src/core/__tests__/benchmark-adapter.test-d.ts (add type assertion)
- src/benchmarks/themory/adapter.ts (return modelUsed; constructor takes modelId)
- src/benchmarks/themory/__tests__/adapter.test.ts (assert modelUsed)
- src/benchmarks/runner/benchmark-runner.ts (use result.modelUsed for cost lookup)
- src/benchmarks/runner/__tests__/runner.test.ts (update fixture to set modelUsed)
- src/benchmarks/runner/pricing-table.json (remove adapter-name rows)

## Drift-T5.1-2: smoke fixture for round-trip TDD
Plan acceptance "500 records" implies full ~30-50 min run. /implement halt-loop cannot tolerate that.

**Strategy:** Two-layer TDD. Layer 1 (default): `tests/e2e/benchmarks/longmemeval-themory.test.ts` runs smoke fixture (3 hand-picked records from longmemeval_oracle.json structure; LongMemEval is MIT so commit OK). Layer 2 (`BENCH_RUN=full`): real 500-record run.

Smoke fixture: `tests/e2e/benchmarks/fixtures/longmemeval-smoke.json` (~3KB).

## Drift-T5.1-3: TiktokenTokenizer location
Create `src/benchmarks/runner/tiktoken-tokenizer.ts` implementing Tokenizer interface (from src/benchmarks/themory/adapter.ts inline declaration) using @dqbd/tiktoken.

## File plan (8 files)
1. src/benchmarks/runner/tiktoken-tokenizer.ts (NEW)
2. vitest.benchmark.config.ts (NEW per EC-4; 60-min testTimeout)
3. package.json — add "test:benchmark" script
4. src/core/dip/benchmark-adapter.ts (MODIFY — SearchResult.modelUsed)
5. src/core/__tests__/benchmark-adapter.test-d.ts (MODIFY)
6. src/benchmarks/themory/adapter.ts (MODIFY — modelUsed wiring + ctor modelId)
7. src/benchmarks/themory/__tests__/adapter.test.ts (MODIFY)
8. src/benchmarks/runner/benchmark-runner.ts (MODIFY — use result.modelUsed for cost)
9. src/benchmarks/runner/__tests__/runner.test.ts (MODIFY — fixture sets modelUsed)
10. src/benchmarks/runner/pricing-table.json (MODIFY — drop adapter-name rows)
11. benchmarks/scripts/run-longmemeval.ts (NEW) — entry point
12. tests/e2e/benchmarks/fixtures/longmemeval-smoke.json (NEW)
13. tests/e2e/benchmarks/longmemeval-themory.test.ts (NEW gated on BENCH_RUN/OPENAI_API_KEY)
14. docs/benchmarks/v0.8-progress.md (NEW append-only log)
15. .gitignore (ensure benchmarks/results/ covered — already done in T2.1)

## Wiring
- (a) static caller: package.json test:benchmark script + run-longmemeval.ts main()
- (b) integration: gated e2e test
- (c) runtime metric: OTel spans + pricing_table_miss flag + judge labels visible when BENCH_RUN=true

## Inquebráveis
- Rule 1 (95%): 3 drifts surfaced honestly
- Rule 3: anti-silent-$0 absorbed via modelUsed (Drift-T5.1-1)
- Rule 4: develop only
- Rule 5: TDD smoke-fixture round-trip
- Rule 9: TiktokenTokenizer wraps @dqbd/tiktoken (no in-house BPE)
