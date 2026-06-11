# Phase 3 Code Review Findings Report

**Target:** `src/` of `@usetheo/memory`
**Reviewer:** code-reviewer (Claude Opus 4.6)
**Date:** 2026-06-10
**Files inspected:** 22 production source files across server/, local/, core/, agent-tools/

---

## Summary

| Severity | Count | Blocking |
|----------|-------|----------|
| Critical | 0     | --       |
| High     | 4     | Yes      |
| Medium   | 9     | Varies   |
| Low      | 3     | No       |
| **Total**| **16**|          |

The codebase demonstrates strong security discipline overall: parameterized SQL queries throughout, timing-safe comparisons for bearer tokens, typed domain errors, and comprehensive input validation via zod schemas at REST boundaries. The findings below represent real risks that survived the existing quality process.

---

## High Severity Findings

### 1. Transaction management uses pool.query for BEGIN/COMMIT/ROLLBACK in admin-keys handlers

**File:** `server/handlers/admin-keys.ts:214`
**Category:** concurrency
**NFR:** concurrency

`pool.query('BEGIN')` and `pool.query('COMMIT')` use the pool's automatic client checkout/release per statement. Under `pg.Pool`, consecutive `pool.query()` calls may use DIFFERENT clients. This means the BEGIN, INSERT, and COMMIT could execute on different connections -- the INSERT runs outside any transaction. The atomic bootstrap-consume guarantee (EC-3) and the rotate atomic guarantee are both broken.

The codebase already has a correct pattern: `PgvectorStore.withTransaction` (pgvector-store.ts:843) uses `pool.connect()` to pin a single client.

**Remediation:** Use `pool.connect()` to obtain a dedicated client, then run all transaction statements on that single client. The `AuthPool` interface needs extension to support `connect()`.

---

### 2. Extraction pipeline silently returns empty array on LLM/parse failure

**File:** `core/extraction/pipeline.ts:337`
**Category:** error_handling

Phase 2 catches ALL errors from the LLM call + JSON parse + Zod validation and returns `[]`. This conflates LLM unreachable (transient, retryable) with schema mismatch (permanent). The consumer's `remember()` call appears to succeed with zero facts when in reality the LLM provider was down.

Per architecture.md section 8: typed errors should bubble up so callers can distinguish transient from permanent failures. The current behavior violates the ADD-only contract: the consumer thinks remember succeeded with zero facts.

**Remediation:** Let network errors propagate as `EmbedderError` so the caller can return 503. Wrap Zod parse failures in a new `ExtractionSchemaError`.

---

### 3. SQL injection defense-in-depth gap in applyDimChange DDL interpolation

**File:** `local/index.ts:1374`
**Category:** security

`applyDimChange()` interpolates `String(targetDim)` into DDL statements without re-validation at the SQL boundary. While `validateEmbeddingDim()` validates upstream, the two are separated by multiple call layers. The `DO $$ EXECUTE` block at line 1379 builds a nested SQL string from the interpolated value.

**Remediation:** Add a defense-in-depth guard at the `applyDimChange` function entry: `if (!Number.isInteger(targetDim) || targetDim <= 0 || targetDim > MAX_EMBEDDING_DIM) throw`.

---

### 4. CORS origin defaults to wildcard in production with only a stderr warning

**File:** `server/app.ts:178`
**Category:** security
**NFR:** security

When `THEMORY_CORS_ORIGIN` env is unset in production, the middleware defaults to `origin: '*'` with only a stderr warning. Per OWASP CORS Misconfiguration guidelines, a permissive CORS origin in production allows any website to make authenticated cross-origin requests.

**Remediation:** In production mode, refuse to start when `THEMORY_CORS_ORIGIN` is unset (fail-fast).

---

## Medium Severity Findings

### 5. Unbounded in-memory cache growth in OidcAuthVerifier

**File:** `server/auth/oidc-verifier.ts:115`
**Category:** concurrency

`#cache` Map grows unboundedly. Expired entries are never evicted -- the stale-entry check at line 131 only skips reading expired entries; it never deletes them.

**Remediation:** Add LRU eviction or periodic sweep.

---

### 6. Silent swallow of fire-and-forget last_used_at update failure

**File:** `server/auth/api-key-verifier.ts:78`
**Category:** error_handling

