# Phase 4 -- Test Audit Report

**Project:** `@usetheo/memory` (TheMemory)
**Date:** 2026-06-10
**Agent:** test-auditor
**Target:** `<HOME>/Projetos/usetheo/theo-data/theo-memory/src` + `tests/`

---

## 1. Test Inventory Summary

| Metric | Value |
|---|---|
| Total test files (src/ + tests/) | 236 |
| Test files in `src/` (co-located) | 126 |
| Test files in `tests/` (standalone) | 110 |
| Total test LOC | 17,934 |
| Production LOC | 20,079 |
| Test-to-prod ratio | 0.89:1 |
| Approx. test cases (grep `test(`) | ~1,235 |

### Per-component test file count

| Component (ID) | Dedicated test files | Approx test cases |
|---|---|---|
| core (5) | 25 unit + 10 type-level | ~401 |
| local (12) | 22 unit + ~40 integration | ~223 unit + ~200 integration |
| server (17) | 14 unit + ~10 integration | ~133 |
| agent-tools (20) | 19 unit + ~5 integration | ~59 |
| embedders (23) | 4 unit | ~11 |
| llms (24) | 3 unit | ~12 |
| benchmarks (26) | 14 unit + 5 e2e | ~40 |
| theokit (25) | 2 unit | ~5 |

---

## 2. Test Pyramid Balance

```
          E2E                3 test cases across 5 files
        ---------
     Integration           356 test cases across 110 files
   -----------------
      Unit                 876 test cases across 126 files
  ---------------------
```

### Assessment

**Pyramid shape: HEALTHY at base, THIN at top.**

- **Unit layer (876+):** Strong. Core extraction/retrieval, scoring, dedup, DIP shapes, eviction math, conflict resolution all have dedicated unit tests. Mock/stub usage is extensive and appropriate (1064 mock-related lines found).
- **Integration layer (356+):** Solid but conditionally gated. 50+ test suites use `describe.skipIf(PG_URI === '')`. Without a pgvector container, ~60% of integration tests silently skip.
- **E2E layer (3):** Critically thin. Only benchmark smoke tests and one agent-tools round-trip. No REST API e2e, no CLI e2e, no Docker e2e.

### Pyramid signals

| Signal | Count | Assessment |
|---|---|---|
| Mock/stub/spy references | 1,064 lines | Healthy unit test base |
| Database/pgvector references | 841 lines | Strong integration coverage |
| E2e/round-trip references | 10 lines | Minimal e2e layer |
| describe.skip / describe.skipIf | 50+ blocks | High conditional-skip surface |

---

## 3. Coverage Gap Analysis (Cross-referenced with Phase 3 Findings)

### 3.1 HIGH severity Phase 3 findings vs test coverage

| Finding # | Phase 3 Title | Test Status | Gap |
|---|---|---|---|
| #13 | SQL injection in applyDimChange | **UNTESTED** | dim-change.test.ts uses only valid integers; no malicious input test |
| #14 | Extraction pipeline CC=36 | Partial (11 tests) | 8 phases but only ~4 distinct phase-failure tests; embedBatchWithFallback zero-dim vector path untested |
| #15 | Retrieval pipeline CC=33 | Partial (11 tests) | 9 steps but BM25/entity boundary math untested |
| #16 | rowToResult CC=26 | Indirect only | Tested through pgvector-store integration; no unit test for all 26 branches |
| #17 | TriadicScoringPolicy CC=21 | Good | scoring-math.test.ts + triadic-scoring-options.test.ts cover math well |
| #18 | decodeSkillPayload CC=20 | Good | payload.test.ts has edge case coverage |
| #19 | runMcpServer CC=18 | Indirect only | Tested through cli-consolidated integration; no unit test for error branches |
| #20 | matchesFilters CC=17 | Good | Three test files (store + category + temporal) |
| #21 | rotateKeyHandler CC=16 | **UNTESTED for transaction safety** | Test 13 simulates 5-query sequence but single mock cannot detect cross-connection race |
| #46 | Extraction silent empty-array return | Partial | EC-10 test covers malformed JSON but not LLM timeout/network failure |
| #70 | Transaction management via pool.query | **UNTESTED** | No test verifies BEGIN/COMMIT use same connection |
| #75 | embedBatchWithFallback zero-dim vectors | **UNTESTED** | Batch failure tested but per-row failure in fallback path not tested |
| #76 | CORS wildcard default | **ANTI-TEST** | Test asserts the insecure default `*` as correct behavior |

