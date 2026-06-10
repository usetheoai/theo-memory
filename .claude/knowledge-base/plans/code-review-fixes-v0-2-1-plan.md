---
slug: code-review-fixes-v0-2-1
created_at: 2026-06-10
goal: "Fix all 20 blocking findings from the loop-code-review audit so that zero HIGH/BLOCKING items remain, measured by re-run of loop-code-review returning 0 blocking findings on the same src/ scope."
---

# Plan: Code Review Fixes v0.2.1

> **Version 1.1** — Fix all 20 blocking findings surfaced by the loop-code-review FAANG-style audit (2026-06-10, commit `0dcd758`). Covers security (6), error handling (4), concurrency (4), completeness/contract (3), and test gaps (4). Non-blocking findings (73) are tracked but deferred to a follow-up cycle. **v1.1: absorbed 3 MUST FIX from `/edge-case-plan` (EC-1, EC-2, EC-3) + 3 SHOULD TEST (EC-4, EC-5, EC-6).**

## Goal

> "Fix all 20 blocking findings from the code-review audit so that zero BLOCKING items remain in `code-review-output/code-review.db`, measured by `SELECT count(*) FROM findings WHERE blocking=1` returning 0 after re-audit."

## Context

The loop-code-review ran 5 phases (baseline, completeness, code review with 4 parallel specialists, test audit, report) against `src/` on branch `develop` at `0dcd758`. It produced 93 findings (17 HIGH, 46 MEDIUM, 25 LOW, 5 INFO), of which 20 are blocking. The top risks are: (1) broken transaction model in admin-keys handlers, (2) SQL injection defense-in-depth gap in DDL interpolation, (3) CORS wildcard default in production, and (4) systematic under-testing of error paths.

This plan is scoped to the 20 blocking findings only. The 73 non-blocking findings (complexity refactors CC>15, pattern suggestions, maturity cleanups) are deferred to `code-review-nits-v0-2-2` follow-up.

Source: `code-review-output/FINAL-REPORT.md` (26KB, 568 lines).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC | Last commit | Why it exists | Invariants to preserve |
|---|---|---|---|---|
| `src/server/handlers/admin-keys.ts` | 503 | `21804db` (2026-06-07) | Admin REST for API key lifecycle (create/list/revoke/rotate/lineage) | 5 handler exports; bootstrap-consume atomic guarantee EC-3; rotate-key idempotency |
| `src/local/index.ts` | 1519 | `8792e2c` (2026-06-09) | createLocalMemory factory + dimension change pipeline | Public `createLocalMemory()` signature; DIP wiring for 5 adapters; `applyDimChange` idempotency |
| `src/core/extraction/pipeline.ts` | 497 | `543e9c0` (2026-06-09) | 8-phase write pipeline | ADD-only invariant; `runExtractionPipeline` contract (returns `MemoryItem[]`); OTel event emission per phase |
| `src/server/app.ts` | 278 | `d99f54c` (2026-06-09) | Hono app composer | 4 verbs mounted; bearer middleware optional; health endpoint; OpenAPI |
| `src/server/auth/oidc-verifier.ts` | 165 | `c0cc535` (2026-06-07) | OIDC token introspection (RFC 7662) | IntrospectFn DIP; 5000ms timeout (EC-4); in-flight dedup (EC-5); configurable TTL |
| `src/server/auth/api-key-verifier.ts` | 84 | `2bbde27` (2026-06-07) | Stripe-shape API key verification | SHA-256 hash comparison; timing-safe; fire-and-forget last_used_at |
| `src/local/pgvector-store.ts` | 909 | `44830c2` (2026-06-09) | pgvector VectorStore implementation | Parameterized SQL (`$N`); per-row fallback; `withTransaction` pattern |
| `src/server/middleware/rate-limit.ts` | 112 | `d99f54c` (2026-06-09) | In-memory sliding-window rate limiter | Configurable limits; IPv6 normalization (EC-1); per-process lifecycle |
| `src/server/auth/middleware.ts` | 69 | `6bbc845` (2026-06-03) | Bearer auth middleware factory | EC-1 fail-closed; EC-2 case-insensitive; AuthVerifier DIP |
| `src/agent-tools/transports/streamable-http.ts` | 186 | `dc74b15` (2026-06-08) | Streamable-HTTP transport for MCP | STATELESS mode; node:http; scope binding deferred |
| `src/local/reflection/index.ts` | 13 | `9a65d3c` (2026-05-29) | Barrel for reflection policies | Exports Threshold + SleepTime policies |
| `src/index.ts` | 148 | `0cfd6df` (2026-06-04) | Public surface barrel | All subpath-visible symbols re-exported |
| `src/server/handlers/__tests__/admin-keys.test.ts` | (exists) | — | Tests for admin-keys handlers | Pool stub pattern |
| `tests/integration/migrations/dim-change.test.ts` | (exists) | — | Tests for dim-change pipeline | Real pgvector |
| `src/core/extraction/__tests__/pipeline.test.ts` | (exists) | — | Tests for extraction pipeline | Stub LLM + embedder |
| `tests/integration/server/rate-limit-and-cors.test.ts` | (exists) | — | Tests for rate-limit + CORS | Real Hono app |

### Current callers / dependents

