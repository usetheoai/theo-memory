---
slug: distinct-entities-metric-fix
milestone_id: DistinctEntitiesMetricFix
created_at: 2026-06-23
goal: Align the metrics endpoint's entity_count with the entities-listing source (MemoryEntityStore.list) so the dashboard Overview "Distinct entities" equals the Entities/Graph tab count, measured by a GOAL integration test where GET /metrics entity_count == GET /entities length against real pgvector.
---

# Plan: distinct-entities-metric-fix

> **Version 1.1** — EG-3 of the entity-graph-dogfood-remediation-roadmap. v1.1 absorbs the `/edge-case-plan` SHOULD-TEST items EC-1 (fallback-path consistency: metrics == entities even with no store) + EC-2 (workspace+scope param parity between the two handlers). See `.claude/knowledge-base/reviews/distinct-entities-metric-fix-edge-cases-2026-06-23.md` (0 MUST FIX). The 2026-06-23 Chrome-MCP dogfood showed the Memory Overview reporting "1 Distinct entities" while the Entities/Graph tab showed 10 for the same scope. ROOT CAUSE (investigated): `metricsHandler` computes `entity_count` from distinct `attributedTo` peers (the OLD derivation), while `entitiesHandler` was upgraded (the entities read-port change, commit `f108c99`) to serve REAL entities from `MemoryEntityStore.list()`. The two diverged. This plan upgrades `metricsHandler` to count distinct entities from the SAME source (the entity store) when wired, with the honest `attributedTo` fallback when it is not — making the Overview metric equal the Entities tab. Scope: `packages/api` ONLY. ZERO new dependency, NO migration, NO DIP widening, NO public-export change.

## Goal

> "Enable the `GET /v1/scopes/:type/:id/metrics` endpoint to compute `entity_count` from `MemoryEntityStore.list()` (the same source the Entities tab uses) when the read port is wired, so the dashboard Overview 'Distinct entities' equals the Entities/Graph tab, measured by `tests/integration/distinct-entities-metric.test.ts` where, against real `ankane/pgvector:v0.5.1`, `GET /metrics`.`entity_count` EQUALS the length of `GET /entities`.`entities` for the same scope."

## Context

EG-3 of `.claude/knowledge-base/roadmaps/entity-graph-dogfood-remediation-roadmap.md`. The dogfood evidence: Overview card "Distinct entities = 1" vs Entities tab + Graph "10 entities" for `user/alice`. The root cause is a single-source-of-truth divergence inside `packages/api`:

- `entitiesHandler` (`handlers/entities.ts:78-92`, commit `f108c99`, the entities read-port change): when `memoryEntityStore` is wired, serves the REAL entity-graph via `memoryEntityStore.list({ workspaceId, filters })` → that is the "10".
- `metricsHandler` (`handlers/metrics.ts:82-86`): computes `entity_count` as the number of distinct non-null `attributedTo` peers from `getAll()` → that is the "1". It was never upgraded to the entity store, and the route wiring (`app.ts:356`) does not even pass `memoryEntityStore` to it.

