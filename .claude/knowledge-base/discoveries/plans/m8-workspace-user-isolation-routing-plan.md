# Discovery Plan: M8 — `(workspace, user)` isolation + agent-chosen session↔global routing

> **Version 1.1** (2026-07-21 — absorbed EC-1/EC-2/EC-3 MUST FIX + EC-4 ADR from `.claude/knowledge-base/reviews/m8-workspace-user-isolation-routing-edge-cases-2026-07-21.md`). Investigate how two production multi-tenant memory systems (`mem0`, `graphiti`) shape their scope key, enforce per-principal isolation at the query layer, route writes between a durable and an ephemeral scope, carry authorship attribution, and index the composite key at scale. The blueprint grounds M8's hardening of `(workspace, user)` into a real isolation boundary + agent-chosen `session`↔`global` routing against real code — FAANG-level, no workarounds.

**Slug:** `m8-workspace-user-isolation-routing`
**Owner:** usetheodev (project owner directive `/goal` 2026-07-21)
**Created:** 2026-07-21
**Time budget:** 6h (mem0: 3.5h, graphiti: 2.5h — see ADR D1)

## Context

The M6/M7 Claude Code integration proved every write lands in one durable scope while the `session`/`agent` tiers sit empty AND their `user_id` is optional (`packages/core/src/domain/scope.ts:16-17,23-24` — `SessionScope.userId?` / `AgentScope.userId?`). `scope.ts:74-76` documents `user_id` within a workspace as "a partition, NOT the security boundary". theo-memory is **multi-tenant AND multi-user-per-tenant** (RBAC `Principal { workspaceId, userId, role, scopes }`), so the isolation unit MUST be the composite `(workspace, user)`, with `session` = `(workspace, user, session)` — and NO `(workspace)`-only shared scope (cross-user read is forbidden). M8 (ROADMAP.md § M8, revised 2026-07-21) hardens this. Before writing the plan, we investigate how the field solves the same problem so M8 borrows the proven shape rather than inventing one (Unbreakable Rule 9). Governs: `rules/architecture.md` (§ 1-2 DIP boundaries any borrowed pattern must respect), `rules/testing.md` (§ 4.1 the isolation/negative-case test any borrowed test technique must satisfy), `CLAUDE.md § Amendment 2026-06-17` (the `(workspace, user)` model this extends).

## Objective

Produce a blueprint that lets M8 decide the exact scope-key shape, query-layer isolation enforcement, durable-vs-ephemeral routing mechanism, attribution field, and composite-index design — each backed by real `mem0`/`graphiti` code. Success criteria:

- [ ] All 7 research questions answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated for both mem0 and graphiti
- [ ] Recommendations section provides ≥ 1 concrete decision proposal per research question, mapped to an M8 DoD item
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mem0/` | `mem0/memory/main.py`, `mem0/vector_stores/`, `tests/memory/`, `pyproject.toml` | mem0's `add()`/`search()` scope model (user_id/agent_id/run_id) is the closest analog to theo-memory's own tiers — the primary borrow target |
| `.claude/knowledge-base/references/graphiti/` | `graphiti_core/graph_queries.py`, `graphiti_core/search/`, `tests/`, `docker-compose.test.yml`, `Makefile` | graphiti's `group_id` namespace isolation + composite-index design is the reference for the query-layer enforcement + the index bottleneck |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/mem0/docs/`, `.../graphiti/docs/` | Marketing/prose docs, not source of truth |
| `.../mem0/mem0/vector_stores/{azure_*,baidu,...}` (non-pgvector stores) | M8 targets the pgvector path; other stores are noise |
| `.../graphiti/graphiti_core/llm_client/`, `.../embedder/` | LLM/embedding wiring is unrelated to scope isolation |
| Any project NOT cloned into `.claude/knowledge-base/references/` | Cross-Project Rule: never claim a feature without reading its source |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** mem0: 3.5h (primary analog — deepest dive on scope key + routing + tests). graphiti: 2.5h (index/enforcement reference).

**Rationale:** mem0's `add()` signature and filter builder map almost 1:1 onto theo-memory's tier model, so it drives the routing + key-shape decisions. graphiti is consulted specifically for the composite-index-at-scale answer (its Cypher index DDL is explicit) and a second, independent enforcement pattern. Alternatives considered: equal split (rejected — mem0 is the closer analog), mem0-only (rejected — we need the index/bottleneck answer graphiti makes explicit).

