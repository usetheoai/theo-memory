# SEPA Post-GREEN + Pre-COMMIT Review — iteration 7, T5.1, MODE=TIGHT

**Status:** GREEN
**Recommendation:** COMMIT

## Files shipped (11 production/test + 1 progress log)
- src/core/dip/benchmark-adapter.ts (MODIFIED — SearchResult.modelUsed field)
- src/core/__tests__/benchmark-adapter.test-d.ts (MODIFIED — type assertion + minimal-stub)
- src/benchmarks/themory/adapter.ts (MODIFIED — modelId config + returns modelUsed)
- src/benchmarks/themory/__tests__/adapter.test.ts (MODIFIED — 2 new assertions)
- src/benchmarks/runner/benchmark-runner.ts (MODIFIED — cost lookup uses result.modelUsed)
- src/benchmarks/runner/__tests__/runner.test.ts (MODIFIED — test fixture sets modelUsed)
- src/benchmarks/runner/pricing-table.json (MODIFIED — removed adapter-name rows)
- src/benchmarks/runner/tiktoken-tokenizer.ts (NEW — Drift-T5.1-3)
- vitest.benchmark.config.ts (NEW — EC-4 60-min testTimeout)
- package.json (MODIFIED — "test:benchmark" npm script)
- benchmarks/scripts/run-longmemeval.ts (NEW — main entry; local OTel provider)
- tests/e2e/benchmarks/fixtures/longmemeval-smoke.json (NEW — Drift-T5.1-2)
- tests/e2e/benchmarks/longmemeval-themory.test.ts (NEW — 2 smoke + 1 skipped full-run)
- docs/benchmarks/v0.8-progress.md (NEW — append-only log)

## Drifts documented (3)
1. **Drift-T5.1-1**: SearchResult.modelUsed required field. Anti-silent-$0
   absorption (cost lookup via result.modelUsed, NOT adapter.name).
2. **Drift-T5.1-2**: smoke fixture for round-trip TDD (~5-10s); full run
   gated behind BENCH_RUN=full + OPENAI_API_KEY.
3. **Drift-T5.1-3**: TiktokenTokenizer at src/benchmarks/runner/; Tokenizer
   DIP still inline at src/benchmarks/themory/adapter.ts (2 consumers
   vs rule-of-three).

## OTel cross-test contamination fixed mid-iter
- Initial run-longmemeval.ts called `trace.setGlobalTracerProvider(provider)` which
  polluted other test files' OTel state. Fixed: use local provider only;
  pass tracer explicitly to BenchmarkRunner.

## Verified
- ADR D2 LongMemEval PRIMARY: T5.1 lands FIRST benchmark cell + progress log
- ADR D4 download-at-install: fixtures gitignored; smoke fixture is MIT-licensed
- ADR D7 anti-silent-$0: cost lookup via result.modelUsed not adapter.name
- ADR D8 OTel: spans + aggregator P95 (no histogram metric); local provider
- EC-4: vitest.benchmark.config.ts NEW with 60-min testTimeout

## Tests
- Contract suite: 787 PASS / 8 skipped (was 785; +2 from modelUsed assertions)
- Benchmark suite: 2 PASS + 1 skipped (full-run gated)
- Typecheck zero errors
- Lint zero warnings

## Wiring
- (a) static caller: run-longmemeval.ts main() called from test (deferred prod from npm run)
- (b) integration: smoke e2e test PASS
- (c) runtime metric: OTel spans observable; pricing_table_miss flag working

## Commit GREEN.
