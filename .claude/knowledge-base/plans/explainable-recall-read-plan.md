---
slug: explainable-recall-read
created_at: 2026-07-20
goal: Expose the accountable-forgetting recall trace for reading (recall_id + workspace-scoped REST GET).
---

# Plan: Explainable Recall — Read Surface (S2)

> **Version 1.0** — S1 (shipped) PERSISTS the negative-space of recall: every dropped candidate gets a `recall_traces` row keyed by a server-minted `recall_id`. S1 exposes NOTHING for reading — the `recall_id` is minted deep inside the pipeline and never surfaced, and no endpoint reads the traces. S2 closes the loop that makes "accountable forgetting" a real product feature: thread the `recall_id` out as an opt-in `RecallOptions` INPUT (so the SDK `recall()` bare-array return stays byte-unchanged per the S1 D1 invariant), have the REST recall handler mint + return it in the response envelope, and add a **workspace-scoped** REST `GET /v1/recall-traces/:recallId` that returns the dropped candidates with their score breakdown. Read-only; no dashboard, no MCP, no retention/governance (S3).

## Goal

> "Enable operators to read WHY a recall dropped each candidate by threading `recall_id` as an opt-in `RecallOptions` input and adding a workspace-scoped REST `GET /v1/recall-traces/:recallId`, measured by an integration test where a REST recall returns a `recall_id` and `GET /v1/recall-traces/{that id}` returns the dropped candidates with their breakdown, while another workspace's `recall_id` returns 404 (no cross-tenant read)."

## Context

The "accountable forgetting" differentiator (chosen 2026-07-20, discover + plan cycles) says operators must be able to SEE why each recall candidate was dropped — the negative-space that Graphiti / Mem0 / OpenMemory discard. **S1 shipped the write half** (`RecallTraceStore` 14th DIP + `recall_traces` table migration 0023 + `PgRecallTraceStore` + pipeline write + factory opt-in; commits `70c06b5`…`9b8e86a`, THE GOAL TEST 5/5 vs real pgvector). But S1 is write-only: the `recall_id` is minted inside `retrieveResults` (scoped-memory.ts:235) and thrown away, and no read path exists. An operator today CANNOT answer "why was memory X not recalled?" — the data is in Postgres but unreachable through the product surface. S2 is the read half.

