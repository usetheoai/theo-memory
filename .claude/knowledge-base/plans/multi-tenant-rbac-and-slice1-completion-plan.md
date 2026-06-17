---
slug: multi-tenant-rbac-and-slice1-completion
created_at: 2026-06-17
goal: Take workspace isolation to 100% (thread workspace_id through every secondary store + 503 fail-closed) and add full members/roles RBAC (users + workspace_users + requireRole + last-owner invariant + anti-escalation guard) exactly as the theo-rag reference, proven by an IDOR matrix + an authz role×route matrix against real pgvector.
---

# Plan: Multi-Tenant RBAC (Slice 2) + Slice 1 completion

> Replicates the `../theo-rag` reference (same TS+Hono+drizzle+pg+zod stack). Slice 1 took the PRIMARY 4-verb `memories` path to runtime-enforced isolation (plan `multi-tenant-workspace-isolation`, migration `0016`, `Principal{workspaceId,scopes}`, `withWorkspace`). This plan (a) closes the deferred secondary stores + 503 fail-closed so Slice 1 is 100%, and (b) adds the RBAC layer (users/members/roles) so Slice 2 is 100%.

## Goal

> "Every credential resolves to a `Principal{workspaceId, userId, role, scopes}`; every secondary store (recall-cache/skill/eviction) is workspace-scoped; management routes are role-gated; a workspace can never lose its last owner; an admin cannot mint a key that outranks itself; an infra failure fails closed (503). Measured by `tests/integration/auth/workspace-rbac.test.ts` (role×route matrix + last-owner + anti-escalation + 503) and the extended IDOR matrix — 0 failed against real `ankane/pgvector:v0.5.1`."

## Context

Owner directive (2026-06-17): take Slice 1 to 100% and Slice 2 (RBAC) to 100%, using `../theo-rag` as the canonical reference. Grounded in `.claude/knowledge-base/discoveries/blueprints/multi-tenant-rbac-completion-blueprint.md` (theo-rag file-by-file map + current-state diff) and the in-repo Item 20 foundation (`theo_api_keys` + `requireScope` + `admin-keys.ts`).

**PRIORITY 0 re-classification (honesty, Inquebrável Rule 10):** Slice 2 (RBAC) is a new feature; under P0 it would be FROZEN. The project owner re-classified it IN-SCOPE by explicit directive (2026-06-17), as the membership layer the workspace amendment (CLAUDE.md 2026-06-17) and v0.5 TheoCloud runtime (Item 7) depend on. Recorded as a CLAUDE.md amendment in T4.1.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | Status today | Why it exists | Invariant to preserve |
|---|---|---|---|
| `packages/core/src/domain/principal.ts` | `Principal{workspaceId,scopes}` + `DEFAULT_WORKSPACE_ID` + `makeVerifyShim` | the credential→tenant type | ADD `userId`/`role`; ADD `WorkspaceRole`/`ROLE_RANK`/`roleSatisfies`/`DEFAULT_OWNER_USER_ID`; keep existing exports |
| `packages/core/src/domain/index.ts` | exports `Principal`,`Workspace`,`WorkspaceMismatch` | public domain barrel | ADD `WorkspaceRole`,`roleSatisfies`,`DEFAULT_OWNER_USER_ID` |
| `packages/core/src/infrastructure/db/schema.ts` | `workspaces`,`theo_api_keys.workspace_id` exist | drizzle parity | ADD `users`,`workspace_users`,`theo_api_keys.user_id` |
| `packages/core/src/infrastructure/db/migrations/0017_workspace_members.sql` (NEW) | 0 | RBAC tables + seed + backfill | non-destructive, idempotent |
| `packages/api/src/server/auth/api-key-verifier.ts` | `resolvePrincipal → {workspaceId,scopes}` | key→principal | JOIN `workspace_users` → role (default-deny `member`); add `userId` |
| `packages/api/src/server/auth/bearer-verifier.ts` | env bridge → default-workspace principal | legacy bridge | resolve to default-workspace OWNER (userId=`default-owner`, role=`owner`) |
| `packages/api/src/server/auth/middleware.ts` | injects Principal; NO try/catch | bearer gate | ADD `requireRole`; ADD 503 fail-closed try/catch; `DEFAULT_PRINCIPAL` gains role=`owner` |
| `packages/api/src/server/handlers/admin-keys.ts` | mint/list/rotate/revoke via `requireScope` | key lifecycle | ADD anti-escalation guard on mint with explicit user_id |
| `packages/api/src/server/handlers/members.ts` (NEW) | 0 | member CRUD | role-gated; last-owner 409 |
| `packages/api/src/server/store/members-store.ts` (NEW) | 0 | `MembersRepository` interface + in-memory | DIP; contract-testable DB-less |
| `packages/api/src/server/store/members-store-pg.ts` (NEW) | 0 | pg impl | last-owner tx + `FOR UPDATE` |
| `packages/api/src/server/app.ts` (or `createServer`) | `createApp` wiring | composition root | wire members routes + repo + requireRole |
| `packages/core/src/infrastructure/db/recall-cache/pgvector-recall-cache-store.ts` | carries `workspace_id` column, NOT in cache key | cache | include `workspace_id` in scope key + lookup |
| `packages/core/src/infrastructure/db/pgvector-skill-store.ts` | carries column, not threaded | skill store | workspace_id WHERE + insert |
| `packages/core/src/infrastructure/db/eviction/{scope-where,scope-candidate,triadic-scoring-policy}.ts` | carries column, not threaded | eviction | workspace_id AND-clause |

> Exact LoC captured at implementation time via `wc -l`. Blast radius: Principal has ~5 construction sites (middleware default, bearer, api-key, test fixtures); secondary stores are 3 isolated modules.

