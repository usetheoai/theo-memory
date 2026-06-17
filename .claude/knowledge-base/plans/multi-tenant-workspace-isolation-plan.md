---
slug: multi-tenant-workspace-isolation
created_at: 2026-06-17
goal: Bind every request to a workspace resolved from its credential and scope every query by that workspace, so cross-workspace access is impossible.
---

# Plan: Multi-Tenant Workspace Isolation (Principal-resolved-from-credential)

> **Version 1.1** (edge-case absorption 2026-06-17: EC-1 D-LEAF every-table-denormalized; EC-2 revoked/expired RED; EC-3 single atomic transaction; EC-4 `.strict()` 400; EC-5 forget workspace-scoped + ws-A untouched; EC-6/EC-7 stable `default` id + idempotent seed; EC-8 cache no-cross-hit; EC-9 in-memory parity. Full report: `.claude/knowledge-base/reviews/multi-tenant-workspace-isolation-edge-cases-2026-06-17.md`).
>
> **Version 1.0** — Today TheMemory is single-tenant-per-deployment: the three memory tiers (`user_id`/`session_id`/`agent_id`) are caller-supplied partitions read from the request **body**, and `AuthVerifier.verify(token): boolean` only answers "is this key valid?". Any valid key can address any scope. This plan adds a **`workspaces`** tenant boundary resolved **from the credential**: `AuthVerifier` evolves to resolve a `Principal { workspaceId, scopes }`, `workspace_id` is denormalized on the 6 scope-bearing tables, every query is scoped by the Principal's workspace (never the body), and cross-workspace access returns 404. The three tiers LAYER UNDER the workspace (not replaced). A non-destructive `0016` migration backfills a `default` workspace so the legacy `THEMEMORY_API_KEY` deployment keeps working. Project-owner-authorized in-scope under P0 (CLAUDE.md § PRIORITY 0 Amendment 2026-06-17).

## Goal

> "Bind every authenticated request to a `workspace` resolved from its API-key credential and scope every persistence query by that workspace, measured by a `tests/integration/auth/workspace-isolation.test.ts` suite that asserts cross-workspace GET/forget/recall return 404/empty and create derives `workspace_id` from the Principal — 0 failed against real `ankane/pgvector:v0.5.1`."

## Context

The owner directive (2026-06-17) re-classified this as CORE in-scope under P0 (CLAUDE.md Amendment). The model is the **Workspace Isolation** pattern (multi-tenant-flat, API-first): API-key → workspace; `Principal` resolves `workspaceId`; app-level scoping; `workspace_id` denormalized on directly-queried tables; 404 (not 403) cross-tenant; "no credential" collapses to a `default` workspace. Grounded in the discovery blueprint (`.claude/knowledge-base/discoveries/blueprints/multi-tenant-workspace-isolation-blueprint.md`) and the in-repo seam from Item 20 (`theo_api_keys.tenant_id='self'` + `subject`, planted as forward-compat for exactly this).

Strategic-review note: the three-tier scope is a LOCKED name (`architecture.md § 1`, "never a fourth tier without strategic review"). Workspace is NOT a fourth tier — it is an ORTHOGONAL outer tenant boundary. The strategic review is satisfied by the owner amendment (ADR D1 records this explicitly).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Why it exists today | Invariants to preserve |
|---|---|---|---|
| `packages/core/src/domain/dip/auth-verifier.ts` | 30 | 12th DIP — `verify(token): Promise<boolean>` | Keep boolean-compat for the env bridge; ADD `resolvePrincipal` |
| `packages/core/src/domain/scope.ts` | 160 | three-tier scope discriminated union (`UserScope`/`SessionScope`/`AgentScope`/`RepoScope`) | tiers UNCHANGED; workspace is orthogonal |
| `packages/core/src/domain/index.ts` | — | public domain barrel (re-exports `AuthVerifier`) | add `Principal`, `Workspace` exports |
| `packages/core/src/domain/errors.ts` | — | typed domain errors | add `WorkspaceMismatch` (maps to 404) |
| `packages/core/src/infrastructure/db/pgvector-store.ts` | 900 | `composeFilters` (scope WHERE), insert, search, list | `composeFilters` adds `workspace_id`; insert writes it; ≤ keep under budget (may split) |
| `packages/core/src/infrastructure/db/pgvector-skill-store.ts` | — | skill (repo-scope) store | thread `workspace_id` |
| `packages/core/src/infrastructure/db/recall-cache/pgvector-recall-cache-store.ts` | — | semantic cache store | thread `workspace_id` (cache key includes it) |
| `packages/core/src/infrastructure/db/scoped-memory.ts` | — | scope → filters adapter | carry `workspaceId` into filters |
| `packages/core/src/infrastructure/db/local-memory.ts` | — | `createLocalMemory` factory | accept/propagate workspace binding |
| `packages/core/src/infrastructure/db/migrations/0016_workspaces.sql` (NEW) | 0 | workspaces table + workspace_id columns + backfill | non-destructive recipe |
| `packages/core/src/infrastructure/db/schema.ts` | — | drizzle schema (parity with migrations) | add workspaces + workspace_id |
| `packages/api/src/server/auth/api-key-verifier.ts` | 95 | sha256 key lookup → boolean | ADD `resolvePrincipal` (key_hash → workspaceId + scopes) |
| `packages/api/src/server/auth/bearer-verifier.ts` | 68 | env `THEMEMORY_API_KEY` → boolean | bridge env key → `default` workspace Principal |
| `packages/api/src/server/auth/middleware.ts` | 72 | `bearerAuth` gate | inject resolved `Principal` into Hono context |
| `packages/api/src/server/auth/scope-verifier.ts` | 142 | `requireScope` admin gate | scope admin-keys to the Principal's workspace |
| `packages/api/src/server/app.ts` | 280 | `createApp` wiring | wire Principal middleware; default-workspace collapse |
| `packages/api/src/server/schemas.ts` | 122 | body scope (`superRefine` exactly-one-tier) | tier stays in body; workspace removed from body if present |
| `packages/api/src/server/handlers/{remember,recall,forget,reflect,scopes}.ts` | — | scope-from-body handlers | read workspace from Principal (ctx), pass to repo |

> Exact LoC for unmeasured rows is captured at implementation time (`wc -l`). The blast radius (AuthVerifier ≈ 12 consumers; scope-threading ≈ 10 stores) is enumerated in § Drawbacks.

### Current callers / dependents