- **`applyDimChange`** in `src/local/index.ts` — called by `createLocalMemory` factory (same file); tested by `dim-change.test.ts`, `factory-wiring.test.ts`, `semantic-recall-cache.test.ts`
- **`bumpReflectionCounter`** in `src/local/pgvector-store.ts` — called by `threshold-reflection-policy.ts`; tested by `threshold-policy.test.ts`
- **`ThresholdReflectionPolicy`** / **`SleepTimeReflectionPolicy`** — defined in `src/local/reflection/`; exported from `src/local/reflection/index.ts` and `src/core/index.ts` but NOT from `src/index.ts` (root barrel)
- **`bearerAuth`** in `src/server/auth/middleware.ts` — called by `src/server/app.ts`
- **`SlidingWindowRateLimiter`** in `src/server/middleware/rate-limit.ts` — instantiated in `src/server/app.ts`

### Domain glossary

- **Blocking finding** — a code-review finding with `blocking=1` in the SQLite DB; must be fixed before any release.
- **Defense-in-depth** — validation at multiple layers so a bypass in one layer is caught by another.
- **Constant-time comparison** — comparison that takes the same time regardless of match position, preventing timing side-channels.
- **Sliding-window rate limiter** — rate limit that tracks requests in a rolling time window (not fixed buckets).

### Architecture boundaries affected

- `src/server/` (HTTP boundary) — most fixes are here; no DIP boundary crossings.
- `src/core/` (pure logic) — extraction pipeline error differentiation stays within core.
- `src/local/` (pgvector adapter) — `applyDimChange` guard + `bumpReflectionCounter` fix stay within local.
- `src/index.ts` (public barrel) — re-export addition only; no boundary change.

## Prior Art & Related Work

- **OWASP CORS Misconfiguration** — A01:2021 (Broken Access Control). CORS wildcard with credentials is explicitly listed.
- **CWE-89** (SQL Injection) — defense-in-depth validation at the function boundary, not just upstream.
- **CWE-208** (Observable Timing Discrepancy) — constant-time comparison for secrets.
- **Node.js `pg` Pool documentation** — `pool.connect()` returns a dedicated client; `pool.query()` checks out and returns per statement.
- **Hono CORS middleware** — `origin: '*'` is the documented default; production hardening requires explicit origin.

## Objective

