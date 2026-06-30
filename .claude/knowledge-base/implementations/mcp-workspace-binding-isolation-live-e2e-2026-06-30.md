# Live e2e evidence — mcp-workspace-binding-isolation (theo-memory#82)

**Date:** 2026-06-30
**Operator:** claude-code
**Build under test:** edge `:8090` (theo-workspace traefik) + theo-mcp-gateway + theo-cloud Model B + host themory MCP listener on `:18091` over dev TLS, running the FRESH `dist/` built from this branch (contains the #82 fix — `dist/mcp/src/tools/workspace-scoped-memory.js` present). Listener pid 113158 at time of writing.

## Purpose

theo-data invariant 6 ("Prove isolation through the REAL edge"). Re-run the live #82 repro
through the integrated MCP-Gateway path and capture the fail-closed + workspace-binding
behavior end-to-end. This file is the honest record of what was and was NOT reproducible.

## What was verified LIVE (through the real edge)

| Probe | Result | Evidence |
|---|---|---|
| no-cred `POST /mcp/memory` (edge) | **401** | gateway fail-closes before any broker/upstream call |
| no-cred host listener `:18091` (TLS) | **401** | listener fail-closes |
| customer registration + key mint (2 tenants A, B) | **OK** | Kratos browser flow (`/self-service/registration/browser`) → `POST /v1/auth/session/token` (JWT) → `POST /v1/api-keys` → `theo_live_*` for tenant A and tenant B (distinct workspaces) |
| MCP `remember` (tenant B's gateway key) writes B's canary | **OK, workspace-bound** | landed in `themem_pgvector` under `workspace_id=tn-e09ce218c875d037`, user `bobuser` (direct DB query confirmed) — the workspace-binding WRITE path works live |
| `resolvePrincipal` backend error → **503** | **fail-closed** | the new `send503` path fired live ("authorization backend unavailable") when the auth-backend resolution failed — proving the throw branch fails closed, never serving unbound |
| gateway composition | **OK** | the gateway proxied a customer key through the full auth → resolvePrincipal → workspace-bind → dispatch chain on the fresh-dist listener and returned a valid (non-error) recall response |

## What was NOT completed live (honest disclosure, Rule 3)

The fully-clean LIVE cross-tenant assertion — **A's key recalls 0 of B's workspace AND B's
key recalls its own canary (≥1)**, both through the gateway — was **blocked by a dev
bring-up mis-alignment unrelated to the #82 fix**:

- `dev/memory-up.sh` launches the container REST with `THEOMEM_PG_URI=...localhost:5432`
  (the container's OWN localhost, isolated from the host `themem_pgvector` the host MCP
  listener reads), so REST-written data and the listener's store diverge.
- The MCP write path DID reach the listener's store (`themem_pgvector`, workspace `tn-e09`),
  but completing the cross-tenant probe required multiple listener restarts (the transport
  is a stateful singleton — one MCP session per listener lifetime), and the restart churn
  destabilised the per-tenant-key/pg coupling, surfacing as the fail-closed **503** above.

Therefore **theo-data invariant 6 is PARTIALLY met**: the workspace-binding write path and
all fail-closed branches are proven live, but the live cross-tenant *recall* assertion is
not captured. The isolation PROPERTY is established by the **integration GOAL TEST**
(`tests/integration/mcp/workspace-isolation.test.ts`, 2/2 against real `ankane/pgvector`),
which exercises the IDENTICAL production code path (dispatch → `workspaceScopedMemory` →
`Memory.withWorkspace` → store) with a positive control (B sees its own) and a negative
control (A sees 0). The integration test substitutes for the property; it does not
substitute for the real-edge transcript.

## Follow-up

- Env: fix `dev/memory-up.sh` so the container REST and the host MCP listener share one pg
  (`host.docker.internal:5432`) with a matched embedder dim, so a clean live cross-tenant
  recall transcript can be captured. Tracked alongside theo-memory#83 (dev/CQ infra).
- Then re-run: A's key + `X-Theo-User-Id` recalls B's canary → assert 0; B's key → assert ≥1.

_No secrets in this file: minted key values were never echoed; the canary
`BRAVO-LEAK-CHECK-7788` is a disposable test value._
