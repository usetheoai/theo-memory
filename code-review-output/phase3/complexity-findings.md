# Phase 3 -- Complexity Scanner Report

**Agent:** complexity-scanner
**Date:** 2026-06-10
**Tool:** lizard 1.23.0
**Target:** `src/` (production TypeScript, excluding `__tests__/`)
**Severity source:** `default` (tool-measured McCabe cyclomatic complexity)

---

## Summary

| Metric | Value |
|---|---|
| Total production functions scanned | 616 |
| Functions with CC >= 11 (medium+) | 27 (4.4%) |
| Functions with CC >= 16 (high) | 8 (1.3%) |
| Functions with CC >= 21 (very high) | 4 (0.6%) |
| Functions with CC >= 26 (critical risk) | 3 (0.5%) |
| Maximum CC | 36 (`runExtractionPipeline`) |

**Overall assessment:** The codebase is healthy at the function level -- 95.6% of production functions have CC <= 10 (acceptable). The two pipeline orchestrators (`runExtractionPipeline` CC=36, `runRetrievalPipeline` CC=33) are the primary complexity hotspots and would benefit from phase-extraction refactoring. Several other high-CC functions are measurement artifacts of flat null-guard sequences (e.g., `rowToResult` CC=26 with 13 sequential if-guards but zero nesting).

---

## Severity Bands (McCabe 1976 NIST consensus)

| CC Range | Severity | Count | Source |
|---|---|---|---|
| 1-10 | acceptable (no finding) | 589 | McCabe NIST |
| 11-15 | medium | 19 | McCabe (moderate risk) |
| 16-20 | high | 4 | McCabe (high risk) |
| 21-25 | high | 1 | McCabe (very high risk) |
| 26-50 | critical | 3 | McCabe (very high / untestable) |
| > 50 | critical | 0 | McCabe (untestable) |

---

## HIGH severity findings (CC >= 16)

### 1. `runExtractionPipeline` -- CC=36

- **File:** `src/core/extraction/pipeline.ts:260`
- **NLOC:** 135 | **Length:** 238 lines
- **Nature:** 8-phase write pipeline orchestrator. Heavy branching from option guards, scope validation, error paths per phase, LLM fallback, dedup logic, batch persist with per-row fallback, entity linking, history persistence. Each phase adds 2-5 branches.
- **Remediation:** Extract each pipeline phase into a dedicated function (e.g., `phaseExtractFacts`, `phaseBatchEmbed`, `phaseDedup`, `phasePersist`). Each phase function should target CC <= 10. The orchestrator becomes a sequential caller with minimal branching.

### 2. `runRetrievalPipeline` -- CC=33

- **File:** `src/core/retrieval/pipeline.ts:68`
- **NLOC:** 100 | **Length:** 163 lines
- **Nature:** 9-step search pipeline. CC from threshold gating, cache lookup/miss paths, BM25 fallback, entity boost toggle, MMR diversification toggle, asOf temporal filter, scope filtering, over-fetch logic, scoring normalization.
- **Remediation:** Extract retrieval steps into individual functions (e.g., `stepSemanticSearch`, `stepBm25Rerank`, `stepEntityBoost`, `stepDiversify`). Pipeline orchestrator calls them in sequence. Target CC <= 10 per step.

### 3. `rowToResult` -- CC=26 (measurement artifact)

- **File:** `src/local/pgvector-store.ts:58`
- **NLOC:** 60 | **Length:** 93 lines
- **Nature:** Row-to-DTO mapper with 13 sequential null/undefined guards for projecting DB columns into the payload object. Each guard is an independent flat if-branch. **Cognitive complexity is LOW** despite high cyclomatic complexity -- there is zero nesting and the pattern is repetitive.
- **Remediation:** Consider a helper like `projectNonNull(payload, row, ['user_id','session_id',...])` to reduce repetitive guards. Alternatively, accept the CC as a measurement artifact -- cognitive complexity would score this function much lower than 26.

### 4. `constructor` (TriadicScoringPolicy) -- CC=21

- **File:** `src/local/eviction/triadic-scoring-policy.ts:272`
- **NLOC:** 31 | **Length:** 36 lines
- **Nature:** 5-parameter constructor with null-coalescing each optional dependency parameter plus their sub-properties. Each `??` or ternary adds a branch.
- **Remediation:** Extract a `buildDefaults(options)` function that returns a fully-populated config object. Constructor CC drops to ~3-5.

### 5. `decodeSkillPayload` -- CC=20

- **File:** `src/local/skills/payload.ts:33`
- **NLOC:** 54 | **Length:** 59 lines
- **Nature:** Type-narrowing guards on each skill field plus type coercion branches.
- **Remediation:** Use a zod schema to validate the payload shape in one parse call.

### 6. `runMcpServer` -- CC=18

- **File:** `src/agent-tools/run-mcp-server.ts:173`
- **NLOC:** 54 | **Length:** 102 lines
- **Nature:** MCP server bootstrap with auth mode selection, transport selection, TLS config, OIDC resolution, pool/memory factory, error paths.
- **Remediation:** Extract auth setup, transport setup, and memory factory into separate functions.

### 7. `matchesFilters` -- CC=17

- **File:** `src/local/in-memory-store.ts:60`
- **NLOC:** 32 | **Length:** 41 lines
- **Nature:** In-memory filter matcher with null/undefined checks per filter field plus scope-type narrowing and asOf temporal predicate.
- **Remediation:** Extract scope matching and temporal matching into two helper functions.

### 8. `rotateKeyHandler` -- CC=16