The fix mirrors the `entitiesHandler` the entities read-port change precedent exactly: thread the already-existing `createServer({ memoryEntityStore })` option into the metrics route and count `list().length` when wired; keep the `attributedTo` derivation as the honest fallback (in-memory adapter / tests) so existing behavior is byte-unchanged when no store is present. Honors Princípio 3 (REAL numbers, single source of truth) + `CLAUDE.md § Princípio 2`.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/api/src/server/handlers/metrics.ts` | 110 | `e601115` (2026-06-21) | `GET /metrics` handler; computes `total_memories`/`entity_count`/`add_events`/`retrieval_api_usage` | the 3 OTHER metrics unchanged; `attributedTo` derivation kept as the no-store fallback; subject-scoped (no cross-tenant leak); fail path unchanged |
| `packages/api/src/server/app.ts` | 386 | `dd31b1f` (2026-06-22) | route registration; `createServer` already accepts `memoryEntityStore` (`:147`) | only the metrics route call (`:356`) changes — thread `memoryEntityStore`; no new option; entities/graph routes unchanged |
| `packages/api/src/server/handlers/metrics.ts` test → `packages/api/src/server/__tests__/metrics-entities.test.ts` | 166 | `e601115` (2026-06-21) | unit tests for metrics + entities (fallback path) | existing `entity_count` fallback assertions (2 / 0 / 1) stay green (no-store path unchanged) |
| `tests/integration/distinct-entities-metric.test.ts` (NEW) | 0 | — | (file to be created) — GOAL: metrics.entity_count == entities length vs real pgvector | — |

### Current callers / dependents

- **Symbol:** `metricsHandler(c, memory, usageCounterStore?)` in `handlers/metrics.ts:70`
  - **Callers (production):** `app.ts:356` `app.get('/v1/scopes/:type/:id/metrics', (c) => metricsHandler(c, memory, usageCounterStore))`.
  - **Callers (tests):** `__tests__/metrics-entities.test.ts`.
  - **External (other repos):** the theo-cloud gateway `internal/themory/client.go:117` maps `entity_count` → `EntityCount int` (passthrough integer; NO semantic dependency on the attributedTo-vs-graph meaning). `contract_test.go:212` fixture carries `entity_count:1` (a captured-response parse test, not a semantic assertion). Changing the number's MEANING (distinct-peers → distinct-graph-entities) is safe for the gateway.
- **Precedent symbol:** `entitiesHandler(c, memory, memoryEntityStore?)` in `handlers/entities.ts:60` — already wired with `memoryEntityStore` at `app.ts:357`. The exact shape to mirror.

### Domain glossary

- **entity_count (metric)** — the number reported by `GET /metrics` and shown as "Distinct entities" on the dashboard Overview.
- **`MemoryEntityStore.list(params)`** — returns the distinct entity nodes for a scope (deduped per `(scope, normalized_key)`), `EntityNodeSummary[]`. Its length is the distinct-entity count the Entities/Graph tab shows.
- **`attributedTo` fallback** — the legacy derivation (distinct non-null `attributedTo` peers from `getAll()`) used ONLY when no entity store is wired.
- **single source of truth** — after this fix, both `entity_count` and the entities listing read from `MemoryEntityStore.list()` on the wired path, so they cannot diverge.

### Architecture boundaries affected

- **`packages/api` (REST adapter) ONLY** — the handler reads an already-injected DIP port (`MemoryEntityStore`). No `packages/core` change, no new port, no DIP widening (ADR-0008). `createServer` already exposes the `memoryEntityStore` option (`app.ts:147`) — no new public option.

## Prior Art & Related Work

- **Internal precedent:** `handlers/entities.ts` entities read-port upgrade (commit `f108c99`) — wired `memoryEntityStore` into `entitiesHandler` with an `attributedTo` fallback. This plan applies the identical pattern to `metricsHandler`.
- **Roadmap:** `.claude/knowledge-base/roadmaps/entity-graph-dogfood-remediation-roadmap.md § EG-3`.
- **Upstream fix it composes with:** EG-2 (`entity-extraction-noise-filter`, v0.20.1) — the entity-graph is now noise-free, so the aligned `entity_count` counts clean entities.

## Objective

- [ ] `metricsHandler` accepts an optional `memoryEntityStore` and computes `entity_count = list().length` when wired.
- [ ] When NO store is wired, `entity_count` keeps the `attributedTo` derivation (existing tests green).
- [ ] The metrics route threads `memoryEntityStore` (`app.ts`).
- [ ] GOAL: against real pgvector, `metrics.entity_count == entities-list length` for a scope with ≥ 2 distinct entities.

## ADRs

### D1 — Align `entity_count` to `MemoryEntityStore.list()` (single source of truth)
- **Decision:** when `memoryEntityStore` is wired, `entity_count = (await memoryEntityStore.list({ workspaceId, filters })).length` — the exact source `entitiesHandler` uses.
- **Rationale:** the bug is a divergence between two derivations of the same concept; reading the SAME source makes them structurally equal (cannot drift). Mirrors the entities read-port precedent (DRY). No new dependency, no port change.
- **Alternatives considered:** (a) relabel the dashboard card to "Distinct peers" to match the attributedTo derivation — REJECTED: the user expects the Entities/Graph count; the Graph tab is literally titled with the entity count, so the Overview must match it, not be renamed away. (b) compute distinct entities from `getAll()` in the handler (re-derive) — REJECTED: would duplicate the store's dedup logic in the API layer (DRY violation) and could still drift from `list()`.
- **Consequences:** Overview "Distinct entities" equals the Entities/Graph tab. The metric's MEANING changes from distinct-attributed-peers to distinct-graph-entities (the user-intended meaning). Gateway passthrough unaffected (integer).

### D2 — Keep the `attributedTo` derivation as the no-store fallback (honest, byte-unchanged)
- **Decision:** when `memoryEntityStore` is undefined (in-memory adapter / unit tests), keep computing `entity_count` from distinct `attributedTo` peers exactly as today.
- **Rationale:** preserves existing behavior + green tests where no entity store exists (Princípio 3 honest fallback, never fabricated); zero regression for non-pgvector consumers.
- **Alternatives considered:** return 0 when no store — REJECTED: loses real signal the in-memory path still has (attributed peers). 
- **Consequences:** the metric semantics differ by deployment (store-wired = graph entities; store-absent = attributed peers). Documented in the handler JSDoc; the production (pgvector) path always has the store, so the user-visible dashboard always shows graph entities.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `entity_count` meaning differs between store-wired (graph entities) and store-absent (attributed peers) deployments | Low | Production/pgvector always wires the store (consistent there); documented in JSDoc + ADR D2; gateway treats it as an opaque integer | api |
| Extra `list()` query per `/metrics` call (one more DB round-trip) | Low | Same query the Entities tab already runs; metrics is a low-frequency dashboard read, not a hot path; subject-scoped + indexed | api |
| A `list()` error now fails `/metrics` (previously only `getAll()` could) | Low | The app `onError` maps a port rejection to 500 (never a masked wrong number) — same contract as `entitiesHandler`; honest failure over fabricated count | api |

## Unresolved Questions

- Q1 — Should `add_events` / `total_memories` also be revisited? NO — they are correct (active rows); only `entity_count` diverged. Out of scope (KISS).
- Q2 — Should the dashboard card tooltip clarify "distinct graph entities"? That is a theo-cloud dashboard copy concern, out of this `packages/api` scope; noted for EG-1/follow-up.

## Dependencies

**(none — ZERO new dependency.)** Reuses the already-injected `MemoryEntityStore` DIP + the existing `createServer({ memoryEntityStore })` option. No npm change, no version pin, no registry fetch.

## Dependency Graph

```
Phase 1 (handler + route wiring + unit) ──▶ Phase 2 (GOAL consistency integration + full gate)
```

---

## Phase 1: Align entity_count to the entity store

**Objective:** `metricsHandler` counts distinct graph entities when the store is wired; route threads the store; unit tests cover both paths.

### T1.1 — `metricsHandler` reads `MemoryEntityStore.list().length` (wired) + fallback (absent)

#### Objective
Compute `entity_count` from the entity store when wired; keep the `attributedTo` derivation otherwise.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — adds an optional `memoryEntityStore?: MemoryEntityStore` param to `metricsHandler`; when present, `entity_count = (await memoryEntityStore.list({ workspaceId, filters })).length`; else the existing `attributedTo` count. Threads the store at the metrics route in `app.ts`.
2. **Why it is necessary now** — per D1 this is the single locus of the divergence; mirroring the `entitiesHandler` read-port wiring (Baseline Prior Art) is the minimal correct fix. Cite root cause `metrics.ts:82-86` (attributedTo) vs `entities.ts:78-92` (store).

#### Evidence
- `handlers/metrics.ts:82-86` — `const entities = new Set<string>(); for (const m of items) { const peer = attributedPeerOf(m); if (peer !== undefined) entities.add(peer); }` → `entity_count: entities.size`.
- `handlers/entities.ts:78-86` — `memoryEntityStore.list({ workspaceId, filters })` is the "10" source.
- `app.ts:356` — metrics route does NOT pass `memoryEntityStore`; `:357` entities route DOES.

#### Files to edit
```
packages/api/src/server/handlers/metrics.ts — add memoryEntityStore param; entity_count from list().length when wired; keep attributedTo fallback + JSDoc note
packages/api/src/server/app.ts — metrics route: metricsHandler(c, memory, usageCounterStore, memoryEntityStore)
packages/api/src/server/__tests__/metrics-entities.test.ts — RED: wired-path entity_count == list().length + consistency-with-entities test; keep fallback tests green
```

#### Deep file dependency analysis
- `metrics.ts` (Baseline row, sha `e601115`) — signature widens to `metricsHandler(c, memory, usageCounterStore?, memoryEntityStore?)`. The `workspaceId` + `filtersFor` already exist in the file (used for the recall counter), so the `list()` call reuses them. The 3 other metrics unchanged.
- `app.ts` (sha `dd31b1f`) — `memoryEntityStore` is already destructured (`:167`); only the metrics route call changes. entities/graph routes untouched.
- Downstream: gateway `client.go` parses `entity_count` as an int — unaffected.

#### Deep Dives
- **Wired path:** `entity_count = (await memoryEntityStore.list({ workspaceId, filters: filtersFor(type,id) })).length`. `workspaceId` from `principal?.workspaceId ?? DEFAULT_WORKSPACE_ID` (same as the recall-counter block already in the handler + identical to `entitiesHandler`).
- **Fallback path:** unchanged `attributedTo` Set count.
- **Invariant:** subject-scoped (no cross-tenant leak — same `filtersFor`); the 3 other metrics byte-unchanged; a `list()` rejection propagates to the app `onError` (500), never a masked number.
- **Edge case:** empty scope → `list()` returns `[]` → `entity_count = 0` (correct). No store → fallback.

#### Pseudo-code / Signatures
```pseudocode
async function metricsHandler(c, memory, usageCounterStore?, memoryEntityStore?):
  ... (resolve type,id, scoped, items as today)
  let entityCount
  if memoryEntityStore != null:
    workspaceId = principal?.workspaceId ?? DEFAULT_WORKSPACE_ID
    entityCount = (await memoryEntityStore.list({ workspaceId, filters: filtersFor(type,id) })).length
  else:
    set = distinct attributedPeerOf(items)   # existing fallback
    entityCount = set.size
  return json({ total_memories: items.length, entity_count: entityCount, add_events: items.length, retrieval_api_usage })
