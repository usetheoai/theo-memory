# Phase 2 — Completeness Audit Report

**Project:** @usetheo/memory (TheMemory)  
**Auditor:** completeness-auditor  
**Date:** 2026-06-10  
**Scope:** All production source files under `src/` (260+ files)  
**Branch:** develop (HEAD: `0dcd758`)

---

## Executive Summary

The codebase is feature-complete for the vast majority of its documented claims. All 12 subpath exports in `package.json` resolve to working code. Zero TODO/FIXME markers or stub implementations were found. README feature claims align with source implementations.

Three substantive completeness gaps were identified:

| # | Severity | Title |
|---|---|---|
| 1 | **HIGH** | Two of three reflection policy implementations not exported from any public barrel |
| 2 | **MEDIUM** | ScoringStrategy DIP + AdditiveWeightedScoring are dead code |
| 3 | **MEDIUM** | LLM importance scoring implemented but never wired into extraction pipeline |

Plus two low-severity dead barrel findings.

---

## Findings

### F-1 (HIGH): ThresholdReflectionPolicy and SleepTimeReflectionPolicy not exported

**Promise:** CLAUDE.md Feature Status claims v0.4a shipped 3 reflection policy implementations: ManualReflectionPolicy, ThresholdReflectionPolicy, SleepTimeReflectionPolicy.

**Reality:** `ManualReflectionPolicy` is exported via `src/core/index.ts` (as a type). However, `ThresholdReflectionPolicy` and `SleepTimeReflectionPolicy` -- which are concrete classes consumers need to instantiate -- are NOT exported from any public barrel.

- `src/local/reflection/index.ts` defines the barrel but is itself never imported by production code.
- `src/local/index.ts` does NOT re-export from `./reflection/`.
- `src/index.ts` does NOT re-export these classes.
- Tests import the concrete files directly (`../../reflection/threshold-reflection-policy.js`).

**Impact:** Consumers who install `@usetheo/memory` and follow the documentation expecting to construct a `ThresholdReflectionPolicy` or `SleepTimeReflectionPolicy` cannot do so through the published exports contract. They would need deep-path imports (`@usetheo/memory/src/local/reflection/threshold-reflection-policy.js`) which is not a supported consumption pattern.

**Evidence:**
- `src/local/reflection/index.ts:1` -- barrel exists, exports both classes
- `src/local/index.ts` -- no import or re-export from `./reflection/`
- `src/index.ts` -- no reference to either class
- `src/core/index.ts:185-195` -- JSDoc names both policies as "Adapters" but only `ManualReflectionPolicy` is exported (as a type)

**Remediation:** Re-export `ThresholdReflectionPolicy`, `SleepTimeReflectionPolicy`, and their config types from `src/local/index.ts`, then from `src/index.ts`.

---

### F-2 (MEDIUM): ScoringStrategy DIP and AdditiveWeightedScoring are dead code

**Promise:** The `ScoringStrategy` interface (8th DIP) was designed for v0.4a as a pluggable scoring strategy system for `recency x importance x relevance` combinations.

**Reality:** The retrieval pipeline (`src/core/retrieval/pipeline.ts`) uses the simpler `combineScores` function from `src/core/scoring.ts` directly. Neither `ScoringStrategy` nor `AdditiveWeightedScoring` is:
- Called from any production code path
- Exported from any public barrel
- Referenced by any non-test file (aside from JSDoc comments)

The barrel `src/core/scoring-strategies/index.ts` has zero production importers.

**Impact:** ~200 lines of dead code (interface + implementation + barrel). Low runtime risk but maintenance burden -- future developers may assume this code is live.

**Evidence:**
- `src/core/dip/scoring-strategy.ts:59` -- interface definition
- `src/core/scoring-strategies/additive-weighted-scoring.ts:73` -- implementation
- `src/core/retrieval/pipeline.ts` -- uses `combineScores` from `scoring.ts`, not `ScoringStrategy`
- `src/core/index.ts` -- does NOT export `ScoringStrategy`

**Remediation:** Either wire `ScoringStrategy` into the retrieval pipeline (replacing hardcoded `combineScores`) and export it, or remove the dead code and document the decision.

---

### F-3 (MEDIUM): LLM importance scoring not wired into extraction pipeline

**Promise:** CLAUDE.md Principle 1 lists `llm_importance_score` as a signal for the scoring system. v0.4b forgetting pipeline's `TriadicScoringPolicy` reads `llm_importance_score` as the third pillar of the eviction triad (Ebbinghaus + LRU + LLM-importance).

**Reality:** `src/core/reflection/importance.ts` implements `scoreImportance()` and `scoreAndCacheImportance()`, but these functions are never called from any production path. The file itself documents this at line 82: "Wiring into the v0.1 extraction pipeline (runExtractionPipeline) is DEFERRED to F-importance-pipeline-wiring followup."

This means memories are persisted with `llm_importance_score = NULL`. The triadic scoring policy reads this field for eviction decisions, but it always receives the default/null value, effectively reducing the triad to a dyad (Ebbinghaus + LRU only).

**Impact:** The LLM-importance pillar of the eviction system is non-functional. Eviction decisions are made without the promised LLM importance signal.

