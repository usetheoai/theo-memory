# SEPA Pre-RED Brief — iteration 6, T4.1, MODE=VERBOSE

**Task:** T4.1 Runner orchestrator
**Verdict:** PROCEED to RED with 4 design pre-commits locked + 1 NEW dep approved

## Design pre-commits locked (in JSDoc before tests)
1. **EC-2 retry**: pause 60s → retry SAME query ONCE → ABORT loop on second failure → partial results = persisted Q0..Q_failing_index → process.exitCode = 1
2. **D8 OTel**: spans + aggregator-computed P95 from span end-start (NOT histogram metric instrument); precedent v0.4a OTel ManualReflectionPolicy
3. **EC-9 persistence**: full-file rewrite after each question via `fs.writeFileSync` (atomic-ish, sub-second); JSONL deferred
4. **EC-13 sunset**: cost-tracker logs `console.warn` if pricing-table.json `fetched_at` > 30 days old; NOT a hard error

## NEW dep APPROVED
- `@dqbd/tiktoken@^1.0.22` (latest registry; plan declared `^1.0.0` — pin to ^1.0.22 for defensiveness)
- WASM-based BPE tokenizer; MIT; canonical JS port; deterministic
- Used in production by LangChain.js, llamaindex.ts
- Rule 9: no in-house BPE; reuse battle-tested lib

## Tokenizer DIP placement (Drift-T4.1-1)
- Keep `Tokenizer` interface inline in `src/benchmarks/themory/adapter.ts` (T3.1 Drift-T3.1-3 deferred)
- cost-tracker imports from there (2nd consumer; rule-of-three says NOT YET promote to core/dip)
- Document as Drift-T4.1-1 in cost-tracker.ts JSDoc

## Test ordering (per testing.md § TDD)
1. cost-tracker tests (normal / zero-token=0 / PricingTableMiss / sunset warning)
2. result-aggregator tests (P95 + mean aggregation + NaN-skip)
3. runner OTel span emission test
4. runner aggregation + RunReport shape test
5. runner EC-2 retry policy test (fake timers needed)
6. runner EC-9 incremental persistence test (tmpfs)
7. runner EC-3 PricingTableMiss persisted flag test

## File layout (8 files; budget ≤500 LoC each)
- benchmark-runner.ts (~250 LoC)
- otel-instrumented.ts (~80 LoC)
- result-aggregator.ts (~100 LoC)
- cost-tracker.ts (~150 LoC)
- pricing-table.json (~30 LoC)
- pricing-table-miss.ts (~25 LoC; typed Error subclass)
- __tests__/runner.test.ts
- tests/integration/benchmarks/runner-integration.test.ts (deferred to T5.1 if budget tight)

## Wiring
- (a) static caller: ADR-DEFER-WIRING-A → T5.1 (first run-longmemeval.ts caller)
- (b) integration test: declared in T4.1 (or deferred to T5.1 sketch — verify before COMMIT)
- (c) runtime metric: OTel spans + InMemorySpanExporter assertion in test