### Current callers / dependents
- **Principal constructors** (must supply new fields): `auth/middleware.ts` (`DEFAULT_PRINCIPAL`), `auth/bearer-verifier.ts`, `auth/api-key-verifier.ts`, server/MCP/CLI test fixtures.
- **`requireScope`** consumers (Item 20): `app.ts`/`createServer` admin-keys wiring — unchanged; `requireRole` is added alongside, not replacing.
- **Secondary stores**: `recall-cache` is opt-in (`createLocalMemory({recallCache})`); skill via `Memory.skills(repoId)`; eviction cron — all already carry the `0016` column.

### Domain glossary
- **Role** — `owner | admin | member`, a user's privilege WITHIN a workspace (`workspace_users.role`). Orthogonal to `scopes` (the key's capability, Item 20).
- **Member** — a `(workspace_id, user_id)` row in `workspace_users`.
- **default-owner** — the seeded `users` row (`'default-owner'`) that every legacy/no-credential request acts as (owner of the `default` workspace).
- **last-owner invariant** — a workspace always has ≥ 1 owner; enforced atomically.

### Architecture boundaries affected
- `architecture.md § 3` (DIP): `WorkspaceRole`/`roleSatisfies` are pure domain (`core/domain`); `MembersRepository` interface + in-memory impl colocate in `store/members-store.ts`; pg impl in `store/members-store-pg.ts`. `core` MUST NOT import adapters.
- `architecture.md § 9` (public surface): new `WorkspaceRole`/`roleSatisfies` exports require barrel + README + a contract test.
- `architecture.md § 10.1`: `0017` SQL must be copied to `dist/` by the existing postbuild step + publish-readiness assertion.
- `architecture.md § 1` (three tiers locked): roles are NOT a tier; they are tenant-membership metadata — no tier change.

## Prior Art & Related Work
- `../theo-rag` — full reference impl (blueprint map). Files: `auth/{auth-verifier,api-key-pg-verifier,middleware}.ts`, `store/members-store{,-pg}.ts`, `handlers/{api-keys,members}.ts`, `migrations/0004_workspace_members.sql`, `tests/contract/{workspace-members,api-keys,members}.contract.test.ts`.
- `.claude/knowledge-base/plans/multi-tenant-workspace-isolation-plan.md` — Slice 1 (this plan completes its deferred secondary-stores work + adds RBAC).
- `.claude/knowledge-base/discoveries/blueprints/multi-tenant-rbac-completion-blueprint.md` — this plan's blueprint.
- Item 20 `theo-memory-faang-auth-lifecycle` — `theo_api_keys`, `requireScope`, `admin-keys.ts` foundation.

## Objective
- [ ] `users` + `workspace_users` tables + `theo_api_keys.user_id` exist via non-destructive idempotent `0017` migration with seeded `default-owner` + backfill (Phase 0).
- [ ] `Principal{workspaceId,userId,role,scopes}` + `WorkspaceRole`/`ROLE_RANK`/`roleSatisfies` exist and are exported (Phase 0).
- [ ] `resolvePrincipal` JOINs `workspace_users` (default-deny `member`); env/no-credential bridge → default-owner; middleware fails closed with 503 on infra error (Phase 1).
- [ ] `requireRole(min)` gates management routes; `MembersRepository` (in-memory + pg) + `/v1/members` CRUD; anti-escalation guard on key mint (Phase 2).
- [ ] Secondary stores (recall-cache cache-key, skill-store, eviction) thread `workspace_id` → Slice 1 100% (Phase 3).
- [ ] IDOR matrix + role×route matrix + last-owner + anti-escalation + 503 pass vs real pgvector; full suite + typecheck + lint green (Final).

## ADRs

### D1 — RBAC role coexists with Item 20 capability scopes (additive)
- **Decision:** `Principal` carries BOTH `scopes` (key capability) and `role` (workspace membership). `requireRole('admin')` gates `/v1/members/*`; existing `requireScope('memory:admin')` stays on `/v1/admin/keys/*`; the anti-escalation membership check is ADDED to key mint.
- **Rationale:** Item 20 shipped scope-based admin with passing tests; replacing it is gratuitous breakage. theo-rag's role model layers cleanly: role gates membership, scope gates capability.
- **Alternatives considered:** *Replace scopes with roles* — rejected: breaks Item 20 + every admin-keys test for no benefit. *Roles only on members, not keys* — rejected: anti-escalation needs the caller's role-rank at key mint.
- **Consequences:** Principal grows two fields; both authz models coexist (documented).

### D2 — `theo_api_keys.user_id` FK to `users`; keep `subject`
- **Decision:** Add nullable `user_id text references users(id) on delete set null`. Keep the existing `subject` (Item 20 free-text owner). Role resolution LEFT JOINs `workspace_users` on `(workspace_id, user_id)`.
- **Rationale:** Faithful to theo-rag; `subject` and `user_id` are orthogonal. `set null` avoids orphaning a key when a user is deleted.
- **Alternatives considered:** *Reuse `subject` as the membership key* — rejected: `subject` is free-text, not an FK; conflates identity with display. *NOT NULL user_id* — rejected: legacy keys have no member; nullable + backfill to `default-owner` is non-destructive.
- **Consequences:** One nullable column + FK; backfill legacy keys to `default-owner`.