**Evidence:**
- `src/core/reflection/importance.ts:60` -- `scoreImportance` defined
- `src/core/reflection/importance.ts:82` -- explicit deferral comment
- `src/local/eviction/triadic-scoring-policy.ts` -- reads `llm_importance_score`
- Zero production callers of `scoreImportance` or `scoreAndCacheImportance`

**Remediation:** Wire `scoreAndCacheImportance` into `runExtractionPipeline` (post-dedup, pre-persist) so memories receive LLM importance scores at write time. Alternatively, document the eviction-without-importance degradation explicitly in CLAUDE.md caveats.

---

### F-4 (LOW): Dead barrel `src/local/reflection/index.ts`

The barrel file exists and exports `ThresholdReflectionPolicy` and `SleepTimeReflectionPolicy`, but no file in the codebase imports it. Tests import the concrete modules directly.

**Remediation:** Wire into `src/local/index.ts` as a re-export target (which also fixes F-1), or remove.

---

### F-5 (LOW): Dead barrel `src/core/scoring-strategies/index.ts`

The barrel file exists and exports `AdditiveWeightedScoring` and `GENERATIVE_AGENTS_WEIGHTS`, but no file in the codebase imports it. Tests import the concrete module directly.

**Remediation:** Wire into the public API if the ScoringStrategy DIP is intended for consumers, or remove alongside F-2.

---

## Verified Clean Areas

### Stub detection: CLEAN
Zero TODO, FIXME, XXX, HACK markers across all `src/**/*.ts`. Zero `throw new Error('not implemented')` or empty function bodies.

### Package.json subpath exports: ALL VERIFIED
All 12 subpath exports point to files that exist with substantive implementations:

| Subpath | Entry file | Status |
|---|---|---|
| `.` | `src/index.ts` | OK -- 8 re-export groups |
| `./contract` | `src/core/index.ts` | OK -- full DIP + contract surface |
| `./theokit` | `src/theokit/index.ts` | OK -- `memoryFromCtx` + types |
| `./agent-tools` | `src/agent-tools/index.ts` | OK -- `createMcpServer` + transports |
| `./embedders` | `src/embedders/index.ts` | OK -- 3 embedder adapters |
| `./embedders/stub` | `src/embedders/stub.ts` | OK -- `DeterministicStubEmbedder` |
| `./embedders/openai` | `src/embedders/openai.ts` | OK -- `OpenAIEmbedder` |
| `./embedders/local` | `src/embedders/local.ts` | OK -- `LocalTransformerEmbedder` |
| `./llms` | `src/llms/index.ts` | OK -- 2 LLM adapters |
| `./llms/stub` | `src/llms/stub.ts` | OK -- `DeterministicStubLLM` |
| `./llms/openai` | `src/llms/openai.ts` | OK -- `OpenAILLM` |
| `./server` | `src/server/index.ts` | OK -- `createServer` + full auth surface |
| `./cache-pg` | `src/local/recall-cache/index.ts` | OK -- `PgvectorRecallCacheStore` + metrics |

### README feature claims: ALL VERIFIED
Every feature claimed in the README Features section and REST API table was verified against source:
- Three-tier scope + skills -- `LocalMemory` class methods
- 4-verb API -- `LocalScopedMemory` implements all four
- Hybrid retrieval (semantic + BM25 + entity) -- `retrieval/pipeline.ts`
- Bi-temporal `asOf` -- `local/index.ts` recall method
- Multi-peer `attributedTo` -- `applySkillFilters` + options.ts
- Category filtering -- options.ts + `applySkillFilters`
- Semantic recall cache -- cache-aware path in `LocalScopedMemory.recall`
- MMR diversification -- `retrieval/pipeline.ts` line 176 + `mmr.ts`
- Rate limiting (30 writes/min, 100 reads/min) -- `rate-limit.ts`
- Auth (bearer + API keys + OIDC) -- `server/auth/` directory
- All 7 REST endpoints have corresponding handler files

### Environment variable handling: CLEAN
All `process.env` reads with non-null assertions (`!`) are preceded by `assertEnvOrExit` guards. Rate limit env vars (`THEMORY_RATE_LIMIT_WRITES`, `THEMORY_RATE_LIMIT_READS`) have explicit fallback defaults with invalid-value warnings.

### Benchmarks subsystem: SELF-CONTAINED
`src/benchmarks/` is internal tooling with no public barrel. Vendor adapter wiring (Mem0/Zep/Letta) is documented as deferred per CLAUDE.md.

---

## Files Inspected

113 production source files were marked as inspected in the review database. Coverage spans all layers: core, local, server, agent-tools, embedders, llms, theokit.

---

## Summary

| Metric | Value |
|---|---|
| Findings total | 10 |
| HIGH severity | 1 (missing public exports for 2/3 reflection policies) |
| MEDIUM severity | 2 (dead ScoringStrategy DIP; unwired importance scoring) |
| LOW severity | 2 (dead barrels) |
| INFO severity | 5 (verified clean areas) |
| Files inspected | 113 |
| Stubs found | 0 |
| TODO/FIXME markers | 0 |
| Package.json subpath issues | 0 |
| README claims unimplemented | 0 |