**Stop condition — per question:** After 3 query-variant retries with empty Fase A matches, mark the question BLOCKED ("Fase A exhausted") and continue. NEVER fabricate a Fase B answer (Unbreakable Rule 3).

**Stop condition — per project:** Budget exhausted with questions pending → mark them BLOCKED ("budget exhausted"), continue. If every remaining question is `done` or honestly `blocked`, emit `<promise>BLUEPRINT_BLOCKED</promise>`, never `BLUEPRINT_COMPLETE` from a blocked state.

**Consequences:** the halt-loop stops per-project at budget; blocked questions surface in the blueprint's `## Blocked questions` section as next-discovery seed.

### D2 — Investigation depth

**Decision:** Read the scope-key and filter-builder functions end-to-end (they are load-bearing); Grep-then-Read for tests and deps.

**Rationale:** the scope-key shape and the query-layer filter builder are the exact code M8 mirrors — reading them fully avoids a partial-understanding bug. Tests/deps need only the relevant slices. Alternatives: grep-only (rejected — misses intent/edge-cases in the filter builder), read-everything (rejected — busts the budget).

**Consequences:** deepest reading concentrated on `mem0/memory/main.py` (`_build_filters_and_metadata`, `add`, `get_all`) and `graphiti_core/graph_queries.py` + `search/`.

### D3 — graphiti is the single-key CONTRAST + composite-INDEX source, NOT a 3-part-key source (EC-4)

**Decision:** treat graphiti's `group_id` as a SINGLE partition key (`nodes.py:96` — "partition of the graph"; `delete_by_group_id(group_id: str)`), not as a `(tenant, user, session)` composite. The borrowable graphiti lesson is strictly: **the partition key appears in EVERY index and EVERY query filter** (`graph_queries.py:32-64`). The 3-part composite `(workspace, user, session)` is theo-memory's NOVEL design; mem0's `(user_id | run_id) + actor_id` is the closer analog for the key shape.

**Rationale:** verified during edge-case review — graphiti does not model per-user-within-tenant sub-scoping; mistaking its single `group_id` for a composite would produce a wrong blueprint recommendation. Alternatives considered: drop graphiti (rejected — its index-in-every-query discipline is the exact bottleneck answer M8 needs).