- **File:** `src/server/handlers/admin-keys.ts:319`
- **NLOC:** 89 | **Length:** 97 lines | **NFR:** performance (hot path)
- **Nature:** API key rotation with input validation, old-key lookup, scope preservation, transaction management, error classification, response formatting.
- **Remediation:** Extract validation, DB transaction, and response formatting into separate functions.

---

## MEDIUM severity findings (CC 11-15)

| CC | Function | File | Line | NLOC | Notes |
|---|---|---|---|---|---|
| 15 | anonymous (consolidate orchestrator) | `src/local/skills/consolidate.ts` | 363 | 88 | Skill consolidation with similarity checks, LLM merge, supersession |
| 15 | `scopesHandler` | `src/server/handlers/scopes.ts` | 83 | 55 | Query parsing, scope dispatch, pagination (hot path) |
| 15 | anonymous (scope-verifier) | `src/server/auth/scope-verifier.ts` | 77 | 54 | Permission matching, wildcard handling (hot path) |
| 15 | `deriveSpanName` | `src/server/observability/otel-middleware.ts` | 19 | 11 | Dense switch/if in 11 lines; replace with lookup table |
| 14 | `resolveOidcConfig` | `src/agent-tools/oidc-cli-resolver.ts` | 81 | 36 | Env var fallbacks + CLI flag precedence |
| 14 | `parseConsolidationResponse` | `src/core/conflict-resolution/llm-judged-merge.ts` | 59 | 15 | JSON parse + field validation + cluster-ID cross-check |
| 13 | `applyDimChange` | `src/local/index.ts` | 1275 | 100 | Embedding dim migration pipeline |
| 13 | `validateRecallCacheStoreConfig` | `src/core/dip/recall-cache-store.ts` | 204 | 28 | Range checks on multiple config fields |
| 13 | `assertScopeIsNonEmpty` | `src/local/index.ts` | 270 | 19 | Type-narrowing on scope kinds |
| 13 | anonymous (bearer auth handler) | `src/agent-tools/auth/with-bearer-auth.ts` | 113 | 38 | Auth mode dispatch + dual-validation (hot path) |
| 12 | `extractBearer` | `src/agent-tools/auth/with-bearer-auth.ts` | 51 | 16 | Header format checks |
| 12 | `scanBalancedObjectWithLabel` | `src/benchmarks/llm-judge/json-extractor.ts` | 49 | 40 | Manual JSON extraction; consider proper parser |
| 12 | `minMaxNormalize` | `src/core/scoring-strategies/additive-weighted-scoring.ts` | 54 | 18 | Edge-case guards for normalization |
| 11 | `forget` | `src/local/index.ts` | 934 | 34 | Hard/soft delete branching |
| 11 | anonymous (auth middleware) | `src/server/auth/middleware.ts` | 31 | 35 | Auth mode dispatch (hot path) |
| 11 | `classifyError` | `src/agent-tools/error-classifier.ts` | 114 | 33 | Error classification chain |
| 11 | `score` (TriadicScoringPolicy) | `src/local/eviction/triadic-scoring-policy.ts` | 338 | 20 | Multi-dimensional eviction scoring |
| 11 | `simpleStem` | `src/core/lemmatization.ts` | 57 | 20 | Suffix-stripping rules |
| 11 | `find` (union-find) | `src/local/skills/consolidate.ts` | 194 | 13 | Recursive path compression |

---

## Cross-validation notes

### Functions with high CC but low cognitive complexity (LOC-folklore false positives)

The following functions have high McCabe CC but are structurally flat (no deep nesting, no interleaved logic). A LOC-heuristic reviewer flagging these as "complex" would be producing a false positive:

1. **`rowToResult`** (CC=26) -- 13 sequential flat if-guards, zero nesting. Cognitive complexity estimated at ~13 (each guard adds 1, no nesting bonus).
2. **`constructor` of TriadicScoringPolicy** (CC=21) -- null-coalescing defaults in a flat sequence.
3. **`decodeSkillPayload`** (CC=20) -- sequential type guards, flat structure.

These are legitimate CC measurements (each branch IS a branch) but the risk profile is lower than deeply-nested CC=15 functions would be.

### Functions with moderate CC but high cognitive density

1. **`deriveSpanName`** (CC=15, NLOC=11) -- 15 decision points packed into 11 lines of code. Ratio of 1.36 CC/NLOC is the highest in the codebase. A lookup table would be more maintainable.
2. **`parseConsolidationResponse`** (CC=14, NLOC=15) -- dense validation logic. Nearly 1:1 CC-to-NLOC ratio.

---

## Hot-path annotations (nfr_tag=performance)

Functions under `server/handlers/`, `server/auth/`, or `api/` paths are auto-tagged with `nfr_tag=performance` per the complexity-scanner convention:

- `rotateKeyHandler` (CC=16) -- `src/server/handlers/admin-keys.ts`
- `scopesHandler` (CC=15) -- `src/server/handlers/scopes.ts`
- anonymous scope-verifier (CC=15) -- `src/server/auth/scope-verifier.ts`
- `deriveSpanName` (CC=15) -- `src/server/observability/otel-middleware.ts`
- anonymous bearer auth handler (CC=13) -- `src/agent-tools/auth/with-bearer-auth.ts`
- anonymous auth middleware (CC=11) -- `src/server/auth/middleware.ts`

---

## Tool run metadata

| Field | Value |
|---|---|
| Tool | lizard 1.23.0 |
| Language | TypeScript |
| Command | `lizard src/ --languages typescript --CCN 10 --sort cyclomatic_complexity --csv` |
| Exit code | 0 |
| Raw output | `code-review-output/audit/lizard_ts.csv` |
| Phase | 3 |
| Iteration | 1 |
| Production functions scanned | 616 |
| Findings persisted to DB | 27 |
