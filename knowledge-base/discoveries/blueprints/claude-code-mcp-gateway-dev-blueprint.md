---
slug: claude-code-mcp-gateway-dev
milestone_id: M7
created_at: 2026-07-21
plan: knowledge-base/discoveries/plans/claude-code-mcp-gateway-dev-plan.md
status: shippable
---

# Blueprint: Claude Code ⇄ theo-memory via the Theo MCP Gateway (dev)

## The core finding

**The integration is two configuration changes away from working, and neither is in this
repository.** The Theo MCP Gateway is deployed and behaving correctly; the Claude Code client
supports exactly the credential model the platform mints. What blocks the path is (1) the public
edge never routes `/mcp/*` to the gateway, and (2) the component that validates credentials reads
a different database than the one the dashboard writes them to.

Both were established by direct observation, not inference.

## Context

M6 shipped the Claude Code kit and closed with one explicitly-flagged blocker in
`knowledge-base/discoveries/blueprints/claude-code-theo-memory-integration-blueprint.md`:
*"Resolve the prod edge host/path that accepts a `theo_live_*` key with the team before wiring the
hooks/MCP."* That question stayed open and the kit was activated anyway on 2026-07-21 — against the
unauthenticated theo-memory REST, with the MCP registered as stdio (placing Postgres and OpenAI
credentials on every client). This discovery resolves the deferred question and specifies the
correct wiring. Governing artifacts: `ROADMAP.md § M7`, `.claude/rules/cycle-discover.md`,
`theo-data/CLAUDE.md` invariants 1 and 6.

## Objective

Specify how every Claude Code instance reaches theo-memory through the Theo MCP Gateway on the dev
environment, holding exactly one scoped secret, with auth fail-closed at the edge and tenant
isolation provable — and identify precisely what must change, where, and who owns it.

## Coverage Corner 1 — Integration tests

The platform already defines the assertions a gateway-fronted memory integration must satisfy;
they are the regression guard M7 must extend to the MCP surface.

`theo-cloud/dev/smoke/edge-smoke-test.sh` asserts five properties post-`make up`, of which the
security-bearing one is:

> `(4) /v1/memory GATED by ForwardAuth — no credential MUST be denied (401/403)`
> `code="$(curl -s -o /dev/null -w '%{http_code}' "${EDGE}/v1/memory/recall")"`
> `[ "$code" = "401" ] || [ "$code" = "403" ] && ok "…ForwardAuth fail-closed" || bad "…not gated"`

Note the smoke test's own criterion: **a 404 on `/v1/memory/*` is a FAILURE**, not a pass. By that
criterion the public edge fails today for `/mcp/*` — it returns the SPA rather than a gated
response.

The tenant-isolation assertion lives in `theo-cloud`'s e2e as
`TestEdgeForwardAuthTenantIsolationE2E` (cited in `theo-cloud/theo-workspace/ROADMAP.md:129` as a
DoD item of that repo's M6: *"e2e `TestEdgeForwardAuthTenantIsolationE2E` (tenant-A não lê
tenant-B)"*), and the theo-memory side mirrors it with the hermetic `make e2e-edge` job required
by `theo-data/CLAUDE.md` invariant 6.

**Assertions a M7 regression guard must make** (platform criteria + the OSS survey below):

1. `POST <edge>/mcp/<capability>` with **no** credential → 401/403 over real HTTP, never 200 and
   never the SPA. Asserted on the status code, not on a raised exception.
2. Same request with an **invalid** credential → denied; and with a **revoked** one → denied.
   (Only one surveyed repo covers revocation at all, and none tests an expired token over HTTP.)
3. Same request with a **valid** `theo_live_*` → a well-formed MCP `initialize` result, followed by
   `initialized` and a `tools/call` — the **full handshake through the proxy**. No surveyed
   implementation tests this; it is the gap M7 closes.
4. **Tenant A's credential cannot read tenant B's memories through the MCP surface.** No reference
   implementation exists — this must be written from the contract.
5. **A request whose body claims another tenant, under tenant A's token, is denied.** Motivated by
   `mcp-context-forge`'s body-first tenant read; mirrors `theo-data/CLAUDE.md` invariant 3
   ("resolve a Principal, never trust the body").