- **`AuthVerifier`** (production consumers, verified `grep`): `packages/api/src/server/{app,index}.ts`, `auth/{middleware,scope-verifier,bearer-verifier,dual-validation,api-key-verifier,oidc-verifier}.ts`; `packages/cli/src/{cli,run-server,auth/with-bearer-auth}.ts`; `packages/mcp/src/{run-mcp-server,auth/with-bearer-auth}.ts`. Re-exported from `packages/core/src/domain/index.ts` + `packages/api/src/server/index.ts`. **PUBLIC.**
- **Scope-threading** (`Filters`/scope columns): `domain/{options,scope,memory-store,retrieval/pipeline}.ts`, `domain/dip/vector-store.ts`, `infrastructure/db/{scoped-memory,pgvector-store,pgvector-skill-store,local-memory,in-memory-store,vector-store-conformance}.ts`, `infrastructure/db/eviction/{scope-candidate,scope-where,triadic-scoring-policy}.ts`.
- **Data tables needing `workspace_id`** (directly queried): `memories`, `entities`, `history`, `consolidation_history`, `reflection_counters`, `recall_cache`. Binding table: `theo_api_keys` (`tenant_id`→workspace). Global: `admin_config`.

### Domain glossary

- **Workspace** — the tenant boundary. One row in `workspaces`. Every datum belongs to exactly one.
- **Principal** — `{ workspaceId: string; scopes: readonly string[] }` resolved from a credential by `AuthVerifier`. Answers "whose key?", not "valid?".
- **Tier** — the existing within-workspace partition (`user`/`session`/`agent`). Orthogonal to workspace.
- **`default` workspace** — the single workspace every legacy / no-credential request collapses to (preserves single-tenant behavior).
- **App-level scoping** — isolation enforced by the repository always adding `WHERE workspace_id = $principal` (vs Postgres RLS).

### Architecture boundaries affected

- `architecture.md § 3` (DIP): `Principal`/`Workspace` types + the evolved `AuthVerifier` interface live in `packages/core/src/domain/**` (no I/O); the resolving impls stay in `packages/api/src/server/auth/**`. `src/core` MUST NOT import from adapters.
- `architecture.md § 1` (three-tier locked): workspace is orthogonal, NOT a 4th tier — recorded in ADR D1 (strategic review = owner amendment).
- `architecture.md § 9` (public surface): `AuthVerifier` change + new `Principal`/`Workspace` exports require updating barrels + README + a contract test.
- `architecture.md § 10.1`: migration `0016` SQL must be copied to `dist/` by the existing `postbuild` step + a publish-readiness assertion.

## Prior Art & Related Work

- Discovery blueprint: `.claude/knowledge-base/discoveries/blueprints/multi-tenant-workspace-isolation-blueprint.md` (owner spec + code grounding + 9 design decisions).
- In-repo seam: Item 20 `theo-memory-faang-auth-lifecycle` planted `theo_api_keys.tenant_id`/`subject` for this exact model (`migrations/0012`, ADR-0013/0014/0015).
- External: R2R's denormalized `owner_id` (the "denormalize the tenant column on every queried resource" precedent, cited by the owner). AnythingLLM / Supabase org-layer (app-level multi-tenancy). Local references (mem0/letta/langmem) carry NO workspace-tenancy prior art — they are single-tenant memory engines, so the pattern is owner-supplied + grounded in our code.

## Objective

- [ ] `workspaces` table + `workspace_id` on the 6 data tables exist via a non-destructive `0016` migration with a backfilled `default` workspace (Phase 0).
- [ ] `Principal`/`Workspace` domain types + `AuthVerifier.resolvePrincipal` exist; legacy `verify` retained behind a default adapter (Phase 0).
- [ ] The scoping contract carries a REQUIRED `workspaceId`; `composeFilters` + every store thread it; forgetting it is a compile error (Phase 1).
- [ ] `ApiKeyAuthVerifier.resolvePrincipal` resolves `key_hash → { workspaceId, scopes }`; the env key bridges to `default`; middleware injects the Principal (Phase 2).
- [ ] REST handlers derive `workspace_id` from the Principal (never the body); cross-workspace by-id access returns 404; admin keys are workspace-scoped (Phase 3).
- [ ] The IDOR test matrix passes against real pgvector; full integration + contract + typecheck + lint stay green (Phase 4 / Final).

## ADRs

### D1 — Workspace is an ORTHOGONAL outer tenant boundary, not a fourth scope tier

- **Decision:** Add `workspace_id` as the OUTER tenant anchor; keep the three tiers (`user_id`/`session_id`/`agent_id`) as within-workspace partitions. A scoped query becomes `WHERE workspace_id = $principal AND <tier> = $body`.
- **Rationale:** `architecture.md § 1` locks the three tiers and forbids a fourth tier "without strategic review". Workspace is NOT a tier — it is the tenant the tiers live inside. The strategic review is satisfied by the project-owner P0 amendment (2026-06-17). Layering (not replacing) preserves every existing tier contract + test.
- **Alternatives considered:** *Replace the tiers with a single workspace dimension* — rejected: destroys the locked three-tier contract + every scoped API; massive breakage for no benefit. *Make workspace a fourth `Scope` union member* — rejected: it conflates tenant (security) with partition (organization); the body still supplies the tier while the credential supplies the workspace — different sources, different trust.
- **Consequences:** Every scoped query gains one more AND-clause; the tiers are untouched; one strategic-review obligation discharged via the amendment.

### D2 — `AuthVerifier` resolves a Principal; legacy `verify` retained via a default adapter (additive-then-breaking)

- **Decision:** Add `resolvePrincipal(token): Promise<Principal | null>` to the `AuthVerifier` DIP (null = invalid credential). Keep `verify(token): boolean` as a defaulted method (`verify = async t => (await this.resolvePrincipal(t)) !== null`) so existing consumers compile during migration; the boolean path is removed once all callers move to Principal.
- **Rationale:** `AuthVerifier` has ~12 production consumers (Baseline Context). A hard signature swap would break MCP + CLI + REST simultaneously. ISP (`architecture.md § 13.4`) + a phased additive-then-breaking change keeps each phase green. Pre-release status (CLAUDE.md) makes the final breaking removal acceptable.
- **Alternatives considered:** *Hard-swap `verify`→`resolvePrincipal` in one commit* — rejected: breaks 12 call sites at once, un-reviewable. *Separate `PrincipalResolver` DIP alongside `AuthVerifier`* — rejected: two auth DIPs is ISP-worse and duplicates the lookup; the verifier already does the DB lookup, so it should return the Principal it already computed.
- **Consequences:** A transient window where both methods exist; the boolean default keeps un-migrated callers green; final phase removes `verify` from the interface (PUBLIC BREAKING, disclosed).

