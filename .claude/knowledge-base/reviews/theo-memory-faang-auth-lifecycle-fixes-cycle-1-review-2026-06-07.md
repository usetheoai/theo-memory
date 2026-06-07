# Review: theo-memory-faang-auth-lifecycle-fixes-cycle-1

**Date:** 2026-06-07
**Verdict:** READY_TO_MERGE
**Reviewers (spawned agents):** 6 (review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-architecture, cross-validation, review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-domain-api-design, domain-cli-tooling, tests, wiring)
**Total findings:** 20

## Findings summary by severity

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| CRITICAL | 0 |
| MAJOR | 5 |
| MINOR | 6 |
| INFO | 9 |

## MAJOR findings (5)

### F-arch-1: Admin REST sub-app is auto-mounted whenever THEMEMORY_API_KEY is set (apiKey !== undefined), even when the operator did NOT supply a bootstrap token. This silently changes behavior for pre-cycle deployments running `themory server` with only THEMEMORY_API_KEY set — previously `/v1/admin/keys/*` returned 404; now it answers 401 SCOPE_INSUFFICIENT for the env Bearer because the env key has no `memory:admin` scope row in theo_api_keys. The behavior is not a security defect (401 still rejects) but it violates ADR D1's "opt-in" contract: the plan says admin routes mount "ONLY when the caller passes CreateServerOptions.adminApi". The runner makes that decision implicitly based on `apiKey !== undefined`, which is broader than the plan/ADR D1 contract.


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-architecture
- **File:** `src/agent-tools/run-server.ts` line 186
- **Plan reference:** Plan T3.2 + ADR D1 (opt-in adminApi)
- **Evidence:**

  src/agent-tools/run-server.ts:185-196
  ```ts
  const bootstrapToken = resolveBootstrapToken();
  const adminApi = bootstrapToken !== undefined || apiKey !== undefined
      ? {
          pool,
          ...(bootstrapToken !== undefined ? { bootstrapToken } : {}),
        }
      : undefined;
  // Use ApiKeyAuthVerifier instead of the env-secret one when admin path is
  // active AND no OIDC issuer (lets theo_live_* keys auth via SHA-256 lookup).
  if (adminApi !== undefined && oidcCfg === null) {
    authVerifier = new ApiKeyAuthVerifier(pool);
  }
  ```
  Plan ADR D1 § Decision: "createApp() mounts /v1/admin/keys/* ONLY when the caller passes CreateServerOptions.adminApi: { pool, bootstrapToken? }".
  The runner couples adminApi auto-opt-in to apiKey-presence — not in the plan. Two side-effects:
    (a) Existing operators using only THEMEMORY_API_KEY now have /v1/admin/* exposed (401-gated, but reachable).
    (b) The authVerifier swap from BearerAuthVerifier to ApiKeyAuthVerifier (line 195) is a separate breaking change — pre-cycle, env-secret Bearer worked; post-cycle, only theo_live_* keys auth on the 4 verbs when this branch fires.

- **Recommended action:** Either (a) gate adminApi mounting EXCLUSIVELY on `bootstrapToken !== undefined` per the plan's opt-in contract (current line 186 condition is over-broad), OR (b) add a dedicated `--admin-api` CLI flag / env var to make the opt-in explicit per ADR D1's "Auto-detect (`if pool present in factory`) — implicit; violates KISS" alternative-rejected note. The current branch is exactly the rejected pattern dressed differently.


### F-arch-2: `resolveBearerAuth` calls `resolveOidcConfig(oidcInput)` UNCONDITIONALLY for any mode != 'none' / undefined — including `--auth=api-keys`. If the operator runs `themory mcp --auth=api-keys` in an environment that has `THEMORY_OIDC_ISSUER` set (or invalid OIDC env state from a prior debug session), the resolver throws EC-5 (invalid URL) or EC-6 (missing client secret) at boot, even though the operator explicitly chose api-keys only. Fail-loud is correct policy for the OIDC mode but inappropriate when OIDC was not selected.


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-architecture
- **File:** `src/agent-tools/run-mcp-server.ts` line 198
- **Plan reference:** Plan T3.2 ADR D4 + EC-5/EC-6
- **Evidence:**

  src/agent-tools/run-mcp-server.ts:195-205
  ```ts
  if (mode === undefined || mode === 'none') return undefined;
  
  // OIDC resolver throws synchronously on EC-5 / EC-6 — propagate to fail-loud at boot.
  const oidcCfg = resolveOidcConfig(oidcInput);
  
  if ((mode === 'oidc' || mode === 'both') && oidcCfg === null) {
    throw new Error(
      `themory mcp: --auth=${mode} requires --issuer (or THEMORY_OIDC_ISSUER env)`,
    );
  }
  ```
  `resolveOidcConfig` reads `process.env['THEMORY_OIDC_ISSUER']` directly (oidc-cli-resolver.ts:78) — so an unrelated env var causes EC-5/EC-6 throws even for `--auth=api-keys`. Same pattern in run-server.ts:164-180 where resolveOidcConfig fires regardless of any auth-mode signal (and there is no mode selector on `themory server` at all — OIDC just "happens" if env vars are set).

- **Recommended action:** Short-circuit when `mode === 'api-keys'`: skip `resolveOidcConfig` entirely. For `run-server.ts`, either (a) introduce an `--auth` flag mirroring `themory mcp` so the operator explicitly picks OIDC, or (b) only call `resolveOidcConfig` when `options.issuer !== undefined || process.env['THEMORY_OIDC_ISSUER'] !== undefined` AND verify the input is non-trivial — never throw EC-6 when the operator didn't select OIDC. Honest fail-loud is correct when OIDC is selected; it's overreach when OIDC was not requested.


### F-dom-api-1: `createOauth4webapiIntrospect`, `OidcAuthVerifier`, `IntrospectFn`, and `IntrospectionResult`
are NOT re-exported from `src/server/index.ts`, contradicting T2.2 Files-to-edit and
blocking third-party SDK consumers from wiring OIDC without internal subpath imports.
The two production callers (`src/agent-tools/run-server.ts:173`, `run-mcp-server.ts:209`)
import directly from `../../server/auth/oidc-introspect-oauth4webapi.js` — a private
file path that consumers of `@usetheo/memory/server` cannot reach through
`package.json#exports`. A self-hosted operator who wants to wire `OidcAuthVerifier`
into their own Hono / Express composition (NOT via `themory server`) has no public
path to do so.


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-domain-api-design
- **File:** `src/server/index.ts` line 1-15
- **Plan reference:** Plan § Phase 2 T2.2 Files-to-edit: `src/server/auth/index.ts (if exists, else src/server/index.ts) — re-export`
- **Domain anchor:** architecture.md § 9 Public API surface — 'Adding a new public export requires updating: src/index.ts, package.json#exports, the README... and a unit test that imports through the public path.'
- **Evidence:**

  ```ts
  // src/server/index.ts — full file:
  export { createApp as createServer } from './app.js';
  export type { AdminApiOptions, CreateServerOptions } from './app.js';
  export { BearerAuthVerifier, readApiKey } from './auth/bearer-verifier.js';
  export { bearerAuth } from './auth/middleware.js';
  // ❌ Missing: OidcAuthVerifier, createOauth4webapiIntrospect, IntrospectFn, IntrospectionResult
  // ❌ Missing: ApiKeyAuthVerifier, requireScope, AuthPool, RequireScopeOptions
  ```

- **Recommended action:** Add to `src/server/index.ts`:
  export { OidcAuthVerifier } from './auth/oidc-verifier.js';
  export type { IntrospectFn, IntrospectionResult, OidcAuthVerifierOptions } from './auth/oidc-verifier.js';
  export { createOauth4webapiIntrospect } from './auth/oidc-introspect-oauth4webapi.js';
  export type { CreateOauth4webapiIntrospectOptions } from './auth/oidc-introspect-oauth4webapi.js';
  export { ApiKeyAuthVerifier } from './auth/api-key-verifier.js';
  export type { AuthPool } from './auth/api-key-verifier.js';
  export { requireScope } from './auth/scope-verifier.js';
  export type { RequireScopeOptions } from './auth/scope-verifier.js';
Plus a contract test under `src/server/__tests__/` importing the named symbols via
`@usetheo/memory/server` to lock the surface.


### F-dom-api-2: Inconsistent error envelope `code` vocabulary between admin and generic routes.
`bearerAuth` middleware (used by `/v1/{remember,recall,forget,reflect}`) returns
`{ code: 'UNAUTHORIZED', message: 'Bearer token required' }` for missing/invalid
Bearer, while `requireScope` middleware (used by `/v1/admin/keys/*`) returns
`{ code: 'AUTH_REQUIRED', message: 'Authorization header is required.' }`.
Same semantic failure (no Bearer header) → two different `code` values.
Consumers parsing 401 envelopes uniformly (e.g., a CLI matching on `code` to
decide whether to prompt for `THEMEMORY_API_KEY`) cannot match a single token.
The admin-wiring test at L82-83 even asserts `body.code === 'AUTH_REQUIRED'`,
cementing the divergence as load-bearing in the contract suite.


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-domain-api-design
- **File:** `src/server/auth/middleware.ts` line 41-65
- **Plan reference:** Plan § Sub-goal 1 (Backward-compat preserved); Goal § 6 'Error envelope consistency: { code, message } shape across all error responses'
- **Domain anchor:** errors.ts § ErrorEnvelope { code, message, field? } — canonical envelope shape
- **Evidence:**

  ```ts
  // src/server/auth/middleware.ts L40-44 (generic /v1/*):
  return c.json(
    { code: 'UNAUTHORIZED', message: 'Bearer token required' },
    401,
    { 'WWW-Authenticate': 'Bearer' },
  );
  
  // src/server/auth/scope-verifier.ts L80-83 (/v1/admin/*):
  return c.json(
    { code: 'AUTH_REQUIRED', message: 'Authorization header is required.' },
    401,
  );
  ```

- **Recommended action:** Choose ONE canonical code (`AUTH_REQUIRED` is more RFC-aligned with RFC 6750 §3
`WWW-Authenticate` semantics; `UNAUTHORIZED` duplicates the HTTP status name in
the body, which is anti-pattern per RFC 7807) and standardize both middlewares.
Also align `WWW-Authenticate: Bearer` header — admin middleware omits it, which
breaks RFC 6750 §3 expectation for 401 on a Bearer-protected resource. Cover with
a sentinel test in `src/server/auth/__tests__/error-envelope-consistency.test.ts`
asserting both `bearerAuth` and `requireScope` emit identical `{ code, message }`
shape + same `WWW-Authenticate` header on missing-bearer 401.


### F-dom-api-3: Adapter narrows the introspection response to only 4 fields (`active`, `sub`,
`scope`, `exp`), silently discarding 8 other RFC 7662 §2.2 standard claims:
`client_id`, `username`, `token_type`, `iat`, `nbf`, `aud`, `iss`, `jti`. The
`IntrospectionResult` interface in `oidc-verifier.ts` mirrors this 4-field
reduction. The narrowing happens at TWO layers (`IntrospectionResult` interface
+ adapter mapping), each making the loss permanent. Downstream consumers cannot
perform `aud` (audience) validation — a RFC 7662 §4 SECURITY consideration:
"the resource server should ... validate that the token is intended for use
with this resource server [via `aud` claim]". Without `aud`, the verifier
accepts ANY active token issued by the configured issuer, even if it was
minted for a different resource (token-confusion attack surface). Same risk
with `iss` validation (defense against malicious second issuer impersonating
a trusted one).


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-domain-api-design
- **File:** `src/server/auth/oidc-introspect-oauth4webapi.ts` line 134-139
- **Plan reference:** Plan § Sub-goal 2 Production OIDC IntrospectFn adapter; Goal § 7 'RFC 7662 compliance: IntrospectionResult shape (active + sub + scope + exp)'
- **Domain anchor:** RFC 7662 §2.2 OAuth 2.0 Token Introspection Response — 12 standard claims
- **Evidence:**

  ```ts
  // src/server/auth/oidc-introspect-oauth4webapi.ts L134-139:
  return {
    active: result.active === true,
    ...(result.sub !== undefined ? { sub: result.sub } : {}),
    ...(result.scope !== undefined ? { scope: result.scope } : {}),
    ...(result.exp !== undefined ? { exp: result.exp } : {}),
  };
  // ❌ Discards: client_id, username, token_type, iat, nbf, aud, iss, jti
  ```

- **Recommended action:** Either (a) extend `IntrospectionResult` to carry the full RFC 7662 §2.2 surface
so future verifiers can validate `aud`/`iss`/`exp`/`nbf` per RFC §4, OR (b)
document the deliberate scope restriction with a SECURITY note in JSDoc citing
RFC 7662 §4 and explaining the trust assumption ("issuer is single-tenant; aud
validation deferred until multi-resource deployments — see follow-up cycle X").
Without one of these, the narrowing reads like an oversight rather than a
decision. The fail-loud-at-aud-mismatch behavior is industry standard (Auth0,
Okta, Hydra SDKs all surface `aud`).



## MINOR findings (6)

### F-arch-3: OIDC verifier wiring is duplicated between `run-server.ts:172-180` and `run-mcp-server.ts:207-215`. Both call sites: (1) resolveOidcConfig, (2) createOauth4webapiIntrospect with identical args, (3) new OidcAuthVerifier({ introspect }). The two callers diverge slightly downstream (run-server assigns to authVerifier + propagates oidcDiscovery; run-mcp-server assembles a BearerAuthOptions bag), so a full helper is over-engineering — but the createOauth4webapiIntrospect + OidcAuthVerifier construction tuple is verbatim duplicated.


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-architecture
- **File:** `src/agent-tools/run-mcp-server.ts` line 27
- **Plan reference:** Plan T3.2 (DRY across runners)
- **Evidence:**

  run-server.ts:172-180:
  ```ts
  if (oidcCfg !== null) {
    const introspect = await createOauth4webapiIntrospect({
      issuer: oidcCfg.issuer,
      clientId: oidcCfg.clientId,
      clientSecret: oidcCfg.clientSecret,
    });
    authVerifier = new OidcAuthVerifier({ introspect });
    oidcDiscovery = oidcCfg.oidcDiscovery;
  }
  ```
  run-mcp-server.ts:207-215:
  ```ts
  let oidc;
  if (oidcCfg !== null && (mode === 'oidc' || mode === 'both')) {
    const introspect = await createOauth4webapiIntrospect({
      issuer: oidcCfg.issuer,
      clientId: oidcCfg.clientId,
      clientSecret: oidcCfg.clientSecret,
    });
    oidc = new OidcAuthVerifier({ introspect });
  }
  ```

- **Recommended action:** Add a `buildOidcVerifier(cfg: ResolvedOidcConfig): Promise<OidcAuthVerifier>` helper to `oidc-cli-resolver.ts` (or a sibling) returning the OidcAuthVerifier. Both runners call the helper. Keeps the wiring single-source per Inquebrável Rule 12 (DRY for true duplication of business logic — the {issuer, clientId, clientSecret} pass-through IS the same logic).


### F-arch-4: Two `as unknown as Parameters<typeof X>[N]` bridges (lines 106 + 130) escape the type system to compose oauth4webapi's symbol-keyed options literal. The bridge is documented + justified (oauth4webapi types use exactOptionalPropertyTypes-incompatible `?:` on symbol keys) but the comment is misleading: the literal shape `{ [customFetch]: fetchImpl }` IS structurally compatible with `DiscoveryRequestOptions` — the issue is purely the literal-narrow vs `?:` interaction. A typed factory `function makeOpts(fetchImpl?, allowInsecure?): DiscoveryRequestOptions { ... }` whose return type is the upstream type would compile without the `as unknown` escape. Architecture.md § 7 says: "If you must escape the type system, use `unknown` with a runtime assertion." The unknown casts here have NO runtime assertion — they're pure type-system bypass.


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-architecture
- **File:** `src/server/auth/oidc-introspect-oauth4webapi.ts` line 106
- **Plan reference:** Plan T2.2 + commit 972ff8d (typecheck-fix)
- **Evidence:**

  src/server/auth/oidc-introspect-oauth4webapi.ts:99-106
  ```ts
  const requestOptionsBase = {
    ...(fetchImpl !== undefined ? { [customFetch]: fetchImpl } : {}),
    ...(opts.allowInsecure === true ? { [allowInsecureRequests]: true } : {}),
  } as unknown as Parameters<typeof discoveryRequest>[1];
  ```
  and lines 127-130:
  ```ts
  const introOpts = {
    ...requestOptionsBase,
    signal,
  } as unknown as Parameters<typeof introspectionRequest>[4];
  ```

- **Recommended action:** Wrap the options-build in a typed factory whose return type is the upstream `DiscoveryRequestOptions` / `IntrospectionRequestOptions`. If the upstream types genuinely cannot be satisfied via spread (TS literal-narrow + exactOptionalPropertyTypes), document why a typed cast (`as DiscoveryRequestOptions` without `unknown` bridge) is rejected — the current comment claims runtime contract authority but architecture.md requires a runtime assertion to justify any `unknown` escape.


### F-arch-5: `serve()` return is bridged via `as unknown as HttpListener` — same anti-pattern as F-arch-4. The local `HttpListener` interface (lines 98-102) is a minimal shape declaration; bridging through `unknown` rather than typing the `serve()` import correctly perpetuates type-system bypass. Both bridges are tactical workarounds for upstream type imperfections — not architectural defects on their own, but accumulate as the project ages.


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-architecture
- **File:** `src/agent-tools/run-server.ts` line 224
- **Plan reference:** Plan T1.1+T3.2 (composition root coupling)
- **Evidence:**

  src/agent-tools/run-server.ts:98-102, 222-224
  ```ts
  interface HttpListener {
    close: (cb?: (err?: Error) => void) => void;
    on?: (event: string, cb: (err: Error) => void) => void;
  }
  ...
  const listener = serve({ fetch: app.fetch, port, hostname: host }, (info: { port: number }) => {
    process.stdout.write(`themory server: listening on ${host}:${String(info.port)}\n`);
  }) as unknown as HttpListener;
  ```

- **Recommended action:** Either (a) declare `HttpListener` as a structural type derived from `ReturnType<typeof serve>` so the cast becomes a narrowing assertion, or (b) accept the upstream `@hono/node-server` return type directly — the local `HttpListener` shape is exactly what `serve` returns. The `unknown` cast hides a maintenance landmine if `serve`'s signature ever changes.


### F-dom-api-4: Two `as unknown as Parameters<typeof discoveryRequest>[1]` (L106) and
`as unknown as Parameters<typeof introspectionRequest>[4]` (L130) cast escapes
bridge the `customFetch` / `allowInsecureRequests` symbol-keyed option shape.
The cast is a known oauth4webapi-API limitation (symbol-keyed properties under
`exactOptionalPropertyTypes` reject `undefined`), and the JSDoc at L100-102
acknowledges it ("bridge via `unknown` cast since the runtime contract is set
by oauth4webapi, not our type — Inquebrável Rule 9 — don't reinvent symbol-keyed
types"). However, the cast SHALL include a runtime assertion per architecture.md
§7 ('use `unknown` with a runtime assertion'). Today it's pure type widening
with no runtime guard — if oauth4webapi changes the option shape in a future
version, the cast silently compiles and the runtime behavior diverges.


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-domain-api-design
- **File:** `src/server/auth/oidc-introspect-oauth4webapi.ts` line 103-106, 127-130
- **Plan reference:** Plan § T2.2 Acceptance Criteria 'Zero use of `any` in adapter source'
- **Domain anchor:** architecture.md § 7 Module hygiene — 'TypeScript strict mode. No `any`. If you must escape the type system, use `unknown` with a runtime assertion.'
- **Evidence:**

  ```ts
  // L103-106:
  const requestOptionsBase = {
    ...(fetchImpl !== undefined ? { [customFetch]: fetchImpl } : {}),
    ...(opts.allowInsecure === true ? { [allowInsecureRequests]: true } : {}),
  } as unknown as Parameters<typeof discoveryRequest>[1];
  ```
  No runtime check that the option object is well-formed beyond what oauth4webapi
  will eventually do internally.

- **Recommended action:** Either (a) document the architecture.md §7 deferral with an inline
`// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ADR D2 §X`
pointing at an ADR row that documents the cast as an intentional bridge, OR
(b) wrap the cast in a thin assertion `assertOauth4webapiOptions(obj)` that
verifies the option keys are EITHER the two known symbols OR absent. Option
(b) is over-engineering for a 2-symbol surface; (a) is the pragmatic path.


### F-dom-api-5: `allowInsecure?: boolean` option (L77) is documented "INTEGRATION-TEST-ONLY"
but the contract is unenforced. A misconfigured production deployment that
passes `allowInsecure: true` (perhaps copied from a test fixture) silently
downgrades to HTTP discovery + introspection — RFC 8414 §2 violation. There
is no runtime guard that rejects `allowInsecure: true` when `process.env.NODE_ENV
=== 'production'` OR when `issuer.startsWith('https://')`. The JSDoc warning
is the only barrier.


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-domain-api-design
- **File:** `src/server/auth/oidc-introspect-oauth4webapi.ts` line 70-77
- **Plan reference:** ADR D2 (security-by-default for production deployments)
- **Domain anchor:** RFC 8414 §2 — OAuth 2.0 Authorization Server Metadata MUST be served over HTTPS
- **Evidence:**

  ```ts
  // L70-77:
  readonly allowInsecure?: boolean;
  ```
  No `if (opts.allowInsecure === true && process.env.NODE_ENV === 'production')
  throw new Error(...)` guard.

- **Recommended action:** Add a defense-in-depth guard:
  if (opts.allowInsecure === true && opts.issuer.startsWith('https://')) {
    throw new Error('createOauth4webapiIntrospect: allowInsecure has no effect on https:// issuer; remove the option or use http:// issuer (integration-test only).');
  }
  if (opts.allowInsecure === true && process.env['NODE_ENV'] === 'production') {
    throw new Error('createOauth4webapiIntrospect: allowInsecure forbidden in production (NODE_ENV=production).');
  }
Both guards fail-loud at construction. Sentinel test added to the existing
`oidc-introspect-oauth4webapi.test.ts` file.


### F-dom-api-6: Test fixture `BOOTSTRAP_TOKEN = 'bootstrap-secret-' + 'x'.repeat(32)` produces
a 48-char low-entropy string that does not match the documented operator
recommendation (`openssl rand -base64 32` → 43-char `[A-Za-z0-9+/=]` set).
For RED-test backward-compat sentinels the value is fine (length-check only
enforces non-empty post-trim), but if any future fuzzer test pivots on a
production-realistic token shape it'll need to seed off the documented format.
Recommend aligning the test fixture with the documented recommendation so the
"what a real bootstrap token looks like" pattern lives in one place (the test).


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-domain-api-design
- **File:** `src/server/__tests__/admin-wiring.test.ts` line 65
- **Plan reference:** ADR D4 § EC-12 DOCUMENT (token char policy) — 'env-controlled tokens are opaque bytes... Minimum 32 chars enforced softly via documentation'
- **Domain anchor:** Plan § EC-12 absorption — `openssl rand -base64 32` recommended
- **Evidence:**

  ```ts
  // src/server/__tests__/admin-wiring.test.ts L65:
  const BOOTSTRAP_TOKEN = 'bootstrap-secret-' + 'x'.repeat(32);
  ```

- **Recommended action:** Replace with a fixture that mirrors the documented recommendation:
  // Mirrors operator recommendation in README: openssl rand -base64 32
  const BOOTSTRAP_TOKEN = 'rTbN1zXqW7eY9aP3vKsM4dCf5gH2jL6oQ0uV8iJ7tBnA=';
Add a one-line comment citing the ADR D4 source. Strict scope of this change:
test fixture only; no production code path changes.



## INFO findings (9)

### F-arch-6: File grew from 162 → 247 LoC (+85 lines for admin wiring + AdminApiOptions interface + EC-1 pool guard + EC-7 ordering comment). Still well under architecture.md § 7 "≤ 500 LoC per file" budget. T2.1 acceptance criteria: "Adapter file ≤ 200 LoC" — applies only to the OIDC adapter (141 LoC, PASSES).


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-architecture
- **File:** `src/server/app.ts` line 247
- **Plan reference:** Plan T1.2 (LoC budget per architecture.md § 7)
- **Evidence:**

  $ wc -l src/server/app.ts src/server/auth/oidc-introspect-oauth4webapi.ts src/agent-tools/oidc-cli-resolver.ts src/agent-tools/run-server.ts src/agent-tools/run-mcp-server.ts
    247 src/server/app.ts
    141 src/server/auth/oidc-introspect-oauth4webapi.ts
    121 src/agent-tools/oidc-cli-resolver.ts
    272 src/agent-tools/run-server.ts
    221 src/agent-tools/run-mcp-server.ts
  All files within budget; no SRP red flags from sheer size.

- **Recommended action:** No action required. Re-evaluate at v0.5 if admin sub-app grows additional handlers (5 more would push near 350 LoC and warrant extracting `createAdminApp(adminApi): Hono` helper to keep `createApp` focused on the 4-verb surface).


### F-arch-7: EC-2 defense-in-depth change to `scope-verifier.ts:92` correctly extended `opts.bootstrapToken.length > 0` → `opts.bootstrapToken.trim().length > 0`. Defense-in-depth is the intended pattern (CLI resolver normalizes at one layer; the middleware also guards at its layer). Minimal blast radius; correct DRY application (the normalization logic is NOT centralized — both layers honestly trim independently, which is correct for defense-in-depth).


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-architecture
- **File:** `src/server/auth/scope-verifier.ts` line 92
- **Plan reference:** Plan T3.2 EC-2 absorption (defense-in-depth)
- **Evidence:**

  src/server/auth/scope-verifier.ts:86-97
  ```ts
  // Bootstrap bypass (D7) — exact-match against the env-sourced token.
  // EC-2 absorption (fixes-cycle-1): post-trim length-check defends against
  // `export THEMORY_ADMIN_BOOTSTRAP_TOKEN="   "` whitespace-only env. The
  // CLI resolver normalizes empty/whitespace to undefined; this is defense-
  // in-depth at the middleware layer (any caller bypassing the CLI resolver
  // still gets the no-bypass guarantee).
  if (opts.bootstrapToken && opts.bootstrapToken.trim().length > 0) {
    if (constantTimeEqual(token, opts.bootstrapToken)) {
      await next();
      return;
    }
  }
  ```

- **Recommended action:** No action. EC-2 absorbed at two layers per the plan. Sentinel test 5 in oidc-cli-resolver.test.ts asserts the normalization at the resolver; defense-in-depth at the middleware is honest belt-and-suspenders.


### F-arch-8: `allowInsecure` option is correctly gated for integration tests only. JSDoc explicitly warns "Production deployments MUST NEVER set this". The option enables the EC-3-absorbed e2e scenario 4 against the local `node:http` stub. Acceptable design: explicit opt-in test-only flag is preferable to test-mode global state. Comment quality is high.


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-architecture
- **File:** `src/server/auth/oidc-introspect-oauth4webapi.ts` line 77
- **Plan reference:** Plan T4.1 (stub issuer scenario 4)
- **Evidence:**

  src/server/auth/oidc-introspect-oauth4webapi.ts:71-78
  ```ts
  readonly fetchImpl?: typeof fetch;
  /**
   * INTEGRATION-TEST-ONLY: enable when the issuer URL is `http://` (not
   * `https://`) — typically a local stub issuer. Production deployments
   * MUST NEVER set this (oauth4webapi enforces HTTPS-only by RFC 8414 §2).
   * When true, propagates oauth4webapi's `[allowInsecureRequests]` symbol
   * to discovery + introspection requests.
   */
  readonly allowInsecure?: boolean;
  ```

- **Recommended action:** No action. Optional: add a runtime warning when `allowInsecure === true` AND `NODE_ENV === 'production'` to harden against accidental flag flips in prod deploys. Not blocking.


### F-arch-9: `oidc-cli-resolver.ts` cleanly extracts CLI flag/env normalization into a single 121-LoC helper consumed by both run-server.ts and run-mcp-server.ts. SRP-clean: pure flag-vs-env precedence + EC-2/EC-5/EC-6/EC-9 absorption + no I/O. Tested in isolation via `oidc-cli-resolver.test.ts` (8 scenarios). Good extraction; matches the pattern used by `agent-tools-memory.ts` for env-fail boundary.


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-architecture
- **File:** `src/agent-tools/oidc-cli-resolver.ts` line 121
- **Plan reference:** Plan T3.1+T3.2 (helper extraction)
- **Evidence:**

  File header JSDoc enumerates each EC absorption with the corresponding test scenario count.
  No DIP / SOLID red flags. The `LOCALHOST_DERIVATION_HOSTS` and `CANONICAL_SCOPES` constants are correctly UPPER_SNAKE_CASE per architecture.md § 6. ES modules + node: prefix usage clean.

- **Recommended action:** No action. Strong example of SRP-respecting extraction. Future expansion (multi-tenant or per-route scope vocabulary) would naturally fit this module.


### F-arch-10: Integration test uses `@ts-expect-error` to call `listener.close()` on `@hono/node-server`'s return. Same upstream typing imperfection as F-arch-5; `@ts-expect-error` is the test-side workaround. INFO-only because test-side type escapes are less load-bearing than production-side ones, but the same recommendation applies: type the `serve()` return correctly at one place and reuse it.


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-architecture
- **File:** `tests/integration/auth/fixes-cycle-1-e2e.test.ts` line 77
- **Plan reference:** Plan T4.1 (EC-10 cleanup hygiene)
- **Evidence:**

  tests/integration/auth/fixes-cycle-1-e2e.test.ts:70-82 (spawnHonoOnPort)
  ```ts
  async function spawnHonoOnPort(app: Hono | ReturnType<typeof createServer>): Promise<HttpHandle> {
    return new Promise((resolve) => {
      const listener = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info: { port: number }) => {
        resolve({
          port: info.port,
          close: () =>
            new Promise<void>((done) => {
              // @ts-expect-error @hono/node-server returns http.Server-like
              listener.close(() => done());
            }),
        });
      });
    });
  }
  ```

- **Recommended action:** Bundled with F-arch-5: once `HttpListener` interface is properly typed against `ReturnType<typeof serve>` (or `@hono/node-server` exports a structural close-able type), test-side `@ts-expect-error` becomes unnecessary.


### F-arch-11: Test file is structurally clean: 5 BDD-style scenarios (`backward-compat`, `auth gate`, `bootstrap path`, `EC-1`, `EC-7`). Each test has a single assert focus. No paper names. Pool stub correctly returns canned scope rows. Test 5 (EC-7 sentinel) explicitly defends against the middleware-ordering regression — exactly the architecturally load-bearing assertion the plan called for.


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-architecture
- **File:** `src/server/__tests__/admin-wiring.test.ts` line 1
- **Plan reference:** Plan T1.1 (5 RED sentinels)
- **Evidence:**

  `grep -E "\b(Voyager|Mem0|Letta|LangMem|MemGPT|Honcho|Graphiti)\b" src/server/__tests__/admin-wiring.test.ts` → 0 hits. testing.md AAA + BDD patterns satisfied.

- **Recommended action:** No action.


### F-arch-12: `src/server/index.ts` correctly re-exports `AdminApiOptions` alongside `CreateServerOptions`. Public API surface change is minimal and additive — backward-compat preserved per ADR D1. No DIP violation: server module owns its own option type; the runner (composition root) imports it through the public surface, not through a private deep path.


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-architecture
- **File:** `src/server/index.ts` line 11
- **Plan reference:** Plan T1.2 (re-export AdminApiOptions)
- **Evidence:**

  ```ts
  export { createApp as createServer } from './app.js';
  export type { AdminApiOptions, CreateServerOptions } from './app.js';
  ```

- **Recommended action:** No action. Architecture.md § 9 satisfied: "Adding a new public export requires updating: src/index.ts, package.json#exports, the README's 'Planned API contract' section, and a unit test that imports through the public path." — admin-wiring.test.ts imports `{ createServer } from '../index.js'` which exercises the public path. README + package.json#exports check is OUT of architecture-reviewer scope (domain-api-design agent owns this).


### F-arch-13: 5 RED scenarios cleanly defend the adapter contract: (1) discovery-call-count == 1, (2) active=true mapping, (3) active=false mapping, (4) EC-8 abort signal propagation (≤50ms), (5) EC-3 introspection_endpoint guard. Stub fetch uses the upstream `customFetch` symbol — correctly avoids inventing a parallel test-only seam. Test 4's 5000ms latency would block CI if abort propagation regressed — strong fail-loud sentinel.


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-architecture
- **File:** `src/server/auth/__tests__/oidc-introspect-oauth4webapi.test.ts` line 88
- **Plan reference:** Plan T2.1 (5 RED sentinels)
- **Evidence:**

  Test 4 asserts elapsed < 50ms (line 161) against an introspection that would otherwise block 5000ms. Strong regression sentinel.
  Test 5 asserts the EC-3 error message contains either "introspection_endpoint" or "RFC 7662" (line 180) — both required phrases per ADR D2 fail-loud contract.

- **Recommended action:** No action.


### F-dom-api-7: Admin routes are NOT registered into the OpenAPI registry (no
`app.openapi(route, handler)` calls; the 5 admin routes use plain
`app.post/get/delete` from Hono, bypassing `@hono/zod-openapi`). The
OpenAPI spec served at `/v1/openapi.json` therefore does NOT advertise
`/v1/admin/keys/*`. Codegen tools (openapi-generator, Postman import,
Swagger UI) cannot discover the admin surface from the spec — operators
must read source or CLI `--help` instead. This is consistent with the
4-verb surface being the canonical OpenAPI-described public API and
the admin surface being an operator/CLI tool, but worth documenting
explicitly.


- **Found by:** review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-domain-api-design
- **File:** `src/server/app.ts` line 199-227
- **Plan reference:** ADR D1 — Admin sub-app composition via opt-in
- **Domain anchor:** RFC 7807 Problem Details for HTTP APIs — endpoint discovery via OpenAPI
- **Evidence:**

  ```ts
  // L209-226 — admin routes use plain Hono (no app.openapi):
  app.post('/v1/admin/keys', (c) => createKeyHandler(...));
  app.get('/v1/admin/keys/list', ...);
  // vs the 4 verbs at L233-236 still using plain app.post too
  // and registerAllPaths(app.openAPIRegistry) at L131 covering only the 4 verbs
  ```

- **Recommended action:** Either (a) extend `registerAllPaths` to register the 5 admin routes with
their zod schemas (largest scope; full OpenAPI surface), OR (b) document
in `src/server/openapi-registration.ts` JSDoc that admin routes are
deliberately undocumented in OpenAPI and reference the CLI as the canonical
operator surface (scope: one comment). Option (b) is the pragmatic close
for this fix-cycle; option (a) is a follow-up if a Swagger-UI based admin
console is ever desired.



## Handoff decision

Implementation passes all gates. Ready for merge.

## Audit trail

Spawned agents (their findings files live alongside this report):

- `.claude/agents/review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-2026-06-07/review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-architecture.md`
- `.claude/agents/review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-2026-06-07/cross-validation.md`
- `.claude/agents/review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-2026-06-07/review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-domain-api-design.md`
- `.claude/agents/review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-2026-06-07/domain-cli-tooling.md`
- `.claude/agents/review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-2026-06-07/tests.md`
- `.claude/agents/review-theo-memory-faang-auth-lifecycle-fixes-cycle-1-2026-06-07/wiring.md`