### 3.2 MEDIUM severity Phase 3 findings vs test coverage

| Finding # | Phase 3 Title | Test Status |
|---|---|---|
| #11 | OIDC unbounded cache | No memory-pressure test |
| #12 | ApiKey silent last_used_at swallow | No error-path test |
| #47 | Duplicate resolvePort() | No test at all (run-server.ts has no unit test) |
| #65 | bumpReflectionCounter race | Tested in threshold-policy integration but not for concurrent access |
| #66 | Rate limiter credential leak | No test for bucket key derivation |
| #67 | History persist silent swallow | No test for throwing historyManager |
| #68 | Bootstrap token timing attack | No constant-time comparison test |
| #69 | bearerAuth per-request reconstruction | No dedicated middleware test |
| #71 | Scopes handler memory loading | No pagination test |
| #73 | Streamable HTTP error exposure | No error message sanitization test |
| #74 | PgvectorStore mutable userId state | No concurrency test |
| #79 | SlidingWindowRateLimiter unbounded Map | No eviction test |

---

## 4. Flakiness Analysis

### HIGH flakiness (score >= 0.5)

| File | Score | Reason |
|---|---|---|
| `local/__tests__/reflection/sleep-time-policy.test.ts` | 0.7 | 5 of 6 tests use real `sleep(1500ms)` / `sleep(2000ms)`. Wall-clock timing for shouldReflect decisions. |

### MODERATE flakiness (score 0.1-0.4)

| File | Score | Reason |
|---|---|---|
| `server/auth/__tests__/oidc-introspect-oauth4webapi.test.ts` | 0.2 | Real setTimeout(50ms) for abort controller test (line 156) |
| `agent-tools/__tests__/scope.test.ts` | 0.1 | setTimeout(1ms) in 2 tests — minimal risk but non-deterministic |
| `tests/integration/cache/cache-hit-miss.test.ts` | 0.3 | `await sleep(2000)` for cache invalidation wait |
| `tests/integration/cache/semantic-recall-cache.test.ts` | 0.3 | `await sleep(2000)` for trigger-based invalidation |
| `tests/integration/v1-1-multi-peer-bitemporal.test.ts` | 0.2 | `setTimeout(50ms)` for temporal separation |
| `tests/integration/eviction/time-trigger.test.ts` | 0.3 | `await sleep(1500)` for cron-like trigger timing |

### Real network call risk

Several test files use Hono's `app.fetch()` for in-process HTTP testing (not real network) -- this is safe. One file (`streamable-http-auth.test.ts` line 246) uses real `fetch()` against localhost.

---

## 5. Test Quality Assessment

### Strengths

1. **Behavioral naming convention is mostly followed.** Test names like `"extracts and persists a fact"`, `"returns 400 EMPTY_NAME for empty/whitespace name"` describe behavior, not implementation.

2. **AAA pattern is consistently used.** Tests follow Arrange-Act-Assert with clear separation. JSDoc comments mark Given/When/Then blocks in many tests.

3. **Type-level tests (.test-d.ts) provide compile-time safety.** 15+ type-level test files exercise DIP interface conformance, which cannot be done with runtime tests alone.

4. **OTel span assertions.** Multiple test files assert on emitted spans/events, validating the observability layer -- rare in test suites and very valuable.

5. **Edge case tests exist for critical paths.** EC-9 (empty extraction), EC-10 (malformed JSON), EC-11 (empty query), linked_memory_ids coercion fix.

### Weaknesses