### D3 — Last-owner invariant is atomic (transaction + `SELECT ... FOR UPDATE`)
- **Decision:** `setRole`/`remove` run inside `db.transaction`; lock the workspace's `workspace_users` rows with `.for('update')` BEFORE the owner-count guard; demoting/removing the last owner returns `last_owner` → 409.
- **Rationale:** A naive count-then-mutate races: two concurrent demotions both read `owners=1` is false but both read `owners=2` then both demote → 0 owners (permanent lockout). Row-lock serializes them (theo-rag `members-store-pg.ts`).
- **Alternatives considered:** *Count then update without lock* — rejected: TOCTOU race orphans the workspace. *Unique partial index "≥1 owner"* — rejected: Postgres cannot express a cross-row min-count constraint without a trigger; the FOR UPDATE tx is simpler + matches the reference.
- **Consequences:** member mutations take a short row lock; concurrent demotions serialize.

### D4 — Anti-escalation guard on key mint with explicit `user_id`
- **Decision:** When minting a key with `user_id != caller.userId`: if the target is not a member → 422; if `!roleSatisfies(caller.role, targetRole)` → 403. Omitting `user_id` binds the key to the caller.
- **Rationale:** Without it, an admin mints a key bound to an owner; the role-join then resolves that key as owner → silent self-escalation (theo-rag `handlers/api-keys.ts:46`).
- **Alternatives considered:** *Forbid explicit user_id entirely* — rejected: legitimate admin delegation needs it. *Allow any member* — rejected: that IS the escalation hole.
- **Consequences:** mint handler consults `MembersRepository.getMemberRole`; two new error paths (422/403).

### D5 — 503 fail-closed on auth-backend failure
- **Decision:** Wrap `resolvePrincipal` in the bearer middleware in try/catch → 503 `service_unavailable`; the Principal is set ONLY on success.
- **Rationale:** The role join now hits the DB; if Postgres is down, falling through to the default-owner Principal would be fail-OPEN to owner. Fail closed (theo-rag `middleware.ts:101`).
- **Alternatives considered:** *Let the exception 500* — rejected: an unhandled 500 is less honest than an explicit 503 and risks a framework default that leaks a stack. *Fall back to default principal* — rejected: fail-open to owner is the worst outcome.
- **Consequences:** one try/catch; a regression test asserts a throwing verifier → 503, principal unset.

### D6 — Secondary stores thread `workspace_id` (Slice 1 100%)
- **Decision:** recall-cache scope key includes `workspace_id`; skill-store + eviction add the `workspace_id` AND-clause/insert. Closes the deferred secondary-stores work of `multi-tenant-workspace-isolation`.
- **Rationale:** These opt-in surfaces carry the `0016` column but do not filter by it; with them threaded, EVERY surface is isolated → Slice 1 security property is 100%.
- **Alternatives considered:** *Keep deferred* — rejected: the goal is Slice 1 100%. *Disable the opt-in surfaces in multi-workspace* — rejected: theo-rag isolates all surfaces; disabling is a worse product.
- **Consequences:** cache cosine lookup gains a workspace predicate; cross-workspace cache hit becomes impossible.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Principal field addition breaks ~5 construction sites | High | additive with explicit defaults (default-owner/owner); typecheck catches every site | Implementer |
| Last-owner TOCTOU race orphans a workspace | Critical | D3 tx + FOR UPDATE; concurrency test issues two parallel demotions, asserts exactly one 409 | Implementer + `/review` |
| Key-mint self-escalation | Critical | D4 membership+rank guard; per-endpoint test (201/422/403) | Implementer + `/review` security agent |
| Auth-backend down → fail-open to owner | Critical | D5 try/catch → 503; throwing-verifier regression test | Implementer |
| `0017` backfill ordering (SET NOT NULL before backfill) | High | seed user+membership → ADD COLUMN nullable → backfill → (column stays nullable, no SET NOT NULL needed for user_id) | Implementer |
| Drizzle schema/meta parity drift with `0017` | Medium | `schema-snapshot-parity.test.ts` + `journal-sync.test.ts` re-run; meta generated not hand-edited | Implementer |
| Forgetting `requireRole` on a future route | Medium | role×route matrix `it.each` turns red if a management route lacks the gate | Implementer + `/review` |

## Unresolved Questions
- Q1 — Should `/v1/admin/keys/*` also get `requireRole('admin')` on top of `requireScope('memory:admin')`? **Default:** keep `requireScope` (Item 20 contract) AND add the anti-escalation membership check; do NOT double-gate with requireRole (avoids breaking Item 20 tests). Resolved in T2.1.
- Q2 — MCP/CLI per-member roles? **Default:** REST first; MCP/CLI inherit the env→default-owner bridge this slice (same deferral as the Slice 1 plan Q2). Out of scope here.
- Q3 — Do skill/eviction need member-role gating? **Default:** no — they are data surfaces, gated by workspace isolation (Slice 1), not by role. Role gates management only.

## Dependencies

No NEW runtime dependencies. Built entirely on already-pinned deps:

| Dependency | Version (existing) | Use | Rule 9 note |
|---|---|---|---|
| `pg` | existing pin | members table + tx FOR UPDATE + `0017` | incumbent Postgres driver |
| `drizzle-orm` / `drizzle-kit` | existing pin | `schema.ts` parity + `0017` meta | incumbent migration toolchain |
| `zod` | existing pin | member request schemas | incumbent validation lib |
| `node:crypto` (built-in) | n/a | SHA-256 (unchanged) | Node built-in |
| `hono` | existing pin | requireRole middleware + member routes | incumbent server framework |

No CVE surface change (zero new packages). `/deps-audit` is a no-op beyond confirming the above.

## Dependency Graph

```
Phase 0 (RBAC schema 0017 + domain role types + Principal fields)
   │
   ▼
Phase 1 (auth: resolvePrincipal role-join default-deny + env/default-owner bridge + 503 fail-closed)
   │
   ▼
Phase 2 (RBAC surface: requireRole + MembersRepository (in-memory+pg, last-owner tx) + /v1/members + anti-escalation on mint)
   │
   ▼
Phase 3 (Slice 1 100%: thread workspace_id through recall-cache + skill-store + eviction)
   │
   ▼
Final Phase: Integration Validation (IDOR matrix + role×route matrix + last-owner + anti-escalation + 503 vs real pgvector; full suite + typecheck + lint; docs)
```

