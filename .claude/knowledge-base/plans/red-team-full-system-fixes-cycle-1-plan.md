---
slug: red-team-full-system-fixes-cycle-1
created_at: 2026-06-09
goal: "Ship fixes for all 6 RED TEAM findings (F1 REST auth activation + F2 rate limiting + F3 CORS + F4 XSS contract + F5 date range validation + F6 Kratos CSP) and unblock the 8 blocked scenarios, measured by a RED TEAM re-run returning 0 CRITICAL + 0 HIGH + 0 unmitigated MEDIUM across 58/58 scenarios."
---

# Implementation Plan: red-team-full-system-fixes-cycle-1

> **Version 1.1** (2026-06-09) — absorbs 2 MUST FIX + 4 SHOULD TEST from `/edge-case-plan` at `.claude/knowledge-base/reviews/red-team-full-system-fixes-cycle-1-edge-cases-2026-06-09.md`: EC-1 (rate limiter IPv6 key normalization → T2.1 TDD + AC), EC-2 (CORS wildcard + credentials conflict → ADR D3 Consequences + T2.2 AC), EC-3 (per-token rate-limit isolation → T2.1 TDD), EC-4 (env var clamping 0/negative/non-numeric → T2.1 TDD), EC-5 (CORS preflight Max-Age → T2.2 TDD), EC-6 (same-day date range valid → T4.1 TDD). 2 DOCUMENT items (EC-7 rate-limit state loss, EC-8 F6 dev-only scope) already in plan Drawbacks/Unresolved — no new prose needed.

## Goal

Ship fixes for all 6 RED TEAM findings (F1 REST auth activation + F2 rate limiting + F3 CORS + F4 XSS contract + F5 date range validation + F6 Kratos CSP) and unblock the 8 blocked scenarios, measured by a RED TEAM re-run returning 0 CRITICAL + 0 HIGH + 0 unmitigated MEDIUM across 58/58 scenarios.

## Context

A RED TEAM audit of the full TheMemory + TheoCloud system surfaced 6 findings across 4 severity bands (1 CRITICAL, 1 HIGH, 3 MEDIUM, 1 LOW). 8 of 58 scenarios are blocked by these findings. All fixes qualify as PRIORITY 0 hardening (sub-goals 2 + 3): they harden the existing REST/MCP/Docker distribution surface without introducing new features.

The findings span two repos: `theo-memory` (F1-F4) and `theo-cloud` (F5-F6). F1 is an operational config gap, not a code defect. F2-F3 are missing middleware layers. F4 is documentation-only. F5-F6 are targeted Go/Helm patches in the sibling repo.

## Baseline Context

| File | LoC | Role |
|---|---|---|
| `src/server/app.ts` | ~248 | Hono app composer; mounts 4 verbs, bearer middleware, health endpoints, admin sub-app, OpenAPI, OTel |
| `src/server/auth/middleware.ts` | ~70 | Bearer auth middleware factory; passes through when `THEMEMORY_API_KEY` is undefined (alpha mode) |
| `src/server/auth/bearer-verifier.ts` | ~40 | `readApiKey()` reads `THEMEMORY_API_KEY` from `process.env`; `BearerAuthVerifier` compares tokens |
| `src/core/options.ts` | ~100+ | Option-bag types for the 4 public verbs (`RememberOptions`, `RecallOptions`, etc.) |
| `docker-compose.prod.yaml` | ~80 | Production stack; already passes `THEMEMORY_API_KEY: ${THEMEMORY_API_KEY:-}` to the container |
| `theo-cloud/theo/cloud/internal/routes/memory.go` | (cross-repo) | BFF memory route handlers |
| `theo-cloud/theo/infra/scripts/local/patch-kratos-dev-public.sh` | (cross-repo) | Kratos dev-local CSP patch script |

### Current auth flow (F1 root cause)

`src/server/auth/middleware.ts:32-36`: `readApiKey()` reads `process.env['THEMEMORY_API_KEY']`. When the value is `undefined`, the middleware calls `next()` unconditionally (alpha mode passthrough). The code is correct by design. The problem is operational: neither `.env.example` nor any startup documentation prompts the operator to set `THEMEMORY_API_KEY`, so every standalone deployment runs in alpha mode with zero auth enforcement.

