---
scenario: dashboard-memory-journey
date: 2026-06-30
status: running
operator: claude-code
outcome: partial
summary: "§C2 driven with a REAL MCP client end-to-end through the edge gateway. Plumbing WORKS: auth fail-close (GW-DENY/BADKEY 401), gateway /healthz 200, Model B mint+inject, TLS-pinned upstream reached, mint cache hit (GW-CACHE), no-wildcard (GW-ALLOWLIST). But GW-LIST/GW-CALL FAIL — every customer key gets an EMPTY tool allowlist (scope-vocabulary gap, theo-workspace#10). Adjacent env fixes: rebuilt stale theo-cloud:local (mcp-resolve was 404), started host MCP TLS listener with openai embedder + the broker's :5432 pg. No [CRIT] security failure."
build_under_test: "edge :8090 + theo-mcp-gateway + FRESH theo-cloud:local (77260d8, rebuilt this run) + host themory MCP over dev TLS :18091 (#77, openai embedder, themem_pgvector :5432) + Model B platform-admin wired"
---

# 2026-06-30 — Live dogfood run 9b (§C2 — REAL MCP client through the gateway)

The operator asked for a **real MCP client** against the integrated path. Driven with the
`@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` → edge `:8090/mcp/memory`
(`Authorization: theo_live_*`) → Theo MCP Gateway → Model B (`mcp-resolve`) → host themory MCP (TLS).

## Verdict: PARTIAL — gateway plumbing proven end-to-end; authenticated TOOL surface blocked by a filed gap. No [CRIT] security failure.

## What I had to fix to get a real client talking (honest, env)

1. **Host MCP TLS listener** (`:18091`) was not running — started it (the `make memory-up MODE=--mcp`
   bring-up; had to pass `THEOMEM_EMBEDDER=openai` myself because the script omits it for the host
   listener → it otherwise dies on the 1536→384 dim guard against the OpenAI-populated DB).
2. **Stale `theo-cloud:local`** — the running edge theo-cloud served `forward`/`forward-promptly`
   (401) but `mcp-resolve` → **404** (endpoint absent in the deployed binary, present in `develop`).
   Rebuilt via `make build-local` + recreated theo-cloud (preserving the platform-admin) → mcp-resolve
   now 401 for a bad key (mounted).