---

## Phase 0: RBAC schema + domain role types

**Objective:** `users`/`workspace_users`/`theo_api_keys.user_id` exist via `0017`; `Principal` carries `userId`+`role`; `WorkspaceRole`/`ROLE_RANK`/`roleSatisfies` exist and are exported.

### T0.1 — Domain role types + Principal fields

#### Objective
Add `WorkspaceRole = 'owner'|'admin'|'member'`, `ROLE_RANK`, `roleSatisfies(role,min)`, `DEFAULT_OWNER_USER_ID = 'default-owner'`, and widen `Principal` with `userId: string | null` + `role: WorkspaceRole`, in `packages/core/src/domain/principal.ts`; export from the barrel.

#### Why this step (action + reasoning)
1. **What** — the pure-domain role contract every later phase consumes, in `core/domain` (no I/O).
2. **Why now** — auth resolution (Phase 1) and `requireRole` (Phase 2) both depend on `roleSatisfies` + the widened Principal.

#### Evidence
- `packages/core/src/domain/principal.ts:37-50` (current `Principal` + `DEFAULT_WORKSPACE_ID`).
- `packages/core/src/domain/index.ts` (barrel re-exporting `Principal`).
- theo-rag `auth-verifier.ts:17-45` (reference `ROLE_RANK`/`roleSatisfies`).

#### Files to edit
```
packages/core/src/domain/principal.ts — add WorkspaceRole, ROLE_RANK, roleSatisfies, DEFAULT_OWNER_USER_ID; widen Principal
packages/core/src/domain/index.ts — export WorkspaceRole, roleSatisfies, DEFAULT_OWNER_USER_ID
packages/core/src/domain/principal.test.ts — roleSatisfies truth table; Principal shape
```

#### Deep Dives
- `ROLE_RANK = { member: 0, admin: 1, owner: 2 }`; `roleSatisfies(role, min) = ROLE_RANK[role] >= ROLE_RANK[min]`.
- `Principal.userId` is `string | null` (legacy keys have no member); `role` defaults conceptually to `member` at resolution (default-deny), `owner` for the default-workspace bridge.

#### TDD
```
RED:   principal.test.ts asserts roleSatisfies('admin','member')===true, roleSatisfies('member','admin')===false, roleSatisfies('owner','owner')===true; a Principal can carry userId:null + role.
GREEN: implement types + function.
REFACTOR: none.
VERIFY: pnpm vitest run packages/core/src/domain/principal.test.ts --config vitest.contract.config.ts
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm vitest run packages/core/src/domain/principal.test.ts --config vitest.contract.config.ts` exits 0.
- [ ] `WorkspaceRole`, `roleSatisfies`, `DEFAULT_OWNER_USER_ID` exported from `@usetheo/memory/contract` (smoke import).
- [ ] `pnpm run typecheck` 0 errors; `pnpm run lint` 0 warnings.

#### DoD
- [ ] typecheck 0 + lint 0; the roleSatisfies truth-table test passes.
- [ ] `CHANGELOG.md [Unreleased]` notes the Principal widening.

### T0.2 — `0017_workspace_members.sql` migration + drizzle parity

#### Objective
Create `users` + `workspace_users` (composite PK + CHECK enum), add nullable `theo_api_keys.user_id` FK, seed `default-owner` user + its `default`-workspace owner membership (`ON CONFLICT DO NOTHING`), backfill legacy keys' `user_id` → `default-owner`. Keep `schema.ts` + meta snapshots in parity.

#### Why this step (action + reasoning)
1. **What** — the non-destructive idempotent RBAC schema (D2) Phase 1 resolution reads.
2. **Why now** — the role join needs `workspace_users` + `theo_api_keys.user_id` to exist.

#### Evidence
- theo-rag `migrations/0004_workspace_members.sql` (reference recipe: tables + seed + backfill).
- `packages/core/src/infrastructure/db/migrations/0016_workspaces.sql` (sibling recipe: seed before FK, idempotent).
- `packages/core/src/infrastructure/db/schema.ts:428-470` (`theoApiKeys` to extend with `user_id`).
- `architecture.md § 10.1` (postbuild copy) + `tests/integration/schema-snapshot-parity.test.ts`.

#### Files to edit
```
packages/core/src/infrastructure/db/migrations/0017_workspace_members.sql (NEW)
packages/core/src/infrastructure/db/migrations/meta/0017_snapshot.json (NEW, generated)
packages/core/src/infrastructure/db/migrations/meta/_journal.json — append 0017
packages/core/src/infrastructure/db/schema.ts — add users, workspace_users, theo_api_keys.user_id
tests/integration/migrations/workspace-members-migration.test.ts (NEW)
```

#### Deep Dives
- `workspace_users`: `(workspace_id text → workspaces.id ON DELETE cascade, user_id text → users.id ON DELETE cascade, role text NOT NULL DEFAULT 'member', created_at)`, PK `(workspace_id,user_id)`, CHECK `role IN ('owner','admin','member')`.
- `users`: `(id text PK, email text NOT NULL UNIQUE, name text, created_at)`.
- `theo_api_keys.user_id text references users(id) ON DELETE set null` (nullable).
- Order: CREATE users → CREATE workspace_users → ADD COLUMN theo_api_keys.user_id → seed user `('default-owner','owner@default.local','Default Owner')` ON CONFLICT DO NOTHING → seed membership `('default','default-owner','owner')` ON CONFLICT DO NOTHING → backfill `UPDATE theo_api_keys SET user_id='default-owner' WHERE user_id IS NULL`. Idempotent: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, FK in a `DO $$ ... duplicate_object` block (0016 precedent).

