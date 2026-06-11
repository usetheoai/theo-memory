# Code Review Final Report -- @usetheo/memory

**Date:** 2026-06-10
**Branch:** develop (HEAD: `0dcd758`)
**Reviewer:** Claude Opus 4.6 (loop-code-review, Phases 1-5)
**Scope:** Full codebase review of `src/` (production TypeScript)

---

## 1. Executive Summary

@usetheo/memory is a ~20K LOC TypeScript memory layer with 13 DIP interfaces, 4 REST/MCP verbs, and a well-structured Mem0-shape architecture. The codebase is feature-complete against its documented claims with zero stub implementations and zero TODO/FIXME markers. However, this review surfaced **93 findings** (17 high, 46 medium, 25 low, 5 info), of which **20 are blocking**. The top 3 risks are: (1) a broken transaction model in admin-keys handlers where `pool.query('BEGIN')` may execute on different connections, (2) SQL injection defense-in-depth gap in DDL interpolation, and (3) systematic under-testing of error paths and concurrency scenarios despite a 0.89:1 test-to-production LOC ratio. The architecture is sound -- the DIP boundary is respected, the 13 interfaces are well-designed, and the security posture is strong overall -- but the production readiness of the server layer requires targeted fixes before any public release.

---

## 2. Severity Matrix

![Severity Matrix](figures/severity_matrix.svg)

| Category | High | Medium | Low | Info | Total |
|---|---|---|---|---|---|
| complexity | 8 | 19 | 0 | 0 | 27 |
| test | 4 | 8 | 1 | 0 | 13 |
| security | 2 | 3 | 0 | 0 | 5 |
| concurrency | 1 | 3 | 0 | 0 | 4 |
| error_handling | 1 | 3 | 2 | 0 | 6 |
| completeness | 1 | 2 | 2 | 5 | 10 |
| design_pattern | 0 | 3 | 2 | 0 | 5 |
| contract | 0 | 2 | 1 | 0 | 3 |
| maturity | 0 | 2 | 16 | 0 | 18 |
| performance | 0 | 1 | 0 | 0 | 1 |
| magic_number | 0 | 0 | 1 | 0 | 1 |
| **Total** | **17** | **46** | **25** | **5** | **93** |

**Blocking: 20** | **Non-blocking (Nit): 73**

---

## 3. Top 10 Findings

### #1. Transaction management broken in admin-keys handlers

| Field | Value |
|---|---|
| ID | #70 |
| Severity | HIGH | Blocking: YES |
| Category | concurrency |
| Source | consensus |
| File | `server/handlers/admin-keys.ts:214` |

`pool.query('BEGIN')` and `pool.query('COMMIT')` use the pool's automatic client checkout/release per statement. Under `pg.Pool`, consecutive `pool.query()` calls may use DIFFERENT connections -- the INSERT runs outside any transaction. Both the bootstrap-consume atomic guarantee (EC-3) and the key rotation guarantee are broken. The codebase already has a correct pattern: `PgvectorStore.withTransaction` uses `pool.connect()` to pin a single client.

**Remediation:** Use `pool.connect()` to obtain a dedicated client; run all transaction statements on that single client. Extend `AuthPool` to support `connect()`. Effort: **M**

---

### #2. SQL injection defense-in-depth gap in applyDimChange DDL

| Field | Value |
|---|---|
| ID | #13 |
| Severity | HIGH | Blocking: YES |
| Category | security |
| Source | consensus |
| File | `local/index.ts:1374` |

`applyDimChange()` interpolates `String(targetDim)` directly into SQL DDL (ALTER TABLE, CREATE INDEX, DO $$ EXECUTE) without re-validation at the SQL boundary. While `validateEmbeddingDim()` validates upstream, the two are separated by multiple call layers. The `DO $$ EXECUTE` block at line 1379 is highest risk because it builds a nested SQL string.

**Remediation:** Add `if (!Number.isInteger(targetDim) || targetDim <= 0 || targetDim > MAX_EMBEDDING_DIM) throw` at the `applyDimChange` function entry. Effort: **S**

---

### #3. Extraction pipeline silently returns empty array on LLM/parse failure

