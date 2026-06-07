# Edge Case Review — theo-memory-faang-auth-lifecycle

Data: 2026-06-07
Plano analisado: `.claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-plan.md` (v1.0)
Tasks analisadas: 10 (T0.1, T0.2, T1.1, T1.2, T2.1, T2.2, T2.3, T3.1, T4.1, T4.2, T5.1)
Edge cases encontrados: **13 (MUST FIX: 5, SHOULD TEST: 5, DOCUMENT: 3)**

## MUST FIX

### EC-1: dual-validation prefix-routing has NO fallthrough policy when `theo_live_*` collides
- **Task afetada:** T3.1 (dual-validation middleware composition)
- **Família:** Boundary / Format
- **Cenário:** OIDC issuer happens to issue access tokens starting with the literal `theo_live_` (unlikely but possible — `theo_live_` is not RFC-protected). The middleware routes them to `apiKey.verify()`; SHA-256 lookup fails (token not in `theo_api_keys` table); the middleware returns false → 401. Legitimate OIDC consumer is BLOCKED. Worse: if a future OIDC issuer is configured AFTER deploy, every existing `theo_live_*`-collision JWT silently 401s with no explanation in logs.
- **Impacto:** Silent privilege denial for legitimate OIDC consumers. Plan T3.1 pseudocode is `if startsWith('theo_live_') → apiKey.verify → return` — there's no fallthrough.
- **Fix sugerido:** In `dualValidationAuth`, tighten the prefix check to require `theo_live_` + at least 32 chars AND match the `theo_live_[A-Za-z0-9_-]{43}` regex shape; if shape doesn't match BUT prefix starts, log a `prefix_collision_detected` warning + fall through to `oidc.verify(token)`. Add this as a new edge case in T3.1 Deep Dives + add a RED test `dual_validation_falls_through_to_oidc_when_theo_live_prefix_shape_invalid`.

### EC-2: Recursive CTE in lineage query has NO cycle detection
- **Task afetada:** T2.1 (lineage handler) + T0.2 (schema FK shape)
- **Família:** State
- **Cenário:** A bug (or malicious admin) creates `theo_api_keys` rows where A.rotated_from = B AND B.rotated_from = A (cyclic FK self-reference). The recursive CTE walks A → B → A → B → ... and only stops at the `LIMIT 100` cap — returning a polluted lineage chain that confuses dashboard UI + lineage table query plan.
- **Impacto:** UI shows nonsense chain; database query plan inflates; in cloud-repo, the same bug would propagate to multi-tenant via the same code path.
- **Fix sugerido:** In the lineage CTE add `UNION` (not `UNION ALL`) to dedupe rows + add a "cycle detected" sentinel via `WHERE NOT EXISTS (recursive visited check)`. Alternative pragmatic fix: add a DB CHECK constraint `id != rotated_from` at the schema level (T0.2) to forbid self-rotation at the row level. Add test `lineage_handles_cyclic_rotated_from_safely` in T2.1.

### EC-3: Bootstrap token + revoked admin key — precedence undefined
- **Task afetada:** T2.2 (scope verifier) + ADR D7
- **Família:** Permission / State
- **Cenário:** Operator sets `THEMORY_ADMIN_BOOTSTRAP_TOKEN=<env>`, issues a first admin key via bootstrap, then revokes that admin key (intent: rotate). They forget to UNSET the bootstrap env var. Now the bootstrap token STILL works (gives admin), but the admin key DOESN'T. The bootstrap is now an undocumented backdoor — not invalidatable without server restart.
- **Impacto:** Bootstrap leak = persistent admin escalation that revoke cannot kill. Inquebrável Rule 8 violation (silent persistence).
- **Fix sugerido:** ADR D7 must REQUIRE the bootstrap token to be VALIDATED AT EACH USE against a server-side flag `bootstrap_consumed: boolean` stored in a one-row admin-config table OR in `theo_api_keys` as a special sentinel row. Once the first admin key is created, set `bootstrap_consumed = true` + reject subsequent bootstrap-token uses (return 401 + log `bootstrap_already_consumed`). Add this as new sub-task T2.2.1 + sentinel test `bootstrap_token_self_revokes_after_first_admin_key_issuance`.

