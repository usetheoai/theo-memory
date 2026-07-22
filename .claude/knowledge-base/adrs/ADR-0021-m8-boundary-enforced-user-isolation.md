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

The reference (blueprint) shows the field enforces the scope key at the **filter-build boundary** (`mem0 _build_filters_and_metadata`, `main.py:342-366`) — it does not make a scope field non-optional at the type level. That is the pattern this ADR adopts.

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

## Related

- Plan: `.claude/knowledge-base/plans/m8-workspace-user-isolation-routing-plan.md` (ADR D1 superseded here; D5 public-API note folded in)
- Blueprint: `.claude/knowledge-base/discoveries/blueprints/m8-workspace-user-isolation-routing-blueprint.md`
- Commits: `b1a3b0a` (core session/agent optional userId), `7ef2ede` (REST threading), `07bedb1` (isolation hard gate), `6ea50cf` (composite index)