```

#### Tasks
1. RED: add wired-path unit test (fake `MemoryEntityStore.list` returning N summaries → `entity_count === N`) + a consistency test (metrics `entity_count` === entities-handler list length for the same fake store).
2. Add the param + the wired branch; thread the store in `app.ts`. GREEN.
3. REFACTOR: extract `workspaceId` resolution if duplicated with the counter block (DRY) — only if it reads cleaner.

#### TDD
```
RED:  it("entity_count == list().length when the entity store is wired") — fake store list() returns 10 summaries → GET /metrics entity_count === 10
RED:  it("metrics entity_count equals the entities-handler list length (single source of truth)") — same fake store → metrics.entity_count === (entities body).entities.length
RED:  it("entity_count falls back to distinct attributedTo peers when no store wired") — existing assertions (2/0/1) stay green
RED:  it("metrics entity_count equals entities length on the no-store fallback path too") — EC-1: NO store, 2 distinct attributedTo peers → metrics.entity_count === entities.length === 2
RED:  it("metrics uses the same workspace+scope as entities") — EC-2: principal with non-default workspaceId → spy asserts list() called with that workspaceId + the correct single-tier filter (parity with entitiesHandler)
GREEN: add the memoryEntityStore branch + route wiring
REFACTOR: optional workspaceId-resolution DRY
VERIFY: npx vitest run -c packages/api/vitest.config.ts packages/api/src/server/__tests__/metrics-entities.test.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — the handler awaits one `list()` read; the only async is the pre-existing DB read, no shared mutable state.

