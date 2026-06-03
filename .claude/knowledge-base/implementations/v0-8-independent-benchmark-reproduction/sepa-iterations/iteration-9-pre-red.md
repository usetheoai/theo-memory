# SEPA Pre-RED Brief — iteration 9, T7.1+T7.2 BATCHED, MODE=TIGHT

**Tasks:** T7.1 LoCoMo runner + T7.2 DMR runner (4 cells each = 8 cells; SECONDARY + TERTIARY per ADR D2)
**Verdict:** PROCEED with batched mirror of T5.1 pattern

## Pattern (mirror of T5.1)
Each script (run-locomo.ts, run-dmr.ts) follows the same shape as
run-longmemeval.ts:
1. Load fixture (T2.1 loader)
2. Build BenchmarkCorpus + BenchmarkQuery[]
3. Instantiate adapter (TheMemory or one of mem0/zep/letta via stub VendorClient)
4. Run via T4.1 BenchmarkRunner
5. Write report JSON to benchmarks/results/{benchmark}/{adapter}.json

Each test file: smoke-fixture round-trip (default ON) + skipIf gated full run.

## Files (per task)
T7.1 LoCoMo:
- benchmarks/scripts/run-locomo.ts (NEW)
- tests/e2e/benchmarks/fixtures/locomo-smoke.json (NEW)
- tests/e2e/benchmarks/locomo-themory.test.ts (NEW)

T7.2 DMR:
- benchmarks/scripts/run-dmr.ts (NEW)
- benchmarks/scripts/derive-dmr-subset.ts (NEW — placeholder; real derivation deferred)
- tests/e2e/benchmarks/fixtures/dmr-smoke.json (NEW)
- tests/e2e/benchmarks/dmr-themory.test.ts (NEW)

docs/benchmarks/v0.8-progress.md: append cell entries.

## Drifts
- Drift-T7.1-1: LoCoMo CC-BY-NC-SA fixture must be download-at-install per ADR D4; smoke fixture is hand-authored (NOT a subset of LoCoMo data) to avoid NC license question for committed files. Acceptable per ADR D4 reading.
- Drift-T7.2-1: derive-dmr-subset.ts ships as placeholder (real MSC→DMR derivation deferred to follow-up; needs MSC dataset access). Smoke fixture is hand-authored.

## Wiring
- (a) static caller: package.json test:benchmark (already covers via vitest config glob)
- (b) integration: 2 new smoke tests pass on default config
- (c) runtime metric: same as T5.1 (OTel spans + cost-tracker)

## Test scope
4 tests per task (= 8 total) per existing T5.1 pattern:
1. smoke fixture round-trip produces RunReport
2. per-query record carries judge label + latency + cost
(skipIf for full run deferred to CI)