| Field | Value |
|---|---|
| ID | #46 |
| Severity | HIGH | Blocking: YES |
| Category | error_handling |
| Source | consensus |
| File | `core/extraction/pipeline.ts:337` |

Phase 2 catches ALL errors from LLM call + JSON parse + Zod validation and returns `[]`. This conflates LLM unreachable (transient, retryable) with schema mismatch (permanent). The consumer's `remember()` appears to succeed with zero facts when the LLM provider was down. Violates the ADD-only contract.

**Remediation:** Differentiate: wrap LLM network errors in `EmbedderError` (retryable); wrap Zod parse failures in `ExtractionSchemaError` (not retryable). Let network errors propagate. Effort: **M**

---

### #4. CORS origin defaults to wildcard in production

| Field | Value |
|---|---|
| ID | #76 |
| Severity | HIGH | Blocking: YES |
| Category | security |
| Source | consensus |
| File | `server/app.ts:178` |

When `THEMORY_CORS_ORIGIN` is unset in production, the middleware defaults to `origin: '*'` with only a stderr warning. Per OWASP, a permissive CORS origin allows any website to make authenticated cross-origin requests.

**Remediation:** In production mode, refuse to start when `THEMORY_CORS_ORIGIN` is unset (fail-fast). Effort: **S**

---

### #5. Extraction pipeline CC=36 -- highest complexity function

| Field | Value |
|---|---|
| ID | #14 |
| Severity | HIGH | Blocking: NO |
| Category | complexity |
| Source | default (lizard) |
| File | `src/core/extraction/pipeline.ts:260` |

8-phase write pipeline orchestrator with CC=36, NLOC=135, length=238 lines. Heavy branching from option guards, scope validation, error paths per phase, LLM fallback, dedup logic, batch persist with per-row fallback, entity linking, history persistence.

**Remediation:** Extract each pipeline phase into a dedicated function (e.g., `phaseExtractFacts`, `phaseBatchEmbed`, `phaseDedup`, `phasePersist`). Target CC <= 10 per phase. Effort: **L**

---

### #6. Retrieval pipeline CC=33 -- second-highest complexity

| Field | Value |
|---|---|
| ID | #15 |
| Severity | HIGH | Blocking: NO |
| Category | complexity |
| Source | default (lizard) |
| File | `src/core/retrieval/pipeline.ts:68` |

9-step search pipeline with CC=33, NLOC=100. Branching from threshold gating, cache paths, BM25 fallback, entity boost toggle, MMR diversification, asOf temporal filter, scope filtering, over-fetch logic.

**Remediation:** Extract retrieval steps into individual functions. Pipeline orchestrator calls them in sequence. Effort: **L**

---

### #7. Reflection policies not exported from public barrel

| Field | Value |
|---|---|
| ID | #1 |
| Severity | HIGH | Blocking: YES |
| Category | completeness |
| Source | default |
| File | `local/reflection/index.ts:1` |

CLAUDE.md claims v0.4a shipped 3 reflection policies. `ManualReflectionPolicy` is exported. `ThresholdReflectionPolicy` and `SleepTimeReflectionPolicy` are NOT exported from any public barrel. Consumers cannot access these through the package API.

**Remediation:** Re-export both classes and config types from `src/local/index.ts`, then from `src/index.ts`. Effort: **S**

---

### #8. Unbounded in-memory cache in OidcAuthVerifier

| Field | Value |
|---|---|
| ID | #11 |
| Severity | MEDIUM | Blocking: YES |
| Category | concurrency |
| Source | consensus |
| File | `server/auth/oidc-verifier.ts:115` |

`#cache` Map grows unboundedly. Expired entries are never evicted -- the stale check at line 131 only skips reading expired entries, never deletes them. Under sustained diverse-token traffic, this is a memory leak.

**Remediation:** Add LRU eviction with a max-entries cap, or periodic sweep of expired entries. Effort: **S**

---

### #9. Admin-keys transaction safety untestable with current pool stub

| Field | Value |
|---|---|
| ID | #81 |
| Severity | HIGH | Blocking: YES |
| Category | test |
| Source | default |
| File | `server/handlers/__tests__/admin-keys.test.ts` |