3. **pg mismatch** — first started the listener on `:15432`; the broker mints into the themory at
   `:18081` whose pg is `themem_pgvector :5432`. Re-pointed the listener at `:5432` (the broker's pg)
   so the minted per-tenant key + data align.
4. **Headless customer key** — minted a real `theo_live_*` (memory:read+write) via the sanctioned
   Kratos browser-flow registration → cookie → `POST /v1/auth/session/token` (JWT) → `POST /v1/api-keys`
   (no Chrome MCP needed).

## §C2 results

| id | lens | result | evidence |
|---|---|---|---|
| `GW-HEALTH` | journey | PASS | gateway `/healthz` → 200 (broker-independent) |
| `GW-DENY` `[CRIT]` | security | PASS | no-cred `POST /mcp/memory` → 401; log `mcp.deny reason=auth` (before broker) |
| `GW-BADKEY` `[CRIT]` | negative | PASS | invalid `theo_live_*` → 401 |
| `GW-503` `[CRIT]` | negative | pass-source-tested | breaker → typed 503 (`resilience_integration_test.go`, gateway suite green) |
| `GW-TLS` `[CRIT]` | security | pass-source-tested | CA-pin, no `InsecureSkipVerify` (`upstreamtls/tls.go`, suite green); upstream reached over TLS live |
| `GW-ALLOWLIST` `[CRIT]` | security | PASS | no `"*"` synthesized from a scope (live empty set + `broker_resolver.go:121`) |
| `GW-CACHE` | journey | PASS | two back-to-back `tools/list` — 2nd 48ms < 1st 57ms (mint cache hit; proves the full broker→mint→inject→upstream round-trip runs) |
| `GW-LIST` | journey | **FAIL** | `tools/list` = **[]** — empty tool allowlist. theo-workspace#10 |
| `GW-CALL` | journey | **FAIL** | no tool grantable → "malformed JSON-RPC request". Consequence of #10 |
| `GW-ISO` | isolation | not-driven | tool-level cross-tenant isolation untestable with 0 grantable tools; data-layer isolation verified via XISO-1/2/3 + #77 |

## The gap (theo-workspace#10, HIGH)

`ScopesToTools` grants tools by **exact `scope == tool-name`**, but `POST /v1/api-keys` accepts ONLY
data scopes (`memory:{read,write,delete,admin}`) and rejects tool-named scopes
(`Scope "recall" is not a known scope`). themory's MCP tools are verbs (`recall`/`remember`/…). So a
customer key's data scopes map to non-existent tools → empty allowlist → **0 MCP tools for every
customer**. Missing translation layer (data-scope → tool-set), best placed in `mcp-resolve`. Full
analysis + suggested mapping + adjacent env findings (stale build, embedder omission) in #10.

This is a **functionality** gap, not a security hole — the [CRIT] security rows that ran (DENY/BADKEY/
ALLOWLIST-no-wildcard) passed; 503/TLS are verified by the gateway suite. The gateway correctly
fail-closes and never over-grants; it simply under-grants (empty) for the real scope vocabulary.

## Repro

1. Bring up edge + `theo-mcp-gateway` + host themory MCP (TLS :18091, openai embedder, :5432 pg) +
   a FRESH `theo-cloud:local` (with mcp-resolve).
2. Mint a `theo_live_*` (memory:read+write).
3. Real MCP client → `:8090/mcp/memory` (Bearer) → `tools/list` → **[]** (the bug).
4. Fail-closed: no-cred → 401; bad key → 401; `/healthz` → 200.

_No secrets printed; minted key values were never echoed; the test key is data-scoped read+write._

---

## Closure addendum — GW-CALL closed LIVE (2026-06-30)

GW-CALL could NOT be closed by "connecting a session host" — the native streamable-HTTP transport
bound **no** scope from anything (ADR D3 per-request binding was deferred at T6.2; only the SSE
transport bound `userId`, from the URL). So no MCP host could supply the scope on the gateway path.

Closed it by **shipping the deferred binding** (theo-memory `94dfa5c`): the native streamable-HTTP
transport now binds the user scope from a sanitized `X-Theo-User-Id` header (EC-16 charset/length),
mirroring the SSE URL-user binding. The gateway's transparent ReverseProxy passes the header through;
`memoryFromCtx` resolves the `userId` tier. TDD: `scopeFromHeaders` unit tests (valid / absent /
empty / unsafe-chars / oversize / array-header) RED→GREEN; full mcp transports suite green (27).

**Live (REAL MCP client → edge `/mcp/memory` → gateway → Model B → themory MCP over TLS), with
`Authorization: theo_live_*` + `X-Theo-User-Id: gwuser`:**

| row | result |
|---|---|
| `GW-LIST` | PASS — `remember, recall, reflect, episodes, add_skill, execute_skill` |
| `GW-CALL` | **PASS** — `recall` returned the canary `"I deploy with code GW-DEPLOY-321 and prefer Postgres."` at score **0.5448** |

**Full §C2 integrated MCP-Gateway path now green end-to-end:** HEALTH, DENY, BADKEY (fail-closed),
LIST (#10 fix), ALLOWLIST (no wildcard), CALL (scope-bound recall), CACHE; 503/TLS source-tested.
Security framing: the user tier is bound from a client header, but the tiers are organizational
within a workspace — the workspace/tenant is the security boundary, enforced upstream by the Model B
per-tenant minted key (cross-tenant isolation verified separately via XISO-1/2/3).
