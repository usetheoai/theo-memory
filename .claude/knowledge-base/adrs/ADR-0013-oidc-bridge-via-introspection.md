# ADR-0013: OIDC bridge via RFC 7662 introspection (Camada 3 — dual-validation middleware)

- **Status:** Accepted
- **Date:** 2026-06-07
- **Plan:** [`theo-memory-faang-auth-lifecycle-plan.md`](../plans/theo-memory-faang-auth-lifecycle-plan.md) § ADR D1 + T3.1
- **Supersedes (in part):** [ADR-0009](./ADR-0009-cloud-auth-theokit-api-key.md) § Alternatives row 4 (`OAuth / OIDC flow — Deferred to v1.x`) — the OIDC bridge is no longer deferred; this ADR ships it as Camada 3 of `@usetheo/memory/server`
- **Owner:** TheMemory `theo-memory-faang-auth-lifecycle` cycle (SDK sub-goal 2 + MCP sub-goal 3 hardening)
- **Sign-off:** Project owner authorization 2026-06-07 via `/auto-plan` → `/implement` chain; recorded in plan attestation SHA256 `e4f3a5bcdd75d8a511ff8ab03f40fd649e3711e43ed67af4a135cf00af0cd118`

## Context

ADR-0009 (2026-05-22) deferred OAuth/OIDC to v1.x with the reasoning "Heavier; needs identity provider integration. v0.5 ships with API-key auth (Mem0/Zep parity); OAuth lands when enterprise customers ask."

Three signals between 2026-05-22 and 2026-06-07 invalidated the deferral:

1. **Empirical RFC 7662 + Hydra audit (blueprint Q4):** `oauth4webapi.processIntrospectionResponse` against Hydra's `/oauth2/introspect` endpoint (already deployed in theo-cloud cluster at port 4445) is a single-conditional middleware addition — NOT a heavy identity-provider integration. The "heavy" assumption was unverified.
2. **MCP streamable-HTTP authentication mandate** (blueprint Q8): per MCP spec, streamable-HTTP transport MUST use OAuth 2.0/2.1. theo's `themory mcp --transport streamable-http` was launching unauthenticated — PRIORITY 0 sub-goal 3 ("MCP available + reliable") explicitly requires this gate.
3. **OSS multi-user lifecycle gap (blueprint Q3):** Cal.com / PostHog / Plausible all ship full OSS UI parity; Supabase is the documented anti-pattern. Closing the OSS gap required the per-key lifecycle (Camada 2) AND OIDC bridge (Camada 3) together.

## Decision

`@usetheo/memory/server` ships a **dual-validation Bearer middleware** that prefix-routes incoming tokens:

```
Authorization: Bearer <token>
  ├─ if token matches /^theo_live_[A-Za-z0-9_-]{40,}$/   → ApiKeyAuthVerifier (Camada 2; SHA-256 hash lookup against theo_api_keys)
  ├─ if token starts with theo_live_ but shape mismatch  → log prefix_collision_detected + fall through to OIDC verifier  (EC-1)
  └─ else (JWT-like / opaque)                            → OidcAuthVerifier (RFC 7662 introspection against configured issuer)
```

`OidcAuthVerifier` implements the 12th DIP `AuthVerifier` and:

- Calls a pluggable `IntrospectFn` (production adapts `oauth4webapi.processIntrospectionResponse`; tests inject stubs) — RFC 7662 contract.
- Caches `active: bool` results keyed by SHA-256(token) with default 60s TTL (RFC 7662 § 4 caveat — `cacheTtlSeconds: 0` disables for high-sensitivity deployments). EC-12 documented.
- Wraps every introspection HTTP call with `AbortController` + default 5000ms timeout (EC-4) — fail-closed on timeout.
- Coalesces concurrent verify() calls for the same token-hash via in-flight `Map<tokenHash, Promise>` (EC-5) — prevents thundering-herd DDoS amplification when many requests arrive for the same token during a cache miss.

Selected at server start via `themory server --auth=both --issuer=<URL>` (proposed flag set; final naming per T2.3 polish if needed). Without `--issuer`, the OIDC branch is no-op and only `theo_live_*` keys are accepted (the existing Camada 1+2 path).

## Consequences

**Positive:**

- Universal OIDC issuer compatibility (Hydra / Keycloak / Auth0 / Okta / Azure AD — all implement RFC 7662).
- Zero customer-side migration friction: existing `theo_live_*` consumers continue to work unchanged; OIDC adopters add `--issuer` flag.
- MCP streamable-HTTP auth reuses the SAME middleware via T4.1 wrap (Sub-goal 3 closes for free).
- Per-request introspection cost amortized by cache + coalescing — typical hot path is < 1ms (cache hit).
- Operator-tunable revocation freshness via `cacheTtlSeconds`.

**Negative:**

- Adds 2 runtime deps (`jose` + `oauth4webapi`). Both zero-deps, panva-maintained, OpenID-certified — vetted in blueprint Q5.
- Cache staleness window (RFC 7662 § 4 caveat) — token revoked upstream may still pass for up to TTL seconds. Documented in `--oidc-cache-ttl-seconds` flag help; EC-12.
- Operators MUST configure their OIDC issuer to expose `/oauth2/introspect` AND authorize the resource server client.

**Reversibility:** the dual-validation middleware lives behind a server-construction option. To roll back, omit `--issuer` at startup — the OIDC branch becomes no-op without code revert. The two new deps can be pruned via package.json edit if Camada 3 is fully retired (unlikely).

## Alternatives considered

| Alternative | Verdict | Why rejected |
|---|---|---|
| **Token exchange RFC 8693 endpoint** | Deferred to v2.x | HIGHER complexity (new endpoint, STS protocol, additional table for exchanged tokens, customer-side caching). LOW marginal value: per-call introspection latency is acceptable for most workloads with caching enabled. Revisit when customers demonstrably need per-call cost optimization. |
| **Single-mode middleware (no `theo_live_*` fallback when OIDC enabled)** | Rejected | Breaks existing OSS deployments that rely on env-var auth + blocks self-host operators who want both paths. Dual-mode is mandatory for backward compat + OIDC adoption coexistence. |
| **Run our own STS / OIDC issuer** | Rejected | TheMemory is a memory primitive, not an identity provider. Operators plug their own Hydra/Keycloak/Auth0 via the issuer URL config — clear separation of concerns. |
| **DPoP RFC 9449 token-bound binding** | Deferred to Camada 4 (TheoCloud) | Enterprise-tier feature (token-bound credentials resistant to bearer-theft). Adds complexity without v1.x customer ask. Revisit when enterprise customers request it. EC-13. |

## References

- Plan [`theo-memory-faang-auth-lifecycle-plan.md`](../plans/theo-memory-faang-auth-lifecycle-plan.md) § ADR D1 + T3.1
- Blueprint [`theo-memory-faang-auth-lifecycle-blueprint.md`](../discoveries/blueprints/theo-memory-faang-auth-lifecycle-blueprint.md) § Q4 (Path A verdict) + § Q5 (dep stack)
- Implementation: `src/server/auth/oidc-verifier.ts` + `src/server/auth/dual-validation.ts` (commit `16f5620`)
- [RFC 7662](https://datatracker.ietf.org/doc/html/rfc7662) OAuth 2.0 Token Introspection
- [oauth4webapi](https://github.com/panva/oauth4webapi) (`processIntrospectionResponse`)
- [Ory Hydra introspection guide](https://www.ory.sh/hydra/docs/v1.6/guides/oauth2-token-introspection/)
- ADR-0009 § Alternatives row 4 (SUPERSEDED — annotation added to that file in the same commit chain)