### Middleware stack ordering in app.ts

The current ordering is: OpenAPI (auth-exempt) -> OTel -> bodyLimit -> health (auth-exempt) -> well-known (auth-exempt) -> admin sub-app -> generic bearer -> verb routes. New middleware (CORS, rate-limit) must be inserted at correct positions.

## Prior Art

- **Hono CORS middleware**: built-in `hono/cors` -- battle-tested, configurable `origin`, standard OWASP headers. No external dependency needed.
- **Rate limiting**: Hono does not ship a built-in rate limiter. Options: `hono-rate-limiter` (npm, in-memory + Redis stores), or a simple hand-rolled sliding-window counter (< 50 lines). For a single-process OSS server, in-memory sliding window is sufficient (KISS); distributed deployments add Redis behind the same interface later.
- **OWASP output-encoding discipline**: the canonical XSS mitigation for APIs that store verbatim text. React auto-escapes JSX; raw HTML consumers must sanitize on render. Documentation-only contract per OWASP API Security Top 10 (2023) API8.

## Objective

Close all 6 RED TEAM findings with minimal surface change. Unblock 8 blocked scenarios. Maintain backward compatibility for existing alpha-mode consumers (auth remains opt-in via env presence, not mandatory).

## In-Scope

- F1: Operational auth activation (`.env.example` + documentation + integration test)
- F2: Rate-limit middleware for REST API
- F3: CORS middleware for REST API
- F4: JSDoc XSS contract on `RememberOptions.text` and `RememberOptions.category`
- F5: Date range `from > to` validation in theo-cloud BFF (Go)
- F6: Kratos `SERVE_PUBLIC_BASE_URL` integration in dev-local startup flow

## Out-of-Scope

- Redis-backed distributed rate limiting (future; YAGNI for single-process OSS)
- Input sanitization / HTML escaping at the storage layer (explicitly rejected by F4 contract)
- Auth enforcement as mandatory (alpha mode passthrough preserved by design)
- Rate-limit persistence across restarts (in-memory only for v1)

## ADRs

### D1 -- Auth activation is operational, not code

**Decision**: Fix F1 by adding `THEMEMORY_API_KEY` to `.env.example` with a generated placeholder and documenting the activation step in `README.md`. Do NOT change the middleware code.

**Rationale**: The middleware already implements correct behavior: undefined = alpha mode (passthrough), defined = enforced. The gap is that no template or documentation prompts the operator to set the value. Changing the middleware to require auth by default would break backward compatibility for every existing consumer and contradict the `docker-compose.prod.yaml` `${THEMEMORY_API_KEY:-}` pattern (empty = open mode).

**Rejected alternative**: Make `THEMEMORY_API_KEY` mandatory at boot (fail-fast if undefined). Rejected because: (a) breaks the docker-compose.prod.yaml contract where empty = open mode, (b) forces CI/test environments to generate tokens for health-check-only deployments, (c) the alpha-mode design is documented and intentional per `src/server/auth/middleware.ts` JSDoc.

### D2 -- In-memory sliding-window rate limiter

**Decision**: Implement a simple in-memory sliding-window rate limiter as `src/server/middleware/rate-limit.ts`. Configurable via `THEMORY_RATE_LIMIT_WRITES` (default 30/min) and `THEMORY_RATE_LIMIT_READS` (default 100/min). Differentiate write endpoints (`/v1/remember`, `/v1/forget`, `/v1/reflect`) from read endpoints (`/v1/recall`, `/v1/scopes/*`).

**Rationale**: Single-process Node.js server (the shipped Docker image runs one process). In-memory is sufficient, zero external dependency, deterministic in tests. The sliding window is a standard algorithm (more accurate than fixed window, simpler than token bucket). Config via env matches the `THEMEMORY_API_KEY` / `THEOMEM_PG_URI` convention.

**Rejected alternative A**: Use `hono-rate-limiter` npm package. Rejected because: the package has low adoption (< 500 weekly downloads as of 2026-06), adds an external dependency for ~40 lines of code, and its Redis store is YAGNI for our single-process target. Rule 9 applies, but the cost of the dependency exceeds the cost of the implementation here.