The scope was locked with the project owner (2026-07-20): **REST + recall_id on the return** — dashboard, MCP tool, and per-tenant retention/opt-out governance are explicitly deferred to S3.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/options.ts` | 311 | `23e97f8` (2026-07-16) | Public `RecallOptions` / `RememberOptions` / etc. shapes (the SDK contract) | Existing fields unchanged; new field is optional (backward-compat) |
| `packages/core/src/infrastructure/db/scoped-memory.ts` | 593 | `9b8e86a` (2026-07-20) | `LocalScopedMemory` — `retrieveResults` + `recallTraceDeps()` mint the recall_id (S1) | **D1 (S1): `recall()` returns `readonly MemoryItemWithScore[]` bare array — UNCHANGED**; already >500 LoC (pre-existing), keep the add minimal |
| `packages/core/src/infrastructure/db/recall-trace/pg-recall-trace-store.ts` | 112 | `83d48a6` (2026-07-20) | `PgRecallTraceStore.record` / `getByRecallId` (S1 default impl) | `record` unchanged; `getByRecallId` shape (returns `RecallTraceRow[]`) preserved for existing GOAL-test caller |
| `packages/core/src/domain/dip/recall-trace-store.ts` | ~90 | `70c06b5` (2026-07-20) | 14th DIP contract (`RecallTraceStore`) | 2-method cap (ADR-0008) preserved — adding a param, not a method |
| `packages/api/src/server/handlers/recall.ts` | 47 | `262a6a5` (2026-06-23) | `POST /v1/recall` handler; returns `{ results }` | Empty results still 200 `{ results: [] }` (EC-11); workspace-scoping via `workspaceBoundMemory` preserved |
| `packages/api/src/server/handlers/recall-traces.ts` (NEW) | 0 | — | (file to be created — the read handler) | — |
| `packages/api/src/server/app.ts` | 406 | `b3e7f39` (2026-06-28) | Route registration + auth guards (`requireScopeOnPrincipal`) + `CreateServerOptions` | Existing routes/guards unchanged; new route additive |
| `packages/api/src/server/schemas.ts` | 160 | `262a6a5` (2026-06-23) | zod request/response schemas | Existing schemas unchanged; new response schema additive |
| `packages/core/src/infrastructure/db/scoped-memory.test.ts` | — | — | unit tests for scoped-memory | (add RED tests) |
| `tests/integration/recall-trace/read-surface.test.ts` (NEW) | 0 | — | (file to be created — THE GOAL TEST for S2) | — |
| `CHANGELOG.md` | — | — | public contract | `[Unreleased]` updated |

### Current callers / dependents

- **Symbol:** `recall()` on `ScopedMemory` (returns `readonly MemoryItemWithScore[]`)
  - **Callers (production):** `packages/api/src/server/handlers/recall.ts:37`; the cache-miss + non-cache paths in `scoped-memory.ts` (self); MCP tools in `packages/mcp`.
  - **Callers (tests):** `tests/integration/recall-trace/*.test.ts`, many `packages/core` recall tests.
  - **External:** yes — `recall()` is the published SDK verb. Its return shape is a locked contract (S1 D1). **S2 MUST NOT change the return type** — `recall_id` is a new INPUT option only.
- **Symbol:** `RecallTraceStore.getByRecallId(recallId)` in `recall-trace-store.ts` / `pg-recall-trace-store.ts:108`
  - **Callers (production):** none yet (read endpoint is what this plan adds).
  - **Callers (tests):** `tests/integration/recall-trace/recall-trace-store.test.ts:86`, `concurrency.test.ts`.
  - **External:** the 14th DIP is a pre-release published interface — adding a required `workspaceId` param is a pre-release breaking change (ADR D3).
- **Symbol:** `recallTraceDeps(options?)` (private, scoped-memory.ts:210) — self-only; mints `recallId: randomUUID()` at :235.
- **Symbol:** `CreateServerOptions` (app.ts:86) — consumed by `createServer` callers (CLI `run-server.ts`, tests). New optional `recallTraceStore?` field is backward-compat (mirrors `memoryEntityStore?` / `memoryGraphStore?` precedent at :177).

### Domain glossary

- **recall_id** — a per-recall UUID minted server-side; the join key between a recall event and its dropped-candidate trace rows.
- **drop-reason** — why a candidate was excluded ∈ `semantic_gate` / `sub_threshold` / `nan` / `mmr_redundant` (S1).
- **workspace_id** — the tenant boundary (`workspace_id == tenant_id`); every `recall_traces` row carries it; every read MUST scope by the resolved Principal's workspace.
- **Principal** — `{ workspaceId, role, scopes }` resolved from the credential by the edge/AuthVerifier; handlers read the workspace from it, never from the body.
- **bare-array (D1)** — the S1 invariant that `recall()` returns `readonly MemoryItemWithScore[]` directly (3 production callers depend on it); tracing must not alter it.

### Architecture boundaries affected

- **Domain → contract (`options.ts`, `recall-trace-store.ts`):** adds an optional field / a param on existing DIP types. Direction unchanged (interface layer).
- **Infrastructure (`scoped-memory.ts`, `pg-recall-trace-store.ts`):** consumes the new option + implements the workspace-scoped read. Domain defines, infra implements (DIP, `architecture.md § 2`).
- **Interface (`packages/api` REST):** adds one route + one handler. The API depends inward on the core contract (`@usetheo/memory/contract`) — no new outward dependency. Per-verb scope guard (`requireScopeOnPrincipal('memory:read')`) per `theo-data/CLAUDE.md` invariant 4 (CWE-441 second half).

## Prior Art & Related Work

- **Internal:** S1 plan `knowledge-base/plans/explainable-recall-plan.md` (the write half — the direct predecessor; this plan reuses its `RecallTraceStore` / `recall_traces` / `PgRecallTraceStore`). S1 implementation summary `knowledge-base/implementations/explainable-recall-implementation.md` (D1/D3/EC-2/EC-3 invariants).
- **Reference project (repo):** `packages/api/src/server/handlers/recall.ts` (the existing recall handler shape) + `app.ts:263-266` (route + rate-limit + scope-guard registration pattern) + the `memoryEntityStore?` optional-store wiring at `app.ts:177` (the precedent this plan mirrors for `recallTraceStore?`).
- **Security pattern:** `theo-data/CLAUDE.md § Inviolable invariants` (per-verb scope + workspace isolation + fail-closed) — the read endpoint's workspace-scoping is a direct application (the `#77` CWE-441 second-half pattern).
- **External:** OpenAPI 3.1 (the server auto-derives its spec from zod via `openapi-registration.ts`) — the new route registers there.

## Objective

- [ ] `RecallOptions` carries an optional `recallId?: string` INPUT; when set, the trace uses it instead of minting one.
- [ ] `recall()` return type is byte-unchanged (D1 preserved) — verified by an on/off + with/without-recallId identical-return test.
- [ ] `POST /v1/recall` mints a `recall_id`, passes it to `recall()`, and returns it in the envelope `{ results, recallId }`.
- [ ] `getByRecallId` is workspace-scoped — a `recall_id` from workspace A is NOT readable with workspace B's Principal.
- [ ] `GET /v1/recall-traces/:recallId` returns the dropped candidates (breakdown + drop-reason) for the caller's workspace, guarded by `memory:read`; 404 for a foreign/absent `recall_id`.
- [ ] THE GOAL TEST (S2): REST recall → recall_id → `GET /v1/recall-traces/{id}` returns the drops; a cross-tenant id returns 404.

## ADRs

### D1 — `recall_id` is an opt-in `RecallOptions` INPUT, never a `recall()` output

- **Decision:** Surface `recall_id` by accepting it as an optional input on `RecallOptions` (`recallId?: string`). The caller (the REST handler) mints it and passes it in; `recall()` returns the same bare `readonly MemoryItemWithScore[]` as always.
- **Rationale:** S1's D1 invariant — `recall()` returns a bare array, 3 production callers + the MCP tools depend on it. Changing the return shape to `{ results, recallId }` would break every caller and violate a just-shipped locked contract. An input option is additive + backward-compatible (KISS, `architecture.md`; YAGNI — no envelope object nobody asked for on the SDK).
- **Alternatives considered:** (a) change `recall()` to return `{ results, recallId }` — REJECTED: breaks D1 + 3 callers + MCP; (b) an out-of-band `memory.lastRecallId()` accessor — REJECTED: stateful, not concurrency-safe (two parallel recalls race on the "last" id); (c) surface only at REST, mint fully inside the SDK and never expose — REJECTED: the REST handler could not return the id it did not mint.
- **Consequences:** Enables the REST envelope to carry the id the handler minted. Constrains: the SDK caller who wants the id must pass one in (acceptable — the SDK is for embedders; operators use REST).

### D2 — The REST recall handler mints the `recall_id` and returns it in the envelope

- **Decision:** `POST /v1/recall` generates a `recall_id` (`crypto.randomUUID()`), passes it via `recall(query, { ..., recallId })`, and returns `{ results, recallId }` (200). The id is always minted + returned, even when deployment tracing is OFF.
- **Rationale:** The handler owns the id lifecycle so it can both drive the trace write (S1 uses the passed id) and return it for the follow-up read. Always returning it keeps the response shape stable (no conditional field); the follow-up read honestly returns `[]`/404 when tracing was off for that deployment.
- **Alternatives considered:** (a) return `recallId` only when tracing is enabled — REJECTED: the handler cannot cheaply know if the deployment wired `recallTrace`, and a conditional field complicates the OpenAPI contract; (b) mint inside `scoped-memory` and reflect it back through a side channel — REJECTED: D1 (no output change) + adds a stateful channel.
- **Consequences:** The response schema gains a stable `recallId` field. A recall whose deployment has tracing off returns a `recall_id` whose lookup is empty — documented as honest (Princípio 3).

### D3 — `getByRecallId` gains a required `workspaceId` param (workspace-scoped read)

- **Decision:** Change the 14th-DIP read to `getByRecallId(recallId, workspaceId)` → `WHERE recall_id = $1 AND workspace_id = $2`. The read endpoint passes the Principal's workspace; a `recall_id` minted under another workspace returns `[]` → 404.
- **Rationale:** `recall_id` is a UUID an attacker could guess/replay; without the workspace predicate, tenant B could read tenant A's dropped-candidate breakdown (IDOR / CWE-441). `theo-data/CLAUDE.md` invariant 2+4: every row carries `workspace_id`; every query is scoped by the resolved Principal's workspace, enforced at the store boundary (not left to the handler to remember). Fail-closed (invariant 5).
- **Alternatives considered:** (a) keep `getByRecallId(recallId)` and filter in the handler after fetch — REJECTED: leaks the other tenant's rows across the store boundary before the check, and a future caller forgetting the filter re-opens the IDOR; enforce at the lowest layer; (b) make `workspaceId` optional (default all) — REJECTED: a fail-open default is exactly the CWE-441 gap.
- **Consequences:** Pre-release breaking change to the 14th DIP read signature (acceptable while Status is Pre-release) — the S1 GOAL-test caller updates to pass `'default'`. Method count unchanged (2), ADR-0008 preserved.

### D4 — `recallTraceStore` is an optional `createServer` dependency

- **Decision:** Add `recallTraceStore?: RecallTraceStore` to `CreateServerOptions`; the read route mounts only when it is provided (mirrors the `memoryEntityStore?` / `memoryGraphStore?` precedent at `app.ts:177`).
- **Rationale:** The REST server holds a `Memory`, not the internal stores; the read endpoint needs a `RecallTraceStore`. The established pattern for "a route that needs a sub-store" is an optional `CreateServerOptions` field (DIP — the server depends on the interface; the composition root wires the pg impl). Backward-compat: omit it → route not mounted (existing deployments unaffected).
- **Alternatives considered:** (a) expose the store via a `Memory.recallTrace()` accessor — REJECTED: `Memory` is the SDK verb contract, not a store registry; leaks infra through the domain surface; (b) construct the store inside the server from a pool — REJECTED: duplicates the factory's resolve/probe logic (DRY) and hides the opt-in.
- **Consequences:** The composition root (CLI `run-server.ts`) passes the same `PgRecallTraceStore` it wired for the SDK. Enables the read route; constrains callers to opt in explicitly.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| D3 changes the just-shipped 14th-DIP `getByRecallId` signature (pre-release breaking) | Medium | Pre-release Status allows it; update the single S1 GOAL-test caller in the same PR; note in CHANGELOG under Changed | dev |
| Returning a `recall_id` whose lookup is empty (deployment tracing OFF) could confuse operators | Low | Document in the OpenAPI description + README that the trace is populated only when `recallTrace` is enabled; the read returns 404 honestly | dev |
| `scoped-memory.ts` is already 593 LoC (>500 budget) before this plan; threading the option adds a few more | Low | The add is ~5 lines (pass `options` into `recallTraceDeps`); pre-existing over-budget is documented, not introduced here; no new split warranted for 5 lines (KISS) | dev |
| A guessable `recall_id` (UUID) enumerated across workspaces | Medium | D3 workspace predicate makes cross-tenant reads 404; the id is v4 UUID (122 bits) — not enumerable in practice; fail-closed on missing Principal | dev |

## Unresolved Questions

- Q1 — Should the read endpoint also expose the KEPT candidates (not just dropped), so an operator sees the full ranking? (S2 = dropped-only per the "negative-space" framing; kept candidates are already in the recall result. Leaning NO — out of scope, revisit in S3 if asked.)
- Q2 — Pagination: a pathological recall could drop thousands of candidates (capped at `maxRowsPerRecall` ≤ 5000 by S1 EC-1). Does the read endpoint need pagination, or is returning ≤ 5000 rows acceptable for v1? (Leaning: return all ≤ cap for S2; add pagination in S3 if the cap is raised.)
- Q3 — Does the `GET` route need its own rate-limit bucket, or does the existing `read` bucket suffice? (Leaning: reuse the `read` bucket per `app.ts:266` precedent.)

## Dependency Graph

```
Phase 1 (recall_id input)  ──▶ Phase 2 (REST recall returns id)
        │                              │
        │                              ▼
        └────────────────────▶ Phase 4 (GET read endpoint)
Phase 3 (workspace-scoped read) ──────▶ Phase 4
                                        │
                                        ▼
                               Final: Integration Validation
```

Phase 1 and Phase 3 are independent (parallelizable). Phase 2 needs Phase 1. Phase 4 needs Phases 1+2+3. Final needs all.

---

## Phase 1: recall_id as an opt-in input

**Objective:** `RecallOptions.recallId?` flows into the trace write without changing the `recall()` return.

### T1.1 — Thread `recallId` from `RecallOptions` into `recallTraceDeps`

#### Objective
Accept `recallId?: string` on `RecallOptions`; `recallTraceDeps` uses `options.recallId ?? randomUUID()` so a caller-supplied id keys the trace; the return stays a bare array.

#### Why this step (action + reasoning)
1. **What this step does** — adds one optional field to `RecallOptions` and threads it: `retrieveResults` passes its `options` into `recallTraceDeps(options)`, which mints `options.recallId ?? randomUUID()`.
2. **Why now** — D1 forbids changing the `recall()` output, so the only way the REST handler can learn the id it needs to return is to SUPPLY it (D1 ADR). This is the foundation Phase 2 builds on; it must land first (Baseline: `scoped-memory.ts:235` mints unconditionally today).

#### Evidence
`scoped-memory.ts:235` — `recallId: randomUUID()` minted with no input. `options.ts:75` — `RecallOptions` has no id field. `recallTraceDeps` (scoped-memory.ts:210) is called with no args today.

#### Files to edit
```
packages/core/src/domain/options.ts — add `readonly recallId?: string` to RecallOptions with JSDoc (opt-in; server-supplied)
packages/core/src/infrastructure/db/scoped-memory.ts — recallTraceDeps(options?: RecallOptions); use options?.recallId ?? randomUUID(); pass options at both call sites (non-cache + cache-miss)
packages/core/src/infrastructure/db/scoped-memory.test.ts — RED tests
```

#### Deep file dependency analysis
- `options.ts` (Baseline row) — SDK contract; add optional field → backward-compat, no caller breaks.
- `scoped-memory.ts` (Baseline row, 593 LoC) — `recallTraceDeps` currently no-arg; give it `options`. Both `runRetrievalPipeline` call sites (non-cache + cache-miss) already spread `...this.recallTraceDeps()` → change to `...this.recallTraceDeps(options)`. D1 preserved (input only).

#### Deep Dives
- Signature: `private recallTraceDeps(options?: RecallOptions): { recallTrace?; recallTraceContext? }`.
- Invariant: return of `recall()` unchanged (D1). `recallId` empty string → treat as absent (mint) — validate `options.recallId` is non-empty or ignore.
- Edge: two concurrent recalls with DISTINCT supplied ids → distinct traces (already covered by S1 concurrency test shape; here the id is supplied not minted).

#### Tasks
1. Add `recallId?: string` to `RecallOptions` (options.ts) with JSDoc.
2. `recallTraceDeps(options)` uses `options?.recallId ?? randomUUID()` (ignore empty string).
3. Pass `options` at both `recallTraceDeps()` call sites.

#### TDD
```
RED: test_recall_uses_supplied_recall_id() — recall(query, { recallId: 'fixed-id', ... }) with a stub RecallTraceStore → the recorded batch.recallId === 'fixed-id'
RED: test_recall_mints_when_recall_id_absent() — recall without recallId → recorded batch.recallId is a non-empty UUID
RED: test_recall_return_unchanged_with_recall_id() — the returned array is identical with vs without recallId supplied (D1)
GREEN: implement the option + threading
REFACTOR: None expected
VERIFY: npm test -- scoped-memory
```

#### Concurrency tests
(none — single-threaded; concurrency of distinct recall_ids is covered by the S1 `concurrency.test.ts` shape and re-exercised in the Final Phase)

#### Acceptance Criteria
- [ ] `RecallOptions.recallId?` exists + documented
- [ ] Supplied id keys the trace; absent → minted
- [ ] `recall()` return byte-identical (D1)
- [ ] Pass: lint zero warnings on changed files
- [ ] Pass: size — options.ts ≤ 500 (scoped-memory.ts pre-existing >500, add ≤ 5 lines)

#### DoD
- [ ] `npm test -- scoped-memory` green
- [ ] `npm run typecheck` zero errors
- [ ] CHANGELOG `[Unreleased]` noted

---

## Phase 2: REST recall returns the recall_id

**Objective:** `POST /v1/recall` mints + returns `recall_id` in the envelope.

### T2.1 — Mint + return `recallId` in the recall handler

#### Objective
The handler generates a `recall_id`, passes it to `recall()`, and returns `{ results, recallId }`.

#### Why this step (action + reasoning)
1. **What this step does** — `recallHandler` mints `crypto.randomUUID()`, threads it via `recall(query, { ..., recallId })`, and adds it to the JSON envelope.
2. **Why now** — this is the surface that lets an operator learn the id to look up (D2). It needs Phase 1's input option to exist. Baseline: `recall.ts:44` returns `{ results }` only.

#### Evidence
`handlers/recall.ts:37-46` — builds the options object + `return c.json({ results }, 200)`. `schemas.ts:160` — response schemas live here.

#### Files to edit
```
packages/api/src/server/handlers/recall.ts — mint recallId; pass to scoped.recall(...); return { results, recallId }
packages/api/src/server/schemas.ts — add recallId to the recall response schema (openapi)
packages/api/src/server/__tests__/handlers.test.ts — RED test
```

#### Deep file dependency analysis
- `recall.ts` (Baseline row, 47 LoC) — add ~2 lines (mint + envelope field). Keeps empty-results 200 (EC-11) + `workspaceBoundMemory` scoping.
- `schemas.ts` — additive response field; OpenAPI regenerates.

#### Deep Dives
- `recallId` in the envelope is always present (D2). Response: `{ results: MemoryItemWithScore[], recallId: string }`.
- Edge: tracing OFF → id returned, follow-up read 404 (documented).

#### Tasks
1. Mint `const recallId = crypto.randomUUID()` in the handler.
2. Pass `recallId` into `scoped.recall(query, { ..., recallId })`.
3. Return `{ results, recallId }`; update the response schema.

#### TDD
```
RED: test_recall_response_includes_recall_id() — POST /v1/recall → body has a UUID `recallId`
RED: test_recall_still_200_empty_results() — empty results → 200 { results: [], recallId } (EC-11 preserved)
GREEN: implement
REFACTOR: None expected
VERIFY: npm test -- handlers
```

#### Concurrency tests
(none — single-threaded HTTP handler; each request mints its own id)

#### Acceptance Criteria
- [ ] Response carries a UUID `recallId`
- [ ] Empty results still 200
- [ ] OpenAPI spec includes `recallId`
- [ ] Pass: lint / size (recall.ts ≤ 500)

#### DoD
- [ ] `npm test -- handlers` green
- [ ] `npm run typecheck` zero errors
- [ ] CHANGELOG updated

---

## Phase 3: workspace-scoped read (the security task)

**Objective:** `getByRecallId` cannot cross tenants.

### T3.1 — `getByRecallId(recallId, workspaceId)` enforces the workspace predicate

#### Objective
Add a required `workspaceId` param to the 14th-DIP read; the SQL filters `WHERE recall_id = $1 AND workspace_id = $2`.

#### Why this step (action + reasoning)
1. **What this step does** — widens the DIP method + the pg impl SQL so a read is scoped to one workspace; updates the S1 GOAL-test caller to pass `'default'`.
2. **Why now** — without this, the read endpoint (Phase 4) would be an IDOR: a guessed/replayed `recall_id` reads another tenant's drops (D3, CWE-441). Enforce at the store boundary BEFORE the endpoint exists (Baseline: `pg-recall-trace-store.ts:108` filters by recall_id only).

#### Evidence
`pg-recall-trace-store.ts:108` — `getByRecallId(recallId)` → `SELECT ... WHERE recall_id = $1` (no workspace filter). `theo-data/CLAUDE.md § Inviolable invariants 2+4` — every query scoped by the Principal's workspace.

#### Files to edit
```
packages/core/src/domain/dip/recall-trace-store.ts — getByRecallId(recallId, workspaceId): Promise<readonly RecallTraceRow[]>
packages/core/src/infrastructure/db/recall-trace/pg-recall-trace-store.ts — add AND workspace_id = $2 to SELECT_BY_RECALL_ID; bind param
tests/integration/recall-trace/recall-trace-store.test.ts — update caller to pass 'default'; add cross-workspace RED test
```

#### Deep file dependency analysis
- `recall-trace-store.ts` (14th DIP) — add param; still 2 methods (ADR-0008 ok). Pre-release breaking (D3).
- `pg-recall-trace-store.ts` — `SELECT_BY_RECALL_ID` gains `AND workspace_id = $2`; the `record` path (writes workspace_id) unchanged.
- Test caller at `recall-trace-store.test.ts:86` passes `'default'`.

#### Deep Dives
- SQL: `SELECT ... FROM recall_traces WHERE recall_id = $1 AND workspace_id = $2 ORDER BY created_at ASC, id ASC`.
- Invariant: a `recall_id` from workspace A + workspace B → returns `[]` (fail-closed).
- Edge: `workspaceId = 'default'` (the S1 unbound path) still works.

#### Tasks
1. Widen the DIP signature.
2. Add the workspace predicate + bind param in the pg SELECT.
3. Update the S1 GOAL-test + concurrency callers to pass the workspace.

#### TDD
```
RED: test_get_by_recall_id_scopes_workspace() — record under workspace 'wsA'; getByRecallId(id, 'wsB') → []; getByRecallId(id, 'wsA') → the rows
RED: test_get_by_recall_id_default_workspace() — the S1 'default'-workspace round-trip still returns rows
GREEN: add the predicate
REFACTOR: None expected
VERIFY: npm run test:integration -- recall-trace/recall-trace-store
```

#### Concurrency tests
(none — single-threaded read; no shared mutable state)

#### Acceptance Criteria
- [ ] Cross-workspace read returns `[]`
- [ ] Same-workspace read returns rows
- [ ] 14th DIP still 2 methods (ADR-0008)
- [ ] Pass: lint / size

#### DoD
- [ ] `npm run test:integration -- recall-trace/recall-trace-store` green
- [ ] `npm run typecheck` zero errors (all callers updated)
- [ ] CHANGELOG Changed entry (pre-release breaking)

---

## Phase 4: the read endpoint

**Objective:** `GET /v1/recall-traces/:recallId` returns the drops, guarded + workspace-scoped.

### T4.1 — `GET /v1/recall-traces/:recallId` handler + createServer option + route

#### Objective
Add a `memory:read`-guarded route that resolves the Principal's workspace, calls `getByRecallId(recallId, workspaceId)`, returns the drops (200) or 404 when empty; wired via `CreateServerOptions.recallTraceStore?`.

#### Why this step (action + reasoning)
1. **What this step does** — a new handler + route + optional `recallTraceStore` dep (D4) + OpenAPI registration + `requireScopeOnPrincipal('memory:read')` guard.
2. **Why now** — this is the operator-facing surface (the Goal). It needs Phase 1/2 (the id) + Phase 3 (safe read). Baseline: `app.ts:263-266` is the route+guard registration pattern; `app.ts:177` is the optional-store precedent.

#### Evidence
`app.ts:20-21` — `requireScopeOnPrincipal` / `requireScope` imports. `app.ts:177` — optional stores destructured from options. `app.ts:263-266` — route + rate-limit registration. `handlers/recall.ts` — handler shape to mirror.

#### Files to edit
```
packages/api/src/server/handlers/recall-traces.ts (NEW) — recallTracesHandler(c, store): resolve workspace from Principal, getByRecallId(id, ws), 200 { recallId, drops } or 404
packages/api/src/server/app.ts — add recallTraceStore? to CreateServerOptions; mount GET /v1/recall-traces/:recallId with requireScopeOnPrincipal('memory:read') + read rate-limit, only when recallTraceStore provided
packages/api/src/server/schemas.ts — RecallTracesResponse schema
packages/api/src/server/openapi-registration.ts — register the GET route
packages/api/src/server/__tests__/scope-verb-matrix.test.ts — assert the route requires memory:read
tests/integration/recall-trace/read-surface.test.ts (NEW) — THE GOAL TEST (S2)
```

#### Deep file dependency analysis
- `app.ts` (Baseline row, 406 LoC) — add optional field + conditional route mount (mirrors `memoryEntityStore`); existing routes untouched. Watch the 500 budget (406 → ~+15 lines, still under).
- `recall-traces.ts` (NEW) — reads workspace from `workspaceBoundMemory`/Principal, never from the path/body.
- `scope-verb-matrix.test.ts` — extends the matrix with the new route → asserts fail-closed without `memory:read`.

#### Deep Dives
- Handler: `const ws = principalWorkspace(c); const drops = await store.getByRecallId(c.req.param('recallId'), ws); return drops.length ? c.json({ recallId, drops }) : c.json({ code:'NOT_FOUND' }, 404)`.
- Response: `{ recallId: string, drops: { memoryId, semantic, bm25, entity, composite, threshold, dropReason }[] }`.
- Invariant (fail-closed): missing/unresolvable Principal → 401 (existing auth middleware); foreign workspace → 404.
- Edge: unknown `recallId` → 404 (same as foreign — no oracle distinguishing "absent" from "another tenant's", avoids an enumeration oracle).

#### Pseudo-code / Signatures
```pseudocode
GET /v1/recall-traces/:recallId  [requireScopeOnPrincipal('memory:read')]
  ws = principal(c).workspaceId            -- never from path/body
  drops = store.getByRecallId(param.recallId, ws)
  if drops.empty: return 404 { code: NOT_FOUND }
  return 200 { recallId, drops }

# Example
GET /v1/recall-traces/abc  (Principal ws='wsA', trace minted under 'wsA')
-> 200 { recallId:'abc', drops:[{memoryId:'m1', semantic:0.2, ..., dropReason:'sub_threshold'}] }
GET /v1/recall-traces/abc  (Principal ws='wsB')
-> 404 { code:'NOT_FOUND' }
```

#### Tasks
1. Add `recallTraceStore?` to `CreateServerOptions`; destructure at :177.
2. New `recall-traces.ts` handler (workspace from Principal).
3. Mount `GET /v1/recall-traces/:recallId` with `memory:read` guard + read rate-limit, conditional on the store.
4. Register in OpenAPI + response schema.
5. Extend scope-verb-matrix.

#### TDD
```
RED: test_read_endpoint_requires_memory_read() — no memory:read scope → 403 (scope-verb-matrix)
RED: test_read_endpoint_returns_drops_for_own_workspace() — 200 { drops } with the breakdown
RED: test_read_endpoint_404_cross_tenant() — another workspace's recall_id → 404
RED: test_read_route_absent_without_store() — createServer without recallTraceStore → route not mounted (404)
GREEN: implement handler + route + wiring
REFACTOR: extract principalWorkspace helper if duplicated
VERIFY: npm test -- scope-verb-matrix handlers && npm run test:integration -- recall-trace/read-surface
```

#### Concurrency tests
(none — single-threaded read handler)

#### Failure scenarios
See `## Failure scenarios`.

#### Acceptance Criteria
- [ ] Route guarded by `memory:read` (platform-admin/mint-key 403s — least privilege)
- [ ] Own-workspace read 200 with breakdown; cross-tenant 404
- [ ] Route mounts only when `recallTraceStore` provided
- [ ] Pass: lint / size (app.ts stays ≤ 500; recall-traces.ts ≤ 500)

#### DoD
- [ ] `npm test -- scope-verb-matrix handlers` green
- [ ] `npm run test:integration -- recall-trace/read-surface` green
- [ ] `npm run typecheck` zero errors
- [ ] CHANGELOG Added entry

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | recall_id surfaced without breaking D1 bare-array | T1.1 | opt-in `RecallOptions.recallId` input |
| 2 | REST recall returns the recall_id | T2.1 | handler mints + envelope `{ results, recallId }` |
| 3 | read cannot cross tenants (CWE-441) | T3.1 | `getByRecallId(recallId, workspaceId)` predicate |
| 4 | operator reads the dropped candidates + breakdown | T4.1 | `GET /v1/recall-traces/:recallId` (memory:read) |
| 5 | endpoint is opt-in (backward-compat) | T4.1 (D4) | `CreateServerOptions.recallTraceStore?` conditional mount |
| 6 | THE GOAL TEST (read round-trip + isolation) | Final | integration test |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] `npm test` — no NEW failures vs the pre-existing baseline (28 pre-existing dogfood/examples reds documented; recall-trace + api suites green)
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings on changed files
- [ ] File-size budget respected on changed files (scoped-memory.ts pre-existing >500 noted; net add ≤ 5 lines)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Added: read surface; Changed: getByRecallId workspace param)
- [ ] Backward compatibility: SDK `recall()` return unchanged (D1); server route additive + opt-in (D4)
- [ ] Plan-specific: cross-tenant read returns 404 (proven in the integration test)
- [ ] Plan archived after `/review` READY_TO_MERGE + merge

## Failure scenarios (external I/O)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres:recall_traces` (DB, read) | `recall_id` absent (never traced / tracing off) | integration: GET an unknown UUID | 404 `{ code: NOT_FOUND }`, no 500 |
| `postgres:recall_traces` (DB, read) | cross-workspace `recall_id` | integration: mint under wsA, read as wsB | 404 (fail-closed, no leak) |
| `postgres` (DB) | connection error mid-read | pool error surfaces | handler propagates as 500 (typed), never a partial/empty-as-success masking the error |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** the read round-trip works end-to-end against real pgvector + the tenant isolation holds.

### Execution
```
npm test -- scoped-memory handlers scope-verb-matrix        # unit
npm run test:integration -- recall-trace                    # migration + pg-store + S1 GOAL + concurrency + S2 read-surface
npm run typecheck
npm run lint
```

THE GOAL TEST (S2, `read-surface.test.ts`): build a server with `recallTrace` + `recallTraceStore` wired; `POST /v1/recall` (dropping ≥1 candidate) → capture `recallId` → `GET /v1/recall-traces/{recallId}` (200, drops with breakdown) → `GET` the same id as a different-workspace Principal → 404.

### Acceptance Criteria
- [ ] All recall-trace + api suites green (no new failures vs baseline)
- [ ] Coverage ≥ 90% on changed files (critical paths 100%)
- [ ] Zero type errors / lint warnings
- [ ] Cross-tenant read returns 404 (isolation proven)

### If Validation Fails
1. Separate plan-caused failures from the 28 pre-existing dogfood/examples reds (baseline `c624ce5`).
2. Fix all plan-caused failures.
3. Re-run.
4. Pre-existing issues logged, do NOT block (document in PR).
