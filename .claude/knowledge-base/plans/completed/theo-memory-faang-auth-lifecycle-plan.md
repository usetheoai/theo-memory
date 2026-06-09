# Plan: theo-memory-faang-auth-lifecycle — Camada 2 (OSS multi-user lifecycle) + Camada 3 (OIDC bridge) + Sub-goal 3 (MCP HTTP auth) hardening for `@usetheo/memory/server`

> **Version 1.1** (2026-06-07) — Absorbs `/edge-case-plan` review (13 ECs: 5 MUST FIX + 5 SHOULD TEST + 3 DOCUMENT — VERDICT PLANO PRECISA DE AJUSTE). **5 MUST FIX absorbed**: EC-1 (dual-validation fallthrough policy when `theo_live_*` shape mismatches → T3.1 Deep Dive extended + RED test added), EC-2 (lineage CTE cycle detection + schema CHECK constraint → T0.2 schema + T2.1 handler), EC-3 (bootstrap token self-revoke after first admin key issuance → ADR D7 amended + new sub-task T2.2.1 + sentinel test), EC-4 (OIDC introspection HTTP timeout default 5000ms with AbortController → T3.1 Deep Dive extended), EC-5 (concurrent cache-miss coalescing via in-flight Map<token-hash, Promise> → T3.1 Deep Dive extended). **5 SHOULD TEST absorbed inline** as additional RED tests in the existing tasks (EC-6 in T2.1, EC-7 in T2.1, EC-8 in T1.2, EC-9 in T5.1, EC-10 in T4.1). **3 DOCUMENT absorbed** as explicit notes (EC-11 SHA-256 collision in T0.2 Deep Dive + ADR D5 Consequences; EC-12 cache staleness window in ADR-0013 § Consequences; EC-13 DPoP deferred to Camada 4 in ADR-0013 § Alternatives). Goal metric unchanged at 12/12 integration scenarios pass.

> **Version 1.0** (2026-06-07) — Grounded in the SHIPPABLE_WITH_CAVEATS blueprint at `.claude/knowledge-base/discoveries/blueprints/theo-memory-faang-auth-lifecycle-blueprint.md` (score 89/100, 47 allowlisted-URL citations). Hardens `@usetheo/memory/server` from single-secret env-var auth → FAANG-shape multi-user lifecycle (Camada 2) + OIDC bridge dual-validation middleware (Camada 3) + MCP streamable-HTTP transport auth via the same middleware (Sub-goal 3). Per PRIORITY 0 (CLAUDE.md locked 2026-06-04), this is **SDK sub-goal 2 + MCP sub-goal 3 hardening**, NOT a new feature — every surface evolved here closes a documented gap. Ships 3 ADRs proposed in the blueprint (ADR-0013 OIDC bridge, ADR-0014 OSS lifecycle, ADR-0015 MCP HTTP auth). Camada 4 (TheoCloud audit + rate-limit + secret-scanning partnership + SOC2/GDPR + DPoP) is explicitly OUT OF SCOPE — separate cloud-repo plan per blueprint § Recommendations D4-expanded.

## Goal

> "Enable self-hosted `@usetheo/memory/server` operators to manage scoped `theo_live_*` API keys (List + Create + Revoke + Rotate + Lineage) AND validate Bearer tokens via either `theo_live_*` SHA-256 lookup OR RFC 7662 OIDC introspection AND serve MCP streamable-HTTP with the same dual-validation middleware, measured by the integration suite `tests/integration/auth/lifecycle.test.ts` passing all 12 scenarios against real `ankane/pgvector:v0.5.1` + a stubbed RFC 7662 introspection endpoint."

## Context

### What exists today

The `@usetheo/memory/server` surface (Roadmap Item 16, shipped 2026-06-03 via the `theo-memory-standalone-p0` chain) provides REST authentication via a **single-secret env-var** model:

- **12th DIP `AuthVerifier`** at `src/core/dip/auth-verifier.ts` — single-method (`verify(token): Promise<boolean>`), ISP-compliant per `architecture.md § 13.4`. Already enables future OAuth/JWT impls to swap behind this interface without surface change (per @see comment).
- **Default impl `BearerAuthVerifier`** at `src/server/auth/bearer-verifier.ts` — single-secret env comparison against `THEMEMORY_API_KEY`. Absorbed EC-1 (empty/whitespace fail-closed sentinel), EC-2 (RFC 6750 case-insensitive scheme), EC-3 (verbatim compare, no trim), EC-4 (length-check before `timingSafeEqual` to prevent `RangeError` crash).
- **Hono middleware** at `src/server/auth/middleware.ts` — wires the DIP into the `/v1/*` request path per `src/server/app.ts:108`.
- **CLI consolidado `themory`** at `src/agent-tools/cli.ts` — already ships `mcp`/`server`/`migrate`/`health`/`remember`/`recall`/`forget`/`reflect` subcommands. **Does NOT ship `keys` subcommand** (Camada 2 gap).

### What is missing (the gap closed by this plan)

1. **OSS multi-user lifecycle** — single `THEMEMORY_API_KEY` cannot represent multi-user scoped access. A self-hosted operator running multiple agents cannot scope per-agent, cannot rotate without downtime, cannot audit per-key usage. Per blueprint Q3 verdict: PostHog / Cal.com / Plausible ALL ship full self-host UI parity for API-key CRUD; Supabase is the documented anti-pattern (cloud-only PAT UI). theo should follow the Cal.com pattern (`cal_live_*` ↔ `theo_live_*`).
2. **OIDC bridge non-existent** — per ADR-0009 § Alternatives row 4, OAuth/OIDC was "Deferred to v1.x" because v0.5 cloud was the priority. The blueprint Q4 supersession path is SATISFIED — dual-validation middleware via RFC 7662 introspection is LOW-complexity (single conditional in existing Bearer middleware) and Hydra is ALREADY deployed in the dev cluster at port 4445.
3. **MCP streamable-HTTP unauthenticated** — `src/agent-tools/cli.ts:138` ships `--transport streamable-http` option but the transport has NO Bearer check. Per blueprint Q8 verdict: MCP Authentication Specification mandates OAuth 2.0/2.1 for streamable-HTTP (mandatory, per spec); stdio remains correctly unauthenticated.

### Evidence

- Empirical 2026-06-07 session: validated `cloud/internal/auth/scope.go` literally returns `"Invalid or missing API key. Provide Authorization: Bearer theo_live_*"` for non-`theo_live_*` Bearers. Hydra OAuth2 tokens cannot reach `/v1/memory/*` today. Same architectural gap exists in OSS server (`BearerAuthVerifier` only handles env single-secret).
- Blueprint § Recommendations: 3 ADRs proposed with complete architectural skeleton (Camada 2 + 3 + Sub-goal 3).
- Blueprint § Q5: dependency stack decided (`jose` + `oauth4webapi` + `hono >= 4.11.4` — the Hono pin is CRITICAL per 2026-01-13 CVEs GHSA-3vhc-576x-3qv4 + GHSA-f67f-6cw9-8mq4).
- Blueprint § Q6: integration test recipe (7 patterns from Supabase auth/GoTrue + 4 vitest test bodies) ready to port verbatim.

## Objective

- [ ] Sub-goal 1 (Camada 2 lifecycle table) — new Drizzle migration `0009_theo_api_keys.sql` creates the table with `id apk-{16hex}`, `subject`, `tenant_id`, `key_name`, `key_hash` (SHA-256), `key_prefix` (12-char masked), `scopes` (jsonb), `created_at`, `last_used_at`, `expires_at`, `revoked_at`, `rotated_from` columns mirroring `theo-cloud/cloud/internal/routes/api_keys.go` ADRs D1-D7.
- [ ] Sub-goal 2 (Camada 2 DIP impl) — `ApiKeyAuthVerifier` impl of the 12th DIP `AuthVerifier` does SHA-256 lookup against `theo_api_keys` table; coexists with existing `BearerAuthVerifier`; selected by `themory server --auth=api-keys`.
- [ ] Sub-goal 3 (Camada 2 admin REST + CLI) — `POST /v1/admin/keys` + `GET /v1/admin/keys/list` + `DELETE /v1/admin/keys/{id}` + `POST /v1/admin/keys/{id}/rotate` + `GET /v1/admin/keys/{id}/lineage` ship + `themory keys {create,list,rotate,revoke}` CLI subcommand wraps them.
- [ ] Sub-goal 4 (Camada 3 OIDC) — `OidcAuthVerifier` impl uses `oauth4webapi.processIntrospectionResponse` against the configured issuer; selected by `themory server --auth=oidc --issuer=<URL> --jwks-url=<URL>`.
- [ ] Sub-goal 5 (Camada 3 dual-mode middleware) — when `--auth=both` (or when both `THEMEMORY_API_KEY` and `--issuer` are configured), the Hono middleware switches on prefix: `theo_live_*` → `ApiKeyAuthVerifier`; else → `OidcAuthVerifier`.
- [ ] Sub-goal 6 (Sub-goal 3 MCP HTTP) — `themory mcp --transport streamable-http` wraps the existing `MemoryServer` with the SAME dual-validation middleware; stdio path UNCHANGED.
- [ ] Sub-goal 7 (ADRs) — `ADR-0013-oidc-bridge-via-introspection.md` + `ADR-0014-oss-lifecycle-parity.md` + `ADR-0015-mcp-streamable-http-auth.md` written; ADR-0013 explicitly supersedes ADR-0009 § Alternatives row 4.
- [ ] Sub-goal 8 (integration test) — `tests/integration/auth/lifecycle.test.ts` covers 12 scenarios (per Coverage Matrix) against real pgvector + stubbed introspection.

