---
slug: dashboard-phase2b-skills-browse
created_at: 2026-06-19
goal: Surface the already-shipped Memory.skills(repoId) capability as a read-only dashboard browse via a new TheMemory REST listing endpoint + theo-cloud gateway BFF + dashboard Skills tab.
---

# Plan: Dashboard Phase 2B — Read-only Skills (Repo-tier) Browse

> **Version 1.1** (edge-cases absorbed 2026-06-19 — EC-1 workspace-resolution parity [MUST FIX] in T2.1; EC-2 repoId path-char handling in T2.1/T3.1; EC-3 null-code render + EC-4 truncation disclosure in T4.1; EC-5/EC-6 documented in D3/D5). See `knowledge-base/reviews/dashboard-phase2b-skills-browse-edge-cases-2026-06-19.md`.

> **Version 1.0** — Expose the Voyager-style skill library (already shipped at the SDK layer via `Memory.skills(repoId)`) as a read-only browse surface. Adds a list-all method to the `ScopedSkillMemory` DIP contract, a new `GET /v1/scopes/skill/:repoId/skills` REST endpoint on TheMemory, a theo-cloud gateway BFF + SDK proxy with per-customer repo namespacing, and a dashboard Skills tab. Read-only only — no executor/editor/sandbox. Unfrozen by project-owner/CTO sign-off 2026-06-19 (CLAUDE.md Amendment 2026-06-19), grounded in blueprint `dashboard-phase2-skills-bitemporal-attribution` ADR D2 (SHIPPABLE 98.5).

## Goal

> "Enable theo-cloud dashboard users to browse the skills stored under a repo so that a customer can see their agent's Voyager-style skill library read-only, measured by the e2e test `TestMemoryE2E_SkillsBrowse` round-tripping an added skill through gateway → TheMemory and back, plus the TheMemory contract test `GET /v1/scopes/skill/:repoId/skills returns the repo's skills` passing against real `ankane/pgvector:v0.5.1`."

## Context

The `dashboard-phase2-skills-bitemporal-attribution` discovery (blueprint SHIPPABLE 98.5) split three deferred capabilities into Phase 2A (attribution-write + `asOf`, already SHIPPED in theo-memory v0.7.0 + theo-cloud v0.1.0) and a FROZEN skills surface. ADR D2 of that blueprint established: the skills dashboard is a **read-only browse** needing a NEW TheMemory REST endpoint (skills are SDK-only today — the generic memories endpoint returns `501 SKILL_LISTING_NOT_IMPLEMENTED` for `type=skill`), fronted by the gateway BFF, surfaced as a dashboard Skills tab, with zero sandbox/execution dependencies.

The project owner / CTO explicitly requested this surface on 2026-06-19 ("Eu quero o item 1 e 2 isso é um PEDIDO do CTO"), recorded as CLAUDE.md Amendment 2026-06-19 + a CHANGELOG `Changed` entry (commit `c2b5cae`), which lifts the P0 freeze for THIS read-only browse surface only (Items 13/14/15 stay FROZEN).

The capability already exists in `src/core`: `Memory.skills(repoId)` returns a `ScopedSkillMemory` (`add`/`recall`/`consolidate`/`forget`). What is missing is (a) a list-all read method on that contract, (b) a REST listing endpoint, (c) the gateway plumbing, (d) the dashboard tab.

## Baseline Context (deep review of current state)

### Files that will be touched

