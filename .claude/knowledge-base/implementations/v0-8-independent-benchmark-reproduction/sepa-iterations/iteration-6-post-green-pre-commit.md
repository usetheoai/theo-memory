# SEPA Post-GREEN + Pre-COMMIT Review — iteration 6, T4.1, MODE=TIGHT (consolidated)

**Status:** GREEN
**Recommendation:** COMMIT

## Files shipped (8 production + 1 test)
- src/benchmarks/runner/benchmark-runner.ts (~165 LoC)
- src/benchmarks/runner/cost-tracker.ts (~125 LoC)
- src/benchmarks/runner/result-aggregator.ts (~70 LoC)
- src/benchmarks/runner/otel-instrumented.ts (~45 LoC)
- src/benchmarks/runner/pricing-table.json (35 LoC + JSON model rates)
- src/benchmarks/runner/pricing-table-miss.ts (~20 LoC typed Error)
- src/benchmarks/runner/__tests__/runner.test.ts (11 tests)

## NEW dep installed
- `@dqbd/tiktoken@^1.0.22` (latest registry, MIT, WASM-loaded BPE tokenizer)
- package-lock.json regenerated and staged

## Design pre-commits honored
1. EC-2 retry semantics: 3-consecutive-null → retryPauseMs (60s default, fakeSleep in tests) → retry SAME query → on second null ABORT loop + process.exitCode = 1
2. D8 OTel: spans (BatchSpanProcessor + InMemorySpanExporter test pattern); P95 derived in aggregator from latencyMs records (no histogram metric)
3. EC-9 persistence: fs.writeFileSync full-file rewrite per question
4. EC-13 sunset: process.stderr.write on pricing-table.json > 30 days stale (NOT hard error)

## Test coverage (11 tests)
- CostTracker × 4 (known model, EC-11 zero-token, EC-3 throws PricingTableMiss, fetched_at exposed)
- ResultAggregator × 3 (means + P95 + cost; EC-3 null total cost; judge null count vs accuracy denominator)
- BenchmarkRunner × 4 (OTel spans emitted, EC-9 incremental persistence, EC-3 pricing miss persisted, EC-2 abort + exit code)

## Wiring
- (a) static caller: ADR-DEFER-WIRING-A → T5.1 run-longmemeval.ts (deferred per plan)
- (b) integration test: deferred to T5.1 end-to-end suite (not blocking T4.1 commit; unit tests cover all EC paths)
- (c) runtime metric: OTel spans observed via InMemorySpanExporter in test 1 (count > 0)

## Inquebráveis honored
- Rule 1 (95%): 4 design pre-commits surfaced and locked before RED
- Rule 3 (honesty): NaN cost on PricingTableMiss + null totalCostUsd when all records miss; pricing-table sunset signal is informational not blocking
- Rule 4 (git): develop only
- Rule 5 (TDD): tests written first; all 11 PASS
- Rule 9 (don't reinvent): tiktoken canonical BPE; OTel sdk-trace-base; no in-house tokenizer/tracer

## Drift documented
- Drift-T4.1-1: Tokenizer DIP remains inline in src/benchmarks/themory/adapter.ts (cost-tracker imports from there; 2 consumers — rule-of-three not yet hit; promotion deferred)

## VALIDATION
- npm test: 785 PASS / 8 skipped (was 774; +11)
- npm run typecheck: zero errors
- npm run lint: zero warnings

## Commit GREEN.
