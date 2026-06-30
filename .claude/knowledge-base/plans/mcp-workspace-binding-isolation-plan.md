---
slug: mcp-workspace-binding-isolation
created_at: 2026-06-30
goal: Bind the authenticated key's workspace_id to a per-request workspace-scoped Memory at every MCP tool memory-access site so a cross-tenant recall returns 0 results through the real edge (closes theo-memory#82).
issue: theo-memory#82
---

# Plan: MCP workspace-binding isolation (close cross-tenant leak #82)

## Goal

Bind the authenticated key's `workspace_id` to a per-request workspace-scoped `Memory` at every MCP tool memory-access site so that tenant A's key calling `recall` for tenant B's data through the real gateway edge returns **0 cross-tenant results** (the live #82 repro flips from leak to deny).

## Context

theo-memory#82 (CRITICAL) is a live cross-tenant leak on the MCP tool surface, found during the post-`94dfa5c` security investigation: tenant A's gateway-minted key read tenant B's memory across DISTINCT workspaces (`tn-8d04a3c948b592d2` vs `tn-7cf95ef28d588d97`). The REST surface already closed the identical gap (#77). This plan consumes the SHIPPABLE blueprint at `.claude/knowledge-base/discoveries/blueprints/mcp-workspace-binding-isolation-blueprint.md` (discover-confidence 99.7) and its absorbed edge-case review (`reviews/mcp-workspace-binding-isolation-edge-cases-2026-06-30.md`, EC-1/EC-2). The blueprint's decisive finding (Q6) + the baseline audit below establish that **both primitives already ship** (`AuthVerifier.resolvePrincipal`, `Memory.withWorkspace`) — the work is to compose them on the MCP path, and to bind workspace at the 5 DIRECT memory-access sites that do NOT funnel through `memoryFromCtx`.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last touch | Reason it exists |
|---|---|---|---|
| `packages/core/src/domain/scope.ts` | 188 | `ab62443` 2026-06-10 | `ScopedContext` type — per-request scope (userId tier today) |
| `packages/mcp/src/tools/workspace-scoped-memory.ts` | (NEW) | — | The single workspace-binding helper applied at every tool site |
| `packages/mcp/src/tools/workspace-scoped-memory.test.ts` | (NEW) | — | Unit tests for the helper (bind / passthrough / fail-closed) |
| `packages/mcp/src/auth/with-bearer-auth.ts` | 164 | `1827fbe` 2026-06-11 | node:http Bearer gate — currently boolean `verify` only (#82 root cause) |
| `packages/mcp/src/auth/with-bearer-auth.test.ts` | (existing) | — | Bearer-gate tests (extend with Principal-resolution + workspace attach) |
| `packages/mcp/src/transports/streamable-http.ts` | 235 | `94dfa5c` 2026-06-30 | native transport — builds ctx `{session:{userId}}` from header |
| `packages/mcp/src/transports/streamable-http.test.ts` | (existing) | — | `scopeFromHeaders` suite (extend with workspace-from-auth threading) |
| `packages/mcp/src/tools/recall-handler.ts` | ~60 | — | `recall` — `memoryFromCtx` site (`:39`) |
| `packages/mcp/src/tools/remember-handler.ts` | ~50 | — | `remember` — `memoryFromCtx` site (`:39`) |
| `packages/mcp/src/tools/reflect-handler.ts` | ~40 | — | `reflect` — `memoryFromCtx` site (`:30`) |
| `packages/mcp/src/tools/episodes-handler.ts` | ~60 | — | `episodes` — `memoryFromCtx` site (`:50`) |
| `packages/mcp/src/tools/forget-handler.ts` | ~70 | — | `forget` — DIRECT site `memoryFactory().forget(id)` (`:63`) |
| `packages/mcp/src/tools/add-skill-handler.ts` | ~40 | — | `add_skill` — DIRECT site `memoryFactory().skills(repoId)` (`:26`) |
| `packages/mcp/src/tools/execute-skill-handler.ts` | ~50 | — | `execute_skill` — DIRECT site `.skills(repoId)` (`:37`) |
| `packages/mcp/src/tools/forget-skill-handler.ts` | ~40 | — | `forget_skill` — DIRECT site `.skills(repoId)` (`:24`) |
| `packages/mcp/src/openmemory/tools.ts` | ~150 | — | OpenMemory tools — `memoryFromCtx` sites (`:92,:100,:109`) + DIRECT delete (`:138`) |
| `packages/mcp/src/tools/handlers.test.ts` | (existing) | — | Handler tests — extend with cross-tenant isolation assertions |
| `tests/integration/mcp/workspace-isolation.test.ts` | (NEW) | — | Integration: two workspaces, A cannot read B via the MCP handler path |
| `CHANGELOG.md` | (existing) | — | Unbreakable Rule 6 |

### Current callers / dependents

| Symbol | Production callers | Test callers | Invariants to preserve |
|---|---|---|---|
| `ScopedContext` (`scope.ts:67`) | `memoryFromCtx` (`core/.../theokit/index.ts:56`); `scopeFromHeaders` (`mcp/.../streamable-http.ts:58`); SSE transport; theokit REST | scope tests | additive change only — existing `{session:{userId}}` consumers unaffected; `workspaceId?` optional |
| `withBearerAuth` (`with-bearer-auth.ts:100`) | `connectStreamableHttp` (`streamable-http.ts:176`) | `with-bearer-auth.test.ts` | OPTIONS preflight 204 path; 401 shapes (RFC 6750); dual-validation prefix routing |
| `memoryFromCtx` (`theokit/index.ts:56`) | 7 MCP sites + theokit/REST | handler tests | NOT modified by this plan (workspace bound at the call site via the helper, not inside memoryFromCtx) — keeps the shared theokit/REST path untouched |
| `Memory.withWorkspace` (`memory-store.ts:146`) | REST `workspaceBoundMemory` (`_body-parsing.ts:32`); concrete `LocalMemory.withWorkspace` (`local-memory.ts:81`) | REST middleware tests | optional on the interface; `LocalMemory` implements it |
| `ApiKeyAuthVerifier.resolvePrincipal` (`api-key-verifier.ts:125`) | REST `resolvePrincipalFrom` (`middleware.ts:110`) | api-key-verifier tests | SQL on key hash → `{workspaceId,userId,role,scopes}`; null on unknown key |

### Domain glossary

- **Principal** — `{ workspaceId, userId, role, scopes }` resolved from a credential (`core/.../principal.ts`). The trusted identity.
- **workspace_id == tenant_id** — the data-plane outer tenant anchor (theo-data invariant 2). Every row carries it; every query is scoped by it.
- **`withWorkspace(ws)`** — returns a `Memory` whose every store op is scoped to `ws` (the outer anchor), composable with `.user(id)` / `.skills(repoId)`.
- **`memoryFromCtx`** — theokit binding that returns `memory.user(ctx.session.userId)` (within-workspace user tier).
- **ScopedContext** — AsyncLocalStorage-carried per-request scope set by `withScope` at the transport boundary.
- **Model B** — the gateway mints a per-tenant key; the data plane resolves the workspace from THAT key (never the client key).

### Architecture boundaries affected

- `rules/architecture.md § 2` (DIP): the MCP layer composes the domain interfaces `AuthVerifier` + `Memory.withWorkspace` — no reach into a concrete store. The new helper lives in the MCP (interface/composition) layer.
- `rules/error-handling.md § 2`: fail-fast, typed, validate at the boundary — the fail-closed contract (EC-1/EC-2).
- theo-data invariants 1/3/4/5/6 (CWE-441): resolve a Principal, never trust the body; per-verb scope (already shipped on REST); fail closed; prove isolation through the real edge.

## Prior Art & Related Work

- **Internal blueprint:** `.claude/knowledge-base/discoveries/blueprints/mcp-workspace-binding-isolation-blueprint.md` (discover-confidence SHIPPABLE 99.7) — the Q6 file-change design + D1/D2/D3 ADRs are consumed below.
- **Internal precedent (the canonical pattern):** REST #77 — `bearerAuth` resolves Principal (`middleware.ts:105-118`) + `workspaceBoundMemory` (`_body-parsing.ts:29-33`). This plan mirrors it on MCP.
- **Reference projects:** `letta` (per-request actor injection via FastAPI `Depends`, `dependencies.py:38-64`) + `mem0` (`_build_filters_and_metadata` scoping every store op, `main.py:286-299`) — corroborate the technique (blueprint Corner 4). Neither is fail-closed; OUR e2e is the authority.
- **Patterns skills:** none with a matching `*-patterns` description in `skills/` (first-of-its-kind MCP-tenancy fix in this codebase; REST precedent is the prior art).

## Objective

Compose the already-shipped `resolvePrincipal` + `withWorkspace` on the MCP streamable-HTTP path so every tool memory-access site is workspace-scoped from the auth-resolved Principal, failing closed in multi-tenant mode — proven by a live cross-tenant `recall` returning 0 results through the real gateway edge and fail-closed 401 probes.

## ADRs

### D1 — Single workspace-binding helper applied at every site (NOT inside `memoryFromCtx`)
**Decision:** add a `workspaceScopedMemory(memory): Memory` helper (MCP layer) and apply it at all 12 tool memory-access sites — both the 7 `memoryFromCtx` sites (`memoryFromCtx(getScope(), workspaceScopedMemory(factory()))`) and the 5 DIRECT sites (`workspaceScopedMemory(factory()).forget(id)` / `.skills(repoId)`).
**Rationale:** the blueprint's first instinct (bind inside `memoryFromCtx`) is INSUFFICIENT — the baseline audit found 5 direct sites (forget, 3 skill handlers, openmemory delete) that never touch `memoryFromCtx` (`forget-handler.ts:63`, `add-skill-handler.ts:26`, …). A single helper applied at every site covers ALL of them and keeps the shared `memoryFromCtx` (theokit/REST) untouched — lower blast radius, DRY (one binding definition). Per `rules/parsimony-ladder.md` rung 4 (reuse `withWorkspace`) + `architecture.md` DIP.
**Rejected alternatives:** (a) bind inside `memoryFromCtx` — leaves the 5 direct sites unbound (incomplete fix; the leak persists on `forget`/skills/delete); (b) per-handler ad-hoc `withWorkspace` calls — duplicates the fail-closed logic 12× (DRY violation, `rules/parsimony-ladder.md`).

### D2 — Workspace is AUTH-trusted, never client-supplied
**Decision:** `workspaceId` enters `ScopedContext` ONLY from `resolvePrincipal` on the authenticated key (attached by `withBearerAuth`); the `X-Theo-User-Id` header stays the within-workspace user tier only.
**Rationale:** theo-data invariant 3 ("resolve a Principal, never trust the body"). A client-supplied `X-Workspace-Id` would re-open the IDOR.
**Rejected alternatives:** trust a workspace header (rejected — that IS the vulnerability class #82 belongs to).

### D3 — Fail closed: resolve-or-reject, never silent passthrough (EC-1/EC-2)
**Decision:** (a) `withBearerAuth` on the api-keys path prefers `resolvePrincipal`; `null` → 401; a verify-only verifier (no `resolvePrincipal`) → reject (no DEFAULT_PRINCIPAL collapse), mirroring `middleware.ts:116`. (b) `workspaceScopedMemory`: when `getScope().workspaceId` is present but the concrete `Memory` lacks `withWorkspace`, **throw** (fail closed) — NEVER the REST optional-chaining passthrough (`_body-parsing.ts:32`) that serves UNBOUND memory.
**Rationale:** `rules/error-handling.md` fail-fast; the silent passthrough is the latent-leak vector EC-1 flagged.
**Rejected alternatives:** passthrough-on-missing (rejected — that is the leak); 503 instead of throw (rejected — a missing capability is a programming error, not a transient backend failure).

### D4 — Scope to the api-keys streamable-HTTP path; SSE/openmemory + OIDC workspace mapping deferred
**Decision:** the fix targets the `theo_live_*` ApiKey path on streamable-HTTP — the exact path #82 exploited. The `workspaceScopedMemory` helper STILL binds the openmemory tool handlers (they share the tool layer), but the SSE transport's auth wiring (it takes no `bearerAuth` today) and OIDC→workspace mapping are out of scope.
**Rationale (Rule 3 honesty):** OIDC introspection returns a subject, not a workspace (no per-tenant key); SSE/openmemory is a direct-localhost dev path, not gateway-fronted, not in #82's repro. Blueprint D3.
**Rejected alternatives:** fix all transports now (rejected — scope creep; SSE/OIDC lack the per-tenant key the binding needs). A follow-up issue tracks SSE/openmemory multi-tenant hardening.

## Dependencies

### Existing — use as-is (reused, no version change)

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@usetheo/memory` | workspace | npm | `Memory.withWorkspace` + `ScopedContext` + contract types (already a `packages/mcp` dep) |
| `@usetheo/memory-api` | workspace | npm | `ApiKeyAuthVerifier.resolvePrincipal` (already a `packages/mcp` dep) |
| `@usetheo/memory-agent-core` | workspace | npm | `getScope` / `withScope` ALS (already a `packages/mcp` dep) |
| `pg` | (declared) | npm | resolvePrincipal SQL + pgvector store (already a `packages/mcp` dep) |
| `@modelcontextprotocol/sdk` | (declared) | npm | transport + CallToolResult types (already a `packages/mcp` dep) |
| `vitest` | (declared) | npm | unit + integration test runner (already configured) |

### New — to be introduced

(none) — per ADR D1 + blueprint Corner 2 (parsimony ladder rung 4): the fix reuses `AuthVerifier.resolvePrincipal` + `Memory.withWorkspace`, both already shipped. **Zero new dependencies.**

### Removed

(none)

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| ALS scope bleed across concurrent requests (two tenants in flight bind the wrong workspace) | HIGH | Concurrency test (T3.1 `#### Concurrency tests`): N concurrent `withScope` calls with distinct workspaces assert no bleed; `AsyncLocalStorage.run` lexical isolation is the mechanism | claude-code |
| A direct memory-access site is missed → residual leak on that verb | HIGH | The baseline audit enumerated all 12 sites; T3.1 acceptance criterion greps for any remaining bare `deps.memoryFactory()` in `packages/mcp/src/tools` + `openmemory` and FAILS if found | claude-code |
| `resolvePrincipal` DB call latency/failure on the hot path | MEDIUM | The verifier already does this for REST; failure → 503 (not a privileged default), per `middleware.ts:199-203`. Failure-scenario test below | claude-code |
| Breaking the just-shipped `94dfa5c` userId binding | MEDIUM | userId binding is preserved (still from `X-Theo-User-Id`); workspace is ADDED above it. Existing `scopeFromHeaders` tests stay green | claude-code |
| SSE/openmemory + OIDC remain unbound (D4 deferral) | LOW | Documented deferral + follow-up issue; not gateway-fronted, not in #82 repro | claude-code |

## Unresolved Questions

(none — every decision is resolved at plan time. D4 explicitly defers SSE/OIDC with a follow-up issue; that is a scoped decision, not an open question.)

## Dependency Graph

```
Phase 1 (scope tier + helper)  ─┐
                                ├─→ Phase 3 (apply at all sites) ─→ Phase 4 (integration + live e2e)
Phase 2 (auth threads workspace)┘
```
- Phase 1 and Phase 2 are independent (parallelizable): Phase 1 defines the helper + ctx field; Phase 2 makes the auth layer populate the field.
- Phase 3 depends on BOTH (it consumes the helper AND requires the ctx to carry workspaceId).
- Phase 4 depends on Phase 3.

## Phase 1: Scope tier + workspace-binding helper

### T1.1 — Add `workspaceId?` to `ScopedContext`

#### Objective
Add an additive `workspaceId?: string` field to `ScopedContext` so the per-request scope can carry the auth-resolved workspace.

#### Why this step (action + reasoning)
**Action:** add `workspaceId?: string` to the `ScopedContext` interface (`scope.ts:67`).
**Why necessary now:** every downstream piece (the helper T1.2, the transport T2.2) reads `getScope().workspaceId`; the type must exist first. Additive + optional so the 4 existing consumers (memoryFromCtx, scopeFromHeaders, SSE, theokit) compile unchanged (Baseline Context § Current callers). Cited: blueprint Q6 row 1, D1.

#### Evidence
`scope.ts:67` currently `{ session?: {userId,...} | null }` — no workspace tier (Baseline Context).

#### Files to edit
- `packages/core/src/domain/scope.ts` — add the field + JSDoc (auth-trusted source note).

#### Deep file dependency analysis
- Today: declares the per-request scope shape consumed by `memoryFromCtx` + transports.
- Downstream: additive optional field — no existing consumer breaks (all read `session`, none assume the absence of other fields).

#### TDD
- RED: `scope.test.ts` — a unit asserting a `ScopedContext` value with `{ workspaceId: 'tn-x', session: { userId: 'u' } }` is assignable and round-trips `workspaceId`. (Type + value test.)
- GREEN: add the field.
- REFACTOR: JSDoc documenting "auth-trusted; never from a client header" (D2).

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- `workspaceId?: string` present on `ScopedContext`; `tsc -p tsconfig.contract.json` green; existing scope consumers unchanged.

#### DoD
- `npm run test -- scope` green; `npm run typecheck` green.

### T1.2 — `workspaceScopedMemory(memory)` helper (fail-closed)

#### Objective
A single helper that binds the active scope's workspace to a `Memory`, failing closed when a workspace is set but the impl cannot bind it.

#### Why this step (action + reasoning)
**Action:** create `workspaceScopedMemory(memory: Memory): Memory` — read `getScope().workspaceId`; if a non-empty string AND `memory.withWorkspace` exists → `memory.withWorkspace(ws)`; if the workspaceId is set but `withWorkspace` is `undefined` → **throw** (fail closed, D3/EC-1); if no workspaceId → return `memory` unchanged (single-tenant default).
**Why necessary now:** this is the ONE binding definition applied at all 12 sites in Phase 3 (D1, DRY). Centralizing the fail-closed logic here means no handler re-implements it. Cited: blueprint D1/D3, EC-1.

#### Evidence
5 direct sites (`forget-handler.ts:63`, `add-skill-handler.ts:26`, `execute-skill-handler.ts:37`, `forget-skill-handler.ts:24`, `openmemory/tools.ts:138`) + 7 memoryFromCtx sites — all need ONE binding (Baseline audit).

#### Files to edit
- `packages/mcp/src/tools/workspace-scoped-memory.ts` (NEW)
- `packages/mcp/src/tools/workspace-scoped-memory.test.ts` (NEW)

#### Deep file dependency analysis
- New file; imports `getScope` from `@usetheo/memory-agent-core` + `Memory` type from the contract.
- Downstream: every tool handler (Phase 3) will import it.

#### Pseudo-code / Signatures
```ts
export function workspaceScopedMemory(memory: Memory): Memory {
  const ws = getScope().workspaceId;
  if (ws === undefined || ws.trim() === '') return memory;        // single-tenant default
  if (memory.withWorkspace === undefined) {
    throw new Error('workspaceScopedMemory: workspace set but Memory.withWorkspace unavailable (fail-closed, D3/EC-1)');
  }
  return memory.withWorkspace(ws);
}
```

#### TDD
- RED:
  - `binds withWorkspace when scope carries a workspaceId` → asserts `memory.withWorkspace` called with the ws id (spy memory).
  - `passes memory through unchanged when no workspaceId` (single-tenant) → returns the same instance.
  - `throws (fail-closed) when workspaceId set but withWorkspace undefined` → asserts the typed throw (D3 negative case, `rules/testing.md § 4.1`).
  - `treats empty/whitespace workspaceId as absent` (passthrough — single-tenant; the api-keys path can NEVER reach this state because T2.1 rejects a blank workspace at the auth boundary, EC-1).
  - **`outside any withScope → MissingScopeError` (EC-3 SHOULD TEST) — locks the helper's scope-dependency precondition (matches every existing handler's `getScope()` call).**
- GREEN: implement per the signature.
- REFACTOR: name + JSDoc citing D1/D3 + the EC-1 boundary note (blank workspace is rejected upstream, not here).

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- `npm run test -- workspace-scoped-memory` exits `0` with `4/4` unit tests passing; the fail-closed branch throws an `Error` whose message matches `/withWorkspace unavailable/`; the helper makes `0` I/O calls (no `pg`/network import).

#### DoD
- `npm run test -- workspace-scoped-memory` green; `npm run lint` clean on the new file.

## Phase 2: Auth resolves Principal + threads workspaceId

### T2.1 — `withBearerAuth` resolves the Principal + attaches workspaceId

#### Objective
Make the api-keys Bearer path resolve a `Principal` and attach its `workspaceId` to the request, failing closed.

#### Why this step (action + reasoning)
**Action:** in `with-bearer-auth.ts`, replace the boolean `apiKey.verify(token)` (`:142`) with a `resolvePrincipal`-preferring resolution: if `apiKey.resolvePrincipal` exists → call it; `null` → existing 401; non-null → attach `principal.workspaceId` to the request (a typed per-request property) then `delegate`. If the verifier provides ONLY `verify` (no `resolvePrincipal`) on the api-keys path → reject (no passthrough) per D3/EC-2.
**Why necessary now:** the transport (T2.2) reads the attached workspaceId; the auth layer is the only trusted source (D2). This is the #82 root-cause line (`:142`). Cited: blueprint Q6 row 3, D2/D3.

#### Evidence
`with-bearer-auth.ts:142` boolean `verify`; `ApiKeyAuthVerifier.resolvePrincipal` returns `{workspaceId,…}` (`api-key-verifier.ts:125,157`).

#### Files to edit
- `packages/mcp/src/auth/with-bearer-auth.ts`
- `packages/mcp/src/auth/with-bearer-auth.test.ts`

#### Deep file dependency analysis
- Today: dual-validation Bearer gate; only mounted on streamable-HTTP when auth ∈ {api-keys,oidc,both} (`run-mcp-server.ts:344-355`).
- Downstream: `connectStreamableHttp` delegate (baseHandler) reads the attached workspaceId (T2.2).

#### Pseudo-code / Signatures
```ts
// api-keys branch:
if (opts.apiKey?.resolvePrincipal) {
  const principal = await opts.apiKey.resolvePrincipal(token);
  if (principal === null) { send401(...'invalid_token'...); return; }
  // EC-1 (plan-edge-case MUST FIX): a resolved Principal with a blank workspaceId is
  // malformed — reject. NEVER let it reach the helper's passthrough rule (which would
  // serve UNBOUND/all-workspace memory = #82 re-opened through a different door).
  if (principal.workspaceId.trim() === '') { send401(...'invalid_token', 'resolved principal has no workspace (fail-closed)'...); return; }
  attachWorkspace(req, principal.workspaceId);   // typed per-request property
  await delegate(req, res); return;
}
// verify-only verifier on the api-keys (multi-tenant) path → reject (D3/EC-2)
send401(...'invalid_token', 'verifier cannot resolve workspace (fail-closed)'...);
```

#### TDD
- RED:
  - `resolvePrincipal success attaches workspaceId + delegates` (spy delegate sees `req` carrying the ws).
  - `resolvePrincipal null → 401` (no delegate call).
  - **`resolvePrincipal returns blank workspaceId → 401, no delegate` (EC-1 MUST FIX negative case — the load-bearing guard against re-opening #82 via a malformed key row).**
  - `verify-only verifier on api-keys path → 401, no delegate` (D3/EC-2 negative case).
  - existing OPTIONS-204 + missing-token-401 tests stay green (regression guard).
- GREEN: implement the branch.
- REFACTOR: extract `attachWorkspace`/the typed req property; JSDoc citing D2/D3.

#### Concurrency tests (only when applicable)
- **concurrent test** (happens-before observation): run both `withBearerAuth` invocations in a concurrent test against distinct `req` objects (node:http allocates a fresh `IncomingMessage` per request) and assert via happens-before observation that each `delegate` saw ONLY its own workspaceId — no shared mutable state, no bleed.

#### Acceptance Criteria
- New tests green; the 401 shapes (RFC 6750) unchanged; no client header can set the workspace (only `resolvePrincipal` does).

#### DoD
- `npm run test -- with-bearer-auth` green; `npm run typecheck` green.

### T2.2 — Transport threads the auth-attached workspaceId into the ctx

#### Objective
`scopeFromHeaders` / baseHandler builds the ctx with `workspaceId` from the auth-attached request property (trusted) + `userId` from the header.

#### Why this step (action + reasoning)
**Action:** in `streamable-http.ts`, read the auth-attached workspaceId from `req` and include it in the `ScopedContext` returned by `scopeFromHeaders` (now `scopeFromRequest`): `{ workspaceId, session: { userId } }`. The userId still comes from `X-Theo-User-Id` (within-workspace tier); the workspace comes ONLY from the auth attachment (D2).
**Why necessary now:** this is what `withScope` binds so the handlers' `getScope().workspaceId` is populated. Cited: blueprint Q6 row 4, D2.

#### Evidence
`streamable-http.ts:58` `scopeFromHeaders` returns `{session:{userId}}` from the header only.

#### Files to edit
- `packages/mcp/src/transports/streamable-http.ts`
- `packages/mcp/src/transports/streamable-http.test.ts`

#### Deep file dependency analysis
- Today: baseHandler wraps dispatch in `withScope(scopeFromHeaders(req.headers), dispatch)` (post-`94dfa5c`).
- Downstream: the ctx is read by every tool handler via `getScope()`.

#### TDD
- RED:
  - `ctx carries workspaceId from the auth-attached req property` (not from any header).
  - `a client X-Workspace-Id header is IGNORED` (D2 negative case — only the auth attachment counts).
  - existing `scopeFromHeaders` userId tests stay green (regression).
- GREEN: thread the attached workspaceId.
- REFACTOR: rename to `scopeFromRequest`; JSDoc citing D2.

#### Concurrency tests (only when applicable)
(none — single-threaded) — the threading is synchronous per-request; the concurrent test covering the per-`req` property lives in T2.1, and the end-to-end ALS concurrent test lives in T3.1.

#### Acceptance Criteria
- ctx includes `workspaceId` from auth only; no client header can set it; existing tests green.

#### DoD
- `npm run test -- streamable-http` green; `npm run typecheck` green.

## Phase 3: Apply workspace binding at every tool memory-access site

### T3.1 — Wrap all 12 memory-access sites with `workspaceScopedMemory`

#### Objective
Every MCP tool memory-access site binds the workspace via the helper, so no verb can read/write across tenants.

#### Why this step (action + reasoning)
**Action:** replace `deps.memoryFactory()` with `workspaceScopedMemory(deps.memoryFactory())` at all 12 sites — 7 `memoryFromCtx` sites (`memoryFromCtx(getScope(), workspaceScopedMemory(deps.memoryFactory()))`) and 5 DIRECT sites (`workspaceScopedMemory(deps.memoryFactory()).forget(id)` / `.skills(repoId)`).
**Why necessary now:** this is the actual leak closure — without binding at the direct sites (forget/skills/openmemory delete), those verbs still leak even after the memoryFromCtx sites are fixed. Cited: D1, Baseline audit (all 12 sites enumerated).

#### Evidence
Sites: `recall:39`, `remember:39`, `reflect:30`, `episodes:50`, `openmemory:92,100,109` (memoryFromCtx); `forget:63`, `add-skill:26`, `execute-skill:37`, `forget-skill:24`, `openmemory:138` (direct).

#### Files to edit
- `packages/mcp/src/tools/recall-handler.ts`, `remember-handler.ts`, `reflect-handler.ts`, `episodes-handler.ts`, `forget-handler.ts`, `add-skill-handler.ts`, `execute-skill-handler.ts`, `forget-skill-handler.ts`
- `packages/mcp/src/openmemory/tools.ts`
- `packages/mcp/src/tools/handlers.test.ts` (extend)

#### Deep file dependency analysis
- Each handler today resolves memory via `memoryFromCtx(getScope(), deps.memoryFactory())` OR `deps.memoryFactory()` directly. The change is one-line per site (wrap the factory result).
- Downstream: the dispatch table (`dispatch.ts`) is unaffected (handler signatures unchanged).

#### TDD
- RED (per-verb cross-tenant isolation, in `handlers.test.ts`):
  - With scope `{workspaceId:'tn-A', session:{userId:'u'}}` and a spy/fake `Memory`, assert each handler resolves memory via `withWorkspace('tn-A')` BEFORE the op — for recall, remember, reflect, episodes, forget, add_skill, execute_skill, forget_skill, and the openmemory tools (search/list/add/delete).
  - Negative: a handler run with workspace `tn-A` MUST NOT touch a `tn-B`-scoped store (fake memory records the bound ws; assert it equals `tn-A`).
  - **`dispatch surfaces the fail-closed throw as a typed tool error` (EC-2 SHOULD TEST): when `workspaceScopedMemory` throws, the dispatch returns `{ isError: true }` with a sanitized message — it does NOT leave an unhandled rejection that wedges the singleton transport.**
- GREEN: wrap each site with the helper.
- REFACTOR: confirm no bare `deps.memoryFactory()` remains at a memory-op site.

#### Concurrency tests (only when applicable)
- **ALS isolation (HIGH risk) — concurrent test with happens-before observation:** a concurrent test runs two handler dispatches inside distinct `withScope({workspaceId:'tn-A',…})` / `withScope({workspaceId:'tn-B',…})` blocks with awaits interleaved; happens-before observation asserts each dispatch resolves ONLY its OWN workspace (no bleed). This is the only proof `AsyncLocalStorage.run` isolates the workspace per concurrent request (Drawbacks risk #1).

#### Acceptance Criteria
- All 12 sites wrapped; `grep -rnE 'memoryFactory\(\)' packages/mcp/src/tools packages/mcp/src/openmemory | grep -v workspaceScopedMemory | grep -v '\.test\.'` returns ONLY non-memory-op usages (or empty) — any bare memory-op factory call FAILS the task.
- `npm run test -- handlers` exits `0`; the cross-tenant assertion `boundWorkspace === 'tn-A'` holds for all `12` verbs; the ALS concurrency test asserts `0` workspace bleed across `2` interleaved dispatches.

#### DoD
- `npm run test -- handlers` green; `npm run typecheck` green; `npm run lint` clean.

## Phase 4: Integration Validation + live e2e isolation proof

### T4.1 — Integration test: two workspaces, A cannot read B (real pgvector)

#### Objective
Prove, against real `ankane/pgvector`, that a `recall` scoped to workspace A returns 0 of workspace B's memories through the MCP handler path.

#### Why this step (action + reasoning)
**Action:** add `tests/integration/mcp/workspace-isolation.test.ts` — write a memory in workspace B (via `withWorkspace('tn-B')`), then dispatch the `recall` handler inside `withScope({workspaceId:'tn-A', session:{userId:'u'}})` and assert 0 results; also assert `forget` scoped to A cannot delete B's row.
**Why necessary now:** unit tests use fakes; the integration test proves the binding reaches the real store with real SQL scoping. Cited: blueprint Corner 1 + Corner 3 (our e2e is the authority).

#### Evidence
References' isolation tests are weaker (mem0 200-without-key; letta manager-layer) — OUR integration is the proof (blueprint Corner 1).

#### Files to edit
- `tests/integration/mcp/workspace-isolation.test.ts` (NEW)

#### Deep file dependency analysis
- New integration test; uses the real `wireMemoryFromPool` + pgvector container per `vitest.integration.config.ts`.

#### TDD
- RED: the isolation assertions fail before Phase 3 wiring (or with a deliberately-unbound memory).
- GREEN: passes with the Phase 3 binding.
- REFACTOR: factor the two-workspace fixture.

#### Concurrency tests (only when applicable)
- **concurrent test:** two concurrent `withScope` recalls (A and B) against the real store assert no cross-read (a concurrent test reinforcing T3.1 against a real DB).

#### Failure scenario coverage
- Covered in `## Failure scenarios` (DB driver timeout → 503 path; resolvePrincipal failure).

#### Acceptance Criteria
- Cross-tenant `recall` = 0 results; cross-tenant `forget` does not delete B's row; both green against real pgvector.

#### DoD
- `npm run test:integration -- workspace-isolation` green.

### T4.2 — Live e2e through the real gateway (the #82 repro flips to deny) + Integration Validation

#### Objective
Re-run the live #82 repro through the real edge and show 0 cross-tenant results, plus fail-closed 401 probes; then run the full validation chain.

#### Why this step (action + reasoning)
**Action:** rebuild the themory image FRESH, bring up the integrated MCP-Gateway path (edge → gateway → Model B → host MCP over TLS), mint two real `theo_live_*` keys (tenants A,B), write B's canary, and call `recall` with A's key + `X-Theo-User-Id` for B's canary → assert 0 results (was the leak). Capture: GW-ISO PASS, fail-closed 401×4. Then run `npm run test && npm run typecheck && npm run lint && npm run test:integration`. **EC-5 (DOCUMENT):** the native streamable-HTTP transport is a STATEFUL singleton — **restart the host MCP listener between the tenant-A and tenant-B connections** (sequential single-connection probes otherwise hit "Server already initialized -32600"). **EC-4 (DOCUMENT):** the follow-up issue filed here MUST explicitly name "OIDC / `auth=both` multi-tenant workspace resolution" as deferred + unsupported-until-implemented (per ADR D4 — OIDC introspection returns a subject, not a workspace; a multi-tenant OIDC deployment would passthrough to the default workspace).
**Why necessary now:** the user requires evidence of 100% functional through the REAL edge (not just unit/integration). This is the authority proof (blueprint Corner 1/3, theo-data invariant 6). Cited: #82 repro.

#### Evidence
The original #82 repro returned B's canary for A's key; this must now return 0.

#### Files to edit
- (no source) — `.claude/knowledge-base/dogfood/evidence/2026-06-30-mcp-iso-fix-e2e.md` (NEW evidence)
- `CHANGELOG.md` — `[Unreleased] § Security` entry.

#### TDD
- This is an e2e validation task (no new unit). The "test" is the live probe + the full suite.

#### Failure scenario coverage
- Fail-closed 401 probes (no-cred at gateway + listener, X-Theo-User-Id-only, customer-key-direct) — the negative cases.

#### Concurrency tests (only when applicable)
(none — single-threaded) — the e2e validation is a sequential live probe; the concurrent tests live in T3.1 + T4.1.

#### Acceptance Criteria
- Live GW-ISO: A's key → B's canary → **0 results** (deny); fail-closed 4/4 401; full suite (`test` + `typecheck` + `lint` + `test:integration`) green; CHANGELOG updated.

#### DoD
- Evidence file written with the live transcript (no secrets); all gates green; `/code-quality` ∉ {FAIL_HARD, INVALID}.

## Coverage Matrix

| Requirement / gap (from #82 + blueprint) | Task(s) |
|---|---|
| ScopedContext can carry workspace | T1.1 |
| Single fail-closed workspace-binding helper | T1.2 |
| Auth resolves Principal + attaches workspace (root cause `:142`) | T2.1 |
| Transport threads auth-trusted workspace into ctx (not client header) | T2.2 |
| All 7 memoryFromCtx sites bound | T3.1 |
| All 5 DIRECT sites bound (forget, 3 skills, openmemory delete) | T3.1 |
| Fail-closed: verify-only verifier rejected (blueprint EC-2) | T2.1, D3 |
| Fail-closed: blank workspaceId from resolvePrincipal rejected (plan EC-1 MUST FIX) | T2.1 |
| Fail-closed: withWorkspace-absent throws, no passthrough (blueprint EC-1) | T1.2, D3 |
| Fail-closed throw surfaced as typed tool error, not server crash (plan EC-2) | T3.1 |
| ALS isolation across concurrent tenants | T2.1, T3.1 (concurrency tests) |
| Real-store isolation proof | T4.1 |
| Live edge isolation proof (#82 flips to deny) + fail-closed probes | T4.2 |
| SSE/openmemory + OIDC deferral documented + follow-up | D4 (+ follow-up issue in T4.2) |

**Coverage: 14/14 requirements mapped (100%).**

## Global Definition of Done

- [ ] All tasks' DoD green.
- [ ] `npm run test` (contract) + `npm run test:integration` green.
- [ ] `npm run typecheck` zero errors; `npm run lint` zero warnings on touched files.
- [ ] No bare `deps.memoryFactory()` at a memory-op site in `packages/mcp/src/{tools,openmemory}` (T3.1 acceptance grep).
- [ ] Live GW-ISO probe: A's key returns **0** of B's workspace; fail-closed 4/4 401.
- [ ] `/code-quality` verdict ∉ {FAIL_HARD, INVALID}.
- [ ] CHANGELOG `[Unreleased] § Security` updated (Unbreakable Rule 6).
- [ ] No secrets in any evidence file.
- [ ] File-size budget: every touched file ≤ 500 LoC (`rules/architecture.md`).

## Failure scenarios (external I/O present — pg driver + node:http)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `pg` (resolvePrincipal SQL on key hash) | DB unavailable / query throws during `resolvePrincipal` | inject a verifier whose `resolvePrincipal` rejects | `withBearerAuth` surfaces a non-200 (mirror REST `middleware.ts:199-203` 503) — NEVER a privileged default Principal / unbound memory (fail closed) |
| `pg` (pgvector store, recall/forget) | store op error under a bound workspace | integration fake store throws on op | error propagates typed (no swallow, `rules/error-handling.md`); no cross-tenant fallback |
| `node:http` (transport) | request without/with malformed Bearer | unit (existing 401 path) | 401 RFC 6750; never reaches a tool handler unbound |

## Final Phase: Integration Validation

The plan is NOT complete until, on `develop`: `npm run test` + `npm run typecheck` + `npm run lint` + `npm run test:integration` all green AND the live GW-ISO probe shows 0 cross-tenant results AND fail-closed 4/4 — captured as dogfood evidence (T4.2). This is the "eat your own cooking" gate: the same live path #82 exploited must now deny.
