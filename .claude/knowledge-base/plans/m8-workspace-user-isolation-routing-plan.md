---
slug: m8-workspace-user-isolation-routing
milestone_id: M8
created_at: 2026-07-21
goal: Make user_id a mandatory component of the session/agent scope key and route writes between global and session under (workspace, user), proven by a cross-user isolation integration test.
---

# Plan: M8 — `(workspace, user)` isolation + agent-chosen session↔global routing

## Goal

Enforce `user_id` as a mandatory component of every session/agent scope key so the memory isolation boundary becomes `(workspace_id, user_id[, session_id])`, and add an agent-chosen `global`↔`session` routing policy, measured by a cross-user isolation integration test where user B's recall against real `ankane/pgvector:v0.5.1` returns **zero** of user A's rows while the existing single-scope suites stay green.

## Context

M8 (ROADMAP.md § M8, revised 2026-07-21) hardens the `(workspace, user)` model per the owner's corrected design (system design AS-IS→TO-BE accepted in chat 2026-07-21). Grounded in blueprint `.claude/knowledge-base/discoveries/blueprints/m8-workspace-user-isolation-routing-blueprint.md` (SHIPPABLE 98.2): mem0 composes scope ids into storage+query with ≥1 mandatory (`main.py:342-366`), keeps attribution (`actor_id`) out of the scope key (`main.py:308-311`), and graphiti indexes the partition key in every index (`graph_queries.py:32-70`). The `/goal` owner directive (2026-07-21) is the sign-off for the locked "Memory tiers" name + the `SessionScope` contract change.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC | Last touch | Why it exists / what it does |
|---|---|---|---|
| `packages/core/src/domain/scope.ts` | 194 | `23e97f8` 2026-07-16 | The 3-tier scope discriminated union; `SessionScope.userId?`/`AgentScope.userId?` are OPTIONAL (`:16-17,23-24`) — the leak M8 closes |
| `packages/core/src/infrastructure/db/scoped-memory.ts` | (toFilters `:100-121`) | — | Builds the WHERE filter from a scope; `:112` builds `{ws, session_id}` WITHOUT user_id when userId absent — the exact cross-user exposure |
| `packages/core/src/infrastructure/db/migrations/0024_*.sql` | (NEW) | — | Composite btree index `(workspace_id, user_id, session_id)` — no composite index exists today (only single-column, `0000_crazy_mimic.sql:48-50`) |
| `packages/core/src/domain/routing-policy.ts` | (NEW) | — | `MemoryRoutingPolicy` DIP + default impl |
| `packages/core/src/domain/index.ts` | — | — | Re-exports scope types; consumes SessionScope/AgentScope |
| `packages/mcp/src/tools/recall-schema.ts` | — | — | MCP scope schema — consumes SessionScope |
| `packages/core/src/infrastructure/db/recall-cache/scope-key.ts` | — | — | Builds the cache key from a scope — consumes the tier ids |

### Current callers / dependents

- `SessionScope`/`AgentScope` consumers (`grep -rln 'SessionScope\|AgentScope' packages/*/src`): `packages/core/src/domain/scope.ts`, `packages/core/src/domain/index.ts`, `packages/core/src/infrastructure/db/reflection/threshold-reflection-policy.ts`, `packages/core/src/infrastructure/db/recall-cache/scope-key.ts`, `packages/mcp/src/tools/recall-schema.ts`.
- `toFilters` scope→WHERE builder: `packages/core/src/infrastructure/db/scoped-memory.ts:100-121`.
- `attributed_to` column: ALREADY EXISTS (`migrations/0008_attributed_to.sql`); set via `RememberOptions.attributedTo` (`options.ts:26`) hoisted at persist OR `extracted[i].attributed_to` when `infer:true`. M8 REUSES it (Rule 9).
- Existing `memories` indexes: single-column `memories_user_id_idx`/`memories_session_id_idx`/`memories_agent_id_idx` (`0000_crazy_mimic.sql:48-50`); eviction partial indexes (`0005_eviction_partial_indexes.sql`). NO composite scope index.

### Domain glossary