Empty catch block on the observability UPDATE. The comment claims "observability is the layer that should log" but no observability layer is wired.

**Remediation:** Add `console.warn` inside the catch block.

---

### 7. Race condition in bumpReflectionCounter SELECT-then-INSERT

**File:** `local/pgvector-store.ts:862`
**Category:** concurrency

SELECT-then-INSERT/UPDATE without transaction isolation. Concurrent calls for the same scope can both attempt INSERT, causing unique constraint violations.

**Remediation:** Use `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1`.

---

### 8. Rate limiter stores raw bearer tokens in memory

**File:** `server/middleware/rate-limit.ts:75`
**Category:** security

Full Authorization header stored as Map key. Process memory dumps expose all recent bearer tokens.

**Remediation:** Hash the header before using as key.

---

### 9. History persist failure silently swallowed in extraction pipeline

**File:** `core/extraction/pipeline.ts:484`
**Category:** error_handling

Empty catch block on history persist violates CLAUDE.md Principle 3 (auditability).

**Remediation:** Add `console.warn` + OTel event.

---

### 10. Bootstrap token comparison uses non-constant-time equality

**File:** `server/app.ts:247`
**Category:** security

Plain `===` comparison for bootstrap token detection leaks timing information.

**Remediation:** Use `constantTimeEqual` from scope-verifier.ts.

---

### 11. bearerAuth middleware reconstructs verifier on every request

**File:** `server/auth/middleware.ts:32`
**Category:** contract

`readApiKey()` and `new BearerAuthVerifier(apiKey)` run per-request. Mid-flight env mutation changes behavior without restart.

**Remediation:** Hoist to middleware construction time.

---

### 12. Streamable HTTP transport exposes raw error messages in 500 responses

**File:** `agent-tools/transports/streamable-http.ts:128`
**Category:** security

Full error messages (including pg errors, stack traces) sent to HTTP clients.

**Remediation:** Return generic "Internal server error"; log the real error server-side.

---

### 13. SlidingWindowRateLimiter Map grows unboundedly

**File:** `server/middleware/rate-limit.ts:42`
**Category:** concurrency

Bucket entries never removed from Map. Days of diverse traffic accumulates millions of stale entries.

**Remediation:** Delete bucket when timestamps array is empty after pruning.

---

## Low Severity Findings

### 14. Scope verifier silently coerces malformed scopes JSONB to empty array

**File:** `server/auth/scope-verifier.ts:122`
**Category:** error_handling

Corrupt scopes data causes 403 SCOPE_INSUFFICIENT with misleading error message.

**Remediation:** Log corruption at the catch boundary.

---

### 15. OpenAPI spec declares MIT license, project is Apache-2.0

**File:** `server/app.ts:142`
**Category:** contract

License mismatch between OpenAPI spec and project CLAUDE.md locked names.

**Remediation:** Change to `Apache-2.0`.

---

### 16. LocalMemory.get always reconstructs scope as user-scoped

**File:** `local/index.ts:993`
**Category:** error_handling

`get()` always returns `scope: { kind: 'user', userId: ... }` regardless of the actual scope stored in the payload. Session-scoped and agent-scoped memories are misrepresented.

**Remediation:** Use `deriveScopeFromPayload()` (already defined at line 341).

---

## Observations

**Well-done areas:**
- SQL injection prevention: all user-facing queries use parameterized `$N` placeholders consistently
- Auth stack: timing-safe comparisons, fail-closed defaults, EC-1 empty-key sentinel pattern
- Typed domain errors with proper prototype chain (`Object.setPrototypeOf`)
- Transaction rollback pattern in `PgvectorStore.withTransaction` is correct (RAII-style with pool.connect)
- Bi-temporal predicate composition is null-safe and correctly parameterized
- Body size limit applied before auth (correct ordering to prevent DoS)
- Admin key bootstrap token has atomic consume-on-first-use design intent

**Patterns to watch:**
- The codebase has ~40 empty `catch {}` blocks across production code (grep count). Each is a potential silent failure. Most are intentional (fire-and-forget observability) but should at minimum log at warn level.
- The `AuthPool` interface is too narrow for transaction support -- it only exposes `query()`, which is why admin-keys.ts falls back to the broken `pool.query('BEGIN')` pattern.
