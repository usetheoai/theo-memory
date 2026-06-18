# Blueprint: Multi-Tenant Isolation completion + RBAC (Slice 1 100% + Slice 2)

**Date:** 2026-06-17
**Investigated question:** "How do we take TheMemory's workspace isolation to 100% (Slice 1) and add members/roles RBAC (Slice 2) exactly as the sibling `theo-rag` reference does?"
**Sources (2 independent, both verified on disk):**
1. `../theo-rag` — sibling project that fully implements BOTH slices in the SAME stack (TS + Hono + drizzle + pg + zod). Reference map extracted file-by-file.
2. `theo-memory` current state — Slice 1 ~85% shipped (`multi-tenant-workspace-isolation` plan, migration `0016`, `Principal{workspaceId,scopes}`, `withWorkspace` binding); Item 20 auth lifecycle (`theo_api_keys`, `requireScope`, `admin-keys.ts`).

---

## Context

theo-memory already shipped Slice 1 for the PRIMARY 4-verb path on `memories` (runtime-enforced via `withWorkspace` binding + `composeFilters` workspace clause + `0016` migration). Gaps to 100%, plus all of Slice 2 (RBAC), are the subject of this blueprint.

theo-rag is the canonical reference: it implements the EXACT pattern (Principal-from-credential, 404-not-403, owned() scoping, users+workspace_users RBAC, requireRole, last-owner invariant, anti-escalation guard, 503 fail-closed) in an identical stack. Patterns transfer 1:1.

---

## Coverage Corner 1 — Integration Tests

- **IDOR regression matrix** (theo-rag `tests/contract/workspace-isolation.contract.test.ts`): two-workspace injected verifier; every cross-workspace GET/PATCH/DELETE → 404; lists empty; same-workspace → 200; unknown key → 401. theo-memory has the `memories` slice of this (`tests/integration/auth/workspace-isolation.test.ts`); EXTEND to cache/skill/eviction + REST-over-HTTP.
- **Authz role×route matrix** (theo-rag `tests/contract/workspace-members.contract.test.ts`): `MANAGEMENT_ROUTES` array drives `it.each`; member→403 on every management route, owner/admin allowed, RAG open to member, unknown key→401. NEW for theo-memory.
- **Per-endpoint RBAC** (theo-rag `api-keys.contract.test.ts` / `members.contract.test.ts`): anti-escalation (201 lower-rank, 422 non-member, 403 outranks); last-owner (409 demote/delete last owner; "add 2nd owner then demote 1st"→200).
- **Fail-closed 503** (theo-rag `middleware.test.ts:72`): throwing verifier → 503, principal never set.
- **Secondary-store isolation** (theo-memory NEW): byte-identical query in ws-A/ws-B → cache MISS across them; ws-A skill recall never returns ws-B skill; eviction in ws-A never evicts ws-B row.
- Run against real `ankane/pgvector:v0.5.1` via `THEOMEM_PG_URI`; contract tests run DB-less via injected in-memory repos.

## Coverage Corner 2 — Dependencies

- **No new runtime deps.** Everything builds on already-pinned `pg`, `zod`, `drizzle-orm`/`drizzle-kit`, `hono`, `node:crypto` (SHA-256). `/deps-audit` is a no-op (zero new declared deps → no `plan_dep_*` cap).
- IDs: theo-rag uses `@paralleldrive/cuid2`; theo-memory already mints `theo_live_*` keys + uses its own id scheme — REUSE existing id generation, do NOT add cuid2.

## Coverage Corner 3 — Tools

- `drizzle-kit generate` for the `0017` migration meta snapshot; hand-edit SQL for seed-before-FK ordering + backfill (same recipe as `0016`).
- `psql` side-channel only if the migration carries triggers/functions (it does NOT — plain DDL + seed + backfill).
- `schema-snapshot-parity.test.ts` + `journal-sync.test.ts` guard drizzle parity (must show 18 SQL = 18 snapshots = 18 journal entries after `0017`).
- vitest: contract (`vitest.contract.config.ts`) + integration (`vitest.integration.config.ts`).

## Coverage Corner 4 — Techniques

- **DIP repository pattern**: interface + in-memory impl colocated in `*-store.ts`; PG impl in `*-store-pg.ts`; `resolveXRepository(options)` composition root in `createApp`/`createServer`. Contract tests inject in-memory; integration tests hit pg. (theo-rag `app.ts` + `members-store.ts`/`members-store-pg.ts`.)
- **owned() helper** (in-memory) / `WHERE id = ? AND workspace_id = ?` (pg) → undefined/false → 404 upstream.
- **Default-deny role resolution**: LEFT JOIN `theo_api_keys → workspace_users`; `role ?? 'member'`.
- **Last-owner invariant**: `db.transaction` + `SELECT ... FOR UPDATE` lock on the workspace's membership rows BEFORE the count-then-mutate guard (TOCTOU-safe). `last_owner` → 409.
- **Anti-escalation guard**: when minting a key with an explicit `user_id != caller`, validate target membership (`null`→422) + `roleSatisfies(caller.role, targetRole)` (false→403).
- **Fail-closed**: `try { resolvePrincipal } catch { return 503 }`; principal only set on success — never fall through to a privileged default.
- **Non-destructive migration**: seed default-owner user + membership `ON CONFLICT DO NOTHING`; `ADD COLUMN user_id` nullable; backfill legacy keys → `default-owner`; FKs with appropriate `ON DELETE` (`workspace_users` cascade; `theo_api_keys.user_id` set null).
- **Role ranking**: `ROLE_RANK = { member: 0, admin: 1, owner: 2 }`; `roleSatisfies(role, min) = RANK[role] >= RANK[min]`.

