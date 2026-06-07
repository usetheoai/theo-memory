# ADR-0015: MCP streamable-HTTP transport auth via the Camada 3 middleware (Sub-goal 3)

- **Status:** Accepted (impl pending — wiring lands in T4.1; this ADR locks the contract)
- **Date:** 2026-06-07
- **Plan:** [`theo-memory-faang-auth-lifecycle-plan.md`](../plans/theo-memory-faang-auth-lifecycle-plan.md) § ADR D3 + T4.1 + T4.2
- **Owner:** TheMemory `theo-memory-faang-auth-lifecycle` cycle (MCP sub-goal 3 hardening)
- **Sign-off:** Project owner authorization 2026-06-07 via `/auto-plan` → `/implement` chain

## Context

`themory mcp --transport streamable-http` (CLI subcommand shipped via v0.3 + theo-memory-standalone-p0 T2.2) currently exposes the MCP server WITHOUT Bearer auth. Per MCP Authentication Specification (blueprint Q8): "secure authentication is mandatory" for streamable-HTTP transport — stdio remains correctly unauthenticated (single-client local).

The MCP spec recommends OAuth 2.0/2.1 and explicitly endorses **Long-Lived Access Tokens (LLAT)** as an opt-in alternative for "local agents and custom MCP clients that can't run an OAuth browser flow." theo's `theo_live_*` keys ARE LLATs by design (Stripe-shape opaque secrets).

PRIORITY 0 sub-goal 3 ("MCP server available + reliable") explicitly cites this gate.

## Decision

When `themory mcp --transport streamable-http` is invoked, the MCP server is wrapped with the SAME `dualValidationAuth` middleware shipped in T3.1 (ADR-0013) — `theo_live_*` keys via `ApiKeyAuthVerifier`, OIDC JWTs via `OidcAuthVerifier`. stdio transport remains UNCHANGED.

Concretely:

1. **stdio transport** — UNCHANGED. Single-client local; scope binding via env vars per existing `src/agent-tools/cli-scope.ts`. No Bearer required.
2. **streamable-http transport** — wrap `MemoryServer` with `withBearerAuth(server, dualValidationAuth({apiKey, oidc}))`. Returns 401 + `WWW-Authenticate: Bearer realm="theo-mcp", error="invalid_token", error_description="...", resource_metadata="/.well-known/oauth-protected-resource"` per RFC 6750 § 3 + MCP spec.
3. **HTTPS-only when non-localhost** — `themory mcp --transport streamable-http --host <non-127.0.0.1>` refuses to start without TLS config (per MCP spec network-hygiene mandate).
4. **`/.well-known/oauth-protected-resource` discovery endpoint** (T4.2) — implements RFC 9728; lists configured OIDC issuer + supported scopes + bearer methods so MCP clients can auto-discover.
5. **Dynamic Client Registration (RFC 7591)** — DEFERRED to v2.x. Per blueprint Q8: "enabling it becomes a security risk because the endpoint is public and can be abused by flooding with unwanted client registrations." Static registration via `themory mcp` config at v1.x.

## Consequences

**Positive:**

- Sub-goal 3 ("MCP available + reliable") closes — auth gate satisfied per spec.
- Single shared middleware across REST API + MCP HTTP — no duplicated Bearer logic, no risk of drift between two implementations.
- MCP spec compliance (LLAT pattern) without forcing customers to run an OAuth browser flow.
- WWW-Authenticate + RFC 9728 well-known endpoint enable MCP-spec-conformant client auto-discovery.

**Negative:**

- `themory mcp --transport streamable-http` is a BREAKING change for existing consumers if they had no Bearer config — they need to start passing `Authorization: Bearer <theo_live_*>` OR set `--issuer` for OIDC. (Mitigation: stdio path is the dev-friendly default + the breaking change is on a P0-hardening surface that hadn't been used for production by external consumers per CLAUDE.md Roadmap Item 18 caveat.)
- The MCP server config now requires either `THEMEMORY_API_KEY` env (for env-var path) OR an `--auth=api-keys` + admin-key OR `--issuer` flag.

**Reversibility:** add `--auth=none` flag for streamable-HTTP only (NOT enabled by default — see Alternatives). The middleware lives behind the same factory, so disabling = passing no verifiers, which the middleware treats as "no path matches → 401" honestly.

## Alternatives considered

| Alternative | Verdict | Why rejected |
|---|---|---|
| **Build a separate MCP-specific Bearer middleware** | Rejected | DRY violation. The dual-validation logic IS the same logic — same prefix-routing, same verifiers, same caching. Duplicating risks drift between the two paths over time. |
| **Allow `--auth=none` opt-out for streamable-HTTP by default** | Rejected | MCP spec explicitly mandates auth for streamable-HTTP. Default opt-out would be a SPEC violation. We accept the breaking change for spec compliance; per-deployment escape hatch can land later. |
| **Ship Dynamic Client Registration (RFC 7591) in v1.x** | Deferred to v2.x | Public endpoint = abuse risk (flooding with unwanted registrations). Static registration is the safe default; revisit when MCP ecosystem demands dynamic registration. |
| **Require OAuth ONLY (reject `theo_live_*` LLATs on streamable-HTTP)** | Rejected | MCP spec explicitly endorses LLAT as the opt-in path for clients that can't run OAuth browser flow. theo's `theo_live_*` keys ARE LLATs by design — accepting them is spec-conformant. |

## References

- Plan [`theo-memory-faang-auth-lifecycle-plan.md`](../plans/theo-memory-faang-auth-lifecycle-plan.md) § ADR D3 + T4.1 + T4.2
- Blueprint [`theo-memory-faang-auth-lifecycle-blueprint.md`](../discoveries/blueprints/theo-memory-faang-auth-lifecycle-blueprint.md) § Q8 (MCP streamable-HTTP verdict)
- [MCP Architecture overview](https://modelcontextprotocol.io/docs/learn/architecture) (transport spec + auth mandate)
- [MCP TypeScript SDK reference](https://github.com/modelcontextprotocol/typescript-sdk)
- ADR-0013 (this ADR REUSES the dualValidationAuth middleware shipped there)
- Implementation: T4.1 + T4.2 (pending)