### D3 — `workspace_id` comes from the Principal, NEVER the request body

- **Decision:** The REST/MCP handlers inject `workspace_id` from the authenticated Principal in the Hono/ALS context. The body keeps supplying the TIER only. A `workspace`/`workspaceId` field in the body is rejected (or ignored) — never trusted.
- **Rationale:** The entire security property hinges on this: if the client could supply its own `workspace_id`, it could forge the tenant (IDOR). The tier is non-security (organization within the trusted workspace), so it stays in the body.
- **Alternatives considered:** *Accept `workspaceId` from the body when the key has an `admin` scope* — rejected for this slice: cross-workspace admin is a separate (membership) feature, out of scope; keep the invariant absolute here.
- **Consequences:** Handlers gain a `principal` dependency from context; body schemas reject a `workspaceId` field.

### D4 — Compile-time-required `workspaceId` on the server scoping path

- **Decision:** The server-facing scoping contract (the `Filters`/scope object the handlers build) carries a NON-OPTIONAL `workspaceId: string`. `composeFilters` always emits `workspace_id = $`. The SDK-internal `store.search(query, k, filters?)` keeps `filters` optional ONLY for unit/in-memory use, but the REST path constructs a typed `ScopedFilters` where `workspaceId` is required.
- **Rationale:** `composeFilters(undefined)` today returns an UNSCOPED query — the silent-leak hole. A non-optional field turns "forgot the workspace" into a TypeScript compile error (`architecture.md § 8` fail-fast; the "compiler guarantee" trick from the owner's anti-leak decision).
- **Alternatives considered:** *Runtime assertion that workspaceId is present* — rejected: weaker than a compile error; the type system already pays for itself here. *Postgres RLS as the guard* — rejected (D9): app-level first.
- **Consequences:** A new `ScopedFilters` type wraps `Filters` with a required `workspaceId`; the store insert/search/list signatures on the REST path require it; in-memory/unit paths use a `default`-workspace constant.

### D5 — Non-destructive `0016` migration (single atomic transaction: add-nullable → backfill `default` → NOT NULL → bind keys → enforce)

- **Decision:** One migration `0016_workspaces.sql`, **wrapped in a single `BEGIN/COMMIT`** (EC-3 absorption): (1) `CREATE TABLE workspaces (id, name, created_at)`; (2) `INSERT` the `default` workspace with a **FIXED, stable id** (literal `'default'`, NOT `gen_random_uuid()`) via `ON CONFLICT DO NOTHING` so re-running is idempotent (EC-6 + EC-7 absorption); (3) `ADD COLUMN workspace_id` NULLABLE on the 6 data tables; (4) backfill **unconditionally** `UPDATE <table> SET workspace_id = 'default' WHERE workspace_id IS NULL` for ALL 6 data tables + `theo_api_keys` in the same transaction; (5) `ALTER COLUMN workspace_id SET NOT NULL` on all of them + create `(workspace_id, <existing scope cols>)` indexes; (6) bind `theo_api_keys` via an explicit `workspace_id` FK → `workspaces(id)` (keep `tenant_id` for backward-compat read per Q1), backfilled to `'default'`. No data is dropped.
- **Rationale:** `architecture.md § 10` + the owner's migration recipe. Backfill BEFORE `SET NOT NULL` is mandatory (else the ALTER fails on existing rows). The single transaction (EC-3) means a partial failure rolls back cleanly — no orphan-journal brick (`architecture.md § 10.2`). The stable `'default'` id (EC-6) lets the env-key bridge + no-credential collapse resolve the workspace without a lookup race; `ON CONFLICT DO NOTHING` (EC-7) makes the seed idempotent against a re-run. Indexes `(workspace_id, ...)` keep listing queries fast (R2R precedent).
- **Alternatives considered:** *Two migrations (schema then backfill)* — rejected: a single transactional migration is atomic + simpler for the drizzle journal. *Drop + recreate tables* — rejected: destroys data, violates non-destructive requirement. *`gen_random_uuid()` default workspace id* — rejected (EC-6): a random id forces a lookup at every no-credential request and is non-idempotent across re-seeds.
- **Consequences:** Migration count 16→17; drizzle `schema.ts` + meta snapshots must stay in parity (`schema-snapshot-parity.test.ts`); the just-stabilized integration template-clone picks up `0016` automatically.

### D-LEAF — EVERY directly-queried table carries a denormalized `workspace_id`; NO table is join-inherited (EC-1 absorption)

- **Decision:** The 6 data tables (`memories`, `entities`, `history`, `consolidation_history`, `reflection_counters`, `recall_cache`) ALL carry their own `workspace_id` column and ALL filter by it. NO table relies on "inherit the workspace via a join to its parent". The blueprint's "leaf inherits via join" wording is SUPERSEDED — `entities` and `recall_cache` are directly queried (a cache lookup hits `recall_cache` by query-embedding cosine BEFORE any join to `memories`), so a missing column there is a real leak.
- **Rationale:** Closes EC-1: a query that reads a leaf table by a non-workspace key (e.g. cache cosine lookup) would surface a cross-workspace row if the column were absent and isolation depended on a downstream join. Denormalization (R2R `owner_id` precedent) makes every table self-isolating.
- **Alternatives considered:** *Join-inherit workspace for leaf tables* — rejected (EC-1): the cache + entity lookup paths read the leaf BEFORE the join, so the join cannot gate them.
- **Consequences:** All 6 tables in the `0016` migration get the column (already the plan's set); the recall-cache scope key includes `workspace_id` (EC-8).

### D6 — Cross-workspace access returns 404, never 403

- **Decision:** A by-id GET/forget/PATCH for a memory in another workspace returns **404** (the row is invisible because the `workspace_id` filter excludes it). No 403 "you don't own this". The admin-scope 403 (`SCOPE_INSUFFICIENT`) is unchanged — it gates capability, not data existence.
- **Rationale:** 403 confirms the resource exists in another tenant (leaks existence); 404 reveals nothing (owner decision; OWASP IDOR guidance).
- **Alternatives considered:** *403 for cross-tenant* — rejected: existence leak. *200 empty for by-id* — rejected: a by-id GET semantically warrants 404 on miss; list/recall correctly return 200 `[]`.
- **Consequences:** `forget`/by-id handlers existence-check WITHIN the workspace and 404 on miss; list/recall keep 200 `[]`.

### D7 — "No credential" collapses to the `default` workspace; the insecure auth-disabled override is removed

- **Decision:** When no credential is configured, requests resolve to the `default` workspace Principal (not "auth disabled pass-through"). With a single workspace there is no cross-tenant IDOR, so the prior "auth disabled" alpha mode is replaced by an explicit `default`-workspace Principal. The legacy `THEMEMORY_API_KEY` env key resolves to `default`.
- **Rationale:** Removes the silent insecure mode; single-tenant dev keeps working; the bridge makes the migration non-breaking for existing deployments (owner decision).
- **Alternatives considered:** *Keep auth-disabled pass-through* — rejected: leaves an insecure mode that becomes a real hole the moment a second workspace exists. *Reject all requests without a key* — rejected: breaks the OSS single-tenant dev experience the README promises.
- **Consequences:** `middleware.ts` always yields a Principal (default when no key); a config flag documents that multi-workspace requires real keys.

### D8 — RLS deferred (app-level enforcement is sufficient to close IDOR)

- **Decision:** Isolation is enforced at the repository (app-level `WHERE workspace_id`). Postgres RLS is opt-in, deferred to a follow-up.
- **Rationale:** R2R/AnythingLLM both do app-level. RLS needs per-transaction `SET LOCAL app.workspace` and leaks the GUC across pooled connections if mis-wired (owner decision). D4's compile-time requirement is the primary guard; RLS is belt-and-suspenders.
- **Alternatives considered:** *RLS now* — rejected: pooled-connection GUC hazard + bigger blast radius, not a prerequisite to close IDOR.
- **Consequences:** A documented follow-up (`workspace-rls-belt-and-suspenders`); no RLS code this slice.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Blast radius: 6 tables + `composeFilters` + ~10 stores + ~12 AuthVerifier consumers | High | D2 additive-then-breaking keeps each phase green; D4 makes every store call site a compile error if it forgets `workspaceId`; phased dependency graph | Implementer |
| Breaking `AuthVerifier` public surface | High | D2 default `verify` shim during migration; env→default bridge; PUBLIC BREAKING disclosed in CHANGELOG + README; pre-release status permits it | Implementer + `/review` |
| Migration `0016` backfill ordering (SET NOT NULL before backfill = failure) | High | D5 explicit ordering; integration test asserts backfill→NOT NULL succeeds on a DB pre-seeded with NULL-workspace rows | Implementer |
| Silent leak if any store path skips `workspace_id` | Critical | D4 compile-time required field; IDOR test matrix exercises each verb + each store across two workspaces | Implementer + `/review` security agent |
| Drizzle schema/meta parity drift with `0016` | Medium | `schema-snapshot-parity.test.ts` + `journal-sync.test.ts` re-run; meta snapshot generated, not hand-edited | Implementer |
| Recall-cache keyed without workspace → cross-workspace cache hit | Critical | recall-cache store includes `workspace_id` in the cache scope key; test asserts no cross-workspace cache hit | Implementer |

## Unresolved Questions

- Q1 — Reuse `theo_api_keys.tenant_id` as the workspace FK vs add an explicit `workspace_id` column? **Default:** reuse `tenant_id` (rename semantics: `'self'`→`default` workspace id) to avoid a redundant column; confirmed acceptable in Phase 0 ADR if the FK is added. Resolved at implementation: add an explicit `workspace_id` FK on `theo_api_keys` for clarity, keep `tenant_id` for backward-compat read.
- Q2 — Does the MCP/CLI path (AsyncLocalStorage scope binding) need the Principal too, or only REST? **Default:** REST first (handlers); MCP/CLI inherit the env→`default` bridge this slice; full MCP-per-workspace deferred unless the owner wants it in-scope now.
- Q3 — Skill (Repo-scope) store + eviction policies: thread `workspace_id` now or defer? **Default:** thread it now in the same compile-required pass (D4 forces it) to avoid a half-isolated system; eviction candidate queries gain the workspace AND-clause.

## Dependencies

No NEW runtime dependencies are introduced. The feature is built entirely on dependencies already declared and version-pinned in `packages/core/package.json` / `packages/api/package.json`:

| Dependency | Version (existing) | Use in this plan | Rule 9 note |
|---|---|---|---|
| `pg` | existing pin | `workspaces` table + `workspace_id` queries + migration | already the project's Postgres driver; no alternative evaluated (incumbent) |
| `zod` | existing pin | reject body `workspaceId`; schema for admin handlers | already the project's validation lib |
| `node:crypto` (built-in) | n/a | SHA-256 key hash (unchanged from Item 20) | Node built-in; no dep |
| `drizzle-orm` / `drizzle-kit` | existing pin | `schema.ts` parity + `0016` meta snapshot | already the migration toolchain |

No CVE surface changes (no new package). `/deps-audit` for this slug is a no-op beyond confirming the above (no `plan_dep_*` cap applies — zero new declared deps).

## Dependency Graph

```
Phase 0 (domain types + Principal + 0016 migration + schema parity)
   │
   ▼
Phase 1 (persistence: ScopedFilters required workspaceId; composeFilters + 6 stores thread it)
   │
   ▼
Phase 2 (auth: ApiKeyAuthVerifier.resolvePrincipal + env→default bridge + middleware injects Principal)
   │
   ▼
Phase 3 (REST: handlers derive workspace from Principal; 404 cross-workspace; admin keys per workspace)
   │
   ▼
Phase 4 (default-workspace collapse + remove insecure override + CHANGELOG/README breaking note)
   │
   ▼
Final Phase: Integration Validation (IDOR matrix vs real pgvector; full suite + contract + typecheck + lint green)
```

Phases are sequential (each depends on the prior contract). Within Phase 1, the 6 stores can be threaded in parallel once `ScopedFilters` lands.

---

## Phase 0: Domain foundation + migration

**Objective:** `Principal`/`Workspace` types, evolved `AuthVerifier`, and a non-destructive `0016` migration exist with drizzle parity.

### T0.1 — `Principal` + `Workspace` domain types + `AuthVerifier.resolvePrincipal`

#### Objective
Add `Principal { workspaceId, scopes }` + `Workspace { id, name, createdAt }` to `packages/core/src/domain`, evolve the `AuthVerifier` DIP with `resolvePrincipal(token): Promise<Principal | null>` (keep defaulted `verify`), export from the domain barrel, add a `WorkspaceMismatch` error.

#### Why this step (action + reasoning)
1. **What** — define the contract every later phase depends on, in `core/domain` (no I/O, DIP-clean per `architecture.md § 3`).
2. **Why now** — D2 (additive-then-breaking) needs both methods on the interface before any impl migrates; D1 needs `Workspace` orthogonal to `Scope`.

#### Evidence
- `packages/core/src/domain/dip/auth-verifier.ts:17-30` (current boolean DIP).
- `packages/core/src/domain/scope.ts:1-86` (tiers stay; workspace is separate).
- `packages/core/src/domain/index.ts` re-exports `AuthVerifier` (public surface, `architecture.md § 9`).

#### Files to edit
```
packages/core/src/domain/principal.ts (NEW) — Principal + Workspace types
packages/core/src/domain/dip/auth-verifier.ts — add resolvePrincipal; default verify shim
packages/core/src/domain/errors.ts — add WorkspaceMismatch (maps to 404)
packages/core/src/domain/index.ts — export Principal, Workspace, WorkspaceMismatch
packages/core/src/domain/principal.test.ts (NEW) — type + default-shim unit test
```

#### Deep file dependency analysis
- `auth-verifier.ts` is consumed by ~12 files (Baseline Context). Adding a defaulted method is backward-compatible (no caller breaks). `index.ts` barrel addition is additive.

#### Deep Dives
- `verify` default: `async verify(t){ return (await this.resolvePrincipal(t)) !== null }` — implementers may override either; both compile.
- `Principal.scopes` reuses the existing `theo_api_keys.scopes` JSONB shape (string[]).

#### TDD
```
RED:   principal.test.ts asserts a class implementing only resolvePrincipal gets verify() for free (default shim) and returns false on null Principal.
GREEN: implement the interface + types + error.
REFACTOR: none expected.
VERIFY: pnpm vitest run packages/core/src/domain/principal.test.ts --config vitest.contract.config.ts
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm vitest run packages/core/src/domain/principal.test.ts --config vitest.contract.config.ts` exits 0.
- [ ] `Principal`, `Workspace`, `WorkspaceMismatch` are exported from `@usetheo/memory/contract` (smoke import test).
- [ ] `pnpm run typecheck` 0 errors; `pnpm run lint` 0 warnings; each changed file ≤ 500 LoC.

#### DoD
- [ ] `pnpm run typecheck` reports 0 errors and `pnpm run lint` reports 0 warnings.
- [ ] `pnpm vitest run packages/core/src/domain/principal.test.ts --config vitest.contract.config.ts` exits 0 with the default-`verify` shim test passing.

### T0.2 — `0016_workspaces.sql` migration + drizzle schema parity

#### Objective
Create the `workspaces` table, seed `default`, add nullable `workspace_id` to the 6 data tables, backfill, `SET NOT NULL`, add `(workspace_id, ...)` indexes, bind `theo_api_keys`. Keep `schema.ts` + meta snapshots in parity.

#### Why this step (action + reasoning)
1. **What** — the non-destructive schema change (D5) that Phase 1 persistence threads through.
2. **Why now** — persistence + auth phases need the column + the binding to exist; the migration must be in the template the integration suite clones.

#### Evidence
- `migrations/0012_theo_api_keys.sql` (binding seam: `tenant_id`/`subject`).
- `migrations/0007_distillation_columns.sql` (consolidation_history), `0001` (reflection_counters), `0010` (recall_cache), `0000` (memories/entities/history).
- `architecture.md § 10.1` (postbuild copy) + `schema-snapshot-parity.test.ts` (parity guard).

#### Files to edit
```
packages/core/src/infrastructure/db/migrations/0016_workspaces.sql (NEW)
packages/core/src/infrastructure/db/migrations/meta/0016_snapshot.json (NEW, generated)
packages/core/src/infrastructure/db/migrations/meta/_journal.json — append 0016 entry
packages/core/src/infrastructure/db/schema.ts — add workspaces table + workspace_id columns
tests/integration/migrations/workspace-migration.test.ts (NEW) — backfill + NOT NULL + index assertions
```

#### Deep Dives
- Backfill ordering: INSERT default → ADD COLUMN nullable → UPDATE all rows = default.id → SET NOT NULL. The test pre-seeds NULL-workspace rows (simulating a legacy DB) and asserts the migration backfills then enforces without error.
- `theo_api_keys`: ADD `workspace_id` FK → workspaces(id); backfill existing keys (`tenant_id='self'`) → default.id (Q1 resolution).
- Indexes: `CREATE INDEX ON memories (workspace_id, user_id)`, etc., for the hot listing paths.

#### TDD
```
RED:   workspace-migration.test.ts (against an isolated DB seeded with pre-0016 rows) asserts post-migration: workspaces has 'default'; every data table has workspace_id NOT NULL; legacy rows = default.id; theo_api_keys.workspace_id = default.id.
GREEN: author 0016 + generate meta snapshot + update schema.ts.
REFACTOR: none.
VERIFY: THEOMEM_PG_URI=... pnpm vitest run tests/integration/migrations/workspace-migration.test.ts tests/integration/schema-snapshot-parity.test.ts tests/integration/migrations/journal-sync.test.ts --config vitest.integration.config.ts
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] The migration + parity + journal-sync integration tests exit 0 against real pgvector.
- [ ] `schema-snapshot-parity.test.ts` shows 17 SQL = 17 snapshots = 17 journal entries.
- [ ] Backfill test: a DB pre-seeded with NULL-workspace rows migrates to NOT NULL with all legacy rows = `default`.
- [ ] lint 0 warnings; migration SQL copied to `dist/` (publish-readiness assertion).

#### DoD
- [ ] `pnpm vitest run tests/integration/migrations/workspace-migration.test.ts tests/integration/schema-snapshot-parity.test.ts --config vitest.integration.config.ts` exits 0.
- [ ] `pnpm run typecheck` reports 0 errors and `CHANGELOG.md [Unreleased]` gains the migration entry.

## Failure scenarios (when I/O external)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres` (migration) | `SET NOT NULL` before backfill on legacy NULL rows | seed NULL-workspace rows, run 0016 | migration backfills FIRST then enforces; no error |
| `postgres` (recall-cache) | cross-workspace cache hit | same query, two workspaces, assert cache miss across them | cache scope key includes workspace_id |
| `theo_api_keys` lookup | revoked key | `revoked_at` in the past | `resolvePrincipal` returns null → 401 |
| REST handler | client supplies `workspaceId` in body | POST with a forged `workspaceId` | body field rejected/ignored; Principal's workspace used |
| REST by-id | GET/forget id of another workspace | seed memory in ws-A, request as ws-B Principal | 404 (not 403, not 200) |

---

## Phase 1: Persistence — thread `workspace_id` (compile-required)

**Objective:** A `ScopedFilters` type carries a required `workspaceId`; `composeFilters` + the 6 stores + eviction emit/write `workspace_id`.

### T1.1 — `ScopedFilters` + `composeFilters` workspace clause + store insert/search/list

#### Objective
Add `workspace_id` to the `Filters` shape via a `ScopedFilters` wrapper with a required `workspaceId`; `composeFilters` always emits `workspace_id = $`; `pgvector-store` insert writes it, search/list filter by it.

#### Why this step (action + reasoning)
1. **What** — close the `composeFilters(undefined)` silent-leak hole (D4) and make the memories store workspace-aware.
2. **Why now** — every verb (remember/recall/forget/reflect) flows through this store; it is the primary isolation locus.

#### Evidence
- `pgvector-store.ts:164-224` (`composeFilters`), `:410` (insert column list), `:458-497` (search).

#### Files to edit
```
packages/core/src/domain/scoped-filters.ts (NEW) — ScopedFilters { workspaceId: string } & Filters
packages/core/src/infrastructure/db/pgvector-store.ts — composeFilters workspace clause; insert workspace_id; search/list require workspaceId on the REST path
packages/core/src/infrastructure/db/pgvector-store.test.ts — composeFilters emits workspace_id; unscoped is impossible on the typed path
tests/integration/workspace/store-isolation.test.ts (NEW) — two-workspace recall returns only own rows
```

#### Deep Dives
- Keep the SDK-internal `search(query, k, filters?)` optional for in-memory/unit, but the REST path constructs `ScopedFilters` (required workspaceId). The insert path always writes `workspace_id` (from the scoped memory binding).
- pgvector-store.ts is 900 LoC — if the change pushes it over 500-LoC budget pressure, extract `composeFilters` to a sibling `filter-composer.ts` (already partly factored). Honor the budget.

#### TDD
```
RED:   store-isolation.test.ts seeds memory in ws-A + ws-B, recalls as ws-A → only ws-A rows; composeFilters unit test asserts a workspace_id clause is always present on ScopedFilters.
GREEN: implement.
REFACTOR: extract filter-composer if LoC budget pressed.
VERIFY: THEOMEM_PG_URI=... pnpm vitest run tests/integration/workspace/store-isolation.test.ts --config vitest.integration.config.ts ; pnpm vitest run packages/core/src/infrastructure/db/pgvector-store.test.ts --config vitest.contract.config.ts
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] `store-isolation.test.ts` exits 0: a ws-A recall never returns a ws-B row.
- [ ] composeFilters unit test: `ScopedFilters` always yields a `workspace_id = $` clause.
- [ ] typecheck: a REST-path call without `workspaceId` is a compile error.
- [ ] `in-memory-store.ts` (unit/contract path) applies the SAME `workspace_id` filter so contract tests cannot pass while integration leaks; if it defaults every row to the `default` workspace, that is asserted explicitly (EC-9).
- [ ] lint 0; pgvector-store.ts ≤ 500 LoC after any extraction OR the extraction lands.

#### DoD
- [ ] `pnpm vitest run tests/integration/workspace/store-isolation.test.ts --config vitest.integration.config.ts` exits 0.
- [ ] `pnpm run typecheck` reports 0 errors and `pnpm run lint` reports 0 warnings.

### T1.2 — Thread `workspace_id` through skill-store, recall-cache, eviction

#### Objective
`pgvector-skill-store`, `recall-cache` store, and eviction (`scope-candidate`/`scope-where`/`triadic-scoring-policy`) carry `workspace_id`; the recall-cache scope key includes it.

#### Why this step (action + reasoning)
1. **What** — make the remaining stores workspace-aware so the system is not half-isolated (Q3).
2. **Why now** — D4's compile-required field forces these call sites; the cache key must include workspace to avoid cross-workspace hits (Critical risk).

#### Evidence
- `infrastructure/db/{pgvector-skill-store,recall-cache/pgvector-recall-cache-store}.ts`, `eviction/{scope-candidate,scope-where,triadic-scoring-policy}.ts` (scope-column grep).

#### Files to edit
```
packages/core/src/infrastructure/db/pgvector-skill-store.ts — workspace_id clause + insert
packages/core/src/infrastructure/db/recall-cache/pgvector-recall-cache-store.ts — workspace_id in scope key + lookup
packages/core/src/infrastructure/db/eviction/scope-where.ts — workspace_id AND-clause
packages/core/src/infrastructure/db/eviction/scope-candidate.ts — carry workspaceId
tests/integration/workspace/cache-skill-eviction-isolation.test.ts (NEW)
```

#### TDD
```
RED:   cache-skill-eviction-isolation.test.ts: same query in ws-A and ws-B yields a cache MISS across them; a ws-A skill recall never returns a ws-B skill; eviction in ws-A never evicts a ws-B row.
GREEN: thread workspace_id.
VERIFY: THEOMEM_PG_URI=... pnpm vitest run tests/integration/workspace/cache-skill-eviction-isolation.test.ts --config vitest.integration.config.ts
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] Cross-workspace cache hit is impossible: ws-A and ws-B issue a BYTE-IDENTICAL query string; ws-B gets a cache MISS (its own compute), proving `workspace_id` is part of the cache scope key, not just the embedding cosine (EC-8).
- [ ] Skill + eviction isolation tests exit 0.
- [ ] typecheck + lint clean.

#### DoD
- [ ] `pnpm vitest run tests/integration/workspace/cache-skill-eviction-isolation.test.ts --config vitest.integration.config.ts` exits 0.
- [ ] `pnpm run typecheck` reports 0 errors and `pnpm run lint` reports 0 warnings.

---

## Phase 2: Auth — resolve the Principal

### T2.1 — `ApiKeyAuthVerifier.resolvePrincipal` + env→default bridge + middleware injects Principal

#### Objective
`ApiKeyAuthVerifier.resolvePrincipal(token)` returns `{ workspaceId, scopes }` from the `theo_api_keys` lookup (joined to `workspace_id`); `BearerAuthVerifier` (env key) resolves to the `default` workspace; `bearerAuth` middleware injects the Principal into the Hono context.

#### Why this step (action + reasoning)
1. **What** — the credential→workspace resolution (the pattern's headline change).
2. **Why now** — handlers (Phase 3) read the Principal from context; it must be populated first.

#### Evidence
- `auth/api-key-verifier.ts:51-57` (lookup SQL — add `workspace_id` to the SELECT); `auth/bearer-verifier.ts:37-42` (env read); `auth/middleware.ts:30-40` (gate — inject Principal).

#### Files to edit
```
packages/api/src/server/auth/api-key-verifier.ts — resolvePrincipal (SELECT workspace_id, scopes)
packages/api/src/server/auth/bearer-verifier.ts — resolvePrincipal → default-workspace Principal
packages/api/src/server/auth/middleware.ts — set c.set('principal', principal)
packages/api/src/server/auth/api-key-verifier.test.ts — resolvePrincipal returns workspaceId+scopes; revoked → null
tests/integration/workspace/principal-resolution.test.ts (NEW)
```

#### TDD
```
RED:   api-key-verifier.test.ts: a seeded key in ws-A resolves to { workspaceId: ws-A, scopes };
       a REVOKED key (revoked_at in the past) → null → 401 (EC-2);
       an EXPIRED key (expires_at in the past) → null → 401 (EC-2);
       the env key → default workspace.
       The resolvePrincipal SQL keeps the verbatim predicate from api-key-verifier.ts:51-57
       (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())) — only the SELECT
       list gains workspace_id; the WHERE is unchanged (EC-2 guard).
GREEN: implement resolvePrincipal + bridge + middleware inject.
VERIFY: THEOMEM_PG_URI=... pnpm vitest run tests/integration/workspace/principal-resolution.test.ts --config vitest.integration.config.ts
```

#### Concurrency tests (only when applicable)
(none — single-threaded) — the OIDC verifier's in-flight Map coalescing is unchanged by this task.

#### Acceptance Criteria
- [ ] `resolvePrincipal` returns the seeded key's `workspaceId` + `scopes`; revoked/expired → null.
- [ ] env `THEMEMORY_API_KEY` resolves to the `default` workspace Principal.
- [ ] middleware sets `principal` in context; a downstream test reads it.

#### DoD
- [ ] `pnpm vitest run tests/integration/workspace/principal-resolution.test.ts --config vitest.integration.config.ts` exits 0.
- [ ] `pnpm run typecheck` reports 0 errors and `pnpm run lint` reports 0 warnings.

---

## Phase 3: REST — derive workspace from Principal; 404 cross-workspace

### T3.1 — Handlers read workspace from Principal; by-id 404; admin keys per workspace

#### Objective
`remember`/`recall`/`forget`/`reflect`/`scopes` handlers build `ScopedFilters` with `workspaceId` from `c.get('principal')` (never the body); by-id `forget`/GET return 404 cross-workspace; `requireScope` admin handlers scope to the Principal's workspace; body schemas reject a `workspaceId` field.

#### Why this step (action + reasoning)
1. **What** — wire the Principal into the request path so isolation is enforced end-to-end (D3 + D6).
2. **Why now** — closes the loop: persistence (Phase 1) + auth (Phase 2) are inert until the handlers pass the Principal's workspace to the repo.

#### Evidence
- `handlers/{remember,recall,forget,reflect,scopes}.ts`; `schemas.ts:25-40` (body scope); `auth/scope-verifier.ts:130-138` (admin 403); `app.ts:226-262` (wiring).

#### Files to edit
```
packages/api/src/server/handlers/remember.ts — workspace from principal → scoped.remember
packages/api/src/server/handlers/recall.ts — workspace from principal
packages/api/src/server/handlers/forget.ts — existence-check within workspace → 404 cross-workspace
packages/api/src/server/handlers/reflect.ts — workspace from principal
packages/api/src/server/handlers/scopes.ts — list scoped to principal workspace
packages/api/src/server/schemas.ts — reject body workspaceId
packages/api/src/server/auth/scope-verifier.ts — admin handlers scope to principal workspace
tests/integration/auth/workspace-isolation.test.ts (NEW) — THE GOAL TEST (IDOR matrix)
```

#### TDD
```
RED:   workspace-isolation.test.ts (the goal test):
       - ws-A remembers; ws-B recall → empty (200 []);
       - ws-B forget(ws-A id) → 404 AND ws-A's row stays valid (t_invalid IS NULL) —
         the soft-delete UPDATE carries `AND workspace_id = $principal`; 0 rows → 404,
         never touching ws-B's (here ws-A's) row (EC-5 destructive-IDOR guard);
       - create derives workspace from principal; a body `workspaceId` field → 400
         `unrecognized_keys` via the existing `.strict()` schema (EC-4), proving the
         field is REJECTED (explicit), not silently dropped;
       - ws-B admin cannot list ws-A keys (admin scoped to principal workspace).
GREEN: wire handlers.
VERIFY: THEOMEM_PG_URI=... pnpm vitest run tests/integration/auth/workspace-isolation.test.ts --config vitest.integration.config.ts
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] THE GOAL TEST exits 0: cross-workspace recall empty, by-id 404, create-from-principal, admin-per-workspace.
- [ ] A body `workspaceId` is ignored/rejected (test asserts the Principal's workspace wins).
- [ ] typecheck + lint clean.

#### DoD
- [ ] `pnpm vitest run tests/integration/auth/workspace-isolation.test.ts --config vitest.integration.config.ts` exits 0.
- [ ] `pnpm run typecheck` reports 0 errors, `pnpm run lint` reports 0 warnings, and `CHANGELOG.md [Unreleased]` gains the handler entry.

---

## Phase 4: Default-workspace collapse + breaking note

### T4.1 — Remove insecure auth-disabled override; document the breaking change

#### Objective
Replace the "auth disabled pass-through" with a `default`-workspace Principal (D7); update barrels/README/CHANGELOG with the `AuthVerifier` PUBLIC BREAKING note + the default-workspace behavior.

#### Why this step (action + reasoning)
1. **What** — close the insecure mode + honestly document the breaking surface (`architecture.md § 9`, Inquebravel Rule 3 + 6).
2. **Why now** — the system is now workspace-isolated; the old pass-through is the last hole.

#### Files to edit
```
packages/api/src/server/auth/middleware.ts — no-credential → default-workspace Principal
packages/core/src/domain/dip/auth-verifier.ts — (final) remove defaulted verify OR mark @deprecated
packages/api/src/server/index.ts + packages/core/src/domain/index.ts — export updates
README.md — Security section: workspace isolation + breaking AuthVerifier note
CHANGELOG.md — [Unreleased] Added/Changed/BREAKING
tests/integration/auth/default-workspace.test.ts (NEW)
```

#### TDD
```
RED:   default-workspace.test.ts: no credential → resolves to default workspace; can read/write only default; legacy THEMEMORY_API_KEY → default.
GREEN: implement.
VERIFY: THEOMEM_PG_URI=... pnpm vitest run tests/integration/auth/default-workspace.test.ts --config vitest.integration.config.ts
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] No-credential path resolves to the `default` workspace (not pass-through).
- [ ] README Security + CHANGELOG document the breaking `AuthVerifier` change + default-workspace behavior.
- [ ] A public-surface contract test imports `Principal`/`Workspace` through the barrel.

#### DoD
- [ ] `pnpm vitest run tests/integration/auth/default-workspace.test.ts --config vitest.integration.config.ts` exits 0.
- [ ] `pnpm run typecheck` reports 0 errors, `pnpm run lint` reports 0 warnings, and `README.md` + `CHANGELOG.md` carry the breaking-change note.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `workspaces` table + `default` seed | T0.2 | 0016 migration |
| 2 | `workspace_id` on the 6 data tables (non-destructive) | T0.2 | add-nullable→backfill→NOT NULL |
| 3 | `Principal`/`Workspace` domain types | T0.1 | core/domain/principal.ts |
| 4 | `AuthVerifier.resolvePrincipal` (additive-then-breaking) | T0.1 + T2.1 + T4.1 | DIP evolution |
| 5 | `WorkspaceMismatch` typed error → 404 | T0.1 + T3.1 | errors.ts + forget handler |
| 6 | Compile-required `workspaceId` (no silent leak) | T1.1 | ScopedFilters required field |
| 7 | `composeFilters` workspace clause + memories store | T1.1 | store isolation |
| 8 | skill-store + recall-cache + eviction threaded | T1.2 | sub-store isolation |
| 9 | recall-cache no cross-workspace hit | T1.2 | workspace in cache key |
| 10 | `ApiKeyAuthVerifier.resolvePrincipal` (key→workspace) | T2.1 | lookup SELECT workspace_id |
| 11 | env key → default workspace bridge | T2.1 + T4.1 | BearerAuthVerifier |
| 12 | middleware injects Principal | T2.1 | c.set('principal') |
| 13 | handlers derive workspace from Principal (not body) | T3.1 | D3 |
| 14 | body `workspaceId` rejected | T3.1 | schema |
| 15 | cross-workspace by-id → 404 | T3.1 | D6 |
| 16 | admin keys scoped per workspace | T3.1 | requireScope |
| 17 | no-credential → default workspace (override removed) | T4.1 | D7 |
| 18 | drizzle schema/meta parity with 0016 | T0.2 | parity test |
| 19 | IDOR test matrix vs real pgvector | T3.1 + Final | goal test |
| 20 | PUBLIC BREAKING documented (README + CHANGELOG) | T4.1 | docs |
| 21 | EC-1 every-table-denormalized (no join-inherit leak) | T1.1 + T1.2 | D-LEAF |
| 22 | EC-2 revoked/expired key → null → 401 | T2.1 | verbatim predicate + RED |
| 23 | EC-3 single atomic migration transaction | T0.2 | D5 BEGIN/COMMIT |
| 24 | EC-4 body workspaceId → 400 (rejected, not dropped) | T3.1 | `.strict()` |
| 25 | EC-5 forget workspace-scoped (no destructive cross-IDOR) | T3.1 | scoped soft-delete |
| 26 | EC-6/EC-7 stable `default` id + idempotent seed | T0.2 | fixed id + ON CONFLICT |
| 27 | EC-8 cache no cross-workspace hit | T1.2 | workspace in cache key |
| 28 | EC-9 in-memory store parity | T1.1 | same workspace filter |

**Coverage: 28/28 gaps covered (100%)** (20 original + 8 edge-case absorptions)

## Global Definition of Done

- [ ] All phases completed
- [ ] THE GOAL TEST `tests/integration/auth/workspace-isolation.test.ts` → 0 failed against real pgvector
- [ ] Full keyless integration suite still 0 failed (the just-stabilized suite stays green with 0016)
- [ ] Contract suite green; `pnpm run typecheck` 0 errors; `pnpm run lint` 0 warnings
- [ ] File-size budget respected (500 LoC; pgvector-store extraction if needed)
- [ ] CHANGELOG `[Unreleased]` updated (Added: workspace isolation; Changed/BREAKING: AuthVerifier resolves Principal)
- [ ] README Security section documents workspace isolation + the breaking note
- [ ] `Principal`/`Workspace`/`WorkspaceMismatch` exported + contract-tested through the public barrel
- [ ] No paper names in code (`no-paper-names-in-code.md`)
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merged

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phases 0-4. The plan is NOT done until the IDOR matrix + full suite are green.

### Execution
```
THEOMEM_PG_URI=postgresql://themem:themem@localhost:5432/themem pnpm vitest run tests/integration/auth/workspace-isolation.test.ts --config vitest.integration.config.ts
THEOMEM_PG_URI=... pnpm vitest run --config vitest.integration.config.ts   # full suite still green
pnpm vitest run --config vitest.contract.config.ts
pnpm run typecheck && pnpm run lint
```

### Acceptance Criteria
- [ ] IDOR matrix: cross-workspace recall empty; by-id 404; create-from-principal; admin-per-workspace; revoked→401; no cross-workspace cache hit.
- [ ] Full integration suite 0 failed (0016 migration does not regress the stabilized suite); deterministic across two runs.
- [ ] Contract green; typecheck + lint clean.
- [ ] No assertion weakened to pass; every breaking change disclosed.

### If Validation Fails
1. Classify each residual failure (which phase / which store missed `workspace_id`).
2. Fix in-scope; isolate any genuinely new defect with an honest BLOCKED note (never green it blindly).
3. Re-run the chain.