#### TDD
```
RED:   workspace-members-migration.test.ts (isolated DB pre-seeded with a legacy theo_api_keys row, user_id absent) asserts post-0017: users has 'default-owner'; workspace_users has ('default','default-owner','owner'); the CHECK rejects role='superuser'; legacy key's user_id = 'default-owner'.
GREEN: author 0017 + generate meta snapshot + extend schema.ts.
REFACTOR: none.
VERIFY: THEOMEM_PG_URI=... pnpm vitest run tests/integration/migrations/workspace-members-migration.test.ts tests/integration/schema-snapshot-parity.test.ts tests/integration/migrations/journal-sync.test.ts --config vitest.integration.config.ts
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] migration + parity + journal-sync integration tests exit 0 against real pgvector.
- [ ] `schema-snapshot-parity.test.ts` shows 18 SQL = 18 snapshots = 18 journal entries.
- [ ] CHECK constraint rejects an out-of-enum role; backfill sets legacy keys to `default-owner`.
- [ ] `0017` SQL copied to `dist/` (publish-readiness assertion); lint 0.

#### DoD
- [ ] `pnpm vitest run tests/integration/migrations/workspace-members-migration.test.ts tests/integration/schema-snapshot-parity.test.ts --config vitest.integration.config.ts` exits 0.
- [ ] typecheck 0; `CHANGELOG.md [Unreleased]` gains the migration entry.

---

## Phase 1: Auth — resolve role; fail closed

### T1.1 — `resolvePrincipal` role-join (default-deny) + default-owner bridge + 503 fail-closed

#### Objective
`ApiKeyAuthVerifier.resolvePrincipal` LEFT JOINs `workspace_users` on `(workspace_id, user_id)` and returns `{workspaceId, userId, role: role ?? 'member', scopes}`; `BearerAuthVerifier` + the no-credential path resolve to the default workspace OWNER (`userId='default-owner'`, `role='owner'`); the bearer middleware wraps `resolvePrincipal` in try/catch → 503.

#### Why this step (action + reasoning)
1. **What** — the credential→role resolution + the fail-closed guard.
2. **Why now** — `requireRole` (Phase 2) reads `principal.role`; it must be populated and trustworthy first.

#### Evidence
- `packages/api/src/server/auth/api-key-verifier.ts:65-141` (current `resolvePrincipal` SELECT — extend to join role).
- `packages/api/src/server/auth/bearer-verifier.ts` (env bridge — add userId/role=owner).
- `packages/api/src/server/auth/middleware.ts:27-105` (`DEFAULT_PRINCIPAL` + `resolvePrincipalFrom` + the `c.set('principal')` path — add try/catch).
- theo-rag `api-key-pg-verifier.ts:36-67` (reference role join + default-deny).

#### Files to edit
```
packages/api/src/server/auth/api-key-verifier.ts — SELECT joins workspace_users; role ?? 'member'; userId
packages/api/src/server/auth/bearer-verifier.ts — resolvePrincipal → default-owner owner Principal
packages/api/src/server/auth/middleware.ts — DEFAULT_PRINCIPAL role=owner/userId=default-owner; try/catch → 503
packages/api/src/server/auth/__tests__/api-key-verifier.test.ts — role join + default-deny + revoked→null
packages/api/src/server/auth/__tests__/middleware.test.ts — throwing verifier → 503, principal unset
tests/integration/auth/principal-role-resolution.test.ts (NEW)
```

#### Deep Dives
- SQL: `SELECT k.workspace_id, k.user_id, k.scopes, m.role FROM theo_api_keys k LEFT JOIN workspace_users m ON m.workspace_id = k.workspace_id AND m.user_id = k.user_id WHERE k.key_hash=$1 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > NOW()) AND k.tenant_id='self' LIMIT 1`. The revoked/expired predicate is VERBATIM the existing one (EC-2 guard); only the SELECT + JOIN grow.
- default-deny: `role: (row.role as WorkspaceRole | null) ?? 'member'`.
- 503: `let principal; try { principal = await resolvePrincipalFrom(...) } catch { return c.json({code:'SERVICE_UNAVAILABLE',...}, 503) }`. Principal set only after the null check.

#### TDD
```
RED:   api-key-verifier.test.ts: a seeded key whose user is an 'admin' member → role 'admin'; a key whose user has NO membership → role 'member' (default-deny); a revoked key → null. middleware.test.ts: a verifier whose resolvePrincipal rejects → 503 and c.get('principal') is undefined.
GREEN: implement join + default-deny + bridge + try/catch.
REFACTOR: none.
VERIFY: THEOMEM_PG_URI=... pnpm vitest run tests/integration/auth/principal-role-resolution.test.ts --config vitest.integration.config.ts ; pnpm vitest run packages/api/src/server/auth/__tests__/middleware.test.ts --config vitest.contract.config.ts
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] `resolvePrincipal` returns the joined `role`; no-membership → `member`; revoked/expired → null.
- [ ] env key + no-credential → default-workspace owner Principal (`userId='default-owner'`, `role='owner'`).
- [ ] a throwing verifier → 503; principal never set (fail closed).

#### DoD
- [ ] `pnpm vitest run tests/integration/auth/principal-role-resolution.test.ts --config vitest.integration.config.ts` exits 0 and the 503 contract test passes.
- [ ] typecheck 0; lint 0.

---

## Phase 2: RBAC surface — requireRole, members, anti-escalation

### T2.1 — `requireRole` + `MembersRepository` (in-memory + pg, last-owner tx) + `/v1/members` + anti-escalation