If sub-goals 1-8 are all checked AND the goal metric (12/12 integration scenarios pass) is observed, the plan is COMPLETE.

## ADRs

### D1 — OIDC bridge via RFC 7662 introspection (Camada 3) — ships as `ADR-0013-oidc-bridge-via-introspection.md`

**Decision:** Camada 3 implements OIDC via a **dual-validation Bearer middleware** — the Hono middleware switches on token prefix: `theo_live_*` → SHA-256 lookup in `theo_api_keys` table; else → POST `<issuer>/oauth2/introspect` with the token; treats `active: true` + scope match as authorized. Cache introspection results 60-300s (operator-configurable; disable supported). Implementation uses `oauth4webapi.processIntrospectionResponse` + `jose.createRemoteJWKSet` + `hono >= 4.11.4` (CRITICAL pin per 2026-01-13 CVEs).

**Rationale:** Per blueprint Q4 trade-off matrix, dual-validation middleware (Path A) is LOW complexity (single conditional in existing Bearer middleware path), universal OIDC issuer compatibility (RFC 7662 is the canonical standard — Hydra/Keycloak/Auth0/Okta/Azure AD all support it), and zero customer-side migration friction. Token-exchange (Path B, RFC 8693) is HIGHER complexity (new endpoint, STS-style protocol, additional table for exchanged tokens) and deferred to v2.x per the same blueprint trade-off matrix. Cites `architecture.md § 13.4 ISP` — the existing 12th DIP `AuthVerifier` already enables this pattern (single-method, swap-behind-interface).

**Alternatives considered:**
- RFC 8693 token-exchange endpoint — REJECTED for v1.x (complexity > value at this scale per blueprint Q4 trade-off matrix; deferred to v2.x as `ADR-0013-supersession-token-exchange.md` if/when customers demonstrably need per-call cost optimization).
- Running our own STS — REJECTED (TheMemory is a memory primitive, not an identity provider; operators plug their own Hydra/Keycloak/Auth0).
- Single-mode middleware (no `theo_live_*` fallback when OIDC enabled) — REJECTED (breaks existing OSS deployments that rely on env-var auth + would block self-host operators who want both paths; dual-mode is mandatory).

**Consequences:** Camada 3 ships ONE new DIP impl (`OidcAuthVerifier`) + ONE middleware composition function (`dualValidationAuth`) without touching the existing `BearerAuthVerifier` or `ApiKeyAuthVerifier` (DIP discipline). MCP streamable-HTTP reuses this middleware for free (Sub-goal 3 work item closes itself via composition, see D3 below). SUPERSEDES ADR-0009 § Alternatives row 4 ("OAuth / OIDC flow — Deferred to v1.x").

**EC-12 ABSORBED (DOCUMENT):** Cache staleness window — when the OIDC issuer revokes a token upstream, our cache MAY hold it as `active: true` for up to TTL (60-300s default). This is the explicit RFC 7662 § 4 caveat. Operators concerned about revocation propagation should set `--oidc-cache-ttl-seconds=0` (disable cache; 1 introspection per request) for high-sensitivity deployments. Documented in the `--oidc-cache-ttl-seconds` flag help text.

**EC-13 ABSORBED (DOCUMENT):** DPoP (RFC 9449) is DEFERRED to Camada 4 — Bearer tokens are bearer-bound today (anyone with the token can use it). DPoP would bind the token to a client-side keypair (theft-resistant). Per blueprint Q5: enterprise-tier feature deferred to Camada 4 cloud-repo plan. Known gap documented here; revisit when enterprise customers ask. Honest disclosure per Inquebrável Rule 3.

### D2 — OSS lifecycle parity Stripe-shape (Camada 2) — ships as `ADR-0014-oss-lifecycle-parity.md`

**Decision:** `@usetheo/memory/server` ships full Stripe-shape lifecycle for `theo_live_*` API keys when started with `themory server --auth=api-keys`. The table schema, the SHA-256 hash discipline, the show-once secret reveal contract, the soft-delete D7 invariant, the rotation grace-window flow, and the lineage recursive CTE are all ported VERBATIM from `theo-cloud/cloud/internal/routes/api_keys.go` (the canonical Stripe-shape impl that has been production-grade in cloud since `theo-memory-standalone-p0` chain) — single-tenant variant: `tenant_id = "self"` constant. Admin endpoints land under `/v1/admin/keys/*`; admin CLI lands under `themory keys {create,list,rotate,revoke}`.

**Rationale:** Per blueprint Q3 verdict: PostHog + Cal.com + Plausible all ship FULL self-host UI parity (same dashboard codebase). Cal.com is the strongest reference (`cal_live_*` prefix shape identical to `theo_live_*`). Supabase is the documented anti-pattern (cloud-only PAT UI) that theo MUST NOT replicate. Per Inquebrável Rule 9 — reuse the cloud-repo Stripe-shape impl (Rule-9-evaluated already; production-grade; FAANG-canonical) rather than re-design from scratch.

