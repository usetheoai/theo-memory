# ADR-0021 — M8 `(workspace, user)` isolation: enforce `userId` at the scope-resolution boundary, not as a mandatory scope-type field

- **Status:** Accepted
- **Date:** 2026-07-22
- **Deciders:** project owner (explicit `/goal` directive authorizing the M8 isolation work + "sem workarounds, 100% funcional", this session)
- **Supersedes:** the M8 plan's ADR **D1** (`m8-workspace-user-isolation-routing-plan.md`), which proposed making `SessionScope.userId` / `AgentScope.userId` a **type-mandatory** field.
- **Change protocol:** locked-names / scope-contract interaction — this ADR + the CHANGELOG entries + the CLAUDE.md amendment constitute the owner-signed record (per `cycle-rule-schema.md § Golden Rule Change Protocol`). The owner's `/goal` directive is the sign-off.

## Context

M8 hardens theo-memory's `(workspace, user)` isolation so a user can never read another user's memory within a tenant. The plan's ADR D1 chose to make `SessionScope.userId` / `AgentScope.userId` **type-required**.

Implementing D1 surfaced a genuine conflict (found by reading the actual code, not assumed):

- **`Principal.userId` is `string | null`** (`packages/core/src/domain/principal.ts:69`). A workspace-level credential (admin key) legitimately has **no** acting user.
- A type-mandatory `userId` would therefore **break workspace-admin access** — the admin path has no user to supply, and forcing a sentinel would either reject legitimate access or reintroduce a leak.
- D1's type change also cascaded a break across ~10 call sites in `packages/core` + `packages/api` (5 REST handlers) + `packages/cli` — a large, brittle change for no correctness gain over the boundary approach.

The prior art surveyed in the blueprint enforces the scope key at the **filter-build boundary**, not by making a scope field non-optional at the type level. That is the pattern this ADR adopts.

## Decision

Enforce the user binding at the **scope-resolution boundary**, keeping `userId` **optional** on the scope type:

1. `Memory.session(sessionId, userId?)` / `Memory.agent(agentId, userId?)` gain an **optional** `userId` param (backward-compatible; the 1-arg SDK form is unchanged). When supplied, the scope is `(workspace, user, session)`; when omitted, it stays workspace-scoped.
2. The REST/MCP scope-resolution layer **binds `Principal.userId`** into every path/body-addressed session/agent scope (`principalUserId(c)` threaded through `pathParamsToScoped` + `resolveScope`). A user-Principal's access is therefore always `(workspace, user, …)`; a workspace-admin credential (`Principal.userId === null`) omits the bind and gets a workspace-scoped view.
3. `filtersFromScope` includes `user_id` in the filter whenever the scope carries it — so the isolation is realized as a SQL `WHERE user_id = …` predicate, backed by the composite index `memories_ws_user_session_idx` (migration 0024).

## Rejected alternatives

- **D1 (type-mandatory `userId`)** — rejected: breaks workspace-admin (`Principal.userId` null) and cascades a brittle ~10-file type break for no correctness gain.
- **Sentinel user for admin (`userId = '__workspace__'`)** — rejected: reintroduces a shared pseudo-user (a leak vector) and is dishonest about ownership.
- **REST path redesign to `/v1/scopes/user/{u}/session/{s}`** — rejected as scope-creep: the authenticated Principal already identifies the acting user; nesting it in the path is redundant and a breaking API change.

## Consequences

- **Cross-user isolation is PROVEN** by the hard-gate integration test (`tests/integration/cross-user-isolation.test.ts`, 3/3 against real `ankane/pgvector:v0.5.1`): user B reads zero of user A's global/session rows in the same workspace, even addressing the same session id; user A reads its own; the workspace-admin (null-user) path sees the workspace-scoped view.
- **No public API break** — the `userId` param is optional; existing SDK/test callers are unaffected (verified: whole-project typecheck 0 errors; full contract suite 1216 pass = pre-change baseline, zero new failures).
- The isolation is enforced at the boundary that owns the trust anchor (the Principal), consistent with theo-data invariant 3 ("resolve a Principal, never trust the body").
- `scope.ts:74-76`'s legacy note ("`user_id` … a partition, NOT the security boundary") is now superseded for the REST/MCP surface: the boundary binds the user, so `(workspace, user)` IS enforced for authenticated user access.

## Amendment 2026-07-22 — agent-chosen routing + hierarchical scope recall (owner decision)

The M8 Goal's routing half is delivered under two owner-directed decisions:

1. **Agent-chosen routing (narrows ADR D3).** The MCP `remember`/`recall` tools accept an
   optional `sessionId` argument: omit → GLOBAL `(workspace, user)`; pass → SESSION
   `(workspace, user, session)`. The `userId`/`workspaceId` isolation anchors STAY
   transport-bound (from the auth-trusted `ScopedContext`); only the session sub-partition
   of the caller's OWN user space is agent-selectable. So ADR D3 ("agents MUST NOT pass
   scope") is narrowed — a `sessionId` is now allowed, a `userId`/`workspaceId` is never.
   Helper: `routeScopedMemory` (`packages/mcp/src/tools/route-scoped-memory.ts`).

2. **Hierarchical scope recall (system-wide tier semantics).** The three tiers form a
   HIERARCHY, via `Filters.scopeHierarchy`:
   - User (global) recall = `session_id IS NULL AND agent_id IS NULL` (durable rows only).
   - user-bound Session recall = `agent_id IS NULL AND (session_id = :s OR session_id IS NULL)`
     (the session's rows UNION the user's global rows).
   This is the owner's model (2026-07-22): inside a session the agent recalls its durable
   global knowledge PLUS the session context, while a global recall never sees ephemeral
   session/agent memory. Applied SYSTEM-WIDE (one contract for REST/hooks/SDK/MCP). The
   workspace-admin path (no acting user) and the Agent/Repo tiers are unchanged.
   Implementation note: `session_id` stays in the filter for the WRITE column derivation;
   `scopeHierarchy` drives only the RECALL predicate (both stores skip the plain
   session_id/agent_id equality when it is present). Proven on real pgvector
   (`tests/integration/mcp/routing.test.ts`); full suite 1227 pass, zero regressions.
   This interacts with the locked "Memory tiers" names — the tiers are unchanged; their
   RECALL relationship is now hierarchical rather than disjoint (owner sign-off recorded).

## Related

- Commits: `b1a3b0a` (core session/agent optional userId), `7ef2ede` (REST threading), `07bedb1` (isolation hard gate), `6ea50cf` (composite index)