#### Objective
Add `requireRole(min)` middleware; a `MembersRepository` DIP (in-memory + pg impls) with `list`/`addByEmail`/`setRole`/`remove`/`getMemberRole`, where `setRole`/`remove` enforce the last-owner invariant atomically (tx + `FOR UPDATE`); wire `/v1/members` (GET/POST/PATCH/DELETE) under `requireRole('admin')`; add the anti-escalation guard to `admin-keys.ts` mint.

#### Why this step (action + reasoning)
1. **What** — the RBAC management surface + the two security invariants.
2. **Why now** — Phase 1 makes `role` trustworthy; this is where it is enforced + mutated.

#### Evidence
- `packages/api/src/server/handlers/admin-keys.ts` (mint handler — add anti-escalation).
- `packages/api/src/server/app.ts` / `createServer` (wiring — add members routes + repo).
- `packages/api/src/server/auth/middleware.ts` (add `requireRole`).
- theo-rag `middleware.ts:40-51` (requireRole), `members-store-pg.ts` (last-owner tx), `handlers/api-keys.ts:46-66` (anti-escalation), `tests/contract/workspace-members.contract.test.ts` (matrix).

#### Files to edit
```
packages/api/src/server/auth/middleware.ts — requireRole(min)
packages/api/src/server/store/members-store.ts (NEW) — MembersRepository interface + createInMemoryMembersRepository + owned-by-workspace semantics
packages/api/src/server/store/members-store-pg.ts (NEW) — createPostgresMembersRepository: setRole/remove tx + FOR UPDATE last-owner guard
packages/api/src/server/handlers/members.ts (NEW) — list/addByEmail(409 dup)/setRole(409 last_owner)/remove(409 last_owner)
packages/api/src/server/handlers/admin-keys.ts — anti-escalation guard (422 non-member, 403 outranks) on mint with explicit user_id
packages/api/src/server/app.ts (or createServer) — resolveMembersRepository + register /v1/members with requireRole('admin')
packages/api/src/server/schemas.ts — member request zod schemas (.strict())
packages/api/src/server/store/__tests__/members-store.contract.test.ts (NEW) — in-memory contract (last-owner, addByEmail dup)
tests/integration/auth/members-store-pg.test.ts (NEW) — pg last-owner FOR UPDATE
tests/integration/auth/workspace-rbac.test.ts (NEW) — role×route matrix + anti-escalation + last-owner e2e
```

#### Deep Dives
- `requireRole(min)`: reads `getPrincipal(c).role`; `if (!roleSatisfies(role,min)) return c.json({code:'INSUFFICIENT_ROLE',required,actual},403)`. Mounted AFTER bearer auth so 401 precedes 403.
- last-owner (pg): `db.transaction(tx => { const locked = await tx.select(role,user_id).from(workspace_users).where(workspace_id=ws).for('update'); const owners = locked.filter(r=>r.role==='owner').length; if (target.role==='owner' && newRole!=='owner' && owners===1) return {ok:false,reason:'last_owner'}; ... mutate in tx })`. `remove` identical shape.
- in-memory last-owner: same count guard over the in-memory map (no lock needed single-threaded; the contract is identical so contract tests stay meaningful).
- anti-escalation (mint): `if (rawUserId !== undefined && rawUserId !== principal.userId) { const tr = await members.getMemberRole(principal.workspaceId, rawUserId); if (tr===null) return 422; if (!roleSatisfies(principal.role, tr)) return 403; }`.
- All member queries scope by `principal.workspaceId` (Slice 1 owned() pattern) — cross-workspace member ops → 404.

#### TDD
```
RED:   members-store.contract.test.ts: demoting the only owner → {ok:false,reason:'last_owner'}; add a 2nd owner then demote the 1st → ok; addByEmail twice → 409. workspace-rbac.test.ts (it.each over MANAGEMENT_ROUTES): member→403 on every /v1/members + mint route; owner/admin→not 403; unknown key→401; mint with a non-member user_id→422; admin minting an owner-bound key→403.
GREEN: implement requireRole + repos + handlers + anti-escalation + wiring.
REFACTOR: extract shared owner-count guard if duplicated across setRole/remove.
VERIFY: pnpm vitest run packages/api/src/server/store/__tests__/members-store.contract.test.ts --config vitest.contract.config.ts ; THEOMEM_PG_URI=... pnpm vitest run tests/integration/auth/workspace-rbac.test.ts tests/integration/auth/members-store-pg.test.ts --config vitest.integration.config.ts
```

#### Concurrency tests

A race-aware concurrent test is REQUIRED here (last-owner is a TOCTOU window). In `members-store-pg.test.ts`, seed a workspace with exactly TWO owners, then fire two simultaneous `setRole(owner -> member)` demotions with `Promise.all` against the pg repo. The concurrent test asserts EXACTLY ONE demotion succeeds and the other returns `last_owner` (409), and the workspace still has at least one owner afterward (`SELECT count(*) WHERE role='owner' >= 1`). This race detector proves the `FOR UPDATE` row-lock serializes the window — without the lock both transactions read `owners=2` and both demote, leaving zero owners.

#### Acceptance Criteria
- [ ] role×route matrix: member→403 on every management route; owner/admin allowed; RAG (recall) open to member; unknown key→401.
- [ ] last-owner: cannot demote/remove the only owner (409); can after adding a second owner.
- [ ] two concurrent demotions → exactly one 409; workspace keeps ≥ 1 owner.
- [ ] anti-escalation: non-member user_id→422; outranking target→403; lower/equal→201.
- [ ] cross-workspace member op → 404; typecheck + lint clean.

#### DoD
- [ ] `pnpm vitest run tests/integration/auth/workspace-rbac.test.ts tests/integration/auth/members-store-pg.test.ts --config vitest.integration.config.ts` exits 0.
- [ ] typecheck 0; lint 0; `CHANGELOG.md [Unreleased]` gains the RBAC entry.

