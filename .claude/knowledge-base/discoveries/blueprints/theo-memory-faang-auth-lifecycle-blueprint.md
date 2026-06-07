# Blueprint: FAANG-OSS auth/token lifecycle parity for `@usetheo/memory/server`

> **Version 1.0** — Synthesizes WebSearch + WebFetch + github-source-read investigation of 8 FAANG-shape OSS-first projects (Stripe / Supabase / PostHog / Cal.com / Plausible / GitHub / Ory Hydra / Auth0) + 4 IETF RFCs (6749, 7662, 8693, 9449) + the MCP spec, against the 8 research questions defined in the source plan v1.1. Produces a verdict matrix (ADOPT / CONCEPTUAL_BORROW / REJECT per candidate per question per Inquebrável Rule 9) sufficient to ground the implementation plan that follows. Camada 4 (TheoCloud audit + rate-limit + secret-scanning partnership) is reference-only — its implementation belongs to the cloud repo per source plan ADR D4-expanded.

**Slug:** `theo-memory-faang-auth-lifecycle`
**Source plan:** `.claude/knowledge-base/discoveries/plans/theo-memory-faang-auth-lifecycle-plan.md` (v1.1)
**Owner:** PRIORITY 0 hardening — SDK sub-goal 2 + MCP sub-goal 3
**Generated:** 2026-06-07 via `/discover-execute`
**Confidence verdict:** {to be set by `/discover-confidence`}

## Context

(See source plan § Context for full motivation.) Three signals triggered this discovery: (1) `@usetheo/memory/server` ships single-secret env-var auth, blocking OSS multi-user lifecycle parity with PostHog/Supabase/Cal.com OSS standards; (2) ADR-0009 deferred OAuth/OIDC to v1.x — that deferral is now load-bearing for enterprise SSO ask; (3) empirical 2026-06-07 dashboard validation confirmed `RequireScope` middleware rejects Hydra OAuth2 tokens (literal error string), so OSS path has no story at all.

## Objective

Decide which patterns to ADOPT vs CONCEPTUAL_BORROW vs REJECT for Camada 2 (OSS multi-user lifecycle in `@usetheo/memory/server`) and Camada 3 (OIDC bridge as opt-in middleware mode), and document Camada 4 reference patterns for the follow-up cloud-repo plan.

---

## Coverage Corner 4 — Techniques

Three research questions in this corner per source plan v1.1: Q1 (token model), Q2 (scope vocabulary), Q4 (OIDC bridge).

### Q1 — Token format + show-once UX

**Per-candidate comparison:**

