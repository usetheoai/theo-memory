# Blueprint: Multi-Tenant Workspace Isolation (Principal-resolved-from-credential)

**Date:** 2026-06-17
**Slug:** `multi-tenant-workspace-isolation`
**Status:** SHIPPABLE_WITH_CAVEATS (discovery grounded in project-owner spec + live code exploration; local references mem0/letta/langmem are single-tenant memory engines and carry no workspace-tenancy prior art, so prior art is the owner-supplied pattern + the in-repo seams already planted by Item 20).

## Context / motivation

TheMemory today is **single-tenant-per-deployment with caller-supplied three-tier scope**. The three tiers (`user_id` / `session_id` / `agent_id`) are organizational partitions WITHIN one trusted tenant; they are NOT security boundaries because the scope is read from the request **body**, so any valid API key can address any scope. `AuthVerifier.verify(token): Promise<boolean>` answers "is this key valid?", not "whose key is this?".

The owner directive (2026-06-17, recorded in CLAUDE.md § PRIORITY 0 Amendment) re-classifies the **Workspace Isolation** pattern as CORE in-scope: add a `workspaces` tenant boundary resolved FROM the credential, so a key is bound to exactly one workspace and every query is scoped by that workspace. This is the foundation of the v0.5 TheoCloud managed runtime (Roadmap Item 7) and the OSS local runtime gains the same isolation.

## The pattern (one line)

Every request carries a `Principal` resolved from a credential; every datum belongs to a `workspace`; every query is scoped by the Principal's workspace. **Application-level isolation, not per-database.**

## Prior art

- **Owner-supplied pattern** (the canonical brief): API-key → workspace; `Principal` resolves `workspaceId`; SHA-256 key hash; app-level scoping; `workspace_id` denormalized on directly-queried tables; 404 (not 403) cross-tenant; "no credential" collapses to a `default` workspace.
- **R2R** (`owner_id` denormalized on every queried resource) — cited by the owner as the canonical "denormalize the tenant column" precedent.
- **In-repo seam (Item 20, `theo-memory-faang-auth-lifecycle`):** `theo_api_keys` already carries `tenant_id DEFAULT 'self'` + `subject` columns — planted explicitly as forward-compat for this exact model. `0012_theo_api_keys.sql`.
- **In-repo current code** (exploration 2026-06-17): `AuthVerifier` DIP at `packages/core/src/domain/dip/auth-verifier.ts`; verifiers at `packages/api/src/server/auth/{bearer-verifier,api-key-verifier,oidc-verifier,scope-verifier}.ts`; query-scoping locus `composeFilters` at `packages/core/src/infrastructure/db/pgvector-store.ts:164-224`; scope DIP `packages/core/src/domain/scope.ts`; REST scope-from-body at `packages/api/src/server/schemas.ts` + `handlers/*`.

## Code grounding — what exists today (file:line)

| Concern | Today | Locus |
|---|---|---|
| Auth shape | `verify(token): Promise<boolean>` (boolean, no Principal) | `packages/core/src/domain/dip/auth-verifier.ts:17-30` |
| Key store | `theo_api_keys` (sha256 `key_hash` unique, `revoked_at`, `expires_at`, `scopes` jsonb, `tenant_id='self'`, `subject`) | `migrations/0012_theo_api_keys.sql` |
| Key lookup | `WHERE key_hash=$1 AND revoked_at IS NULL AND tenant_id='self'` | `auth/api-key-verifier.ts:51-57` |
| Tenant boundary | NONE (deployment = tenant); three tiers are sub-partitions | `domain/scope.ts:1-86` |
| Query scoping | `composeFilters` filters by `user_id/session_id/agent_id` IF passed; **optional** (undefined → no WHERE) | `pgvector-store.ts:164-224` |
| Scope source | request **body** (`userId/sessionId/agentId`), Zod `superRefine` exactly-one | `server/schemas.ts:25-40` |
| No-credential | auth DISABLED (pass-through) | `auth/middleware.ts:30-40` |
| Cross-scope read | empty `[]` / silent 204 | `handlers/recall.ts:36`, `handlers/forget.ts` |

### Tables that carry data (workspace_id placement)

Scope-bearing, directly queried → **MUST get denormalized `workspace_id`**:
`memories`, `entities`, `history`, `consolidation_history`, `reflection_counters`, `recall_cache`.

Leaf / global:
- `theo_api_keys` → the workspace **binding** lives here: repurpose `tenant_id` (currently `'self'`) as the FK to `workspaces`, OR add explicit `workspace_id`. The key → workspace edge.
- `admin_config` → global single-row; bootstrap stays global (the bootstrap token mints the FIRST key of the `default` workspace).

## Design decisions (to formalize as plan ADRs)