## Failure scenarios (external I/O — postgres)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres` (auth backend) | connection down during role lookup | inject a verifier whose `resolvePrincipal` rejects | 503 `service_unavailable`; principal never set (D5) |
| `postgres` (members tx) | two concurrent owner demotions | `Promise.all` of two `setRole(owner→member)` | exactly one 409 `last_owner`; ≥ 1 owner remains (D3) |
| `postgres` (0017) | legacy key with NULL user_id | seed pre-0017 key, run migration | backfilled to `default-owner` (D2) |
| REST mint | explicit user_id of a non-member | POST mint with a ghost user_id | 422 (D4) |
| REST mint | admin mints owner-bound key | admin POST mint with an owner's user_id | 403 (D4) |
| REST members | cross-workspace PATCH/DELETE | ws-B admin PATCHes a ws-A member | 404 (Slice 1 owned()) |

---

## Phase 3: Slice 1 100% — thread `workspace_id` through secondary stores

### T3.1 — recall-cache cache-key + skill-store + eviction workspace threading

#### Objective
recall-cache scope key includes `workspace_id` (no cross-workspace cache hit); `pgvector-skill-store` filters/inserts `workspace_id`; eviction (`scope-where`/`scope-candidate`/`triadic-scoring-policy`) adds the `workspace_id` AND-clause.

#### Why this step (action + reasoning)
1. **What** — close the last opt-in leaks so Slice 1 is 100%.
2. **Why now** — Phases 0-2 deliver RBAC; this finishes the isolation property across every surface.

#### Evidence
- `packages/core/src/infrastructure/db/recall-cache/pgvector-recall-cache-store.ts` (scope key + cosine lookup).
- `packages/core/src/infrastructure/db/pgvector-skill-store.ts` (skill WHERE/insert).
- `packages/core/src/infrastructure/db/eviction/{scope-where,scope-candidate,triadic-scoring-policy}.ts` (eviction WHERE).
- `multi-tenant-workspace-isolation-plan.md` secondary-stores deferral (the work this closes).

#### Files to edit
```
packages/core/src/infrastructure/db/recall-cache/pgvector-recall-cache-store.ts — workspace_id in scope key + lookup
packages/core/src/infrastructure/db/pgvector-skill-store.ts — workspace_id WHERE + insert
packages/core/src/infrastructure/db/eviction/scope-where.ts — workspace_id AND-clause
packages/core/src/infrastructure/db/eviction/scope-candidate.ts — carry workspaceId
tests/integration/workspace/cache-skill-eviction-isolation.test.ts (NEW)
```

#### Deep Dives
- recall-cache: the cache scope key must PREFIX/INCLUDE `workspace_id` so a BYTE-IDENTICAL query string in ws-A and ws-B is a cache MISS across them (the cosine lookup also ANDs `workspace_id`).
- skill-store: skill recall/insert thread `workspaceId` from the bound memory's filters.
- eviction: the candidate-selection WHERE adds `workspace_id = $` so eviction in ws-A never reads/evicts a ws-B row.

#### TDD
```
RED:   cache-skill-eviction-isolation.test.ts: ws-A and ws-B issue a byte-identical query → ws-B is a cache MISS (its own compute); a ws-A skill recall never returns a ws-B skill; eviction triggered in ws-A never soft-deletes a ws-B row.
GREEN: thread workspace_id through the three stores.
REFACTOR: none.
VERIFY: THEOMEM_PG_URI=... pnpm vitest run tests/integration/workspace/cache-skill-eviction-isolation.test.ts --config vitest.integration.config.ts
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] cross-workspace cache hit impossible (byte-identical query → MISS across workspaces).
- [ ] skill recall + eviction are workspace-isolated.
- [ ] typecheck + lint clean.

#### DoD
- [ ] `pnpm vitest run tests/integration/workspace/cache-skill-eviction-isolation.test.ts --config vitest.integration.config.ts` exits 0.
- [ ] typecheck 0; lint 0; `CHANGELOG.md [Unreleased]` records Slice 1 100% (secondary stores threaded).

---

## Phase 4: Docs + P0 amendment

### T4.1 — README + CHANGELOG + CLAUDE.md P0 amendment

#### Objective
Document the RBAC surface + Slice 1 100% in README Security; record the breaking/added surface in CHANGELOG; record the P0 re-classification of Slice 2 in CLAUDE.md (owner directive 2026-06-17).

#### Why this step (action + reasoning)
1. **What** — honest public disclosure (Inquebrável Rule 3 + 6) + P0 audit (Rule 10).
2. **Why now** — the surface is final; docs + the amendment close the cycle.

#### Evidence
- `CLAUDE.md § PRIORITY 0 Amendment 2026-06-17` (the workspace-isolation precedent to extend with RBAC).
- `README.md` Security section (workspace isolation already documented; extend with roles).
- `CHANGELOG.md [Unreleased]`.

#### Files to edit
```
README.md — Security: roles/members + Slice 1 100%
CHANGELOG.md — [Unreleased] Added: RBAC; Changed: Principal widened; secondary stores isolated
CLAUDE.md — PRIORITY 0 Amendment: RBAC re-classified in-scope (owner directive 2026-06-17)
packages/core/src/domain/index.ts + packages/api/src/server/index.ts — export WorkspaceRole/roleSatisfies; contract test through barrel
tests/integration/p0-audit/public-surface-rbac.test.ts (NEW) — Principal/WorkspaceRole/roleSatisfies import through the public barrel
```

#### TDD
```
RED:   public-surface-rbac.test.ts imports { WorkspaceRole, roleSatisfies } from '@usetheo/memory/contract' and asserts roleSatisfies is callable; fails before the barrel export.
GREEN: add the exports + docs.
REFACTOR: none.
VERIFY: pnpm vitest run tests/integration/p0-audit/public-surface-rbac.test.ts --config vitest.contract.config.ts
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] `WorkspaceRole`/`roleSatisfies` import through the public barrel (contract test).
- [ ] README Security documents roles/members + Slice 1 100%.
- [ ] CLAUDE.md records the P0 RBAC re-classification; CHANGELOG updated.

