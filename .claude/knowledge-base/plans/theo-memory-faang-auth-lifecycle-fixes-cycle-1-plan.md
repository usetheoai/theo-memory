# Plan: theo-memory-faang-auth-lifecycle-fixes-cycle-1 — Wire admin REST + OIDC production adapter + CLI `--issuer` flag

> **Version 1.1** (2026-06-07) — Absorbs `/edge-case-plan` review (12 ECs: 6 MUST FIX + 4 SHOULD TEST + 2 DOCUMENT — VERDICT PLANO PRECISA DE AJUSTE). **6 MUST FIX absorbed**: EC-1 (`adminApi.pool` runtime guard → T1.2 step added + T1.1 RED test 4 added), EC-2 (security-crítico — empty/whitespace bootstrap token bypass → T3.2 normalize step + scope-verifier defense-in-depth + sentinel test), EC-3 (`introspection_endpoint` missing from discovery doc → T2.2 fail-loud at construction), EC-4 (security — `--client-secret` flag visible in `ps` → ADR D4 estendida cobre client_secret env-only), EC-5 (`--issuer` URL validation no commander parser → T3.2 InvalidArgumentError), EC-6 (`--client-id` sem `THEMORY_OIDC_CLIENT_SECRET` cross-field validation → T3.2 fail-loud). **4 SHOULD TEST absorbed inline** (EC-7 route mounting order T1.1, EC-8 AbortSignal propagation T2.1, EC-9 resource URL when host=0.0.0.0 T3.1, EC-10 port cleanup T4.1). **2 DOCUMENT absorbed** (EC-11 K8s restart loop in ADR D3 § Consequences; EC-12 bootstrap token char policy in ADR D4 § Consequences). Goal metric unchanged at 6/6 e2e + 12/12 lifecycle sentinel.

> **Version 1.0** (2026-06-07) — Tightly-scoped follow-up to `theo-memory-faang-auth-lifecycle` (shipped same day, 14 commits across the full task set plus the Step 5.5 validation-fix). Closes the 2 honest deferrals documented in that cycle's final report: (a) admin REST `/v1/admin/keys/*` is NOT wired into `createApp()` so the freshly-shipped `themory keys` CLI returns 404 against `themory server`, and (b) OIDC mode (`--auth=oidc`) is plumbed-only — the `oauth4webapi` production `IntrospectFn` adapter does not exist yet, and CLI `--issuer` flag on `themory server` does not propagate to `createServer({ oidcDiscovery })`. Both gaps are wiring (handlers + DIPs + ADRs already shipped); this cycle is pure integration closure. PRIORITY 0 sub-goal 2 (SDK functional) + sub-goal 3 (MCP available) hardening per CLAUDE.md.

## Goal

> "Enable a self-hosted operator to run `themory server` AND `themory mcp --auth=oidc --issuer=<URL>`, then use `themory keys create/list/rotate/revoke` end-to-end OR present a valid OIDC JWT to `/v1/*` and have it accepted via real RFC 7662 introspection against the configured issuer, measured by the new integration test `tests/integration/auth/fixes-cycle-1-e2e.test.ts` passing 6/6 scenarios (3 admin-keys CLI round-trips + 2 OIDC introspection against a stubbed Hydra-shape issuer + 1 well-known auto-discovery) AND the existing 12-scenario `tests/integration/auth/lifecycle.test.ts` remaining 12/12 GREEN."

## Context

### What shipped in the parent cycle (2026-06-07, develop @ `033b37c`)

13 tasks committed across `theo-memory-faang-auth-lifecycle`:
- **Camada 2 (OSS lifecycle)**: `theo_api_keys` migration + `ApiKeyAuthVerifier` + 5 admin handlers (`createKeyHandler` / `listKeysHandler` / `revokeKeyHandler` / `rotateKeyHandler` / `lineageKeyHandler`) + `requireScope` middleware + bootstrap self-revoke (EC-3 absorption) + `themory keys` CLI.
- **Camada 3 (OIDC bridge)**: `OidcAuthVerifier` impl with EC-4 timeout + EC-5 in-flight coalescing + EC-12 cache staleness documentation + `dualValidationAuth` Hono middleware with EC-1 prefix-collision fallthrough.
- **MCP sub-goal 3**: `withBearerAuth` node:http wrapper + `connectStreamableHttp({ bearerAuth })` extension + ADR-0015 #3 non-localhost-TLS guard + `themory mcp --auth=<mode>` CLI flag.
- **RFC 9728**: `/.well-known/oauth-protected-resource` handler + `oidcDiscovery` option on `createServer`.
- **3 ADRs**: ADR-0013 (OIDC bridge) + ADR-0014 (OSS lifecycle) + ADR-0015 (MCP HTTP auth) + ADR-0009 supersession footer.
- **GOAL TEST**: 12/12 integration scenarios GREEN against real `ankane/pgvector:v0.5.1`.