- [ ] Fix 6 security-blocking findings (#13, #66, #68, #73, #76, #12-implied)
- [ ] Fix 4 error-handling-blocking findings (#46, #67, #75, #12)
- [ ] Fix 4 concurrency-blocking findings (#70, #11, #65, #79)
- [ ] Fix 3 completeness/contract-blocking findings (#1, #69, #74)
- [ ] Close 4 test-gap-blocking findings (#81, #82, #83, #85)
- [ ] All 20 blocking findings resolved; re-audit returns 0 blocking

## ADRs

### D1 — Transaction fix uses pool.connect(), not ORM transaction wrapper

**Decision:** Fix `admin-keys.ts` by using `pool.connect()` to pin a single client for the transaction, matching the existing `PgvectorStore.withTransaction` pattern.

**Rationale:** The codebase already has a correct pattern (`withTransaction`). Adopting it for admin-keys is KISS (Inquebravel Rule 10). Alternative: Drizzle transaction — rejected because admin-keys uses raw SQL, not Drizzle schema, and mixing would add complexity.

**Alternatives considered:** (1) Drizzle `db.transaction()` — rejected: admin-keys handlers don't use Drizzle; adding it would increase coupling. (2) Wrap `AuthPool` with a `connect()` method — considered but unnecessary; the handlers already receive the pool directly.

**Consequences:** Handlers become ~5 lines longer per transaction block. Atomicity guarantee restored.

### D2 — CORS fail-fast in production, permissive in development

**Decision:** When `NODE_ENV=production` (or `THEMORY_ENV=production`) AND `THEMORY_CORS_ORIGIN` is unset, refuse to start the server with a clear error message. In development, default to `*` with a stderr warning (status quo for dev ergonomics).

**Rationale:** OWASP A01:2021 explicitly lists CORS wildcard as a misconfiguration. Fail-fast (Inquebravel Rule 8) prevents silent deployment with a permissive CORS. Per `architecture.md` section 8: "Validate at boundaries."

**Alternatives considered:** (1) Default to the request's Origin header — rejected: still permissive, just hidden. (2) Default to `localhost` — rejected: breaks legitimate development setups.

**Consequences:** Breaking change for anyone deploying in `production` mode without setting `THEMORY_CORS_ORIGIN`. Documented in CHANGELOG as `Changed`.

### D3 — LLM errors propagate; parse errors return empty with OTel event

**Decision:** In `runExtractionPipeline`, differentiate LLM network errors (throw — retryable) from JSON parse / Zod validation errors (return `[]` with `extraction_parse_failure` OTel event — not retryable). This preserves the current "never fail a remember() call on bad LLM output" behavior while surfacing transient failures.

**Rationale:** Per Inquebravel Rule 8 (Fail-Fast), transient network errors must not be silently swallowed. But per the ADD-only contract (`architecture.md` section 2), a `remember()` that fails because the LLM returned malformed JSON must not crash the caller — the content simply wasn't extractable.

**Alternatives considered:** (1) Always throw — rejected: breaks the `remember()` contract for parse failures. (2) Retry on parse failure — rejected: LLM parse failures are not transient; retrying wastes tokens.

**Consequences:** Consumers that relied on `remember()` never throwing will now see errors on LLM network failures. This is correct behavior per the contract.

### D4 — Rate limiter uses SHA-256 hash of token as bucket key

**Decision:** Hash the `Authorization` header value with `crypto.createHash('sha256')` before using it as the Map key in the rate limiter.

**Rationale:** Per CWE-200 (Exposure of Sensitive Information), storing raw bearer tokens in process memory is a risk vector on heap dumps.

**Alternatives considered:** (1) Use client IP only — rejected: loses per-token granularity. (2) HMAC with a server secret — over-engineering; SHA-256 is sufficient for bucket keying (not authentication).

**Consequences:** Negligible performance overhead (~1us per hash). Tokens no longer recoverable from memory dumps.

### D5 — bumpReflectionCounter uses INSERT ON CONFLICT

**Decision:** Replace the SELECT-then-INSERT/UPDATE race in `bumpReflectionCounter` with a single `INSERT ... ON CONFLICT (scope_key) DO UPDATE SET count = count + 1` statement.

**Rationale:** Per Inquebravel Rule 8 (Fail-Fast) and PostgreSQL best practice, atomic upsert eliminates the TOCTOU race without requiring advisory locks.

**Alternatives considered:** (1) Advisory lock — rejected: heavier; the single-statement upsert is sufficient. (2) Serializable isolation — rejected: unnecessary overhead for a counter.

**Consequences:** Simpler code; race condition eliminated; no behavior change for callers.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| D2 (CORS fail-fast) is a breaking change for production deployments without `THEMORY_CORS_ORIGIN` | Medium | Document in CHANGELOG as `Changed`; add migration note in README | Author |
| D3 (LLM error propagation) changes `remember()` from never-throw to sometimes-throw on network errors | Medium | The contract already allows errors; consumers must have error handling. Add explicit JSDoc note. | Author |
| Large diff (13+ files touched) increases merge conflict risk | Low | Atomic commits per task; each task is independently reviewable | Author |
| 20 fixes in one cycle risks introducing regressions | Medium | Each fix has a dedicated test; full suite run at Integration Validation phase | Author |

## Unresolved Questions

(none -- every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (Security) ──▶ Phase 2 (Error Handling) ──▶ Phase 5 (Integration Validation)
         │                       │
         ▼                       ▼
Phase 3 (Concurrency)    Phase 4 (Completeness)
         │                       │
         ▼                       ▼
Phase 4.5 (Test Gaps) ──────────▶ Phase 5
```

Phases 1-4 can largely run in parallel (independent files). Phase 4.5 depends on Phases 1-4 (tests validate the fixes). Phase 5 runs last.

---

## Phase 1: Security Hardening

**Objective:** Close all 6 security-class blocking findings.

### T1.1 -- SQL injection defense-in-depth in applyDimChange

#### Objective
Add input re-validation at the `applyDimChange` function entry to prevent DDL injection even if upstream validation is bypassed.

#### Why this step
**Action:** Add `Number.isInteger(targetDim) && targetDim > 0 && targetDim <= 2000` guard at the top of `applyDimChange`. **Reasoning:** Finding #13 — `applyDimChange` interpolates `String(targetDim)` into DDL. While `validateEmbeddingDim()` validates upstream, the two are separated by multiple call layers. Defense-in-depth per CWE-89 and `architecture.md` section 8 ("Validate at boundaries").

#### Evidence
`src/local/index.ts:1374` — `DO $$ EXECUTE` block builds nested SQL string with `${String(targetDim)}`.

#### Files to edit
```
src/local/index.ts — add guard at applyDimChange entry
tests/integration/migrations/dim-change.test.ts — add SQL injection resistance test (RED)
```

#### Deep file dependency analysis
- `src/local/index.ts` — `applyDimChange` is called from `createLocalMemory` factory (same file, line ~1350). Adding a guard at function entry does not change the contract.
- `dim-change.test.ts` — existing tests use valid integer dimensions. New test passes malicious input.

#### Deep Dives
Guard implementation:
```ts
if (!Number.isInteger(targetDim) || targetDim <= 0 || targetDim > 2000) {
  throw new Error(`applyDimChange: invalid dimension ${targetDim}`);
}
```
The `2000` cap is consistent with pgvector 0.5.1's HNSW limit (already enforced in `validateEmbeddingDim`).

#### Tasks
1. Write RED test: `applyDimChange` throws on non-integer / negative / >2000 input
2. Add guard at `applyDimChange` entry
3. Verify GREEN

#### TDD
```
RED:     test('applyDimChange rejects non-integer dimension') — expects throw
RED:     test('applyDimChange rejects dimension > 2000') — expects throw
GREEN:   Add Number.isInteger guard
REFACTOR: None expected
VERIFY:  npm test -- tests/integration/migrations/dim-change.test.ts
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] `applyDimChange(1.5, ...)` throws
- [ ] `applyDimChange(-1, ...)` throws
- [ ] `applyDimChange(3000, ...)` throws
- [ ] `applyDimChange(384, ...)` succeeds (regression)
- [ ] Pass: lint — zero warnings on changed files

#### DoD
- [ ] Tests passing — `npm test`
- [ ] Zero type errors — `npm run typecheck`

---

### T1.2 -- CORS fail-fast in production

#### Objective
Refuse to start the server when `THEMORY_CORS_ORIGIN` is unset in production mode.

#### Why this step
**Action:** Add production-mode guard in `createApp()` before CORS middleware setup. **Reasoning:** Finding #76 — OWASP A01:2021 CORS misconfiguration. Per ADR D2, fail-fast in production, permissive in development.

#### Evidence
`src/server/app.ts:178` — `origin: process.env.THEMORY_CORS_ORIGIN || '*'`

#### Files to edit
```
src/server/app.ts — add production guard before CORS setup
tests/integration/server/rate-limit-and-cors.test.ts — add restrictive-origin test (RED)
```

#### Deep file dependency analysis
- `src/server/app.ts` — `createApp()` is called by `src/agent-tools/run-server.ts` and tests. The guard fires at construction time.

#### Tasks
1. Write RED test: `createApp()` throws when `NODE_ENV=production` and `THEMORY_CORS_ORIGIN` unset
2. Write RED test: `createApp()` uses specified origin when `THEMORY_CORS_ORIGIN` is set
3. Add guard in `createApp()` — check `process.env.NODE_ENV === 'production'` (EC-2: guard MUST NOT fire when `NODE_ENV` is `test` or undefined, to avoid cascade failures in existing test suites that don't set `THEMORY_CORS_ORIGIN`)
4. Write regression test: `createApp()` succeeds without `THEMORY_CORS_ORIGIN` when `NODE_ENV` is `test`
5. Verify GREEN

#### TDD
```
RED:     test('createApp throws in production without CORS origin') — expects throw
RED:     test('createApp uses CORS origin from env') — expects specific origin header
GREEN:   Add production guard
REFACTOR: None expected
VERIFY:  npm test -- tests/integration/server
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] Server refuses to start in production without `THEMORY_CORS_ORIGIN`
- [ ] Server starts in development with wildcard `*` (regression)
- [ ] Server uses configured origin when set

#### DoD
- [ ] Tests passing
- [ ] Zero type errors

---

### T1.3 -- Hash tokens in rate limiter

#### Objective
Replace raw bearer token storage with SHA-256 hash as the bucket key.

#### Why this step
**Action:** Hash `Authorization` header before Map insertion. **Reasoning:** Finding #66 — CWE-200. Per ADR D4.

#### Evidence
`src/server/middleware/rate-limit.ts:75` — full Authorization header stored as Map key.

#### Files to edit
```
src/server/middleware/rate-limit.ts — hash the key
src/server/middleware/__tests__/rate-limit.test.ts (NEW) — test that raw token not in Map
```

#### Tasks
1. Write RED test: after rate-limited request, Map keys contain no raw token substring
2. Import `crypto.createHash('sha256')` and hash the key before Map operations
3. Verify GREEN

#### TDD
```
RED:     test('rate limiter stores hashed key, not raw token') — inspect Map keys
RED:     test('hash key is full 64-char hex, not truncated') — EC-4 (SHA-256 collision safety)
GREEN:   Hash the key
REFACTOR: None expected
VERIFY:  npm test -- src/server/middleware
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] Map keys are hex hashes, not raw tokens
- [ ] `SlidingWindowRateLimiter.check(key)` returns `{ allowed: false }` after `limit` requests with the same hashed key within the window (regression)

#### DoD
- [ ] Tests passing
- [ ] Zero type errors

---

### T1.4 -- Constant-time bootstrap token comparison

#### Objective
Replace `===` comparison of bootstrap token with `crypto.timingSafeEqual`.

#### Why this step
**Action:** Use `timingSafeEqual` for bootstrap token in `createApp()`. **Reasoning:** Finding #68 — CWE-208 timing side-channel.

#### Evidence
`src/server/app.ts:247` — string `===` comparison for bootstrap token.

#### Files to edit
```
src/server/app.ts — replace === with timingSafeEqual
```

#### Tasks
1. Import `timingSafeEqual` from `node:crypto`
2. Implement `constantTimeEqual(a: string, b: string): boolean` that guards length mismatch BEFORE calling `timingSafeEqual` (EC-1: `timingSafeEqual` throws `RangeError` on different-length buffers — attacker probe with wrong-length token would crash the handler)
3. Replace `===` with `constantTimeEqual()`
4. Write RED test: `constantTimeEqual('short', 'longertokenvalue')` returns `false` (no throw)
5. Verify existing bootstrap tests pass

#### TDD
```
RED:     (existing tests cover bootstrap token validation — verify they still pass)
GREEN:   Replace === with timingSafeEqual
REFACTOR: Extract `constantTimeEqual(a, b)` helper if reusable
VERIFY:  npm test -- tests/integration/auth
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] Bootstrap token comparison uses `timingSafeEqual`
- [ ] Existing auth tests pass

#### DoD
- [ ] Tests passing
- [ ] Zero type errors

---

### T1.5 -- Sanitize error messages in streamable HTTP

#### Objective
Prevent raw error messages from leaking in HTTP 500 responses.

#### Why this step
**Action:** Replace raw `error.message` in 500 response with generic message. **Reasoning:** Finding #73 — information disclosure via error messages.

#### Evidence
`src/agent-tools/transports/streamable-http.ts:128` — raw `error.message` in response.

#### Files to edit
```
src/agent-tools/transports/streamable-http.ts — sanitize error response
src/agent-tools/transports/__tests__/streamable-http.test.ts (NEW or existing) — test error sanitization
```

#### Tasks
1. Write RED test: trigger error, verify response body does NOT contain internal message
2. Replace `error.message` with `'Internal Server Error'`; log original to stderr
3. Verify GREEN

#### TDD
```
RED:     test('500 response does not leak internal error message') — checks response body
GREEN:   Replace with generic message
REFACTOR: None expected
VERIFY:  npm test -- src/agent-tools
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] HTTP 500 response body says "Internal Server Error", not the actual error
- [ ] Error is logged to stderr for debugging

#### DoD
- [ ] Tests passing
- [ ] Zero type errors

---

### T1.6 -- Log api-key-verifier last_used_at failure

#### Objective
Surface the silently swallowed `last_used_at` update failure.

#### Why this step
**Action:** Add `console.warn` on catch in fire-and-forget `UPDATE last_used_at`. **Reasoning:** Finding #12 — silent swallow violates Inquebravel Rule 8.

#### Evidence
`src/server/auth/api-key-verifier.ts:78` — `.catch(() => {})` swallows the error.

#### Files to edit
```
src/server/auth/api-key-verifier.ts — add console.warn in catch
```

#### Tasks
1. Replace `.catch(() => {})` with `.catch((err) => console.warn('last_used_at update failed:', err.message))`

#### TDD
```
RED:     (existing tests — verify behavior unchanged)
GREEN:   Add console.warn
REFACTOR: None expected
VERIFY:  npm test -- src/server/auth
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] Failed `last_used_at` update emits a warning, not silent swallow

#### DoD
- [ ] Tests passing

---

## Phase 2: Error Handling & Reliability

**Objective:** Close all 4 error-handling blocking findings.

### T2.1 -- Differentiate LLM errors in extraction pipeline

#### Objective
Propagate LLM network errors; catch only parse/validation errors with OTel event.

#### Why this step
**Action:** Split the catch block in Phase 2 of `runExtractionPipeline` into network vs parse errors. **Reasoning:** Finding #46 — per ADR D3, transient network errors must propagate; parse failures return `[]` with OTel event.

#### Evidence
`src/core/extraction/pipeline.ts:337` — catches ALL errors and returns `[]`.

#### Files to edit
```
src/core/extraction/pipeline.ts — split catch block
src/core/extraction/__tests__/pipeline.test.ts — add network error propagation test (RED)
```

#### Tasks
1. Write RED test: when LLM throws network error (e.g., `cause.code === 'ECONNREFUSED'`), `runExtractionPipeline` throws
2. Write RED test: when LLM returns unparseable JSON, `runExtractionPipeline` returns `[]` with OTel event
3. Split catch: check if error is a known parse/validation error; if not, rethrow
4. Verify GREEN

#### TDD
```
RED:     test('propagates LLM network errors') — expects throw on ECONNREFUSED
RED:     test('returns [] with OTel event on parse failure') — expects empty array + event
RED:     test('LLM error with misleading JSON message is NOT classified as parse error') — EC-6 (classify by error TYPE not message)
GREEN:   Split catch block — check `instanceof SyntaxError || instanceof ZodError`, NOT error.message content
REFACTOR: Extract isTransientError() helper
VERIFY:  npm test -- src/core/extraction
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] Network errors propagate
- [ ] Parse errors return `[]` with `extraction_parse_failure` OTel event
- [ ] Happy path unchanged (regression)

#### DoD
- [ ] Tests passing
- [ ] Zero type errors

---

### T2.2 -- Handle zero-dimension vectors in embedBatchWithFallback

#### Objective
Detect and reject zero-dimension vectors in the fallback path.

#### Why this step
**Action:** Add dimension check after fallback embedding. **Reasoning:** Finding #75 — zero-dim vectors corrupt the vector store.

#### Evidence
`src/core/extraction/pipeline.ts:216` — fallback path must create zero-dim vectors.

#### Files to edit
```
src/core/extraction/pipeline.ts — add dimension check in fallback
src/core/extraction/__tests__/pipeline.test.ts — test zero-dim rejection (RED)
```

#### Tasks
1. Write RED test: embedder returns `[]` (zero-dim) for one row in fallback — row is excluded with OTel event
2. Add `if (embedding.length === 0) { emitEvent(...); continue; }` in fallback loop
3. Verify GREEN

#### TDD
```
RED:     test('excludes rows with zero-dimension embeddings in fallback') — expects filtered result
GREEN:   Add dimension check
VERIFY:  npm test -- src/core/extraction
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] Zero-dim vectors are excluded, not persisted
- [ ] OTel event `embed_zero_dim_skipped` emitted

#### DoD
- [ ] Tests passing

---

### T2.3 -- Log history persist failure with OTel event

#### Objective
Surface silently swallowed history persist failures.

#### Why this step
**Action:** Add OTel event + console.warn in history persist catch block. **Reasoning:** Finding #67 — silent swallow at `pipeline.ts:484`.

#### Evidence
`src/core/extraction/pipeline.ts:484` — catch block swallows history persist error.

#### Files to edit
```
src/core/extraction/pipeline.ts — add OTel event in catch
```

#### Tasks
1. Add `emitEvent(tracer, 'history_persist_failed', { error: err.message })` in catch block
2. Add `console.warn('history persist failed:', err.message)`
3. Verify existing tests pass

#### TDD
```
GREEN:   Add OTel event + console.warn (no behavior change — still non-fatal)
VERIFY:  npm test -- src/core/extraction
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] Failed history persist emits OTel event `history_persist_failed`

#### DoD
- [ ] Tests passing

---

## Phase 3: Concurrency Safety

**Objective:** Close all 4 concurrency-class blocking findings.

### T3.1 -- Fix transaction management in admin-keys handlers

#### Objective
Use `pool.connect()` for transaction-based operations in admin-keys handlers.

#### Why this step
**Action:** Replace `pool.query('BEGIN')` / `pool.query('COMMIT')` with `pool.connect()` to pin a single client. **Reasoning:** Finding #70 — under `pg.Pool`, consecutive `pool.query()` calls must use different connections. Per ADR D1.

#### Evidence
`src/server/handlers/admin-keys.ts:214` — `pool.query('BEGIN')` on pool (not client).

#### Files to edit
```
src/server/handlers/admin-keys.ts — refactor rotate + bootstrap-consume to use pool.connect()
src/server/handlers/__tests__/admin-keys.test.ts — add transaction safety test (RED)
```

#### Tasks
1. Write RED test: mock pool where consecutive `query()` calls go to different clients — verify transaction detects it
2. Refactor `rotateKeyHandler` and `consumeBootstrapTokenHandler` to use `const client = await pool.connect(); try { await client.query('BEGIN'); ... await client.query('COMMIT'); } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }` (EC-3: ROLLBACK in catch is mandatory — without it, the connection returns to the pool with an open aborted transaction, poisoning subsequent queries)
3. Verify GREEN

#### TDD
```
RED:     test('rotate key uses single connection for transaction') — spy on pool.connect
RED:     test('bootstrap consume uses single connection') — spy on pool.connect
GREEN:   Refactor to pool.connect()
REFACTOR: Extract withPoolTransaction() helper if pattern repeats
VERIFY:  npm test -- src/server/handlers
```

#### Concurrency tests

Happens-before observation against concurrent connection interleaving: the test verifies that BEGIN, INSERT, COMMIT all execute on the same client reference (spy assertion on `pool.connect()`). This proves the transaction boundary holds under parallel request load.

#### Acceptance Criteria
- [ ] `pool.connect()` used for all transactional operations
- [ ] Atomicity of bootstrap-consume and key-rotation restored
- [ ] Existing handler tests pass

#### DoD
- [ ] Tests passing
- [ ] Zero type errors

---

### T3.2 -- Add LRU eviction to OIDC cache

#### Objective
Prevent unbounded growth of the OIDC introspection cache.

#### Why this step
**Action:** Add max-entries cap + eviction sweep on cache read. **Reasoning:** Finding #11 — Map grows unboundedly. Expired entries never deleted.

#### Evidence
`src/server/auth/oidc-verifier.ts:115` — `#cache` Map with no eviction.

#### Files to edit
```
src/server/auth/oidc-verifier.ts — add max-entries cap + eviction
src/server/auth/__tests__/oidc-verifier.test.ts — test cache eviction (RED)
```

#### Tasks
1. Write RED test: after inserting `maxEntries + 1` tokens, cache size <= `maxEntries`
2. Add `MAX_CACHE_ENTRIES = 10_000` constant
3. On cache `set`: if size >= max, delete oldest 10% (by insertion order — Map preserves order)
4. On cache `get`: delete entry if expired (already checked but not deleted)
5. Verify GREEN

#### TDD
```
RED:     test('OIDC cache evicts oldest entries when full') — expects size <= max
RED:     test('OIDC cache deletes expired entry on read') — expects deletion
RED:     test('OIDC cache is safe under burst insert of 1.5x max entries') — EC-5
GREEN:   Add eviction logic
VERIFY:  npm test -- src/server/auth
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] Cache never exceeds `MAX_CACHE_ENTRIES`
- [ ] Expired entries deleted on read
- [ ] Existing OIDC tests pass

#### DoD
- [ ] Tests passing

---

### T3.3 -- Atomic upsert for bumpReflectionCounter

#### Objective
Eliminate the SELECT-then-INSERT/UPDATE race condition.

#### Why this step
**Action:** Replace SELECT + INSERT/UPDATE with `INSERT ON CONFLICT DO UPDATE`. **Reasoning:** Finding #65 — per ADR D5.

#### Evidence
`src/local/pgvector-store.ts:862` — SELECT-then-INSERT pattern.

#### Files to edit
```
src/local/pgvector-store.ts — replace with atomic upsert
```

#### Tasks
1. Replace the SELECT + conditional INSERT/UPDATE with single `INSERT INTO reflection_counters (...) VALUES (...) ON CONFLICT (scope_key) DO UPDATE SET count = reflection_counters.count + 1`
2. Verify existing reflection tests pass

#### TDD
```
GREEN:   Replace with atomic upsert (behavior unchanged for callers)
VERIFY:  npm test -- src/local
```

#### Concurrency tests

The atomic upsert eliminates the race condition via PostgreSQL's built-in concurrent INSERT ON CONFLICT guarantee — no application-level lock needed. The integration test in `threshold-policy.test.ts` exercises the counter increment path against real pgvector. Concurrent test: two parallel `bumpReflectionCounter` calls on the same scope key produce count=2, never count=1.

#### Acceptance Criteria
- [ ] Single SQL statement for counter increment
- [ ] Existing reflection tests pass

#### DoD
- [ ] Tests passing

---

### T3.4 -- Add bucket eviction to SlidingWindowRateLimiter

#### Objective
Prevent unbounded Map growth in the rate limiter.

#### Why this step
**Action:** Add periodic sweep of old entries + max-entries cap. **Reasoning:** Finding #79 — Map grows with unique IPs/tokens.

#### Evidence
`src/server/middleware/rate-limit.ts:42` — `#buckets` Map with no eviction.

#### Files to edit
```
src/server/middleware/rate-limit.ts — add eviction sweep
```

#### Tasks
1. Add `MAX_BUCKETS = 100_000` constant
2. On `consume()`: if `#buckets.size >= MAX_BUCKETS`, sweep entries where all timestamps are older than the window
3. Verify existing rate-limit tests pass

#### TDD
```
GREEN:   Add eviction (behavior unchanged for callers within limits)
VERIFY:  npm test -- src/server
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] Rate limiter Map never exceeds `MAX_BUCKETS`

#### DoD
- [ ] Tests passing

---

## Phase 4: Completeness & Contract Fixes

**Objective:** Close 3 completeness/contract blocking findings.

### T4.1 -- Export reflection policies from root barrel

#### Objective
Make `ThresholdReflectionPolicy` and `SleepTimeReflectionPolicy` accessible through the public API.

#### Why this step
**Action:** Re-export both classes from `src/index.ts`. **Reasoning:** Finding #1 — CLAUDE.md claims v0.4a shipped all 3 policies, but consumers can only access `ManualReflectionPolicy`.

#### Evidence
`src/local/reflection/index.ts` exports both. `src/index.ts` does not re-export them.

#### Files to edit
```
src/index.ts — add re-exports for ThresholdReflectionPolicy, SleepTimeReflectionPolicy, and their config types
```

#### Tasks
1. Add re-exports from `src/local/reflection/index.ts` to `src/index.ts`
2. Verify smoke import test picks them up

#### TDD
```
GREEN:   Add re-exports (existing smoke import tests should now also cover these)
VERIFY:  npm test -- src/__tests__/p0-audit
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] `import { ThresholdReflectionPolicy, SleepTimeReflectionPolicy } from '@usetheo/memory'` resolves

#### DoD
- [ ] Tests passing
- [ ] Zero type errors

---

### T4.2 -- Hoist bearerAuth verifier construction

#### Objective
Construct the verifier once at app setup, not per-request.

#### Why this step
**Action:** Move verifier instantiation from per-request middleware to `createApp()`. **Reasoning:** Finding #69 — per-request construction is wasteful and violates the contract expectation.

#### Evidence
`src/server/auth/middleware.ts:32` — verifier must be re-created per request.

#### Files to edit
```
src/server/auth/middleware.ts — accept pre-built verifier instance
src/server/app.ts — construct verifier at app setup
```

#### Tasks
1. Modify `createBearerMiddleware` to accept a `verifier: AuthVerifier` parameter (not a factory)
2. In `createApp()`, construct the verifier once and pass it in
3. Verify existing auth tests pass

#### TDD
```
GREEN:   Refactor (behavior unchanged)
VERIFY:  npm test -- src/server
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] Verifier constructed once per app lifecycle
- [ ] Existing auth tests pass

#### DoD
- [ ] Tests passing

---

### T4.3 -- Add concurrency guard to PgvectorStore userId

#### Objective
Prevent mutable `userId` state from being modified concurrently.

#### Why this step
**Action:** Make `userId` readonly after construction; throw on reassignment attempts. **Reasoning:** Finding #74 — mutable shared state without guard.

#### Evidence
`src/local/pgvector-store.ts:227` — `userId` is a mutable property.

#### Files to edit
```
src/local/pgvector-store.ts — make userId readonly
```

#### Tasks
1. Change `userId` to `readonly` property
2. Verify existing tests pass (no test must be reassigning userId)

#### TDD
```
GREEN:   Add readonly (TypeScript enforces at compile time)
VERIFY:  npm run typecheck && npm test -- src/local
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] `userId` is `readonly` — TypeScript prevents reassignment