#### Acceptance Criteria
- [ ] Wired path: `GET /metrics` `entity_count` `equals` `list().length` — `npx vitest run -c packages/api/vitest.config.ts packages/api/src/server/__tests__/metrics-entities.test.ts` `exit code 0`.
- [ ] Consistency: metrics `entity_count` `equals` the entities-handler list length (same store) — same test command.
- [ ] Fallback: `entity_count` `returns` the distinct-`attributedTo` count when no store — existing assertions green.
- [ ] Pass: complexity `<= 10`; coverage `>= 90` on changed lines (`npx vitest run --coverage`); `npm run lint` `exit code 0`; size `<= 500`.

#### DoD
- [ ] Tests green — `npx vitest run -c packages/api/vitest.config.ts packages/api/src/server/__tests__/metrics-entities.test.ts`
- [ ] Zero type errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Overview "Distinct entities" diverges from Entities/Graph tab | T1.1 | `entity_count` reads `MemoryEntityStore.list().length` (same source) |
| 2 | No regression when no entity store is wired | T1.1 | `attributedTo` fallback kept; existing tests green |
| 3 | Metrics route does not pass the store | T1.1 | `app.ts` metrics route threads `memoryEntityStore` |
| 4 | End-to-end consistency proof vs real pgvector | T2.1 | GOAL: metrics.entity_count == entities length |