### The 2 honest deferrals carried over

Both documented in `.claude/knowledge-base/implementations/.progress-theo-memory-faang-auth-lifecycle.json § notes` (final state) and in the parent cycle's MCP-wrapper + well-known commit messages:

1. **Admin REST NOT in `createApp()`** — `src/server/app.ts` mounts `/v1/{remember,recall,forget,reflect}` + `/v1/health{/db}` + `/v1/openapi.json` + `/.well-known/oauth-protected-resource` but does NOT mount `/v1/admin/keys/*`. The 5 handler functions exist + are unit-tested + are exercised by the standalone admin app inside `tests/integration/auth/lifecycle.test.ts`. But `themory server` boots without the admin sub-app → `themory keys create` returns 404 against the running server today.
2. **OIDC `--auth=oidc` is stderr-disclosure-only** — `src/agent-tools/run-mcp-server.ts::resolveBearerAuth` writes a one-line warning on stderr and falls back to api-keys-only when `--auth=oidc` or `--auth=both` is selected, because the production `oauth4webapi`-backed `IntrospectFn` adapter has not been written. Tests pass with stub `IntrospectFn`s injected directly via the `OidcAuthVerifier({ introspect })` DIP — but no production CLI path constructs the verifier.

### Evidence (verified 2026-06-07 prior turn)

- `grep -n "admin/keys" src/server/app.ts src/server/index.ts` → 0 matches confirming the wiring gap.
- `grep -rn "theo_api_keys" /home/paulo/Projetos/usetheo/theo-cloud/cloud/internal/` → 0 matches confirming no theo-cloud ↔ theo-memory bridge (out-of-scope cross-repo concern; documented separately).
- `node_modules/oauth4webapi/build/index.d.ts:2106 + 2147` → `introspectionRequest` + `processIntrospectionResponse` exports verified — the production adapter is a thin composition over these two functions per blueprint Q5.

## Objective