#### DoD
- [ ] Tests passing
- [ ] Zero type errors

---

## Phase 4.5: Test Gap Closure

**Objective:** Close 4 test-gap blocking findings that validate the fixes above.

### T4.5.1 -- Integration test for admin-keys transaction safety

#### Objective
Verify that transaction operations use a single connection (validates T3.1).

#### Why this step
**Action:** Add spy-based test that verifies `pool.connect()` is called for transactional operations. **Reasoning:** Finding #81 — the current stub cannot detect cross-connection interleaving.

#### Files to edit
```
src/server/handlers/__tests__/admin-keys.test.ts — add transaction safety assertions
```

#### TDD
```
RED:     test('rotateKeyHandler calls pool.connect for transaction') — spy on connect
GREEN:   Already fixed in T3.1
VERIFY:  npm test -- src/server/handlers
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] Test verifies `pool.connect()` called, not `pool.query('BEGIN')`

---

### T4.5.2 -- Test for zero-dim vectors in fallback path

#### Objective
Validate that zero-dim vectors are excluded (validates T2.2).

#### Files to edit
```
src/core/extraction/__tests__/pipeline.test.ts — add zero-dim test
```

#### TDD
```
RED:     test('excludes zero-dim vectors from fallback embedding') — expects filtered
GREEN:   Already fixed in T2.2
VERIFY:  npm test -- src/core/extraction
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] Zero-dim vectors never reach the store