6. The response is **not** `text/html` — the Content-Type assertion is what distinguishes "routed
   to the gateway" from "swallowed by the SPA catch-all", the exact failure mode observed here.
7. A bad `MCP-Protocol-Version` → `400`, and `Mcp-Session-Id` survives the proxy hop. The latter is
   untested in every surveyed implementation, and its failure mode is a *spurious 404*.

**Never copy this anti-pattern:** a guard that `skip`s on 401/403 (as `ensure_not_auth_error` does
in one surveyed repo) passes green precisely when auth is broken.

## Coverage Corner 2 — Dependencies

**Client side: one secret, nothing else.** Claude Code's HTTP transport carries a static header, so
the client needs no database driver, no LLM key, and no local runtime beyond Claude Code itself.
This is the decisive contrast with the stdio registration that was live before this milestone,
which required `THEOMEM_PG_URI` **and** `OPENAI_API_KEY` on every machine.

**Server side, as deployed on dev** (`docker ps` on 165.227.121.20):

| Component | Container | Exposure |
|---|---|---|
| Theo MCP Gateway | `theo-workspace-theo-mcp-gateway-1` | container-internal `:8080`, fronted by Traefik |
| Edge (data-plane) | `theo-workspace-traefik-1` | host `:8092` → container `:8090` |
| theo-memory | `themory_app` | host `:8080` (**unauthenticated — issue #101**) |
| Control-plane BFF | k3d `svc/theo-cloud` | host `:13002` via `kubectl port-forward` |
| Canonical credential store | k3d `theo-system/postgresql-0` | NodePort + host `:15432` port-forward |

**The credential lifecycle dependency is broken.** `theo-cloud/internal/auth/scope.go:109-118`
hashes the bearer with SHA-256 and selects on `key_hash` with `revoked_at IS NULL AND (expires_at
IS NULL OR expires_at > NOW())`, collapsing unknown/revoked/expired into one `ErrInvalidCredential`
so the keyspace cannot be probed. With an empty table every key is indistinguishable from a forged
one — which is precisely the 401 observed.

## Coverage Corner 3 — Tools

### Claude Code (primary source: `code.claude.com/docs/en/mcp`, `…/settings`, `…/hooks`)

| Transport | Flag | Auth |
|---|---|---|
| HTTP (Streamable HTTP) | `--transport http` / `-t http` | **Static header supported**: `--header "Authorization: Bearer <token>"` |
| SSE | `--transport sse` | Documented as **deprecated** — "Use HTTP servers instead, where available." |
| stdio | `--transport stdio` | Local process; inherits env |

OAuth is a **fallback, not a mandate**: Claude Code marks a server as needing authentication only
when it answers `401`/`403`, and — critically — *"If you configured `headers.Authorization` for the
server and the server rejects that header, Claude Code reports the connection as failed instead of
falling back to OAuth."* A gateway that answers 200 to a valid static bearer never enters the OAuth
path.

**Scope placement (two different files — a trap):** an MCP server registered with `--scope user`
is stored in `~/.claude.json`; global hooks live in `~/.claude/settings.json`. Settings precedence
is Managed → CLI args → Local → Project → User.

### The Theo MCP Gateway, as deployed

Contract established by probing `165.227.121.20:8092` (the Traefik edge) directly:

```
POST /mcp                  → 404 {"error":"no capability in path"}
POST /mcp/<capability>     → 401 {"error":"credential denied"}      (with or without a bearer)
```

So the gateway **is** running, routes by capability segment, and is **fail-closed**. Its Traefik
router (`theo-cloud/theo-workspace/dev/traefik/dynamic.yml:87-91`) carries **no** middlewares by
design — the file states the gateway itself is the MCP-aware auth layer that resolves the tenant
and injects the downstream credential (Model B), unlike `/v1/memory` which delegates to ForwardAuth.

### The public edge, and the gap

`theo/infra/local/Caddyfile § app-dev.usetheo.dev` routes:

```
/v1/memory/*, /v1/rag/*, /v1/lens/*  → localhost:8092   (Traefik — the data-plane edge)
/v1/*, /engine/*, /auth/*            → localhost:13002  (k3d BFF — control plane)
/sessions/*, /self-service/*         → localhost:14433  (k3d Kratos)
/ , /assets/*                        → file_server (dashboard/dist)
```

**There is no `handle /mcp/*` block.** Requests therefore fall to the catch-all `file_server`,
which answers `200 text/html` to GET and `405 allow: GET, HEAD` to POST — the signature of a static
file server, confirmed by response headers (`server: Caddy`, `etag`, `last-modified`). Reading that
405 as "the route exists" is the trap this investigation fell into once and then corrected.

## Coverage Corner 4 — Techniques

### MCP specification (primary source: `modelcontextprotocol.io`)

- Current protocol revision: **2025-11-25**.
- Two standard transports: **stdio** and **Streamable HTTP**. HTTP+SSE from 2024-11-05 is
  explicitly **deprecated** — a gateway speaking only legacy SSE against a Streamable-HTTP client
  fails in a way that resembles an auth error (plan EC-3).
- Clients **MUST** send `MCP-Protocol-Version` on all post-initialize requests; a server seeing an
  unsupported value **MUST** answer `400`. A proxying gateway must therefore preserve this header.
- Sessions use an optional `Mcp-Session-Id` echoed on later requests; a terminated session yields
  `404` and the client must re-initialize. **A gateway that fails to pass this header through
  breaks the session, and the symptom is a spurious 404** — worth an explicit test.
- Authorization is **OPTIONAL**. When an implementation opts in, the authorization server MUST
  implement OAuth 2.1, servers MUST implement RFC 9728 Protected Resource Metadata, and clients
  MUST send RFC 8707 Resource Indicators. A **static pre-shared token is tolerated, not blessed** —
  the spec simply does not describe an API-key scheme. Notably, if a server *presents itself* as an
  OAuth resource server it "MUST NOT accept or transit any other tokens", so the two models should
  not be mixed on one surface.

### Model B, as implemented here

`theo-cloud/dev/provision-model-b.sh` documents the confused-deputy closure the platform already
ships: the gateway holds a **control-plane** credential (`THEMORY_PLATFORM_ADMIN_KEY`, scope
`memory:platform-admin`) and mints a **per-tenant data key per request**, never forwarding the
client's key. The script is explicit that the platform-admin credential carries *no* data scope:

> "Key-lifecycle scope ONLY — NO data scope (read/write/delete). Invariant #4: platform-admin
> implies only admin, never a data verb… Over-granting here re-opens CWE-441."

This is the architecture M7 must preserve. It is also why routing `/v1/memory/*` to the k3d BFF
would be a regression rather than a fix: it bypasses the edge that closes CWE-441.

### OSS survey — four gateway-fronted multi-tenant MCP implementations

| Repo | Auth | Tenant isolation | Transport | Verdict vs EC-4 bar |
|---|---|---|---|---|
| [aws-samples/sample-multi-tenant-saas-mcp-server](https://github.com/aws-samples/sample-multi-tenant-saas-mcp-server) | Cognito JWKS RS256 (`requireBearerAuth`) | **Best design** — tenant read from the JWT claim only (`custom:tenantId`), consumed from `authInfo` not tool params; STS session tag enforced by an IAM `dynamodb:LeadingKeys` condition | Streamable HTTP, stateless | ACCEPT (design) |
| [microsoft/mcp-gateway](https://github.com/microsoft/mcp-gateway) | Entra ID JWT; RFC 9728 401 challenge | Per-**user**, not per-tenant; scoped session key `user:adapter:sessionId` | Streamable HTTP reverse proxy | ACCEPT (best hop tests) |
| [IBM/mcp-context-forge](https://github.com/IBM/mcp-context-forge) | JWT / Basic / cookie / introspection | Teams, credential-derived and fail-closed in `token_scoping.py` — **but** `rbac.py::_derive_team_from_payload` reads `team_id` from the **request body first** | SSE, stdio, Streamable HTTP, WS | ACCEPT (caveated) |
| [thiagomendes/mcpx](https://github.com/thiagomendes/mcpx) | PAT prefix + HMAC JWT; org cross-checked vs credential | Pattern correct | HTTP proxy, forwards `Mcp-Session-Id` | **REJECT** — its auth test asserts `"mcpx_pat_abc123xyz".starts_with("mcpx_pat_")`, exercising zero production code; the only e2e artifact is a manual curl script with committed secrets |

**The headline finding: none of the four clears the full bar.** Not one has a test driving
`initialize → initialized → tools/call` *through the proxy*, and **not one has a test where tenant
A's credential attempts to read tenant B's stored data and is denied.** AWS's `LeadingKeys` policy
— the strongest isolation mechanism surveyed — is never exercised: its integration test mocks
DynamoDB and hardcodes a single tenant. Context-forge's nearest equivalent mocks the
`PermissionError` and patches out the RBAC decorators, proving only that the error renders as 403.

Two consequences for M7. First, the isolation test in Coverage Corner 1 has **no reference
implementation to copy** — it must be written from the contract, and doing so puts this integration
ahead of the surveyed field rather than at parity. Second, the IBM body-first tenant read is a
concrete anti-pattern worth an explicit negative test here: a request whose *body* claims tenant B
under tenant A's token must be denied. That is exactly the `workspace_id == tenant_id` /
"resolve a Principal, never trust the body" invariant (`theo-data/CLAUDE.md` invariants 2-3), so the
platform's design already anticipates the failure — the test proves it holds through the proxy hop.

**Anti-pattern to avoid, observed in the wild:** context-forge's `ensure_not_auth_error` helper
calls `pytest.skip` on 401/403, so a live run without a token goes **green by skipping**. A guard
that can pass by not running is worse than no guard.

## Cross-cutting Comparison

How the three candidate wirings compare on the dimensions that matter for this decision.

| Dimension | A. MCP via gateway at the edge (**chosen**) | B. Route `/v1/memory` + `/mcp` to the k3d BFF | C. Keep clients on the raw REST (status quo) |
|---|---|---|---|
| Secrets on the client | One scoped `theo_live_*` | One scoped `theo_live_*` | None — because there is no auth at all |
| CWE-441 (confused deputy) | Closed — gateway strips the client key and mints per-tenant | **Re-opened** — bypasses the ForwardAuth edge | N/A — no tenancy enforced |
| Tenant isolation | Enforced at edge + upstream scope check | Depends on BFF proxy scoping only | **None** |
| Credential store | Canonical (k3d) after D2 | Canonical (k3d) already | Irrelevant — nothing validated |
| Change surface | 1 Caddy directive + 1 env var | Caddyfile re-route; abandons Model B | Zero |
| Spec alignment | Streamable HTTP + static bearer (tolerated) | Same | Same |
| Verdict | Preserves the architecture the platform paid for | Convenience that deletes a security boundary | Unacceptable — issue #101 |

## ADRs

### D1 — Expose the gateway at the public edge; do not re-point `/v1/memory` at the k3d BFF

**Decision:** Add `handle /mcp/* { reverse_proxy localhost:8092 }` to the `app-dev.usetheo.dev`
block in `theo/infra/local/Caddyfile`, mirroring the existing `/v1/memory/*` block.

**Rationale:** The gateway already runs and is fail-closed; the only missing piece is public
routing.

**Alternatives considered:** Routing memory/MCP traffic to the k3d BFF (`:13002`) because its
database already holds the keys — **rejected**: it bypasses the ForwardAuth edge and re-opens the
CWE-441 half the platform deliberately closed (`theo-data/CLAUDE.md` invariant 1; the
`provision-model-b.sh` rationale quoted above). Convenience is not a reason to delete a security
boundary.

**Consequences:** The MCP surface inherits the Model B guarantees unchanged; the change is one
reversible directive on shared infrastructure.

### D2 — Make the k3d store canonical; re-point the validator, not the minter

**Decision:** Point the compose `theo-cloud` (the ForwardAuth validator) at the k3d Postgres.

**Rationale:** The dashboard's store holds the real state (12 keys, 4 users, 4 tenants) while the
compose store is empty (0/0/0). Schemas are identical — 48 tables each, `theo_api_keys` with the
same 14 columns — so this is configuration, not migration.

**Alternatives considered:** Seeding keys into the compose database — **rejected**: duplicates
state and guarantees future divergence. Asking users to mint keys twice — **rejected**: pushes an
infrastructure defect onto users.

**Consequences:** Authorization outcomes become real rather than uniformly denied; the transport
to reach the k3d Postgres from a container must be chosen deliberately (see Unresolved Question 1).

### D3 — Static bearer over OAuth for the client

**Decision:** Register the MCP server with `--transport http … --header "Authorization: Bearer
theo_live_*"`.

**Rationale:** Claude Code documents `--header` for remote servers, and the platform already mints
`theo_live_*` keys with per-verb scopes.

**Alternatives considered:** Implementing the OAuth 2.1 + RFC 9728 + RFC 8707 stack — **rejected**:
correct per spec for a public resource server, disproportionate for a dev-environment integration,
and unnecessary since the client supports static headers.

**Consequences:** Honest caveat — the MCP spec *tolerates* rather than blesses a static token. If
the gateway later advertises itself as an OAuth resource server it must stop accepting static
tokens on that surface, because the spec then forbids transiting any other token type.

### D4 — HTTP transport, not SSE

**Decision:** Use `--transport http` (Streamable HTTP).

**Rationale:** Claude Code documents SSE as deprecated; the MCP spec superseded HTTP+SSE with
Streamable HTTP as of 2025-03-26.

**Alternatives considered:** SSE — **rejected** despite `themory mcp` supporting it for OpenMemory
compatibility; that surface exists for a different client population.

**Consequences:** The gateway must speak Streamable HTTP end-to-end, including preserving
`MCP-Protocol-Version` and `Mcp-Session-Id` across the proxy hop (Unresolved Question 2).

## Recommendations

Ordered by dependency; each is verifiable before the next begins.

1. **Re-point the ForwardAuth validator at the canonical store (D2).** Nothing else can be proven
   while every credential is uniformly denied. Verify: a valid `theo_live_*` against
   `app-dev.usetheo.dev/v1/memory/skills` stops returning 401.
2. **Add the `/mcp/*` route at the edge (D1).** Verify with the platform's own criterion — a
   request with no credential must return 401/403, and the response must not be `text/html`.
3. **Determine the capability segment** the gateway expects for theo-memory (Unresolved Question 3);
   it becomes distinguishable the moment a valid credential reaches the gateway.
4. **Register the client (D3, D4)** with `--transport http --scope user` and a scoped key, then
   prove a `remember` → `recall` round-trip through the edge from a *new* Claude Code instance.
5. **Land the regression guard** asserting the five properties in Coverage Corner 1 — in particular
   the Content-Type assertion, which is what would have caught this failure mode on day one.
6. **Close issue #101 separately.** M7 removes the client's dependence on the unauthenticated
   endpoint but does not close the port; that remains an open exposure.

## Drawbacks & Risks

1. **Both fixes are in another repository and on shared infrastructure (HIGH).** The Caddyfile
   lives in `theo/infra/local/`, the compose configuration in `theo-workspace/`. Changing the dev
   edge affects everyone using it. Mitigation: change one directive at a time, verify with the
   platform's own smoke assertions, and keep both reversible.
2. **Re-pointing the validator changes which tenants exist (MEDIUM).** The compose store is empty,
   so nothing is lost — but any consumer that silently depended on the empty store's behaviour
   (everything denied) will start seeing real authorization outcomes. That is the intent, and it
   should still be stated rather than discovered.
3. **The port-forward is bound to `127.0.0.1` (MEDIUM).** `kubectl … port-forward svc/postgresql
   15432:5432` is not reachable from containers via the bridge (`172.17.0.1` refuses). Re-pointing
   the compose validator needs the NodePort, a `--address 0.0.0.0` forward, or the cluster IP —
   each with a different durability profile across reboots.
4. **`themory_app` remains unauthenticated on the public internet (HIGH, pre-existing).** Issue
   #101. M7 removes the *client's* dependence on it but does not close the port.

## Unresolved Questions

1. Which mechanism should carry the compose validator to the k3d store durably — NodePort, a
   `--address 0.0.0.0` port-forward, or moving the data-plane into k3d entirely? The third is the
   real convergence, and it is larger than M7.
2. Does the Theo MCP Gateway preserve `MCP-Protocol-Version` and `Mcp-Session-Id` across the proxy
   hop? Untested — and a failure here surfaces as a spurious 404 rather than an auth error.
3. Which capability segment name does the gateway expect for theo-memory (`memory`, `themory`,
   …)? All segments answered 401 identically, so the name cannot be distinguished until a valid
   credential reaches the gateway.
