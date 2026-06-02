# Implementation Working Contract — v0-8-independent-benchmark-reproduction

**Plan:** `.claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md` (v1.2 — SHIPPABLE_WITH_CAVEATS 84.8/100)
**Spawned:** 2026-06-02 by `/implement` (cycle-implement.md v1.5)
**Started at HEAD:** `8784052` (post cycle-plan v0.8 completion)

## Task list (dependency order)

Phase 0 must complete before Phase 1+. Phase 2 + Phase 3 parallelizable after Phase 0. Phase 4 depends on Phase 0 + 1 + 3. Phase 5 (THE GOAL TEST) depends on 0+1+2+3+4. Phase 6 depends on 4 (Mem0/Zep/Letta adapters). Phase 7 depends on 5+6. Phase 8 depends on all prior.

| Task | Phase | Status | Files | TDD | Notes |
|---|---|---|---|---|---|
| T0.1 | Phase 0 | pending | `src/core/dip/benchmark-adapter.ts` (NEW) + `src/core/dip/index.ts` re-export + `src/core/__tests__/benchmark-adapter.test-d.ts` (NEW) + vitest.contract.config.ts include update | type-only tests with `expectTypeOf` | EC-5 absorbed: `speaker?: string` on BenchmarkCorpusItem + `expectedSpeakers?: readonly string[]` on BenchmarkQuery |
| T1.1 | Phase 1 | pending | `src/benchmarks/metrics/{bleu,f1,exact-match,index}.ts` (NEW) + `__tests__/*.test.ts` (NEW) | RED 9 tests inc. EC-7 BLEU empty handling | natural BleuScore + token-set F1 + case-insensitive exact-match |
| T1.2 | Phase 1 | pending | `src/benchmarks/llm-judge/{judge-panel,single-judge,json-extractor,inter-judge-agreement,judge-prompt}.ts` (NEW) + `__tests__/*.test.ts` (NEW) | RED 10 tests inc. EC-1 + EC-10 | SingleJudge returns Promise<JudgeLabel \| null> per EC-1; multi-judge panel via DI |
| T2.1 | Phase 2 | pending | `benchmarks/scripts/download-fixtures.ts` (NEW) + `benchmarks/README.md` + `src/benchmarks/fixtures/{longmemeval,locomo,dmr}-loader.ts` (NEW) + `tests/fixtures/benchmarks/{longmemeval,locomo,dmr}-sample.json` + `.gitignore` update | RED 8 tests inc. EC-6 + EC-8 | Node 20+ native fetch (no wget); EC-1 absorbed normalizeLongMemEvalAnswer |
| T3.1 | Phase 3 | pending | `src/benchmarks/themory/adapter.ts` (NEW) + `__tests__/adapter.test.ts` + `tests/integration/benchmarks/themory-adapter-pg.test.ts` | RED 5+ tests inc. EC-5 speaker boundary | EC-5: scopedUserId = `${conversationId}::${speaker ?? 'unknown'}` |
| T4.1 | Phase 4 | pending | `src/benchmarks/runner/{benchmark-runner,otel-instrumented,result-aggregator,cost-tracker,pricing-table-miss}.ts` (NEW) + `pricing-table.json` + tests | RED 9+ tests inc. EC-2 + EC-3 + EC-9 + EC-11 | EC-13 inline: pricing-table.json carries fetched_at + 30-day sunset reminder |
| T5.1 | Phase 5 | pending | `benchmarks/scripts/run-longmemeval.ts` (NEW) + `vitest.benchmark.config.ts` (NEW per EC-4) + `tests/e2e/benchmarks/longmemeval-themory.test.ts` + `docs/benchmarks/v0.8-progress.md` + `package.json` `test:benchmark` script | E2E gated on BENCH_RUN=true + OPENAI_API_KEY | THE GOAL TEST for TheMemory v0.7 on LongMemEval |
| T6.1 | Phase 6 | pending | `src/benchmarks/mem0/adapter.ts` (NEW) + tests | RED + integration gated on MEM0_API_KEY | Mem0 v3 BenchmarkAdapter |
| T6.2 | Phase 6 | pending | `src/benchmarks/zep/adapter.ts` (NEW) + tests | RED + integration gated on ZEP_API_KEY | Zep cloud BenchmarkAdapter |
| T6.3 | Phase 6 | pending | `src/benchmarks/letta/adapter.ts` (NEW) + tests | RED + integration gated on LETTA_API_KEY | Letta REST BenchmarkAdapter |
| T7.1 | Phase 7 | pending | `benchmarks/scripts/run-locomo.ts` (NEW) + results JSONs + progress doc update | E2E | 4 LoCoMo cells |
| T7.2 | Phase 7 | pending | `benchmarks/scripts/{run-dmr,derive-dmr-subset}.ts` (NEW) + results JSONs + progress doc | E2E | 4 DMR cells |
| T8.1 | Phase 8 | pending | `docs/benchmarks/{v0.8,v0.8-methodology,v0.8-reproducibility}.md` (NEW) + `docs/benchmarks/v0.8-raw-results/` + README.md + CHANGELOG.md | matrix authoring | 12 populated cells |
| T8.2 | Phase 8 | pending | `tests/e2e/benchmarks/matrix-publication.test.ts` (NEW) | RED 5 tests inc. EC-12 | THE FINAL GOAL TEST |
| Integration Validation | Final | pending | (no files; gate execution) | All suites green | npm test + typecheck + lint + coverage + matrix-publication.test PASS |