**Consequences:** Q2/Q5 answers frame graphiti as the single-key + index-discipline reference; the composite-key shape recommendation comes from mem0 + theo-memory's own model, not graphiti.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad map) | Fase B (deep — Read) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | What is mem0's scope-key shape on write — are `user_id`/`agent_id`/`run_id` mandatory, is it a SINGLE-scope choice or a COMPOSITE `(user, session)`, and how does `_build_filters_and_metadata` turn them into the stored metadata + effective filter? | techniques | `.claude/knowledge-base/references/mem0/` | Grep `_build_filters_and_metadata`, `add(`, `_add_to_vector_store` in `mem0/memory/main.py` | Read `mem0/memory/main.py:287` (`_build_filters_and_metadata`) end-to-end + `:721-825` (`add`) | Prose + citation: is the key single-scope or composite? Which field is mandatory? How is the effective filter built? |
| Q2 | How does graphiti enforce namespace/tenant isolation via `group_id` at the QUERY layer, and how is the composite key INDEXED (the at-scale bottleneck)? | techniques | `.claude/knowledge-base/references/graphiti/` | Grep `group_id`/`group_ids` in `graphiti_core/graph_queries.py` + `graphiti_core/search/search.py`,`search_utils.py` | Read `graph_queries.py:30-70` (the `CREATE INDEX ... (n.uuid, n.group_id, ...)` DDL) + the group_ids filter in `search/` | Index DDL + query-filter citation; is `group_id` in every index? single-column or composite? |
| Q3 | How does mem0 model DURABLE vs EPHEMERAL scope — `run_id` (session) + `expiration_date` vs `user_id` (durable) — WHO chooses on write, and how is authorship attribution carried orthogonally to the scope via the **`actor_id`** primitive (EC-3)? | techniques | `.claude/knowledge-base/references/mem0/` | Grep `expiration_date`, `run_id`, `actor_id`, `resolved_actor_id` in `mem0/memory/main.py` | Read `main.py:287-366` (the `_build_filters_and_metadata` actor-filtering precedence block — `actor_id` is "For query-time filtering", `:292`) + `:721-790` (add + expiration) | Table: durable (`user_id`) vs ephemeral (`run_id`+`expiration_date`) scope field + who sets it + how `actor_id` attribution coexists orthogonally (message `role` is only the extraction input, NOT the stored attribution) |
| Q4 | How does mem0's test suite PROVE scope isolation — that a filter scoped to `user_id=A` never returns `user_id=B`'s memories (the cross-user negative case)? | tests | `.claude/knowledge-base/references/mem0/` | Grep `user_id`,`agent_id`,`actor_id`,`filters` in `tests/memory/test_main.py` + `test_storage.py` | Read the matching test(s) + fixtures. **Fallback (EC-2):** if NO dedicated cross-user negative test exists, capture how `_build_filters_and_metadata` scoping is unit-asserted AND record the ABSENCE of a dedicated cross-user negative test as a finding — a gap M8 must CLOSE (with its own hard-gate test), not copy | Test name → fixture → assertion, with `tests/memory/test_main.py:line` citations; OR an explicit "no dedicated cross-user negative test found" finding |
| Q5 | How does graphiti's test suite prove `group_id` partition isolation (a query in group A does not surface group B)? | tests | `.claude/knowledge-base/references/graphiti/` | Grep `group_id` in `tests/` (`test_node_int.py`, `helpers_test.py`, integration tests) | Read the matching integration test + its graph fixture/setup | Test name → setup → assertion, with `tests/...:line` citations |
| Q6 | What store + driver + versions back mem0's pgvector path and graphiti's graph store, and does the STORE enforce the scope filter natively (SQL WHERE / Cypher) or is it app-layer only? | deps | `.claude/knowledge-base/references/mem0/`, `.claude/knowledge-base/references/graphiti/` | Grep `pgvector`/`psycopg`/`neo4j`/`falkordb` in `mem0/pyproject.toml` + `graphiti/pyproject.toml` | Read `mem0/vector_stores/pgvector.py` (verified to exist, EC-1) — where the SQL WHERE scope clause is emitted — + the graphiti driver; check native vs app-layer | Version ranges + "native vs app-layer" verdict per project, with citations |
| Q7 | What is the local-dev + test-DB story for both — how is a real DB stood up for the isolation integration tests (docker-compose / Makefile / conftest)? | tools | `.claude/knowledge-base/references/mem0/`, `.claude/knowledge-base/references/graphiti/` | SKIP Fase A (text-shape). Glob `docker-compose*.yml`, `Makefile`, `conftest.py` in both | Read `graphiti/docker-compose.test.yml` + `graphiti/Makefile`; mem0 `pyproject.toml` `[tool.pytest]` + any `tests/conftest.py` | Step-by-step: how each project stands up a real DB for integration tests |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4, Q5 | Covered |
| Dependencies | Q6 | Covered |
| Tools | Q7 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Each `.claude/knowledge-base/references/{project}/{path}` declared in Fase A exists | Mark Qx BLOCKED ("path not found"), continue |
| Per-question Fase A budget | Fase A returned ≥ 1 hotspot OR 3 query-variant retries attempted | After 3 retries empty, mark Qx BLOCKED ("Fase A exhausted"); continue |
| After answering Qx | Blueprint section under Qx has ≥ 1 citation to `.claude/knowledge-base/references/` | Re-iterate Qx (1 retry max) |
| Mid-loop sanity | ≥ 1 reference citation per ~200 words of blueprint prose | Add citations to under-cited paragraphs (1 retry max) |
| Per-project time budget | Project budget not exhausted | When exhausted, mark remaining Qx for that project BLOCKED ("budget exhausted"); advance |
| Before promising complete | All 4 coverage corners have populated sections + ≥ 1 ADR | Refuse promise, continue iterating |

## Acceptance Criteria

- [ ] All 7 research questions answered OR explicitly BLOCKED with reason
- [ ] Every citation resolves under `.claude/knowledge-base/references/` (Path.exists)
- [ ] All 4 coverage corners populated
- [ ] Cross-cutting comparison table (mem0 vs graphiti) present
- [ ] ≥ 1 ADR in the blueprint
- [ ] Each recommendation maps to a specific M8 DoD item (scope-key mandatory-user_id / query-layer isolation / routing / attribution / composite index / isolation test)

## Global Definition of Done

Per `rules/discover-blueprint-golden-rule.md`: no empty coverage corner, no fabricated citation. Target `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS. Thresholds: `rules/discover-blueprint-thresholds.txt`.