### EC-4: OidcAuthVerifier has NO HTTP timeout on introspection call
- **Task afetada:** T3.1 (OidcAuthVerifier impl)
- **Família:** Resource / I/O
- **Cenário:** OIDC issuer (Hydra/Keycloak/Auth0) is slow OR network is partitioned. Default `oauth4webapi` calls use `fetch` with no timeout → request hangs forever. Every memory API call queues behind the hung introspection. Process eventually OOMs from accumulated pending requests.
- **Impacto:** DoS via slow OIDC issuer. Inquebrável Rule 8 fail-fast violation.
- **Fix sugerido:** In T3.1 `OidcConfig` add `introspectionTimeoutMs?: number` (default 5000 = 5s). In the impl, wrap the introspection call with `AbortController` + 5s timeout; on timeout return false (treats as failed auth → 401) AND log `introspection_timeout`. Add RED test `oidc_verify_returns_false_on_introspection_timeout`.

### EC-5: Concurrent introspection cache miss — thundering herd against OIDC issuer
- **Task afetada:** T3.1 (OidcAuthVerifier cache)
- **Família:** Timing / Concurrency
- **Cenário:** 100 concurrent requests come in for the SAME token; cache is empty (first time OR just expired). All 100 fire introspection HTTP calls in parallel. OIDC issuer is DDoS'd by legitimate traffic spike. If issuer rate-limits us, all 100 fail → all 100 return 401 to legitimate users.
- **Impacto:** DDoS amplification (1 client request → 100 introspect calls). RFC 7662 § 4 caveat explicitly warns about caching trade-offs but doesn't mandate coalescing.
- **Fix sugerido:** In T3.1 OidcAuthVerifier impl, add request-coalescing via a `Map<token-hash, Promise<boolean>>` keyed by SHA-256 of the token. When a cache miss happens, the FIRST call creates the Promise + stores it; subsequent calls for the same token-hash AWAIT the same Promise. After the Promise settles, store result in cache + remove from in-flight map. ~10 LoC + 1 test `oidc_verify_coalesces_concurrent_cache_misses_for_same_token`.

## SHOULD TEST

### EC-6: Concurrent createKey id collision
- **Task afetada:** T2.1
- **Teste sugerido:** `create_key_handles_id_collision_via_db_unique_constraint` — fire 100 concurrent createKey calls; assert all 100 succeed AND all return distinct apk-{16hex} ids (validates the apk-id generation entropy + DB UNIQUE PK retry path).

### EC-7: createKey accepts duplicate scopes in input array
- **Task afetada:** T2.1
- **Teste sugerido:** `create_key_dedupes_scopes_array` — POST with `scopes: ["memory:read", "memory:read", "memory:write"]` → DB row's scopes column has `["memory:read", "memory:write"]` (2 entries, not 3). Implementation fix: `scopes: [...new Set(input.scopes)]` before INSERT.

### EC-8: SHA-256 hash with token containing SQL metachars
- **Task afetada:** T1.2
- **Teste sugerido:** `verify_handles_token_with_sql_metachars_safely` — pass token `theo_live_abc'; DROP TABLE theo_api_keys; --` and assert the parameterized query runs safely + returns false (no injection); pin the parameterization invariant.

### EC-9: testcontainers + pgvector cold-start timeout
- **Task afetada:** T5.1
- **Teste sugerido:** Configure `vitest.integration.config.ts` `testTimeout: 90_000` for tests under `tests/integration/auth/`; document in T5.1 Deep Dive that first pgvector image pull can take 60s+. Add comment in test file: `// First run pulls ankane/pgvector:v0.5.1 image (~250MB); allow 90s timeout`.