---

## ADRs (design decisions for the completion)

### BD1 — RBAC role coexists with Item 20 capability scopes (additive, not replacement)
- **Decision:** `Principal` carries BOTH `scopes` (key capability, Item 20) AND `role` (workspace membership, Slice 2). `requireRole(min)` is the RBAC gate on `/v1/members/*`; `requireScope('memory:admin')` (existing) stays on `/v1/admin/keys/*`, PLUS the anti-escalation membership check is added to key-mint.
- **Rationale:** Item 20 shipped scope-based admin; ripping it out is gratuitous breakage. theo-rag's role model layers cleanly on top — role gates membership management; scope gates capability. Both resolved from the same key.
- **Alternatives:** *Replace scopes with roles* — rejected (breaks Item 20 + every admin-keys test). *Roles only on members, ignore keys* — rejected (anti-escalation needs role-rank on key mint).

### BD2 — `theo_api_keys.user_id` FK to `users`; keep `subject` for back-compat
- **Decision:** Add nullable `user_id text references users(id) on delete set null`. Keep the existing `subject` column (Item 20 human-facing owner). Role resolution joins on `(workspace_id, user_id)`.
- **Rationale:** Faithful to theo-rag; `subject` is orthogonal (free-text), `user_id` is the membership FK. `set null` so deleting a user does not orphan the key.

### BD3 — 503 fail-closed closes BOTH the Slice 1 gap and the Slice 2 requirement
- **Decision:** Wrap `resolvePrincipal` in the bearer middleware in try/catch → 503 `service_unavailable`; principal set only on success.
- **Rationale:** theo-rag `middleware.ts:101`; an infra failure in the role-join lookup MUST fail closed, never fall through to the default-workspace owner Principal.

### BD4 — Secondary stores (recall-cache, skill, eviction) thread `workspace_id` to reach Slice 1 100%
- **Decision:** recall-cache scope key includes `workspace_id`; skill-store + eviction WHERE/insert carry it. Closes the deferred T1.2 of the original plan.
- **Rationale:** With these threaded, EVERY surface is workspace-isolated → Slice 1 security property is 100% (no opt-in surface leaks). The compile-time `ScopedFilters` guard (D4) stays runtime-enforced + documented (defense-in-depth, not a leak).

---

## What to apply (from theo-rag) / what to adapt

- **Apply 1:1:** Principal+role shape, ROLE_RANK/roleSatisfies, requireRole, last-owner FOR UPDATE tx, anti-escalation guard, 503 fail-closed, members repo DIP, idempotent seed+backfill migration, role×route + IDOR matrices.
- **Adapt:** member routes mount on theo-memory's `createServer`/`createApp` wiring (Hono OpenAPIHono); key routes reuse existing `admin-keys.ts` (add anti-escalation + requireRole), NOT a fresh `api-keys.ts`; reuse `theo_api_keys` (Item 20) instead of theo-rag's `api_keys`; reuse `theo_live_*` minting.
- **Do NOT copy:** cuid2 dep; the `collections/documents/chunks` resource model (theo-memory's resources are `memories`/skills, already workspace-scoped via `0016`); webhook worker payload (theo-memory eviction cron carries workspace via the eviction WHERE, no job queue).

---

## References

- theo-rag map: produced 2026-06-17 (general-purpose agent, 18-item exhaustive). Files cited: `packages/api/src/server/auth/{auth-verifier,api-key-verifier,api-key-pg-verifier,bearer-verifier,middleware}.ts`, `store/members-store{,-pg}.ts`, `handlers/{api-keys,members}.ts`, `migrations/0003_workspace_isolation.sql`, `0004_workspace_members.sql`, `tests/contract/{workspace-isolation,workspace-members,api-keys,members}.contract.test.ts`.
- theo-memory current: `multi-tenant-workspace-isolation-plan.md`; migration `0016_workspaces.sql`; `principal.ts`; `api-key-verifier.ts`; `middleware.ts`; `scope-verifier.ts`; `schema.ts` (workspaces + theo_api_keys.workspace_id).
- Owner directive (2026-06-17): Slice 1 100% + Slice 2 100%, consult `../theo-rag`.
