---
scenario: dashboard-memory-journey
date: 2026-06-30
status: running
operator: claude-code
outcome: partial
summary: "§C2 MCP-Gateway path (new modality): fail-closed contract DRIVEN LIVE + PASS (GW-HEALTH 200, GW-DENY 401 [CRIT], GW-BADKEY 401 [CRIT] — integrated edge /mcp/* path wired, fail-closes at auth BEFORE broker). The [CRIT] resilience/security invariants (GW-503 503-not-401, GW-TLS CA-pin/no-InsecureSkipVerify, GW-ALLOWLIST no-wildcard) verified by the gateway's own test suite (green). Authenticated rows (LIST/CALL/ISO/CACHE) NOT driven live — blocked by Chrome-MCP-down (no headless theo_live_* mint) + host MCP TLS listener not up. No [CRIT] failure."
build_under_test: "edge :8090 + theo-mcp-gateway (theo-traefik-mcp, compose up 2h) + themory #77 :18081; host MCP TLS listener (:18091) NOT running this session"
---

# 2026-06-30 — Live dogfood run 9 (§C2 — the integrated MCP-Gateway path)

New modality added to the catalog (~192 rows): §C2 drives the **production-shaped** MCP path —
MCP client → edge `:8090/mcp/memory` → **Theo MCP Gateway** (`theo-traefik-mcp`) → Model B
(`theo-cloud /internal/authz/mcp-resolve`) → host themory MCP over dev TLS. This run validates the
parts reachable headless this session (Chrome MCP is disconnected).

## Verdict: PARTIAL — fail-closed contract green live; authenticated rows deferred (reasoned). No [CRIT] failure.

## §C2 driven LIVE — PASS (3)

| id | lens | got | want | evidence |
|---|---|---|---|---|
| `GW-HEALTH` | journey | 200 | 200 | gateway `/healthz` via compose net (`theo-mcp-gateway:18090`) — broker-independent |
| `GW-DENY` `[CRIT]` | security | 401 | 401 | `POST /mcp/memory` no credential → **401 fail-closed**; gateway log `WARN mcp.deny reason=auth capability=memory` proves the deny is at the **auth layer BEFORE any broker/upstream call** |
| `GW-BADKEY` `[CRIT]` | negative | 401 | 401 | invalid `theo_live_*` → 401 (never 200) |

The integrated `/mcp/*` edge path **is wired** (the new `mcp-gateway-edge` router resolves to the
gateway, no middleware) and fail-closes correctly.

## §C2 [CRIT] invariants — verified by the gateway test suite (source + tests, not live)

`go test ./internal/{auth,gateway,upstreamtls,resilience}` in `theo-traefik-mcp` → **all ok**.

| id | invariant | evidence |
|---|---|---|
| `GW-503` `[CRIT]` | broker/upstream outage → **503**, never 401 | `internal/gateway/resilience_integration_test.go` "dead upstream trips the breaker; open breaker returns a typed 503" (`TestGateway_BreakerOpen_Returns503`) |
| `GW-TLS` `[CRIT]` | CA-pinned upstream, **no `InsecureSkipVerify`** | `internal/upstreamtls/tls.go` — "CA-pinning… RootCAs REPLACES the system pool (EC-3)", TLS 1.2 floor; package built so probe + proxy never diverge |
| `GW-ALLOWLIST` `[CRIT]` | `"*"` **never** synthesized from a scope | `internal/auth/broker_resolver.go:121` "the wildcard `*` is NEVER granted from a scope … never let a scope become the admin wildcard" |
| (deny vs backend) | auth-deny carries empty tenant (EC-2), distinct from a backend 503 | `internal/gateway/decision_event_test.go` |

These are coded correctly and green in the gateway's own suite. They were NOT driven through the
live edge this session (see below) — recorded as `pass-source-tested`, not a live PASS.

## §C2 NOT driven live (honest, reasoned) — GW-LIST / GW-CALL / GW-ISO / GW-CACHE (+ live GW-503/TLS/ALLOWLIST)

Blocked by two environmental gaps this session:
1. **Chrome MCP is disconnected** → I cannot mint a dashboard `theo_live_*` customer key. The only
   sanctioned mint path is `POST /v1/api-keys`, which is **RequireJWT** (`api_keys.go:50`) — it needs
   a browser/Kratos session. Headless `POST /v1/auth/register` returned 404 (it is a Kratos
   self-service proxy, not a direct JSON register). Inserting a key into pg-cloud by hand is the
   "no chute" anti-pattern we avoid.
2. **Host themory MCP TLS listener (`:18091`, `make memory-up MODE=--mcp`) is not running** — the
   gateway has no upstream to front, so the authenticated tools/list + call + isolation + cache rows
   cannot reach themory.

Per the skill's Phase 0.5b ("record SKIPPED with the reason — never a fabricated pass"), these are
deferred, not failed. To finish them live: bring up `make memory-up MODE=--mcp` and provide a
`CONSUMER_KEY=theo_live_*` (operator-provisioned via the dashboard, or once Chrome MCP reconnects).

## Regression

No regression. This run only touched §C2; the browser/http/cli/sdk/§C-direct surface is unchanged
from runs 6–8 (baseline). Also flipped `EDGE-SKL-1` → pass (theo-workspace#7 fixed + verified — the
`memory-gateway-edge` router now routes customer `/v1/memory/skills` to the gateway).

## Repro

1. Stack already up (`make up`); edge `:8090`, themory `:18081`, gateway compose service up.
2. Fail-closed: `curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8090/mcp/memory -d '{}'` → **401**; same with an invalid `theo_live_*` → **401**; gateway `/healthz` (compose net) → 200.
3. Invariants: `cd theo-traefik-mcp && go test ./internal/{auth,gateway,upstreamtls,resilience}` → ok.
4. To finish authenticated rows: `make memory-up MODE=--mcp` + `CONSUMER_KEY=theo_live_…` then drive a real MCP client at `:8090/mcp/memory`.

_No secrets printed; the invalid `theo_live_*` in GW-BADKEY is a non-functional placeholder._