- **workspace_id** — tenant anchor (`== tenant_id`), the outer security boundary (CWE-441).
- **user_id** — the acting user within a tenant; M8 promotes it from "a partition, NOT the security boundary" (`scope.ts:74-76`) to a mandatory isolation component.
- **global scope** — `(workspace_id, user_id)`: a user's durable memory across sessions.
- **session scope** — `(workspace_id, user_id, session_id)`: one conversation.
- **attributed_to** — who authored a memory (`user`|`agent`), orthogonal to the scope key.
- **MemoryRoutingPolicy** — the DIP that decides which scope a write lands in.

### Architecture boundaries affected

Per `rules/architecture.md § 1-2`: `MemoryRoutingPolicy` is a domain-layer DIP (interface in `domain/`, impl injected at the composition root); `scope.ts` is a domain value-object (no I/O); the migration + `scoped-memory.ts` are infrastructure. Inner (domain) MUST NOT import infrastructure — the routing policy interface stays in `domain/`.

## Prior Art & Related Work

- Blueprint `.claude/knowledge-base/discoveries/blueprints/m8-workspace-user-isolation-routing-blueprint.md` (SHIPPABLE 98.2) — the mem0/graphiti grounding; D1 (dedicated columns > JSONB), D2 (attribution orthogonal), D3 (graphiti single-key + index discipline).
- `.claude/knowledge-base/references/mem0/mem0/memory/main.py:287-366` — composite scope ids + ≥1-mandatory + `actor_id` orthogonal attribution.
- `.claude/knowledge-base/references/graphiti/graphiti_core/graph_queries.py:32-70` — partition-key-in-every-index discipline.
- theo-memory ADR-0010 (RepoScope 4th tier) — the precedent for a locked-name scope change with owner sign-off.

## Objective

Ship the `(workspace, user)` isolation boundary + agent-chosen routing with backward-compat default, proven by a cross-user isolation integration test and a composite-index filter-latency benchmark, with zero regression on the existing single-scope suites.

## ADRs

### D1 — `user_id` becomes mandatory in Session/Agent scopes (breaking, behind backward-compat)

**Decision:** `SessionScope.userId` and `AgentScope.userId` change from optional to required; `toFilters` always emits `user_id` for session/agent scopes.

**Rationale:** mem0 requires ≥1 scope id and mirrors it into storage+query (`main.py:342-366`); a session key without `user_id` is a latent cross-user leak in a multi-user tenant (`scope.ts:74-76`). Per `rules/architecture.md` (validate at boundaries) + Unbreakable Rule 8 (fail-closed). **Rejected alternative:** keep `userId?` optional and filter opportunistically (rejected — the leak persists whenever a caller omits it).

**Consequences:** callers that constructed a bare `SessionScope` must now pass `userId`. Pre-M8 rows with `session_id` and NULL `user_id` are handled by D4.

### D2 — `MemoryRoutingPolicy` is a domain DIP; default preserves current placement

