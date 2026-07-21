---
slug: claude-code-mcp-gateway-dev
milestone_id: M7
date: 2026-07-21
plan: knowledge-base/plans/claude-code-mcp-gateway-dev-plan.md
blueprint: knowledge-base/discoveries/blueprints/claude-code-mcp-gateway-dev-blueprint.md
audit: knowledge-base/audits/claude-code-mcp-gateway-dev-code-quality-2026-07-21.md
---

# Implementation — M7: Claude Code via the Theo MCP Gateway (dev)

## Goal

Every Claude Code instance reaches theo-memory in the dev environment through the Theo MCP
Gateway behind Traefik, holding exactly one secret (a scoped `theo_live_*`), with the gateway
performing MCP-aware auth plus downstream per-tenant credential injection (Model B).

## What shipped

| Area | Change | Commit |
|---|---|---|
| Security | `THEMEMORY_REQUIRE_CREDENTIAL=true` on the dev deploy — closes issue #101 | `98900ad` |
| Security | `THEMORY_ADMIN_BOOTSTRAP_TOKEN` mounts the key-lifecycle API (Model B needs it to mint) | `98900ad` |
| Product | MCP upstream service (`themory mcp`, streamable-http + TLS + `--auth api-keys`) | `ee6fb05` |
| Product | **One session per client** on streamable-http (`McpSessionRegistry`) | `5c44f8d` |
| Tests | Edge-contract regression suite (9 cases incl. concurrent clients + cross-tenant) | `71d368e` |
| Tooling | `/code-quality` made runnable here (languages format + plan resolution) | `4b61580` |
| Tooling | Audit filed beside its plan; `report_path` no longer always null | `f6140ca` |
| Deploy | MCP upstream redeployed and version-gated alongside the REST API | `4c46d29` |

Infrastructure changes outside this repo (all backed up, listed in
`knowledge-base/roadmap-runs/M7-2026-07-21.md`): the ForwardAuth validator re-pointed at the
canonical credential store, `/mcp/*` routed at the public edge, `THEMORY_PLATFORM_ADMIN_KEY`
provisioned on theo-cloud, and the dev MCP certificate re-issued with the service-name SAN.

## The defect this milestone was actually about

The milestone reads "every Claude Code instance". Registering the first client worked; the
second returned:

```
HTTP 400 {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"}}
```

`connectStreamableHttp` shared ONE `StreamableHTTPServerTransport` across all requests. An SDK
transport binds its session at the first `initialize`, so **exactly one MCP client could ever
use the server** — the milestone objective was unreachable, and nobody had noticed because
nobody had connected two clients.

Fixed with the SDK-canonical shape: `McpSessionRegistry` keyed by `Mcp-Session-Id`, one
transport plus one `McpServer` per session, eviction on close (a disconnected client must not
pin its server), and 404 rather than a silent new session for an unknown id.
`connectStreamableHttp` takes a server factory now, because an `McpServer` binds one transport
at a time.

Note on the pre-existing source comment: it anticipated only the multi-*instance* case
("load-balanced, no sticky session"). The single-instance case was already broken.

## Wiring triad

| Pillar | Evidence |
|---|---|
| Caller | `run-mcp-server.ts` passes `makeServer` into `connectStreamableHttp`; the deployed `themory_mcp` service is the gateway's upstream |
| Integration test | `packages/mcp/src/transports/streamable-http-multisession.test.ts` (real HTTP handshakes) + `tests/integration/mcp-edge/gateway-contract.test.ts` (live edge) |
| Runtime metric | Gateway emits `mcp.forward` / `mcp.deny` per request with capability + tenant + request_id; used throughout this milestone to localize each failure |

## Evidence

Public edge, `POST https://app-dev.usetheo.dev/mcp/memory` with `Authorization: Bearer theo_live_*`:

```
HTTP/2 200 · content-type: text/event-stream · mcp-session-id: 5d7ec287-…
{"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"themory","version":"0.3.0"}}}
```

Fail-closed on the data plane (issue #101), same host, no credential:

| Request | Before | After |
|---|---|---|
| `POST /v1/remember` | 201 CREATED | 401 `UNAUTHORIZED` |
| `POST /v1/recall` | 200 | 401 |
| `POST /v1/admin/keys` | 404 (unmounted) | 401 (mounted, gated) |

Suites: transports 39/39; MCP package 140/141; typecheck 0 errors; `/code-quality` **PASS (100)**,
zero hard caps.

## Honest caveats

- The one MCP-package failure is `run-mcp-server.test.ts` FC2-T1.1: a 5s timeout on a ~6s test.
  It passes at `--testTimeout=30000` and is equally slow on `origin/develop` (verified by
  stashing), so it is pre-existing slowness, not a regression from this work.
- `D2` (symbol fabrication) needs the `--no-network` FLAG when the npm registry is unreachable.
  The env var alone leaves D2 active and it reports 64 `symbol_fab_unverifiable` HARD findings
  that are registry-access artifacts, not defects.
- This repo carries TWO knowledge-base trees (`.claude/knowledge-base/` and root
  `knowledge-base/`). Cycle artifacts are split across them. Out of scope here; worth a
  consolidation decision.
- Credentials that transited this work must be rotated: the Cloudflare token readable via `ps`
  on the dev host, the OpenAI key, and the `theo_live_*` keys used for probing.