#### DoD
- [ ] `pnpm vitest run tests/integration/p0-audit/public-surface-rbac.test.ts --config vitest.contract.config.ts` exits 0.
- [ ] typecheck 0; lint 0; README + CHANGELOG + CLAUDE.md updated.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `users` table | T0.2 | 0017 migration |
| 2 | `workspace_users` (role, composite PK, CHECK enum) | T0.2 | 0017 migration |
| 3 | `theo_api_keys.user_id` FK (set null) | T0.2 | 0017 migration |
| 4 | seed default-owner + membership (idempotent) | T0.2 | ON CONFLICT DO NOTHING |
| 5 | backfill legacy keys → default-owner | T0.2 | UPDATE WHERE user_id IS NULL |
| 6 | `WorkspaceRole`/`ROLE_RANK`/`roleSatisfies` | T0.1 | core/domain |
| 7 | `Principal` += userId + role | T0.1 | widen interface |
| 8 | resolvePrincipal role-join (default-deny `member`) | T1.1 | LEFT JOIN workspace_users |
| 9 | env/no-credential → default-owner owner | T1.1 | bearer + middleware default |
| 10 | 503 fail-closed on infra error | T1.1 | middleware try/catch |
| 11 | `requireRole(min)` gate | T2.1 | middleware |
| 12 | `MembersRepository` DIP (in-memory + pg) | T2.1 | store + store-pg |
| 13 | `/v1/members` CRUD (list/add/setRole/remove) | T2.1 | members handler |
| 14 | last-owner invariant (tx + FOR UPDATE) | T2.1 | pg transaction |
| 15 | anti-escalation guard on key mint | T2.1 | admin-keys mint |
| 16 | role×route authz matrix | T2.1 | workspace-rbac.test |
| 17 | cross-workspace member op → 404 | T2.1 | owned() scoping |
| 18 | recall-cache no cross-workspace hit | T3.1 | workspace in cache key |
| 19 | skill-store workspace-isolated | T3.1 | workspace_id WHERE |
| 20 | eviction workspace-isolated | T3.1 | workspace_id AND-clause |
| 21 | drizzle schema/meta parity with 0017 | T0.2 | parity test |
| 22 | public-surface exports (WorkspaceRole/roleSatisfies) | T4.1 | barrel + contract test |
| 23 | README + CHANGELOG + P0 amendment | T4.1 | docs |
| 24 | IDOR + RBAC matrices vs real pgvector | T2.1 + T3.1 + Final | goal tests |

**Coverage: 24/24 requirements mapped to tasks — 100%.**

## Global Definition of Done
- [ ] All phases completed
- [ ] THE GOAL TESTS green vs real pgvector: `workspace-rbac.test.ts` (role×route + last-owner + anti-escalation + 503), `cache-skill-eviction-isolation.test.ts`, extended `workspace-isolation.test.ts`
- [ ] Full keyless integration suite still 0 failed (0017 does not regress the stabilized suite); deterministic across two runs
- [ ] Contract suite green; `pnpm run typecheck` 0 errors; `pnpm run lint` 0 warnings
- [ ] File-size budget respected (500 LoC)
- [ ] CHANGELOG `[Unreleased]` updated (Added RBAC; Changed Principal; Slice 1 100%)
- [ ] README Security documents roles/members + Slice 1 100%
- [ ] CLAUDE.md P0 amendment records the RBAC re-classification
- [ ] `WorkspaceRole`/`roleSatisfies` exported + contract-tested through the public barrel
- [ ] No paper names in code (`no-paper-names-in-code.md`)
- [ ] `/review` returns READY_TO_MERGE
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merged

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phases 0-4. The plan is NOT done until every matrix + the full suite are green.

### Execution
```
THEOMEM_PG_URI=postgresql://themem:themem@localhost:5432/themem pnpm vitest run tests/integration/auth/workspace-rbac.test.ts tests/integration/auth/workspace-isolation.test.ts tests/integration/workspace/cache-skill-eviction-isolation.test.ts --config vitest.integration.config.ts
THEOMEM_PG_URI=... pnpm vitest run --config vitest.integration.config.ts   # full suite still green
pnpm vitest run --config vitest.contract.config.ts
pnpm run typecheck && pnpm run lint
```

### Acceptance Criteria
- [ ] role×route matrix (member 403 everywhere management; owner/admin allowed; RAG open; unknown 401).
- [ ] last-owner: 409 on demote/remove last owner; concurrent demotions → exactly one 409, ≥1 owner remains.
- [ ] anti-escalation: 422 non-member, 403 outranks, 201 lower/equal.
- [ ] 503 fail-closed on throwing verifier.
- [ ] secondary-store isolation: no cross-workspace cache hit; skill + eviction isolated.
- [ ] IDOR matrix (cross-workspace recall empty, by-id 404, create-from-principal).
- [ ] Full integration suite 0 failed; deterministic across two runs. Contract green; typecheck + lint clean.
- [ ] No assertion weakened to pass; every breaking change disclosed.

### If Validation Fails
1. Classify each residual failure (which phase / which store / which gate).
2. Fix in-scope; isolate any genuinely new defect with an honest BLOCKED note (never green it blindly).
3. Re-run the chain.