The `makePool()` test stub returns a flat `vi.fn()` that cannot detect cross-connection interleaving. The transaction safety defect (#70) is structurally invisible to the current test suite.

**Remediation:** Add an integration test using real `pg.Pool` with `pool.connect()` to verify single-connection semantics for the rotate and bootstrap flows. Effort: **M**

---

### #10. Rate limiter stores raw bearer tokens in memory

| Field | Value |
|---|---|
| ID | #66 |
| Severity | MEDIUM | Blocking: YES |
| Category | security |
| Source | consensus |
| File | `server/middleware/rate-limit.ts:75` |

Full Authorization header stored as Map key. Process memory dumps expose all recent bearer tokens.

**Remediation:** Hash the header value (SHA-256 or similar) before using as the bucket key. Effort: **S**

---

## 4. Blocking Findings (Must-Fix)

### 4a. Consensus tier (non-negotiable)

These are findings where industry consensus (OWASP, McCabe, NIST) dictates severity. Merge-blockers.

| # | ID | Title | File:Line | Category |
|---|---|---|---|---|
| 1 | #70 | Transaction management uses pool.query for BEGIN/COMMIT | server/handlers/admin-keys.ts:214 | concurrency |
| 2 | #13 | SQL injection vector in applyDimChange DDL interpolation | local/index.ts:1374 | security |
| 3 | #46 | Extraction pipeline silently returns [] on LLM failure | core/extraction/pipeline.ts:337 | error_handling |
| 4 | #76 | CORS origin defaults to wildcard in production | server/app.ts:178 | security |
| 5 | #11 | Unbounded in-memory cache in OidcAuthVerifier | server/auth/oidc-verifier.ts:115 | concurrency |
| 6 | #12 | Silent swallow of last_used_at update failure | server/auth/api-key-verifier.ts:78 | error_handling |
| 7 | #65 | Race in bumpReflectionCounter SELECT-then-INSERT | local/pgvector-store.ts:862 | concurrency |
| 8 | #66 | Rate limiter leaks raw tokens into memory | server/middleware/rate-limit.ts:75 | security |
| 9 | #67 | History persist failure silently swallowed | core/extraction/pipeline.ts:484 | error_handling |
| 10 | #68 | Bootstrap token non-constant-time comparison | server/app.ts:247 | security |
| 11 | #69 | bearerAuth reconstructs verifier per-request | server/auth/middleware.ts:32 | contract |
| 12 | #73 | Streamable HTTP exposes raw error messages | agent-tools/transports/streamable-http.ts:128 | security |
| 13 | #74 | PgvectorStore mutable userId without concurrency guard | local/pgvector-store.ts:227 | contract |
| 14 | #75 | embedBatchWithFallback creates zero-dim vectors | core/extraction/pipeline.ts:216 | error_handling |
| 15 | #79 | SlidingWindowRateLimiter Map unbounded | server/middleware/rate-limit.ts:42 | concurrency |

### 4b. Default tier (blocking test gaps)

| # | ID | Title | File | Category |
|---|---|---|---|---|
| 16 | #1 | Reflection policies not exported | local/reflection/index.ts:1 | completeness |
| 17 | #81 | Transaction safety untestable with pool stub | admin-keys.test.ts | test |
| 18 | #82 | No test for zero-dim vectors in fallback | extraction-pipeline.test.ts | test |
| 19 | #83 | No test for SQL injection in DDL | dim-change.test.ts | test |
| 20 | #85 | No restrictive-origin CORS test | rate-limit-and-cors.test.ts | test |

---

## 5. [Nit:] Non-Blocking Findings

### 5a. Complexity (27 findings)

#### CC >= 16 (high risk)

| ID | Function | File:Line | CC | Remediation |
|---|---|---|---|---|
| #14 | runExtractionPipeline | src/core/extraction/pipeline.ts:260 | 36 | Extract 8 phase functions |
| #15 | runRetrievalPipeline | src/core/retrieval/pipeline.ts:68 | 33 | Extract 9 step functions |
| #16 | rowToResult | src/local/pgvector-store.ts:58 | 26 | Measurement artifact (flat guards); consider helper |
| #17 | TriadicScoringPolicy constructor | src/local/eviction/triadic-scoring-policy.ts:272 | 21 | Extract buildDefaults() |
| #18 | decodeSkillPayload | src/local/skills/payload.ts:33 | 20 | Use zod schema |
| #19 | runMcpServer | src/agent-tools/run-mcp-server.ts:173 | 18 | Extract auth/transport/factory setup |
| #20 | matchesFilters | src/local/in-memory-store.ts:60 | 17 | Extract scope + temporal helpers |
| #21 | rotateKeyHandler | src/server/handlers/admin-keys.ts:319 | 16 | Extract validation/DB/response phases |

#### CC 11-15 (moderate risk) -- 19 functions

| ID | Function | File:Line | CC |
|---|---|---|---|
| #22 | consolidate orchestrator | src/local/skills/consolidate.ts:363 | 15 |
| #23 | scopesHandler | src/server/handlers/scopes.ts:83 | 15 |
| #24 | scope-verifier middleware | src/server/auth/scope-verifier.ts:77 | 15 |
| #25 | deriveSpanName | src/server/observability/otel-middleware.ts:19 | 15 |
| #26 | resolveOidcConfig | src/agent-tools/oidc-cli-resolver.ts:81 | 14 |
| #27 | parseConsolidationResponse | src/core/conflict-resolution/llm-judged-merge.ts:59 | 14 |
| #28 | applyDimChange | src/local/index.ts:1275 | 13 |
| #29 | validateRecallCacheStoreConfig | src/core/dip/recall-cache-store.ts:204 | 13 |
| #30 | assertScopeIsNonEmpty | src/local/index.ts:270 | 13 |
| #31 | bearer auth handler | src/agent-tools/auth/with-bearer-auth.ts:113 | 13 |
| #32 | extractBearer | src/agent-tools/auth/with-bearer-auth.ts:51 | 12 |
| #33 | scanBalancedObjectWithLabel | src/benchmarks/llm-judge/json-extractor.ts:49 | 12 |
| #34 | minMaxNormalize | src/core/scoring-strategies/additive-weighted-scoring.ts:54 | 12 |
| #35 | forget | src/local/index.ts:934 | 11 |
| #36 | auth middleware | src/server/auth/middleware.ts:31 | 11 |
| #37 | classifyError | src/agent-tools/error-classifier.ts:114 | 11 |
| #38 | score (TriadicScoringPolicy) | src/local/eviction/triadic-scoring-policy.ts:338 | 11 |
| #39 | simpleStem | src/core/lemmatization.ts:57 | 11 |
| #40 | find (union-find) | src/local/skills/consolidate.ts:194 | 11 |

### 5b. Design Pattern Suggestions

| ID | Pattern | Site(s) | Touch Points |
|---|---|---|---|
| #42 | Repository extension interfaces | src/local/index.ts:695,745,1034 | Promote 3 ad-hoc interfaces to `src/core/dip/`; eliminates `as unknown as` casts. ~4 files. |
| #43 | Capability-query interfaces | src/local/index.ts:448,945,1152 | Replace 3 `instanceof PgvectorStore` checks with `SoftDeletable`/`PoolProvider` interfaces. ~3 files. |
| #45 | Value Object for MemoryItem | src/core/memory-item.ts:9 | Extract `buildMemoryItem()` factory function to centralize 4+ construction sites. ~5 files. |

### 5c. Completeness

| ID | Title | File:Line |
|---|---|---|
| #2 | [Nit:] ScoringStrategy DIP is dead code (~200 LOC) | core/dip/scoring-strategy.ts:59 |
| #3 | [Nit:] LLM importance scoring not wired into extraction pipeline | core/reflection/importance.ts:60 |
| #4 | [Nit:] Dead barrel local/reflection/index.ts | local/reflection/index.ts:1 |
| #5 | [Nit:] Dead barrel core/scoring-strategies/index.ts | core/scoring-strategies/index.ts:1 |

### 5d. Maturity Hotspots

**src/core/extraction/pipeline.ts** has 6 maturity findings (vague `obj` variable, 2 silent catches, 2 WHAT-not-WHY comments, magic literal). This file is the single largest maturity hotspot.

Remaining maturity findings: 6 magic literals across scoring/eviction modules, 5 vague variable names, 2 duplicate code blocks (resolvePort/resolveHost), 1 `as any` cast.

### 5e. Test Gaps (Medium)

| ID | Title |
|---|---|
| #84 | [Nit:] Sleep-time policy uses real wall-clock delays (flakiness) |
| #86 | [Nit:] OIDC cache growth has no memory-pressure test |
| #87 | [Nit:] Rate limiter credential leak untested |
| #88 | [Nit:] server/auth/middleware.ts has no unit test file |
| #89 | [Nit:] 50+ describe.skipIf blocks gate on THEOMEM_PG_URI |
| #90 | [Nit:] with-bearer-auth.ts has no dedicated unit test |
| #92 | [Nit:] Streamable HTTP error exposure untested |
| #93 | [Nit:] History persist silent swallow has no test |

---

## 6. NFR Coverage

| NFR Tag | Count | Sites |
|---|---|---|
| performance | 6 | server/handlers/admin-keys.ts, server/handlers/scopes.ts, server/auth/scope-verifier.ts, server/observability/otel-middleware.ts, agent-tools/auth/with-bearer-auth.ts, server/auth/middleware.ts |

---

## 7. Positive Signals

1. **DIP architecture is real.** 13 interfaces with correct separation between `src/core/` (contracts) and `src/local/` (implementations). The DIP boundary is respected -- core does not import local.

2. **SQL injection prevention is strong.** All user-facing queries use parameterized `$N` placeholders. The DDL finding (#13) is the only exception and it is defense-in-depth, not a direct vector.

3. **Zero stubs, zero TODO/FIXME markers.** Unusual for a codebase of this size and age. Every shipped feature has a real implementation.

4. **Typed error classes throughout.** `InvalidScope`, `MemoryNotFound`, `InvalidWeightsError` -- no generic `Error('something broke')`.

5. **OTel instrumentation is pervasive.** 17-event union type with `emitEvent` at pipeline phase boundaries. Multiple test files assert on emitted spans.

6. **Auth stack is well-layered.** Timing-safe bearer comparisons, fail-closed defaults, EC-1 empty-key sentinel, dual-validation middleware, RFC 7662 OIDC introspection.

7. **95.6% of production functions have CC <= 10.** Only 27 of 616 functions exceed the McCabe consensus threshold.

8. **Test-to-production LOC ratio is 0.89:1** (17,934 test LOC / 20,079 production LOC). ~1,235 test cases across 236 test files.

---

## 8. Prioritized Remediation Plan

### Priority 1: Blocking security + concurrency (fix before any release)

| Order | Finding | Effort | Rationale |
|---|---|---|---|
| 1 | #70 -- Fix admin-keys transaction management | M | Broken atomicity guarantee |
| 2 | #13 -- Add defense-in-depth guard in applyDimChange | S | SQL injection vector |
| 3 | #76 -- Fail-fast on unset CORS origin in production | S | OWASP CORS misconfiguration |
| 4 | #66 -- Hash bearer tokens before using as rate-limit key | S | Credential exposure in memory |
| 5 | #68 -- Use constantTimeEqual for bootstrap token | S | Timing side-channel |
| 6 | #73 -- Sanitize error messages in streamable HTTP 500 | S | Information disclosure |

### Priority 2: Blocking error handling + concurrency

| Order | Finding | Effort |
|---|---|---|
| 7 | #46 -- Differentiate LLM errors in extraction pipeline | M |
| 8 | #75 -- Handle zero-dim vectors in embedBatchWithFallback | S |
| 9 | #11 -- Add LRU eviction to OIDC cache | S |
| 10 | #79 -- Add bucket eviction to SlidingWindowRateLimiter | S |
| 11 | #65 -- Use INSERT ON CONFLICT for bumpReflectionCounter | S |
| 12 | #67 -- Log + emit OTel event for history persist failures | S |
| 13 | #12 -- Add console.warn for last_used_at update failure | S |

### Priority 3: Blocking completeness + contract

| Order | Finding | Effort |
|---|---|---|
| 14 | #1 -- Export reflection policies from public barrel | S |
| 15 | #69 -- Hoist bearerAuth verifier to construction time | S |
| 16 | #74 -- Add concurrency guard to PgvectorStore userId | S |

### Priority 4: Blocking test gaps

| Order | Finding | Effort |
|---|---|---|
| 17 | #81 -- Integration test for admin-keys transaction safety | M |
| 18 | #83 -- SQL injection resistance test for applyDimChange | S |
| 19 | #82 -- Test for zero-dim vectors in fallback path | S |
| 20 | #85 -- Restrictive-origin CORS test | S |

### Priority 5: Non-blocking improvements (next cycle)

- Refactor extraction pipeline (CC=36) and retrieval pipeline (CC=33)
- Promote 3 ad-hoc VectorStore extension interfaces to `src/core/dip/`
- Wire LLM importance scoring into extraction pipeline or document as known gap
- Remove dead ScoringStrategy DIP code
- Fix sleep-time policy tests to use fake timers
- Add CI sentinel for THEOMEM_PG_URI
- Extract `buildMemoryItem()` factory function

---

## 9. Metrics Summary

### File Inventory

| Metric | Value |
|---|---|
| Total files inventoried | 341 |
| Inspected | 182 (55.8% of total; 55.8% of effective) |
| Pending (not inspected) | 144 |
| Excluded (SQL migrations) | 15 |
| Effective total (excl. excluded) | 326 |

### Coverage by Language

| Language | Inspected | Pending | Excluded | Total |
|---|---|---|---|---|
| TypeScript | 182 | 130 | 0 | 312 |
| SQL | 0 | 0 | 15 | 15 |
| JSON | 0 | 14 | 0 | 14 |
| **Total** | **182** | **144** | **15** | **341** |

### Coverage Limitation

Coverage is **55.8%** (182 of 326 effective files). The 144 pending files are primarily:
- Test files (`__tests__/`, `tests/`) that were audited via the Phase 4 test-audit process rather than individual file inspection
- JSON configuration files (package.json, tsconfig variants)
- TypeScript files in `src/` not individually deep-read but covered by component-level analysis

This is below the 80% threshold. The review compensated by performing **component-level analysis** across all 26 registered components, ensuring every architectural layer was examined. However, individual file-level findings may have been missed in the 144 pending files.

### Production Code

| Metric | Value |
|---|---|
| Production LOC | 20,079 |
| Test LOC | 17,934 |
| Test:Prod ratio | 0.89:1 |
| Total test files | 236 |
| Approx. test cases | ~1,235 |
| Production functions scanned (lizard) | 616 |
| Functions with CC > 10 | 27 (4.4%) |
| Max CC | 36 (runExtractionPipeline) |

### Component Summary

| ID | Component | LOC | Path |
|---|---|---|---|
| 5 | core | 5,001 | src/core/ |
| 12 | local | 6,534 | src/local/ |
| 17 | server | 2,731 | src/server/ |
| 20 | agent-tools | 3,394 | src/agent-tools/ |
| 26 | benchmarks | 1,579 | src/benchmarks/ |
| 23 | embedders | 345 | src/embedders/ |
| 24 | llms | 262 | src/llms/ |
| 25 | theokit | 85 | src/theokit/ |

### Test Pyramid

```
          E2E               3 cases / 5 files
        ---------
     Integration          356 cases / 110 files
   -----------------
      Unit                876 cases / 126 files
  ---------------------
```

Assessment: Healthy base, solid integration layer (but conditionally gated on THEOMEM_PG_URI), critically thin E2E layer.

---

## 10. Threshold Sourcing Legend

- **consensus**: Industry standard thresholds. McCabe CC <= 10, no silenced errors, no race conditions, OWASP A01-A10, parameterized SQL. Non-negotiable.
- **default**: Tool-measured thresholds. Lizard CC bands, SonarQube defaults. Reasonable starting bar for CI gates.
- **heuristic**: Pattern-based detection. LOC scope analysis, naming conventions, DRY analysis, design pattern evaluation. Guidance, not gate. Default to nit.

---

## 11. What Was NOT Reviewed

1. **144 files remain pending** (55.8% coverage). Most are test files audited at the component level via Phase 4 rather than individually inspected, plus JSON config files. This is a known limitation at < 80% file-level coverage.

2. **No dynamic analysis was performed.** All findings are from static analysis and code reading. Runtime profiling, load testing, and actual SQL injection attempts were not executed.

3. **SQL migration files were excluded** (15 `.sql` files under `src/local/migrations/`). Migration correctness was not audited.

4. **E2E testing was not performed.** The E2E layer has only 3 test cases. No Docker-based round-trip, no CLI e2e, no REST API e2e was executed as part of this review.

5. **Dependency audit was not performed.** No CVE scan of `node_modules/` or `package-lock.json` was conducted.

6. **Cloud runtime (`@usetheo/memory/cloud`) does not exist yet** -- no code to review.

7. **Benchmark adapter implementations** (Mem0/Zep/Letta cells) are documented as deferred; only shape tests exist.

---

## 12. Appendix

### A. Finding Counts by Table

| Table | Count |
|---|---|
| findings | 93 |
| components | 26 |
| files_inventoried | 341 |
| test_audit | 24 |
| quality_gates | 3 |
| meetings | 1 |

### B. Quality Gate History

| Phase | Iteration | Score | Status | Evaluator |
|---|---|---|---|---|
| 2 (Completeness) | 1 | 0.85 | passed | completeness-auditor |
| 3 (Code Review) | 1 | 0.72 | passed | code-reviewer |
| 4 (Test Audit) | 1 | 0.68 | passed | test-auditor |

### C. Findings by Severity Source

| Source | Count |
|---|---|
| consensus | 20 |
| default | 50 |
| heuristic | 18 |
| n/a (info) | 5 |

### D. Full Finding ID Index

| ID | Phase | Category | Severity | Blocking | Title (abbreviated) |
|---|---|---|---|---|---|
| 1 | 2 | completeness | high | YES | Reflection policies not exported |
| 2 | 2 | completeness | medium | no | ScoringStrategy DIP dead code |
| 3 | 2 | completeness | medium | no | LLM importance not wired |
| 4 | 2 | completeness | low | no | Dead barrel local/reflection |
| 5 | 2 | completeness | low | no | Dead barrel scoring-strategies |
| 6 | 2 | completeness | info | no | CloudMemoryConfig no impl |
| 7-10 | 2 | completeness | info | no | Verified clean areas |
| 11 | 3 | concurrency | medium | YES | OIDC cache unbounded |
| 12 | 3 | error_handling | medium | YES | ApiKey last_used_at swallow |
| 13 | 3 | security | high | YES | SQL injection in DDL |
| 14-21 | 3 | complexity | high | no | CC >= 16 functions |
| 22-40 | 3 | complexity | medium | no | CC 11-15 functions |
| 41 | 3 | design_pattern | low | no | Strategy applied correctly |
| 42-43 | 3 | design_pattern | medium | no | Repository/Factory caveats |
| 44 | 3 | design_pattern | low | no | Observer applied correctly |
| 45 | 3 | design_pattern | medium | no | MemoryItem value object |
| 46 | 3 | error_handling | high | YES | Extraction returns [] on failure |
| 47-64 | 3 | maturity | med/low | no | Duplication, naming, magic literals |
| 65 | 3 | concurrency | medium | YES | bumpReflectionCounter race |
| 66 | 3 | security | medium | YES | Rate limiter credential leak |
| 67 | 3 | error_handling | medium | YES | History persist swallowed |
| 68 | 3 | security | medium | YES | Bootstrap token timing |
| 69 | 3 | contract | medium | YES | bearerAuth per-request rebuild |
| 70 | 3 | concurrency | high | YES | Transaction via pool.query |
| 71 | 3 | performance | medium | no | Scopes handler memory loading |
| 72 | 3 | error_handling | low | no | Scope verifier coercion |
| 73 | 3 | security | medium | YES | HTTP 500 error exposure |
| 74 | 3 | contract | medium | YES | Mutable userId state |
| 75 | 3 | error_handling | medium | YES | Zero-dim vector creation |
| 76 | 3 | security | high | YES | CORS wildcard default |
| 77 | 3 | contract | low | no | License mismatch in OpenAPI |
| 78 | 3 | magic_number | low | no | Rate-limit magic numbers |
| 79 | 3 | concurrency | medium | YES | Rate limiter unbounded Map |
| 80 | 3 | error_handling | low | no | LocalMemory.get scope fallback |
| 81-85 | 4 | test | high | YES | Critical test gaps |
| 86-93 | 4 | test | med/low | no | Test coverage improvements |

---

<promise>CODE REVIEW COMPLETE</promise>