**theo-memory repo** (`/home/paulo/Projetos/usetheo/theo-data/theo-memory`):

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/skill.ts` | 173 | `ab62443` (2026-06-10) | `Skill` + `ScopedSkillMemory` DIP contract (4 verbs) | Existing 4 verbs `add`/`recall`/`consolidate`/`forget` keep their signatures; `Skill` field shape stays backward-compatible |
| `packages/core/src/infrastructure/db/scoped-skill-memory.ts` | 198 | `477f72d` (2026-06-17) | `LocalScopedSkillMemory` impl — façade delegating to store + pipeline | `recall` semantics unchanged; `agent_id=repoId` + `workspace_id` scope mapping (EC-4) preserved |
| `packages/core/src/infrastructure/db/scoped-skill-memory.test.ts` (verify path) | — | — | unit tests for the skill façade | — |
| `packages/api/src/server/handlers/scopes.ts` | 185 | `82f67fd` (2026-06-19) | `/v1/scopes/:type/:id/memories` handler + skill-type 501 branch | The generic memories-endpoint 501-for-skill branch STAYS (D5); new `/skills` route is a sibling |
| `packages/api/src/server/handlers/skills.ts` (NEW) | 0 | — | (file to be created) — skills listing handler | — |
| `packages/api/src/server/__tests__/skills.test.ts` (NEW) | 0 | — | (file to be created) — unit tests for skills handler | — |
| `packages/api/src/server/index.ts` (verify) | — | — | route registration + createServer | existing routes unchanged; OpenAPI registry append-only |
| `tests/integration/` (NEW skills integration test) | 0 | — | (file to be created) — real pgvector skills listing | — |

**theo-cloud repo** (`/home/paulo/Projetos/usetheo/theo-cloud/theo-cloud`):

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `internal/themory/client.go` | 511 | `a163546` (2026-06-19) | Go client to TheMemory REST (List/Metrics/Entities/Remember/Recall/Reflect/Forget) | Existing methods + request/response structs unchanged; add-only |
| `internal/routes/memory.go` | 430 | `a163546` (2026-06-19) | SDK-surface `/v1/memory/*` handlers (RequireScope) | Existing handlers unchanged; add-only |
| `internal/routes/dashboard_memory.go` | 273 | `9c5ee4a` (2026-06-19) | BFF `/v1/dashboard/memory/*` (mint key → delegate) | mint-or-fail flow + delegation pattern reused, not modified |
| `cmd/main.go` | 827 | (current) | chi router + handler wiring | existing route lines unchanged; add 2 route lines |
| `dashboard/src/pages/memory/skills.tsx` (NEW) | 0 | — | (file to be created) — Skills browse tab | — |
| `dashboard/src/pages/memory/skills.test.tsx` (NEW) | 0 | — | (file to be created) — tab tests | — |
| `dashboard/src/pages/memory.tsx` | (current) | — | memory overview + nav links to sub-pages | existing nav links unchanged; add one Skills link |
| `dashboard/src/app.tsx` | (current) | — | router with `/memory/*` routes | existing routes unchanged; add one `/memory/skills` route |
| `tests/e2e/memory_e2e_test.go` | (current) | `73f9c95` (2026-06-19) | gateway↔TheMemory e2e (full verb surface + attribution) | existing tests unchanged; add `TestMemoryE2E_SkillsBrowse` |

### Current callers / dependents

- **Symbol:** `ScopedSkillMemory` (interface) in `packages/core/src/domain/skill.ts`
  - **Callers (production):** `packages/core/src/infrastructure/db/scoped-skill-memory.ts` (implements it); `Memory.skills(repoId)` factory returns it (`packages/core/src/...` LocalMemory).
  - **Callers (tests):** `packages/core/src/domain/skill-barrel.test.ts:21`, `skill.test-d.ts`.
  - **External (public API consumed by other repos):** yes — exported from the public contract barrel; adding a method is a forward-only pre-release change (acceptable, CLAUDE.md amendment).
- **Symbol:** `LocalScopedSkillMemory.recall` in `scoped-skill-memory.ts:130`
  - The new `getAll()` reuses the SAME `decodeSkillPayload` projection + `this.filters` scope mapping that `recall` uses (DRY).
- **Symbol:** `PgvectorStore.list` in `packages/core/src/infrastructure/db/pgvector-store.ts:644`
  - **Callers (production):** scopes/memories handler via `ScopedMemory.getAll`; `Memory.reset`.
  - The new skill `getAll()` reuses `list({agent_id, kind:'skill', excludeSuperseded, workspace_id})` — `list` already SELECTs `kind, code, description, code_language, derived_from, superseded_by, created_at` and excludes soft-deleted (`t_invalid IS NULL`).
- **Symbol:** the skill-type 501 branch in `scopes.ts:111`
  - Stays. The new `/skills` sub-resource is a sibling route, not a replacement of the memories-endpoint branch (D5).
- **Symbol (theo-cloud):** `MemoryHandler.Entities` in `internal/routes/memory.go:242` + `Client.Entities` in `client.go` + `DashboardMemoryHandler.Entities` in `dashboard_memory.go:120`
  - These are the structural templates for the new `ListSkills` triad. No modification — add-only siblings.

### Domain glossary

- **RepoScope** — the 4th memory tier (`{ kind: 'repo', repoId }`), exposed only via `Memory.skills(repoId)`; maps to `agent_id=repoId` at the store layer (EC-4 / ADR-0010).
- **Skill** — a `kind='skill'` row in the `memories` table: `{ hash, description (embedding target), code, codeLanguage, derivedFrom, supersededBy }`. Identity is `hashFact(description)`.
- **head-of-chain skill** — a skill with `superseded_by IS NULL` (the current version; superseded ancestors are excluded by default).
- **BFF (Backend-For-Frontend)** — the gateway `/v1/dashboard/memory/*` family: JWT-authenticated browser calls that mint a server-side `theo_live_*` key then delegate to the SDK-surface `MemoryHandler`.
- **subject** — the customer identity from the JWT (`auth.GetUser(r.Context()).Subject`); the gateway's single-tenant isolation key (one subject per customer).
- **repo namespacing** — composing the upstream `repoId` as `{subject}:{repoId}` so two customers using the same bare repoId never share a skill scope (D3).

### Architecture boundaries affected

- **theo-memory** `rules/architecture.md § 3 (DIP)`: the new `getAll()` lives in `src/core` contract + `packages/core` impl (core defines, local implements). No cross-import added — `scoped-skill-memory.ts` already depends only on core contracts + the store it owns. `packages/api` depends on `packages/core` (allowed). NO new boundary crossing.
- **theo-memory** `§ 9 (Public API surface)`: `ScopedSkillMemory` gains one method — a forward-only pre-release addition (documented in CLAUDE.md amendment).
- **theo-cloud**: the BFF→SDK→client layering is preserved; the new triad mirrors the existing Entities triad exactly.

## Prior Art & Related Work

- **Internal blueprint:** `knowledge-base/discoveries/blueprints/dashboard-phase2-skills-bitemporal-attribution-blueprint.md` § "ADR D2" (the skills read-only browse contract + the `GET /v1/scopes/skill/:repoId/skills` endpoint shape + zero-sandbox-deps decision) and § "Technique 1 — Procedural / code-as-skill identity + persistence (Q1)".
- **Reference project (read-only study):** Letta's `tool_manager.py` upsert-by-name confirms a browse view needs only `{name, source, schema}` rows — zero execution deps (`letta/pyproject.toml` e2b/modal are optional extras). Cited in blueprint ADR D2 rationale.
- **Internal precedent plan:** `knowledge-base/plans/theo-memory-dashboard-full-integration-plan.md` (the metrics/entities subject-scoped endpoints + the gateway BFF triad shape this plan mirrors) and `knowledge-base/plans/dashboard-memories-tab-standardization-plan.md` (the `PgvectorStore.list` projection + `created_at DESC, id ASC` ordering reused here).
- **Internal precedent (Phase 2A):** the just-shipped `dashboard-phase2a-attribution-asof` (theo-memory v0.7.0 / theo-cloud v0.1.0) established the cross-repo merge-order + e2e harness this plan reuses.

## Objective

- [ ] Sub-goal 1 — `ScopedSkillMemory` exposes a read-only `getAll()` returning the repo's head-of-chain skills (core contract + `LocalScopedSkillMemory` impl).
- [ ] Sub-goal 2 — `GET /v1/scopes/skill/:repoId/skills` returns the repo's skills as `{hash, description, code, codeLanguage, createdAt, derivedFrom, supersededBy}` rows, OpenAPI-registered, against real pgvector.
- [ ] Sub-goal 3 — theo-cloud client `ListSkills` + SDK-surface `GET /v1/memory/skills` (RequireScope memory:read) + BFF `GET /v1/dashboard/memory/skills` (mint→delegate), with per-customer repo namespacing.
- [ ] Sub-goal 4 — dashboard Skills tab browses skills per repoId read-only (no executor/editor/sandbox), wired in nav + router.
- [ ] Sub-goal 5 — e2e `TestMemoryE2E_SkillsBrowse` round-trips an added skill through gateway → TheMemory.

## ADRs

### D1 — Reuse `PgvectorStore.list` for skill listing (do NOT add a dedicated skill SQL query)

- **Decision:** `LocalScopedSkillMemory.getAll()` calls the existing `vectorStore.list({ agent_id: repoId, kind: 'skill', excludeSuperseded: true, workspace_id }, topK)` and projects each row via the existing `decodeSkillPayload`.
- **Rationale:** `PgvectorStore.list` (`pgvector-store.ts:644`) already SELECTs every skill column (`kind, code, description, code_language, derived_from, superseded_by, created_at`), already excludes soft-deleted rows (`t_invalid IS NULL`), already orders `created_at DESC, id ASC`, and already supports the needed filters via `composeFilters` (`kind`, `agent_id`, `excludeSuperseded`, `workspace_id`). Recall already passes exactly these filter keys.
- **Alternatives considered:** (a) a new `listSkills` SQL on `PgvectorSkillStore` — REJECTED: duplicates the projection + soft-delete + ordering logic that `list` already encapsulates (DRY violation per CLAUDE.md Rule 12); (b) `recall('')` with empty query — REJECTED: recall is semantic search; an empty query embedding is ill-defined and would still run the LLM/embedder path for a list-all (KISS violation + non-deterministic).
- **Consequences:** zero new SQL; the listing inherits `list`'s soft-delete + ordering contract for free. Constrains: pagination follows `list`'s `topK` cap (consistent with the memories endpoint).

### D2 — Add `getAll()` to the `ScopedSkillMemory` DIP contract (read-only list method)

- **Decision:** extend the `ScopedSkillMemory` interface with `getAll(options?: SkillListOptions): Promise<readonly Skill[]>` (head-of-chain by default; `includeSuperseded?: boolean` mirrors `SkillRecallOptions`).
- **Rationale:** the browse needs a list-all that the current 4 verbs cannot express. A read-only `getAll` mirrors `ScopedMemory.getAll` (the memories tier already has it), keeping the two tiers' contracts symmetric and intuitive.
- **Alternatives considered:** (a) overload `recall` with a "list mode" sentinel — REJECTED: conflates semantic search with enumeration (ISP violation; a browse consumer would depend on recall scoring it never uses); (b) keep skills SDK-only and derive the list in the gateway by paging recall — REJECTED: no enumerate primitive exists; would be a hack.
- **Consequences:** one forward-only addition to a public pre-release DIP (documented in CLAUDE.md amendment). The in-memory test double for `ScopedSkillMemory` must also implement `getAll`.

### D3 — Per-customer repo namespacing in the gateway (multi-tenant isolation)

- **Decision:** the gateway composes the upstream `repoId` sent to TheMemory as `{subject}:{clientRepoId}` (subject from the JWT). The dashboard sends a bare `repoId`; the gateway prefixes it. The bare repoId is echoed back to the client for display (the prefix is gateway-internal).
- **Rationale:** memories isolate by `user/{subject}` in the path; skills are scoped by `skill/{repoId}` where `repoId` is customer-provided. Without namespacing, customer A's `repoId="myrepo"` and customer B's `repoId="myrepo"` collide on the SAME `agent_id=myrepo` skill scope → cross-customer skill leak (a security defect of the same class the metrics/entities subject-scoping already guards against). Prefixing with the subject guarantees per-customer isolation while preserving the repo dimension within a customer.
- **Alternatives considered:** (a) send the bare repoId upstream — REJECTED: cross-customer skill leak (BLOCKER-class security bug); (b) a separate workspace per customer at the TheMemory layer — REJECTED: the gateway shares ONE master key by design (the established subject-in-path isolation model); introducing per-customer workspaces is out of scope and contradicts the shipped architecture.
- **Consequences:** skills written via any future gateway write path MUST use the same namespacing; the dashboard never sees the prefix. The separator `:` must not appear in a valid subject (subjects are Kratos UUIDs/emails — `:` is safe; a guard rejects a clientRepoId containing the separator to avoid spoofing).
- **Documented accepted risk (EC-5):** the injectivity of `{subject}:{repoId}` ASSUMES the subject contains no `:` (Kratos UUID/email subjects satisfy this; repoId-with-`:` is rejected at the gateway). If a future identity provider permits `:` in the subject, two `(subject, repoId)` pairs could collide — revisit then with a length-prefixed or non-printable separator.

### D4 — Read-only browse ONLY (no executor / editor / sandbox)

- **Decision:** the dashboard Skills tab lists skills read-only — `{hash, description, code payload (display), language, createdAt}`. No run/execute, no edit, no delete-from-dashboard, no sandbox dependency (e2b/modal).
- **Rationale:** CLAUDE.md Amendment 2026-06-19 scope guardrail (KISS/YAGNI) + blueprint ADR D2: a browse needs only the rows; an executor pulls heavy optional deps and broadens the P0 surface.
- **Alternatives considered:** (a) skill executor in the dashboard — REJECTED: pulls e2b/modal, YAGNI, violates the P0 scope guardrail; (b) skill editor (add/forget from dashboard) — REJECTED: write path is out of scope for this read-only surface; the SDK already offers it.
- **Consequences:** the dashboard tab is a `DataTable` like Entities; no write controls. A future write surface is a separate plan.

### D5 — New `/skills` sub-resource route; the memories-endpoint skill-type 501 STAYS

- **Decision:** add a NEW route `GET /v1/scopes/skill/:repoId/skills`. The existing `GET /v1/scopes/skill/:id/memories` keeps returning `501 SKILL_LISTING_NOT_IMPLEMENTED`.
- **Rationale:** a skill scope has no "memories" in the user/session/agent sense — it has skills. Overloading the generic memories projection for skills would blur the contract. A dedicated `/skills` sub-resource is semantically correct and keeps the generic endpoint honest.
- **Alternatives considered:** (a) make `/scopes/skill/:id/memories` return skills — REJECTED: overloads a generic projection with a tier-specific shape (skills carry `code`/`derivedFrom` the memories projection does not surface); confuses OpenAPI consumers.
- **Consequences:** the 501 contract test for the memories endpoint stays green unchanged; the new route gets its own OpenAPI registration + tests.
- **Documented accepted risk (EC-6):** the TheMemory skills endpoint has NO per-repo ownership check — like the existing memories endpoint, it lists whatever `repoId` is requested for the authenticated key's workspace. This is consistent with the single-tenant-per-deployment / workspace-keyed model; the gateway's D3 namespacing is the multi-tenant isolation boundary. A direct SDK/REST caller with a valid key can list any repoId in its own workspace by design.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Adding `getAll` to a public pre-release DIP is a contract change | Low | Forward-only addition; documented in CLAUDE.md amendment + CHANGELOG; in-memory double updated in same task | core |
| `decodeSkillPayload` may expect a payload shape that `list`'s `VectorStoreResult.metadata` does not carry verbatim | Medium | T1.1 RED test asserts a full round-trip projection; if `list` output shape differs, project the row fields directly in `getAll` (still no new SQL) | core |
| Cross-customer skill leak if repo namespacing is missed | High | D3 namespacing + an e2e isolation leg asserting customer B cannot see customer A's repo skills | gateway |
| Large skill `code` payloads bloat the listing response | Low | Reuse `list`'s `topK` cap (pagination consistent with memories); dashboard renders code in a collapsible cell | gateway/FE |
| Cross-repo merge order (theo-cloud e2e needs the new TheMemory image) | Medium | Merge + image-rebuild theo-memory FIRST; theo-cloud phases run against the rebuilt image (mirrors Phase 2A; sharp fix `c05fdc5` makes the rebuild reproducible) | both |

## Unresolved Questions

- Q1 — should the listing exclude derived (consolidated) skills, or include them with a `derivedFrom` marker? (Plan assumes INCLUDE all head-of-chain rows incl. derived, since derived skills ARE current skills; `derivedFrom` is surfaced so the UI can badge them.)
- Q2 — does the bare `repoId` need a charset/length validation at the gateway beyond the `:`-separator guard? (Plan adds a minimal guard: non-empty, no separator char; broader validation deferred unless `/edge-case-plan` flags it.)
- Q3 — pagination: is `topK=100` (the `list` default) sufficient for v1 browse, or is cursor pagination needed now? (Plan ships the `list` default cap + documents the cap honestly; cursor pagination deferred to a follow-up if a customer exceeds it.)

## Dependencies

**(none — zero new dependencies; zero sandbox deps per D4.)** This plan reuses only already-installed libraries:

- theo-memory: `pg` + `pgvector` (existing store), `zod` + `@hono/zod-openapi` (existing schema/route layer) — no version change.
- theo-cloud: `chi/v5` + `pgx` (existing router/db) — no version change.
- D4 scope guardrail explicitly REJECTS any sandbox/execution dependency (e2b/modal) — the browse is read-only.

No new package is introduced, used, or removed; therefore no Rule 9 evaluation, version pin, or CVE audit is required for a new dependency.

## Dependency Graph

```
Phase 1 (theo-memory core: getAll) ──▶ Phase 2 (theo-memory REST endpoint)
                                              │
                                              ▼
                                   [MERGE + image rebuild theo-memory]
                                              │
                                              ▼
Phase 3 (theo-cloud gateway triad) ──▶ Phase 4 (dashboard Skills tab)
                                              │
                                              ▼
                                   Phase 5 (Integration Validation: e2e)
```

Phase 1 blocks Phase 2 (the endpoint calls `getAll`). Phases 1+2 must merge to theo-memory `develop` and the image rebuild before Phase 5's e2e can run against it. Phase 3 blocks Phase 4 (the tab calls the BFF route). Phase 3 client/handler tasks (T3.1/T3.2/T3.3) are sequential (handler depends on client; BFF depends on handler) but their unit tests are independent.

---

## Phase 1: theo-memory core — read-only `getAll()` on `ScopedSkillMemory`

**Objective:** add a list-all read method to the skill contract + impl, reusing `PgvectorStore.list` + `decodeSkillPayload`.

### T1.1 — Add `getAll()` to the `ScopedSkillMemory` contract + `LocalScopedSkillMemory` impl

#### Objective
Extend the DIP interface with `getAll(options?): Promise<readonly Skill[]>` and implement it by delegating to `vectorStore.list` with the skill scope filters, projecting via `decodeSkillPayload`.

#### Why this step (action + reasoning)

1. **What this step does** — adds one method to the `ScopedSkillMemory` interface (`skill.ts`) + a `SkillListOptions` type, and implements `getAll` in `LocalScopedSkillMemory` (`scoped-skill-memory.ts`) reusing the same `this.filters` scope mapping and `decodeSkillPayload` projection that `recall` uses.
2. **Why it is necessary now** — the browse surface (Goal) cannot enumerate skills with the current 4 verbs (D2). Doing it here, before the REST endpoint (Phase 2), means the endpoint has a real contract to call. Reusing `list` (D1) avoids new SQL.

#### Evidence
- `packages/core/src/domain/skill.ts:168` — `ScopedSkillMemory` declares 4 verbs, no list method.
- `packages/core/src/infrastructure/db/scoped-skill-memory.ts:130-160` — `recall` builds `filters = { ...this.filters, kind:'skill', excludeSuperseded }` and projects via `decodeSkillPayload(r.id, r.metadata, this.scope, r.score)`.
- `packages/core/src/infrastructure/db/pgvector-store.ts:644` — `list(filters, topK, includeSoftDeleted)` SELECTs `kind, code, description, code_language, derived_from, superseded_by, created_at` and orders `created_at DESC, id ASC`.
- `packages/core/src/infrastructure/db/skills/payload.ts:33` — `decodeSkillPayload(id, payload, scope, score?)` (score optional — consolidate calls it 3-arg at `consolidate.ts:280`).

#### Files to edit
```
packages/core/src/domain/skill.ts — add SkillListOptions type + getAll() to ScopedSkillMemory interface
packages/core/src/infrastructure/db/scoped-skill-memory.ts — implement getAll()
packages/core/src/infrastructure/db/scoped-skill-memory.test.ts — RED tests (verify exact test path first)
```

#### Deep file dependency analysis
- `skill.ts` defines the contract; adding a method ripples to every implementer + test double. Only `LocalScopedSkillMemory` implements it in production; the in-memory double in tests must add `getAll` too (see T1.2 if a shared double exists).
- `scoped-skill-memory.ts` `getAll` calls `this.deps.vectorStore.list(...)`. `deps.vectorStore` is typed `VectorStore & VectorStoreWithSkillInsert`; `VectorStore` already declares `list` — no deps-type change needed.
- Downstream: `Memory.skills(repoId)` factory returns `LocalScopedSkillMemory`; no factory change (the new method ships on the returned object automatically).

#### Deep Dives
- **Signature:** `getAll(options?: { includeSuperseded?: boolean; topK?: number }): Promise<readonly Skill[]>`.
- **Filter construction:** `{ ...this.filters, kind: 'skill', excludeSuperseded: options?.includeSuperseded !== true }` — identical scope mapping to `recall` (`agent_id=repoId` + optional `workspace_id`).
- **Projection:** for each `VectorStoreResult` from `list`, call `decodeSkillPayload(r.id, r.metadata ?? r.payload, this.scope)` (no score → omitted). Collect non-null.
- **Invariant (preserve):** head-of-chain default (`excludeSuperseded:true`); soft-deleted excluded (inherited from `list`). Empty repo → `[]` (never null).
- **Workspace isolation (EC-1):** `getAll` reuses `this.filters`, which already carries `workspace_id` when the skill object was constructed via `Memory.withWorkspace(ws).skills(repoId)` (`scoped-skill-memory.ts` constructor). So the CORE method is workspace-correct by construction; the API handler (T2.1) is responsible for constructing the scoped skill object from the workspace-resolved `Memory`.
- **Edge case / RISK:** verify `list`'s `VectorStoreResult` carries the skill columns into the field `decodeSkillPayload` reads. If `decodeSkillPayload` reads a `payload` JSONB but `list` exposes the columns as top-level result fields, project the result fields directly into a `Skill` in `getAll` (still no new SQL — just a mapping). The RED test pins the expected output shape so this is caught immediately.

#### Pseudo-code / Signatures
```pseudocode
async getAll(options?): Promise<readonly Skill[]>
  filters = { ...this.filters, kind: 'skill', excludeSuperseded: options?.includeSuperseded !== true }
  [rows, _total] = await this.deps.vectorStore.list(filters, options?.topK ?? 100)
  skills = []
  for r in rows:
    s = decodeSkillPayload(r.id, r.metadata ?? r.payload, this.scope)  // 3-arg, no score
    if s !== null: skills.push(s)
  return skills

# Example
# repo "acme" has skill A (head) + skill B (superseded_by=A)
input:  getAll()                 -> [A]                 // head-of-chain default
input:  getAll({includeSuperseded:true}) -> [A, B]
input:  getAll() on empty repo   -> []
```

#### Tasks
1. Add `SkillListOptions` interface + `getAll()` to `ScopedSkillMemory` in `skill.ts` with JSDoc (no paper names — describe behavior).
2. Implement `getAll()` in `LocalScopedSkillMemory` reusing `this.filters` + `decodeSkillPayload`.
3. Add RED unit tests against the in-memory/stub store covering: head-of-chain default, `includeSuperseded:true`, empty repo → `[]`, scope isolation (repo A's `getAll` does not return repo B's skill).

#### TDD
```
RED:     getAll returns the repo head-of-chain skills (one added skill round-trips with hash+description+code) — fails (method absent)
RED:     getAll() excludes superseded skills by default; includeSuperseded:true includes them
RED:     getAll() on an empty repo returns [] (not null/throw)
RED:     getAll() is scope-isolated — repoA.getAll() never returns a repoB skill
GREEN:   Implement getAll() delegating to vectorStore.list + decodeSkillPayload
REFACTOR: Extract the shared filter-build if recall + getAll duplicate it (DRY) — else None
VERIFY:  pnpm --filter @usetheo/memory test (or the core test command); root: pnpm test
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] `ScopedSkillMemory.getAll()` exists in the contract with JSDoc (no paper names).
- [ ] `LocalScopedSkillMemory.getAll()` returns head-of-chain skills by default, all with `includeSuperseded:true`, `[]` on empty, scope-isolated.
- [ ] Reuses `vectorStore.list` (no new SQL) per D1.
- [ ] Pass: coverage ≥ 90% on changed files; lint zero warnings; each changed file ≤ 500 LoC — verified by `pnpm test` + coverage report.

#### DoD
- [ ] RED tests written first, then GREEN; all green.
- [ ] `pnpm test` (root contract suite incl. typecheck) green.
- [ ] Zero lint warnings; CHANGELOG `[Unreleased]` updated.

### T1.2 — Update the in-memory `ScopedSkillMemory` test double (if one exists) to implement `getAll`

#### Objective
Keep the contract's test double in sync so type-checking + consumers compile.

#### Why this step (action + reasoning)
1. **What this step does** — finds any in-memory/stub implementation of `ScopedSkillMemory` (used by api-layer tests) and adds a `getAll` that lists from its in-memory array.
2. **Why it is necessary now** — adding a method to an interface (T1.1/D2) breaks every implementer at compile time. The api skills handler (Phase 2) tests stub `Memory.skills()`; the stub must satisfy the widened contract.

#### Evidence
- `packages/api/src/server/__tests__/scopes.test.ts:168` stubs the skill scope (returns 501 today) — the api tests already construct skill-scope doubles.
- T1.1 widens the interface, so any double typed as `ScopedSkillMemory` must add `getAll` or fail typecheck.

#### Files to edit
```
packages/api/src/server/__tests__/skills.test.ts (NEW) — stub Memory.skills(repoId).getAll
(any shared test double for ScopedSkillMemory — grep first; edit if present)
```

#### Deep file dependency analysis
- If a shared double exists (`grep -rln "getAll\|ScopedSkillMemory" packages/*/src/**/__tests__`), widen it. If skill doubles are inline per-test (likely), the Phase 2 handler tests supply their own `getAll` stub — no shared change.

#### Deep Dives
- Minimal: a stub `skills: () => ({ add, recall, consolidate, forget, getAll: async () => fixtureSkills })`.

#### Pseudo-code / Signatures
```pseudocode
stubMemory(skills) -> { skills: (repoId) => ({ getAll: async () => skills, add, recall, consolidate, forget }) }
```

#### Tasks
1. Grep for existing `ScopedSkillMemory` doubles; widen each with `getAll`.
2. If none shared, this task folds into Phase 2 test fixtures (note it).

#### TDD
```
RED:     (covered by T2.1 handler tests — the stub must compile with getAll)
GREEN:   Add getAll to the stub(s)
REFACTOR: None expected
VERIFY:  pnpm test (typecheck passes)
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Every `ScopedSkillMemory` double compiles against the widened interface.
- [ ] `pnpm test` typecheck green.

#### DoD
- [ ] Typecheck green; no `any` casts introduced to dodge the contract.

---

## Phase 2: theo-memory REST — `GET /v1/scopes/skill/:repoId/skills`

**Objective:** expose `getAll()` over REST with OpenAPI registration + real-pgvector integration test.

### T2.1 — New skills listing handler + route + OpenAPI

#### Objective
Add `GET /v1/scopes/skill/:repoId/skills` returning `{ skills: [{ id, hash, description, code, codeLanguage, createdAt, derivedFrom, supersededBy }] }`.

#### Why this step (action + reasoning)
1. **What this step does** — creates a `skills.ts` handler that resolves `memory.skills(repoId)`, calls `getAll()`, projects the rows to a stable JSON shape, registers the route + OpenAPI in `createServer`.
2. **Why it is necessary now** — the gateway (Phase 3) needs a REST surface to call; today skills are SDK-only (501). This is the D5 dedicated sub-resource.

#### Evidence
- `packages/api/src/server/handlers/scopes.ts:111` — the skill-type 501 branch (stays per D5).
- `packages/api/src/server/handlers/metrics.ts` (71 LoC, `6ee371e`) — structural template for a small subject-scoped GET handler.
- `packages/api/src/server/__tests__/openapi.test.ts:115` — OpenAPI registration is asserted by tests; the new route must register.

#### Files to edit
```
packages/api/src/server/handlers/skills.ts (NEW) — listSkills handler + projection + zod response schema
packages/api/src/server/handlers/__tests__/skills.test.ts (NEW) — unit tests (stub memory)
packages/api/src/server/index.ts — register GET /v1/scopes/skill/:repoId/skills + OpenAPI (verify exact registration file)
packages/api/src/server/__tests__/openapi.test.ts — assert the new route is documented
```

#### Deep file dependency analysis
- `skills.ts` imports `Memory` contract (`memory.skills(repoId).getAll()`); projects `Skill` → response DTO. Empty repoId → 400 (mirror `scopes.ts` validation). Non-existent repo → `{ skills: [] }` (empty, not 404 — a repo with no skills is valid).
- **EC-1 (MUST FIX — workspace-resolution parity):** the handler MUST obtain `memory.skills(repoId)` through the SAME workspace-bound `Memory` the memories handler uses (the Principal/workspace resolution already wired in `createServer` / `pathParamsToScoped`). A bare `memory.skills(repoId)` would fall back to `workspace_id='default'` (the `scoped-skill-memory.ts` constructor's documented workspace-default behavior) and on a multi-workspace deployment list the wrong workspace OR return empty for a non-default workspace — bypassing the multi-tenant-rbac `workspace_id` isolation the rest of the surface enforces. `getAll()` already threads `workspace_id` via `this.filters` (T1.1), so correctness hinges on constructing the scoped skill object from the workspace-resolved `Memory`.
- Route registration sits beside the existing `/v1/scopes/:type/:id/memories` registration; OpenAPI registry is append-only.
- **EC-2 (repoId path chars):** a `repoId` containing `/` or other path-reserved chars must not silently route-miss (404). The gateway `url.PathEscape`s the namespaced repoId (T3.1); the TheMemory route must resolve the single `:repoId` segment or return a clean 400 — never a confusing route-miss.

#### Deep Dives
- **Response DTO (zod):** `{ skills: z.array(z.object({ id, hash, description, code: z.string().nullable(), codeLanguage: z.string().nullable(), createdAt: z.string().datetime(), derivedFrom: z.array(z.string()), supersededBy: z.string().nullable() })) }`.
- **Projection:** map each `Skill` from `getAll()`; `createdAt` → ISO string.
- **Pagination:** optional `?topK=` (default 100, capped) consistent with the memories endpoint; document the cap (Q3 honest disclosure).
- **Invariant:** always `{ skills: [...] }` (array, never null) — mirrors the entities `{ entities: [] }` contract.

#### Pseudo-code / Signatures
```pseudocode
GET /v1/scopes/skill/:repoId/skills
  repoId = param; if empty -> 400 INVALID_SCOPE
  topK = clamp(query.topK ?? 100, 1, MAX)
  skills = await memory.skills(repoId).getAll({ topK })
  return 200 { skills: skills.map(toDto) }

# Example
input:  GET /v1/scopes/skill/acme/skills   (acme has 2 skills)
output: 200 { skills: [ {id, hash, description:"deploy", code:"...", codeLanguage:"bash", createdAt, derivedFrom:[], supersededBy:null}, {...} ] }
input:  GET /v1/scopes/skill/empty/skills  -> 200 { skills: [] }
```

#### Tasks
1. Create `skills.ts` handler + zod response schema + projection.
2. Register the route + OpenAPI in `createServer`.
3. RED tests: returns skills for a repo, empty repo → `{skills:[]}`, empty repoId → 400, response shape matches DTO, OpenAPI documents the route.

#### TDD
```
RED:     GET /v1/scopes/skill/:repoId/skills returns the repo's skills (stubbed getAll) with the DTO shape
RED:     empty repo returns { skills: [] } (never null)
RED:     empty/whitespace repoId returns 400 INVALID_SCOPE
RED:     EC-1: skills are resolved via the workspace-bound Memory — a skill in workspace A is NOT returned when the request resolves workspace B (workspace-isolation parity with the memories handler)
RED:     EC-2: a repoId with a path-reserved char (e.g. contains '/') yields a clean 400 or resolves the segment — never a route-miss 404
RED:     EC-4: when getAll returns exactly `topK` rows, the response signals truncation (e.g. a `truncated:true` or `cap` field) so the UI can disclose "showing first N" (Inquebravel Rule 3 honesty)
RED:     OpenAPI spec documents GET /v1/scopes/skill/{repoId}/skills with 200 schema
GREEN:   Implement handler + route + OpenAPI registration (resolve memory.skills via the workspace-bound Memory)
REFACTOR: Share the DTO projection if duplicated — else None
VERIFY:  pnpm --filter @usetheo/memory-api test ; root pnpm test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Route returns the repo's skills in the documented DTO; empty → `{skills:[]}`; empty repoId → 400.
- [ ] EC-1: the handler resolves `memory.skills(repoId)` via the workspace-bound Memory — workspace-isolation parity test green.
- [ ] EC-2: a path-reserved-char repoId yields a clean 400 / resolves the segment (no route-miss 404) — test `skills returns 400 on path-reserved repoId` green.
- [ ] EC-4: truncation at the `topK` cap is disclosed in the response shape.
- [ ] OpenAPI registers the route; `openapi.test.ts` green.
- [ ] The memories-endpoint skill-type 501 branch is unchanged (D5) — `scopes.test.ts` 501 test stays green.
- [ ] Pass: coverage ≥ 90%; lint zero; file ≤ 500 LoC — verified by `pnpm test`.

#### DoD
- [ ] RED→GREEN; `pnpm test` green; CHANGELOG `[Unreleased] § Added` updated.

### T2.2 — Real-pgvector integration test for skills listing

#### Objective
Prove the endpoint lists real skills written via `Memory.skills(repoId).add()` against `ankane/pgvector:v0.5.1`.

#### Why this step (action + reasoning)
1. **What this step does** — an integration test boots the real store, adds 2 skills to a repo, calls the endpoint, asserts both come back with the right shape; adds a superseded skill and asserts it's excluded by default.
2. **Why it is necessary now** — wiring triad pillar (b): the unit test stubs the store; the integration test hits the real boundary (the bug the Phase 2A e2e caught — getAll projection mismatch against real pgvector — must be impossible here).

#### Evidence
- Phase 2A precedent: the entities/metrics latent bug (metadata vs top-level `attributed_to`) was only caught against real pgvector — same risk class for `decodeSkillPayload` over `list` output (T1.1 Medium risk).
- `tests/integration/` is the established real-pgvector harness location.

#### Files to edit
```
tests/integration/skills-listing.test.ts (NEW) — real pgvector add→list round-trip (verify integration test path/glob)
```

#### Deep file dependency analysis
- Reuses the existing integration harness (real pool + `runMigrations`); adds skills via the SDK, lists via the handler/`createServer`.

#### Deep Dives
- Add skill A + B to repo "acme"; GET → 2 rows with hash/description/code. Supersede B (via consolidate or markSuperseded); GET default → excludes B; `includeSuperseded`-equivalent (if exposed via query) includes it. Cross-repo: add to "other"; "acme" listing excludes it.

#### Pseudo-code / Signatures
```pseudocode
beforeAll: pool + runMigrations
test: skills().add(A); skills().add(B); GET /scopes/skill/acme/skills -> 2 rows (A,B fields match)
test: cross-repo isolation -> acme listing excludes other-repo skill
```

#### Tasks
1. Write the real-pgvector integration test (add → list → assert shape + isolation).
2. Ensure it runs in the integration config (verify glob).

#### TDD
```
RED:     integration: add 2 skills to a repo, GET returns both with code+description+hash (fails until endpoint+getAll wired against real store)
RED:     integration: cross-repo isolation — acme listing excludes other-repo skill
GREEN:   (satisfied by T1.1 + T2.1; this test proves the real boundary)
REFACTOR: None expected
VERIFY:  pnpm test:integration (real ankane/pgvector:v0.5.1)
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Integration test green against real pgvector: 2 added skills list back with correct fields; cross-repo isolation holds; superseded excluded by default — `pnpm test:integration` green.
- [ ] Confirms `decodeSkillPayload` over `list` output projects correctly (T1.1 risk closed).

#### DoD
- [ ] `pnpm test:integration` green; wiring pillar (b) satisfied.

---

## Phase 3: theo-cloud gateway — client + SDK surface + BFF (with repo namespacing)

**Objective:** plumb skills listing through the gateway with per-customer repo namespacing (D3), mirroring the Entities triad.

### T3.1 — `Client.ListSkills` in `internal/themory/client.go`

#### Objective
Add a Go client method calling `GET /v1/scopes/skill/{repoId}/skills` + the response structs.

#### Why this step (action + reasoning)
1. **What this step does** — adds `Skill` + `SkillsResult` structs and `func (c *Client) ListSkills(ctx, repoId string) (*SkillsResult, error)` mirroring `Entities`.
2. **Why it is necessary now** — the SDK-surface + BFF handlers (T3.2/T3.3) delegate to this client method; it is the lowest layer.

#### Evidence
- `internal/themory/client.go` — `Client.Entities` (template), `do(...)` helper, struct conventions (`MetricsResult`, `EntitiesResult`).

#### Files to edit
```
internal/themory/client.go — add Skill struct, SkillsResult struct, ListSkills method
internal/themory/client_test.go (or tests/unit/themory_client_test.go) — RED test (verify path)
```

#### Deep file dependency analysis
- `ListSkills` uses `c.do(ctx, GET, "/v1/scopes/skill/"+url.PathEscape(repoId)+"/skills", nil, nil, &out)`; nil-safe `out.Skills`.
- Note: the client receives the ALREADY-namespaced repoId (the handler composes `{subject}:{repoId}` before calling). The client itself does NOT namespace (keeps it transport-only, SRP).

#### Deep Dives
- `Skill` struct: `ID, Hash, Description, Code (string, ptr or "" for null), CodeLanguage (ptr), CreatedAt, DerivedFrom []string, SupersededBy (ptr)`.
- `SkillsResult{ Skills []Skill }`; nil → `[]Skill{}`.

#### Pseudo-code / Signatures
```pseudocode
func (c *Client) ListSkills(ctx, repoID string) (*SkillsResult, error)
  out := SkillsResult{}
  path := "/v1/scopes/skill/" + url.PathEscape(repoID) + "/skills"
  if err := c.do(ctx, GET, path, nil, nil, &out); err != nil { return nil, err }
  if out.Skills == nil { out.Skills = []Skill{} }
  return &out, nil
```

#### Tasks
1. Add structs + `ListSkills`.
2. RED test: mocks the upstream, asserts path + parsed result + nil→[] normalization.

#### TDD
```
RED:     ListSkills hits /v1/scopes/skill/{repoId}/skills and parses skills (httptest mock)
RED:     ListSkills normalizes nil skills to []Skill{}
RED:     EC-2: ListSkills url.PathEscapes the (namespaced) repoId so a repoId with '/' or ':' produces a well-formed path (mock asserts the escaped path)
GREEN:   Implement struct + method
REFACTOR: None expected
VERIFY:  go test ./internal/themory/...
```

#### Concurrency tests
(none — single-threaded)
The net/http client is request-scoped.

#### Acceptance Criteria
- [ ] `ListSkills` calls the correct path, parses the DTO, normalizes nil→[].
- [ ] Existing client methods/structs unchanged (add-only) — `go test ./internal/themory/...` green.

#### DoD
- [ ] `go test ./internal/themory/...` green; CHANGELOG (theo-cloud) updated.

### T3.2 — SDK surface `GET /v1/memory/skills` in `internal/routes/memory.go` + main.go route

#### Objective
Add `MemoryHandler.ListSkills` (RequireScope `memory:read`) reading `?repoId=`, composing the namespaced repoId, delegating to `Client.ListSkills`.

#### Why this step (action + reasoning)
1. **What this step does** — adds the SDK-surface handler that validates auth + repoId, composes `{subject}:{repoId}` (D3), calls the client, emits `{skills:[]}` on empty.
2. **Why it is necessary now** — this is the scope-gated SDK route; the BFF (T3.3) delegates to it (the established two-layer pattern).

#### Evidence
- `internal/routes/memory.go:242` — `MemoryHandler.Entities` template (auth check, validate, client call, nil→[]).
- `cmd/main.go:412-423` — `/v1/memory` route group with `RequireScope`.

#### Files to edit
```
internal/routes/memory.go — add ListSkills handler
cmd/main.go — register r.With(RequireScope "memory:read").Get("/skills", memoryHandler.ListSkills)
tests/unit/memory_handlers_test.go — RED tests (auth, repoId validation, namespacing, empty→[])
```

#### Deep file dependency analysis
- `ListSkills` reads `user.Subject` + `?repoId=`; rejects empty repoId (400) + repoId containing the `:` separator (400, anti-spoof per D3); composes `subject + ":" + repoId`; calls `h.client.ListSkills(ctx, namespaced)`; upstream error → 502; nil → `{skills:[]}`.
- main.go adds ONE route line in the existing `/v1/memory` group (existing lines unchanged).

#### Deep Dives
- **Namespacing (D3):** `namespaced := user.Subject + ":" + repoId`. Guard: if `strings.Contains(repoId, ":")` → 400 `INVALID_REPO_ID`.
- **Echo-back:** the response surfaces the bare repoId the client sent (the prefix never leaves the gateway) — the client already knows it; the skills DTO carries no repoId, so nothing to strip.

#### Pseudo-code / Signatures
```pseudocode
func (h *MemoryHandler) ListSkills(w, r)
  user = GetUser; if nil -> 401
  repoId = query "repoId"; if "" -> 400 INVALID_REPO_ID
  if contains(repoId, ":") -> 400 INVALID_REPO_ID
  namespaced = user.Subject + ":" + repoId
  res, err = h.client.ListSkills(ctx, namespaced)
  if err -> 502 MEMORY_UPSTREAM_UNAVAILABLE
  if res.Skills == nil -> res.Skills = []
  writeJSON 200 res
```

#### Tasks
1. Add `ListSkills` handler with auth + repoId guard + namespacing.
2. Register the route in main.go.
3. RED tests: 401 unauth; 400 empty repoId; 400 repoId with `:`; namespacing passed to client (mock asserts `subject:repoId`); empty→`{skills:[]}`; 502 on upstream error.

#### TDD
```
RED:     ListSkills 401 when unauthenticated
RED:     ListSkills 400 on empty repoId and on repoId containing ':'
RED:     ListSkills composes {subject}:{repoId} and passes it to the client (mock asserts)
RED:     ListSkills returns {skills:[]} on empty + 502 on upstream error
GREEN:   Implement handler + register route
REFACTOR: None expected
VERIFY:  go test ./internal/routes/... ; go build ./...
```

#### Concurrency tests
(none — single-threaded)
The handler is request-scoped.

#### Acceptance Criteria
- [ ] Handler enforces auth + repoId guard + D3 namespacing; empty→`{skills:[]}`; 502 on upstream failure.
- [ ] Route registered under `/v1/memory` with `RequireScope("memory:read")`.
- [ ] Existing memory routes unchanged — `go test ./internal/routes/...` green.

#### DoD
- [ ] `go test ./internal/routes/...` + `go build ./...` green.

### T3.3 — BFF `GET /v1/dashboard/memory/skills` in `dashboard_memory.go` + main.go route

#### Objective
Add `DashboardMemoryHandler.ListSkills` (mint key → delegate to `MemoryHandler.ListSkills`).

#### Why this step (action + reasoning)
1. **What this step does** — adds the JWT-authenticated browser-facing BFF route that mints a `theo_live_*` key via the vault then delegates to the SDK-surface handler (the established mint-or-fail pattern).
2. **Why it is necessary now** — the dashboard tab (Phase 4) is browser-trust (JWT), not API-key; it can only call the BFF surface.

#### Evidence
- `internal/routes/dashboard_memory.go:119` — `Entities` BFF proxy (`mintOrFail` then delegate) — exact template.
- `cmd/main.go:458-468` — `/v1/dashboard/memory` route group.

#### Files to edit
```
internal/routes/dashboard_memory.go — add ListSkills proxy (mint → delegate)
cmd/main.go — register r.Get("/skills", dashboardMemoryHandler.ListSkills)
tests/unit/dashboard_memory_test.go — RED tests (mint-fail path + delegation)
```

#### Deep file dependency analysis
- `ListSkills` calls `h.mintOrFail(w, r, "skills")`; on success delegates to `h.memoryHandler.ListSkills(w, r)` (the SDK handler reads the minted key's subject + `?repoId=`).
- main.go adds ONE route line in the existing `/v1/dashboard/memory` group.

#### Deep Dives
- Pure proxy — no business logic; mirrors `Entities`. The query param `?repoId=` flows through unchanged; the SDK handler does the namespacing.

#### Pseudo-code / Signatures
```pseudocode
func (h *DashboardMemoryHandler) ListSkills(w, r)
  if !h.mintOrFail(w, r, "skills") { return }
  h.memoryHandler.ListSkills(w, r)
```

#### Tasks
1. Add the BFF `ListSkills` proxy.
2. Register the route in main.go.
3. RED tests: mint failure short-circuits (no delegation); mint success delegates.

#### TDD
```
RED:     ListSkills returns the mint-failure status when the vault cannot mint (no delegation)
RED:     ListSkills delegates to MemoryHandler.ListSkills after a successful mint
GREEN:   Implement proxy + register route
REFACTOR: None expected
VERIFY:  go test ./internal/routes/... ; go build ./...
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] BFF route mints then delegates; mint failure short-circuits — `dashboard_memory_test.go` green.
- [ ] Route registered under `/v1/dashboard/memory`.

#### DoD
- [ ] `go test ./...` + `go build ./...` green; CHANGELOG (theo-cloud) updated.

---

## Phase 4: dashboard — read-only Skills tab

**Objective:** a Skills browse page listing skills per repoId via the BFF, wired in nav + router.

### T4.1 — Skills page + api fetch + nav link + route

#### Objective
Add `dashboard/src/pages/memory/skills.tsx` — a repoId input + `DataTable` of `{description, codeLanguage, code (collapsible), createdAt}`, fetched via `cloudFetch<SkillsResult>('/v1/dashboard/memory/skills?repoId=...')`.

#### Why this step (action + reasoning)
1. **What this step does** — builds the read-only browse page (DataTable like Entities), a repoId text input (no skills without a repo), the react-query fetch, the nav link from `memory.tsx`, and the `/memory/skills` route in `app.tsx`.
2. **Why it is necessary now** — this is the user-facing Goal; it is the last layer and depends on the BFF route (Phase 3).

#### Evidence
- `dashboard/src/pages/memory/entities.tsx` — `cloudFetch` + `useQuery` + `DataTable` template (`entities.tsx:69-70`).
- `dashboard/src/pages/memory.tsx:153-159` — nav links to sub-pages.
- `dashboard/src/app.tsx` — `/memory/*` route registration.
- `dashboard/src/lib/api.ts` — `cloudFetch`.

#### Files to edit
```
dashboard/src/pages/memory/skills.tsx (NEW) — Skills browse page
dashboard/src/pages/memory/skills.test.tsx (NEW) — page tests (loading, rows, empty, repoId required)
dashboard/src/pages/memory.tsx — add "Browse skills →" nav link
dashboard/src/app.tsx — register /memory/skills route
```

#### Deep file dependency analysis
- `skills.tsx` uses `cloudFetch<SkillsResult>` + `useQuery` keyed by `['cloud','/v1/dashboard/memory/skills', repoId]`, enabled only when repoId non-empty. `DataTable` columns: description, language, code (truncated/collapsible), createdAt. Read-only — no action buttons.
- `memory.tsx` + `app.tsx` are append-only edits (one link, one route).

#### Deep Dives
- **repoId state:** controlled input; query disabled until non-empty (mirrors a search box). Empty state: "Enter a repo to browse its skills."
- **Empty result:** `{skills:[]}` → "No skills found for this repo." (graceful, like Entities empty).
- **Code cell:** render in a `<pre>`/collapsible; never execute. D4 — no run/edit/delete controls.
- **a11y:** DataTable + labeled input (reuse `@usetheo/ui` primitives the other tabs use).

#### Pseudo-code / Signatures
```pseudocode
function SkillsPage()
  [repoId, setRepoId] = useState('')
  q = useQuery(['cloud','/v1/dashboard/memory/skills',repoId], () => cloudFetch(`/v1/dashboard/memory/skills?repoId=${enc(repoId)}`), { enabled: repoId !== '' })
  render: input(repoId) + (repoId==='' ? hint : DataTable(q.data?.skills ?? []))

# Example
repoId="acme" -> table with 2 skills (description, bash, code preview, date)
repoId="" -> "Enter a repo to browse its skills."
repoId="empty" -> "No skills found for this repo."
```

#### Tasks
1. Build `skills.tsx` (input + query + DataTable, read-only).
2. Add nav link in `memory.tsx`; register route in `app.tsx`.
3. RED tests: loading state, renders rows from mocked fetch, empty repoId shows hint, empty result shows empty message, no execute/edit controls present.

#### TDD
```
RED:     SkillsPage shows a repo-required hint when repoId is empty (no fetch)
RED:     SkillsPage renders skill rows from a mocked /v1/dashboard/memory/skills response
RED:     SkillsPage shows the empty message on { skills: [] }
RED:     SkillsPage renders NO run/edit/delete controls (read-only guard, D4)
RED:     EC-3: a skill row with code:null / codeLanguage:null (derived skill) renders without crashing (empty/"—" cell)
RED:     EC-4: when the response signals truncation (length === cap), the page shows a "showing first N" note
GREEN:   Implement page + nav link + route
REFACTOR: None expected
VERIFY:  (dashboard test command — e.g. pnpm --filter dashboard test / vitest)
```

#### Concurrency tests
(none — single-threaded)
UI rendering is single-threaded.

#### Acceptance Criteria
- [ ] Page lists skills per repoId read-only; empty repoId → hint; empty result → message; no executor/editor controls (D4) — `skills.test.tsx` green.
- [ ] Nav link + route registered; existing nav/routes unchanged — `app.tsx` route `/memory/skills` present.
- [ ] Lint/typecheck clean; a11y via shared primitives — `go build ./...` + frontend build clean.

#### DoD
- [ ] Dashboard tests green; `go build`/frontend build green; CHANGELOG (theo-cloud) updated.

---

## Phase 5: Integration Validation (MANDATORY)

**Objective:** validate the full chain end-to-end against real services.

### T5.1 — e2e `TestMemoryE2E_SkillsBrowse` (gateway → TheMemory)

#### Objective
Round-trip: add a skill via the SDK against the rebuilt TheMemory image, list it through the gateway BFF, assert it returns; assert cross-customer isolation (D3).

#### Why this step (action + reasoning)
1. **What this step does** — extends `tests/e2e/memory_e2e_test.go` with a skills leg: seed a skill into a repo, GET the gateway skills route, assert the skill appears; second subject with the same bare repoId sees none of the first's skills.
2. **Why it is necessary now** — wiring triad pillar (b)+(c) across repos; proves the namespacing (D3) actually isolates and the new endpoint is reachable through the full stack.

#### Evidence
- `tests/e2e/memory_e2e_test.go` (`73f9c95`) — `TestMemoryE2E_FullVerbSurface` with attribution round-trip + cross-subject isolation (exact template).
- `make e2e` builds the TheMemory image from source (now reproducible via sharp `c05fdc5`).

#### Files to edit
```
tests/e2e/memory_e2e_test.go — add TestMemoryE2E_SkillsBrowse
```

#### Deep file dependency analysis
- Reuses the e2e harness (pgvector + mock-openai + gateway + rebuilt themory image). Seeds a skill via the SDK surface or directly via TheMemory; lists via the gateway BFF (JWT).

#### Deep Dives
- **Cross-customer isolation:** subject A adds skill to repo "shared"; subject B GETs skills for repo "shared" → empty (namespacing → `A:shared` ≠ `B:shared`).
- **Round-trip:** subject A GETs repo "shared" → the seeded skill (description+code).

#### Pseudo-code / Signatures
```pseudocode
test TestMemoryE2E_SkillsBrowse:
  seed skill S into repo "shared" as subject A
  GET gateway /v1/dashboard/memory/skills?repoId=shared (subject A) -> contains S
  GET gateway /v1/dashboard/memory/skills?repoId=shared (subject B) -> empty (isolation)
```

#### Tasks
1. Add the e2e test (round-trip + isolation legs).
2. Run `make e2e` clean against the rebuilt image.

#### TDD
```
RED:     TestMemoryE2E_SkillsBrowse — subject A sees seeded skill; subject B (same bare repoId) sees none (fails until full stack wired)
GREEN:   (satisfied by Phases 1-4 once theo-memory image is rebuilt)
REFACTOR: None expected
VERIFY:  make e2e
```

#### Concurrency tests
(none — single-threaded)
The test driver is single-threaded.

#### Acceptance Criteria
- [ ] `make e2e` green incl. `TestMemoryE2E_SkillsBrowse` (round-trip + cross-customer isolation).
- [ ] No `THEMORY_IMAGE` override needed (clean build, sharp fix in place).

#### DoD
- [ ] `make e2e` EXIT=0; isolation leg passes (D3 proven).

### Execution

theo-memory:
```
pnpm test                # root contract suite (incl. typecheck)
pnpm test:integration    # real ankane/pgvector:v0.5.1 (skills listing)
pnpm --filter @usetheo/memory-api test
```

theo-cloud:
```
go build ./...
go test ./internal/...
make e2e                 # full stack incl. TestMemoryE2E_SkillsBrowse
```

### Acceptance Criteria
- [ ] All test suites green (unit + integration + e2e).
- [ ] Coverage ≥ 90% on changed files (critical paths 100%).
- [ ] Zero type errors; zero lint warnings (both repos).
- [ ] D3 isolation proven by the e2e cross-customer leg.

### If Validation Fails
1. Separate plan-caused failures from pre-existing.
2. Fix all plan-caused failures; re-run.
3. Log pre-existing issues in the PR description; do not block on them.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `ScopedSkillMemory` has no list-all method (blueprint ADR D2) | T1.1, T1.2 | Add `getAll()` to contract + impl (reuse `list`, D1) + sync doubles |
| 2 | Skills are SDK-only; no REST listing (501 today) | T2.1, T2.2 | New `GET /v1/scopes/skill/:repoId/skills` + OpenAPI + real-pgvector integration test (D5) |
| 3 | Gateway has no skills client method | T3.1 | `Client.ListSkills` |
| 4 | Gateway has no SDK-surface skills route + isolation | T3.2 | `MemoryHandler.ListSkills` + `RequireScope` + D3 repo namespacing |
| 5 | Gateway has no browser-facing BFF skills route | T3.3 | `DashboardMemoryHandler.ListSkills` (mint→delegate) |
| 6 | Dashboard has no Skills browse surface | T4.1 | `skills.tsx` page + nav link + route (read-only, D4) |
| 7 | No end-to-end proof + cross-customer isolation proof | T5.1 | e2e `TestMemoryE2E_SkillsBrowse` (round-trip + isolation) |
| 8 | Edge cases (EC-1 workspace parity, EC-2 path chars, EC-3 null code, EC-4 truncation, EC-5/EC-6 documented) | T2.1, T3.1, T4.1, D3, D5 | EC-1 workspace-bound resolution in T2.1; EC-2 path-escape in T2.1/T3.1; EC-3 null-code render + EC-4 truncation disclosure in T4.1; EC-5/EC-6 documented in D3/D5 |

**Coverage: 8/8 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed.
- [ ] All tests passing — `pnpm test` (theo-memory) + `go test ./...` (theo-cloud) + dashboard tests green.
- [ ] `pnpm test:integration` (real pgvector) green; `make e2e` green.
- [ ] Zero type errors (`pnpm test` typecheck + `go build ./...` + frontend build).
- [ ] Zero lint warnings.
- [ ] File-size budget respected (≤ 500 LoC per `rules/architecture.md`).
- [ ] CHANGELOG.md updated under `[Unreleased]` in BOTH repos (Unbreakable Rule 6).
- [ ] Backward compatibility: existing skill verbs + REST routes + gateway routes unchanged (add-only).
- [ ] No paper names in `src/**`/tests (Rule 9) — describe behavior, not the Voyager origin.
- [ ] D3 multi-tenant isolation proven by the e2e cross-customer leg (no cross-customer skill leak).
- [ ] Read-only guardrail (D4): no executor/editor/sandbox deps added.
- [ ] Cross-repo merge order honored: theo-memory (Phases 1-2) merged + image rebuilt BEFORE theo-cloud e2e (Phase 5).
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PRs are merged, move this plan to `knowledge-base/plans/completed/`.

## Failure scenarios (when I/O external)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| TheMemory REST (HTTP, from gateway) | upstream 5xx / unreachable | unit test mocks `Client.ListSkills` returning error | `MemoryHandler.ListSkills` → 502 `MEMORY_UPSTREAM_UNAVAILABLE`; dashboard shows friendly error (T3.2 RED test) |
| TheMemory REST (HTTP) | upstream returns `null`/missing skills array | mock returns `{}` | client normalizes to `[]Skill{}`; handler emits `{skills:[]}` (T3.1/T3.2) |
| postgres:skills (DB, in TheMemory) | empty repo (no skills row) | integration test queries a repo with no skills | `getAll()` → `[]`; endpoint → `{skills:[]}` (T1.1/T2.2) |
| BFF key mint (vault) | mint fails (vault error) | unit test forces mintOrFail failure | BFF short-circuits with the mint error status, no delegation (T3.3 RED test) |

## Final Phase: Integration Validation (MANDATORY)

Covered by Phase 5 above (T5.1 + the Execution/Acceptance block). The plan is NOT complete until `pnpm test`, `pnpm test:integration`, `go test ./...`, and `make e2e` are all green, with the D3 cross-customer isolation leg passing.
