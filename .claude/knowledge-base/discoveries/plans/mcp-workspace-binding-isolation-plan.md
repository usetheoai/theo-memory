# Discovery Plan: MCP workspace-binding isolation (per-request Principal → workspace-scoped Memory)

> **Version 1.1** — Investigates how to make the `themory mcp` tool surface enforce tenant isolation by resolving the authenticated key's `workspace_id` and binding a per-request workspace-scoped `Memory`, mirroring the REST `#77` `workspaceBoundMemory`/`Principal` pattern. Cross-validates the per-request tenant-scoping technique against the two cloned references (`letta`, `mem0`) and confirms the exact internal seam (`AuthVerifier.resolvePrincipal` + `Memory.withWorkspace`, both already shipped). Blueprint output guides the `/to-plan` for the fix tracked in theo-memory#82. **v1.1 absorbs 2 MUST FIX from the edge-case review (`reviews/mcp-workspace-binding-isolation-edge-cases-2026-06-30.md`): EC-1 (no silent passthrough when `withWorkspace` absent in multi-tenant mode) + EC-2 (verifier must be `resolvePrincipal`-capable, else fail closed) — both fold into Q6.**

**Slug:** `mcp-workspace-binding-isolation`
**Owner:** claude-code (operator: usetheodev)
**Created:** 2026-06-30
**Time budget:** 3h (per-project breakdown in ADR D1)

## Context

theo-memory#82 (CRITICAL) proved a live cross-tenant data leak on the MCP tool surface: tenant A's
gateway-minted key read tenant B's memory across DISTINCT workspaces (`tn-8d04a3c948b592d2` vs
`tn-7cf95ef28d588d97`). Root cause confirmed in code:

- `packages/mcp/src/auth/with-bearer-auth.ts:142` — `verify(token)` is **boolean only**; it never resolves a `Principal{workspaceId}`.
- `packages/mcp/src/run-mcp-server.ts:~324` — `memoryFactory: () => memory` serves a single shared, workspace-UNBOUND `Memory` to every request.
- `packages/mcp/src/tools/recall-handler.ts:39` — `memoryFromCtx(getScope(), …)` binds only the `userId` tier, never the workspace.