**Decision:** a `MemoryRoutingPolicy` interface in `domain/` with a `DefaultRoutingPolicy` (backward-compat: honors the caller's explicit scope) + agent-choice inputs (MCP durable → global; hook → session).

**Rationale:** DIP per `rules/architecture.md § 2`; the agent chooses on write (mem0 `add()` kwargs, `main.py:721`). **Rejected alternative:** an LLM-classified router on every write (rejected — cost/nondeterminism; the agent's explicit choice is authoritative, KISS).

### D3 — Reuse the existing `attributed_to` column for user/agent attribution

**Decision:** attribution reuses `attributed_to` (`0008_attributed_to.sql`), never becomes part of the scope key.

**Rationale:** Rule 9 (don't reinvent — the column exists) + blueprint D2 (attribution orthogonal, mem0 `main.py:308-311`). **Rejected alternative:** a new `authored_by` column (rejected — redundant).

### D5 — Public `Memory.session(id)` / `Memory.agent(id)` API migration (surfaced at implement-time)

**Decision:** `Memory.session(sessionId)` and `Memory.agent(agentId)` (`local-memory.ts:108,121`) gain a required `userId` — the public shape becomes `Memory.session(userId, sessionId)` / `Memory.agent(userId, agentId)` (pre-release breaking change, acceptable while Status is `Pre-release`). Internal scope-reconstruction sites that rebuild a scope from a stored row/filters (`pipeline-helpers.ts:117,120`, `scope-candidate.ts:55,57`, `retrieval/pipeline.ts:94,97`, `scoped-memory.ts:174,177`) carry the row's `user_id` into the reconstructed scope.

**Rationale:** making `userId` mandatory (D1) is not a mechanical typecheck fix — it changes the PUBLIC API surface (`Memory.session(id)` takes only an id today, with no user binding). Discovered when enumerating callers at implement-start (cycle-implement: return-to-plan on a plan gap, do NOT pivot mid-implement). A session/agent that belongs to no user contradicts the `(workspace, user)` isolation model. **Rejected alternative:** keep `Memory.session(id)` and inject the workspace's single user (rejected — there is no single user in a multi-user tenant; that IS the leak).

**Consequences:** T1.2 (new) migrates the public API + the 6 reconstruction sites; the scope-reconstruction sites depend on the row carrying `user_id` (it does — the column exists).

### D4 — Pre-M8 NULL-user session rows: honest no-backfill, forward-only

**Decision:** existing `session_id`-only rows with NULL `user_id` are NOT retroactively rewritten; the composite filter treats them as unreachable by a `(workspace, user, session)` query (they are legacy, pre-multi-user). Documented, not silently dropped.

**Rationale:** mirrors the v1.1 `attributed_to` no-backfill precedent (EC-1 honest deferral). A backfill would need to invent a user_id per legacy session — impossible without provenance. **Rejected alternative:** backfill with a synthetic user_id (rejected — fabricates ownership).

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Making `userId` mandatory breaks internal callers that built bare Session/Agent scopes | HIGH | typecheck gate catches every call site; update the 5 known consumers in the same PR; the cross-user test proves the new behavior | implementer |
| The composite index migration locks the `memories` table on a large DB | MEDIUM | `CREATE INDEX CONCURRENTLY` (non-blocking); benchmark on a seeded table before/after | implementer |
| Legacy NULL-user session rows become unreachable (D4) | MEDIUM | documented forward-only behavior; no silent data loss (rows still exist, just not surfaced by a composite-scope query) | owner-accepted |

## Unresolved Questions

(none — every decision is resolved at plan time via D1–D4 and the blueprint.)

## Dependency Graph

```
Phase 1 (scope contract: user_id mandatory)  ──┬──> Phase 2 (routing DIP)
                                                └──> Phase 3 (composite index)
Phase 2 + Phase 3 ──> Phase 4 (isolation hard-gate test + OTel + benchmark)
Phase 5 (owner sign-off ADR + CLAUDE.md) — parallel, gates release not implement
Final Phase: Integration Validation (after 1-4)
```

## Phase 1: Scope contract — `user_id` mandatory in Session/Agent

### T1.1 — Make `SessionScope.userId` / `AgentScope.userId` required and always filter by it

#### Objective
`SessionScope.userId` and `AgentScope.userId` are required; `toFilters` always emits `user_id` for session/agent scopes.

#### Why this step (action + reasoning)
Action: remove the `?` from `SessionScope.userId`/`AgentScope.userId` (`scope.ts:16-17,23-24`) and delete the userId-absent branch in `toFilters` (`scoped-memory.ts:112`).
Reasoning: per ADR D1 + blueprint (mem0 mirrors the mandatory id into the query filter, `main.py:342-360`); a session filter without `user_id` is the cross-user leak (`scope.ts:74-76`).

#### Evidence
`scoped-memory.ts:111-112` — session builds `{ws, user_id, session_id}` only when userId present, else `{ws, session_id}` (the leak).

#### Files to edit
- `packages/core/src/domain/scope.ts` — `userId` required on Session/Agent scopes
- `packages/core/src/infrastructure/db/scoped-memory.ts` — `toFilters` always includes `user_id`
- callers: `packages/core/src/domain/index.ts`, `packages/mcp/src/tools/recall-schema.ts`, `packages/core/src/infrastructure/db/recall-cache/scope-key.ts`, `packages/core/src/infrastructure/db/reflection/threshold-reflection-policy.ts`

#### Deep file dependency analysis
The 5 SessionScope/AgentScope consumers (Baseline § Current callers) must pass `userId`; typecheck enforces it.

#### TDD
- RED: `scope.test.ts` — `test_session_scope_requires_user_id`: constructing a `SessionScope` without `userId` is a type error (compile-time) AND `toFilters(sessionScope)` ALWAYS contains `user_id` (runtime assertion). Assertion: `expect(toFilters({kind:'session',userId:'u',sessionId:'s'}, 'w')).toEqual({workspace_id:'w',user_id:'u',session_id:'s'})`.
- GREEN: required field + always-include filter.
- REFACTOR: collapse the session/agent branches now that userId is unconditional.

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- `toFilters({kind:'session',userId:'u',sessionId:'s'},'w')` returns exactly `{workspace_id:'w',user_id:'u',session_id:'s'}` (assert deep-equal in `scope.test.ts`).
- `grep -c 'user_id' scoped-memory.ts toFilters` shows `user_id` present in 100% of session/agent branches (0 branches omit it).
- `npm run typecheck` exits 0 with all 5 SessionScope/AgentScope callers updated (0 type errors).

#### DoD
`npm run test` green; `npm run typecheck` clean.

### T1.2 — Migrate the public `Memory.session`/`Memory.agent` API + the 6 scope-reconstruction sites

#### Objective
`Memory.session(userId, sessionId)` / `Memory.agent(userId, agentId)` require a `userId`; every internal site that rebuilds a scope from a row/filters carries the row's `user_id`.

#### Why this step (action + reasoning)
Action: change `local-memory.ts:108,121` signatures to take `userId` first; update `pipeline-helpers.ts:117,120`, `scope-candidate.ts:55,57`, `retrieval/pipeline.ts:94,97`, `scoped-memory.ts:174,177` to read `user_id` from the row/filters into the reconstructed scope.
Reasoning: per ADR D5 — D1's mandatory `userId` is a public-API break, not a mechanical fix; a session/agent must belong to a user in the `(workspace, user)` model.

#### Evidence
`local-memory.ts:108` `{ kind: 'session', sessionId }` (no userId — the public API gap); 6 reconstruction sites enumerated in D5.

#### Files to edit
- `packages/core/src/infrastructure/db/local-memory.ts` — public `session`/`agent` signatures
- `packages/core/src/domain/extraction/pipeline-helpers.ts` — carry `filters.user_id`
- `packages/core/src/infrastructure/db/eviction/scope-candidate.ts` — carry `row.user_id`
- `packages/core/src/domain/retrieval/pipeline.ts` — carry `filters.user_id`
- `packages/core/src/infrastructure/db/scoped-memory.ts` — carry `user_id` in reconstruction (`:174,177`)

#### Deep file dependency analysis
The reconstruction sites already receive a row/filters that carries `user_id` (the column exists); they currently DROP it when rebuilding the scope. This task threads it through.

#### TDD
- RED: `local-memory-scope-api.test.ts` — `test_memory_session_requires_user_id`: `Memory.session('u','s')` produces a scope whose `filtersFromScope` yields `{workspace_id, user_id:'u', session_id:'s'}`; calling `Memory.session('s')` (old 1-arg form) is a type error.
- GREEN: add the required `userId` parameter + thread it in the 6 sites.
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- `Memory.session('u','s')` yields a scope that `filtersFromScope` maps to `{workspace_id,user_id:'u',session_id:'s'}` (assert deep-equal).
- `grep -c "kind: 'session', sessionId }" packages/core/src` returns 0 (no reconstruction site drops `user_id`) — assert count 0.
- `npm run typecheck` exits 0 (all `Memory.session`/`Memory.agent` call sites migrated).

#### DoD
`npm run test` green; `npm run typecheck` clean.

## Phase 2: `MemoryRoutingPolicy` DIP + agent-chosen routing + attribution

### T2.1 — `MemoryRoutingPolicy` DIP + `DefaultRoutingPolicy` + agent-choice wiring

#### Objective
A `MemoryRoutingPolicy` interface that maps a write (caller-chosen durable/ephemeral hint + Principal) to a target scope, with a backward-compat default.

#### Why this step
Action: add `domain/routing-policy.ts` with the interface + default; wire the MCP durable hint → global `(workspace,user)`, hook → session `(workspace,user,session)`.
Reasoning: ADR D2 (agent chooses, mem0 `main.py:721`); DIP per `rules/architecture.md § 2`.

#### Evidence
Blueprint Recommendations → "the agent chooses scope on write (add() kwargs pattern)".

#### Files to edit
- `packages/core/src/domain/routing-policy.ts` (NEW) — interface + `DefaultRoutingPolicy`
- `packages/core/src/domain/index.ts` — export the DIP
- `packages/mcp/src/tools/*` — pass the durable/ephemeral choice

#### Deep file dependency analysis
The policy is pure domain (no I/O); the MCP layer supplies the agent's choice; the store consumes the resolved scope.

#### TDD
- RED: `routing-policy.test.ts` — `test_default_policy_routes_hook_to_session_and_durable_to_global`: `DefaultRoutingPolicy.route({hint:'ephemeral', principal})` → session scope `(ws,user,session)`; `{hint:'durable'}` → global `(ws,user)`.
- GREEN: implement the mapping.
- REFACTOR: extract the hint enum.

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- `DefaultRoutingPolicy.route({hint:'durable',principal})` returns a scope equal to `{kind:'user',userId}` (global) — assert deep-equal.
- `DefaultRoutingPolicy.route({hint:'ephemeral',principal})` returns `{kind:'session',userId,sessionId}` — assert deep-equal.
- Both returned scopes contain `userId` (assert `scope.userId === principal.userId` in 100% of routed cases).

#### DoD
`npm run test` green.

### T2.2 — Attribution (`attributed_to` = user|agent) wired for the Claude Code write paths

#### Objective
Each Claude Code write records `attributed_to` = `user` (human turn) or `agent` (assistant-observed), reusing the existing column.

#### Why this step
Action: set `RememberOptions.attributedTo` on the hook/MCP write paths.
Reasoning: ADR D3 + blueprint D2 (`main.py:308-311`); Rule 9 (reuse `0008_attributed_to.sql`).

#### Files to edit
- `packages/mcp/src/tools/remember-schema.ts` / handler — thread the attribution
- `docs/claude-code-kit/hooks/theo-remember.mjs` — set attribution on the hook write

#### Deep file dependency analysis
`attributed_to` already persists via `options.ts:26`; this only sets it on the Claude Code paths.

#### TDD
- RED: `attribution.test.ts` — `test_agent_write_sets_attributed_to_agent`: an MCP remember with `attributedTo:'agent'` persists `attributed_to='agent'`; coexists in the same scope as a `user` memory.
- GREEN: thread the field.
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- An MCP remember with `attributedTo:'agent'` persists a row whose `attributed_to` column equals `'agent'` (assert `SELECT attributed_to` = 'agent').
- A `user`-attributed and an `agent`-attributed memory in the same `(ws,user,session)` both return from one recall (assert result set contains both `attributed_to` values).

#### DoD
`npm run test` green.

## Phase 3: Composite scope index (the bottleneck)

### T3.1 — Migration 0024: composite btree `(workspace_id, user_id, session_id)` on `memories`

#### Objective
A composite btree index leading with the isolation columns so the per-read `(workspace, user[, session])` filter is index-backed, not a full scan.

#### Why this step
Action: add `migrations/0024_*.sql` — `CREATE INDEX CONCURRENTLY memories_ws_user_session_idx ON memories (workspace_id, user_id, session_id) WHERE t_invalid IS NULL`.
Reasoning: graphiti puts the partition key in EVERY index (`graph_queries.py:32-70`); today only single-column indexes exist (`0000_crazy_mimic.sql:48-50`) — the composite filter is unindexed.

#### Evidence
`0000_crazy_mimic.sql:48-50` (single-column only); blueprint Q2/ADR D1.

#### Files to edit
- `packages/core/src/infrastructure/db/migrations/0024_*.sql` (NEW)
- the drizzle schema snapshot (`migrations/meta/`)

#### Deep file dependency analysis
Additive index; no column change. `CONCURRENTLY` avoids table lock (Drawbacks § MEDIUM).

#### TDD
- RED: `schema-m8-index.test.ts` (integration, real pgvector) — `test_composite_scope_index_exists`: after migrations, `pg_indexes` contains `memories_ws_user_session_idx`.
- GREEN: the migration.
- REFACTOR: none.

#### Concurrency tests
The index is built with `CREATE INDEX CONCURRENTLY` (online, non-blocking). A **parallel test** (concurrent test) drives the migration WHILE a background writer inserts rows into `memories`: assert the concurrent build completes AND the parallel inserts observe no blocking/error — the race-aware proof that the online index build never blocks concurrent writers.

#### Acceptance Criteria
- `SELECT indexname FROM pg_indexes WHERE tablename='memories'` includes `memories_ws_user_session_idx` (assert row present).
- `EXPLAIN` of the `(workspace_id,user_id,session_id)` filter reports `Index Scan using memories_ws_user_session_idx` (assert the plan line contains the index name, not `Seq Scan`).

#### DoD
`npm run test:integration` green for the schema test.

## Phase 4: Cross-user isolation hard-gate + OTel + benchmark

### T4.1 — Cross-user isolation integration test (the hard gate)

#### Objective
Prove against real `ankane/pgvector:v0.5.1` that user B reads zero of user A's global/session rows in the same workspace.

#### Why this step
Action: an integration test seeding user A (global + session) and asserting user B's recall returns none of A's rows.
Reasoning: blueprint Coverage Corner 1 — NEITHER mem0 nor graphiti ships this; M8 originates it. M8 DoD hard gate.

#### Evidence
Blueprint § Coverage Corner 1 — Integration Tests (neither mem0 nor graphiti ships this negative test).

#### Files to edit
- `packages/core/src/infrastructure/db/cross-user-isolation.integration.test.ts` (NEW)

#### Deep file dependency analysis
Uses the existing real-pgvector integration harness (Baseline: co-located `*.test.ts`, `vitest.integration.config.ts`).

#### TDD
- RED: `test_user_b_reads_zero_of_user_a_rows`: seed `(ws, userA)` global + `(ws, userA, sessionA)` session; recall as `(ws, userB)` and as `(ws, userB, sessionB)` → both return 0 of A's memory ids.
- GREEN: passes once T1.1 filter is in place.
- REFACTOR: extract the seed helper.

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- After seeding `(ws,userA)` global + `(ws,userA,sessionA)` session, a recall as `(ws,userB)` returns exactly 0 memory ids belonging to userA (assert `intersection(resultIds, userA_ids).length === 0`).
- A recall as `(ws,userA)` returns ≥1 of userA's own ids (assert `resultIds ⊇ userA_ids` non-empty) — the isolation is per-user, not a total block.

#### DoD
`npm run test:integration` green.

### T4.2 — OTel `MEMORY_EVENTS` routing event

#### Objective
Every routing decision emits a typed event naming chosen scope + attribution + who decided.

#### Why this step
Action: add a `memory_routed` literal to `MEMORY_EVENTS` and emit it in the routing path.
Reasoning: Princípio 3 (auditability); the existing typed-event union pattern (`emitEvent`).

#### Files to edit
- `packages/core/src/domain/memory-event.ts` — add the literal
- the routing path — `emitEvent(tracer, 'memory_routed', …)`

#### TDD
- RED: `routing-event.test.ts` — `test_routing_emits_typed_event`: a routed write emits `memory_routed` with `{scope, attributed_to, decided_by}`.
- GREEN: emit it.
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- A routed write emits exactly one `memory_routed` span/event whose attributes include `scope`, `attributed_to`, and `decided_by` (assert all three keys present and non-empty in the captured event).

#### DoD
`npm run test` green.

### T4.3 — Benchmark: composite-index filter latency

#### Objective
Measure isolation-filter latency with vs without the composite index (≥3 runs, mean±stddev).

#### Why this step
Action: a benchmark seeding N rows across users and timing the `(workspace, user, session)` filter with the index present vs a DROP-index baseline.
Reasoning: blueprint — the composite index is the bottleneck answer; the DoD demands benchmark evidence.

#### Files to edit
- `benchmarks/m8-isolation-filter.bench.ts` (NEW)

#### TDD
- RED: `test_benchmark_reports_mean_stddev`: the bench emits a JSON with mean±stddev over ≥3 runs for both arms.
- GREEN: implement.
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- The benchmark JSON reports `runs>=3`, `mean_ms` and `stddev_ms` for BOTH the with-index and without-index arms (assert all four numeric fields present per arm).
- `with_index.mean_ms < without_index.mean_ms` on the seeded table (assert the index arm is strictly faster).

#### DoD
Benchmark JSON produced + committed under `docs/benchmarks/`.

## Phase 5: Owner sign-off ADR + CLAUDE.md amendment (locked-name)

### T5.1 — Record the owner sign-off for the SessionScope contract + "Memory tiers" name

#### Objective
An ADR + a CLAUDE.md amendment recording the owner's `/goal` sign-off for the mandatory-`user_id` contract change.

#### Why this step
Action: write `.claude/knowledge-base/adrs/ADR-00xx-mandatory-user-id-isolation.md` + amend CLAUDE.md § locked names.
Reasoning: the locked "Memory tiers" name + optional-userId contract require owner sign-off (CLAUDE.md § When this file is wrong); the `/goal` directive is that sign-off.

#### Files to edit
- `.claude/knowledge-base/adrs/ADR-00xx-mandatory-user-id-isolation.md` (NEW)
- `packages/core/CLAUDE.md` OR the repo `CLAUDE.md` § locked names — the amendment
- `CHANGELOG.md` `[Unreleased]`

#### TDD
- RED: `test_e2e_smoke`-style xref — the ADR file exists and CLAUDE.md references it (a grep assertion in the plan's validation; non-code doc gate).
- GREEN: write the files.
- REFACTOR: none.

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- The file `.claude/knowledge-base/adrs/ADR-00xx-mandatory-user-id-isolation.md` exists (assert `test -f`).
- CLAUDE.md contains a line referencing the ADR filename (assert `grep -q 'mandatory-user-id-isolation' CLAUDE.md`).
- CHANGELOG `[Unreleased]` contains an entry mentioning M8 mandatory user_id (assert `grep`).

#### DoD
`python3 scripts/check_xrefs.py` passes (if present); CHANGELOG has the entry.

## Coverage Matrix

| Requirement (from Goal + M8 DoD) | Task(s) |
|---|---|
| `user_id` mandatory in Session/Agent; filter by full composite key | T1.1 |
| Public `Memory.session`/`Memory.agent` API migration + 6 reconstruction sites (D5) | T1.2 |
| MemoryRoutingPolicy DIP; agent chooses global vs session | T2.1 |
| `attributed_to` = user\|agent orthogonal | T2.2 |
| Composite `(workspace_id, user_id, session_id)` index | T3.1 |
| Cross-user isolation PROVEN (hard gate) | T4.1 |
| Typed OTel routing event | T4.2 |
| Benchmark (mean±stddev, ≥3 runs) | T4.3 |
| Owner sign-off (ADR + CLAUDE.md) | T5.1 |

**Coverage: 8/8 requirements mapped (100%)**

## Global Definition of Done

- [ ] `npm run test` (contract) green
- [ ] `npm run test:integration` green (real pgvector) — including the cross-user isolation hard gate
- [ ] `npm run typecheck` clean (all Session/Agent callers updated)
- [ ] `npm run lint` clean
- [ ] `/code-quality` verdict ∈ {PASS, PASS_WITH_CAVEATS}
- [ ] Benchmark JSON committed under `docs/benchmarks/`
- [ ] CHANGELOG `[Unreleased]` updated (Unbreakable Rule 6)
- [ ] No file exceeds 500 LoC (`rules/architecture.md`)

## Failure scenarios (when I/O external)

External dependency: Postgres + pgvector (DB driver).

1. **DB connection drops mid-recall during a scoped query** — the recall must fail-fast with a typed error (not return a partial/unscoped result set). Test: kill the connection and assert a typed error, never rows from another scope.
2. **Migration 0024 `CREATE INDEX CONCURRENTLY` fails partway** (invalid index left behind) — the migration must be idempotent (`IF NOT EXISTS`) and a re-run must recover. Test: apply twice; second run is a no-op.
3. **A scope with a NULL user_id reaches the store (legacy row, D4)** — the composite filter must simply not match it (no crash, no cross-user surfacing). Test: insert a legacy NULL-user session row; assert a `(ws, user, session)` query returns zero and does not error.

## Final Phase: Integration Validation (MANDATORY)

### Execution
```bash
npm run typecheck
npm run lint
npm run test
npm run test:integration   # real ankane/pgvector:v0.5.1 — cross-user isolation hard gate
node benchmarks/m8-isolation-filter.bench.ts   # mean±stddev, >=3 runs
```

### Acceptance Criteria
- All gates green; the cross-user isolation test PASSES (user B → 0 of user A's rows).
- Benchmark shows the composite index is used (index scan) and reports mean±stddev.
- `/code-quality` ∈ {PASS, PASS_WITH_CAVEATS}.

### If Validation Fails
Loop back to the failing task (do NOT edit the plan). A cross-user leak in T4.1 is a BLOCKER — return to T1.1.
