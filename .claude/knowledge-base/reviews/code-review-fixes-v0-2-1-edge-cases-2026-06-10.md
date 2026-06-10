# Edge Case Review -- code-review-fixes-v0-2-1

Date: 2026-06-10
Tasks analyzed: 17
Edge cases found: 8 (MUST FIX: 3, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: timingSafeEqual throws on different-length buffers

- **Affected task:** T1.4
- **Family:** Input / Boundary
- **Scenario:** `crypto.timingSafeEqual` throws `RangeError` when the two buffers have different lengths. If the bootstrap token in env is a different length than the token sent by the client (common — attacker sends short/long probe), the server crashes with an unhandled error instead of returning 401.
- **Impact:** Denial of service — any request with a wrong-length token crashes the handler.
- **Suggested fix:** Guard with length check BEFORE calling `timingSafeEqual`: `if (Buffer.byteLength(a) !== Buffer.byteLength(b)) return false;` — the plan mentions this inline but does not list it as a separate acceptance criterion. Make it an explicit AC.

### EC-2: CORS production guard must not break existing tests

- **Affected task:** T1.2
- **Family:** State / Integration
- **Scenario:** Many existing integration tests call `createApp()` without setting `NODE_ENV`. If the guard checks `NODE_ENV === 'production'` AND `THEMORY_CORS_ORIGIN` is unset, tests are unaffected (they run in `test` mode). BUT if any test fixture sets `NODE_ENV=production` (e.g., for OIDC or TLS tests), it will now throw unexpectedly unless that fixture also sets `THEMORY_CORS_ORIGIN`.
- **Impact:** Cascade of test failures in unrelated test suites.
- **Suggested fix:** In the CORS guard, also check `process.env.NODE_ENV !== 'test'` — or better, pass the production-mode flag via `createApp({ production: true })` options rather than reading env directly, so tests can control it explicitly.

### EC-3: pool.connect() + client.release() must handle ROLLBACK on error

- **Affected task:** T3.1
- **Family:** State / Resource
- **Scenario:** If the code between `client.query('BEGIN')` and `client.query('COMMIT')` throws, the `finally` block calls `client.release()`. But the connection is returned to the pool with an open transaction. The next consumer of that connection inherits the aborted transaction state, causing silent failures.
- **Impact:** Connection pool poisoning — subsequent queries on that connection fail with `current transaction is aborted`.
- **Suggested fix:** Add `await client.query('ROLLBACK').catch(() => {})` in the `catch` block BEFORE `client.release()`. Pattern: `try { BEGIN; ...; COMMIT } catch { ROLLBACK; throw } finally { release }`.

## SHOULD TEST

### EC-4: SHA-256 hash collision in rate limiter (probabilistic safety)

- **Affected task:** T1.3
- **Suggested test:** `test('two different tokens with same hash prefix are rate-limited independently')` — verify that SHA-256 full hex (64 chars) is used as key, not a truncated prefix. The implementation should use `.digest('hex')` (not `.digest('base64')` truncated). A simple assertion on key length (`expect(key.length).toBe(64)`) in the unit test suffices.

### EC-5: OIDC cache eviction under concurrent inserts

- **Affected task:** T3.2
- **Suggested test:** `test('cache eviction is safe when multiple tokens arrive in burst')` — insert `maxEntries * 1.5` tokens in a tight loop; assert final size <= `maxEntries` and no entry was lost that should have been kept (most-recently-inserted survive).

### EC-6: Extraction pipeline error classification false positive

- **Affected task:** T2.1
- **Suggested test:** `test('LLM error with misleading message is not classified as parse error')` — an LLM that throws `new Error('JSON parse failed')` (network error with misleading message) should NOT be swallowed as a parse error. The classification should check error TYPE (e.g., `instanceof ZodError` or `instanceof SyntaxError`), not the error MESSAGE string.

## DOCUMENT

### EC-7: rate limiter sweep cost under high cardinality

- **Accepted risk:** T3.4's sweep iterates the entire Map when `size >= MAX_BUCKETS`. At 100k entries, this is a ~1ms scan per request that triggers eviction. Acceptable for a single-process in-memory limiter. If cardinality grows beyond 100k unique keys/minute, the solution is to move to Redis — out of scope for this plan.

### EC-8: `readonly` on userId is compile-time only

- **Accepted risk:** T4.3's `readonly` modifier is TypeScript-only; at runtime, `Object.assign` or `(store as any).userId = 'x'` can bypass it. The finding (#74) is about accidental mutation in TypeScript code, not deliberate runtime tampering. Compile-time guard is sufficient for this threat model.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 1 | 1 (EC-2) | 0 | 0 |
| T1.3 | 1 | 0 | 1 (EC-4) | 0 |
| T1.4 | 1 | 1 (EC-1) | 0 | 0 |
| T1.5 | 0 | 0 | 0 | 0 |
| T1.6 | 0 | 0 | 0 | 0 |
| T2.1 | 1 | 0 | 1 (EC-6) | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T2.3 | 0 | 0 | 0 | 0 |
| T3.1 | 1 | 1 (EC-3) | 0 | 0 |
| T3.2 | 1 | 0 | 1 (EC-5) | 0 |
| T3.3 | 0 | 0 | 0 | 0 |
| T3.4 | 1 | 0 | 0 | 1 (EC-7) |
| T4.1 | 0 | 0 | 0 | 0 |
| T4.2 | 0 | 0 | 0 | 0 |
| T4.3 | 1 | 0 | 0 | 1 (EC-8) |
| T4.5.* | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — 3 MUST FIX items require absorption into v1.1 before `/plan-confidence`.