### EC-10: WWW-Authenticate header format per RFC 6750 § 3
- **Task afetada:** T4.1
- **Teste sugerido:** `mcp_http_401_includes_well_formed_www_authenticate` — assert response has `WWW-Authenticate: Bearer realm="theo-mcp", error="invalid_token", error_description="<reason>", resource_metadata="/.well-known/oauth-protected-resource"` (per RFC 6750 § 3 + MCP spec Q8 finding). Test pin prevents drift.

## DOCUMENT

### EC-11: SHA-256 hash collision in 256-bit space
- **Risco aceito:** Collision probability is ~1 in 2^128 (birthday bound). DB UNIQUE constraint on `key_hash` column catches the astronomical case + returns 500 INTERNAL_ERROR which is honest. Per ADR D4 of cloud-repo plan ("astronomically unlikely but is the one branch we differentiate so we don't lie about it being a generic error") — log line included. No code change needed beyond existing UNIQUE constraint.

### EC-12: Cache staleness window on upstream revoke
- **Risco aceito:** When the OIDC issuer revokes a token upstream, our cache MAY hold it as `active: true` for up to TTL (60-300s default). This is explicitly documented in RFC 7662 § 4 as a known trade-off. Document in ADR-0013 + the `--oidc-cache-ttl-seconds` flag docs that operators concerned about revocation propagation should set TTL=0 (disable cache, 1 introspection per request) for high-sensitivity deployments.

### EC-13: DPoP RFC 9449 is DEFERRED to Camada 4
- **Risco aceito:** Bearer tokens are bearer-bound (anyone with the token can use it). DPoP would bind the token to a client-side keypair (theft-resistant). Per blueprint Q5: enterprise-tier feature deferred to Camada 4 cloud-repo plan. Document in ADR-0013 as a known gap with the deferral rationale; revisit when enterprise customers ask.

## Resumo

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T0.2 | 1 | 0 | 0 | 1 (EC-11) |
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 1 | 0 | 1 (EC-8) | 0 |
| T2.1 | 3 | 0 | 2 (EC-6, EC-7) | 0 |
| T2.2 | 1 | 1 (EC-3) | 0 | 0 |
| T2.3 | 0 | 0 | 0 | 0 |
| T3.1 | 4 | 3 (EC-1, EC-4, EC-5) | 0 | 1 (EC-12) |
| T3.2 | 0 | 0 | 0 | 0 |
| T4.1 | 1 | 0 | 1 (EC-10) | 0 |
| T4.2 | 0 | 0 | 0 | 0 |
| T5.1 | 1 | 0 | 1 (EC-9) | 0 |
| Cross-cutting (schema cycle, DPoP) | 2 | 1 (EC-2) | 0 | 1 (EC-13) |
| **TOTAL** | **13** | **5** | **5** | **3** |

**Veredicto: PLANO PRECISA DE AJUSTE** — 5 MUST FIX precisam de absorção em v1.1 antes de `/plan-confidence`:

1. **EC-1** (dual-validation fallthrough) — extend T3.1 Deep Dive + add RED test
2. **EC-2** (lineage cycle detection) — extend T0.2 schema (CHECK `id != rotated_from`) + T2.1 CTE adjustment
3. **EC-3** (bootstrap self-revoke) — extend ADR D7 + new sub-task T2.2.1 + sentinel test
4. **EC-4** (OIDC introspection timeout) — extend T3.1 Deep Dive (`introspectionTimeoutMs` default 5000) + RED test
5. **EC-5** (concurrent cache-miss coalescing) — extend T3.1 Deep Dive (in-flight Map<token-hash, Promise>) + RED test

5 SHOULD TEST become new RED tests added to existing tasks (EC-6 into T2.1, EC-7 into T2.1, EC-8 into T1.2, EC-9 into T5.1, EC-10 into T4.1).

3 DOCUMENT become explicit notes (EC-11 into T0.2 + ADR D5 consequences; EC-12 into ADR-0013 § Consequences; EC-13 into ADR-0013 § Alternatives row "DPoP DEFERRED").

After v1.1 absorption: re-run `/plan-confidence` and proceed when verdict ≥ SHIPPABLE_WITH_CAVEATS.