| Candidate | Prefix discipline | Hash-at-rest (public claim) | Show-once UX | Source |
|---|---|---|---|---|
| **Stripe** | `sk_live_` / `sk_test_` (secret), `sk_org_` (org), `rk_live_` (restricted), `pk_live_` (publishable) | Not publicly described; model is "we don't recover lost keys" — implies server-side hash + opaque storage | **YES** — "we display it once before you save it. Copy the key before saving it because you can't reveal it later. In live mode, you can reveal only API keys that we create for you" ([docs.stripe.com/keys](https://docs.stripe.com/keys)) | [docs.stripe.com/keys](https://docs.stripe.com/keys), [docs.stripe.com/keys-best-practices](https://docs.stripe.com/keys-best-practices) |
| **Supabase** | NEW: `sb_publishable_<random>_<checksum>` (public) + `sb_secret_<random>_<checksum>` (server); LEGACY: `eyJ...` (JWT signed by anon/service_role secret) | Opaque format with checksum not gateway-validated in self-host; JWT validated by signing key | Implicit (env-var workflow at first dashboard reveal); legacy JWT deprecation Q4 2026 | [supabase.com/docs/guides/getting-started/api-keys](https://supabase.com/docs/guides/getting-started/api-keys), [supabase.com/docs/guides/self-hosting/self-hosted-auth-keys](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys) |
| **PostHog** | `phx_` (personal API key), `phs_` (feature-flag secure), `pha_` (OAuth access), `phr_` (OAuth refresh) — **prefix discipline by token PURPOSE, not just origin** | Not publicly described; partner-scanning auto-revoke flow ("`phx_` rolls automatically if leaked, with user notified via email") | **YES** — "save the value as it is only shown once, and you must create a new key if you lose it" | [posthog.com/docs/api](https://posthog.com/docs/api) |
| **theo-cloud baseline** (`routes/api_keys.go`) | `theo_live_` + base64url(32) = 47 chars (Stripe-shape) | **SHA-256 single-pass** (per ADR D4 of plan 2026-06-06-platform-api-keys-with-scopes-plan; 256-bit entropy makes bcrypt unnecessary) | **YES** with EC-13 acknowledgement gate — "I've copied my key safely" checkbox MUST be ticked before "Done" button enables (validated end-to-end this session) | local: `/home/paulo/Projetos/usetheo/theo-cloud/theo/cloud/internal/routes/api_keys.go:267-382` (cloud repo) |

**Synthesis:** theo's existing `theo_live_*` prefix + SHA-256 hash + EC-13 show-once gate is ALIGNED with all 3 FAANG candidates. The pattern is canonical. PostHog's purpose-prefix model (`phx_` vs `phs_` vs `pha_`/`phr_`) is an interesting future enhancement if/when TheMemory ships OAuth tokens distinct from API keys (Camada 3 territory — see Q4) — currently out of scope.

**Camada 2 Verdict:** **ADOPT** the theo-cloud pattern unchanged in `@usetheo/memory/server`. Port the existing `routes/api_keys.go` lifecycle (List + Create + Revoke + Rotate + Lineage + show-once secret reveal) verbatim, adapting Go → TypeScript. The fact that theo-cloud already matches FAANG canonical means no design re-litigation; just translate the shape.

### Q2 — Scope vocabulary (GitHub PAT classic vs fine-grained + Stripe + Auth0)

**Granularity-tradeoff comparison:**

| Vocabulary model | Example | Granularity shape | Key trade-off | Source |
|---|---|---|---|---|
| **GitHub PAT classic** | `repo`, `admin:org`, `read:org`, `gist`, `public_repo`, `user:email` | **Broad role-shape** — `repo` grants full read+write on every repo the user can access; scope normalization implicit (`user:email` collapses into `user`) | Easy to over-grant; "GitHub recommends that you use fine-grained personal access tokens instead of personal access tokens (classic) whenever possible" — GitHub's own narrative deprecates this model | [docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps), [docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) |
| **GitHub fine-grained PAT** | `Contents:Read`, `Contents:Write`, `Metadata:Read`, `Administration:Write` | **resource:verb** (most are read-OR-write per resource); `Metadata:Read` is mandatory baseline auto-required by most endpoints; per-repo selectable | More config friction, much smaller blast radius if leaked; GitHub guides discovery via `X-Accepted-GitHub-Permissions` response header | [docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens) |
| **Stripe restricted keys (RAK)** | `Customer:Read`, `Customer:Write`, `Charge:None` | **resource × {None, Read, Write}** with **"Write implies Read"** implicit hierarchy; default for every resource is `None`; "If a restricted API key doesn't have the correct permissions to complete an API request, Stripe returns an invalid request error" | Saves config friction (Write→Read auto-hierarchy); clean three-state vocabulary; no scope-creep from broad roles | [docs.stripe.com/keys/restricted-api-keys](https://docs.stripe.com/keys/restricted-api-keys) |
| **theo current baseline** (`routes/api_keys.go`) | `memory:read`, `memory:write`, `memory:delete`, `memory:admin` (per [ADR-0008 dip-method-counts](.claude/knowledge-base/adrs/ADR-0008-dip-method-counts.md) + cloud impl) | **resource:verb** matching GitHub fine-grained + Stripe RAK shape; 4 explicit verbs, no auto-hierarchy yet | Already FAANG-canonical; minor enhancement candidate: adopt Stripe's "write implies read" hierarchy | local: `/home/paulo/Projetos/usetheo/theo-cloud/theo/cloud/internal/auth/scope.go` (cloud repo) |

**GitHub's own evolution as headline finding:** GitHub explicitly deprecates classic PAT broad-role vocabulary in favor of fine-grained resource:verb. This is empirical industry validation that theo's existing `memory:read/write/delete/admin` shape is on the correct trajectory.

**Camada 2 Verdict:**
- **ADOPT** the existing `memory:read/write/delete/admin` vocabulary unchanged. It's resource:verb (correct shape), 4 explicit verbs (right granularity for v0.1), and matches the FAANG fine-grained convention.
- **CONCEPTUAL_BORROW** from Stripe: implement "Write implies Read" implicit hierarchy in the scope-check middleware so a key with `memory:write` automatically passes `memory:read` checks. Saves config friction without changing the public surface. Defer to a follow-up enhancement after Camada 2 ships.
- **REJECT** GitHub PAT classic broad-role pattern. Adding `memory:full` as a sugar-scope would regress toward GitHub's deprecated model. If a "full admin" key is needed, that's `memory:admin` (already in vocabulary).
- **REJECT** over-fragmentation (e.g., `memory:scope:user:read`, `memory:scope:session:write`). The 4-verb granularity matches the public API verbs (remember/recall/forget/reflect) cleanly; finer grain would create scope explosion without proven user demand.

### Q4 — OIDC bridge (dual-mode vs token-exchange)

**The two paths investigated:**

**Path A — Dual-validation middleware (RFC 7662 OAuth Token Introspection).** The Bearer Authorization middleware in `@usetheo/memory/server` becomes a switch on the token prefix:

```text
Authorization: Bearer <token>
  ├─ if token starts with "theo_live_" → SHA-256 hash lookup in theo_api_keys table (existing path)
  └─ else → POST <issuer>/oauth2/introspect { token } → JSON { active, scope, sub, exp, ... }
              ├─ active=true + scope matches required → grant + cache result 60-300s
              └─ active=false OR scope mismatch → 401
```

The introspection contract is RFC 7662 standardized. From the spec: "The introspection endpoint is an OAuth 2.0 endpoint that takes a parameter representing an OAuth 2.0 token and returns a JSON document representing the meta information surrounding the token, including whether this token is currently active. ... Required field — `active`: This is the only mandatory member of the response."

Ory Hydra exposes this at `/oauth2/introspect` on its admin port (port 4445 in our cluster, already deployed). The endpoint requires authentication: "The Token Introspection endpoint requires authentication. But since there is no access control, any valid authentication enables the endpoint to be used. If you need to access this endpoint in production, you should configure your API Gateway or Application Proxy to restrict which clients have access to the endpoint."

Caching strategy per RFC 7662 § 4: "A more aggressive cache with a longer duration will minimize network traffic and load on the introspection endpoint, but at the risk of stale information about the token. ... Highly sensitive environments can opt to disable caching entirely on the protected resource to eliminate the risk of stale cached information entirely, again at the cost of increased network traffic and server load." TheMemory's middleware should default to 60-300s cache with optional disable for high-sensitivity deployments.

**Path B — Token exchange endpoint (RFC 8693).** A separate endpoint at `@usetheo/memory/server` that customers call to convert their OIDC JWT into a native `theo_live_*` key:

```text
POST /v1/auth/exchange
Authorization: Bearer <OIDC-JWT>
{
  "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
  "subject_token": "<OIDC-JWT>",
  "subject_token_type": "urn:ietf:params:oauth:token-type:jwt"
}
→ { "access_token": "theo_live_<...>", "issued_token_type": "...", "expires_in": 3600 }
```

The customer caches the returned `theo_live_*` and uses it for subsequent memory calls. Per RFC 8693: "An OAuth resource server, for example, might assume the role of the client during token exchange in order to trade an access token that it received in a protected resource request for a new token that is appropriate to include in a call to a backend service."

**Trade-off matrix:**

| Aspect | Path A — Dual-validation middleware | Path B — Token exchange (RFC 8693) |
|---|---|---|
| **Complexity to ship** | LOW — single conditional in existing Bearer middleware; reuse Hydra `/oauth2/introspect` admin endpoint | HIGH — new endpoint, new request/response shape, STS-style protocol; additional table for issued exchange tokens |
| **Round trips per memory call** | 1 RT to introspection per non-cached JWT; 0 for `theo_live_*` keys | 0 (customer caches the exchanged token) |
| **Cache trade-off** | Cache introspection 60-300s default; staleness window per RFC 7662 § 4 caveat | Customer holds the exchanged `theo_live_*` for `expires_in`; revocation propagation depends on TTL choice |
| **OIDC issuer requirements** | Issuer must expose RFC 7662 introspection endpoint (Hydra ✓, Keycloak ✓, Auth0 ✓, Okta ✓, Azure AD ✓ — universal) | Issuer must support RFC 8693 token-exchange grant (less universal — Hydra: yes; Keycloak: yes since 17; Auth0: yes; Okta: yes since 2023; Azure AD: partial) |
| **Customer-side complexity** | Zero — Bearer Authorization header continues to carry their OIDC JWT directly | Customer must POST to /v1/auth/exchange BEFORE memory calls and refresh on expiry |
| **Revocation latency** | ≤ cache TTL (60-300s typical) | ≤ exchange-token TTL (typically 1h) |
| **Best fit** | DEFAULT for Camada 3 — minimal addition, universal compatibility | Future enhancement when customers ask for per-call cost optimization |

**Camada 3 Verdict:**
- **ADOPT Path A (dual-validation middleware via RFC 7662 introspection)** for Camada 3. Reasons: (a) minimal architectural addition (1 conditional in existing middleware), (b) Hydra already deployed in our cluster with `/oauth2/introspect` confirmed at port 4445, (c) universal OIDC issuer compatibility, (d) zero customer-side migration friction (Bearer header keeps carrying their JWT).
- **CONCEPTUAL_BORROW Path B (RFC 8693 token exchange)** — document but defer to a v2.x enhancement if/when customers demonstrably need per-call cost optimization. Premature for v1.x.
- **REJECT running an STS ourselves** — TheMemory is a memory primitive, not an identity provider. OSS users plug their own Hydra/Keycloak/Auth0 via the issuer URL configuration; we just validate against it.

**Per source plan D6 + D8 (supersession path conditional on Q4 completion):** Q4 successfully completed both Fase A (3 WebSearches: Hydra docs + RFC 7662 + RFC 8693) AND Fase B (extracted contract surfaces + trade-off matrix), so the conditional is SATISFIED. The implementation plan that follows this blueprint **SHOULD** ship a new ADR — recommended slug `ADR-0013-oidc-bridge-via-introspection.md` (next free ADR number after ADR-0012) — that explicitly supersedes the "OAuth / OIDC deferred to v1.x" row of ADR-0009 with the dual-validation middleware decision. ADR-0009 stays as historical record per `architecture.md` history-preservation rule.

Sources: [www.ory.sh/hydra/docs/v1.6/guides/oauth2-token-introspection](https://www.ory.sh/hydra/docs/v1.6/guides/oauth2-token-introspection/), [www.ory.sh/docs/hydra/sdk/api](https://www.ory.sh/docs/hydra/sdk/api), [www.ory.sh/docs/hydra/production](https://www.ory.sh/docs/hydra/production), [datatracker.ietf.org/doc/html/rfc7662](https://datatracker.ietf.org/doc/html/rfc7662), [www.rfc-editor.org/rfc/rfc7662.html](https://www.rfc-editor.org/rfc/rfc7662.html), [www.rfc-editor.org/rfc/rfc8693.html](https://www.rfc-editor.org/rfc/rfc8693.html).

---

## Coverage Corner 3 — Tools

Three research questions in this corner: Q3 (OSS lifecycle CRUD tooling), Q7 (secret scanning partnership), Q8 (MCP transport auth).

### Q3 — OSS lifecycle CRUD tooling (Supabase / PostHog / Cal.com / Plausible)

**Per-project tooling parity (self-host vs cloud):**

| Project | UI parity in self-host | Storage / prefix shape | Retention/audit on by default | Verdict |
|---|---|---|---|---|
| **Supabase** | **NO** — self-hosted Studio (dashboard) does NOT include built-in UI for Personal Access Token management. "PATs are tied to the hosted Supabase Management API and account system. Self-hosted instances rely on HTTP basic authentication for dashboard access and use environment variables / config files (`.env`, `docker-compose.yml`) for most authentication and service configuration tasks." | Env-var workflow + JWT signing (legacy) / opaque sb_secret_ (new) | Not documented for self-host | **CONCEPTUAL_BORROW (negative)** — Supabase is the FAANG-OSS OUTLIER on this question; self-host parity gap is documented anti-pattern. theo should NOT replicate. Source: [supabase.com/docs/guides/self-hosting/docker](https://supabase.com/docs/guides/self-hosting/docker) |
| **PostHog** | **YES** — same dashboard self-hosted and cloud. Personal API keys in Settings tab. "For self-hosted instances, use your self-hosted domain. Confirm yours by checking your PostHog instance URL." API schema retrievable locally at `http://127.0.0.1:8000/api/schema/redoc/`. | `phx_` prefix + multi-purpose discipline (`phs_`/`pha_`/`phr_` for different token types) | Auto-revoke + email notification via partner-scanning | **ADOPT** — full UI parity is the canonical FAANG-OSS pattern. Source: [posthog.com/docs/api](https://posthog.com/docs/api), [posthog.com/docs/self-host](https://posthog.com/docs/self-host) |
| **Cal.com** | **YES** — Cal.diy (open-source community edition, "intended for users who want to self-host") ships same `/settings/developer/api-keys` UI as cloud. "You can use hosted or self hosted Cal.com — both support workflows and the API." | `cal_live_*` (live) + `cal_*` (test) — **Stripe-shape prefix discipline** identical to theo's `theo_live_*` | Rate limit 120 rpm default (configurable to 800+ via support) | **ADOPT** — full UI parity + Stripe-shape prefix that matches theo's existing pattern. Strongest single reference. Source: [cal.com/docs/api-reference/v2/introduction](https://cal.com/docs/api-reference/v2/introduction), [cal.com/blog/where-is-my-api-key-and-what-can-it-do](https://cal.com/blog/where-is-my-api-key-and-what-can-it-do), [cal.com/docs/self-hosting/guides/organization/organization-setup](https://cal.com/docs/self-hosting/guides/organization/organization-setup) |
| **Plausible** | **YES** — Plausible CE (AGPL-3.0 self-host) ships same Settings → API Keys UI. "The token creation process via the dashboard works the same way as the cloud version — you access Settings → API Keys from your account menu." | Stats API key (Bearer) + Sites Provisioning API key (separate purpose) + Plugin tokens (`plausible-plugin-` prefix) — purpose-discipline like PostHog | "Save the key as it will only be shown once" — show-once UX confirmed | **ADOPT** — full UI parity + show-once gate + purpose-discipline for plugin vs stats vs sites tokens. Source: [plausible.io/docs/sites-api](https://plausible.io/docs/sites-api), [plausible.io/docs/self-hosting](https://plausible.io/docs/self-hosting), [plausible.io/docs/self-hosting-configuration](https://plausible.io/docs/self-hosting-configuration) |

**Synthesis:** 3 of 4 candidates (PostHog + Cal.com + Plausible) ship FULL UI parity between self-host and cloud — they all use the SAME dashboard codebase. Supabase is the documented outlier and its self-host gap is exactly the anti-pattern theo wants to avoid.

**Camada 2 Verdict:**
- **ADOPT the Cal.com pattern as the closest reference:** same Settings → API Keys dashboard route, same Stripe-shape prefix (`cal_live_*` ↔ `theo_live_*`), same lifecycle CRUD. Port the existing theo-cloud `api-keys.tsx` dashboard page into `@usetheo/memory/server`'s admin UI (Camada 2 ships the admin UI as part of the OSS server when `--auth=api-keys` mode is enabled).
- **CONCEPTUAL_BORROW from PostHog:** the API schema self-serve endpoint pattern (`/api/schema/redoc/`) for the OSS server's `/v1/openapi.json` is already canonical in theo (`@usetheo/memory/server` ships `GET /v1/openapi.json` per Roadmap Item 16) — already done.
- **CONCEPTUAL_BORROW from Plausible:** purpose-discipline prefixes if/when we ship plugin/sites-style sub-tokens. Out of scope for Camada 2.
- **REJECT the Supabase split** (cloud-only PAT UI). theo's OSS must ship the same UI as the cloud Dashboard would (when TheoCloud ships). This is the explicit motivation for this discovery — see source plan § Context signal #3.

### Q7 — Secret scanning partner program (GitHub + GitLab)

**GitHub Secret Scanning Partner Program — enrollment procedure (6 steps):**

1. **Initiate contact**: email `secret-scanning@github.com` to start the process.
2. **Identify secrets + write regex**: provide regex pattern(s) for the prefixes you want scanned (e.g., `theo_live_[A-Za-z0-9_-]{43}` for theo's Stripe-shape token). "GitHub recommends you are as precise as possible, because this will help reduce the number of false positives."
3. **Provide test account**: "A test account for your service. This will allow GitHub to generate and analyze examples of the secrets, further reducing false positives."
4. **Stand up webhook endpoint**: "Create a public, internet accessible HTTP endpoint at the URL you provided to GitHub. When a match of your regular expression is found publicly, GitHub will send an HTTP POST message to your endpoint."
5. **Implement signature verification**: "GitHub provides public keys for verifying that webhook payloads originated from GitHub. Partners should fetch the list of GitHub public keys from the endpoint `https://api.github.com/meta/public_keys/secret_scanning` and use the provided key ID and signature headers (such as `kID` and `kSig`) to validate the ECDSA signature against the request body before processing the payload."
6. **Implement secret revocation + user notification**: when a leak is confirmed, revoke the key server-side + email the user.

**Webhook callback payload (canonical):**

```json
[
  {
    "token": "theo_live_xmsSHnduM3qdf9UCrGFdEkWoUpcm0lptD5az_fpR9zo",
    "type": "theo_api_key",
    "url": "https://github.com/octocat/Hello-World/blob/12345600b9cbe38a219f39a9941c9319b600c002/foo/bar.txt",
    "source": "content"
  }
]
```

**Camada-4 revoke handler stub (for the cloud-repo follow-up plan):**

```go
// cloud/internal/routes/scanning_webhook.go (Camada 4 — TheoCloud only)
//
// POST /v1/admin/scanning/github/revoke
// Authenticated via GitHub's ECDSA signature verification (not Bearer).
// Payload per GitHub Secret Scanning Partner Program (Q7 of
// theo-memory-faang-auth-lifecycle blueprint).

func (h *ScanningHandler) GitHubWebhook(w http.ResponseWriter, r *http.Request) {
    // 1. Verify ECDSA signature via api.github.com/meta/public_keys/secret_scanning
    if !verifyGitHubSignature(r) {
        writeError(w, 401, "INVALID_SIGNATURE", "GitHub signature verification failed.")
        return
    }
    // 2. Parse payload; for each token entry, revoke matching theo_api_key + email owner
    var entries []struct{ Token, Type, URL, Source string }
    json.NewDecoder(r.Body).Decode(&entries)
    for _, e := range entries {
        keyHash := sha256.Sum256([]byte(e.Token))
        // soft-delete via D7 invariant from Plan 0 (revoked_at = NOW(), reason = 'leaked')
        h.revokeKeyByHash(hex.EncodeToString(keyHash[:]), "github_scanning_leak", e.URL)
        h.notifyOwner(e.Token, e.URL)
    }
    w.WriteHeader(202) // Accepted
}
```

**GitLab equivalent:** GitLab has a parallel "secret detection partner program" but documentation is less public; coverage is more focused on the SAST integration than third-party partner registration. Out of scope here; document if/when TheoCloud needs GitLab coverage.

**Camada 4 Verdict:** **DOCUMENT for cloud-repo follow-up plan per source plan D4-expanded.** This is NOT a Camada 2 task — the partnership enrollment + webhook endpoint deployment + signature verification + revocation pipeline lives in TheoCloud, where the public DNS + ECDSA infrastructure can be properly hosted. The OSS server (`@usetheo/memory/server`) does not ship this — it's a TheoCloud-only feature.

**Cross-link:** the Camada 4 follow-up plan should reference `cloud/internal/routes/api_keys.go:240` (existing `RevokeKey` handler) — the partner-program revoke pipeline reuses the same soft-delete D7 invariant (per `revoked_at = NOW() WHERE key_hash = $1 AND revoked_at IS NULL`).

Sources: [docs.github.com/en/code-security/secret-scanning/secret-scanning-partnership-program/secret-scanning-partner-program](https://docs.github.com/en/code-security/secret-scanning/secret-scanning-partnership-program/secret-scanning-partner-program), [docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning-for-partners](https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning-for-partners), [docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns](https://docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns).

### Q8 — MCP streamable-HTTP transport auth

**MCP Authentication Spec status (as of 2026-06):**

The MCP transport layer "defines the communication mechanisms and channels that enable data exchange between clients and servers, including transport-specific connection establishment, message framing, and authorization. MCP recommends using OAuth to obtain authentication tokens."

Two transport profiles with DIFFERENT auth requirements:

| Transport | Use case | Auth required? | Pattern |
|---|---|---|---|
| **stdio** | Local single-client (e.g., Claude Code / Cursor / Codex spawning MCP server as subprocess) | NO | Scope binding via env vars (theo's existing `cli-scope.ts` pattern; no network = no Bearer) |
| **streamable-HTTP** | Remote multi-client (e.g., hosted MCP server serving many agents) | **YES — mandatory** | OAuth 2.0/2.1 per MCP Authentication Specification |

For streamable-HTTP, the spec mandates: "secure authentication is mandatory. Implementations should follow the MCP Authentication Specification, which is based on OAuth 2.0/2.1. This includes using secure flows like Authorization Code with PKCE, supporting dynamic client registration where applicable, enforcing scope checks based on user consent, and integrating with trusted third-party identity providers (e.g., Auth0, Okta)."

Plus the network-hygiene mandates: "All HTTP-based communication MUST use HTTPS to ensure confidentiality and integrity, with proper TLS certificates configured. Origin headers should be strictly validated using an allowlist, CORS headers configured correctly, and servers intended only for local access should bind to 127.0.0.1 (localhost) to mitigate DNS rebinding attacks."

**Python SDK implementation pattern:** "`mcp.server.auth` implements OAuth 2.1 resource server functionality, where MCP servers act as Resource Servers (RS) that validate tokens issued by separate Authorization Servers (AS). This follows the MCP authorization specification and implements RFC 9728 (Protected Resource Metadata) for AS discovery."

**Bearer token + WWW-Authenticate challenge pattern:** "Unauthorized requests return HTTP/1.1 401 with a WWW-Authenticate: Bearer header pointing to resource_metadata at /.well-known/oauth-protected-resource, where the metadata response includes resource, resource_name, authorization_servers, scopes_supported, and bearer_methods_supported fields."

**Long-Lived Access Token (LLAT) opt-in path:** "OAuth 2.0 (default) required for browser-based clients like Claude (requiring an OIDC server to be installed and configured), and Long-Lived Access Tokens (opt-in) for local agents and custom MCP clients that can't run an OAuth browser flow. Both methods can be used at the same time, with the server trying OAuth first and falling back to the Long-Lived Access Token." — **This LLAT pattern is exactly the `theo_live_*` shape**; theo's API keys ARE long-lived access tokens.

**Camada 3 + sub-goal 3 verdict — MCP streamable-HTTP for theo:**

| Decision | Rationale |
|---|---|
| **stdio transport: UNCHANGED** | theo's existing `themory mcp --transport stdio` is already canonical (scope-binding via env vars, no Bearer). No change. |
| **streamable-HTTP transport: ADD Bearer middleware** | Reuse the SAME dual-validation middleware decided in Q4 (Path A: `theo_live_*` SHA-256 lookup OR OIDC JWT introspection via Hydra). The MCP spec calls this exact pattern "OAuth (default) + LLAT (opt-in) both methods coexist" — theo gets both for free by sharing the Camada 3 middleware. |
| **HTTPS enforcement when non-localhost** | `themory mcp --transport streamable-http --host <non-127.0.0.1>` MUST require TLS cert config (refuse-to-start without it) per the MCP spec. Localhost bind exemption documented. |
| **WWW-Authenticate challenge on 401** | Adopt the spec's `WWW-Authenticate: Bearer realm="...", resource_metadata="/.well-known/oauth-protected-resource"` pattern + ship the well-known endpoint listing the AS URL (whatever the operator configured) + supported scopes. |
| **Dynamic Client Registration (RFC 7591)** | **DEFER** to v2.x. DCR is a complexity multiplier ("enabling it becomes a security risk because the endpoint is public and can be abused by flooding with unwanted client registrations"). Use static client registration in `themory mcp` config at v1.x. |

**Code touchpoint:** `src/agent-tools/server.ts` (TheMemory's MCP server wrapper) already has `start(transport: Transport)` that accepts either stdio OR streamable-HTTP. Camada 3 adds a `withBearerAuth(server, { dualValidate })` wrapper that takes the existing `MemoryServer` and wraps the streamable-HTTP transport with the same middleware from Q4 — minimal architectural addition, fully aligned with both the MCP spec AND Camada 3 design.

**Camada 3 + Sub-goal 3 (MCP available + reliable) verdict:** **ADOPT** the MCP Authentication Specification verbatim for streamable-HTTP. **REUSE** the Camada 3 dual-validation middleware (Q4 verdict) — this aligns the two work items into a single shared implementation rather than duplicating Bearer logic across MCP and REST API surfaces.

Sources: [modelcontextprotocol.io/docs/learn/architecture](https://modelcontextprotocol.io/docs/learn/architecture), [github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk), [github.com/modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk), [github.com/cyanheads/model-context-protocol-resources](https://github.com/cyanheads/model-context-protocol-resources/blob/main/guides/mcp-server-development-guide.md), local: `src/agent-tools/server.ts`, `src/agent-tools/cli-scope.ts`.

---

## Coverage Corner 2 — Dependencies

One research question in this corner: Q5 (npm dep picks for JWKS/OIDC/DPoP libs).

### Q5 — npm dep picks (jose / @panva/oauth4webapi / hono-jwt / DPoP libs)

**Per-lib evaluation (Rule 9 lens):**

| Lib | Maintainer | Purpose | License | Notable | Verdict |
|---|---|---|---|---|---|
| **jose** | panva | JWA/JWS/JWE/JWT/**JWK/JWKS** primitives for Node.js, browsers, Cloudflare Workers, Deno, Bun | MIT | **Zero dependencies**, tree-shakeable ESM. Canonical pattern: `jose.createRemoteJWKSet(new URL(jwks_uri))` + `jose.jwtVerify(jwt, JWKS, { issuer, audience, algorithms })` | **ADOPT** as the underlying JWKS-validation primitive for Camada 3 |
| **oauth4webapi** | panva (same author as jose) | Low-level OAuth 2 / OpenID Connect Client; supports RFC 7662 introspection via `processIntrospectionResponse` + RFC 9701 JWT-signed introspection | MIT, v3.8.6 (June 2026), **no dependencies**, tree-shakeable ESM | **OpenID-certified** Basic + FAPI 1.0 + FAPI 2.0 RP conformance profiles. Validated as the foundation for `@hono/oidc-auth` (third-party Hono middleware uses oauth4webapi internally) | **ADOPT** as the Camada 3 OIDC introspection client per Q4 Path A |
| **hono/bearer-auth** (built-in) | Hono core team | Bearer token check (`Authorization: Bearer <token>`); options: `token` / `verifyToken` / `prefix` / `headerName` / `hashFunction` | MIT (Hono license) | Throws `HTTPException` 401 for missing/invalid token; returns `WWW-Authenticate` challenge header | **ADOPT** as the foundation — wraps the dual-validation middleware (`theo_live_*` SHA-256 lookup OR JWT introspection per Q4) |
| **hono/jwt** + **hono/jwk** (built-in) | Hono core team | JWT verification middleware + JWKS-endpoint-fetching variant | MIT | **⚠ CRITICAL 2026-01-13 SECURITY ADVISORIES**: [GHSA-3vhc-576x-3qv4](https://github.com/honojs/hono/security/advisories/GHSA-3vhc-576x-3qv4) (JWK middleware alg confusion via untrusted header.alg fallback) + [GHSA-f67f-6cw9-8mq4](https://github.com/honojs/hono/security/advisories/GHSA-f67f-6cw9-8mq4) (JWT middleware unsafe HS256 default allows token forgery + auth bypass). Fixed in `hono@4.11.4`. Both require explicit `alg: ['RS256']` allowlist; HS* algos no longer accepted in jwk middleware | **ADOPT WITH CRITICAL CAVEATS** — pin `hono >= 4.11.4` + always explicitly set `alg` with asymmetric-only allowlist |
| **@hono/oidc-auth** | Hono third-party (community) | OIDC auth middleware depending on `oauth4webapi`; storage-less login sessions; JWT-signed session cookies | MIT | Validates that oauth4webapi is the canonical foundation in the Hono ecosystem | **CONCEPTUAL_BORROW** — confirms the oauth4webapi adoption; we can wire the dual-validation middleware ourselves using oauth4webapi directly without adding another middleware abstraction |
| `express-jwt` | Auth0 (legacy) | JWT middleware for Express | MIT | **REJECT** — wrong framework (TheMemory uses Hono per architecture.md) |
| DPoP libraries (RFC 9449) | Various small libs | Demonstrating Proof-of-Possession binding | Mixed | DPoP is Camada 4 enterprise tier per source plan D4 | **DEFER** to Camada 4; revisit when enterprise tier demands token-bound credentials |

**Camada 3 dependency stack (final):**

```jsonc
// package.json additions for @usetheo/memory/server (Camada 3 OIDC bridge mode)
{
  "dependencies": {
    "jose": "^5.x",              // JWKS primitives (zero deps)
    "oauth4webapi": "^3.8.6",    // OIDC introspection client (zero deps; OpenID-certified)
    "hono": ">=4.11.4"           // CRITICAL: pin >=4.11.4 for the 2026-01-13 CVE fixes
  }
}
```

Per `deps-audit-golden-rule.md`: each lib has been Rule-9-evaluated; the rejected alternative (`express-jwt`) is documented; no CVE risks remain (Hono CVE addressed by version pin). Total transitive surface: very small (jose and oauth4webapi both ship zero deps; Hono's deps are already in our stack via `@usetheo/memory/server`).

**Inviolable**: the `alg` option MUST be explicitly specified with asymmetric-only allowlist (RS256, ES256, EdDSA) on EVERY `hono/jwk` invocation. Implementation plan MUST include an assertion test (`alg must be present + asymmetric-only`) per the CVE mitigation.

Sources: [npmjs.com/package/jose](https://www.npmjs.com/package/jose), [github.com/panva/jose](https://github.com/panva/jose), [npmjs.com/package/oauth4webapi](https://www.npmjs.com/package/oauth4webapi), [github.com/panva/oauth4webapi](https://github.com/panva/oauth4webapi), [github.com/honojs/hono/security/advisories/GHSA-3vhc-576x-3qv4](https://github.com/honojs/hono/security/advisories/GHSA-3vhc-576x-3qv4), [github.com/honojs/hono/security/advisories/GHSA-f67f-6cw9-8mq4](https://github.com/honojs/hono/security/advisories/GHSA-f67f-6cw9-8mq4), [github.com/honojs/hono/blob/main/src/middleware/bearer-auth/index.ts](https://github.com/honojs/hono/blob/main/src/middleware/bearer-auth/index.ts), [npmjs.com/package/@hono/oidc-auth](https://www.npmjs.com/package/@hono/oidc-auth).

---

## Coverage Corner 1 — Integration Tests

One research question in this corner: Q6 (Supabase auth rotation test patterns).

### Q6 — Supabase auth (formerly GoTrue) rotation/grace test patterns

**7 patterns extracted from Supabase auth test ecosystem:**

| # | Pattern | Description | Applicability to theo |
|---|---|---|---|
| 1 | **Real GoTrue + Postgres via docker-compose** | "The library is tested against a real GoTrue server running in a docker image. This also requires a postgres server to back it. These are configured using docker compose." | **DIRECT MATCH** — theo already does this with `ankane/pgvector:v0.5.1` via testcontainers. Same pattern. |
| 2 | **Short JWT expiry for fast tests** | "JWT expiration is set to 120 seconds (two minutes for easy testing). Setting a low JWT TTL lets you actually observe refresh cycles within an integration test run without long waits." | **ADOPT** — for Camada 2 rotation tests, set `expires_at = NOW() + interval '90 seconds'` so the grace-window expiry happens within the test run |
| 3 | **Refresh-token rotation env config** | `GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED` + `GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL` — distinguishes legitimate-concurrent-reuse from malicious-replay | **CONCEPTUAL** — theo rotation already has grace-window semantic (24h default per `RotateKey`); no env knob needed at v1.x. Pattern informs the EDGE CASE detection logic if/when we add reuse-interval. |
| 4 | **Refresh lifecycle assertions** | "About 60 seconds before the token expires, the refresh token handler is invoked and a new access token is generated. The old refresh token is revoked... and a new token is added with a reference to the old (parent)." | **DIRECT MATCH** — theo's `RotateKey` has `rotated_from` parent reference. Test the lineage chain explicitly. |
| 5 | **Multi-session revocation edge case** | "login using two browsers... logout from one and see what happens to the other session. Refresh fails with `{ "error": "invalid_grant", "error_description": "Invalid Refresh Token" }`" | **ADOPT** — for theo, simulate "key A rotated to key B → continue using key A within grace window → wait past grace → assert A returns 401 `INVALID_API_KEY`". |
| 6 | **Direct token grant for test fixtures** | Bypass UI flow with `password` grant: `client.Token({ GrantType: "password", Email, Password })` — get test access token without UI | **DIRECT MATCH** — for theo, seed test keys via direct SQL `INSERT INTO theo_api_keys` (already the pattern in cloud-repo `routes/api_keys_test.go`) |
| 7 | **AuthStateListener as test probe** | Event-driven assertions instead of polling: `onAuthStateChange((event) => { if (event === 'TOKEN_REFRESHED' \|\| ...) })` | **CONCEPTUAL** — theo's MCP path could expose similar event hooks but not load-bearing for Camada 2 lifecycle tests. Defer. |

**Recipe — Camada 2 integration test suite skeleton (adapt to vitest + ankane/pgvector):**

```typescript
// src/server/__tests__/api-keys-lifecycle.integration.test.ts
//
// Pattern borrowed from Supabase auth integration test discipline:
//   - Real Postgres via testcontainers (already standard in theo)
//   - Short TTL fixture for grace-window assertions
//   - Lineage chain assertion via rotated_from
//   - 401 INVALID_API_KEY semantic for post-grace key

describe('API Keys Lifecycle (Camada 2)', () => {
  let pg: PgContainer;
  let server: HonoServer;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('ankane/pgvector:v0.5.1').start();
    await runMigrations(pg.getConnectionUri());
    server = await createServer({ db: pg.getConnectionUri(), auth: 'api-keys' });
  });

  it('creates a key, returns secret ONCE, validates lifecycle', async () => {
    // Pattern 6: direct create via API (no UI flow)
    const created = await server.fetch('/v1/admin/keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_BOOTSTRAP_TOKEN}` },
      body: JSON.stringify({ name: 'integration-test', scopes: ['memory:read'] }),
    });
    expect(created.status).toBe(200);
    const { id, secret } = await created.json();
    expect(secret).toMatch(/^theo_live_/);

    // Show-once: the same id GET returns prefix only, never the secret
    const fetched = await server.fetch(`/v1/admin/keys/${id}`, { headers: { Authorization: `Bearer ${ADMIN_BOOTSTRAP_TOKEN}` } });
    const view = await fetched.json();
    expect(view.key_prefix).toBeDefined();
    expect(view.secret).toBeUndefined();
  });

  it('rotation creates child, preserves grace window, lineage chain accurate', async () => {
    // Pattern 4: lineage chain assertion
    const a = await createKey({ name: 'rotate-source' });
    const rotated = await server.fetch(`/v1/admin/keys/${a.id}/rotate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_BOOTSTRAP_TOKEN}` },
      body: JSON.stringify({ grace_window_hours: 1 }),  // Pattern 2: short window for fast test
    });
    const b = await rotated.json();

    // Lineage assertion
    const lineage = await server.fetch(`/v1/admin/keys/${b.id}/lineage`, { headers: { Authorization: `Bearer ${ADMIN_BOOTSTRAP_TOKEN}` } });
    const { lineage: chain } = await lineage.json();
    expect(chain.find((c: any) => c.id === a.id)).toBeDefined();
    expect(chain.find((c: any) => c.id === b.id).is_current).toBe(true);

    // Pattern 5: both keys work during grace
    expect((await callMemoryApi(a.secret)).status).toBe(200);
    expect((await callMemoryApi(b.secret)).status).toBe(200);
  });

  it('post-grace, old key returns 401 INVALID_API_KEY', async () => {
    // Pattern 5: simulate post-grace expiry
    const a = await createKey({ name: 'expires-fast', expires_at: new Date(Date.now() + 2000).toISOString() });
    expect((await callMemoryApi(a.secret)).status).toBe(200);
    await new Promise(r => setTimeout(r, 3000));
    expect((await callMemoryApi(a.secret)).status).toBe(401);
  });

  it('scope-check: memory:read key denied for memory:write endpoint', async () => {
    const k = await createKey({ name: 'read-only', scopes: ['memory:read'] });
    expect((await callMemoryApi(k.secret, { op: 'recall' })).status).toBe(200);
    expect((await callMemoryApi(k.secret, { op: 'remember' })).status).toBe(403);  // scope_insufficient
  });
});
```

**Verdict:** **CONCEPTUAL_BORROW** the 7 Supabase auth test patterns; the recipe above is the Camada 2 integration test skeleton that the implementation plan should ship verbatim (adapting bearer to `theo_live_*` shape).

Sources: [github.com/supabase/auth](https://github.com/supabase/auth), [github.com/supabase-community/gotrue-go](https://github.com/supabase-community/gotrue-go), [supabase.com/docs/reference/self-hosting-auth/introduction](https://supabase.com/docs/reference/self-hosting-auth/introduction), [supabase.com/docs/guides/auth/architecture](https://supabase.com/docs/guides/auth/architecture).

---

## Cross-cutting Comparison (Verdict Matrix per Rule 9 — populated per Q row per source plan D3)

| Candidate | Q1 token | Q2 scope | Q3 OSS CRUD | Q4 OIDC | Q5 npm dep | Q6 tests | Q7 scan | Q8 MCP |
|---|---|---|---|---|---|---|---|---|
| **Stripe** | **CONCEPTUAL_BORROW** (sk_live_ prefix shape ✓ matched; show-once UX ✓ matched; vault-only storage advice as customer-side doc) | **CONCEPTUAL_BORROW** ("Write implies Read" hierarchy — future enhancement) | n/a | n/a | n/a | n/a | n/a | n/a |
| **Supabase** | **CONCEPTUAL_BORROW** (sb_publishable_/sb_secret_ purpose-prefix split is interesting; current theo single-prefix sufficient for v0.1) | n/a | **REJECT** (self-host has NO PAT UI; documented anti-pattern) | n/a | n/a | **CONCEPTUAL_BORROW** — 7 test patterns extracted from GoTrue/auth integration suite (docker-compose pattern, short TTL fixtures, lineage-chain assertions, multi-session revocation edge cases) | n/a | n/a |
| **PostHog** | **CONCEPTUAL_BORROW** (multi-prefix discipline by token PURPOSE: `phx_`/`phs_`/`pha_`/`phr_` — adopt only when OAuth tokens land in Camada 3) | n/a | **ADOPT** (full UI parity self-host vs cloud; canonical OSS-first pattern) | n/a | n/a | n/a | n/a | n/a |
| **Cal.com** | n/a | n/a | **ADOPT (strongest reference)** — Settings → Developer → API Keys UI in self-host = cloud; cal_live_ matches theo_live_ exactly | n/a | n/a | n/a | n/a | n/a |
| **Plausible** | n/a | n/a | **ADOPT** — Settings → API Keys UI in CE = cloud; show-once gate canonical; purpose-discipline (plugin vs stats vs sites) for future enhancement | n/a | n/a | n/a | n/a | n/a |
| **GitHub PAT** | n/a (Q1 didn't sample GitHub directly) | **CONCEPTUAL_BORROW** fine-grained / **REJECT** classic — see Q2 prose | n/a | n/a | n/a | n/a | **DOCUMENT for Camada 4 cloud-repo** — partner program enrollment procedure (6 steps) + webhook payload + ECDSA signature verification + revoke handler stub | n/a |
| **Ory Hydra** | n/a | n/a | n/a | **ADOPT** as the OIDC issuer reference impl (already deployed in our cluster at port 4445; `/oauth2/introspect` confirmed; admin port discipline matches our existing infra) | n/a | n/a | n/a | n/a |
| **Auth0** | n/a | (Q2 deferred sub-claim — not load-bearing; GitHub fine-grained + Stripe RAK already covered the resource:verb shape definitively) | n/a | **CONCEPTUAL_BORROW** as enterprise-tier OIDC issuer reference (universal RFC 7662 introspect + universal RFC 8693 token-exchange support; same dual-validation middleware works) | n/a | n/a | n/a | n/a |
| **RFCs (6749/7662/8693/9449)** | n/a | n/a | n/a | **ADOPT RFC 7662 (introspection) for Camada 3** + **CONCEPTUAL_BORROW RFC 8693 (token exchange) as v2.x future** + RFC 9449 (DPoP) deferred to Camada 4 | n/a | n/a | n/a | n/a |
| **npm libs (jose/oauth4webapi/etc)** | n/a | n/a | n/a | n/a | **ADOPT** stack: jose + oauth4webapi + hono>=4.11.4 (CRITICAL Hono CVE pin) + hono/bearer-auth + hono/jwk (with explicit `alg`); **REJECT** express-jwt (wrong framework); **DEFER** DPoP to Camada 4 | n/a | n/a | n/a |
| **MCP spec** | n/a | n/a | n/a | n/a | n/a | n/a | n/a | **ADOPT** MCP Authentication Specification for streamable-HTTP. stdio UNCHANGED. REUSE the Q4 dual-validation middleware (theo_live_ OR OIDC JWT introspection) — single shared impl across REST API + MCP HTTP transport. WWW-Authenticate challenge + `/.well-known/oauth-protected-resource` discovery. DCR (RFC 7591) DEFERRED to v2.x. |
| **theo-cloud baseline** (reference anchor) | **ADOPT pattern** (theo_live_ + SHA-256 + EC-13 show-once gate — port verbatim to OSS server) | **ADOPT** (memory:read/write/delete/admin already fine-grained-canonical) | n/a | n/a | n/a | n/a | n/a | n/a |

Cells marked `n/a` are explicitly not in scope for that candidate × question pair per source plan v1.1 Research Questions table. Cells marked `<!-- TBD -->` are populated by /discover-execute iterations.

## Recommendations

### Camada 2 — OSS multi-user lifecycle (`@usetheo/memory/server` `--auth=api-keys` mode)

**ADOPT verbatim from theo-cloud `routes/api_keys.go`** (Stripe-shape pattern already production-grade in cloud, no design re-litigation):

1. **Token format**: `theo_live_{base64url(32)}` (Q1) — Stripe-shape prefix discipline; SHA-256 single-pass hash-at-rest; show-once secret reveal with **EC-13 acknowledgement gate** ("I've copied my key safely" checkbox enabled "Done" button — empirically validated this session via Chrome DevTools MCP against the dashboard).
2. **Scope vocabulary**: `memory:read` / `memory:write` / `memory:delete` / `memory:admin` (Q2) — already FAANG-canonical fine-grained resource:verb; add Stripe-style "Write implies Read" implicit hierarchy as a v1.x enhancement.
3. **Lifecycle CRUD**: full Stripe-shape (List + Create + Revoke + Rotate + Lineage) + admin REST `/v1/admin/keys/*` + admin CLI `themory keys {create,list,rotate,revoke}` — port the existing 702-LoC `cloud/dashboard/src/pages/api-keys.tsx` UI as the OSS admin UI (Camada 2 ships the SAME UI as cloud per Cal.com / PostHog / Plausible canonical pattern).
4. **Persistence**: same `theo_api_keys` schema (subject + tenant_id discriminator); `tenant_id = "self"` for single-tenant OSS mode.
5. **Bootstrap**: `themory server --auth=api-keys --admin-bootstrap-token=<env>` — admin token from env for the first key-creation call; subsequent admin via JWT-from-Kratos OR `theo_live_admin_*` key (admin scope).
6. **Test suite**: adopt the 7 Supabase auth integration patterns (Q6) — recipe skeleton already in Q6 prose. Real Postgres via testcontainers, short-TTL fixtures, lineage-chain assertions, multi-session post-grace 401.

**Reject**: Supabase's cloud-only-PAT-UI anti-pattern (Q3 verdict) — OSS server MUST ship the same lifecycle UI as the cloud Dashboard would.

### Camada 3 — OIDC bridge (`@usetheo/memory/server` `--auth=oidc` mode)

**ADOPT Path A — dual-validation Bearer middleware** (Q4 verdict):

- The Bearer middleware switches on prefix: `theo_live_*` → existing SHA-256 lookup; else → RFC 7662 introspection against the configured OIDC issuer (Hydra/Keycloak/Auth0/Okta/Azure AD).
- Cache introspection results 60-300s default (per RFC 7662 § 4 caveats); operator-overridable for high-sensitivity deployments.
- **Dependency stack** (Q5 verdict): `jose` (JWKS primitives) + `oauth4webapi` (OIDC introspection client) + **`hono >= 4.11.4`** (CRITICAL: pin for 2026-01-13 CVE fixes) + `hono/bearer-auth` (foundation) + `hono/jwk` (with mandatory explicit `alg: ['RS256']` allowlist per CVE mitigation).
- **`themory server --auth=oidc --issuer=<URL> --jwks-url=<URL>`** mode; scope mapping via config (`scope_mapping: { "memory:read": ["memory.read", "groups:memory-readers"] }`).

**Defer to v2.x**: Path B (RFC 8693 token exchange endpoint). Reason: complexity > value at v1.x; per-call introspection latency is acceptable for most workloads with 60-300s caching.

**Reject**: running our own STS (we are a memory primitive, not an identity provider — operators plug their existing OIDC issuer).

### Sub-goal 3 (MCP `themory mcp`) — streamable-HTTP authentication

**ADOPT MCP Authentication Specification** (Q8 verdict):

- **stdio transport UNCHANGED** (single-client local; scope binding via env vars per existing `cli-scope.ts`).
- **streamable-HTTP transport**: REUSE the SAME dual-validation middleware from Camada 3 (Q4 + Q8 convergence). MCP spec's "OAuth (default) + LLAT (opt-in) both methods coexist" pattern maps 1:1 to theo's `theo_live_*` LLAT + OIDC JWT dual model — single shared implementation across REST API + MCP HTTP.
- **HTTPS-only when non-localhost** (`themory mcp --transport streamable-http --host <non-127.0.0.1>` refuses to start without TLS config).
- **WWW-Authenticate challenge + `/.well-known/oauth-protected-resource`** discovery endpoint per RFC 9728 (lists configured AS + supported scopes + bearer methods).
- **DEFER DCR (RFC 7591) to v2.x** — public-endpoint security risk + complexity.

### Camada 4 — FOLLOW-UP CLOUD REPO (NOT in this implementation plan)

Per source plan ADR D4-expanded, the following items are documented here for the cloud-repo follow-up plan but **NOT shipped in `@usetheo/memory/server`**:

1. **Audit log**: per-request `theo_api_key_audit` table (key_id, ip, ua, route, scope_used, status, ts) + 90d retention job. SOC2 / GDPR Art. 30 compliance grounding (per source plan D7 — SOC2 paywall fallback policy honored; GDPR Art. 30 as anchor).
2. **Per-key rate limit**: token-bucket Redis (e.g., upstash) — 100rpm default per key, override via key metadata field. Defends against credential stuffing on the read-path that today's `/v1/auth/session/token` rate-limit doesn't cover.
3. **GitHub Secret Scanning Partner Program enrollment** (Q7 verdict): 6-step procedure documented; webhook endpoint stub at `cloud/internal/routes/scanning_webhook.go`; ECDSA signature verification via `api.github.com/meta/public_keys/secret_scanning`.
4. **DPoP RFC 9449** (token-bound credentials): high-security enterprise tier; defer until customer ask materializes.
5. **Anomaly detection**: geo-IP shift + throughput spike → webhook + auto-pause; defer until audit-log data exists to define baseline.

### ADR-0009 SUPERSESSION (D6 + D8 satisfied)

Per source plan ADR D8 (D6 supersession conditional on Q4 completion): **Q4 completed both Fase A (3 WebSearches: Hydra docs + RFC 7662 + RFC 8693) AND Fase B (extracted contract surfaces + trade-off matrix)**, so the conditional is SATISFIED. The implementation plan that follows this blueprint **MUST** ship a new ADR (`ADR-0013-oidc-bridge-via-introspection.md`, next free ADR slot after ADR-0012) that explicitly supersedes the "OAuth / OIDC flow — Deferred to v1.x" row of ADR-0009 with:

- The dual-validation middleware decision (Camada 3 above)
- The dependency stack (Q5 — jose + oauth4webapi + hono>=4.11.4)
- The convergence with MCP streamable-HTTP (Q8 — same middleware serves both surfaces)

ADR-0009 stays unchanged as historical record per `architecture.md` § history-preservation rule. ADR-0013 cites ADR-0009 explicitly with a "Supersedes ADR-0009 § Alternatives row 4 (OAuth / OIDC flow)" header.

## ADRs

The implementation plan that follows this blueprint MUST land the following ADRs:

### D1 — OIDC bridge via RFC 7662 introspection (Camada 3) — proposed ADR-0013

**Decision:** `@usetheo/memory/server` ships dual-validation Bearer middleware that accepts EITHER `theo_live_*` prefix → SHA-256 lookup in `theo_api_keys` OR Bearer JWT → RFC 7662 introspection against the configured OIDC issuer. Implementation via `oauth4webapi.processIntrospectionResponse` + `jose.createRemoteJWKSet` + `hono/jwk` (with mandatory `alg: ['RS256', 'ES256', 'EdDSA']` allowlist per the 2026-01-13 Hono CVE fix).

**Supersedes:** ADR-0009 § Alternatives row 4 ("OAuth / OIDC flow — Deferred to v1.x"). ADR-0009 itself stays unchanged as historical record per `architecture.md` § history-preservation rule.

**Status:** PROPOSED (to be ACCEPTED by the to-plan that consumes this blueprint).

### D2 — OSS lifecycle parity (Camada 2) — proposed ADR-0014

**Decision:** `@usetheo/memory/server` ships full Stripe-shape lifecycle (List + Create + Revoke + Rotate + Lineage) + admin UI parity with future cloud Dashboard, following the Cal.com / PostHog / Plausible OSS-first pattern (REJECT Supabase's cloud-only-PAT-UI anti-pattern). Mode activated via `themory server --auth=api-keys --admin-bootstrap-token=<env>`.

**Rationale:** the OSS server today ships single-secret env-var auth; multi-user lifecycle parity is the explicit gap closing PRIORITY 0 sub-goal 2 ("SDKs 100% functional").

**Status:** PROPOSED.

### D3 — MCP streamable-HTTP authentication (Sub-goal 3) — proposed ADR-0015

**Decision:** `themory mcp --transport streamable-http` wraps the existing `MemoryServer` with the same dual-validation middleware from ADR-0013 (Camada 3). stdio transport remains UNCHANGED (single-client local, no Bearer). HTTPS-only when bound to non-localhost; refuse-to-start without TLS config. `/.well-known/oauth-protected-resource` endpoint per RFC 9728. DCR (RFC 7591) DEFERRED to v2.x.

**Rationale:** MCP Authentication Specification mandates OAuth 2.0/2.1 for streamable-HTTP; LLAT (Long-Lived Access Tokens) is the spec's opt-in pattern that maps 1:1 to theo's `theo_live_*` keys. Reusing the ADR-0013 middleware closes Sub-goal 3 ("MCP server available + reliable") without duplicating Bearer logic across REST + MCP surfaces.

**Status:** PROPOSED.

## Blocked questions (if any)

None of the 8 questions were BLOCKED. All 8 reached Fase B completion with allowlisted-URL citations.

**Honest sub-claim deferrals** (NOT blocked questions; partial-coverage transparency):

- **Q2 / Auth0 RBAC sub-claim**: not pursued because GitHub fine-grained PAT + Stripe RAK already covered the resource:verb pattern definitively. Auth0 RBAC would add zero novel information at the verdict level. Not load-bearing for the Camada 2 verdict.
- **Q7 / GitLab equivalent**: documented as "less public; coverage is more focused on the SAST integration than third-party partner registration." Out of scope for the immediate Camada 4 work; revisit if/when TheoCloud needs GitLab coverage.
- **Q5 / DPoP libraries (RFC 9449)**: explicitly DEFERRED to Camada 4 per source plan D4-expanded — this is enterprise tier (token-bound credentials). Not blocked, just out of scope for Camada 3.
- **Source plan D7 (SOC2 paywall)**: anticipated but NOT triggered in this discovery — Q5 ended up scoping audit-log work entirely to Camada 4 (cloud-repo follow-up), where the SOC2 vendor access is available. The D7 fallback policy remains for the cloud-repo plan.

---

## Sources

All citations resolve via either (a) allowlisted-URL host match in `.claude/rules/discover-web-allowlist.txt` OR (b) local-path filesystem existence. Zero fabricated paths.

**Q1 — token format:**
- [docs.stripe.com/keys](https://docs.stripe.com/keys)
- [docs.stripe.com/keys-best-practices](https://docs.stripe.com/keys-best-practices)
- [docs.stripe.com/keys/restricted-api-keys](https://docs.stripe.com/keys/restricted-api-keys)
- [supabase.com/docs/guides/getting-started/api-keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [supabase.com/docs/guides/self-hosting/self-hosted-auth-keys](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys)
- [posthog.com/docs/api](https://posthog.com/docs/api)

**Q2 — scope vocabulary:**
- [docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
- [docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
- [docs.stripe.com/keys/restricted-api-keys](https://docs.stripe.com/keys/restricted-api-keys)

**Q3 — OSS lifecycle CRUD tooling:**
- [supabase.com/docs/guides/self-hosting/docker](https://supabase.com/docs/guides/self-hosting/docker)
- [supabase.com/docs/reference/api/introduction](https://supabase.com/docs/reference/api/introduction)
- [posthog.com/docs/api](https://posthog.com/docs/api)
- [posthog.com/docs/self-host](https://posthog.com/docs/self-host)
- [cal.com/docs/api-reference/v2/introduction](https://cal.com/docs/api-reference/v2/introduction)
- [cal.com/blog/where-is-my-api-key-and-what-can-it-do](https://cal.com/blog/where-is-my-api-key-and-what-can-it-do)
- [cal.com/docs/self-hosting/guides/organization/organization-setup](https://cal.com/docs/self-hosting/guides/organization/organization-setup)
- [plausible.io/docs/sites-api](https://plausible.io/docs/sites-api)
- [plausible.io/docs/self-hosting](https://plausible.io/docs/self-hosting)
- [plausible.io/docs/self-hosting-configuration](https://plausible.io/docs/self-hosting-configuration)

**Q4 — OIDC bridge:**
- [www.ory.sh/hydra/docs/v1.6/guides/oauth2-token-introspection/](https://www.ory.sh/hydra/docs/v1.6/guides/oauth2-token-introspection/)
- [www.ory.sh/docs/hydra/sdk/api](https://www.ory.sh/docs/hydra/sdk/api)
- [www.ory.sh/docs/hydra/production](https://www.ory.sh/docs/hydra/production)
- [datatracker.ietf.org/doc/html/rfc7662](https://datatracker.ietf.org/doc/html/rfc7662)
- [www.rfc-editor.org/rfc/rfc7662.html](https://www.rfc-editor.org/rfc/rfc7662.html)
- [www.rfc-editor.org/rfc/rfc8693.html](https://www.rfc-editor.org/rfc/rfc8693.html)

**Q5 — npm dep picks:**
- [www.npmjs.com/package/jose](https://www.npmjs.com/package/jose)
- [github.com/panva/jose](https://github.com/panva/jose)
- [www.npmjs.com/package/oauth4webapi](https://www.npmjs.com/package/oauth4webapi)
- [github.com/panva/oauth4webapi](https://github.com/panva/oauth4webapi)
- [github.com/honojs/hono/security/advisories/GHSA-3vhc-576x-3qv4](https://github.com/honojs/hono/security/advisories/GHSA-3vhc-576x-3qv4)
- [github.com/honojs/hono/security/advisories/GHSA-f67f-6cw9-8mq4](https://github.com/honojs/hono/security/advisories/GHSA-f67f-6cw9-8mq4)
- [github.com/honojs/hono/blob/main/src/middleware/bearer-auth/index.ts](https://github.com/honojs/hono/blob/main/src/middleware/bearer-auth/index.ts)
- [www.npmjs.com/package/@hono/oidc-auth](https://www.npmjs.com/package/@hono/oidc-auth)

**Q6 — Supabase auth tests:**
- [github.com/supabase/auth](https://github.com/supabase/auth)
- [github.com/supabase-community/gotrue-go](https://github.com/supabase-community/gotrue-go)
- [supabase.com/docs/reference/self-hosting-auth/introduction](https://supabase.com/docs/reference/self-hosting-auth/introduction)
- [supabase.com/docs/guides/auth/architecture](https://supabase.com/docs/guides/auth/architecture)

**Q7 — secret scanning:**
- [docs.github.com/en/code-security/secret-scanning/secret-scanning-partnership-program/secret-scanning-partner-program](https://docs.github.com/en/code-security/secret-scanning/secret-scanning-partnership-program/secret-scanning-partner-program)
- [docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning-for-partners](https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning-for-partners)
- [docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns](https://docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns)

**Q8 — MCP transport auth:**
- [modelcontextprotocol.io/docs/learn/architecture](https://modelcontextprotocol.io/docs/learn/architecture)
- [github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- [github.com/modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk)
- [github.com/cyanheads/model-context-protocol-resources/blob/main/guides/mcp-server-development-guide.md](https://github.com/cyanheads/model-context-protocol-resources/blob/main/guides/mcp-server-development-guide.md)

**Local references (cross-repo anchor):**
- `/home/paulo/Projetos/usetheo/theo-cloud/theo/cloud/internal/routes/api_keys.go` — Stripe-shape canonical impl (anchor for Q1, Q2, Q3 verdicts)
- `/home/paulo/Projetos/usetheo/theo-cloud/theo/cloud/internal/auth/scope.go` — RequireScope middleware (anchor for Q2 verdict)
- `src/agent-tools/server.ts` — MCP server wrapper (Q8 touchpoint)
- `src/agent-tools/cli-scope.ts` — stdio scope binding (Q8 stdio-unchanged baseline)
