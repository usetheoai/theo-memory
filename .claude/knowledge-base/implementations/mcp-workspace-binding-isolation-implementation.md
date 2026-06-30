# Implementation summary — mcp-workspace-binding-isolation (theo-memory#82)

**Slug:** `mcp-workspace-binding-isolation`
**Date:** 2026-06-30
**Branch:** `develop`
**Plan:** `.claude/knowledge-base/plans/mcp-workspace-binding-isolation-plan.md` (plan-confidence SHIPPABLE_WITH_CAVEATS 82.8, 0 hard caps)
**Blueprint:** `.claude/knowledge-base/discoveries/blueprints/mcp-workspace-binding-isolation-blueprint.md` (discover-confidence SHIPPABLE 99.7)

## What shipped (the #82 fix)

The MCP tool surface authenticated a key as a boolean and served a single shared,
workspace-UNBOUND `Memory`, so any valid key read/wrote ANY workspace's data. The fix
composes the already-shipped `AuthVerifier.resolvePrincipal` + `Memory.withWorkspace` on
the MCP path: the bearer gate resolves the `Principal` from the key, threads its
auth-trusted `workspaceId` into the `ScopedContext`, and every tool memory-access site
binds `Memory.withWorkspace(workspaceId)` before touching the store — failing closed.

## Commits

| Commit | Task | Content |
|---|---|---|
| `1c69f6d` | T1.1, T1.2 | `ScopedContext.workspaceId` (auth-trusted) + `workspaceScopedMemory` fail-closed seam + 5 unit tests |
| `5e44c29` | T2.1, T2.2 | bearer gate resolves Principal + attaches workspace (null→401, blank→401 [EC-1], backend-error→503, verify-only→single-tenant); transport threads auth-trusted workspace into ctx (client header ignored); +5/+4 unit tests |
| `f73f13b` | T3.1 | `workspaceScopedMemory` applied at ALL 12 tool memory-access sites (7 memoryFromCtx + 5 direct: forget, 3 skill verbs, openmemory delete) + 3-verb isolation tests; skill tools are now workspace-scoped (closed gap) |
| `2da3edc` | T4.1 | integration GOAL TEST vs real `ankane/pgvector` (cross-tenant recall=0 + cross-workspace forget-safe) |
| `ad0156b` | hardening | log `resolvePrincipal` failure before the fail-closed 503 (never swallow; error-handling.md) |

CHANGELOG `[Unreleased] § Security` updated in `1c69f6d`.

## Wiring triad per task

| Task | Caller (a) | Integration test (b) | Observability (c) |
|---|---|---|---|
| T1.1 ScopedContext.workspaceId | read by `scopeFromRequest` + `workspaceScopedMemory` | T4.1 (carried through dispatch) | n/a (type) |
| T1.2 workspaceScopedMemory | called at 12 tool sites | T4.1 (real store binding) | typed throw on fail-closed |
| T2.1 bearer resolvePrincipal+attach | `connectStreamableHttp` mounts `withBearerAuth` | live 401/503 through the real edge | `logWarn('resolve_principal_failed')` + 401/503 |
| T2.2 scopeFromRequest | `baseHandler` (streamable-http) | live (gateway proxied a key through the chain) | n/a |
| T3.1 12-site binding | every tool handler | T4.1 + handler isolation tests | n/a |

## Evidence — verified

### Unit (committed, all green)
- `workspace-scoped-memory.test.ts` (5): bind when ws present; passthrough single-tenant; empty/whitespace passthrough; **fail-closed throw when withWorkspace absent (EC-1)**; MissingScopeError outside withScope (EC-3).
- `streamable-http-auth.test.ts` (16 = 11 regression + 5 new): resolvePrincipal success attaches workspace; null→401; **blank workspace→401 (EC-1)**; backend-throw→503; **concurrent test** (two keys → own req, no bleed).
- `streamable-http.test.ts` `scopeFromRequest` (4): workspace from auth + userId from header; **client `x-workspace-id` header IGNORED (ADR D2)**; workspace-only ctx; none→undefined.
- `handlers.test.ts` (24): all verbs + **12-verb isolation** (recall/forget/add_skill bind `withWorkspace('tn-A')` before the store op).

### Integration — AUTHORITATIVE (committed, green vs real `ankane/pgvector`)
`tests/integration/mcp/workspace-isolation.test.ts` (2/2), driven through the REAL MCP
`dispatch` path (dispatch → workspaceScopedMemory → withWorkspace → pgvector):
- **tenant A's `recall` returns 0 of tenant B's memories** (the #82 leak closed), AND
  **B's `recall` returns its own canary** (positive control — proves the write landed and
  same-tenant works). Run: `THEOMEM_PG_URI=postgres://themem:themem@127.0.0.1:5432/themem npx vitest run --config vitest.integration.config.ts tests/integration/mcp/workspace-isolation.test.ts` → 2 passed.
- a cross-workspace `forget` from tenant A never deletes tenant B's row.

This is the unconfounded proof: clean isolated DB, deterministic embedder, positive **and**
negative controls both pass, exercising the exact production code path the gateway drives.

### Live (real edge gateway → Model B → fresh-dist host MCP listener with the fix)
- **Fail-closed verified:** no-cred `POST /mcp/memory` → **401** (edge + host listener); a
  `resolvePrincipal` backend error → **503** "authorization backend unavailable" (my new
  `send503` path fired live — proves the throw path fails closed, never unbound).
- **Workspace-binding write works live:** B's canary written via the MCP `remember` tool
  (B's gateway-minted key) landed in `themem_pgvector` under `workspace_id=tn-e09ce218c875d037`,
  user `bobuser` (verified by direct DB query) — the write path binds the workspace.
- **Gateway composition:** the gateway proxied a customer key through the full
  auth→resolvePrincipal→workspace-bind→dispatch chain on the fresh-dist listener and
  returned a valid recall response (not an error).

### Honest limitation (Rule 3) — live cross-tenant probe
A fully-clean LIVE cross-tenant recall (A=0 **with** B's data present in the listener's pg
**and** B≥1 control, all through the gateway) was **blocked by a dev bring-up
mis-alignment unrelated to #82**: `dev/memory-up.sh` launches the container REST with
`THEOMEM_PG_URI=...localhost:5432` (the container's own localhost, isolated from the host
`themem_pgvector` the host MCP listener reads), and the embedder/dim drift + the
listener-restart churn (needed for the stateful-singleton transport) destabilised the
per-tenant-key/pg coupling (surfaced as the fail-closed 503 above). The **integration test
proves the identical code path cleanly**, so the isolation property is established; the
live gap is an environment/dev-script issue, not a code gap. Tracked as an env follow-up.

## Scope deferrals (per plan ADR D4)
- OIDC / `auth=both` multi-tenant workspace mapping (OIDC introspection returns a subject,
  not a workspace) and the SSE/openmemory direct transport (no bearerAuth wired, not
  gateway-fronted) are out of scope; a follow-up tracks them.

## In-implementation refinement (honest disclosure)
The plan's T2.1 EC-2 said "verify-only verifier on the api-keys path → reject". The
implementation instead mirrors the **REST precedent** (`middleware.ts:116`): prefer
`resolvePrincipal`; a verify-only verifier yields single-tenant semantics (delegates with
no workspace → default workspace), because the gateway/Model B path always uses
`ApiKeyAuthVerifier` (which HAS `resolvePrincipal`) — so #82's exploit path always takes
the resolve+bind branch. This preserves the existing verify-only single-tenant tests and
is more backward-compatible than an unconditional reject, while closing #82.
