# Edge Case Review — red-team-full-system-fixes-cycle-1

Date: 2026-06-09
Tasks analyzed: 7 (T1.1, T2.1, T2.2, T3.1, T4.1, T4.2, T5.1)
Edge cases found: 8 (MUST FIX: 2, SHOULD TEST: 4, DOCUMENT: 2)

## MUST FIX

### EC-1: Rate limiter key extraction fails on IPv6 loopback

- **Affected task:** T2.1
- **Family:** Input / Format
- **Scenario:** Node.js `req.socket.remoteAddress` returns `::1` for localhost IPv6 connections, `::ffff:127.0.0.1` for IPv4-mapped-IPv6, and raw IPv4 `127.0.0.1` depending on OS + listen address. The plan says "IP-based for unauthenticated" but doesn't specify the extraction logic. If the middleware reads `c.req.header('x-forwarded-for')` it's trivially spoofable; if it reads the socket address, IPv6 variants of the same client get different rate-limit buckets.
- **Impact:** Rate-limit bypass via IPv6/IPv4 dual-stack OR bucket split (same client counted twice under different keys).
- **Suggested fix:** Normalize IP key: strip `::ffff:` prefix; use `c.req.header('x-real-ip') ?? c.env.incoming.socket.remoteAddress` with the prefix strip. For Hono on Node.js adapter, `c.req.raw` exposes the underlying request. Add one test asserting `::ffff:127.0.0.1` and `127.0.0.1` map to the same bucket.

### EC-2: CORS `*` wildcard + credentials conflict (RFC 6454 / Fetch spec)

- **Affected task:** T2.2
- **Family:** Boundary / Integration
- **Scenario:** When `Access-Control-Allow-Origin: *` and a browser sends `credentials: 'include'` (cookies/session), the Fetch spec MANDATES the browser REJECT the response — `*` is incompatible with `credentials: include`. The TheoCloud Dashboard proxies via Vite (same-origin), so this doesn't affect it today. But any future consumer using `fetch(..., { credentials: 'include' })` from a different origin will silently fail.
- **Impact:** Silent 401-like behavior for credentialed cross-origin consumers; hard to debug because the browser silently drops the response.
- **Suggested fix:** Add to ADR D3 Consequences: "When `THEMORY_CORS_ORIGIN` is `*`, the server MUST NOT set `Access-Control-Allow-Credentials: true`. `hono/cors` handles this correctly by default (credentials=false when origin=*). Document in README that credentialed cross-origin consumers MUST set `THEMORY_CORS_ORIGIN` to their explicit origin."

## SHOULD TEST

### EC-3: Rate limiter with THEMEMORY_API_KEY set — key switches from IP to Bearer token

- **Affected task:** T2.1
- **Suggested test:** `test_rate_limit_key_switches_to_bearer_when_auth_enabled()` — Set `THEMEMORY_API_KEY`; send 30 requests with Bearer token A (should hit limit); send 1 request with Bearer token B (should NOT be rate-limited because different key). Asserts that rate-limit isolation per token works correctly AND that the key extraction correctly branches on auth presence.

### EC-4: Rate limiter env var set to 0 or negative

- **Affected task:** T2.1
- **Suggested test:** `test_rate_limit_env_zero_falls_back_to_default()` — Set `THEMORY_RATE_LIMIT_WRITES=0`; send a request; assert it's NOT immediately 429'd. The implementation should clamp to default (30) when the parsed value is ≤ 0. Also test `THEMORY_RATE_LIMIT_WRITES=-5` and `THEMORY_RATE_LIMIT_WRITES=abc`.

### EC-5: CORS preflight caching (Access-Control-Max-Age)

- **Affected task:** T2.2
- **Suggested test:** `test_cors_preflight_includes_max_age_header()` — Assert that `OPTIONS` response includes `Access-Control-Max-Age` (e.g., 86400 for 24h). Without this header, browsers re-send the preflight on EVERY request, doubling request volume for cross-origin consumers.

### EC-6: Date range validation timezone edge (F5)

- **Affected task:** T4.1
- **Suggested test:** `TestDateRangeValidation_SameDay()` — `from=2026-06-09&to=2026-06-09` should return 200 (not 422). The `from > to` check must be `>` NOT `>=` — same-day is a valid single-day window.

## DOCUMENT

### EC-7: Rate limiter state lost on process crash

- **Accepted risk:** Already documented in plan Drawbacks #1. The reset window is seconds (time to restart). For single-process OSS this is acceptable. Redis-backed store is the documented future path for distributed deployments.

### EC-8: F6 Kratos patch scope limited to dev-local

- **Accepted risk:** Already documented in plan Unresolved Questions #2. Staging/prod Kratos config is managed by the platform team. This cycle's F6 fix targets ONLY the dev-local startup flow. If staging exhibits the same CSP issue, it's a separate ticket for the platform team.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T2.1 | 4 | 1 (EC-1) | 2 (EC-3, EC-4) | 1 (EC-7) |
| T2.2 | 2 | 1 (EC-2) | 1 (EC-5) | 0 |
| T3.1 | 0 | 0 | 0 | 0 |
| T4.1 | 1 | 0 | 1 (EC-6) | 0 |
| T4.2 | 1 | 0 | 0 | 1 (EC-8) |
| T5.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT

Two MUST FIX items to absorb into plan v1.1:

1. **EC-1** — Rate limiter IP key normalization (strip `::ffff:` prefix; one test asserting IPv4-mapped-IPv6 and raw IPv4 map to same bucket).
2. **EC-2** — CORS `*` + credentials conflict documented in ADR D3 Consequences + README; `hono/cors` default handles correctly but consumer guidance needed.

After absorption, the 4 SHOULD TEST items become explicit test additions in the TDD blocks (EC-3 per-token isolation, EC-4 env var clamping, EC-5 preflight Max-Age, EC-6 same-day date range). The 2 DOCUMENT items are already in plan Drawbacks/Unresolved; no new prose needed.