## SEPA load-bearing risks (will surface aggressively per iteration)

Per plan v1.2 ADRs + edge-case absorptions:
- **EC-1** (T1.2): LLM-judge JSON parse robustness (json-extractor.ts + nullable SingleJudge return)
- **EC-2** (T4.1): all-judges-fail policy (3-consecutive-null → 60s pause → 1 retry → partial-persist + exit code)
- **EC-3** (T4.1): PricingTableMiss typed error + pricing_table_miss flag (anti silent $0)
- **EC-4** (T5.1): vitest.benchmark.config.ts NEW with 60-min testTimeout (default 5s incompatible)
- **EC-5** (T0.1 + T3.1): speaker scope boundary (multi-speaker conversations preserved)
- **EC-6** (T2.1): TypeScript downloader (no wget; cross-platform)
- **EC-7..EC-14**: SHOULD TEST + DOCUMENT absorbed inline

## ADR cross-references (mandatory per task)

| ADR | Required citation in tasks |
|---|---|
| D1 (own runner; adopt only metrics) | T0.1 (DIP), T1.1 (natural BleuScore Rule 9), T4.1 (runner ownership) |
| D2 (LongMemEval PRIMARY > LoCoMo SECONDARY > DMR TERTIARY) | T5.1 (LongMemEval first), T7.1 (LoCoMo), T7.2 (DMR) |
| D3 (multi-judge panel via OpenRouter; NO @anthropic-ai/sdk) | T1.2 (judge-panel uses openai SDK + OpenRouter base URL), T4.1 (judge orchestration) |
| D4 (download-at-install; CC-BY-NC-SA LoCoMo) | T2.1 (downloader script + .gitignore + benchmarks/data/), T7.1 (LoCoMo NC disclaimer) |
| D5 (BenchmarkAdapter in src/core/dip/; impls in src/benchmarks/) | T0.1 (Protocol locus), T3.1+T6.1-3 (adapter locus) |
| D6 (BenchmarkAdapter NOT inherits MemoryStore) | T0.1 (separate interfaces; ISP+SRP) |
| D7 (tiktoken + pricing-table.json; cost/session not cost/run) | T4.1 (cost-tracker), T8.1 (matrix cells) |
| D8 (OTel histogram spans for P95) | T4.1 (otel-instrumented), T5.1 (P95 emission) |
| D9 (skip BERTScore/SBERT default; opt-in --include-semantic) | T1.1 acceptance, T8.1 (default scorecard) |

## Halt conditions (per cycle-implement.md v1.5)

- All 13 tasks status=committed → emit `<promise>IMPLEMENTATION_COMPLETE</promise>`
- Final Integration Validation (T-final) PASS verified
- Wiring triad pillars (a) + (b) + (c) checked per task
- Per Inquebrável Rule 5 (TDD): RED before GREEN every task
- Per Inquebrável Rule 4: develop only, no force-push, no --no-verify
- Per Inquebrável Rule 3: honest BLOCKED on plan defect or env missing