---

### T4.5.3 -- SQL injection resistance test for applyDimChange

#### Objective
Validate that malicious dimension input is rejected (validates T1.1).

#### Files to edit
```
tests/integration/migrations/dim-change.test.ts — add injection test
```

#### TDD
```
RED:     test('applyDimChange rejects SQL injection via non-integer dim') — expects throw
GREEN:   Already fixed in T1.1
VERIFY:  npm test -- tests/integration/migrations
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] Non-integer dimensions throw before reaching SQL

---

### T4.5.4 -- Restrictive-origin CORS test

#### Objective
Validate that CORS respects the configured origin (validates T1.2).

#### Files to edit
```
tests/integration/server/rate-limit-and-cors.test.ts — add restrictive origin test
```

#### TDD
```
RED:     test('CORS returns configured origin, not wildcard') — expects specific origin
GREEN:   Already fixed in T1.2
VERIFY:  npm test -- tests/integration/server
```

#### Concurrency tests
(none -- single-threaded)

#### Acceptance Criteria
- [ ] Response `Access-Control-Allow-Origin` header equals the value of `THEMORY_CORS_ORIGIN` env var

---

## Coverage Matrix

| # | Finding ID | Title | Task(s) | Resolution |
|---|---|---|---|---|
| 1 | #13 | SQL injection in applyDimChange DDL | T1.1 | Defense-in-depth guard at function entry |
| 2 | #76 | CORS origin defaults to wildcard | T1.2 | Fail-fast in production (D2) |
| 3 | #66 | Rate limiter leaks raw tokens | T1.3 | SHA-256 hash as bucket key (D4) |
| 4 | #68 | Bootstrap token timing | T1.4 | timingSafeEqual |
| 5 | #73 | Streamable HTTP error exposure | T1.5 | Generic error message |
| 6 | #12 | Silent last_used_at swallow | T1.6 | console.warn in catch |
| 7 | #46 | Extraction returns [] on LLM failure | T2.1 | Differentiate network vs parse (D3) |
| 8 | #75 | Zero-dim vector creation | T2.2 | Dimension check in fallback |
| 9 | #67 | History persist silently swallowed | T2.3 | OTel event + console.warn |
| 10 | #70 | Transaction via pool.query | T3.1 | pool.connect() (D1) |
| 11 | #11 | OIDC cache unbounded | T3.2 | LRU eviction with max-entries |
| 12 | #65 | bumpReflectionCounter race | T3.3 | INSERT ON CONFLICT (D5) |
| 13 | #79 | Rate limiter unbounded Map | T3.4 | Bucket eviction sweep |
| 14 | #1 | Reflection policies not exported | T4.1 | Re-export from root barrel |
| 15 | #69 | bearerAuth per-request rebuild | T4.2 | Hoist to construction time |
| 16 | #74 | Mutable userId state | T4.3 | readonly property |
| 17 | #81 | Transaction safety untestable | T4.5.1 | pool.connect spy test |
| 18 | #82 | Zero-dim vectors untested | T4.5.2 | Fallback exclusion test |
| 19 | #83 | SQL injection untested | T4.5.3 | Injection resistance test |
| 20 | #85 | No restrictive CORS test | T4.5.4 | Configured origin test |

**Coverage: 20/20 blocking findings covered (100%)**

## Global Definition of Done

- [ ] All 20 blocking findings fixed
- [ ] All tests passing — `npm test` green
- [ ] Zero type errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected (max 500 LoC per `architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased]` with `Fixed` + `Changed` entries
- [ ] Backward compatibility preserved (D2 CORS change documented as breaking for production)
- [ ] Re-audit of `code-review-output/code-review.db` returns 0 blocking findings
- [ ] Plan archived — move to `completed/` after PR merged

## Failure scenarios

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| LLM provider (HTTP) | Network unreachable (ECONNREFUSED) | Stub LLM that throws `Error` with `cause.code = 'ECONNREFUSED'` | `remember()` propagates error (not silent []) |
| PostgreSQL (DB) | Transaction rollback on error | Integration test with intentional constraint violation inside transaction | ROLLBACK executed; no partial state; error propagated |

## Final Phase: Integration Validation

**Objective:** Validate that all fixes work together in a real workload.

### Execution

```bash
npm test                    # unit + integration tests
npm run typecheck           # zero type errors
npm run lint                # zero lint warnings
npm run test:coverage       # coverage report
```

### Acceptance Criteria

- [ ] All test suites green (unit + integration)
- [ ] Zero type errors
- [ ] Zero lint warnings
- [ ] No new `any` types introduced
- [ ] CHANGELOG updated
- [ ] `SELECT count(*) FROM findings WHERE blocking=1` returns 0 on re-audit