- [ ] Sub-goal 1 (Wire admin REST) — `createApp()` mounts `/v1/admin/keys/*` under `requireScope({ pool, requiredScope: 'memory:admin', bootstrapToken })` when an `AdminApiOptions` field is supplied to `CreateServerOptions`. Backward-compat preserved: omitting the field leaves the surface identical to today.
- [ ] Sub-goal 2 (Production OIDC IntrospectFn adapter) — new `src/server/auth/oidc-introspect-oauth4webapi.ts` exports `createOauth4webapiIntrospect({ issuer, clientId, clientSecret })` returning a `IntrospectFn` that composes `oauth4webapi.discoveryRequest` + `processDiscoveryResponse` + `introspectionRequest` + `processIntrospectionResponse`. Discovery cached at construction time per RFC 8414.
- [ ] Sub-goal 3 (CLI `--issuer` propagation) — `themory server --issuer <URL> [--client-id X --client-secret Y]` constructs `OidcAuthVerifier` + `oidcDiscovery` and passes both to `createServer`. `themory mcp --auth=oidc --issuer <URL>` constructs the same verifier and removes the deferral disclosure stderr line.
- [ ] Sub-goal 4 (Integration test) — `tests/integration/auth/fixes-cycle-1-e2e.test.ts` 6 scenarios pass against real pgvector + a stubbed RFC 7662 issuer (node:http listener emitting fake introspection responses; we still don't run a real Hydra in CI).
- [ ] Sub-goal 5 (Backward-compat sentinel) — existing 12-scenario `lifecycle.test.ts` remains 12/12 GREEN; existing 1148/1153 contract suite remains green (3 unrelated pre-existing failures stay as-is).

If sub-goals 1-5 are all checked, the cycle is COMPLETE.

## ADRs

### D1 — Admin sub-app composition via opt-in `AdminApiOptions` (not auto-mounted by default)

- **Decision:** `createApp()` mounts `/v1/admin/keys/*` ONLY when the caller passes `CreateServerOptions.adminApi: { pool, bootstrapToken? }`. Backward-compat preserved — every existing consumer of `createServer({ memory })` continues to boot without admin routes.
- **Rationale:** Mounting unconditionally would (a) require `src/server/app.ts` to import `pg.Pool` (ADR D11 DIP violation per `architecture.md § 3` — server must NOT depend on a concrete DB driver), (b) force callers without admin needs to provide a pool, (c) expose the admin surface even to consumers who only want the 4-verb REST API. Opt-in keeps DIP discipline AND gives the CLI a clear plumb point.
- **Consequences:** `themory server` CLI MUST pass `adminApi: { pool, bootstrapToken: process.env['THEMORY_ADMIN_BOOTSTRAP_TOKEN'] }` when admin routes are desired. Production consumers wire the same explicitly. Documentation: README admin-key quickstart updated.
- **Alternatives rejected:**
  - Mount admin always (breaks DIP + forces pool on all callers — rejected).
  - Build a separate `createAdminApp()` exposed via different subpath (`@usetheo/memory/server/admin`) — over-engineered for a 2-route plumb; admin and 4-verb surface share Bearer middleware + OTel span infra so keeping them in one Hono app is simpler.
  - Auto-detect (`if pool present in factory`) — implicit; violates KISS. Explicit `adminApi: { ... }` is the cleaner contract.

### D2 — OIDC IntrospectFn adapter as separate file (NOT embedded in OidcAuthVerifier)

- **Decision:** Adapter ships at `src/server/auth/oidc-introspect-oauth4webapi.ts` as a free function `createOauth4webapiIntrospect(opts): IntrospectFn`. `OidcAuthVerifier` keeps its existing pluggable `introspect` slot per its DIP shape (T3.1 ADR D1).
- **Rationale:** Tests already inject stubs via `OidcAuthVerifier({ introspect: stubFn })` — adapter as a separate factory preserves this seam. Wiring `oauth4webapi` directly into the verifier class would lock the test contract OR require a stub-vs-real flag (worse).
- **Consequences:** The production CLI imports the factory + composes verifier explicitly. Three external deps from `oauth4webapi` (`discoveryRequest`, `processDiscoveryResponse`, `introspectionRequest`, `processIntrospectionResponse`) — already a tracked dep per parent cycle's deps-audit task + ADR-0013 § Consequences (zero-dep panva-maintained OpenID-certified).
- **Alternatives rejected:**
  - Embed in `OidcAuthVerifier` — couples class to oauth4webapi, breaks injection seam.
  - Use `jose` for introspection — wrong library; jose is for JWT decode/verify, not RFC 7662.
  - Implement RFC 7662 by hand via `fetch` — Inquebrável Rule 9 violation; `oauth4webapi` is the canonical impl.

### D3 — Discovery caching at adapter construction (not per-request)

- **Decision:** `createOauth4webapiIntrospect` performs `discoveryRequest` ONCE at construction, caches the `AuthorizationServer` result. Each `IntrospectFn` invocation only does the introspection round-trip.
- **Rationale:** Discovery is RFC 8414 metadata that changes rarely (issuer-rekey events). Per-request discovery would double the network cost of every authenticated request. Caching at construction matches the production pattern in `oauth4webapi` examples + `keycloak-js` + Auth0 SDKs.
- **Consequences:** Issuer config changes require server restart to pick up. Documented in the adapter's JSDoc + the `themory server --issuer` help text. For dev/CI re-discovery, restart is the canonical path; production deployments rotate issuer URLs via deployment cycles, not hot-reload.
- **Alternatives rejected:**
  - Cache with TTL — adds clock complexity for marginal benefit (issuer URLs rotate via deploys, not live).
  - Per-request discovery — wasteful + 2× network round-trips.

### D4 — Secrets sourced from env (NOT CLI flags) — bootstrap token AND OIDC client_secret

- **Decision:** CLI does NOT add `--bootstrap-token` flag. Bootstrap token reads from `process.env['THEMORY_ADMIN_BOOTSTRAP_TOKEN']`. **EC-4 amendment**: same policy applies to OIDC client_secret — NO `--client-secret` flag; reads from `process.env['THEMORY_OIDC_CLIENT_SECRET']` only. `--client-id` flag IS allowed (not a secret per OAuth2 spec).
- **Rationale:** Both secrets MUST NOT appear in shell history or `ps aux` output — env-only sourcing matches the Cal.com `CALENDSO_ENCRYPTION_KEY` and PostHog `POSTHOG_PERSONAL_API_KEY` precedent. A `--bootstrap-token` or `--client-secret` flag would invite ` themory server --client-secret=secret` (space-prefix hist hack is unreliable; flag visible in `ps`). Per OAuth2 RFC 6749 § 2.3.1, client_secret is bearer-equivalent and MUST be transported with same hygiene.
- **EC-2 absorption (security-critical)**: empty-string env values MUST be treated as undefined. CLI normalize step: `const bootstrapToken = process.env['THEMORY_ADMIN_BOOTSTRAP_TOKEN']?.trim() || undefined;` (same for `THEMORY_OIDC_CLIENT_SECRET`). Without this, `export THEMORY_ADMIN_BOOTSTRAP_TOKEN=""` would let any empty-Bearer request pass `constantTimeEqual('', '')` → total auth bypass. Defense-in-depth at `scope-verifier.ts`: existing `if (opts.bootstrapToken && opts.bootstrapToken.length > 0)` extended to `.trim().length > 0`.
- **EC-6 absorption (cross-field validation)**: when `--client-id` supplied OR `THEMORY_OIDC_CLIENT_ID` set, `THEMORY_OIDC_CLIENT_SECRET` MUST be present + non-empty post-trim. CLI fails loud at boot: `Error: --client-id requires THEMORY_OIDC_CLIENT_SECRET env var to be set (per ADR D4 env-only secret sourcing)`. Without this, oauth4webapi falls back to anonymous ClientAuth and IdP returns cryptic `invalid_client`.
- **EC-12 DOCUMENT (token char policy)**: env-controlled tokens are opaque bytes. SQL injection impossible (token never touches SQL — only in-memory `constantTimeEqual`). Recommend operators generate via `openssl rand -base64 32` → produces `[A-Za-z0-9+/=]{43}`. Minimum 32 chars enforced softly via documentation (no runtime length check beyond non-empty post-trim).
- **Consequences:** Operators set both env vars at install time. `themory keys create` via bootstrap path → unset bootstrap env (EC-3 self-revoke is backup). README documents the canonical sequence + `openssl rand` snippet.
- **Alternatives rejected:**
  - `--bootstrap-token` / `--client-secret` flags — shell-history + ps leak risk (rejected as MUST FIX EC-4).
  - Stdin prompt — breaks scripted-install paths (CI/CD).
  - Silent fallback to anonymous OIDC client on missing client_secret — invites cryptic `invalid_client` from IdP; rejected as MUST FIX EC-6.

## Dependency Graph

```
T1.1 (RED tests admin wiring) ──▶ T1.2 (GREEN admin wiring)
                                       │
                                       ▼
T2.1 (RED tests oauth4webapi adapter) ──▶ T2.2 (GREEN oauth4webapi adapter)
                                       │
                                       ▼
T3.1 (RED tests CLI flags) ──▶ T3.2 (GREEN CLI plumb)
                                       │
                                       ▼
                                  T4.1 (integration test 6/6 + 12/12 sentinel)
```

All 4 phases are sequential — T1 unblocks the admin RPC test surface for T4; T2 unblocks the OIDC path for T3 which unblocks the OIDC scenarios in T4.

---

## Phase 1: Wire admin REST into `createApp()`

**Objective:** `themory server` boots with `/v1/admin/keys/*` mounted under `requireScope` when `adminApi` option is supplied.

### T1.1 — RED tests: admin routes mounted with scope gate

#### Objective

Sentinel tests asserting `createServer({ memory, adminApi: { pool, bootstrapToken } })` exposes the 5 admin routes under `requireScope` middleware.

#### Files to edit

```
src/server/__tests__/admin-wiring.test.ts (NEW) — RED tests
```

#### TDD

```
RED:     admin_routes_404_without_adminApi_option() — boot without adminApi; POST /v1/admin/keys → 404
RED:     admin_routes_require_admin_scope_when_adminApi_supplied() — boot with adminApi; POST without Bearer → 401 AUTH_REQUIRED
RED:     admin_routes_accept_bootstrap_token() — boot with adminApi + bootstrapToken; POST with bootstrap Bearer → 200
RED:     EC-1 — createServer_throws_at_boot_when_adminApi_pool_is_undefined() — `createServer({ memory, adminApi: { pool: undefined as any } })` MUST throw `Error: adminApi.pool is required...` synchronously
RED:     EC-7 — admin_route_uses_requireScope_not_bearerAuth_when_both_active() — boot with adminApi + env BearerAuthVerifier; POST /v1/admin/keys with admin theo_live_ key → 200 (NOT 401 from generic bearerAuth path)
GREEN:   Wire admin routes in createApp + extend CreateServerOptions + pool guard
VERIFY:  npm test -- src/server/__tests__/admin-wiring.test.ts
```

#### Acceptance Criteria

- [ ] 3 RED tests GREEN
- [ ] Lint clean; typecheck clean

### T1.2 — GREEN: createApp accepts `adminApi: { pool, bootstrapToken? }` + mounts routes

#### Files to edit

```
src/server/app.ts — extend CreateServerOptions; mount /v1/admin/keys/* when adminApi supplied
src/server/handlers/admin-keys.ts — export route-builder helper (extract from integration test wiring)
src/server/index.ts — re-export AdminApiOptions type
```

#### Deep Dives

- `requireScope` already imported by the integration test pattern. Wire it BEFORE the existing `bearerAuth(authVerifier)` `/v1/*` middleware so admin routes hit `requireScope` first (admin uses its own scope check, not the generic Bearer middleware). **EC-7 absorption**: load-bearing ordering — sentinel test 5 in T1.1 protects it.
- Path mounting: `app.post('/v1/admin/keys', ...)`, `app.get('/v1/admin/keys/list', ...)`, `app.delete('/v1/admin/keys/:id', ...)`, `app.post('/v1/admin/keys/:id/rotate', ...)`, `app.get('/v1/admin/keys/:id/lineage', ...)`.
- `subject` constant `'self'` per ADR-0014 D6 single-tenant.
- `createKeyHandler` opt `viaBootstrapToken` derived from `c.req.header('authorization')` matching bootstrap token (mirrors the integration test's `buildAdminApp` pattern).
- **EC-1 absorption (pool runtime guard)**: at the entry of `createApp`, immediately after destructuring `adminApi`, validate `if (adminApi !== undefined && (!adminApi.pool || typeof adminApi.pool.query !== 'function')) throw new Error('createServer: adminApi.pool is required when adminApi is supplied; got typeof pool=' + typeof adminApi?.pool)`. Fails synchronously at boot vs deep in the first request.

#### Acceptance Criteria + DoD

- [ ] T1.1 RED tests now GREEN
- [ ] Backward-compat: existing `createServer({ memory })` still boots identically (no new required option)
- [ ] Existing 12-scenario `lifecycle.test.ts` still 12/12 (the standalone admin app pattern there must still work)

---

## Phase 2: Production OIDC IntrospectFn adapter

**Objective:** Replace the deferred stub-only path with a real `oauth4webapi`-backed `IntrospectFn` factory.

### T2.1 — RED tests: createOauth4webapiIntrospect contract

#### Objective

Contract tests asserting the adapter (a) caches discovery, (b) calls introspection endpoint with correct shape, (c) maps RFC 7662 response to `IntrospectionResult`, (d) honors AbortSignal.

#### Files to edit

```
src/server/auth/__tests__/oidc-introspect-oauth4webapi.test.ts (NEW) — 4 RED tests with stubbed fetch
```

#### TDD

```
RED:     discovery_called_once_at_construction() — N introspect calls = 1 discovery + N introspection round-trips
RED:     introspection_response_active_true_maps_to_active_true() — happy-path mapping
RED:     introspection_response_active_false_maps_to_active_false()
RED:     EC-8 — abort_signal_propagated_to_underlying_fetch() — controller.abort() after 1ms → promise rejects in ≤ 10ms (NOT waiting for EC-4 5000ms timeout)
RED:     EC-3 — factory_throws_at_construction_when_discovery_omits_introspection_endpoint() — stub IdP returns discovery doc without `introspection_endpoint` → factory MUST throw with message naming the issuer + RFC 7662 mention
GREEN:   Implement createOauth4webapiIntrospect factory + introspection_endpoint validation
VERIFY:  npm test -- src/server/auth/__tests__/oidc-introspect-oauth4webapi.test.ts
```

#### Acceptance Criteria

- [ ] 4 RED tests GREEN
- [ ] Adapter file ≤ 200 LoC (per `architecture.md § Module hygiene` budget)
- [ ] Zero use of `any` in adapter source

### T2.2 — GREEN: oauth4webapi adapter

#### Files to edit

```
src/server/auth/oidc-introspect-oauth4webapi.ts (NEW) — factory + types
src/server/auth/index.ts (if exists, else src/server/index.ts) — re-export
```

#### Deep Dives

- Discovery: `await oauth4webapi.discoveryRequest(new URL(issuer))` → `processDiscoveryResponse(issuerUrl, response)`. Result cached as `AuthorizationServer` const at factory closure scope.
- Client: `{ client_id }` with `client_secret_basic` ClientAuth.
- Introspection per request: `introspectionRequest(as, client, clientAuth, token, { signal })` → `processIntrospectionResponse(as, client, response)` → maps `{ active, scope, sub, exp }`.
- AbortSignal propagation: pass through `options.signal` (oauth4webapi's `introspectionRequest` accepts standard fetch signal). **EC-8 absorption**: T2.1 RED test 4 (`abort_signal_propagated_to_underlying_fetch`) is the sentinel.
- Error handling: failed discovery throws once at construction (deployment-time misconfig, fail-loud per Inquebrável Rule 8). Failed introspection returns `{ active: false }` (caller's OidcAuthVerifier already wraps in fail-closed try/catch).
- **EC-3 absorption (introspection_endpoint guard)**: immediately after `processDiscoveryResponse`, validate the parsed `AuthorizationServer`: `if (!as.introspection_endpoint) throw new Error('OIDC issuer ' + issuer + ' does not advertise introspection_endpoint in its discovery document; this IdP does not support RFC 7662 introspection. Use a JWKS-based JWT verifier instead (deferred to follow-up cycle) or switch to an issuer that supports introspection (e.g., Hydra, Keycloak with introspection enabled).')`. Auth0 free tier and some Keycloak realms omit the field; fail-loud at boot avoids cryptic per-request crashes.
- **EC-11 DOCUMENT (K8s restart loop)**: discovery throwing at boot means K8s/Docker restarts the container until the issuer is reachable. This is the desired behavior — fail-fast is preferred over silent partial wiring. Documented in adapter JSDoc + ADR D3 § Consequences.

---

## Phase 3: CLI `--issuer` propagation

**Objective:** `themory server --issuer <URL>` AND `themory mcp --auth=oidc --issuer <URL>` construct the real verifier + pass `oidcDiscovery` to createServer.

### T3.1 — RED tests: CLI flag plumb

#### Files to edit

```
src/agent-tools/__tests__/run-server-issuer.test.ts (NEW) — RED test for run-server.ts --issuer
src/agent-tools/__tests__/run-mcp-server-oidc.test.ts (NEW) — RED test for run-mcp-server.ts --auth=oidc
```

#### TDD

```
RED:     run_server_with_issuer_flag_passes_oidcDiscovery_to_createServer()
RED:     run_server_with_issuer_constructs_OidcAuthVerifier_and_passes_as_authVerifier()
RED:     run_mcp_server_with_auth_oidc_constructs_OidcAuthVerifier_passed_in_bearerAuth()
RED:     run_mcp_server_oidc_no_longer_emits_stderr_disclosure_when_issuer_provided()
RED:     EC-2 — empty_THEMORY_ADMIN_BOOTSTRAP_TOKEN_normalized_to_undefined() — env=`""` → bootstrapToken passed to adminApi is `undefined`; admin route 401s without Bearer (no bypass)
RED:     EC-5 — invalid_issuer_url_fails_at_commander_parse() — `themory server --issuer not-a-url` exits non-zero with InvalidArgumentError message naming `--issuer`
RED:     EC-6 — client_id_without_client_secret_fails_loud_at_boot() — `--client-id Y` but `THEMORY_OIDC_CLIENT_SECRET` unset → boot throws Error matching /requires THEMORY_OIDC_CLIENT_SECRET/
RED:     EC-9 — oidcDiscovery_resource_uses_localhost_when_host_is_0_0_0_0() — host=0.0.0.0 → oidcDiscovery.resource starts with `http://localhost:` + stderr warning emitted
GREEN:   Plumb flags + adapter wiring in both runners + 4 MUST-FIX absorptions
VERIFY:  npm test -- src/agent-tools/__tests__/run-server-issuer.test.ts src/agent-tools/__tests__/run-mcp-server-oidc.test.ts
```

### T3.2 — GREEN: CLI plumb

#### Files to edit

```
src/agent-tools/cli.ts — add --issuer / --client-id / --client-secret flags to both 'server' and 'mcp' subcommands
src/agent-tools/run-server.ts — accept RunServerOptions.issuer/clientId/clientSecret; construct OidcAuthVerifier + oidcDiscovery
src/agent-tools/run-mcp-server.ts — accept RunMcpServerOptions.issuer/clientId/clientSecret; remove the deferral stderr; construct OidcAuthVerifier
```

#### Deep Dives

- Flag precedence: CLI flag > env (`THEMORY_OIDC_ISSUER`, `THEMORY_OIDC_CLIENT_ID`) > undefined. **EC-4 absorption**: `THEMORY_OIDC_CLIENT_SECRET` is env-ONLY (no CLI flag per ADR D4).
- When `--auth=both` AND issuer supplied: construct BOTH ApiKey + OIDC verifiers, pass both via `bearerAuth: { apiKey, oidc }` (existing shape).
- When `--auth=oidc` AND issuer NOT supplied: hard-fail at CLI parse with `Error: --auth=oidc requires --issuer` (no silent fallback — Inquebrável Rule 8 fail-loud).
- `oidcDiscovery` config: derive `resource` from `--host`/`--port` (default `http://127.0.0.1:8080`); `resourceName` from `package.json#name` (`@usetheo/memory/server`); `scopesSupported` from the 4 canonical scopes.
- **EC-2 absorption (security-critical bootstrap empty-string)**: `bootstrapToken = process.env['THEMORY_ADMIN_BOOTSTRAP_TOKEN']?.trim() || undefined;` — empty/whitespace env value normalized to undefined BEFORE passing to `adminApi` and BEFORE constructing `requireScope({ bootstrapToken })`. Defense-in-depth at `src/server/auth/scope-verifier.ts:87`: change `if (opts.bootstrapToken && opts.bootstrapToken.length > 0)` → `if (opts.bootstrapToken && opts.bootstrapToken.trim().length > 0)`.
- **EC-5 absorption (URL validation at parse time)**: `.addOption(new Option('--issuer <url>', '...').argParser((v) => { try { new URL(v); return v; } catch { throw new InvalidArgumentError('--issuer must be a valid URL (e.g., https://auth.example.com)'); } }))`. Same parser shared between `themory server` and `themory mcp` subcommands.
- **EC-6 absorption (client-id without client-secret)**: after CLI resolves issuer/clientId/clientSecret from CLI+env, validate cross-field at the entry of `runServer` / `runMcpServer`: `if (clientId !== undefined && clientId !== '' && (!clientSecret || clientSecret.trim() === '')) { throw new Error('--client-id requires THEMORY_OIDC_CLIENT_SECRET env var to be set (per ADR D4 env-only secret sourcing)'); }`.
- **EC-9 absorption (resource URL when host=0.0.0.0)**: when `--host === '0.0.0.0'`, derive `oidcDiscovery.resource` from `'http://localhost:' + port` (canonical localhost) + log a one-line warning to stderr: `themory server: --host=0.0.0.0 detected; oidcDiscovery.resource set to http://localhost:<port> (operators behind reverse-proxy should set explicit --oidc-resource <URL> when added in a follow-up cycle)`. T3.1 RED test 5 covers this derivation.

#### Acceptance Criteria + DoD

- [ ] T3.1 RED tests GREEN
- [ ] stderr disclosure removed when issuer provided
- [ ] `themory server --auth=oidc` without `--issuer` exits non-zero with clear error
- [ ] `npm test -- src/agent-tools/__tests__/` all green (incl. existing 94 tests no-regression)

---

## Phase 4: Integration validation

### T4.1 — End-to-end test against real pgvector + stubbed RFC 7662 issuer

#### Objective

6-scenario integration test exercising both the admin REST wiring AND the production OIDC path (with a stubbed local RFC 7662 issuer instead of real Hydra; Hydra runs in dev cluster but CI image is too heavy).

#### Files to edit

```
tests/integration/auth/fixes-cycle-1-e2e.test.ts (NEW)
tests/integration/auth/_stub-issuer.ts (NEW) — node:http listener emitting RFC 7662 + 8414 metadata
```

#### Deep Dives

6 scenarios:

1. `themory_server_with_adminApi_serves_admin_keys_routes` — boot `createServer({ memory, adminApi })` against real pgvector; POST `/v1/admin/keys` with bootstrap returns 200 + secret.
2. `themory_keys_cli_create_then_list_round_trips_against_running_server` — spin a server on port 0; invoke `runKeysCreate` then `runKeysList`; both succeed against same server.
3. `revoke_invalidates_subsequent_auth_via_real_verifier_path` — create key → revoke → next `/v1/remember` with that key returns 401.
4. `createOauth4webapiIntrospect_against_stubbed_issuer_validates_active_token` — boot stub issuer → factory adapter → verifier returns true for valid token.
5. `dualValidationAuth_routes_theo_live_to_apikey_and_jwt_to_real_oauth4webapi_path` — both paths exercised end-to-end through `createServer({ authVerifier: dual })`.
6. `well_known_resolves_when_oidcDiscovery_propagated_via_CLI` — boot via `runServer({ issuer })`; fetch well-known → 200 + correct metadata derived from CLI flag.

#### TDD

```
RED:     6 scenarios above
GREEN:   ALL Phase 1-3 complete
REFACTOR: extract _stub-issuer.ts helpers if duplication grows
VERIFY:  THEOMEM_PG_URI=... npx vitest run --config vitest.integration.config.ts tests/integration/auth/fixes-cycle-1-e2e.test.ts

# EC-10 absorption (port cleanup hygiene):
# afterEach global hook MUST close every spawned listener (server handle + stub issuer)
# in Promise.all, with try/catch swallowing already-closed errors. Without this, a single
# scenario crash leaks the port → next scenario EADDRINUSE → cascade fail. Pattern:
#   afterEach(async () => {
#     await Promise.allSettled([
#       handle?.close(),
#       stubIssuer?.close(),
#     ]);
#   });
```

#### Acceptance Criteria

- [ ] 6/6 new scenarios GREEN
- [ ] Existing `lifecycle.test.ts` 12/12 still GREEN (no regression)
- [ ] `npm test` green (excluding 3 unrelated pre-existing failures in `tests/unit/examples/server-routes-contract.test.ts` documented in parent cycle)
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Admin REST handlers exist but NOT wired into `createApp()` | T1.1 + T1.2 | `adminApi: { pool, bootstrapToken? }` opt-in option per ADR D1 |
| 2 | `themory keys` CLI returns 404 against running server | T1.2 + T4.1 scenario 2 | Wiring closes the round-trip |
| 3 | OIDC `--auth=oidc` is stderr disclosure, no production verifier | T2.1 + T2.2 | `createOauth4webapiIntrospect` factory per ADR D2 |
| 4 | Discovery would happen per-request without caching | T2.2 + ADR D3 | Cache at factory construction |
| 5 | CLI `--issuer` flag missing on `themory server` AND `themory mcp` | T3.1 + T3.2 | Flag plumb + env fallback + fail-loud when oidc without issuer |
| 6 | Bootstrap-token CLI flag vs env tradeoff | T3.2 + ADR D4 | Env-only sourcing (Cal.com/PostHog precedent) implemented in T3.2 |
| 7 | Stub-issuer infra missing for integration test | T4.1 + `_stub-issuer.ts` | New node:http stub emitting RFC 8414 + 7662 metadata |
| 8 | Backward-compat regression risk on existing 12-scenario test | T4.1 sentinel | 12/12 lifecycle.test.ts MUST stay green |
| 9 | EC-1 `adminApi.pool` undefined at runtime | T1.1 RED + T1.2 Deep Dive | Boot-time guard throws with typeof reflection |
| 10 | EC-2 SECURITY-CRITICAL empty-string bootstrap token bypass | T3.2 normalize + scope-verifier defense | `.trim().length > 0` check at 2 layers |
| 11 | EC-3 introspection_endpoint absent from OIDC discovery | T2.1 RED test 5 + T2.2 Deep Dive | Construction-time validation throws with IdP hint |
| 12 | EC-4 SECURITY `--client-secret` flag visible in `ps` | T3.2 + ADR D4 estendida | env-only via `THEMORY_OIDC_CLIENT_SECRET`; T3.2 omits flag from CLI |
| 13 | EC-5 `--issuer` URL malformed crashes with cryptic TypeError | T3.2 commander argParser | InvalidArgumentError with friendly message |
| 14 | EC-6 `--client-id` without client_secret silent OAuth fallback | T3.2 cross-field validate | Fail-loud at boot referencing ADR D4 |
| 15 | EC-7 SHOULD TEST route mounting order regression | T1.1 RED test 5 | Sentinel asserts requireScope fires not bearerAuth |
| 16 | EC-8 SHOULD TEST AbortSignal propagation | T2.1 RED test 4 | Promise rejects in ≤ 10ms, not 5000ms timeout |
| 17 | EC-9 SHOULD TEST resource URL when host=0.0.0.0 | T3.1 RED test 8 + T3.2 Deep Dive | Canonical localhost substitution + stderr warning |
| 18 | EC-10 SHOULD TEST port cleanup between integration scenarios | T4.1 afterEach hook | Promise.allSettled with try-swallow |
| 19 | EC-11 DOCUMENT K8s restart loop on discovery fail | ADR D3 § Consequences + T2.2 JSDoc | Documented as desired behavior |
| 20 | EC-12 DOCUMENT bootstrap token char policy | T3.2 + ADR D4 § Consequences | `openssl rand -base64 32` recommended; T3.2 implements `.trim().length > 0` defense |

**Coverage: 20/20 gaps covered (100%)**

## Global Definition of Done

- [ ] All 4 phases completed
- [ ] All tests passing — `npm test` green (excluding 3 documented pre-existing failures from parent cycle)
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected (≤ 500 LoC per `architecture.md § Module hygiene`; adapter ≤ 200 LoC per T2.1)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Inquebrável Rule 6)
- [ ] Backward compatibility preserved across public API (existing `createServer({ memory })` unchanged; `themory server` without `--issuer` unchanged)
- [ ] Plan-specific criteria:
  - `themory keys create` round-trips against `themory server --adminApi=...` (sub-goal 1 + 2 closed)
  - `themory server --issuer <URL>` validates real OIDC JWTs via oauth4webapi (sub-goal 2 + 3 closed)
  - well-known endpoint serves correct metadata when `--issuer` supplied (sub-goal 3 closed)
- [ ] **Runtime-metric proof** — N/A (this cycle wires existing surfaces; no new counters/metrics declared)
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND PR merged, move to `.claude/knowledge-base/plans/completed/`

## Final Phase: Integration Validation (MANDATORY)

### Execution

```
npm test                        # contract suite — must remain at 1148+ pass
THEOMEM_PG_URI=postgresql://themem:themem@127.0.0.1:5432/themem \
  npx vitest run --config vitest.integration.config.ts tests/integration/auth/
npm run typecheck
npm run lint
```

### Acceptance Criteria

- [ ] Contract suite: pass count ≥ 1148 + 17 new tests (T1.1×5 incl. EC-1+EC-7 + T2.1×5 incl. EC-3+EC-8 + T3.1×8 incl. EC-2+EC-5+EC-6+EC-9) = 1165 pass
- [ ] Integration auth suite: 12/12 lifecycle + 6/6 fixes-cycle-1-e2e = 18/18
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing
2. Fix all plan-caused failures before declaring the plan complete
3. Re-run the validation chain to confirm fixes
4. Pre-existing issues are logged but do NOT block plan completion (already documented in parent cycle's Step 5.5 BLOCKED report — 3 failures in `tests/unit/examples/server-routes-contract.test.ts`)

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| oauth4webapi | ^3.8.6 | npm | Production IntrospectFn adapter per ADR D2; pinned in parent cycle's dep-audit task |
| hono | >=4.11.4 | npm | Admin route mounting + requireScope middleware; CVE pin from parent cycle's dep-audit task |
| pg | ^8 | npm | Admin pool type; already in parent cycle |

### New — to be introduced

(none — T2.2 adapter uses already-pinned `oauth4webapi`)

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |
