---
slug: skills-write-surface
created_at: 2026-06-19
goal: Expose the shipped ScopedSkillMemory.add()/forget() as a programmatic write surface (REST POST + MCP add_skill/forget_skill + gateway + dashboard forget curation), store-only.
---

# Plan: Skills Write Surface (REST POST + MCP add_skill + forget curation)

> **Version 1.0** — Expose the already-shipped `ScopedSkillMemory.add()`/`forget()` over REST (`POST`/`DELETE`), MCP (`add_skill`/`forget_skill`), the theo-cloud gateway (SDK + BFF), and a dashboard delete-curation control — so an **agent** authors its own skills (Voyager flow) and a human curates (deletes). STORE-only: no executor, no sandbox, no UI code editor. Grounded in blueprint `skills-write-surface` (SHIPPABLE 89). Unfrozen by CTO `/goal` 2026-06-19 (CLAUDE.md Amendment 2026-06-19 (II)).

## Goal

> "Enable an agent (via REST/MCP) to author a skill under a repo and a human to delete a bad one, so the Voyager skill library is populated and curated through the gateway, measured by the e2e test `TestMemoryE2E_SkillsWrite` (add-via-gateway → getAll shows it → forget-via-gateway removes it) plus the TheMemory integration test `skill POST round-trips and a duplicate description returns 409` passing against real `ankane/pgvector:v0.5.1`."

## Context

The read-only skills browse shipped (theo-memory v0.8.0 + theo-cloud v0.2.0). The CTO `/goal` (2026-06-19) extends the unfreeze to the WRITE surface (CLAUDE.md Amendment 2026-06-19 (II)): the closed loop is an agent authoring skills via REST/MCP, with the human curating (delete) in the UI. The blueprint `skills-write-surface` (SHIPPABLE 89) locked the key decisions: dedup-collision → **409** (D1), **store-only/no-sandbox** (D2), MCP `add_skill`+`forget_skill` static-list extension (D3), code size cap, integration-test mirror.

The plumbing (client triad, BFF mint→delegate, `{subject}:{repoId}` namespacing, `RequireScope`, OpenAPI) is ESTABLISHED by the read cycle — this plan is largely symmetric to it on the write side.

## Baseline Context (deep review of current state)

### Files that will be touched

**theo-memory** (`/home/paulo/Projetos/usetheo/theo-data/theo-memory`):

| File | LoC | Last commit | Why it exists | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/errors.ts` | 375 | `23ce3d1` (2026-06-17) | Domain error hierarchy (incl. `InvalidSkillError`, `MemoryNotFound`) | Existing error classes + reasons unchanged; add-only |
| `packages/core/src/infrastructure/db/scoped-skill-memory.ts` | 228 | `2f6898a` (2026-06-19) | `LocalScopedSkillMemory` (add/recall/getAll/consolidate/forget) | `add`/`forget` signatures unchanged; collision currently throws raw PG error — wrap it (D1) |
| `packages/api/src/server/handlers/skills.ts` | 101 | `2f6898a` (2026-06-19) | read-only skills listing handler (`skillsHandler`) | existing `skillsHandler` (GET) unchanged; add `postSkillHandler` + `deleteSkillHandler` |
| `packages/api/src/server/handlers/__tests__/skills.test.ts` | — | `2f6898a` | unit tests for skills handler | extend; existing tests stay green |
| `packages/api/src/server/app.ts` | 331 | `de246db` (2026-06-19) | route registration + OpenAPI | existing routes unchanged; add POST + DELETE |
| `packages/api/src/server/openapi-registration.ts` | — | `de246db` | OpenAPI registry | append-only |
| `packages/mcp/src/tools/{dispatch,list-handler}.ts` | 58/75 | `f9d831e`/`1827fbe` | MCP tool dispatch + static list | static list grows by 2 (D3); `listChanged:false` preserved |
| `packages/mcp/src/tools/add-skill-*.ts`, `forget-skill-*.ts` (NEW) | 0 | — | (new) MCP add_skill/forget_skill handler+schema | — |
| `tests/integration/skills/write.test.ts` (NEW) | 0 | — | (new) real-pgvector POST/forget round-trip | — |

**theo-cloud** (`/home/paulo/Projetos/usetheo/theo-cloud/theo-cloud`):

| File | LoC | Last commit | Why it exists | Invariants to preserve |
|---|---|---|---|---|
| `internal/themory/client.go` | ~535 | `3841aed` (2026-06-19) | Go client (incl. `ListSkills`) | existing methods unchanged; add `AddSkill`/`ForgetSkill` |
| `internal/routes/memory.go` | ~470 | `3841aed` | SDK handlers (incl. `ListSkills`) | existing unchanged; add `AddSkill`/`ForgetSkill` (namespacing reused) |
| `internal/routes/dashboard_memory.go` | ~290 | `3841aed` | BFF (incl. `ListSkills`) | existing unchanged; add BFF `AddSkill`/`ForgetSkill` |
| `cmd/main.go` | ~830 | `3841aed` | chi routes | existing unchanged; add POST + DELETE (SDK + BFF) |
| `dashboard/src/pages/memory/skills.tsx` | ~175 | `1058696`/`c2bcec3` | read-only Skills tab | add a delete (forget) control + ConfirmDialog; NO create editor |
| `dashboard/src/pages/memory/skills.test.tsx` | — | `1058696` | Skills tab tests | extend; existing stay green |
| `tests/e2e/memory_e2e_test.go` | ~430 | `c3dda36` | gateway↔TheMemory e2e | existing unchanged; add `TestMemoryE2E_SkillsWrite` |

### Current callers / dependents

- `LocalScopedSkillMemory.add` (`scoped-skill-memory.ts:90`): called by `Memory.skills(repoId).add` (SDK), the read cycle's integration tests. Collision currently surfaces a raw `pg` unique-violation (no domain wrapper) — T1.1 wraps it.
- `skillsHandler` (GET) (`handlers/skills.ts`): registered at `app.ts:315`. The POST/DELETE handlers are siblings in the same file.
- MCP `HANDLERS` map (`dispatch.ts:25`): `[REMEMBER, rememberHandler]` etc. — add 2 entries.
- theo-cloud `TheMemoryClient` interface (`memory.go`): add 2 methods; both unit mocks (`fakeTheMemory`, `fakeMemoryClient`) must implement them.

### Domain glossary

- **SkillDraft** — `{ code: string, description: string, codeLanguage: 'typescript'|'javascript' }`; identity = `hashFact(description)`.
- **dedup-collision** — two `add()` with the same `description` collide on `UNIQUE(hash)` (first-write-wins).
- **store-only** — TheMemory stores code-as-skill text; it never executes it.
- **curation** — human deletes a bad skill (forget); does NOT author code.

### Architecture boundaries affected

- `rules/architecture.md § 2 (ADD-only)`: skills are ADD-only; replace = forget+add. The 409-on-collision (D1) upholds this (no silent overwrite).
- `§ 3 (DIP)`: `SkillAlreadyExists` lives in core `errors.ts`; the store throws it; the api maps it. No core→adapter import.
- `§ 9 (Public API)`: new error class + REST/MCP surface — forward-only pre-release additions.

## Prior Art & Related Work

- **Internal blueprint:** `knowledge-base/discoveries/blueprints/skills-write-surface-blueprint.md` (D1 409, D2 store-only, D3 MCP, decision matrix, Letta cross-cutting comparison).
- **Reference (rejected prior art):** `.claude/knowledge-base/references/letta/letta/services/tool_manager.py:50,211` — Letta couples authoring to a modal sandbox; we reject the sandbox (store-only).
- **Internal precedent:** `knowledge-base/plans/dashboard-phase2b-skills-browse-plan.md` (read cycle — established the entire plumbing: client triad, BFF, namespacing, RequireScope, OpenAPI, e2e harness, dashboard tab).

## Objective

- [ ] Sub-goal 1 — `SkillAlreadyExists` domain error; `add()` throws it on dedup-collision (instead of raw PG error).
- [ ] Sub-goal 2 — REST `POST /v1/scopes/skill/:repoId/skills` (201 / 409 / 422 / 413) + `DELETE /v1/scopes/skill/:repoId/skills/:skillId` (204 / 404), OpenAPI-registered, against real pgvector.
- [ ] Sub-goal 3 — MCP `add_skill` + `forget_skill` tools (static list, `listChanged:false`).
- [ ] Sub-goal 4 — theo-cloud client `AddSkill`/`ForgetSkill` + SDK (`memory:write`/`memory:delete`) + BFF, repoId-namespaced (D3).
- [ ] Sub-goal 5 — dashboard delete-curation control on the Skills tab (ConfirmDialog); NO code editor.
- [ ] Sub-goal 6 — e2e `TestMemoryE2E_SkillsWrite` (add→list→forget through the gateway).

## ADRs

### D1 — Dedup-collision → 409 via a `SkillAlreadyExists` domain wrapper

- **Decision:** `LocalScopedSkillMemory.add` catches the Postgres unique-violation (code `23505` on the hash index) and throws a new `SkillAlreadyExists` domain error; the REST handler maps it → **409 SKILL_ALREADY_EXISTS**; MCP maps it → a typed tool error.
- **Rationale:** the raw PG error leaking to a 500 is dishonest + un-typed. 409 (first-write-wins) tells the caller the description collided; replace = forget+add (ADD-only, `architecture.md § 2`).
- **Alternatives:** (a) 200-idempotent — REJECTED (silent code drop when codes differ); (b) upsert/overwrite (Letta last-write-wins) — REJECTED (ADD-only; loses provenance); (c) catch PG code in the handler without a domain wrapper — REJECTED (leaks pg-error coupling into the api layer; the store owns its error taxonomy).
- **Consequences:** one new error class; `add()` gains a try/catch around the insert. Backward-compatible (callers that never collide see no change).

### D2 — Store-only; NO executor / sandbox / UI code editor

- **Decision:** the write surface stores code-as-skill; it never executes. The dashboard gets a **delete (forget)** control only — NOT a create/edit code form.
- **Rationale:** CLAUDE.md Amendment II security line; skills execute in the consuming agent's runtime. Authoring of code is for the agent (REST/MCP); the human curates.
- **Alternatives:** (a) UI code editor + create — REJECTED (RCE surface, contradicts agent-autonomy thesis, per 2026-06-19 design discussion); (b) executor/sandbox (Letta modal) — REJECTED (out of scope, heavy deps).
- **Consequences:** dashboard write = delete only; create is REST/MCP (agent path).

### D3 — MCP adds `add_skill` + `forget_skill` to the static list

- **Decision:** extend the static MCP tool list (`list-handler.ts`) with `add_skill` + `forget_skill`; keep `listChanged:false`.
- **Rationale:** mirrors the 4-verb static shape (ADR D2 of v0.3); dynamic registration is YAGNI.
- **Alternatives:** dynamic registration — REJECTED (contract churn, YAGNI).
- **Consequences:** the "4 locked tools" descriptor grows to 6; pre-release acceptable; note in locked-names.

### D4 — Skill forget REST is a scoped sub-resource DELETE

- **Decision:** `DELETE /v1/scopes/skill/:repoId/skills/:skillId` (calls `memory.skills(repoId).forget(skillId)`), NOT the existing top-level `POST /v1/forget` (which is for memories via `Memory.forget`).
- **Rationale:** skill forget is scope-isolated (`skills(repoId).forget` rejects cross-repo with `MemoryNotFound`); a dedicated sub-resource keeps the scoping explicit + RESTful.
- **Alternatives:** reuse `POST /v1/forget` — REJECTED (that path is `Memory.forget(memoryId)`, not skill-scoped; would bypass the repo guard).
- **Consequences:** new DELETE route; 404 on cross-repo/non-existent (maps `MemoryNotFound`).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Storing arbitrary code text is a data-sensitivity surface | Medium | store-only (never executed); workspace + D3 namespacing isolate it to the owning customer; code size cap (DOS) | core/gateway |
| `add()` try/catch around insert could mask a non-collision PG error | Medium | only map the specific unique-violation (code `23505` on the hash constraint) → 409; re-throw anything else | core |
| MCP static list grows (contract change) | Low | pre-release; documented in locked-names; `listChanged:false` preserved | mcp |
| Cross-repo merge order (theo-cloud e2e needs the new themory image) | Medium | theo-memory merges + image rebuilds first (mirrors read cycle); `make e2e` builds from source | both |

## Unresolved Questions

- Q1 — code size cap value: 64 KiB proposed (mirrors remember's 1 MiB body limit but tighter for code). Confirm at implement; adjustable.
- Q2 — should the dashboard also allow editing the *description* (not code)? Plan ships delete-only curation; description-edit deferred unless `/edge-case-plan` flags it (it's forget+add under the hood given hash identity, so "edit" is non-trivial — defer).
- Q3 — MCP `add_skill` error shape for collision: a typed tool error with a clear message; exact MCP error code confirmed at implement.

## Dependencies

**(none — zero new dependencies; STORE-only per D2.)** Reuses `pg`/`zod`/`@hono/zod-openapi` (theo-memory) + `chi/v5`/`pgx` (theo-cloud), all present. D2 explicitly REJECTS any sandbox/executor dep (e2b/modal — the Letta delta). No new package introduced/used/removed → no Rule 9 eval / CVE audit needed.

## Dependency Graph

```
Phase 1 (core: SkillAlreadyExists + add catch) ──▶ Phase 2 (theo-memory REST POST/DELETE + MCP)
                                                          │
                                                          ▼
                                              [MERGE + image rebuild theo-memory]
                                                          │
                                                          ▼
Phase 3 (theo-cloud client+SDK+BFF) ──▶ Phase 4 (dashboard delete curation)
                                                          │
                                                          ▼
                                              Phase 5 (Integration Validation: e2e)
```

---

## Phase 1: core — `SkillAlreadyExists` + collision wrapping

### T1.1 — Add `SkillAlreadyExists` error + catch unique-violation in `add()`

#### Objective
Map the dedup-collision to a typed domain error so the REST/MCP layer can return 409.

#### Why this step (action + reasoning)
1. **What:** add `SkillAlreadyExists extends Error` in `errors.ts`; wrap `insertSkill` in `LocalScopedSkillMemory.add` with a try/catch that detects the Postgres unique-violation (code `23505`) on the hash index and throws `SkillAlreadyExists` (re-throwing any other error).
2. **Why now:** D1 — without a typed error, the REST POST (Phase 2) can only 500 on collision (dishonest). This is the foundation the POST handler maps from.

#### Evidence
- `packages/core/src/infrastructure/db/scoped-skill-memory.ts:96-101` — collision on `UNIQUE(hash)` (raw PG today).
- `packages/core/src/domain/errors.ts:344` — `InvalidSkillError` pattern to mirror.

#### Files to edit
```
packages/core/src/domain/errors.ts — add SkillAlreadyExists
packages/core/src/infrastructure/db/scoped-skill-memory.ts — try/catch in add() → SkillAlreadyExists
packages/core/src/infrastructure/db/scoped-skill-memory.test.ts — RED tests (collision → SkillAlreadyExists)
```

#### Deep file dependency analysis
- `errors.ts`: add-only export; the barrel re-exports it (verify `@usetheo/memory/contract` surfaces it for the api layer to catch).
- `add()`: the catch must inspect the pg error `code === '23505'` (or constraint name contains the hash index); ONLY then throw `SkillAlreadyExists`; else re-throw. The in-memory store throws a different shape on collision — the test covers both via the real-pgvector integration (T2.4) + an in-memory unit where feasible.

#### Deep Dives
- **Signature:** `class SkillAlreadyExists extends Error { readonly name='SkillAlreadyExists'; readonly hash: string; readonly repoId: string }`.
- **Detection (EC-W1 MUST FIX):** `pg` errors carry `.code`; unique-violation = `'23505'`. Guard on `e.code === '23505' && (e.constraint?.includes('hash') ?? true)` so a FUTURE second unique index never gets mis-mapped to 409; re-throw anything else. Today `memories_hash_scope_unique_idx` is the only unique index hit on a skill insert, so behavior is correct now; the constraint guard future-proofs it.
- **Invariant:** ADD-only preserved — no overwrite; the existing row stays.
- **Edge:** the in-memory store (tests) may throw a generic Error on duplicate hash — T1.1 unit asserts against the real path via integration (T2.4); the unit may assert the catch logic with a stubbed throwing store.

#### Pseudo-code / Signatures
```pseudocode
async add(draft):
  ...
  try:
    id = await vectorStore.insertSkill({...})
  catch e:
    if isUniqueViolation(e):  // e.code === '23505'
      throw new SkillAlreadyExists(hash, this.scope.repoId)
    throw e
  return {...}
```

#### Tasks
1. Add `SkillAlreadyExists` to `errors.ts` + export via the contract barrel.
2. Wrap `add()` insert with the 23505→SkillAlreadyExists catch.
3. RED unit: a stubbed store throwing `{code:'23505'}` → `add()` throws `SkillAlreadyExists`; a non-23505 error re-throws unchanged.

#### TDD
```
RED:     add() throws SkillAlreadyExists when the store insert raises a unique-violation (code 23505)
RED:     add() re-throws a non-unique-violation store error unchanged (no masking)
GREEN:   add SkillAlreadyExists + the catch
REFACTOR: extract isUniqueViolation helper if reused — else None
VERIFY:  npx vitest run --config vitest.contract.config.ts packages/core/src/infrastructure/db/scoped-skill-memory.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `SkillAlreadyExists` exported from the contract barrel.
- [ ] `add()` throws it on 23505, re-throws otherwise — `pnpm test` green.
- [ ] Pass: coverage ≥ 90% changed files; lint zero; file ≤ 500 LoC — verified by `pnpm test`.

#### DoD
- [ ] RED→GREEN; `pnpm test` (contract + typecheck) green; CHANGELOG `[Unreleased] § Added` updated.

---

## Phase 2: theo-memory REST (POST + DELETE) + MCP

### T2.1 — REST `POST /v1/scopes/skill/:repoId/skills`

#### Objective
Create a skill via REST; 201 on success, 409 collision, 422 validation, 413 oversize.

#### Why this step (action + reasoning)
1. **What:** add `postSkillHandler` in `handlers/skills.ts`; zod body `{code, description, codeLanguage}`; resolve via `workspaceBoundMemory(c,memory).skills(repoId).add(draft)`; map `InvalidSkillError`→422, `SkillAlreadyExists`→409, oversize→413; register route + OpenAPI.
2. **Why now:** D1+D2 — the agent's REST authoring path; the core error mapping (T1.1) is ready.

#### Evidence
- `packages/api/src/server/handlers/skills.ts` (existing GET handler — reuse `workspaceBoundMemory` + repoId guard).
- `packages/api/src/server/handlers/remember.ts` — body-parse + zod + error-map precedent.

#### Files to edit
```
packages/api/src/server/handlers/skills.ts — add postSkillHandler
packages/api/src/server/app.ts — register POST /v1/scopes/skill/:repoId/skills
packages/api/src/server/openapi-registration.ts — register POST
packages/api/src/server/__tests__/skills.test.ts — RED tests
```

#### Deep file dependency analysis
- `postSkillHandler` reads `repoId` param (reject empty 400) + JSON body (zod). `codeLanguage` zod enum `['typescript','javascript']` → 422 on miss. `code` length cap (`MAX_SKILL_CODE_BYTES` 64 KiB) → 413. Empty description → 422 (zod min(1), also `InvalidSkillError`). On `add`: success→201 `{id,hash}`; `SkillAlreadyExists`→409; `InvalidSkillError`→422.

#### Deep Dives
- **zod body:** `z.object({ code: z.string().min(1).max(MAX), description: z.string().min(1), codeLanguage: z.enum(['typescript','javascript']) }).strict()`.
- **Mapping:** try `add` → catch `SkillAlreadyExists`→409, `InvalidSkillError`→422.
- **Invariant:** workspace-bound + namespaced (parity with GET); ADD-only.

#### Pseudo-code / Signatures
```pseudocode
POST /v1/scopes/skill/:repoId/skills  body {code,description,codeLanguage}
  repoId empty -> 400; body invalid -> 422; code>MAX -> 413
  try: s = await wsBound(memory).skills(repoId).add(body) -> 201 {id:s.id, hash:s.hash}
  catch SkillAlreadyExists -> 409 SKILL_ALREADY_EXISTS
  catch InvalidSkillError -> 422
```

#### Tasks
1. `postSkillHandler` + zod + size cap + error map.
2. Register route + OpenAPI.
3. RED: 201 happy; 409 duplicate; 422 bad language / empty desc; 413 oversize; 400 empty repoId; workspace-bound resolution.

#### TDD
```
RED:     POST returns 201 {id,hash} on a valid SkillDraft (stubbed add)
RED:     POST returns 409 when add throws SkillAlreadyExists
RED:     POST returns 422 on invalid codeLanguage and on empty description
RED:     POST returns 413 when code exceeds MAX_SKILL_CODE_BYTES
RED:     POST returns 400 on empty repoId; resolves via workspaceBoundMemory (EC-1 parity)
RED:     OpenAPI documents POST /v1/scopes/skill/{repoId}/skills
GREEN:   implement handler + route + OpenAPI
REFACTOR: share the SkillDraft zod + DTO with the GET handler if clean — else None
VERIFY:  pnpm --filter @usetheo/memory-api test
```

#### Concurrency tests
(none — single-threaded)
Concurrent duplicate POSTs are arbitrated by the DB UNIQUE(hash) constraint; asserted in T2.4 (EC-W2).

#### Acceptance Criteria
- [ ] 201/409/422/413/400 all correct — `pnpm --filter @usetheo/memory-api test` green.
- [ ] OpenAPI registers POST; `openapi.test.ts` green.
- [ ] Pass: coverage ≥ 90%; lint zero; file ≤ 500 LoC — verified by `pnpm --filter @usetheo/memory-api test`.

#### DoD
- [ ] RED→GREEN; CHANGELOG updated.

### T2.2 — REST `DELETE /v1/scopes/skill/:repoId/skills/:skillId`

#### Objective
Forget (delete) a skill via REST; 204 success, 404 cross-repo/non-existent.

#### Why this step (action + reasoning)
1. **What:** add `deleteSkillHandler`; calls `workspaceBoundMemory(c,memory).skills(repoId).forget(skillId)`; map `MemoryNotFound`→404; 204 on success.
2. **Why now:** D4 — the curation path the dashboard (Phase 4) + agents call.

#### Evidence
- `scoped-skill-memory.ts:175` — `forget(skillId)` rejects cross-repo with `MemoryNotFound`.
- `handlers/forget.ts` — error-map precedent.

#### Files to edit
```
packages/api/src/server/handlers/skills.ts — add deleteSkillHandler
packages/api/src/server/app.ts — register DELETE
packages/api/src/server/openapi-registration.ts — register DELETE
packages/api/src/server/__tests__/skills.test.ts — RED tests
```

#### Deep file dependency analysis
- `deleteSkillHandler`: repoId + skillId params (reject empty); `forget` → 204; `MemoryNotFound`→404. Workspace-bound.

#### Deep Dives
- **Invariant:** scope-isolated forget (repo A cannot delete repo B's skill → 404). 204 No Content on success.

#### Pseudo-code / Signatures
```pseudocode
DELETE /v1/scopes/skill/:repoId/skills/:skillId
  try: await wsBound(memory).skills(repoId).forget(skillId) -> 204
  catch MemoryNotFound -> 404
```

#### Tasks
1. `deleteSkillHandler` + error map.
2. Register route + OpenAPI.
3. RED: 204 success; 404 cross-repo/non-existent; 400 empty params.

#### TDD
```
RED:     DELETE returns 204 when forget succeeds (stubbed)
RED:     DELETE returns 404 when forget throws MemoryNotFound (cross-repo/non-existent)
RED:     OpenAPI documents DELETE /v1/scopes/skill/{repoId}/skills/{skillId}
GREEN:   implement handler + route + OpenAPI
REFACTOR: None expected
VERIFY:  pnpm --filter @usetheo/memory-api test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] 204/404 correct; OpenAPI registered — `pnpm --filter @usetheo/memory-api test` green.
- [ ] Pass: coverage ≥ 90%; lint zero — verified by `pnpm test`.

#### DoD
- [ ] RED→GREEN; CHANGELOG updated.

### T2.3 — MCP `add_skill` + `forget_skill` tools

#### Objective
Expose authoring + curation over MCP (the agent path).

#### Why this step (action + reasoning)
1. **What:** add schema + handler modules for `add_skill` (`{repoId,code,description,codeLanguage}`→`memory.skills(repoId).add`) and `forget_skill` (`{repoId,skillId}`→`forget`); register in `dispatch.ts` HANDLERS + `list-handler.ts` static list.
2. **Why now:** D3 — the canonical Voyager flow (agent authors via MCP).

#### Evidence
- `packages/mcp/src/tools/dispatch.ts:25` (HANDLERS map), `remember-handler.ts` + `forget-handler.ts` (mirror), `list-handler.ts:4-8` (static list).

#### Files to edit
```
packages/mcp/src/tools/add-skill-schema.ts (NEW)
packages/mcp/src/tools/add-skill-handler.ts (NEW)
packages/mcp/src/tools/forget-skill-schema.ts (NEW)
packages/mcp/src/tools/forget-skill-handler.ts (NEW)
packages/mcp/src/tools/dispatch.ts — register 2 handlers
packages/mcp/src/tools/list-handler.ts — add 2 tools to static list
packages/mcp/src/tools/handlers.test.ts + list-handler.test.ts — RED tests
```

#### Deep file dependency analysis
- Mirror `remember-handler` (schema TOOL_NAME + INPUT_SCHEMA + handler calling the scoped op). `add_skill` collision → typed MCP error. `listChanged:false` preserved; static list grows to 6.

#### Deep Dives
- **add_skill input:** `{repoId, code, description, codeLanguage}`; calls `memory.skills(repoId).add`; SkillAlreadyExists → tool error content.
- **forget_skill input:** `{repoId, skillId}`; calls `forget`; MemoryNotFound → tool error.

#### Pseudo-code / Signatures
```pseudocode
add_skill(repoId,code,description,codeLanguage) -> memory.skills(repoId).add(draft) -> {id,hash}
forget_skill(repoId,skillId) -> memory.skills(repoId).forget(skillId) -> ok
```

#### Tasks
1. 4 new modules (2 schema + 2 handler).
2. Register in dispatch + list-handler.
3. RED: tools/list contains add_skill+forget_skill; add_skill add round-trip (stub); collision→error; forget_skill happy + MemoryNotFound→error.

#### TDD
```
RED:     tools/list returns add_skill + forget_skill (static list = 6)
RED:     add_skill calls memory.skills(repoId).add and returns {id,hash}
RED:     add_skill surfaces a typed error on SkillAlreadyExists
RED:     forget_skill calls forget; surfaces typed error on MemoryNotFound
GREEN:   implement schemas + handlers + dispatch + list registration
REFACTOR: None expected
VERIFY:  pnpm --filter @usetheo/memory-mcp test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] tools/list = 6 tools (incl. add_skill/forget_skill); both dispatch + execute; typed errors on collision/not-found — `pnpm --filter @usetheo/memory-mcp test` green.
- [ ] `listChanged:false` preserved.
- [ ] Pass: coverage ≥ 90%; lint zero — verified by `pnpm test`.

#### DoD
- [ ] RED→GREEN; CHANGELOG updated; locked-names note for the MCP tool-set growth.

### T2.4 — Integration test (real pgvector): POST → getAll → 409 → DELETE

#### Objective
Prove the write surface against real `ankane/pgvector:v0.5.1`.

#### Why this step (action + reasoning)
1. **What:** integration test: POST a skill → `getAll` shows it; POST same description → 409; DELETE → `getAll` no longer shows it; cross-repo DELETE → 404.
2. **Why now:** wiring pillar (b) — the real-boundary proof (collision is a real DB constraint, only provable against pgvector).

#### Evidence
- `tests/integration/skills/listing.test.ts` (read-cycle harness to mirror).

#### Files to edit
```
tests/integration/skills/write.test.ts (NEW)
```

#### Deep Dives
- Use `createServer({memory})` over the real pool (or the SDK directly for add + the handler for POST). Assert 201/409/204 + getAll reflects each step + cross-repo 404.

#### Tasks
1. Write the real-pgvector POST/forget round-trip + 409 collision + cross-repo 404.

#### TDD
```
RED:     integration: POST skill -> getAll returns it; POST same description -> 409; DELETE -> getAll empty; cross-repo DELETE -> 404
RED:     EC-W2: two concurrent identical POSTs -> exactly one 201 and one 409 (DB UNIQUE(hash) arbiter; no double-insert)
RED:     EC-W3: DELETE of a non-skill memory-id (kind != skill) or another repo's skillId -> 404 (scoped-forget guard)
GREEN:   (satisfied by T1.1+T2.1+T2.2 against the real store)
REFACTOR: None expected
VERIFY:  pnpm test:integration (real ankane/pgvector:v0.5.1)
```

#### Concurrency tests
A `concurrent test` (EC-W2): two parallel POSTs of the same description via `Promise.all` — a happens-before observation on the `UNIQUE(hash)` DB constraint asserting exactly one 201 + one 409 (no lost-update / double-insert). This is the race-aware test for the write path.

#### Acceptance Criteria
- [ ] Integration green: add→list→409→delete→404 against real pgvector — `pnpm test:integration` green.
- [ ] EC-W2 concurrent-duplicate-POST → exactly one 201 + one 409 — test `concurrent duplicate post` green.

#### DoD
- [ ] `pnpm test:integration` green; wiring pillar (b) satisfied.

---

## Phase 3: theo-cloud gateway — client + SDK + BFF

### T3.1 — `Client.AddSkill` + `Client.ForgetSkill` (client.go)

#### Objective
Go client methods for POST + DELETE, transport-only (namespacing done by the handler).

#### Why this step (action + reasoning)
1. **What:** `AddSkill(ctx, repoID, draft)` (POST) + `ForgetSkill(ctx, repoID, skillID)` (DELETE), `url.PathEscape` the (already-namespaced) repoId; parse 409/404 into typed errors.
2. **Why now:** lowest layer the SDK/BFF handlers delegate to.

#### Evidence
- `internal/themory/client.go` `ListSkills` (transport pattern), `do()` helper.

#### Files to edit
```
internal/themory/client.go — AddSkill, ForgetSkill, SkillDraft struct, error sentinels (ErrSkillConflict)
tests/unit/themory_client_test.go — RED tests
```

#### Deep Dives
- `AddSkill` POSTs `{code,description,codeLanguage}`; 201→parse {id,hash}; 409→`ErrSkillConflict`; 422→error. `ForgetSkill` DELETE; 204→nil; 404→`ErrNotFound` (reuse existing sentinel).

#### Tasks
1. Structs + 2 methods + 409 sentinel.
2. RED: AddSkill path+body+409 mapping; ForgetSkill path+204+404.

#### TDD
```
RED:     AddSkill POSTs /v1/scopes/skill/{repoId}/skills with the draft; parses {id,hash}
RED:     AddSkill maps 409 -> ErrSkillConflict
RED:     ForgetSkill DELETEs /v1/scopes/skill/{repoId}/skills/{skillId}; 204 -> nil; 404 -> ErrNotFound
GREEN:   implement
VERIFY:  go test ./internal/themory/...
```

#### Concurrency tests
(none — single-threaded)
The client is request-scoped.

#### Acceptance Criteria
- [ ] Both methods correct path/body/status mapping; existing methods unchanged — `go test ./internal/themory/...` green.

#### DoD
- [ ] `go test ./internal/themory/...` green; CHANGELOG (theo-cloud).

### T3.2 — SDK handlers `AddSkill` (memory:write) + `ForgetSkill` (memory:delete) + routes

#### Objective
Gateway SDK surface with D3 namespacing + scope gating.

#### Why this step (action + reasoning)
1. **What:** `MemoryHandler.AddSkill` (POST `/v1/memory/skills`, `memory:write`) + `ForgetSkill` (DELETE `/v1/memory/skills/{skillID}?repoId=`, `memory:delete`); both namespace `{subject}:{repoId}` (D3) + reject empty/`:` repoId; map 409/404. Register in main.go + extend `TheMemoryClient` interface + both unit mocks.
2. **Why now:** the scope-gated SDK path the BFF delegates to.

#### Evidence
- `internal/routes/memory.go` `ListSkills` (namespacing + guard pattern); `cmd/main.go` route group.

#### Files to edit
```
internal/routes/memory.go — AddSkill, ForgetSkill, interface +2
cmd/main.go — register POST + DELETE under /v1/memory
tests/unit/memory_handlers_test.go — RED tests (+ fakeTheMemory +2 methods)
tests/unit/dashboard_memory_test.go — fakeMemoryClient +2 methods (compile)
```

#### Deep Dives
- Namespacing identical to `ListSkills` (`{subject}:{repoId}`, reject `:` in bare repoId). AddSkill body = SkillDraft; 201/409/422. ForgetSkill 204/404.

#### Tasks
1. 2 handlers + interface + mocks.
2. Register routes (POST memory:write, DELETE memory:delete).
3. RED: 401/400/namespacing/409/404 + scope gating.

#### TDD
```
RED:     AddSkill 401 unauth; 400 empty/':' repoId; namespaces {subject}:{repoId}; 409 on conflict; 201 happy
RED:     ForgetSkill 204 happy; 404 not-found; namespaces repoId
GREEN:   implement + register + mocks
VERIFY:  go test ./internal/routes/... ; go build ./...
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Both handlers gated (memory:write / memory:delete), namespaced (D3), correct status maps; existing routes unchanged — `go test ./internal/routes/...` green.

#### DoD
- [ ] `go test ./...` + `go build ./...` green.

### T3.3 — BFF `AddSkill` + `ForgetSkill` (mint→delegate) + routes

#### Objective
Browser-facing BFF for the dashboard curation (delete) — and add (if the dashboard ever needs it; primarily delete per D2).

#### Why this step (action + reasoning)
1. **What:** `DashboardMemoryHandler.ForgetSkill` (+ `AddSkill` for completeness) mint→delegate; register BFF routes.
2. **Why now:** the dashboard delete control (Phase 4) is JWT/browser-trust → BFF only.

#### Evidence
- `internal/routes/dashboard_memory.go` `ListSkills` (mint→delegate pattern).

#### Files to edit
```
internal/routes/dashboard_memory.go — ForgetSkill (+ AddSkill) proxies
cmd/main.go — register BFF DELETE (+ POST)
tests/unit/dashboard_memory_test.go — RED tests
```

#### Deep Dives
- Pure proxies: `mintOrFail` → delegate to `MemoryHandler.ForgetSkill`/`AddSkill`.

#### Tasks
1. BFF proxies + routes.
2. RED: mint-fail short-circuits; mint-success delegates.

#### TDD
```
RED:     BFF ForgetSkill mints then delegates; mint failure short-circuits (no delegation)
GREEN:   implement + register
VERIFY:  go test ./internal/routes/... ; go build ./...
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] BFF delete (+ add) mint→delegate; routes registered — `go test ./internal/routes/...` green.

#### DoD
- [ ] `go test ./...` green; CHANGELOG (theo-cloud).

---

## Phase 4: dashboard — delete (forget) curation on the Skills tab

### T4.1 — Delete-skill control + ConfirmDialog (NO code editor)

#### Objective
Let a human delete a bad skill from the Skills tab; no create/edit code form (D2).

#### Why this step (action + reasoning)
1. **What:** add a trash/delete action per skill row → ConfirmDialog → `DELETE /v1/dashboard/memory/skills/{skillId}?repoId=`; refetch on success. NO create form.
2. **Why now:** D2 — UI curates (delete), agent authors (REST/MCP).

#### Evidence
- `dashboard/src/pages/memory/skills.tsx` (read tab), `entities.tsx` (ConfirmDialog cascade-delete precedent).

#### Files to edit
```
dashboard/src/pages/memory/skills.tsx — add delete action column + ConfirmDialog + mutation
dashboard/src/pages/memory/skills.test.tsx — RED tests
```

#### Deep Dives
- DataTable gains an actions column (trash icon) → ConfirmDialog (confirmationPhrase = skill hash/description) → `cloudFetch(DELETE)` → invalidate the skills query. NO create button/editor.

#### Pseudo-code / Signatures
```pseudocode
onDelete(skill): confirm -> cloudFetch(`/v1/dashboard/memory/skills/${skill.id}?repoId=${repoId}`, {method:'DELETE'}) -> refetch
```

#### Tasks
1. Add delete action + ConfirmDialog + react-query mutation.
2. RED: delete button present; confirm → DELETE called with right path; success refetches; NO create/edit control present (D2 guard).

#### TDD
```
RED:     each skill row has a delete control; clicking → ConfirmDialog
RED:     confirming calls DELETE /v1/dashboard/memory/skills/{id}?repoId=... then refetches
RED:     NO create/edit code form is rendered (D2 read+curate only)
GREEN:   implement
VERIFY:  (dashboard vitest)
```

#### Concurrency tests
(none — single-threaded)
UI rendering is single-threaded.

#### Acceptance Criteria
- [ ] Delete curation works (ConfirmDialog → DELETE → refetch); NO code editor; existing read behavior unchanged — `skills.test.tsx` green.
- [ ] Lint/typecheck clean — `go build ./...` + frontend build clean.

#### DoD
- [ ] Dashboard tests green; CHANGELOG (theo-cloud).

---

## Phase 5: Integration Validation (MANDATORY)

### T5.1 — e2e `TestMemoryE2E_SkillsWrite`

#### Objective
Round-trip the write surface through the gateway → TheMemory.

#### Why this step (action + reasoning)
1. **What:** e2e: `POST /v1/memory/skills` (subject A) → `GET /v1/memory/skills` shows it → `DELETE` → GET no longer shows it; duplicate POST → 409; subject B cannot delete A's skill (404, D3 isolation).
2. **Why now:** wiring pillar (b)+(c) across repos; proves namespacing + the full write path.

#### Evidence
- `tests/e2e/memory_e2e_test.go` `TestMemoryE2E_SkillsBrowse` (harness to mirror; replaces the SQL seed with a real POST).

#### Files to edit
```
tests/e2e/memory_e2e_test.go — add TestMemoryE2E_SkillsWrite
```

#### Deep Dives
- Now skills can be created via the gateway (no SQL seed needed) — the test POSTs, lists, deletes, asserts 409 on dup, and cross-customer isolation on delete.

#### Tasks
1. Add the e2e (POST→list→delete + 409 + cross-customer 404).
2. `make e2e` clean.

#### TDD
```
RED:     TestMemoryE2E_SkillsWrite — A POSTs a skill, sees it, deletes it; dup POST -> 409; B cannot delete A's skill (404)
GREEN:   (satisfied by Phases 1-3)
VERIFY:  make e2e
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `make e2e` green incl. `TestMemoryE2E_SkillsWrite` (round-trip + 409 + D3 isolation).

#### DoD
- [ ] `make e2e` EXIT=0.

### Execution

theo-memory: `pnpm test` + `pnpm test:integration` + `pnpm --filter @usetheo/memory-api test` + `pnpm --filter @usetheo/memory-mcp test`.
theo-cloud: `go build ./...` + `go test ./internal/...` + `make e2e`.

### Acceptance Criteria
- [ ] All suites green; coverage ≥ 90% changed files; zero type/lint errors both repos; D3 isolation proven by e2e.

### If Validation Fails
1. Separate plan-caused vs pre-existing. 2. Fix plan-caused; re-run. 3. Log pre-existing in PR.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Collision returns raw PG 500 (dishonest) | T1.1 | `SkillAlreadyExists` + catch → 409 (D1) |
| 2 | No REST create for skills | T2.1 | `POST /v1/scopes/skill/:repoId/skills` (201/409/422/413) |
| 3 | No REST delete for skills (scoped) | T2.2 | `DELETE .../skills/:skillId` (204/404, D4) |
| 4 | No MCP authoring/curation | T2.3 | `add_skill` + `forget_skill` (D3) |
| 5 | No real-boundary write proof | T2.4 | integration POST→getAll→409→DELETE |
| 6 | Gateway has no skill write client | T3.1 | `Client.AddSkill`/`ForgetSkill` |
| 7 | Gateway has no skill write SDK route + isolation | T3.2 | `MemoryHandler.AddSkill`/`ForgetSkill` + D3 namespacing + scope gating |
| 8 | Gateway has no browser-facing skill write | T3.3 | BFF `ForgetSkill` (+ AddSkill) mint→delegate |
| 9 | Dashboard cannot curate skills | T4.1 | delete control + ConfirmDialog (D2, no editor) |
| 10 | No end-to-end write proof + isolation | T5.1 | e2e `TestMemoryE2E_SkillsWrite` |

**Coverage: 10/10 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed; all suites green (theo-memory `pnpm test` + integration + api + mcp; theo-cloud `go test ./...` + `make e2e`).
- [ ] Zero type/lint errors; file-size budget ≤ 500 LoC.
- [ ] CHANGELOG updated in BOTH repos.
- [ ] Backward compat: existing skill verbs + REST + gateway routes + MCP tools unchanged (add-only).
- [ ] No paper names in `src/**` (Rule 9).
- [ ] D2 store-only honored: NO executor/sandbox/code-editor added; UI = delete curation only.
- [ ] D3 multi-tenant isolation proven by the e2e cross-customer delete leg.
- [ ] Cross-repo merge order: theo-memory (Phases 1-2) merged + image rebuilt BEFORE theo-cloud e2e.
- [ ] **Plan archived** after `/review` READY_TO_MERGE + PRs merged.

## Failure scenarios (when I/O external)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| TheMemory REST (HTTP, from gateway) | upstream 5xx / unreachable | unit mock `Client.AddSkill`/`ForgetSkill` returns error | gateway → 502 `MEMORY_UPSTREAM_UNAVAILABLE` |
| TheMemory REST (HTTP) | upstream 409 (duplicate) | mock returns 409 | client → `ErrSkillConflict`; SDK handler → 409 to caller (honest) |
| postgres:skills (DB, in TheMemory) | UNIQUE(hash) violation on duplicate description | integration POST same description twice | `SkillAlreadyExists` → 409 (T2.4) |
| postgres:skills (DB) | forget of cross-repo/non-existent id | integration DELETE another repo's skillId | `MemoryNotFound` → 404 (T2.4) |
| BFF key mint (vault) | mint fails | unit forces mintOrFail failure | BFF short-circuits, no delegation (T3.3) |

## Final Phase: Integration Validation (MANDATORY)

Covered by Phase 5 (T5.1 + Execution/Acceptance). The plan is NOT done until `pnpm test`, `pnpm test:integration`, `pnpm --filter @usetheo/memory-mcp test`, `go test ./...`, and `make e2e` are all green with the D3 cross-customer delete-isolation leg passing.
