---
slug: skills-cross-repo-flat-list
milestone_id: SkillsCrossRepoFlatList
created_at: 2026-06-23
goal: Add a tenant-safe cross-repo skills listing to theo-memory (new core method + REST GET /v1/scopes/skill/:subject/all) so a caller can list ALL skills for a subject across every repo (each row carrying its repoId) without knowing a repoId upfront, measured by an integration GOAL against real ankane/pgvector:v0.5.1 where seeding alice:repo-a (2) + alice:repo-b (1) + bob:repo-c (1) and GET /v1/scopes/skill/alice/all returns EXACTLY the 3 alice skills (correct repoId, none of bob's).
---

# Plan: skills-cross-repo-flat-list

> Backend (theo-memory) half of the dashboard "always list skills" UX improvement. Today the Skills tab shows only an empty state ("Enter a repo to browse its skills") + a free-text repoId box — the only data tab that lists nothing by default — because the only skills-list REST endpoint (`GET /v1/scopes/skill/:repoId/skills`) requires a repoId and there is ZERO cross-repo capability (`scopes.ts` returns `501 SKILL_LISTING_NOT_IMPLEMENTED` for `type=skill`). This plan adds a tenant-safe flat cross-repo listing. The theo-cloud gateway BFF + dashboard UI is a SEPARATE follow-up plan, deploy-gated on the version this plan ships (mirrors the gateway-forget cutover deploy-gate precedent).

## Goal

> "Add a tenant-safe cross-repo skills listing — a new `MemoryStore.listSkillsBySubject` core method + `GET /v1/scopes/skill/:subject/all` REST endpoint — that returns ALL skills for a subject across every repo (each carrying its `repoId`, with offset pagination + optional `q` filter), measured by `tests/integration/skills-cross-repo-flat-list.test.ts` where seeding `alice:repo-a` (2) + `alice:repo-b` (1) + `bob:repo-c` (1) and `GET /v1/scopes/skill/alice/all` returns EXACTLY the 3 alice skills with correct `repoId` and NONE of bob's."

## Context

The COMPLETE live-test (2026-06-23) of the dashboard surfaced the Skills-tab discoverability gap: a "Browse" tab that requires prior knowledge of repo names defeats browsing, and contradicts the Voyager thesis (the agent authors skills across repos; the human curates — but cannot curate what it cannot see). Project owner chose the "flat list of ALL skills (repo column + search + pagination)" shape (session decision, 2026-06-23).

The load-bearing constraint is **tenancy**: the theo-cloud gateway calls themory with a single MASTER api key, so every customer's skills land in `workspace_id='default'`; per-customer isolation is enforced ONLY by the `{subject}:` prefix the gateway bakes into `agent_id` (`namespaceRepo`, ADR D3 of voyager-skill-library). A naive cross-repo list filtered by `workspace_id` alone would leak skills across tenants. This plan therefore filters by the `agent_id` PREFIX `'{subject}:%'` (LIKE-wildcards escaped) — the prefix already encodes the tenant. Honors Princípio 3 (auditable, tenant-isolated; tested against real pgvector, not hand-waved).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/memory-store.ts` | 220 | `e507a6e` (2026-06-21) | declares `interface Memory` (`:124`, public 4-verb + `skills(repoId)` `:153` + `withWorkspace?` `:142`) and `interface MemoryStore` (`:48`, the lower vector-store DIP) | existing method signatures UNCHANGED; new method is ADDITIVE; `Memory` stays the public DIP the handler depends on |
| `packages/core/src/infrastructure/db/pgvector-store.ts` | 1087 | `f4750d4` (2026-06-23) | the pgvector adapter; `list()` (`:710`) is the per-scope live-only listing (`composeFilters` exact `agent_id = $n`, ORDER BY created_at DESC, id ASC); `rowToResult` projects agent_id | `list()`/`search()`/`composeFilters` UNCHANGED; new method adds its own prefix-LIKE SQL; reuse `rowToResult` projection |
| `packages/core/src/domain/skill.ts` | 214 | `e507a6e` (2026-06-21) | `Skill` shape (`:186-214`) + `ScopedSkillMemory` (`:170`) | `Skill` UNCHANGED; the cross-repo row type extends it with `repoId` as a NEW exported type, not a mutation |
| `packages/api/src/server/handlers/skills.ts` | 289 | `18cd4d3` (2026-06-22) | per-repo skills handlers (`skillsHandler` `:89`, post/delete/execute); `toDto` (`:80`), `MAX_TOP_K=100` (`:43`) | per-repo `skillsHandler` UNCHANGED; new `skillsAllHandler` added; reuse `toDto` + `workspaceBoundMemory` |
| `packages/api/src/server/app.ts` | 380+ | `f4750d4` (2026-06-23) | route registration; skills routes at `:362-368` | existing routes UNCHANGED; register `GET /v1/scopes/skill/:subject/all` BEFORE/alongside the `:repoId/skills` routes (distinct literal segment `all`) |
| `packages/api/src/server/openapi-registration.ts` | 420+ | (existing) | OpenAPI 3.1 path registration; skill paths `:326-415` | additive: register the new path |
| `packages/core/src/domain/memory-store.test-d.ts` | 60+ | (existing) | type-contract test asserting `Memory` has EXACTLY 10 top-level keys (`:40`) | UPDATE the assertion 10 → 11 with the new key (intentional additive surface, ADR D4) |
| `packages/core/src/infrastructure/db/pgvector-store.test.ts` | (existing) | `f4750d4` | unit tests (SQL-capture stub-pool pattern) | add SQL-shape unit tests for the new method |
| `tests/integration/skills-cross-repo-flat-list.test.ts` (NEW) | 0 | — | (to create) — the GOAL: tenant-isolated cross-repo listing vs real pgvector | — |

### Current callers / dependents

- **`Memory` interface** (`memory-store.ts:124`) — public export via `@usetheo/memory/contract`; implemented by the local `Memory` factory + consumed by every REST handler via `workspaceBoundMemory(c, memory)`. The new method is additive; `memory-store.test-d.ts:40` (10-key assertion) is the ONE test that pins the surface width and MUST be updated.
- **`PgvectorStore.list`** (`:710`) — called by `ScopedSkillMemory.getAll` (`scoped-skill-memory.ts:207`) + the memories/scopes listing. UNCHANGED — the new method is a sibling, not a modification.
- **`skillsHandler`** (`skills.ts:89`) — registered at `app.ts:362`. The new `skillsAllHandler` is a sibling registered at a distinct route.
- **External:** the theo-cloud gateway is the ONLY consumer of the skills REST surface (via master key + `{subject}:{repoId}` namespacing). It will consume the new endpoint in the follow-up plan; no theo-memory caller exists yet (the GOAL integration test is the first caller).

### Domain glossary

- **subject** — the authenticated customer/tenant identifier the gateway bakes as the `{subject}:` prefix of `agent_id`. The cross-repo selector.
- **cross-repo flat list** — all `kind='skill'` rows whose `agent_id` starts with `'{subject}:'`, across every repo, returned as one page with a per-row `repoId`.
- **repoId** — `agent_id` with the `'{subject}:'` prefix stripped (the bare repo the skill belongs to).
- **prefix scan** — `WHERE agent_id LIKE $1` with `$1 = escapeLikeWildcards(subject) || ':%'`; the `:` delimiter prevents `alice` from matching `alice2:...`.

### Architecture boundaries affected

- **`packages/core/src/domain`** — additive widening of the `Memory` DIP (ADR D4). **`packages/core/src/infrastructure/db`** — new store method (own SQL; no change to `list`/`composeFilters`). **`packages/api`** — new handler + route + OpenAPI entry. No schema/migration (reuses the existing `memories` table + `agent_id` btree). No new dependency. Per `architecture.md § 3` DIP direction (domain ← infrastructure; api → domain) is preserved.

## Prior Art & Related Work

- **Internal:** `dashboard-phase2b-skills-browse` (the per-repo `getAll` + `GET /v1/scopes/skill/:repoId/skills`, blueprint ADR D2/D5) is the direct precedent this extends; `voyager-skill-library` ADR D3 defines the `{subject}:{repoId}` namespacing this relies on; `recall-scoped-exact-search` (EG-6, 2026-06-23) established the SQL-capture stub-pool unit-test pattern + real-pgvector GOAL discipline this reuses. `dashboard-memories-tab-standardization` T2.1 established the `created_at DESC, id ASC` listing order + truncation-disclosure honesty.
- **Tenancy:** the session memory `themory-gateway-forget-cutover-deploy-gate` documents the cross-repo deploy-gating pattern (ship provider first, gate the gateway consumer).

## Drawbacks & Risks

| # | Risk | Severity | Mitigation | Owner |
|---|---|---|---|---|
| 1 | LIKE-prefix scan on a large shared `agent_id` index is O(matching rows); a subject with thousands of skills across repos pays a sort cost. | Medium | The `agent_id` btree makes the prefix range-scannable; offset pagination caps the page; `created_at DESC` sort is bounded by the page LIMIT. Document a future cursor option if a subject crosses ~10k skills. | impl |
| 2 | LIKE-wildcard injection: a subject containing `%`/`_`/`\` would broaden/narrow the match → cross-tenant leak or miss. | High | `escapeLikeWildcards` escapes `\ % _` and the query uses `LIKE $1 ESCAPE '\'`; PLUS a guard rejecting a subject containing `:` (the namespace delimiter) with 400. Both unit-tested. | impl |
| 3 | Widening the `Memory` public interface is a (pre-release) surface change. | Low | Additive only (mirrors how `withWorkspace`/`skills` were added); the 10→11 key contract test is updated in the same task; ADR D4 records it; no existing signature changes. | impl |

## Unresolved Questions

(none — every decision is resolved at plan time. The `q` filter is a simple `description ILIKE '%'||$q||'%'` substring; pagination is offset-based mirroring the memories list; the route shape + tenancy filter are locked by ADRs D1/D2.)

## Failure scenarios

The plan touches one external dependency: the Postgres driver (`pg`) inside `PgvectorStore`.

- **DB query error during `listSkillsBySubject`** — failure mode: pool query rejects (connection reset / SQL error). Reproduced in the unit test by a stub pool whose `query` rejects. Expected behavior: the error propagates as a thrown error (fail-fast per Inquebrável Rule 8); the REST handler maps an unexpected throw to a 500 (existing error middleware), NEVER returns a partial/empty list masking the failure. No silent catch.

## ADRs

### D1 — Cross-repo list via `agent_id` prefix scan, NOT a new subject column

The cross-repo selector is the `agent_id` prefix `'{subject}:%'` (LIKE-wildcards escaped, `ESCAPE '\'`), reusing the existing `{subject}:{repoId}` namespacing the gateway already writes.

- **Why:** the prefix already encodes the tenant; the gateway's master-key model means `workspace_id` is uniformly `'default'`, so it cannot isolate tenants. Filtering by the `agent_id` prefix is the ONLY correct isolation boundary and needs zero schema change. Rationale cites Princípio 3 (auditable tenant isolation) + `architecture.md` (no migration when the data already encodes the dimension).
- **Rejected alternative:** add a dedicated `subject` column on skills + a backfill migration. Rejected: larger blast radius (migration + backfill of existing rows whose subject must be parsed back out of `agent_id` anyway), migration risk, and redundant — the prefix is already the source of truth.

### D2 — New REST route `GET /v1/scopes/skill/:subject/all`

A new endpoint under the existing `/v1/scopes/skill/*` namespace, literal 3rd segment `all` (distinct from `/skills` and `/skills/:skillId` → no route collision). Returns `{ skills: (SkillDto & { repoId })[], total, truncated }` with `limit`/`offset` query params (offset pagination, mirroring the memories list) + optional `q` (description substring) + `includeSuperseded`.

- **Why:** stays within the `/v1/scopes/*` REST convention; the `:subject` path segment is where the gateway injects the authenticated subject (exactly as it injects `{subject}:{repoId}` into `:repoId` today). Per-row `repoId` gives the UI its column. Cites `architecture.md` API-design consistency.
- **Rejected alternative:** a top-level `GET /v1/skills?subject=`. Rejected: breaks the `/v1/scopes/*` scoping convention every other listing follows; the subject-in-query form reads as a filter rather than the scope it actually is.

### D3 — New store method `listSkillsBySubject`, per-repo `getAll` unchanged

Add `MemoryStore.listSkillsBySubject(workspaceId, subject, opts)` building its own prefix-LIKE SQL (it cannot reuse `composeFilters`, which only emits exact `agent_id = $n`). The per-repo `ScopedSkillMemory.getAll` + `PgvectorStore.list` stay byte-unchanged.

- **Why:** additive (Inquebrável: no rework of the shipped per-repo path); a dedicated method keeps the prefix-LIKE concern out of the general `composeFilters` (which would otherwise grow a skills-only branch — SRP). Reuses `rowToResult` for projection (DRY).
- **Rejected alternative:** extend `Filters`/`composeFilters` with an `agentIdPrefix` field. Rejected: pollutes the general filter builder with a single-caller concern (SRP/YAGNI), risking the recall path that depends on `composeFilters`.

### D4 — Widen the `Memory` interface with the cross-repo list method

`Memory` gains one method (the workspace-bound surface the handler depends on); the `memory-store.test-d.ts` 10-key assertion is updated to 11 in the same task.

- **Why:** the REST handler's single DIP dependency is `Memory` (via `workspaceBoundMemory`); routing the new capability through `Memory` keeps that single boundary (handler never touches the vectorStore directly). Pre-release additive change, mirrors the `withWorkspace`/`skills` additions. Cites `architecture.md § 3` DIP.
- **Rejected alternative:** have the handler reach the `vectorStore` directly, bypassing `Memory`. Rejected: leaks infrastructure into the api layer + breaks the handler's single-DIP-dependency invariant.

## Dependency Graph

```
Phase 1 (core: store method + Memory wrapper + types)
   T1.1 store method listSkillsBySubject (+ escapeLikeWildcards) ─┐
   T1.2 Memory interface widening + LocalMemory impl + 10→11 test ┘→ blocks Phase 2
Phase 2 (api: handler + route + openapi)
   T2.1 skillsAllHandler + route + OpenAPI ─→ blocks Phase 3
Phase 3 (integration validation)
   T3.1 GOAL test (real pgvector, tenant isolation) + full suite + lint + typecheck
```

T1.1 and T1.2 are sequential (T1.2 calls T1.1). Phase 2 depends on Phase 1. Phase 3 depends on Phase 2.

## Phases

### Phase 1 — Core: tenant-safe cross-repo store method + Memory wrapper

#### T1.1 — `listSkillsBySubject` store method + `escapeLikeWildcards`

##### Why this step
Add the lowest-layer capability: a pgvector method that lists `kind='skill'` rows whose `agent_id` starts with the escaped `'{subject}:'` prefix, live-only, newest-first, with limit/offset + optional description `ILIKE` filter, returning the rows + a total count.

Reasoning chain: per ADR D1 the prefix is the tenant boundary, and per ADR D3 this is a dedicated method (not a `composeFilters` branch) to keep SRP. The prefix MUST be wildcard-escaped (Drawback #2, High) — `escapeLikeWildcards` escapes `\ % _` and the SQL uses `LIKE $1 ESCAPE '\'`. Reuses `rowToResult` (DRY) so the projection matches `list()`.

##### Files to edit
- `packages/core/src/infrastructure/db/pgvector-store.ts` — add `listSkillsBySubject(workspaceId, subject, opts)` + module-private `escapeLikeWildcards(s)`.
- `packages/core/src/domain/memory-store.ts` — add the method to `interface MemoryStore` (`:48`) so the impl satisfies the DIP.
- `packages/core/src/domain/skill.ts` — add exported type `SkillWithRepo = Skill & { readonly repoId: string }`.
- `packages/core/src/infrastructure/db/pgvector-store.test.ts` — SQL-shape unit tests.

##### Deep file dependency analysis
`PgvectorStore` implements `MemoryStore`; adding a method to the interface forces the impl (compile-time safety). `rowToResult` (same file) already projects `agent_id` into the result; the method maps each row to `SkillWithRepo` by stripping the prefix. No caller of `list`/`composeFilters` is touched (Baseline: those stay byte-unchanged).

##### TDD
- RED `test('listSkillsBySubject SQL prefix-filters agent_id with escaped wildcards and ESCAPE clause')` — stub-pool captures SQL; assert it contains `agent_id LIKE $` + `ESCAPE '\'` + `kind = 'skill'` (or bound) + `superseded_by IS NULL` (default) + `ORDER BY created_at DESC, id ASC` + `LIMIT` + `OFFSET`; assert the prefix param equals `alice:%` for subject `alice`.
- RED (EC-1) `test('listSkillsBySubject SQL binds workspace_id AND the agent_id prefix')` — assert the captured SQL contains BOTH `workspace_id = $` and `agent_id LIKE $`, and the bound `workspaceId` arg is actually in the params (multi-workspace correctness + defense-in-depth; the gateway path is all `default`).
- RED `test('escapeLikeWildcards escapes backslash, percent, underscore')` — `escapeLikeWildcards('a%b_c\\d') === 'a\\%b\\_c\\\\d'`.
- RED `test('listSkillsBySubject includes superseded when asked')` — with `includeSuperseded:true` the SQL omits the `superseded_by IS NULL` clause.
- RED `test('listSkillsBySubject q filter adds description ILIKE')` — with `q:'csv'` the SQL contains `description ILIKE` and binds `%csv%`.
- GREEN: implement the method + helper.

##### Concurrency tests
(none — single-threaded; a read-only SELECT with no shared mutable state.)

##### Acceptance criteria
- Unit tests above GREEN. The captured SQL never interpolates `subject` into the string (always bound as `$n`). `escapeLikeWildcards` is covered. `npm run build` (core) succeeds; `list`/`composeFilters` diff is empty.

##### Definition of done
- `npx vitest run packages/core/src/infrastructure/db/pgvector-store.test.ts` GREEN; `cd packages/core && npm run build` succeeds; `git diff` shows no change to `list()`/`composeFilters()`.

#### T1.2 — `Memory` wrapper + `LocalMemory` impl + contract-test update

##### Why this step
Expose the store method through the workspace-bound `Memory` DIP the REST handler depends on, returning `{ skills: SkillWithRepo[], total }`, and update the 10-key contract test to 11.

Reasoning chain: per ADR D4 the handler's single DIP dependency is `Memory`; routing through it preserves the boundary. The `memory-store.test-d.ts:40` assertion is the one pin on the surface width and is updated in the same task (intentional additive change, honest).

##### Files to edit
- `packages/core/src/domain/memory-store.ts` — add `listSkillsBySubject(subject, opts?): Promise<{ skills: readonly SkillWithRepo[]; total: number }>` to `interface Memory` (`:124`).
- the `LocalMemory` factory/impl (resolve the file implementing `Memory` — adjacent to the factory that builds `skills()`; confirm at impl time via `grep -rln "skills(repoId" packages/core/src | grep -v test`) — implement the method, inheriting the bound `workspaceId`, delegating to `MemoryStore.listSkillsBySubject`.
- `packages/core/src/domain/memory-store.test-d.ts` — update the 10 → 11 key assertion (`:40-52`), adding `'listSkillsBySubject'`.

##### Deep file dependency analysis
`withWorkspace` (`memory-store.ts:142`) returns a `Memory` bound to a workspace; the impl must thread `workspaceId` into the store call (Baseline: subject prefix + workspaceId both pass to the store). The `test-d` is type-level; updating it is required or `tsc`/the test breaks (intentional).

##### TDD
- RED: update `memory-store.test-d.ts` expecting `'listSkillsBySubject'` among 11 keys (fails until the interface gains it).
- RED `test('Memory.listSkillsBySubject delegates to store with bound workspace + subject')` — a fake `MemoryStore` records args; assert the bound workspaceId + the subject are forwarded and the result maps through.
- GREEN: add the interface method + impl.

##### Concurrency tests
(none — single-threaded.)

##### Acceptance criteria
- `npm run typecheck` GREEN (11-key assertion satisfied); the delegation unit test GREEN; `withWorkspace(ws).listSkillsBySubject(...)` forwards `ws`.

##### Definition of done
- `npm run typecheck` GREEN; `npx vitest run packages/core/src/domain` GREEN; the contract test shows 11 keys including `listSkillsBySubject`.

### Phase 2 — API: REST handler + route + OpenAPI

#### T2.1 — `skillsAllHandler` + route `GET /v1/scopes/skill/:subject/all` + OpenAPI

##### Why this step
Expose the cross-repo list over REST: validate `:subject` (non-empty; reject if it contains `:` per Drawback #2), parse `limit`/`offset`/`q`/`includeSuperseded`, call `workspaceBoundMemory(c, memory).listSkillsBySubject(subject, ...)`, return `{ skills: (SkillDto & {repoId})[], total, truncated }`.

Reasoning chain: per ADR D2 the route's literal `all` segment avoids collision; per EC the subject-with-`:` guard prevents a malformed prefix; reuse `toDto` (DRY) extended with `repoId`; reuse `workspaceBoundMemory` (EC-1 parity with the per-repo handler).

##### Files to edit
- `packages/api/src/server/handlers/skills.ts` — add `skillsAllHandler` + a `toDtoWithRepo` (or extend `toDto`); reuse `MAX_TOP_K`.
- `packages/api/src/server/app.ts` — register `app.get('/v1/scopes/skill/:subject/all', (c) => skillsAllHandler(c, memory))` (near `:362`).
- `packages/api/src/server/openapi-registration.ts` — register the new path (additive, near `:326`).

##### Deep file dependency analysis
`workspaceBoundMemory` (`_body-parsing.ts`) returns the workspace-bound `Memory` exposing the new method (Phase 1). Route registration order: `all` is a distinct literal segment, so order vs `:repoId/skills` does not matter (no overlap). OpenAPI registration mirrors the existing skill path entries.

##### TDD
- RED `test('GET /v1/scopes/skill/:subject/all rejects a subject containing a colon with 400')`.
- RED `test('GET /v1/scopes/skill/:subject/all clamps limit to MAX_TOP_K and coerces offset')` (422 on invalid).
- RED (EC-3) `test('offset rejects negative/non-integer with 422; offset beyond total returns [] with the real total')` — `offset=-1`/`offset=abc` → 422; `offset=9999` on a 3-row subject → `{skills:[], total:3}`.
- RED (EC-2) `test('GET /v1/scopes/skill/:subject/all dispatches to skillsAllHandler, not the per-repo or generic scopes handler')` — a request to `.../alice/all` returns the cross-repo shape (`{skills, total, truncated}` with per-row `repoId`), proving Hono picked the static `all` route.
- RED `test('skillsAllHandler maps each skill to a DTO carrying repoId + total + truncated')` — handler unit with a fake Memory returning `SkillWithRepo[]`.
- GREEN: implement the handler + route + OpenAPI.

##### Concurrency tests
(none — single-threaded request handler.)

##### Acceptance criteria
- Handler unit tests GREEN; the route resolves (a request reaches `skillsAllHandler`, not the per-repo handler); OpenAPI JSON includes the new path; `npm run typecheck` + `npm run lint` GREEN.

##### Definition of done
- `npx vitest run packages/api/src` GREEN; `curl .../v1/openapi.json | jq '.paths` contains the new path (verified in Phase 3); lint/typecheck GREEN.

### Phase 3 — Integration Validation (eat-your-own-cooking)

#### T3.1 — GOAL: tenant-isolated cross-repo listing vs real pgvector

##### Why this step
Prove the whole chain against real `ankane/pgvector:v0.5.1`: tenant isolation (no cross-subject leak), correct `repoId` per row, pagination, and the empty/`q` paths.

Reasoning chain: the unit tests prove SQL shape + mapping; only a real-DB test proves the prefix scan isolates tenants AND the `agent_id` btree path returns the right rows (Princípio 3 — not hand-waved). This is THE GOAL of the plan.

##### Files to edit
- `tests/integration/skills-cross-repo-flat-list.test.ts` (NEW).

##### Deep file dependency analysis
Reuses the EG-6 GOAL harness pattern (isolated DB via `runMigrations`, `PgvectorStore` direct seeding, `describe.skipIf(THEOMEM_PG_URI==='')`). Seeds skills via the store's skill-insert path under crafted `agent_id` values.

##### TDD
- GOAL `test('lists exactly the subject\'s skills across repos with correct repoId, isolating other tenants')` — seed `alice:repo-a` (2 skills) + `alice:repo-b` (1) + `bob:repo-c` (1); call the listing for subject `alice` → exactly 3 results; the set of `repoId` is `{repo-a, repo-b}`; none of bob's skill ids present.
- GOAL `test('empty subject scope returns [] with total 0')` — subject `nobody` → `{skills:[], total:0}`.
- GOAL `test('q filter narrows by description; offset paginates')` — seed distinct descriptions; assert `q` + `offset`/`limit` slice correctly.
- GOAL `test('a subject that is a strict prefix of another does not leak')` — seed `al:repo-x` (1) alongside alice's; subject `al` returns only `al:repo-x` (the `:` delimiter prevents `alice` rows matching).

##### Concurrency tests
(none — single-threaded; seeding then reading.)

##### Failure-scenario validation
- DB error path is covered at the unit layer (stub pool reject → throw); no chaos pass needed beyond that (single read query).

##### Acceptance criteria
- All GOAL tests GREEN against real pgvector. Full suites GREEN: `npx vitest run packages/core/src --no-file-parallelism`, `npx vitest run packages/api/src`, `THEOMEM_PG_URI=... npx vitest run tests/integration/skills-cross-repo-flat-list.test.ts`. `npm run typecheck` + `npm run lint` zero warnings. `npm run build` (core + api) succeeds. CHANGELOG `[Unreleased]` updated.

##### Definition of done
- Commands above all GREEN; `/code-quality` verdict ∈ {PASS, PASS_WITH_CAVEATS}; CHANGELOG entry present; no change to the per-repo skills path (`git diff` on `list`/`getAll`/`skillsHandler` empty).

## Dependencies

No new dependency is introduced, used, or removed. The plan reuses runtime libraries already in `packages/core/package.json` + `packages/api/package.json`:

| Dependency | Version (pinned in manifest) | Role | New? | Rule 9 eval |
|---|---|---|---|---|
| `pg` | `^8.x` (existing) | Postgres driver — the new store method runs one parameterized SELECT through the existing pool | No | already the project's chosen driver |
| `zod` | `^3.x` (existing) | REST query validation (`limit`/`offset`/`q`/`includeSuperseded`) in the new handler | No | already the project's validation lib |
| `hono` | `^4.x` (existing) | route registration for the new endpoint | No | already the project's HTTP framework |

No CVE audit delta (no version change). `osv-scanner`/`npm audit` are no-ops for this plan.

## Coverage Matrix

| # | Requirement / decision | Detail | Task |
|---|---|---|---|
| 1 | Cross-repo flat list capability | new store method prefix-filters `agent_id LIKE '{subject}:%'` | T1.1 |
| 2 | Tenant isolation (no cross-subject leak) | escaped prefix + `:` delimiter; subject-with-`:` guard | T1.1, T2.1, T3.1 |
| 3 | LIKE-wildcard injection safety (Drawback #2) | `escapeLikeWildcards` + `ESCAPE '\'`; bound param | T1.1 |
| 4 | Per-row `repoId` (UI column) | strip `'{subject}:'` prefix from `agent_id`; defensive skip if no prefix | T1.1, T2.1 |
| 5 | Offset pagination + `q` filter (ADR D2) | `limit`/`offset` + `description ILIKE` | T1.1, T2.1, T3.1 |
| 6 | Superseded excluded by default | `superseded_by IS NULL` unless `includeSuperseded` | T1.1, T3.1 |
| 7 | New REST route, no collision (ADR D2) | `GET /v1/scopes/skill/:subject/all` literal segment | T2.1 |
| 8 | `Memory` DIP widening (ADR D4) | interface + impl + 10→11 contract test | T1.2 |
| 9 | Additive (no rework of per-repo path, ADR D3) | `list`/`getAll`/`skillsHandler` byte-unchanged | T1.1, T2.1, T3.1 |
| 10 | DB failure fail-fast (Failure scenarios) | store throws; handler → 500, never silent empty | T1.1 |
| 11 | GOAL: real-pgvector tenant-isolated listing | seed alice×3 (2 repos) + bob×1 → alice gets 3, none of bob | T3.1 |
| 12 | DOS cap | `limit` clamped to `MAX_TOP_K` | T2.1 |

## Global Definition of Done

- [ ] All tasks' DoD satisfied.
- [ ] `npm run typecheck` zero errors; `npm run lint` zero warnings.
- [ ] Core unit + api unit suites GREEN; the integration GOAL GREEN vs real `ankane/pgvector:v0.5.1`.
- [ ] No change to the shipped per-repo skills path (`list`, `getAll`, `skillsHandler`).
- [ ] No new dependency; no schema/migration; no paper names in `src/**`.
- [ ] `Memory` surface change documented (ADR D4) + the 11-key contract test updated.
- [ ] `CHANGELOG.md [Unreleased]` updated (Added: cross-repo skills listing endpoint).
- [ ] `/code-quality` PASS/PASS_WITH_CAVEATS; `/review` READY_TO_MERGE.
- [ ] File size budget: no edited file exceeds ~600 LoC net-new beyond its current size without justification (per `architecture.md`).
- [ ] Plan archived to `completed/` after PR merge.