**Alternatives considered:**
- Implement multi-tenant directly (mirror cloud verbatim) — REJECTED (premature; the OSS use case is single-tenant per-deployment; multi-tenant adds complexity for zero v1.x benefit; revisit at v2.x if/when self-host operators ask).
- Use a separate ORM (Drizzle vs Kysely vs raw SQL) — REJECTED divergence (theo-memory's existing schema migrations use Drizzle per `src/local/migrations/` — keep the same toolchain).
- Add the lifecycle to `BearerAuthVerifier` instead of a new `ApiKeyAuthVerifier` — REJECTED (violates SRP/ISP — `BearerAuthVerifier` purpose is env-var single-secret; a new impl keeps each verifier focused per ADR D11 of the standalone-p0 plan + ISP rules from `architecture.md § 13.4`).

**Consequences:** New Drizzle migration `0009_theo_api_keys.sql` lands one new table. New impl `ApiKeyAuthVerifier` joins the existing `BearerAuthVerifier` behind the 12th DIP `AuthVerifier`. New admin REST surface mounted under `/v1/admin/keys/*`. New CLI subcommand `themory keys`. No breaking changes to existing `BearerAuthVerifier` or `THEMEMORY_API_KEY` env-var path.

### D3 — MCP streamable-HTTP authentication via the Camada 3 middleware (Sub-goal 3) — ships as `ADR-0015-mcp-streamable-http-auth.md`

**Decision:** When `themory mcp --transport streamable-http` is invoked, the MCP server wrapper composes the SAME `dualValidationAuth` middleware (D1) onto the HTTP request path. stdio transport remains UNCHANGED (single-client local, no Bearer required; scope binding via env per existing `src/agent-tools/cli-scope.ts`). HTTPS-only when bound to non-localhost (`--host <non-127.0.0.1>` refuses to start without TLS config). Adds `/.well-known/oauth-protected-resource` discovery endpoint per RFC 9728. DCR (RFC 7591) DEFERRED to v2.x.

**Rationale:** Per blueprint Q8 verdict: MCP Authentication Specification mandates OAuth 2.0/2.1 for streamable-HTTP; the spec's LLAT (Long-Lived Access Token) pattern maps 1:1 to theo's `theo_live_*` keys. Reusing the D1 middleware closes Sub-goal 3 ("MCP server available + reliable") WITHOUT duplicating Bearer logic across the REST API and MCP HTTP surfaces — single shared implementation.

**Alternatives considered:**
- Build a separate MCP-specific Bearer middleware — REJECTED (DRY violation; duplicates the SHA-256 lookup + introspection logic; risk of drift between the two implementations).
- Ship Dynamic Client Registration (RFC 7591) in v1.x — REJECTED ("enabling it becomes a security risk because the endpoint is public and can be abused by flooding with unwanted client registrations" — blueprint Q8 quote). Deferred to v2.x with explicit ADR follow-up when needed.
- Require OAuth ONLY (reject `theo_live_*` LLATs on streamable-HTTP) — REJECTED (MCP spec explicitly endorses LLAT as opt-in path; theo's `theo_live_*` keys ARE LLATs by design).

**Consequences:** `src/agent-tools/server.ts` exposes a new `withBearerAuth(server, verifier)` wrapper. `src/agent-tools/cli.ts mcp` subcommand wires this wrapper conditionally on `--transport streamable-http`. No change to stdio path. No new dependency added (reuses Hono from server module if streamable-HTTP needs it; otherwise direct middleware composition).

### D4 — Hono CRITICAL version pin to >= 4.11.4

**Decision:** `package.json#dependencies.hono` MUST be pinned to `>= 4.11.4`. The implementation plan ships a `tests/unit/deps/hono-cve-pin.test.ts` sentinel that fails if `package.json` declares a version range allowing `< 4.11.4`.

**Rationale:** Per blueprint Q5: 2026-01-13 security advisories GHSA-3vhc-576x-3qv4 (JWK middleware alg confusion via untrusted header.alg fallback) + GHSA-f67f-6cw9-8mq4 (JWT middleware unsafe HS256 default allows token forgery + auth bypass) both require `hono >= 4.11.4`. Both require explicit `alg: ['RS256', 'ES256', 'EdDSA']` allowlist when using `hono/jwk` — HS* algos no longer accepted in jwk middleware context.

**Alternatives considered:**
- Use only `jose` directly without `hono/jwk` — RATIONALE for ADOPT: simpler dependency surface but loses the integrated `hono/jwk` middleware; pragmatic choice for OIDC = `hono/jwk` with the mandatory `alg` allowlist is more idiomatic; sentinel test prevents regression.
- Pin to exact `hono@4.11.4` — REJECTED (over-restrictive; `>= 4.11.4` allows compatible patch upgrades).

**Consequences:** package.json pin + CVE sentinel test. Future Hono upgrades go through `/deps-audit` per `deps-audit-golden-rule.md`.

### D5 — Drizzle migration vs raw SQL

**Decision:** Use Drizzle for the migration (`src/local/migrations/0009_theo_api_keys.sql` + Drizzle journal sync). Schema lives in `src/local/schema/theo-api-keys.ts` per existing convention in `src/local/schema/*`.

**Rationale:** Existing theo-memory migrations all go through Drizzle (per `src/local/migrations/0001_*.sql` … `0008_attributed_to.sql`). Drift to raw SQL would violate KISS + create maintenance overhead. Per architecture.md § Module hygiene — keep ONE schema toolchain.

**Alternatives considered:**
- Raw SQL migration (mirror cloud-repo `cloud/internal/migrations/`) — REJECTED (cross-toolchain drift, double maintenance burden).

**Consequences:** Drizzle journal MUST be regenerated post-migration via `npm run db:generate`. The migration sentinel test (already in `src/local/__tests__/migrations.test.ts`) catches drift.

### D6 — Single-tenant `tenant_id = "self"` for OSS

**Decision:** OSS Camada 2 hardcodes `tenant_id = "self"` constant in every `INSERT INTO theo_api_keys`. Schema retains `tenant_id` column (NOT removed) so the SAME Drizzle schema is usable in cloud-repo future port if/when relevant; OSS query layer filters by the constant.

**Rationale:** Single-tenant matches the OSS use case (one deployment = one tenant). Keeping the column is forward-compatible; removing it would force a schema fork. Per blueprint Q3 verdict: PostHog / Cal.com / Plausible self-host all ship single-tenant; multi-tenant is cloud-only territory.

**Alternatives considered:**
- Remove `tenant_id` column entirely from OSS schema — REJECTED (schema fork; cross-repo PRs become painful; multi-tenant self-host operators have NO escape path).
- Make `tenant_id` operator-configurable via env — REJECTED (premature; no demonstrated use case at v1.0).

**Consequences:** All admin handlers MUST pass `tenant_id = "self"` as constant. Future multi-tenant promotion path: introduce `--tenant-resolver=<dip-name>` flag + a new `TenantResolver` DIP — clean extension.

### D7 — Admin CLI bootstrap token from env

**Decision:** `themory server --auth=api-keys --admin-bootstrap-token=<env>` reads the admin bootstrap token from the env var named by the flag value (e.g., `THEMORY_ADMIN_BOOTSTRAP_TOKEN`). First call to `POST /v1/admin/keys` MUST use this bootstrap token in the Authorization header; subsequent admin calls use any `theo_live_admin_*` key (`memory:admin` scope) issued via the bootstrap.

**Rationale:** Chicken-and-egg — the very first admin key must be creatable somehow. Env-var bootstrap is the canonical pattern (Cal.com uses `CALENDSO_ENCRYPTION_KEY`; PostHog uses `POSTHOG_PERSONAL_API_KEY` env for first-time operator). Once the first key is issued (with `memory:admin` scope), the bootstrap token becomes unnecessary and can be unset.

**Alternatives considered:**
- Auto-generate the first admin key at server startup and log it to stdout — REJECTED (sensitive secret in logs = poor security hygiene).
- Disable admin endpoints until manually-inserted DB row exists — REJECTED (poor UX; forces SQL knowledge for bootstrap).

**Consequences:** Documentation MUST explain the bootstrap flow + recommend unsetting the bootstrap env var after first-key issuance. Sentinel test asserts the bootstrap token comparison is constant-time per Inquebrável Rule 8 fail-closed semantics.

**EC-3 ABSORPTION amended (v1.1):** The bootstrap path is **single-use** — after the first successful admin-key creation via the bootstrap token, the `admin_config.bootstrap_consumed` flag flips to `true` atomically in the SAME transaction as the INSERT. Subsequent bootstrap-token uses return 401 `BOOTSTRAP_CONSUMED` + log `bootstrap_already_consumed`. Closes the EC-3 silent-backdoor exploit (leaked bootstrap token that persists even after admin key revoke). See new sub-task T2.2.1 for the implementation.

## Dependency Graph

```
Phase 0 (Setup) ──▶ Phase 1 (Camada 2 DIP + schema) ──▶ Phase 2 (Camada 2 admin REST + CLI)
                                │                              │
                                └──▶ Phase 3 (Camada 3 OIDC) ──┼──▶ Phase 4 (MCP HTTP wrapping)
                                                               │
                                                               ▼
                                                  Phase 5 (Integration validation)
```

- Phase 0 unlocks all others (dep pin + migration scaffolding).
- Phase 1 and Phase 3 can RUN in parallel (different DIP impls).
- Phase 2 depends on Phase 1 (admin endpoints need the verifier).
- Phase 4 depends on Phase 3 (MCP HTTP reuses the dual-mode middleware).
- Phase 5 depends on EVERYTHING (final integration validation).

---

## Phase 0: Setup + dep pin + schema scaffolding

**Objective:** Land the CVE-critical Hono version pin + the Drizzle migration scaffolding + the schema TypeScript file so subsequent phases can build against them.

### T0.1 — Pin Hono >= 4.11.4 + add jose + oauth4webapi

#### Objective

Pin `hono >= 4.11.4` (CRITICAL per ADR D4) and add `jose` + `oauth4webapi` as Camada 3 dependencies.

#### Evidence

Blueprint Q5 verdict: jose + oauth4webapi + hono >= 4.11.4 are the canonical stack. The 2026-01-13 Hono CVEs are documented at GHSA-3vhc-576x-3qv4 + GHSA-f67f-6cw9-8mq4. Without the pin, `hono/jwk` middleware accepts forged tokens.

#### Files to edit

```
package.json — add jose ^5 + oauth4webapi ^3.8.6 to dependencies; pin hono >= 4.11.4
tests/unit/deps/hono-cve-pin.test.ts — RED test (NEW)
tests/unit/deps/auth-deps-present.test.ts — RED test (NEW)
```

#### Deep file dependency analysis

- `package.json` — root manifest. Today hono is at `^4.x` (range allows pre-CVE versions). Change tightens to `>= 4.11.4`. Downstream: `npm install` re-resolves the lockfile; every server-loading test path picks up the new version.
- `tests/unit/deps/hono-cve-pin.test.ts` — NEW. Reads package.json, asserts hono semver range does NOT allow `< 4.11.4`. Sentinel prevents regression if a future engineer downgrades.
- `tests/unit/deps/auth-deps-present.test.ts` — NEW. Asserts jose + oauth4webapi appear in dependencies + their semver ranges are non-empty.

Per pre-flight: `vitest.contract.config.ts` includes `tests/unit/**/*.test.ts` — both new tests pick up automatically.

#### Deep Dives

- Hono CVEs: GHSA-3vhc-576x-3qv4 (alg confusion via header.alg fallback when JWK lacks `alg`) + GHSA-f67f-6cw9-8mq4 (HS256 default in JWT middleware allows token forgery). Both REQUIRE explicit `alg` option on every `hono/jwk` invocation post-fix.
- jose `^5`: zero deps, tree-shakeable, used across Cloudflare Workers / Node / Deno / Bun. Canonical pattern: `createRemoteJWKSet(new URL(jwks_uri))` + `jwtVerify(jwt, JWKS, { algorithms: ['RS256'], issuer, audience })`.
- oauth4webapi `^3.8.6`: OpenID-certified RP profiles (Basic, FAPI 1.0, FAPI 2.0). `processIntrospectionResponse` is the introspection helper.

#### Tasks

1. Update `package.json`: add `"jose": "^5.0.0"`, `"oauth4webapi": "^3.8.6"`; tighten hono to `">=4.11.4"`.
2. Run `npm install` to update lockfile.
3. Write `tests/unit/deps/hono-cve-pin.test.ts` (RED).
4. Write `tests/unit/deps/auth-deps-present.test.ts` (RED).
5. Verify both new tests PASS after the package.json edit (GREEN trivially via the manifest change).
6. Run `npm test -- tests/unit/deps/` to confirm.

#### TDD

```
RED:     hono_pin_rejects_pre_4_11_4() — asserts semver.satisfies("4.11.3", pkg.dependencies.hono) === false
RED:     hono_pin_allows_4_11_4_or_above() — asserts semver.satisfies("4.11.4", pkg.dependencies.hono) === true
RED:     jose_is_declared() — asserts pkg.dependencies.jose matches /^[\^~]?5/
RED:     oauth4webapi_is_declared() — asserts pkg.dependencies['oauth4webapi'] matches /^[\^~]?3/
GREEN:   Edit package.json to satisfy all 4 assertions
REFACTOR: None expected
VERIFY:  npm test -- tests/unit/deps/
```

#### Acceptance Criteria

- [ ] `npm test -- tests/unit/deps/` PASS (4 new assertions green)
- [ ] `npm run typecheck` green
- [ ] `npm run lint` zero warnings
- [ ] `package.json#dependencies.hono >= 4.11.4` AND `jose ^5` AND `oauth4webapi ^3.8.6` present

#### DoD

- [ ] All 4 RED tests passing
- [ ] `npm install` succeeded, lockfile updated
- [ ] No TypeScript errors
- [ ] No lint warnings

### T0.2 — Drizzle migration 0009_theo_api_keys.sql + schema TypeScript

#### Objective

Land the `theo_api_keys` table + Drizzle schema TypeScript so Phase 1 can build the `ApiKeyAuthVerifier`.

#### Evidence

Per ADR D2 + D5 + D6. The schema mirrors `theo-cloud/cloud/internal/routes/api_keys.go:50-115` ADRs D1-D7 (single unified key, scopes JSONB, SHA-256 hash, expires_at nullable, revoked_at soft-delete, rotated_from FK). Single-tenant means `tenant_id = "self"` constant — but the column ships in the schema for forward-compat (D6).

#### Files to edit

```
src/local/migrations/0009_theo_api_keys.sql — NEW migration
src/local/schema/theo-api-keys.ts — NEW Drizzle schema
src/local/migrations/meta/_journal.json — auto-regenerated via npm run db:generate
src/local/__tests__/theo-api-keys-schema.test.ts — RED test (NEW)
```

#### Deep file dependency analysis

- `src/local/migrations/0009_theo_api_keys.sql` — NEW migration creates `theo_api_keys` table with all columns mirroring cloud. Downstream: `npm run migrate` applies it to test DBs.
- `src/local/schema/theo-api-keys.ts` — NEW. Drizzle schema. Imports from `drizzle-orm/pg-core`. Downstream: Phase 1 (`ApiKeyAuthVerifier`) and Phase 2 (admin handlers) import it for type-safe queries.
- `src/local/migrations/meta/_journal.json` — Drizzle's per-migration journal. Auto-regenerated by `npm run db:generate`. Sentinel test in `src/local/__tests__/migrations.test.ts` validates journal sync.
- `src/local/__tests__/theo-api-keys-schema.test.ts` — NEW. Asserts the Drizzle table type has the expected columns + constraints.

#### Deep Dives

Schema mirror (port from cloud-repo `cloud/internal/routes/api_keys.go:50-115`):

```sql
CREATE TABLE IF NOT EXISTS theo_api_keys (
  id            varchar(20)  PRIMARY KEY,        -- apk-{16hex}
  subject       text         NOT NULL,           -- user id (any string)
  tenant_id     text         NOT NULL DEFAULT 'self',  -- D6 single-tenant constant
  key_name      varchar(64)  NOT NULL CHECK (length(trim(key_name)) > 0),
  key_hash      varchar(64)  NOT NULL UNIQUE,    -- SHA-256 hex (64 chars)
  key_prefix    varchar(12)  NOT NULL,           -- masked display
  scopes        jsonb        NOT NULL,           -- array of strings
  created_at    timestamptz  NOT NULL DEFAULT NOW(),
  last_used_at  timestamptz,
  expires_at    timestamptz,                     -- nullable per ADR D6 of cloud plan
  revoked_at    timestamptz,                     -- soft-delete per D7 of cloud plan
  rotated_from  varchar(20)  REFERENCES theo_api_keys(id)  -- self-FK for lineage
);

CREATE INDEX IF NOT EXISTS idx_theo_api_keys_subject_tenant
  ON theo_api_keys (subject, tenant_id)
  WHERE revoked_at IS NULL;

-- EC-2 ABSORBED: forbid self-FK cycle at row level (lineage CTE depends on no cycles).
-- Without this CHECK, a buggy INSERT could create A.rotated_from = A which would
-- make the lineage recursive CTE loop until LIMIT 100 kicks in, polluting the UI.
ALTER TABLE theo_api_keys
  ADD CONSTRAINT theo_api_keys_no_self_rotation CHECK (id != rotated_from);
```

**EC-11 ABSORBED (DOCUMENT):** SHA-256 hash collision probability is ~1 in 2^128 (birthday bound). The `key_hash` UNIQUE constraint catches the astronomical case + returns 500 INTERNAL_ERROR via the cloud-mirrored `isUniqueViolation()` discriminator. Log line is honest about the rarity per ADR D4 of cloud plan. No additional code change needed beyond the UNIQUE constraint above.

Drizzle schema TypeScript shape:

```ts
import { pgTable, varchar, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const theoApiKeys = pgTable('theo_api_keys', {
  id: varchar('id', { length: 20 }).primaryKey(),
  subject: text('subject').notNull(),
  tenantId: text('tenant_id').notNull().default('self'),
  keyName: varchar('key_name', { length: 64 }).notNull(),
  keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
  keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
  scopes: jsonb('scopes').$type<readonly string[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  rotatedFrom: varchar('rotated_from', { length: 20 }),  // self-FK; AFK constraint in SQL only
});
```

#### Tasks

1. Write `src/local/migrations/0009_theo_api_keys.sql` per the Deep Dive SQL.
2. Write `src/local/schema/theo-api-keys.ts` per the Deep Dive Drizzle shape.
3. Run `npm run db:generate` to regenerate `_journal.json`.
4. Write `src/local/__tests__/theo-api-keys-schema.test.ts` — RED test asserting Drizzle table fields exist + types are correct.
5. Run `npm test -- src/local/__tests__/theo-api-keys-schema.test.ts` to GREEN.
6. Run integration smoke: `npm test -- tests/integration/` to confirm no migration drift.

#### TDD

```
RED:     schema_has_required_columns() — asserts theoApiKeys.id / .subject / .tenantId / .keyName / .keyHash / .keyPrefix / .scopes / .createdAt / .lastUsedAt / .expiresAt / .revokedAt / .rotatedFrom all exist with correct types
RED:     schema_unique_constraint_on_key_hash() — asserts key_hash has unique() flag
RED:     schema_jsonb_scopes_typed_as_string_array() — asserts scopes type narrows to readonly string[]
GREEN:   Edit src/local/schema/theo-api-keys.ts per Deep Dive
REFACTOR: None expected
VERIFY:  npm test -- src/local/__tests__/theo-api-keys-schema.test.ts && npm test -- tests/integration/
```

#### Acceptance Criteria

- [ ] Migration `0009_theo_api_keys.sql` exists + Drizzle journal sync passes
- [ ] `src/local/__tests__/theo-api-keys-schema.test.ts` green (3 assertions)
- [ ] No regression in existing integration tests
- [ ] Pass: complexity — schema file ≤ 50 LoC (data structure, no logic)
- [ ] Pass: coverage — schema TypeScript file 100% covered (every export referenced by tests)
- [ ] Pass: lint zero warnings
- [ ] Pass: size — every changed file ≤ 500 LoC

#### DoD

- [ ] All tasks completed
- [ ] All tests passing — `npm test` green
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected

---

## Phase 1: Camada 2 — ApiKeyAuthVerifier DIP impl

**Objective:** Implement the `ApiKeyAuthVerifier` (new impl of the 12th DIP `AuthVerifier`) that performs SHA-256 lookup against `theo_api_keys`.

### T1.1 — RED tests for ApiKeyAuthVerifier

#### Objective

Define the contract of `ApiKeyAuthVerifier` via test cases BEFORE implementation.

#### Evidence

Per blueprint Q1: SHA-256 single-pass hashing (Mem0 + theo-cloud canonical). Per ADR D2: port from cloud-repo verbatim. Per testing.md: RED before GREEN inviolable.

#### Files to edit

```
src/server/auth/__tests__/api-key-verifier.test.ts — NEW RED tests
```

#### Deep file dependency analysis

- `src/server/auth/__tests__/api-key-verifier.test.ts` — NEW. Sibling of existing `bearer-verifier.test.ts`. Tests use a stub `Pool` injected via constructor (DIP per architecture.md — verifier accepts DB via interface, not concrete pg).

#### Deep Dives

`ApiKeyAuthVerifier.verify(token)` contract:
- Token MUST start with `theo_live_` prefix → SHA-256 hash → SELECT 1 FROM theo_api_keys WHERE key_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) AND tenant_id = 'self'.
- Returns `true` if row found, `false` otherwise.
- Side effect: UPDATE last_used_at = NOW() WHERE key_hash = $1 (best-effort fire-and-forget).
- Constant-time on prefix check (matches existing BearerAuthVerifier EC-2/EC-4 discipline).
- Length-check before any SHA-256 call to short-circuit obvious garbage.

#### Tasks

1. Write `src/server/auth/__tests__/api-key-verifier.test.ts` with the test cases below.
2. Run `npm test -- src/server/auth/__tests__/api-key-verifier.test.ts` — all should FAIL (no impl yet).

#### TDD

```
RED:     verify_returns_true_for_valid_key() — given a key inserted into a test pool, returns true
RED:     verify_returns_false_for_unknown_key() — given a random theo_live_ token, returns false
RED:     verify_returns_false_for_revoked_key() — given a key with revoked_at NOT NULL, returns false
RED:     verify_returns_false_for_expired_key() — given a key with expires_at in past, returns false
RED:     verify_returns_false_for_non_theo_live_prefix() — given "Bearer eyJ..." JWT, returns false (no DB query made)
RED:     verify_returns_false_for_empty_token() — given "", returns false (no DB query made)
RED:     verify_updates_last_used_at() — after successful verify, last_used_at column is bumped
RED:     verify_handles_token_with_sql_metachars_safely() — EC-8 ABSORBED: pass token "theo_live_abc'; DROP TABLE theo_api_keys; --" + assert the parameterized query returns false safely; pins the parameterization invariant
GREEN:   Implement in T1.2
REFACTOR: TBD in T1.2
VERIFY:  npm test -- src/server/auth/__tests__/api-key-verifier.test.ts
```

#### Acceptance Criteria

- [ ] 7 tests written and FAIL (RED phase)
- [ ] Tests use a stub Pool (no real DB in unit tests; integration test covers real DB in Phase 5)
- [ ] Pass: lint zero warnings on test file

#### DoD

- [ ] Test file exists
- [ ] All 7 tests FAIL with clear assertion messages (RED)

### T1.2 — GREEN: implement ApiKeyAuthVerifier

#### Objective

Make T1.1 tests pass with minimal code.

#### Evidence

T1.1 RED tests define the contract.

#### Files to edit

```
src/server/auth/api-key-verifier.ts — NEW impl (the GREEN code)
```

#### Deep file dependency analysis

- `src/server/auth/api-key-verifier.ts` — NEW. Implements `AuthVerifier`. Accepts `Pool`-shape via constructor (`{ query: (sql, params) => Promise<{ rows: ... }> }`) per DIP discipline; production wires real `pg.Pool`.
- Imports: `../../core/dip/auth-verifier.js` (the interface) + `node:crypto` (SHA-256).

#### Deep Dives

Pseudocode:

```ts
import { createHash } from 'node:crypto';
import type { AuthVerifier } from '../../core/dip/auth-verifier.js';

// Minimal pool surface — DIP per architecture.md
export interface AuthPool {
  query<T>(sql: string, params: unknown[]): Promise<{ rows: T[] }>;
}

const PREFIX = 'theo_live_';

export class ApiKeyAuthVerifier implements AuthVerifier {
  readonly #pool: AuthPool;
  constructor(pool: AuthPool) { this.#pool = pool; }

  async verify(token: string): Promise<boolean> {
    if (!token.startsWith(PREFIX) || token.length <= PREFIX.length) return false;
    const hash = createHash('sha256').update(token).digest('hex');
    const { rows } = await this.#pool.query<{ id: string }>(
      `SELECT id FROM theo_api_keys
       WHERE key_hash = $1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
         AND tenant_id = 'self'
       LIMIT 1`,
      [hash],
    );
    if (rows.length === 0) return false;
    // Fire-and-forget last_used_at update
    this.#pool.query(`UPDATE theo_api_keys SET last_used_at = NOW() WHERE key_hash = $1`, [hash])
      .catch(() => { /* observability layer logs */ });
    return true;
  }
}
```

#### Tasks

1. Write `src/server/auth/api-key-verifier.ts` per Deep Dive.
2. Run `npm test -- src/server/auth/__tests__/api-key-verifier.test.ts` — all 7 GREEN.
3. Run `npm run typecheck` — zero errors.
4. Run `npm run lint` on the new file — zero warnings.

#### TDD

```
GREEN:   ApiKeyAuthVerifier implemented per Deep Dive
REFACTOR: extract SQL constant to module-level if test count grows
VERIFY:  npm test -- src/server/auth/__tests__/api-key-verifier.test.ts
```

#### Acceptance Criteria

- [ ] All 7 T1.1 tests GREEN
- [ ] Pass: complexity — every changed file has cyclomatic complexity ≤ 10
- [ ] Pass: coverage — `npm run test:coverage` ≥ 90% on changed files
- [ ] Pass: lint zero warnings
- [ ] Pass: size — file ≤ 500 LoC (expect ~50)

#### DoD

- [ ] All RED tests now GREEN
- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings
- [ ] File ≤ 500 LoC

---

## Phase 2: Camada 2 — Admin REST + CLI

**Objective:** Ship admin endpoints under `/v1/admin/keys/*` + the `themory keys` CLI subcommand.

### T2.1 — Admin REST handlers (List + Create + Revoke + Rotate + Lineage)

#### Objective

Port the 5 admin handlers from `theo-cloud/cloud/internal/routes/api_keys.go` to TypeScript.

#### Evidence

Per ADR D2 verbatim-port mandate. Per blueprint Q3 Cal.com pattern — same admin endpoints + same UI conventions.

#### Files to edit

```
src/server/handlers/admin-keys.ts — NEW (5 handlers)
src/server/handlers/__tests__/admin-keys.test.ts — RED tests (NEW)
src/server/app.ts — mount admin routes under /v1/admin/keys/* AFTER bearer middleware
```

#### Deep file dependency analysis

- `src/server/handlers/admin-keys.ts` — NEW. Exports `listKeysHandler`, `createKeyHandler`, `revokeKeyHandler`, `rotateKeyHandler`, `lineageKeyHandler`. Each accepts `(c: Context, pool: AuthPool)` per existing handler convention (`recall.ts` / `remember.ts` etc).
- `src/server/handlers/__tests__/admin-keys.test.ts` — NEW. Tests use the stub pool pattern.
- `src/server/app.ts` — modify the `createApp` function to register the 5 admin routes under `/v1/admin/keys/*` after `bearerAuth`. The bearer middleware MUST accept the bootstrap admin token + `memory:admin` scope (scope-check is hardened in T2.2 via the new scope verifier).

Downstream: `src/agent-tools/cli.ts` T2.3 wraps these endpoints with the `themory keys` subcommand. `package.json#exports` does NOT need update (the admin handlers live behind the server export already).

#### Deep Dives

Handler shapes (5 mirroring cloud-repo `api_keys.go`):

```ts
// POST /v1/admin/keys
// Body: { name: string, scopes: string[], expires_at?: string | null }
// Response: { id, name, key_prefix, scopes, secret }  (secret shown ONCE)
export async function createKeyHandler(c, pool) {
  // 1. Parse body + validate name (EC-4 trim, ≤ 64 chars, non-empty)
  // 2. Validate scopes (must be in {memory:read, memory:write, memory:delete, memory:admin})
  // 3. EC-3: expires_at in past = 400
  // 4. Generate secret via crypto.randomBytes(32) + base64url
  // 5. Hash + INSERT + return secret ONCE
}

// GET /v1/admin/keys/list (LIMIT 100 cap per EC-1)
export async function listKeysHandler(c, pool) { /* ... */ }

// DELETE /v1/admin/keys/{id} (soft-delete via revoked_at = NOW())
// EC-2: validate id format apk-{16hex} BEFORE query
export async function revokeKeyHandler(c, pool) { /* ... */ }

// POST /v1/admin/keys/{id}/rotate
// Body: { grace_window_hours?: number 1-168 }
// Atomic tx per cloud-repo lines 440-545: SELECT FOR UPDATE old → INSERT new → UPDATE old.expires_at
export async function rotateKeyHandler(c, pool) { /* ... */ }

// GET /v1/admin/keys/{id}/lineage
// Recursive CTE walks rotated_from chain forwards + backwards
export async function lineageKeyHandler(c, pool) { /* ... */ }
```

Constants (mirror cloud `api_keys.go:63-93`):

```ts
const SECRET_PREFIX = 'theo_live_';
const SECRET_RANDOM_BYTES = 32;
const ROW_ID_PREFIX = 'apk-';
const LIST_LIMIT = 100;
const KEY_NAME_MAX_LENGTH = 64;
const VALID_SCOPES = new Set(['memory:read', 'memory:write', 'memory:delete', 'memory:admin']);
const DEFAULT_GRACE_WINDOW_HOURS = 24;
const MIN_GRACE_WINDOW_HOURS = 1;
const MAX_GRACE_WINDOW_HOURS = 168;
const ROW_ID_REGEX = /^apk-[0-9a-f]{16}$/;
```

#### Tasks

1. Write `src/server/handlers/__tests__/admin-keys.test.ts` with RED tests for each of the 5 handlers (~15-20 assertions).
2. Write `src/server/handlers/admin-keys.ts` per the Deep Dive.
3. Modify `src/server/app.ts` to mount the 5 routes after `bearerAuth`.
4. Run `npm test -- src/server/handlers/__tests__/admin-keys.test.ts` — GREEN.

#### TDD

```
RED:     create_key_returns_secret_once() — POST /v1/admin/keys returns 200 with secret in body
RED:     create_key_rejects_empty_name() — returns 400 EMPTY_NAME
RED:     create_key_rejects_name_too_long() — returns 400 NAME_TOO_LONG
RED:     create_key_rejects_unknown_scope() — returns 400 UNKNOWN_SCOPE
RED:     create_key_rejects_expires_in_past() — returns 400 EXPIRES_IN_PAST
RED:     list_keys_caps_at_100() — LIMIT 100 hard cap
RED:     list_keys_excludes_revoked() — revoked_at NOT NULL → not in list
RED:     revoke_key_404_on_invalid_id() — id NOT matching apk-{16hex} → 400 INVALID_ID
RED:     revoke_key_404_on_unknown_id() — valid format but not in DB → 404 NOT_FOUND
RED:     revoke_key_204_on_success() — successful revoke → 204
RED:     rotate_key_returns_new_secret() — POST /rotate returns 200 with new secret
RED:     rotate_key_atomic_tx() — both INSERT new + UPDATE old.expires_at in same tx (rollback test)
RED:     rotate_key_grace_window_default_24h() — default grace_window_hours = 24
RED:     rotate_key_grace_window_out_of_range_rejected() — < 1 or > 168 → 400
RED:     lineage_returns_chain_root_first_current_last() — recursive CTE order assertion
RED:     lineage_404_for_cross_tenant() — D5 existence-leak invariant
RED:     lineage_handles_cyclic_rotated_from_safely() — EC-2 ABSORBED: even with the DB CHECK constraint in T0.2, defensive UNION (not UNION ALL) in the CTE dedupes any leftover edge case; test inserts 2 rows where rotation FK was set BEFORE the constraint shipped (via bypass) + asserts CTE terminates at LIMIT 100 without infinite loop
RED:     create_key_handles_id_collision_via_db_unique_constraint() — EC-6 ABSORBED: fire 100 concurrent createKey calls; assert all 100 succeed AND return distinct apk-{16hex} ids (validates entropy + DB UNIQUE PK retry)
RED:     create_key_dedupes_scopes_array() — EC-7 ABSORBED: POST with scopes: ["memory:read", "memory:read", "memory:write"] → DB row's scopes column has 2 entries via [...new Set(input.scopes)] before INSERT
GREEN:   Implement admin-keys.ts per Deep Dive
REFACTOR: extract id-generation helper if used in 2+ handlers
VERIFY:  npm test -- src/server/handlers/__tests__/admin-keys.test.ts
```

#### Acceptance Criteria

- [ ] All 16 RED tests GREEN after impl
- [ ] App.ts mounts the 5 routes correctly (covered by Phase 5 integration test)
- [ ] Pass: complexity — every handler ≤ 10 cyclomatic
- [ ] Pass: coverage — ≥ 90% on changed files
- [ ] Pass: lint zero warnings
- [ ] Pass: size — `admin-keys.ts` ≤ 500 LoC (port the 700-line cloud-repo Go file should slim down in TS via shared helpers)

#### DoD

- [ ] All RED tests now GREEN
- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings
- [ ] File-size budget respected

### T2.2.1 — Bootstrap token self-revoke after first admin key issuance (EC-3 ABSORBED)

#### Objective

Make the bootstrap token (per ADR D7) **single-use**: after the first admin key is created via the bootstrap token, the bootstrap path must be permanently disabled until the server is restarted with a NEW bootstrap env var. Closes the EC-3 silent-backdoor exploit.

#### Evidence

Per EC-3 of `/edge-case-plan` 2026-06-07: leaked bootstrap token persists even after admin key revoke = un-revocable admin escalation. ADR D7 amended to require the self-revoke pattern.

#### Files to edit

```
src/local/migrations/0010_admin_config.sql — NEW migration (1-row admin_config table)
src/local/schema/admin-config.ts — NEW Drizzle schema
src/server/auth/bootstrap-token.ts — NEW (sentinel: validates bootstrap + checks bootstrap_consumed flag)
src/server/auth/__tests__/bootstrap-token.test.ts — RED tests (NEW)
src/server/handlers/admin-keys.ts — T2.1 createKey handler: after successful first admin key INSERT, set bootstrap_consumed=true atomically in same tx
```

#### Deep Dives

Schema:
```sql
CREATE TABLE IF NOT EXISTS admin_config (
  id            int          PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- enforce single row
  bootstrap_consumed boolean NOT NULL DEFAULT false,
  consumed_at   timestamptz
);
INSERT INTO admin_config (id) VALUES (1) ON CONFLICT DO NOTHING;
```

`bootstrap-token.ts`:
```ts
export async function isBootstrapAllowed(pool: AuthPool): Promise<boolean> {
  const { rows } = await pool.query<{ bootstrap_consumed: boolean }>(
    `SELECT bootstrap_consumed FROM admin_config WHERE id = 1 LIMIT 1`, []
  );
  return rows[0]?.bootstrap_consumed === false;
}

export async function markBootstrapConsumed(pool: AuthPool): Promise<void> {
  await pool.query(
    `UPDATE admin_config SET bootstrap_consumed = true, consumed_at = NOW() WHERE id = 1 AND bootstrap_consumed = false`,
    []
  );
}
```

T2.1 createKey handler: after a successful INSERT of a key with `memory:admin` scope using the bootstrap token, call `markBootstrapConsumed(pool)` in the same transaction. Subsequent bootstrap-token uses get `isBootstrapAllowed() === false` → 401 + log `bootstrap_already_consumed`.

#### TDD

```
RED:     bootstrap_token_works_first_time() — env-bootstrap allows POST /v1/admin/keys initially
RED:     bootstrap_token_self_revokes_after_first_admin_key_issuance() — after first admin key created, bootstrap returns 401 BOOTSTRAP_CONSUMED on subsequent calls
RED:     bootstrap_consumed_flag_atomic_with_key_insert() — if the createKey transaction rolls back, bootstrap_consumed stays false
GREEN:   Implement bootstrap-token.ts + admin_config schema + wire into createKey
REFACTOR: None expected
VERIFY:  npm test -- src/server/auth/__tests__/bootstrap-token.test.ts
```

#### Acceptance Criteria + DoD

- [ ] 3 RED tests GREEN
- [ ] Standard quality gates (complexity / coverage / lint / size)

### T2.2 — Scope verifier middleware (memory:admin check for admin endpoints)

#### Objective

Add a scope-check middleware that gates `/v1/admin/keys/*` to keys with `memory:admin` scope.

#### Evidence

Per ADR D7 (bootstrap token bypass at first call) + ADR D2 (cloud-repo scope discipline). Admin endpoints WITHOUT scope check = anyone with any `theo_live_*` key can create more keys = privilege escalation. Per blueprint Q2: scope:verb discipline IS the canonical pattern.

#### Files to edit

```
src/server/auth/scope-verifier.ts — NEW
src/server/auth/__tests__/scope-verifier.test.ts — RED tests (NEW)
src/server/app.ts — wire scope-check on /v1/admin/keys/* routes
```

#### TDD

```
RED:     scope_check_passes_for_admin_key() — given key with ['memory:admin'], allows
RED:     scope_check_rejects_read_only_key() — given key with ['memory:read'], 403 SCOPE_INSUFFICIENT
RED:     scope_check_bootstrap_token_admin_grant() — bootstrap token always passes admin
GREEN:   Implement scope-verifier.ts
REFACTOR: None
VERIFY:  npm test -- src/server/auth/__tests__/scope-verifier.test.ts
```

#### Acceptance Criteria

- [ ] 3 RED tests GREEN
- [ ] Pass: complexity / coverage / lint / size

#### DoD

- [ ] As per T2.1

### T2.3 — `themory keys` CLI subcommand

#### Objective

Add `themory keys {create,list,rotate,revoke}` to the CLI.

#### Files to edit

```
src/agent-tools/cli.ts — extend with new `keys` subcommand
src/agent-tools/__tests__/cli-keys.test.ts — RED tests (NEW)
```

#### TDD

```
RED:     themory_keys_create_invokes_post() — `themory keys create --name foo --scope memory:read` makes POST /v1/admin/keys
RED:     themory_keys_list_invokes_get() — `themory keys list` makes GET /v1/admin/keys/list
RED:     themory_keys_rotate_invokes_post_rotate() — `themory keys rotate apk-XXX`
RED:     themory_keys_revoke_invokes_delete() — `themory keys revoke apk-XXX`
RED:     themory_keys_create_prints_secret_with_warning() — output includes "save now — won't show again"
GREEN:   Implement themory keys subcommand
REFACTOR: extract HTTP-call helper shared with `themory health` if pattern matches
VERIFY:  npm test -- src/agent-tools/__tests__/cli-keys.test.ts
```

#### Acceptance Criteria

- [ ] 5 RED tests GREEN
- [ ] Pass: complexity / coverage / lint / size

#### DoD

- [ ] As per T2.1

---

## Phase 3: Camada 3 — OidcAuthVerifier + dual-validation middleware

**Objective:** Ship the OIDC bridge.

### T3.1 — OidcAuthVerifier impl + dual-validation middleware composition

#### Objective

Implement OidcAuthVerifier using `oauth4webapi.processIntrospectionResponse` + write `dualValidationAuth` middleware that prefix-switches.

#### Evidence

Blueprint Q4 ADOPT Path A. ADR D1 explicit decision. ADR-0013 will ship with this.

#### Files to edit

```
src/server/auth/oidc-verifier.ts — NEW
src/server/auth/dual-validation.ts — NEW (composes ApiKey + Oidc verifiers via prefix switch)
src/server/auth/__tests__/oidc-verifier.test.ts — RED (NEW)
src/server/auth/__tests__/dual-validation.test.ts — RED (NEW)
src/server/app.ts — accept new `authMode: 'env' | 'api-keys' | 'oidc' | 'both'` option
```

#### Deep Dives

`OidcAuthVerifier` (with EC-4 timeout + EC-5 coalescing absorbed):
```ts
import * as oauth from 'oauth4webapi';
import { createHash } from 'node:crypto';
import type { AuthVerifier } from '../../core/dip/auth-verifier.js';

export interface OidcConfig {
  readonly issuerUrl: URL;
  readonly clientId: string;
  readonly clientAuthMethod: 'client_secret_post' | 'client_secret_basic';
  readonly clientSecret: string;
  readonly cacheTtlSeconds?: number;        // default 120
  readonly introspectionTimeoutMs?: number; // EC-4 ABSORBED: default 5000 (5s)
}

export class OidcAuthVerifier implements AuthVerifier {
  readonly #cache = new Map<string, { active: boolean; expiresAt: number }>();
  // EC-5 ABSORBED: coalesce concurrent introspection calls for the same token-hash
  readonly #inFlight = new Map<string, Promise<boolean>>();

  async verify(token: string): Promise<boolean> {
    const tokenHash = createHash('sha256').update(token).digest('hex');

    // Cache hit?
    const cached = this.#cache.get(tokenHash);
    if (cached && cached.expiresAt > Date.now()) return cached.active;

    // EC-5: in-flight coalescing — if another request is already introspecting this same token, reuse the Promise
    const existing = this.#inFlight.get(tokenHash);
    if (existing) return existing;

    // EC-4: AbortController for hard timeout on introspection HTTP
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.#timeoutMs);

    const promise = (async () => {
      try {
        const result = await oauth.processIntrospectionResponse(/* ... */, { signal: ac.signal });
        const active = result.active === true;
        this.#cache.set(tokenHash, { active, expiresAt: Date.now() + this.#ttlMs });
        return active;
      } catch {
        return false;  // timeout OR network error OR introspection rejection = fail closed
      } finally {
        clearTimeout(timer);
        this.#inFlight.delete(tokenHash);
      }
    })();

    this.#inFlight.set(tokenHash, promise);
    return promise;
  }
}
```

`dualValidationAuth` (with EC-1 shape-check fallthrough absorbed):
```ts
// EC-1 ABSORBED: tighter prefix shape check + fallthrough to OIDC when shape mismatches
const THEO_LIVE_SHAPE = /^theo_live_[A-Za-z0-9_-]{40,}$/;  // prefix + base64url(32) min

export function dualValidationAuth(opts: {
  apiKey?: AuthVerifier;
  oidc?: AuthVerifier;
}): MiddlewareHandler {
  return async (c, next) => {
    const token = extractBearer(c.req.header('Authorization'));
    if (!token) return c.json({ code: 'AUTH_REQUIRED' }, 401);

    if (token.startsWith('theo_live_')) {
      if (THEO_LIVE_SHAPE.test(token)) {
        // Looks like a real theo_live_ key — route to apiKey
        if (opts.apiKey && await opts.apiKey.verify(token)) return next();
        return c.json({ code: 'INVALID_TOKEN' }, 401);
      }
      // EC-1: prefix collision but shape mismatch — log + fall through to OIDC
      c.get('logger')?.warn('prefix_collision_detected', { tokenPrefix: token.slice(0, 10) });
      // Fall through to OIDC branch below
    }

    if (opts.oidc && await opts.oidc.verify(token)) return next();
    return c.json({ code: 'INVALID_TOKEN' }, 401);
  };
}
```

#### TDD

```
RED:     oidc_verify_calls_introspection_endpoint() — mock introspection returns {active: true}, verify returns true
RED:     oidc_verify_returns_false_on_inactive() — mock returns {active: false}, verify returns false
RED:     oidc_verify_returns_false_on_network_error() — mock throws, verify returns false (graceful 401)
RED:     oidc_verify_caches_responses() — second call within TTL does NOT re-hit introspection
RED:     dual_validation_routes_theo_live_to_apikey() — theo_live_ prefix → calls apiKey.verify(), not oidc.verify()
RED:     dual_validation_routes_non_theo_live_to_oidc() — JWT prefix → calls oidc.verify(), not apiKey.verify()
RED:     dual_validation_returns_401_when_no_verifier_matches() — both undefined → 401
RED:     dual_validation_falls_through_to_oidc_when_theo_live_prefix_shape_invalid() — EC-1 ABSORBED: token `theo_live_short` (prefix matches but shape regex fails) → falls through to OIDC verifier (not 401-immediately)
RED:     oidc_verify_returns_false_on_introspection_timeout() — EC-4 ABSORBED: mock introspect that hangs > 5s → verify returns false within 5.5s wall-clock (timer-based assertion)
RED:     oidc_verify_coalesces_concurrent_cache_misses_for_same_token() — EC-5 ABSORBED: 10 parallel verify() calls for the same token-hash + empty cache → introspection HTTP fires exactly ONCE; all 10 callers get the same Promise's result
GREEN:   Implement oidc-verifier.ts + dual-validation.ts
REFACTOR: extract cache abstraction if Camada 4 will reuse it
VERIFY:  npm test -- src/server/auth/__tests__/oidc-verifier.test.ts src/server/auth/__tests__/dual-validation.test.ts
```

#### Acceptance Criteria

- [ ] 7 RED tests GREEN
- [ ] Pass: complexity / coverage / lint / size

#### DoD

- [ ] As per T2.1

### T3.2 — Write ADR-0013 + ADR-0014 + ADR-0015 + supersede ADR-0009

#### Objective

Land the 3 ADR markdown files.

#### Files to edit

```
.claude/knowledge-base/adrs/ADR-0013-oidc-bridge-via-introspection.md — NEW
.claude/knowledge-base/adrs/ADR-0014-oss-lifecycle-parity.md — NEW
.claude/knowledge-base/adrs/ADR-0015-mcp-streamable-http-auth.md — NEW
.claude/knowledge-base/adrs/ADR-0009-cloud-auth-theokit-api-key.md — annotate "OAuth/OIDC flow" alternative as SUPERSEDED by ADR-0013
```

#### TDD

(Documentation-only task — no code tests. Reviewed via /review against discover-blueprint-golden-rule.md.)

#### Acceptance Criteria

- [ ] 3 new ADRs follow MADR 3.0 format (status, decision, rationale, consequences, alternatives)
- [ ] ADR-0013 includes a "Supersedes" header pointing to ADR-0009 § Alternatives row 4
- [ ] ADR-0009 annotated (DOES NOT REWRITE — adds a "## Supersession history" footer)

---

## Phase 4: Sub-goal 3 — MCP streamable-HTTP authentication

### T4.1 — Wrap MCP server with dualValidationAuth on streamable-HTTP transport

#### Objective

When `themory mcp --transport streamable-http` is invoked, compose the `dualValidationAuth` middleware onto the MCP HTTP request path.

#### Evidence

Blueprint Q8 verdict + ADR D3 decision.

#### Files to edit

```
src/agent-tools/server.ts — add `withBearerAuth(server, verifier)` wrapper
src/agent-tools/cli.ts — wire `withBearerAuth` conditionally on --transport streamable-http
src/agent-tools/__tests__/streamable-http-auth.test.ts — RED tests (NEW)
```

#### TDD

```
RED:     mcp_streamable_http_returns_401_without_bearer() — POST /mcp without Authorization → 401 + WWW-Authenticate header
RED:     mcp_streamable_http_accepts_theo_live_key() — POST /mcp with valid theo_live_ → 200
RED:     mcp_streamable_http_accepts_oidc_jwt() — POST /mcp with valid OIDC JWT → 200 (mocked introspect)
RED:     mcp_stdio_transport_does_NOT_require_bearer() — stdio path unchanged, no auth check
RED:     mcp_streamable_http_refuses_non_https_non_localhost() — bind to 0.0.0.0 without TLS → refuse-to-start
RED:     mcp_http_401_includes_well_formed_www_authenticate() — EC-10 ABSORBED: assert response has `WWW-Authenticate: Bearer realm="theo-mcp", error="invalid_token", error_description="...", resource_metadata="/.well-known/oauth-protected-resource"` per RFC 6750 § 3 + MCP spec
GREEN:   Implement withBearerAuth wrapper + cli wiring
REFACTOR: None expected
VERIFY:  npm test -- src/agent-tools/__tests__/streamable-http-auth.test.ts
```

#### Acceptance Criteria

- [ ] 5 RED tests GREEN
- [ ] Pass: complexity / coverage / lint / size

#### DoD

- [ ] As per T2.1

### T4.2 — Ship `/.well-known/oauth-protected-resource` discovery endpoint per RFC 9728

#### Objective

Add the well-known endpoint listing the configured OIDC issuer + supported scopes + bearer methods.

#### Files to edit

```
src/server/handlers/well-known.ts — NEW
src/server/handlers/__tests__/well-known.test.ts — RED (NEW)
src/server/app.ts — register the route (auth-exempt like /v1/openapi.json)
```

#### TDD

```
RED:     well_known_returns_404_when_oidc_disabled() — if --auth=api-keys-only, no OIDC = no well-known
RED:     well_known_returns_metadata_when_oidc_enabled() — fields: resource, resource_name, authorization_servers, scopes_supported, bearer_methods_supported
RED:     well_known_is_auth_exempt() — accessible WITHOUT Bearer (like /v1/openapi.json)
GREEN:   Implement
VERIFY:  npm test -- src/server/handlers/__tests__/well-known.test.ts
```

#### Acceptance Criteria + DoD

- [ ] 3 RED tests GREEN; standard quality gates

---

## Phase 5: Integration Validation (Camada 2 lifecycle + Camada 3 OIDC dual-mode + MCP HTTP)

### T5.1 — End-to-end integration test against real pgvector + stubbed introspection

#### Objective

The Goal-metric test: 12 scenarios covering full lifecycle + OIDC bridge + MCP HTTP, all against real `ankane/pgvector:v0.5.1` via testcontainers + a stubbed RFC 7662 introspection endpoint.

#### Evidence

Per blueprint Q6 recipe (7 Supabase-auth patterns adapted to vitest + ankane/pgvector). Per testing.md integration test discipline.

#### Files to edit

```
tests/integration/auth/lifecycle.test.ts — NEW (12 scenarios)
tests/integration/auth/_helpers.ts — NEW (stub OIDC issuer fixture)
```

#### Deep Dives

12 scenarios (the goal-metric set):

1. `create_key_returns_secret_once_then_prefix_only` — POST creates, GET by id returns only key_prefix
2. `revoke_key_immediately_invalidates_subsequent_call` — revoke → next call with that key = 401
3. `rotate_key_with_grace_window_both_keys_work_briefly_then_old_fails` — both keys work during grace window; after expiry, old fails
4. `lineage_walks_chain_root_first_current_last` — recursive CTE order
5. `scope_check_admin_required_for_admin_endpoints` — read-only key on /v1/admin/* = 403
6. `bootstrap_token_bypasses_first_call_only` — env-bootstrap token works once; after first admin key created, bootstrap should be unset (operator policy)
7. `oidc_dual_mode_routes_theo_live_to_apikey_verifier` — theo_live_ → calls SHA-256 lookup
8. `oidc_dual_mode_routes_jwt_to_oidc_verifier` — JWT → calls introspection (stub)
9. `oidc_introspect_caches_within_ttl` — 2nd call within TTL = 1 introspection round-trip total
10. `mcp_streamable_http_requires_bearer_or_returns_401_with_www_authenticate` — proper 401 envelope
11. `mcp_stdio_unchanged_no_bearer_required` — stdio still works without auth
12. `well_known_oauth_protected_resource_resolves_when_oidc_enabled` — RFC 9728 endpoint

#### TDD

```
RED:     12 integration scenarios per Deep Dive
GREEN:   ALL implementation phases complete (Phase 1-4)
REFACTOR: extract scenario helpers if duplication grows
VERIFY:  npm test -- tests/integration/auth/lifecycle.test.ts

# EC-9 ABSORBED: configure vitest test timeout for pgvector cold-start
# First pgvector image pull is ~250MB and takes 30-60s; subsequent runs cached.
# Configure tests/integration/auth/* to use testTimeout: 90_000 ms via:
#   - vitest.integration.config.ts top-level testTimeout (impacts all integration tests; safe)
#   OR
#   - per-test override: describe.concurrent.todo(..., { timeout: 90_000 })
# Document in tests/integration/auth/_helpers.ts header comment.
```

#### Acceptance Criteria

- [ ] All 12 scenarios GREEN
- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings
- [ ] Pass: coverage — ≥ 95% on auth surface (critical path)

#### DoD

- [ ] All 12 scenarios GREEN
- [ ] Goal-metric observed: `tests/integration/auth/lifecycle.test.ts` passes 12/12
- [ ] All quality gates pass

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | OSS server has no multi-user lifecycle (only env-var) | T0.2 + T1.1 + T1.2 + T2.1 + T2.2 + T2.3 | Drizzle migration + schema + ApiKeyAuthVerifier + admin handlers + scope-check + CLI |
| 2 | OIDC/OAuth deferred per ADR-0009 | T3.1 + T3.2 | OidcAuthVerifier + dualValidationAuth + ADR-0013 supersession |
| 3 | MCP streamable-HTTP has NO auth check | T4.1 | withBearerAuth wrapper + dual-mode reused |
| 4 | RFC 9728 discovery endpoint missing | T4.2 | /.well-known/oauth-protected-resource handler |
| 5 | Hono CVE risk (2026-01-13) | T0.1 + ADR D4 | Version pin + sentinel test |
| 6 | jose + oauth4webapi adoption | T0.1 + T3.1 | Add deps + Rule 9 cited via blueprint |
| 7 | 3 ADRs from blueprint must ship | T3.2 | ADR-0013 + ADR-0014 + ADR-0015 written |
| 8 | Blueprint Q6 test recipe must land | T5.1 | 12-scenario integration test |
| 9 | Single-tenant constraint (D6) | T0.2 + T2.1 | tenant_id='self' constant; column retained |
| 10 | Bootstrap admin token (D7) | T2.2 + T5.1 (scenario 6) | env-bootstrap path documented + tested |
| 11 | Existing BearerAuthVerifier must NOT regress | T0.1 (existing tests stay green) | Coexistence verified by `npm test -- src/server/auth/__tests__/bearer-verifier.test.ts` |

**Coverage: 11/11 gaps covered (100%)**

## Global Definition of Done

- [ ] All 5 phases completed (Phase 0 setup, Phase 1 Camada 2 DIP, Phase 2 Camada 2 REST+CLI, Phase 3 Camada 3 OIDC, Phase 4 MCP HTTP, Phase 5 integration validation)
- [ ] All tests passing — `npm test` green
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected (every changed file ≤ 500 LoC per `architecture.md § Module hygiene`)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Inquebrável Rule 6) — entries for Camada 2 + Camada 3 + Sub-goal 3 + 3 new ADRs + Hono CVE pin
- [ ] Backward compatibility preserved — `BearerAuthVerifier` (env-var path) UNCHANGED + existing `THEMEMORY_API_KEY` env-var deployments continue to work
- [ ] 3 new ADRs landed: ADR-0013, ADR-0014, ADR-0015 (per Phase 3 T3.2)
- [ ] ADR-0009 annotated with supersession footer pointing to ADR-0013 (not rewritten — historical record preserved)
- [ ] **Runtime-metric proof** — integration scenarios in T5.1 observe SHA-256 lookups firing + introspection calls firing + cache hits firing (not just "code exists")
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND merged to `main`, move this plan to `.claude/knowledge-base/plans/completed/theo-memory-faang-auth-lifecycle-plan.md`

## Dependencies (per `deps-audit-golden-rule.md` Rule 9)

New runtime dependencies introduced by this plan (all evaluated in blueprint Q5):

| Package | Version | Purpose | License | Rule 9 status |
|---|---|---|---|---|
| `jose` | `^5.0.0` | JWKS primitives for Camada 3 | MIT | ADOPT — zero deps, OpenID-certified usage, panva-maintained |
| `oauth4webapi` | `^3.8.6` | OIDC introspection client for Camada 3 | MIT | ADOPT — zero deps, OpenID-certified Basic + FAPI 1.0 + FAPI 2.0 RP conformance |
| `hono` | `>=4.11.4` (pin tightened from `^4.x`) | CRITICAL CVE pin (2026-01-13 GHSA-3vhc-576x-3qv4 + GHSA-f67f-6cw9-8mq4) | MIT | ADOPT_PINNED — already in stack; CVE pin is mandatory per ADR D4 |

Rejected alternatives (per blueprint Q5):
- `express-jwt` — REJECTED (wrong framework; TheMemory uses Hono per architecture.md)
- DPoP RFC 9449 libs — DEFERRED to Camada 4 (cloud-repo follow-up plan)

## Final Phase: Integration Validation (MANDATORY)

> This phase runs AFTER all implementation phases. Plan is NOT done until the integration validation chain passes.

### Execution

```bash
npm test                         # unit + integration green
npm run test:coverage            # ≥ 90% on changed files; ≥ 95% on auth surface
npm run typecheck                # zero TS errors
npm run lint                     # zero lint warnings
npm test -- tests/integration/auth/lifecycle.test.ts  # the goal-metric: 12/12 scenarios green
```

### Acceptance Criteria

- [ ] All test suites green (unit + integration)
- [ ] Coverage ≥ 90% on changed files (auth surface ≥ 95%)
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] **Runtime-metric proof**: the 12 scenarios in `tests/integration/auth/lifecycle.test.ts` observe:
  - SHA-256 lookups happening (apikey path)
  - Introspection HTTP calls happening (OIDC path)
  - Introspection cache hits happening (cache path)
  - Bootstrap token path bypassed cleanly after first key issuance
  - stdio MCP transport NOT consulting Bearer (unchanged)

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing
2. Fix all plan-caused failures BEFORE declaring the plan complete (no false PASS)
3. Re-run the validation chain to confirm fixes
4. Pre-existing issues are logged in PR description but do NOT block plan completion