1. **Error paths are systematically undertested.** Happy paths have good coverage. Failure modes (network errors, partial failures, concurrent access, corrupt data) are rarely exercised.

2. **Integration tests are environment-gated.** The `describe.skipIf(PG_URI === '')` pattern means CI without pgvector misses ~60% of integration coverage. No sentinel test fails when PG_URI is absent.

3. **No concurrency tests.** Despite 6 concurrency findings in Phase 3, zero tests exercise parallel access, race conditions, or transaction isolation.

4. **Mock fidelity gap in admin-keys.** The `makePool()` stub returns a flat function, not a connection-aware pool. This makes the transaction safety finding (#70) structurally untestable at the unit level.

5. **Production files without any test reference:** ~130 production files have zero test file that references them by name. Many are indirectly tested through integration tests, but the coverage is implicit and fragile.

---

## 6. Findings Summary

### Phase 4 Findings (13 total)

| ID | Severity | Title |
|---|---|---|
| #81 | HIGH | Admin-keys transaction safety untestable with current pool stub |
| #82 | HIGH | No test for embedBatchWithFallback zero-dimension vectors |
| #83 | HIGH | No test validates SQL injection resistance in applyDimChange DDL |
| #84 | MEDIUM | Sleep-time policy tests use real wall-clock delays (flakiness) |
| #85 | HIGH | CORS wildcard default has no restrictive-origin test |
| #86 | MEDIUM | OIDC cache unbounded growth has no memory-pressure test |
| #87 | MEDIUM | Rate limiter credential leak in bucket key untested |
| #88 | MEDIUM | server/auth/middleware.ts has no dedicated unit test file |
| #89 | MEDIUM | 50+ integration tests conditionally skip on THEOMEM_PG_URI |
| #90 | MEDIUM | with-bearer-auth.ts has no dedicated unit test |
| #91 | LOW | E2e layer critically thin (3 tests for 4 consumer surfaces) |
| #92 | MEDIUM | Streamable HTTP error message exposure untested |
| #93 | MEDIUM | History persist failure silent swallow has no test |

### Severity distribution

- **HIGH:** 4 findings (transaction safety, zero-dim vectors, SQL injection, CORS wildcard)
- **MEDIUM:** 8 findings (flakiness, cache growth, credential leak, missing test files, conditional skips, error exposure, history swallow)
- **LOW:** 1 finding (e2e layer thin)

---

## 7. Test Audit Rows Registered

24 test audit rows registered to the database covering all 26 components.

---

## 8. Recommendations

### Immediate (blocks P0 hardening claim)

1. **Add SQL injection validation test** for `applyDimChange` with non-integer `targetDim` values.
2. **Add integration test for admin-keys transaction safety** using real `pg.Pool` with `pool.connect()` to verify single-connection semantics.
3. **Fix sleep-time policy tests** to use `vi.useFakeTimers()` instead of real wall-clock delays.
4. **Add CI sentinel** that fails when `THEOMEM_PG_URI` is empty, preventing silent integration test skips.

### Short-term (next hardening cycle)

5. Add extraction pipeline test for per-row embed failure creating zero-dimension vectors.
6. Add CORS origin override test (THEMORY_CORS_ORIGIN env).
7. Add streamable-http error sanitization test.
8. Add auth middleware unit test file.
9. Add with-bearer-auth unit test file.

### Structural

10. Add at least one REST API round-trip e2e test.
11. Add concurrency tests for the 6 concurrency findings from Phase 3.
12. Add OIDC cache size regression test.

---

## 9. Phase 3 Cross-Reference Assessment

Of the 10 HIGH-severity findings from Phase 3 (code review), **4 have no test coverage at all** for the specific defect identified, and **3 more have only partial coverage** that tests the happy path but not the identified failure mode. Only the eviction/matchesFilters/decodeSkillPayload findings (#17, #18, #20) have test coverage that would catch regressions.

This gap between code-review findings and test coverage is the most significant structural risk in the test suite. The test suite protects what works; it does not protect against the specific failure modes identified by the code review.

<!-- PHASE_4_COMPLETE -->
