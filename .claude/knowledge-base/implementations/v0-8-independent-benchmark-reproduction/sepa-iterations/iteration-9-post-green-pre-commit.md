# SEPA Post-GREEN + Pre-COMMIT Review — iteration 9, T7.1+T7.2 BATCHED, MODE=TIGHT

**Status:** GREEN
**Recommendation:** COMMIT batched

## Files shipped (8)
- benchmarks/scripts/run-locomo.ts (NEW; mirror of run-longmemeval.ts shape; LoCoMo fixture loader + expectedSpeakers from speakerA/B)
- benchmarks/scripts/run-dmr.ts (NEW; mirror shape; DMR fixture loader)
- benchmarks/scripts/derive-dmr-subset.ts (NEW; placeholder per Drift-T7.2-1)
- tests/e2e/benchmarks/fixtures/locomo-smoke.json (NEW; 2 hand-authored conversations)
- tests/e2e/benchmarks/fixtures/dmr-smoke.json (NEW; 2 hand-authored conversations)
- tests/e2e/benchmarks/locomo-themory.test.ts (NEW; smoke runs LoCoMo end-to-end)
- tests/e2e/benchmarks/dmr-themory.test.ts (NEW; smoke runs DMR end-to-end)
- docs/benchmarks/v0.8-progress.md (UPDATED; 6 new cell rows incl. deferred Phase 6 vendor cells)

## Drifts documented (2)
- **Drift-T7.1-1**: LoCoMo smoke fixture is hand-authored (NOT a subset of LoCoMo data) to avoid CC-BY-NC-SA committed-data question. Real LoCoMo download-at-install per ADR D4 already shipped in T2.1 download-fixtures.mjs.
- **Drift-T7.2-1**: derive-dmr-subset.ts ships as a placeholder. Real MSC→DMR derivation deferred to follow-up cycle (needs MSC dataset access). Smoke fixture validates run-dmr.ts wiring without requiring derived data.

## Verified
- ADR D2 priority ordering: T5.1 (PRIMARY) → T7.1 (SECONDARY) → T7.2 (TERTIARY) — committed in order
- ADR D4 download-at-install: smoke fixtures hand-authored; real LoCoMo CC-BY-NC-SA data NOT committed
- ADR D7 cost computation: both scripts use TiktokenTokenizer + CostTracker (modelUsed lookup per Drift-T5.1-1)
- ADR D8 OTel: local provider per-run (NOT setGlobalTracerProvider to avoid cross-test contamination)
- ADR D9 default scorecard: BLEU + F1 + LLM-judge only (no BERTScore/SBERT)
- EC-4 vitest.benchmark.config.ts (T5.1) glob picks up both new test files automatically

## Tests
- Contract suite: 800 PASS / 8 skipped (unchanged; new tests are e2e benchmark suite)
- Benchmark suite (`npm run test:benchmark`): 4 PASS / 1 skipped (was 2 PASS / 1 skipped at T5.1; +2 smoke tests)
- Typecheck zero errors
- Lint zero warnings

## Wiring
- (a) static caller: both scripts callable via npm run test:benchmark (picks up new tests via glob)
- (b) integration: smoke tests PASS end-to-end
- (c) runtime metric: OTel spans + cost-tracker (same as T5.1)

## Commit GREEN — single commit covering T7.1 + T7.2 batched.
