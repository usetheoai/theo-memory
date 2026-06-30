# Blueprint: MCP workspace-binding isolation (per-request Principal → workspace-scoped Memory)

> Terminal artifact of `cycle-discover` for theo-memory#82. Answers the 6 research questions of
> `discoveries/plans/mcp-workspace-binding-isolation-plan.md` (v1.1) with line-exact citations, and
> yields a concrete, fail-closed design + file-change list directly consumable by `/to-plan`.

**Slug:** `mcp-workspace-binding-isolation`
**Created:** 2026-06-30
**Source plan:** `.claude/knowledge-base/discoveries/plans/mcp-workspace-binding-isolation-plan.md`
**Edge-case review absorbed:** `.claude/knowledge-base/reviews/mcp-workspace-binding-isolation-edge-cases-2026-06-30.md` (EC-1, EC-2 fold into the Q6 design below)

## Context

theo-memory#82 (CRITICAL) is a live cross-tenant leak on the MCP tool surface: tenant A's gateway-minted
key read tenant B's memory across DISTINCT workspaces. Root cause: `with-bearer-auth.ts:142` validates the
key as a boolean (`verify`), `run-mcp-server.ts:324` serves a single shared workspace-UNBOUND `Memory`
(`memoryFactory: () => memory`), and `recall-handler.ts:39` binds only the userId tier via `memoryFromCtx`.
The REST surface already closed the identical gap (#77) — this discovery confirms the seam to mirror it on
the MCP path. Triggered by the security investigation following commit `94dfa5c`, which made the leak
reachable through the gateway tool path.

## Objective

Give `/to-plan` a 95%-confidence, fail-closed design for binding the authenticated key's `workspace_id` to a
per-request workspace-scoped `Memory` on the MCP surface, validated against two independent references and
grounded in the already-shipped `resolvePrincipal` + `withWorkspace` primitives. Success = a concrete
file-change list + the fail-closed contract + the e2e proof shape, all consumable without re-derivation.

## Executive summary

The MCP tool surface leaks across tenants (theo-memory#82) because it authenticates a key as a boolean
and serves a single shared, workspace-UNBOUND `Memory`. The REST surface already solved the identical
problem (#77) with `AuthVerifier.resolvePrincipal` → `Principal{workspaceId}` → `Memory.withWorkspace`.
**Both primitives already ship.** The fix is to compose them on the MCP path: resolve the Principal from
the authenticated key, carry its `workspaceId` (auth-trusted, never body/header-supplied) into the scope
context, and bind `memory.withWorkspace(workspaceId)` per request BEFORE the user tier — failing closed
when the workspace cannot be resolved in multi-tenant mode. Two independent OSS references (`letta`, `mem0`)
confirm the per-request "resolve actor from credential → scope every store op by it" technique; neither
provides a fail-closed cross-tenant test as strong as our REST #77 + `make e2e-edge`, so OUR e2e is the
authority.

---

## Coverage Corner 1 — Integration Tests

**Q3 — how the references test tenant/org isolation + auth rejection at the boundary.**

- **mem0 (`mem0/tests/test_server_auth.py`)** runs the FastAPI app through `TestClient` (full ASGI,
  `.../test_server_auth.py:3,20`). HONEST finding: the OSS server is **permissive** — `test_get_memory_without_key`
  (`.../test_server_auth.py:76-79`), `test_search_without_key` (`:92-94`), `test_delete_all_without_key`
  (`:108-110`) all assert **200 without any key**. mem0's base server is NOT fail-closed; it is the very
  shape #82 describes (operations succeed without tenant enforcement). This is a *negative* lesson, not a
  pattern to copy.
- **letta (`letta/tests/managers/test_organization_manager.py`)** tests isolation at the *manager/DB* layer:
  org CRUD + `create_default_organization` + list-returns-only-own (`.../test_organization_manager.py:15-27,31-34`).
  It proves the "scope by org_id at the data layer" technique but does NOT exercise HTTP cross-tenant deny.

**Implication for OUR fix:** the references corroborate the *technique* but their isolation-test rigor is
weaker than ours. OUR integration obligation (implement phase) is a **hermetic ForwardAuth e2e** (the #113
`make e2e-edge` pattern) asserting: tenant A's gateway-minted key, calling `recall` for tenant B's canary
through the real edge, returns **0 results**; AND a missing/invalid credential returns 401 at the gateway.
This is stronger than any reference's test — it proves isolation through the real Model B edge.

## Coverage Corner 2 — Dependencies

**Q4 — runtime deps + confirm OUR fix needs zero new dependency.**

- mem0's per-request scoping/auth path uses FastAPI `Header` DI (`mem0/openmemory/api/main.py`); letta uses
  FastAPI `Header(None, alias="user_id")` (`letta/letta/server/rest_api/dependencies.py:38-44`). Python-only —
  technique reference, not an importable dependency.
- **OUR `packages/mcp` already declares** `@usetheo/memory`, `@usetheo/memory-api`, `@usetheo/memory-agent-core`,
  `pg` (`packages/mcp/package.json#dependencies`). The fix **reuses two already-shipped primitives**:
  - `AuthVerifier.resolvePrincipal(token): Promise<Principal|null>` — `packages/core/src/domain/dip/auth-verifier.ts:60`; concrete impl `ApiKeyAuthVerifier.resolvePrincipal` at `packages/api/src/server/auth/api-key-verifier.ts:125` (SQL `SELECT k.workspace_id, k.user_id, k.scopes, m.role` on the key hash → `:157` returns `{workspaceId,userId,role,scopes}`).
  - `Memory.withWorkspace(workspaceId): Memory` — `packages/core/src/domain/memory-store.ts:146`; concrete impl `LocalMemory.withWorkspace` at `packages/core/src/infrastructure/db/local-memory.ts:81`.
- **Decision: OUR fix adds 0 new dependencies** (parsimony ladder rung 4 — reuse what is already installed).

## Coverage Corner 3 — Tools

**Q5 — how the references run their auth/isolation tests, informing OUR e2e harness.**

- mem0 runs via `pytest` + `fastapi.testclient.TestClient` in-process (`mem0/tests/test_server_auth.py:16-20`);
  `make test` target exists (`mem0/Makefile:42`). letta uses `pytest` with a `server` fixture
  (`letta/tests/managers/test_organization_manager.py:15`).
- Both are **in-process** test clients — they do NOT exercise a gateway/ForwardAuth edge.
- **OUR tool obligation:** extend the hermetic `make e2e-edge` ForwardAuth job (theo-cloud `#113` pattern)
  with an MCP cross-tenant isolation + fail-closed assertion. Unit-level: Vitest tests for the new auth →
  workspace-context threading (mirroring the existing `streamable-http.test.ts` `scopeFromHeaders` suite).

## Coverage Corner 4 — Techniques

**Q1 — Letta: per-request actor resolution + injection (analog of `resolvePrincipal → context`).**
Letta extracts the actor from a request header via FastAPI dependency injection: `get_headers(actor_id =
Header(None, alias="user_id"))` builds a `HeaderParams` (`letta/letta/server/rest_api/dependencies.py:38-64`)
that handlers receive via `Depends(...)`; the credential→user mapping is `server.api_key_to_user(api_key=...)`
(`letta/letta/server/rest_api/auth/index.py:36`). EC-3 confirmed: the OSS `authenticate_user` is a
**placeholder** ("simply returns a UUID placeholder", `auth/index.py:31`) — so we mirror the *injection
shape* (resolve-from-credential, thread into every handler), not Letta's stubbed validation.

**Q2 — mem0: threading the per-request scope into every store op (analog of `withWorkspace` per request).**
mem0's `_build_filters_and_metadata` (`mem0/mem0/memory/main.py:231`) writes the per-request scope into BOTH
the stored metadata AND the query filters: `effective_query_filters["user_id"] = user_id` (and `agent_id` /
`run_id`, `.../main.py:286-299`). Every `add()`/`search()` is scoped by the resolved session identifiers —
the same shape as binding `workspace_id` as the outer anchor on every op.

**Q6 — the EXACT internal seam for OUR fix (decisive).**

The composition that already exists on REST:
- `bearerAuth` resolves a `Principal` via `resolvePrincipalFrom` (prefers `resolvePrincipal`; multi-tenant
  verify-only verifier → reject, no DEFAULT_PRINCIPAL collapse — `packages/api/src/server/auth/middleware.ts:105-118`),
  sets it on context (`middleware.ts:212`).
- handlers bind `workspaceBoundMemory(c, memory)` → `memory.withWorkspace(principal.workspaceId)`
  (`packages/api/src/server/handlers/_body-parsing.ts:29-33`).

The MCP gap, and the fix per file:

| # | File | Current | Change |
|---|---|---|---|
| 1 | `packages/core/src/domain/scope.ts:67` (`ScopedContext`) | `{ session?: {userId,...} }` — no workspace tier | **Add** `workspaceId?: string` (additive; theokit ctx without it unchanged) |
| 2 | `packages/core/src/infrastructure/theokit/index.ts:56` (`memoryFromCtx`) | returns `memory.user(userId)` | When `ctx.workspaceId` is a non-empty string AND `memory.withWorkspace` exists → `memory.withWorkspace(ws).user(userId)`. Fixes all 4 native handlers (recall/episodes/reflect/remember) in ONE place (DRY) |
| 3 | `packages/mcp/src/auth/with-bearer-auth.ts:142` | `apiKey.verify(token)` boolean | Prefer `apiKey.resolvePrincipal(token)`; on success attach `principal.workspaceId` to the request (auth-trusted source); `null` → 401 (already the 401 path). **EC-2:** a verify-only verifier on the api-keys (multi-tenant) path → reject, never passthrough |
| 4 | `packages/mcp/src/transports/streamable-http.ts:58` (`scopeFromHeaders` / baseHandler) | builds `{ session: { userId } }` from the `X-Theo-User-Id` header | Read the **auth-attached** `workspaceId` (from #3, trusted) + the userId header (within-workspace tier) → ctx `{ workspaceId, session: { userId } }`. Workspace comes from the KEY, never from a client header |
| 5 | e2e | none | Add the hermetic ForwardAuth MCP isolation assertion (`make e2e-edge`, #113 pattern): A's key 0-results B's workspace; no-cred → 401 |

**EC-1 fail-closed contract (load-bearing):** the MCP binding MUST NOT replicate REST's optional-chaining
passthrough (`_body-parsing.ts:32` serves UNBOUND memory when `withWorkspace` is `undefined`). On the
multi-tenant (api-keys) path, when a Principal is resolved but the concrete `Memory` lacks `withWorkspace`,
the design **fails closed** (reject) rather than serving unbound. In practice the concrete impl is
`LocalMemory.withWorkspace` (`local-memory.ts:81`), which IS present — but the contract is enforced, not
assumed. Implement-phase MUST also audit every NON-`memoryFromCtx` tool handler (forget, skills, openmemory
add/search/list/delete) for the same workspace binding — the DRY fix at #2 covers the 4 native handlers;
the rest must be confirmed or bound explicitly.

---

## ADRs (design decisions for the fix)

### D1 — Workspace tier on `ScopedContext`, bound in `memoryFromCtx` (DRY single point)
**Decision:** add `workspaceId?` to `ScopedContext` and bind it inside `memoryFromCtx` (workspace-then-user).
**Rationale:** the 4 native handlers already funnel through `memoryFromCtx`; binding there fixes all in one
place. Additive optional field keeps theokit/REST callers unchanged.
**Alternatives:** per-handler `workspaceBoundMemory` calls (rejected — 4+ duplicated sites, DRY violation);
a brand-new helper (rejected — `memoryFromCtx` already IS the per-request binding seam).
**Consequences:** any tool handler NOT using `memoryFromCtx` must be audited/bound separately (flagged above).

### D2 — Workspace is AUTH-trusted, never client-supplied (CWE-441 invariant 3)
**Decision:** `workspaceId` enters the ctx ONLY from `resolvePrincipal` on the authenticated key, never from
a request header/body. The `X-Theo-User-Id` header remains the *within-workspace* user tier only.
**Rationale:** theo-data invariant 3 ("resolve a Principal, never trust the body"). A client-supplied
workspace would re-open the IDOR under a new name.
**Alternatives:** trust an `X-Workspace-Id` header (rejected — that IS the vulnerability).
**Consequences:** the gateway's Model B per-tenant key is the workspace source of truth; the user header is
cosmetic partitioning inside the tenant.

### D3 — Scope the fix to the api-keys streamable-HTTP path; OIDC + SSE/openmemory noted out-of-scope
**Decision:** the fix targets the `theo_live_*` ApiKey path on the streamable-HTTP transport — the exact path
#82 exploited (gateway → Model B per-tenant key → native streamable-HTTP).
**Rationale (honesty, Rule 3):** (a) OIDC introspection returns a subject, not a workspace — OIDC→workspace
mapping is a separate design (no per-tenant key); deferred until OIDC multi-tenant is a real requirement.
(b) The SSE/openmemory transport (`connectSse`, `run-mcp-server.ts:295-300`) takes NO `bearerAuth` and is a
direct-localhost dev path, NOT gateway-fronted — it shares the unbound-memory shape but is not reachable via
the gateway and not in #82's repro. Fixing it requires wiring auth into SSE first (bigger scope).
**Alternatives:** fix all transports at once (rejected — scope creep beyond #82; OIDC/SSE lack the per-tenant
key the binding needs).
**Consequences:** the blueprint + plan MUST state these two deferrals explicitly; a follow-up issue tracks
SSE/openmemory multi-tenant hardening if/when that path is gateway-fronted.

---

## Cross-cutting Comparison (per-request tenant scoping)

| Dimension | letta | mem0 | OUR design (target) |
|---|---|---|---|
| Tenant axis | `organization_id` / actor | `user_id`/`agent_id`/`run_id` | `workspace_id` (outer) + `userId` (within-workspace tier) |
| Resolve-from-credential | `api_key_to_user` (placeholder OSS) | n/a (key optional) | `ApiKeyAuthVerifier.resolvePrincipal` (SQL on key hash) |
| Inject into request | FastAPI `Depends(get_headers)` | FastAPI `Header` | auth attaches workspace → ALS `ScopedContext` |
| Scope every store op | manager scoped by org_id | `_build_filters_and_metadata` | `Memory.withWorkspace(ws).user(userId)` |
| Fail-closed cross-tenant | manager-layer only | NOT fail-closed (200 w/o key) | **401 no-cred + 0-result cross-tenant via real edge** (stronger) |

## Recommendations (consumable by `/to-plan`)

1. Implement the 5-row file-change table above, TDD-first, with the EC-1 fail-closed contract as a negative-case test (resolved Principal + `withWorkspace`-absent impl in multi-tenant mode → reject, not unbound).
2. Bind workspace in `memoryFromCtx` (D1) so all 4 native handlers are covered in one DRY change; audit forget/skills/openmemory handlers separately.
3. Workspace from auth only (D2); `X-Theo-User-Id` stays the within-workspace tier.
4. Scope to api-keys streamable-HTTP (D3); file a follow-up for SSE/openmemory + OIDC workspace mapping.
5. Prove it through the real edge: extend `make e2e-edge` with the MCP isolation + fail-closed assertions; only `READY_TO_MERGE` with that green + a live re-probe of the #82 repro showing 0 cross-tenant results.

## Blocked questions

(none — all 6 answered)