1. **D-LAYER — workspace LAYERS OVER the three tiers, does not replace them.** `workspace_id` is the OUTER tenant anchor; `(user_id, session_id, agent_id)` stay as within-workspace partitions (preserves the locked "memory tiers" name). A recall is `WHERE workspace_id = $principal AND <tier> = $body`.
2. **D-PRINCIPAL — `AuthVerifier.verify(token): boolean` → resolve a `Principal { workspaceId, scopes }`.** New domain type `Principal`. The verifier answers "whose key?". BREAKING (pre-release acceptable). Keep a thin boolean-compat shim only where the env-key bridge needs it.
3. **D-SOURCE-OF-SCOPE — `workspace_id` comes from the Principal, NEVER the body.** The body keeps supplying the tier (user/session/agent) but the workspace is injected server-side from the authenticated Principal. Forging a tenant becomes impossible.
4. **D-REPO-REQUIRED — `workspaceId` becomes a REQUIRED parameter of the scoping path** (compile-time, TS): make the `Filters`/scope contract carry a non-optional `workspaceId` on the REST/SDK-server path so forgetting it is a type error, not a silent unscoped query (closes the `composeFilters(undefined)` hole).
5. **D-KEYHASH — keep SHA-256 unique-index lookup** (already correct; high-entropy keys → fast hash, not bcrypt). No change.
6. **D-404 — cross-workspace access returns 404, never 403** (403 leaks existence). Data access by id outside the Principal's workspace → 404.
7. **D-DEFAULT-WS — "no credential" / legacy `THEMEMORY_API_KEY` collapses to a single `default` workspace.** Single-tenant dev keeps working; with one workspace there is no cross-tenant IDOR, so the "insecure mode" stops being insecure and the auth-disabled override is removed (or made explicit dev-only).
8. **D-MIGRATION — non-destructive single→multi.** New migration `0016`: (a) `CREATE TABLE workspaces`; (b) seed the `default` workspace; (c) `ADD COLUMN workspace_id` nullable on the 6 data tables + backfill `default`; (d) `SET NOT NULL` + `(workspace_id, ...)` indexes; (e) `theo_api_keys` binds to workspace (`tenant_id`→FK or new col, backfill `'self'`→`default`); (f) compat bridge: legacy env key resolves to `default`. Then enforce.
9. **D-RLS-LATER — app-level enforcement first; Postgres RLS is opt-in belt-and-suspenders, deferred.** Matches R2R/AnythingLLM; RLS needs per-transaction `SET LOCAL` and leaks GUC across pooled connections if mis-wired. Not a prerequisite to close IDOR.

## Failure modes to cover in tests (where it leaks)

- GET/forget by id of another workspace → **404** (the core IDOR test).
- Recall/list → returns only the Principal's workspace rows (no leakage across workspaces).
- Create → `workspace_id` comes from the Principal, never the body (client cannot forge tenant).
- Revoked key (`revoked_at` past) → 401.
- Leaf rows (entities/recall_cache) inherit the workspace via their parent / their own denormalized column.
- Admin key-management (`/v1/admin/keys/*`) scoped to the Principal's workspace (a workspace admin cannot list/rotate another workspace's keys).
- Legacy env key + single `default` workspace → existing single-tenant deployment unaffected.

## Out of scope (do NOT over-build)

- Human users + membership (`users`, `workspace_users` M:N, roles) — separate "org layer" slice; the schema admits it later.
- Nested/reseller tenancy (recursive sub-tenants).
- Postgres RLS (D-RLS-LATER — second layer, opt-in).
- TheoCloud managed control-plane provisioning (Item 7 cloud runtime proper; this slice is the OSS-local foundation it builds on).

## Risks

- **Blast radius:** 6 tables + the `composeFilters` locus + every repo (`pgvector-store`, `pgvector-skill-store`, `recall-cache-store`, `history-manager`, distillation stores) must thread `workspace_id`. Mitigate via D-REPO-REQUIRED (compiler catches every call site).
- **Breaking AuthVerifier:** public surface re-export change; mitigate with the env-key→default bridge + a clearly-documented pre-release breaking note.
- **Migration safety:** the backfill must run before `SET NOT NULL`; the template/integration-suite isolation (just stabilized) must keep working with the new migration 0016.

## Coverage corners

- **Tests:** IDOR 404 suite; recall-isolation; create-from-Principal-not-body; revoked-key 401; admin-keys-per-workspace; legacy-env-bridge; migration 0016 backfill correctness against real pgvector.
- **Deps:** none new (uses existing `pg`, `zod`, node `crypto` sha256). To confirm in `/deps-audit`.
- **Tools:** existing drizzle migration chain + vitest integration harness (template-clone isolation).
- **Techniques:** denormalized tenant column (R2R), Principal resolution, non-destructive add-nullable→backfill→NOT-NULL→bridge→enforce, 404-not-403 existence hiding, compile-time required workspace param.