**Rejected alternative B**: Token bucket algorithm. Rejected because: more complex to implement correctly, no material benefit over sliding window for our request patterns (low-volume API, not a CDN edge).

### D3 -- CORS via hono/cors with env-configurable origin

**Decision**: Mount `hono/cors` middleware (built-in, zero dependency) BEFORE the bearer middleware in `app.ts`. Origin configurable via `THEMORY_CORS_ORIGIN` env (default `*` for dev; consumer overrides for prod). Expose standard headers: `Authorization`, `Content-Type`.

**Rationale**: `hono/cors` is built-in to Hono (zero dependency per Rule 9). Default `*` matches the alpha-mode philosophy (open for dev). Production consumers set the origin to their domain. Mounting before bearer ensures preflight OPTIONS requests succeed without auth.

**Rejected alternative**: Hand-roll CORS headers in `app.ts`. Rejected because: `hono/cors` already exists, is battle-tested, handles preflight correctly, and is 3 lines to wire. Hand-rolling violates Rule 9 (don't reinvent the wheel).

**Consequences (EC-2 absorption)**: When `THEMORY_CORS_ORIGIN` is `*`, the server MUST NOT set `Access-Control-Allow-Credentials: true` — per the Fetch spec, `*` is incompatible with `credentials: include` (browsers silently reject the response). `hono/cors` handles this correctly by default (`credentials: false` when `origin: '*'`). Consumers needing credentialed cross-origin access MUST set `THEMORY_CORS_ORIGIN` to their explicit origin. Document in README.

## Drawbacks & Risks

1. **In-memory rate limiter resets on restart.** A process crash or deployment clears all counters. An attacker could theoretically burst during the restart window. Mitigation: this is acceptable for a single-process OSS server; Redis-backed store is a documented future path. The risk window is seconds, not minutes.

2. **CORS `*` default is permissive.** Alpha-mode consumers who don't read the docs may deploy to production with `*` origin. Mitigation: `README.md` documents the security implication explicitly; `themory server` emits a startup WARN when `THEMORY_CORS_ORIGIN` is unset and `NODE_ENV=production`.

3. **Cross-repo changes (F5 + F6) cannot be tested in theo-memory CI.** Go unit tests for F5 run in theo-cloud CI; Helm values for F6 are validated by `helm template --validate`. Mitigation: acceptance criteria include specific test commands to run in the sibling repo.

## Unresolved Questions

1. **Rate-limit key**: Should rate limiting key on IP address, Bearer token, or both? Decision: IP address for unauthenticated requests, Bearer token for authenticated requests. This avoids penalizing legitimate multi-client deployments behind a single IP while still limiting per-token abuse.

2. **F6 Helm values scope**: The Kratos CSP fix may need different values for dev vs staging. Decision: patch only dev-local values (the scope of F6); staging/prod values are managed by the platform team and out of scope for this cycle.

## Dependency Graph

```
Phase 1 (F1 auth activation) -- no deps --------------------------+
Phase 2 (F2 rate-limit + F3 CORS) -- no deps --------------------+
Phase 3 (F4 XSS contract) -- no deps ----------------------------+
Phase 4 (F5 date range + F6 Kratos) -- no deps (cross-repo) -----+
Phase 5 (integration validation) -- depends on ALL above ---------+
```

Phases 1-4 are independent and can execute in parallel. Phase 5 depends on all prior phases.

---

## Phase 1 -- F1: Auth Activation (Operational)

### T1.1 -- Add THEMEMORY_API_KEY to env template and document activation

#### Why this step

The CRITICAL finding (F1) exists because no env template or documentation prompts the operator to set `THEMEMORY_API_KEY`. The middleware code is correct; the gap is operational. This task closes the gap by making the env var visible in the template and documenting it.

#### TDD

```
RED:   test('env.example contains THEMEMORY_API_KEY with a non-empty placeholder value')
       test('401 returned when THEMEMORY_API_KEY is set and no Bearer header sent')
       test('200 returned when THEMEMORY_API_KEY is set and correct Bearer header sent')
GREEN: Add THEMEMORY_API_KEY to .env.example; write integration test against real server
REFACTOR: Ensure test uses vi.stubEnv for env mutation (not direct process.env assignment)
```

#### Concurrency tests

(none -- single-threaded; env read is synchronous)

#### Files to edit

- `.env.example` -- add `THEMEMORY_API_KEY=changeme-generate-a-secret`
- `README.md` -- add a "Security: Enabling authentication" subsection under the REST API section
- `docker-compose.prod.yaml` -- add a comment above line 49 stating the var MUST be set for production
- `tests/integration/auth/env-activation.test.ts` (new) -- integration test verifying 401/200 behavior

#### Acceptance Criteria

- [ ] `.env.example` contains `THEMEMORY_API_KEY=changeme-generate-a-secret`
- [ ] `README.md` documents the activation step with a concrete example
- [ ] Integration test: request to `/v1/remember` without Bearer returns 401 when env is set
- [ ] Integration test: request to `/v1/remember` with correct Bearer returns 200/400 (not 401)
- [ ] Integration test: request to `/v1/health` returns 200 regardless of auth (health is exempt)
- [ ] `docker-compose.prod.yaml` has a comment warning that `THEMEMORY_API_KEY` must be set for production

#### DoD

- Tests pass (`npm test`)
- `npm run typecheck` zero errors
- CHANGELOG `[Unreleased]` updated under `Fixed`

---

## Phase 2 -- F2 + F3: Rate Limiting and CORS

### T2.1 -- Rate-limit middleware

#### Why this step

F2 (HIGH): the REST API has no rate limiting, allowing unbounded request volume from any client. This task adds an in-memory sliding-window rate limiter differentiated by write vs read endpoints, configurable via env vars.

#### TDD

```
RED:   test('returns 429 after exceeding write rate limit on /v1/remember')
       test('returns 429 after exceeding read rate limit on /v1/recall')
       test('does not rate-limit /v1/health endpoints')
       test('respects THEMORY_RATE_LIMIT_WRITES env override')
       test('resets window after the time window elapses')
       test('EC-1: IPv4-mapped-IPv6 ::ffff:127.0.0.1 and raw 127.0.0.1 map to same bucket')
       test('EC-3: per-token isolation — token A at limit does not block token B')
       test('EC-4: THEMORY_RATE_LIMIT_WRITES=0 falls back to default 30')
       test('EC-4: THEMORY_RATE_LIMIT_WRITES=-5 falls back to default 30')
       test('EC-4: THEMORY_RATE_LIMIT_WRITES=abc falls back to default 30 with WARN')
GREEN: Implement SlidingWindowRateLimiter class + Hono middleware factory + IPv6 normalization
REFACTOR: Extract rate-limiter logic from middleware wiring
```

#### Concurrency tests

(none -- single-threaded Node.js; Map-based counter is not shared across workers)

#### Files to edit

- `src/server/middleware/rate-limit.ts` (new) -- `SlidingWindowRateLimiter` class + `rateLimitMiddleware()` factory
- `src/server/app.ts` -- mount rate-limit middleware after CORS, before bearer
- `src/__tests__/server/middleware/rate-limit.test.ts` (new) -- unit tests for `SlidingWindowRateLimiter`
- `tests/integration/server/rate-limit.test.ts` (new) -- integration test against real Hono app

#### Acceptance Criteria

- [ ] `SlidingWindowRateLimiter` tracks requests per key in a sliding time window
- [ ] Write endpoints (`/v1/remember`, `/v1/forget`, `/v1/reflect`) share one limit (default 30/min)
- [ ] Read endpoints (`/v1/recall`, `/v1/scopes/*`) share one limit (default 100/min)
- [ ] Health endpoints (`/v1/health`, `/v1/health/db`) are exempt
- [ ] `THEMORY_RATE_LIMIT_WRITES` and `THEMORY_RATE_LIMIT_READS` env vars override defaults
- [ ] 429 response includes `Retry-After` header (seconds until window reset)
- [ ] Rate-limit key is IP-based for unauthenticated, Bearer-token-based for authenticated
- [ ] EC-1: IPv6 key normalization — `::ffff:127.0.0.1` stripped to `127.0.0.1` so same client gets one bucket
- [ ] EC-3: per-token isolation — token A at limit does NOT block token B (separate buckets)
- [ ] EC-4: env var clamping — `0`, negative, and non-numeric values fall back to defaults with WARN
- [ ] Unit tests: SlidingWindowRateLimiter tracks, rejects, resets, normalizes IPv6, clamps env
- [ ] Integration tests: 429 returned after limit exceeded; 200 within limit; per-token isolation

#### DoD

- Tests pass (`npm test`)
- `npm run typecheck` zero errors
- CHANGELOG `[Unreleased]` updated under `Added`

### T2.2 -- CORS middleware

#### Why this step

F3 (MEDIUM): the REST API returns no CORS headers, preventing browser-based consumers from calling the API. This task wires `hono/cors` with configurable origin.

#### TDD

```
RED:   test('OPTIONS preflight returns Access-Control-Allow-Origin header')
       test('CORS origin defaults to * when THEMORY_CORS_ORIGIN is unset')
       test('CORS origin respects THEMORY_CORS_ORIGIN env override')
       test('preflight succeeds without Bearer token')
       test('EC-5: preflight includes Access-Control-Max-Age header for cache')
       test('EC-2: credentials header NOT set when origin is * (Fetch spec compliance)')
GREEN: Mount hono/cors in app.ts before bearer middleware with maxAge config
REFACTOR: Ensure CORS middleware position is documented in the ordering comment block
```

#### Concurrency tests

(none -- single-threaded; middleware is stateless)

#### Files to edit

- `src/server/app.ts` -- import and mount `cors` from `hono/cors` before bearer middleware
- `tests/integration/server/cors.test.ts` (new) -- integration test for CORS headers

#### Acceptance Criteria

- [ ] `OPTIONS` preflight to `/v1/remember` returns 204 with `Access-Control-Allow-Origin`
- [ ] `Access-Control-Allow-Headers` includes `Authorization` and `Content-Type`
- [ ] `Access-Control-Allow-Methods` includes `GET, POST, DELETE, OPTIONS`
- [ ] Default origin is `*` when `THEMORY_CORS_ORIGIN` is unset
- [ ] Setting `THEMORY_CORS_ORIGIN=https://example.com` restricts the header value
- [ ] Preflight does not require Bearer token (OPTIONS is auth-exempt)
- [ ] EC-5: `Access-Control-Max-Age` header present on preflight response (default 86400 / 24h)
- [ ] EC-2: `Access-Control-Allow-Credentials` NOT set when origin is `*` (Fetch spec compliance)
- [ ] `themory server` emits WARN on startup when `NODE_ENV=production` and `THEMORY_CORS_ORIGIN` is unset

#### DoD

- Tests pass (`npm test`)
- `npm run typecheck` zero errors
- CHANGELOG `[Unreleased]` updated under `Added`

---

## Phase 3 -- F4: XSS Contract (Documentation Only)

### T3.1 -- JSDoc XSS storage contract on RememberOptions

#### Why this step

F4 (MEDIUM): consumers may assume the API sanitizes input, leading to stored XSS when rendering memory content in HTML. This task adds explicit JSDoc documenting the verbatim-storage contract and the consumer's responsibility to escape on render.

#### TDD

```
RED:   test('RememberOptions JSDoc contains verbatim-storage language')
       (grep-based contract test against the source file)
GREEN: Add JSDoc to RememberOptions.text and RememberOptions.category
REFACTOR: Ensure JSDoc references OWASP output-encoding
```

#### Concurrency tests

(none -- documentation-only change)

#### Files to edit

- `src/core/options.ts` -- add/update JSDoc on `RememberOptions` text field and update existing category JSDoc

#### Acceptance Criteria

- [ ] `RememberOptions.text` has JSDoc stating: storage is verbatim, no input sanitization; consumers MUST escape on render per OWASP output-encoding discipline
- [ ] `RememberOptions.category` JSDoc updated to include the same verbatim-storage note
- [ ] JSDoc mentions React auto-escaping as the default safe path; raw HTML renderers require explicit sanitization
- [ ] No runtime code changes (documentation only)

#### DoD

- `npm run typecheck` zero errors
- CHANGELOG `[Unreleased]` updated under `Changed`

---

## Phase 4 -- F5 + F6: Cross-Repo Fixes (theo-cloud)

### T4.1 -- BFF date range validation (F5)

#### Why this step

F5 (LOW): the BFF memory handler in theo-cloud accepts `from` and `to` query params but does not validate that `from <= to`. When `from > to`, the query returns empty results silently instead of a clear 422 error.

#### TDD

```
RED:   test('returns 422 when from > to in memory list endpoint')
       test('returns 200 when from < to')
       test('returns 200 when only from is set')
       test('returns 200 when only to is set')
       test('EC-6: returns 200 when from == to (same-day is valid single-day window)')
GREEN: Add validation check in the handler: if both non-empty and from > to (strict >), return 422
REFACTOR: Extract date validation into a helper if the pattern repeats
```

#### Concurrency tests

(none -- stateless HTTP handler; no shared mutable state)

#### Files to edit

- `theo-cloud/theo/cloud/internal/routes/memory.go` -- add `from > to` check (~5 lines)
- `theo-cloud/theo/cloud/internal/routes/memory_test.go` (new or existing) -- Go unit test

#### Acceptance Criteria

- [ ] `GET /api/memories?from=2026-06-10&to=2026-06-01` returns 422 with message `"from" must not be after "to"`
- [ ] `GET /api/memories?from=2026-06-01&to=2026-06-10` returns 200
- [ ] `GET /api/memories?from=2026-06-01` (no `to`) returns 200
- [ ] `GET /api/memories?to=2026-06-10` (no `from`) returns 200
- [ ] EC-6: `GET /api/memories?from=2026-06-09&to=2026-06-09` returns 200 (same-day valid; check is strict `>`, NOT `>=`)
- [ ] Go unit test covers all 5 cases

#### DoD

- `go test ./cloud/internal/routes/...` passes
- `go vet ./...` clean

### T4.2 -- Kratos dev-local SERVE_PUBLIC_BASE_URL fix (F6)

#### Why this step

F6 (MEDIUM): the Kratos dev-local configuration does not set `SERVE_PUBLIC_BASE_URL` correctly, causing CSP violations in the browser-based auth flow. The patch script `theo-cloud/theo/infra/scripts/local/patch-kratos-dev-public.sh` already exists but is not integrated into the startup flow.

#### TDD

```
RED:   test('helm template with dev values includes SERVE_PUBLIC_BASE_URL')
       (helm template --validate against the dev values file)
GREEN: Patch Helm values + integrate script into startup documentation
REFACTOR: Ensure the patch is idempotent
```

#### Concurrency tests

(none -- infrastructure configuration; no runtime concurrency)

#### Files to edit

- `theo-cloud/theo/infra/scripts/local/patch-kratos-dev-public.sh` -- ensure idempotency
- Helm dev values file (under `theo-cloud/theo/infra/helm/`) -- add `SERVE_PUBLIC_BASE_URL` to Kratos config
- Dev-setup documentation in theo-cloud -- document the script integration step

#### Acceptance Criteria

- [ ] `helm template --validate` with dev values succeeds and includes `SERVE_PUBLIC_BASE_URL`
- [ ] `patch-kratos-dev-public.sh` is idempotent (running twice produces same result)
- [ ] Dev-setup documentation references the script or integrates it into the startup sequence
- [ ] Browser-based auth flow in dev-local no longer triggers CSP violations

#### DoD

- `helm template --validate` passes
- Script runs idempotently

---

## Phase 5 -- Integration Validation

### T5.1 -- RED TEAM re-run

#### Why this step

The full fix cycle must be validated end-to-end by re-running the RED TEAM audit against the patched system. This is the acceptance gate for the entire plan.

#### TDD

```
RED:   (the existing 8 blocked RED TEAM scenarios ARE the failing tests)
GREEN: All 58/58 scenarios pass with 0 CRITICAL, 0 HIGH, 0 unmitigated MEDIUM
REFACTOR: Document any residual LOW findings as accepted risk
```

#### Concurrency tests

(none -- validation phase, not code)

#### Files to edit

- No source files; this is a validation-only task
- Output: RED TEAM re-run report documenting 58/58 pass rate

#### Acceptance Criteria

- [ ] RED TEAM re-run covers 58/58 scenarios
- [ ] 0 CRITICAL findings
- [ ] 0 HIGH findings
- [ ] 0 unmitigated MEDIUM findings (all MEDIUM either fixed or documented with explicit accept)
- [ ] Previously-blocked 8 scenarios now pass

#### DoD

- RED TEAM report persisted in knowledge-base

---

## Coverage Matrix

| Goal claim | Task(s) | Test(s) |
|---|---|---|
| F1 CRITICAL: REST auth zero enforcement closed | T1.1 | `tests/integration/auth/env-activation.test.ts` (401 without Bearer, 200 with Bearer, health exempt) |
| F2 HIGH: Rate limiting enforced | T2.1 | `src/__tests__/server/middleware/rate-limit.test.ts` (unit) + `tests/integration/server/rate-limit.test.ts` (integration: 429 after limit) |
| F3 MEDIUM: CORS headers present | T2.2 | `tests/integration/server/cors.test.ts` (preflight 204, headers correct, env override) |
| F4 MEDIUM: XSS contract documented | T3.1 | Grep-based contract test on `src/core/options.ts` for verbatim-storage language |
| F5 LOW: Date range from > to rejected | T4.1 | `memory_test.go` (422 when from > to, 200 otherwise) |
| F6 MEDIUM: Kratos CSP fixed in dev | T4.2 | `helm template --validate` + idempotent script run |
| 8 blocked scenarios unblocked | T5.1 | RED TEAM re-run 58/58 |
| Health endpoints remain auth-exempt | T1.1 | `env-activation.test.ts` (health returns 200 regardless of auth) |
| Rate-limit exempt on health | T2.1 | `rate-limit.test.ts` (health not rate-limited) |
| CORS preflight auth-exempt | T2.2 | `cors.test.ts` (OPTIONS without Bearer returns 204) |
| EC-1 IPv6 key normalization | T2.1 | `rate-limit.test.ts` (::ffff:127.0.0.1 and 127.0.0.1 → same bucket) |
| EC-2 CORS wildcard+credentials conflict | T2.2 + ADR D3 | `cors.test.ts` (credentials NOT set when origin=*) + README docs |
| EC-3 per-token rate-limit isolation | T2.1 | `rate-limit.test.ts` (token A at limit does not block token B) |
| EC-4 env var clamping (0/negative/non-numeric) | T2.1 | `rate-limit.test.ts` (falls back to default 30 with WARN) |
| EC-5 CORS preflight Max-Age | T2.2 | `cors.test.ts` (Access-Control-Max-Age header present) |
| EC-6 same-day date range valid | T4.1 | `memory_test.go` (from=to returns 200, NOT 422) |

## Failure Scenarios

| Scenario | Detection | Mitigation |
|---|---|---|
| Rate limiter Map grows unbounded under sustained attack | Memory monitoring; Map size exceeds threshold | Periodic cleanup of expired entries in the sliding window (built into the implementation); worst case: process restart clears all state |
| CORS `*` deployed to production | Startup WARN when `NODE_ENV=production` and `THEMORY_CORS_ORIGIN` unset | Documentation + WARN log; operator responsibility per alpha-mode philosophy |
| `.env.example` not copied by operator | Auth stays in alpha mode (passthrough) | Documentation + docker-compose comment; non-breaking (same as today) |
| Rate-limit env vars set to invalid values (negative, non-numeric) | Validation at startup; fall back to defaults with WARN | `parseInt` with fallback + WARN log |

## Global Definition of Done

- [ ] All T1.1-T3.1 tests pass (`npm test` in theo-memory)
- [ ] All T4.1 tests pass (`go test` in theo-cloud)
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings
- [ ] CHANGELOG `[Unreleased]` updated with all changes
- [ ] No new `any` in public surface
- [ ] No paper names in `src/**/*.ts` (per `no-paper-names-in-code.md`)
- [ ] RED TEAM re-run: 58/58 scenarios, 0 CRITICAL, 0 HIGH, 0 unmitigated MEDIUM
- [ ] Plan archived to `knowledge-base/plans/completed/` after merge