**Coverage: 4/4 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npx vitest run -c packages/api/vitest.config.ts` green
- [ ] Zero type errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected (per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased] § Fixed`
- [ ] Backward compatibility preserved (no new public export; `createServer` option unchanged; gateway passthrough unaffected)
- [ ] No paper names in `src/**`
- [ ] Plan-specific: GOAL integration green vs real `ankane/pgvector:v0.5.1` (`entity_count == entities length`)
- [ ] **Plan archived** — after `/review` READY_TO_MERGE + PR merged, move to `knowledge-base/plans/completed/`

## Failure scenarios

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres:entities` (pgvector, DB) | `list()` rejects mid-metrics | fake store whose `list` throws | the app `onError` returns 500 (honest failure), NOT a masked/fabricated `entity_count` — same contract as `entitiesHandler` |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** prove the Overview metric equals the Entities tab against a real workload.

### T2.1 — GOAL consistency integration vs real pgvector

#### Objective
After `remember()`ing a scope with ≥ 2 distinct entities, `GET /metrics`.`entity_count` EQUALS `GET /entities`.`entities`.length.

#### Files to edit
```
tests/integration/distinct-entities-metric.test.ts — NEW: real pgvector (skipIf no THEOMEM_PG_URI); createServer({ memory, memoryEntityStore: new PgMemoryEntityStore(pool) }); remember facts producing ≥2 entities; assert metrics.entity_count === entities.length AND > 0
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — sequential remember()→two GETs; only the pre-existing pgvector I/O is async.

#### TDD
```
RED:  it("Overview entity_count equals the Entities-tab count end-to-end") — metrics.entity_count === entities.length AND >= 2 (non-vacuous: the scope provably has multiple distinct entities)
GREEN: passes once T1.1 wires the store into metrics
REFACTOR: None expected
VERIFY: npx vitest run -c vitest.integration.config.ts tests/integration/distinct-entities-metric.test.ts --no-file-parallelism
```

Per the project rule (NEVER mock — use a REAL LLM for the GOAL when `OPENAI_API_KEY` present); otherwise a deterministic LLM emitting `entities` so the entity store is provably populated with ≥2 distinct nodes (non-vacuous). The assertion is the metrics↔entities EQUALITY, which is the user-visible bug.

### Execution
```
npm run typecheck
npm run lint
npx vitest run -c packages/api/vitest.config.ts            # api unit incl. the new metrics tests
npx vitest run -c vitest.integration.config.ts tests/integration/distinct-entities-metric.test.ts --no-file-parallelism
```

### Acceptance Criteria
- [ ] api unit suite `green` — `npx vitest run -c packages/api/vitest.config.ts` `exit code 0`
- [ ] GOAL integration `green` — metrics `entity_count` `equals` entities length (`>= 2`) vs real pgvector
- [ ] Coverage `>= 90` on changed files (`npx vitest run --coverage`)
- [ ] Zero type errors — `npm run typecheck` `exit code 0`; zero lint warnings — `npm run lint` `exit code 0`

### If Validation Fails
1. Separate plan-caused from pre-existing (`pgvector-store.test.ts` dual-module + mem0 clone known pre-existing).
2. Fix plan-caused; re-run.
3. Log pre-existing in the PR description.