The REST surface already closed this (theo-memory#77): `packages/api/src/server/auth/middleware.ts:196-212`
resolves a `Principal` via `AuthVerifier.resolvePrincipal` and `packages/api/src/server/handlers/_body-parsing.ts:29`
binds `memory.withWorkspace(principal.workspaceId)`. This discovery confirms the seam and de-risks the MCP fix.

Project rules that any borrowed pattern MUST respect:

- `.claude/rules/error-handling.md` § 2 — fail-fast, typed errors, validate at the boundary (the fix MUST fail closed: no workspace → 401, never a default privileged Memory).
- `.claude/rules/architecture.md` § 2 — DIP: the MCP layer composes `AuthVerifier` + `Memory.withWorkspace` (domain interfaces), never reaches into a concrete store.
- `.claude/rules/testing.md` § 4.1 — both edge AND negative cases (cross-tenant deny is a negative case asserting the specific typed rejection).
- theo-data invariants 1/3/4/5/6 (CWE-441 data-plane contract) — resolve a Principal, never trust the body; per-verb scope; fail closed; prove isolation through the real edge.

## Objective

Produce a blueprint that lets `/to-plan` design the MCP workspace-binding fix with 95% confidence — knowing
the exact composition (`resolvePrincipal` → context → `withWorkspace` per request), the fail-closed contract,
and the e2e isolation proof shape — validated against two independent references.

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated for `letta` and `mem0` per-request scoping technique
- [ ] At least one concrete decision proposal per research question (esp. Q6 — the internal seam)
- [ ] `/discover-confidence` verdict >= SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/letta/` | `letta/letta/server/rest_api/` (dependencies, auth), `letta/tests/managers/` | Letta resolves a per-request `actor` (org/user) from the credential and threads it into server handlers — the closest analog to `resolvePrincipal → workspace binding` |
| `.claude/knowledge-base/references/mem0/` | `mem0/mem0/memory/main.py`, `mem0/openmemory/api/`, `mem0/tests/` | Mem0 threads per-request `user_id`/`agent_id` filters into `add()`/`search()` so the store query is scoped; openmemory adds an HTTP/MCP server auth surface |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/letta/letta/agents/`, `letta/letta/llm_api/` | Agent runtime + LLM providers — unrelated to credential→tenant scoping |
| `.claude/knowledge-base/references/mem0/embedchain/`, `mem0/docs/`, `mem0/cookbooks/` | Embedchain product + marketing docs, not the scoping seam |
| `.claude/knowledge-base/references/*/{build,dist,.venv,node_modules}/` | Build artifacts |
| Any project NOT cloned into `.claude/knowledge-base/references/` | Cross-Project Rule: never claim a feature without reading its source |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** letta: 1.5h, mem0: 1h, internal seam confirmation (Q6, our own code): 0.5h.

**Rationale:** Letta's per-request actor resolution is the closest structural analog to `resolvePrincipal`, so it gets the deepest dive. Mem0 corroborates the "thread the tenant filter into every store op" technique. The internal seam (Q6) reads our OWN code (`packages/`), which is fast — the references exist to cross-validate, not to invent (the seam already ships).

**Alternatives considered:** equal split (rejected — letta is the closer analog); single-project (rejected — two independent references satisfy the ">= 2 sources" cycle rule and reduce single-source bias).

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 consecutive retries with different query variants (pattern → kind-based → alternate path → broader scope), mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue. Do NOT pad with unrelated hotspots.

**Stop condition — per project (mandatory):** When a project's time budget is exhausted with questions pending, mark the remaining BLOCKED with reason "budget exhausted" and continue. If every remaining question is `done` or honestly `blocked`, emit `<promise>BLUEPRINT_BLOCKED</promise>` (never `BLUEPRINT_COMPLETE` from a blocked state).

**Anti-pattern:** NEVER fabricate Fase B answers to close a question whose Fase A was exhausted (Unbreakable Rule 3).

**Consequences:** the halt-loop stops on budget exhaustion; the blueprint surfaces blocked questions explicitly.

### D2 — Investigation depth

**Decision:** Read end-to-end for the per-request scoping seam files (letta `dependencies.py`/`auth`, mem0 `main.py`); Grep/scan-then-Read for tests + deps.

**Rationale:** the scoping seam is the load-bearing technique — it must be read fully to be mirrored correctly. Tests/deps are addressable by targeted grep + spot-Read.

**Consequences:** deeper token spend on 3-4 files; cheaper coverage of tests/deps corners.

### D3 — References are cross-validation, the seam is internal (honesty)

**Decision:** The decisive design answer (Q6) reads our OWN `packages/` code; the references answer Q1-Q5 to cross-validate the TECHNIQUE (per-request credential→tenant→scoped-store).

**Rationale (Unbreakable Rule 3):** the strongest prior art for this fix is internal (REST #77), not the OSS references. Pretending mem0/letta are the primary source would be dishonest. They are legitimate independent corroboration that the "resolve actor from credential, bind it per-request, scope every store op" shape is industry-standard — which raises confidence the internal seam is right.

**Consequences:** Q6 cites `packages/*` paths (allowed; the discover-confidence hard cap checks only `references/` citation existence). Every `references/` citation in Q1-Q5 is pre-verified to exist.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — grep/ast map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does Letta resolve the per-request `actor`/identity from the credential and inject it into server request handlers (the analog of `resolvePrincipal → c.set('principal')`)? | techniques | `.claude/knowledge-base/references/letta/letta/server/rest_api/` | Grep `get_current_user\|get_user_id\|Depends(\|actor` in `letta/letta/server/rest_api/dependencies.py`, `auth/index.py`, `auth_token.py` | Read `dependencies.py` + `auth/index.py` + `auth_token.py` end-to-end; capture how the credential maps to an actor and how handlers receive it | Prose + `references/letta/...:line` per claim: credential→actor resolution + injection mechanism |
| Q2 | How does mem0 thread the per-request `user_id`/`agent_id` scope into `add()`/`search()` so the underlying store query is tenant-scoped (the analog of `withWorkspace` per request)? | techniques | `.claude/knowledge-base/references/mem0/` | Grep `def add\|def search\|_build_filters\|effective_filters\|user_id` in `mem0/mem0/memory/main.py` + `mem0/openmemory/api/main.py` | Read the filter-building + add/search bodies; capture where the tenant scope is applied to the store call | Prose + `references/mem0/...:line`: where/how the per-request scope reaches the store |
| Q3 | How do the references test tenant/org isolation AND auth rejection at the boundary (cross-actor cannot read another's data; missing/invalid credential → reject)? | tests | `.claude/knowledge-base/references/letta/`, `.claude/knowledge-base/references/mem0/` | Grep `def test_\|assert\|401\|403\|organization\|unauthor` in `letta/tests/managers/test_organization_manager.py` + `mem0/tests/test_server_auth.py` | Read the relevant test cases; capture the isolation + negative-case assertion shapes | Table: test name → scenario (isolation / auth-deny) → assertion, with `references/...:line` |
| Q4 | What runtime deps does each reference's per-request scoping/auth path pull in, and does OUR fix need any NEW dependency (or does it reuse the shipped `AuthVerifier.resolvePrincipal` + `Memory.withWorkspace`)? | deps | `.claude/knowledge-base/references/mem0/`, `.claude/knowledge-base/references/letta/` | Grep imports (`fastapi\|Depends\|Header\|jwt`) in `mem0/openmemory/api/main.py` + `letta/letta/server/rest_api/dependencies.py`; cross-check OUR `packages/mcp/package.json` for an existing dep | Read the import blocks; confirm OUR path adds no new dep (reuse existing DIPs) | Dep list per reference + an explicit "OUR fix adds 0 new deps — reuses X, Y" statement with paths |
| Q5 | How do the references run their server/auth tests locally (test command + container), to inform extending OUR hermetic `make e2e-edge` isolation job? | tools | `.claude/knowledge-base/references/mem0/`, `.claude/knowledge-base/references/letta/` | SKIP Fase A (text-shape). Glob `mem0/tests/test_server_auth.py` header + `mem0/Makefile`/`pyproject.toml`; `letta/tests/` runner config | Read the test setup/fixtures + any `Makefile`/`pyproject` test target | Step list: how each ref runs its auth/isolation tests + what OUR e2e-edge MCP assertion should mirror |
| Q6 | What is the EXACT internal seam for OUR fix — do `AuthVerifier.resolvePrincipal(token): Principal\|null` and `Memory.withWorkspace(workspaceId): Memory` compose so the MCP bearer gate can resolve the Principal, put it on the scope context, and bind workspace-then-user-tier per request, failing closed? | techniques | (internal — our `packages/`) | Grep `resolvePrincipal\|withWorkspace\|workspaceBoundMemory\|memoryFromCtx` in `packages/core/src/domain/` + `packages/api/src/server/` + `packages/mcp/src/` | Read `core/src/domain/dip/auth-verifier.ts`, `core/src/domain/memory-store.ts:146`, `api/.../_body-parsing.ts:29`, `mcp/.../with-bearer-auth.ts`, `mcp/.../run-mcp-server.ts`, `mcp/.../recall-handler.ts` | Decision proposal: the exact composition + fail-closed contract + the list of MCP files to change, with `packages/...:line` citations. **MUST ALSO answer (EC-1): when `Memory.withWorkspace` is unavailable in multi-tenant (`requireCredential`) mode, the design FAILS CLOSED (reject) — NEVER the REST optional-chaining passthrough (`_body-parsing.ts:32`) which serves UNBOUND memory; confirm `LocalMemory.withWorkspace` at `core/src/infrastructure/db/local-memory.ts:81` is the concrete impl. MUST ALSO answer (EC-2): the verifier-capability contract — prefer `resolvePrincipal`; a verify-only verifier in multi-tenant mode → reject (no DEFAULT_PRINCIPAL collapse), per `api/.../middleware.ts:105-118`.** |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q3 | Covered |
| Dependencies | Q4 | Covered |
| Tools | Q5 | Covered |
| Techniques | Q1, Q2, Q6 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | every `.claude/knowledge-base/references/{project}/{path}` declared in Fase A exists | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A budget | Fase A returned >= 1 hotspot OR 3 query-variant retries attempted | After 3 retries empty, mark Qx BLOCKED "Fase A exhausted"; continue |
| After answering Qx | blueprint section under Qx has >= 1 citation (`references/...` for Q1-Q5; `packages/...` for Q6) | Re-iterate Qx (1 retry max) |
| Mid-loop sanity | total `references/` citations >= 1 per 200 words of Q1-Q5 prose | Add citations to under-cited paragraphs (1 retry max) |
| Per-project time budget | project budget not exhausted | When exhausted, mark remaining Qx BLOCKED "budget exhausted"; advance |
| Before promising complete | all 4 coverage corners have populated sections + Q6 yields a concrete file-change list | Refuse promise, continue |
| EC-3 (Q1) — letta auth may be stubbed in OSS | when reading letta auth, capture the injection SHAPE (`Depends(...)` threading the actor) not the (possibly stubbed) credential validation | record the injection mechanism; note the stub honestly |
| EC-4 (Q2) — mem0 scoping may live in `storage.py` | if `mem0/mem0/memory/main.py` lacks where the filter reaches the store, fall back to `grep _build_filters\|effective_filters mem0/mem0/memory/storage.py` | follow the fallback before marking Q2 done |
| EC-5 (Q5) — mem0 `Makefile` may be absent | if `mem0/Makefile` absent, read `mem0/pyproject.toml` test config + `test_server_auth.py` header for the run command | use the fallback path |

## Acceptance Criteria

- [ ] All 6 research questions answered OR explicitly BLOCKED with reason
- [ ] Every Q1-Q5 claim cites a real `.claude/knowledge-base/references/` path:line
- [ ] Q6 yields a concrete decision: the composition (`resolvePrincipal` → context → `withWorkspace`), the fail-closed contract, and the exact list of MCP files to change
- [ ] Cross-cutting comparison table (letta vs mem0 per-request scoping) populated
- [ ] All 4 coverage corners have populated blueprint sections
- [ ] `/discover-confidence` verdict >= SHIPPABLE_WITH_CAVEATS

## Global Definition of Done

- Blueprint at `.claude/knowledge-base/discoveries/blueprints/mcp-workspace-binding-isolation-blueprint.md`
- `/discover-confidence` >= SHIPPABLE_WITH_CAVEATS per `.claude/rules/discover-blueprint-golden-rule.md`
- Zero fabricated citations (all `references/` paths resolve via `Path.exists()`)
- The blueprint's recommendation is directly consumable by `/to-plan mcp-workspace-binding-isolation`
