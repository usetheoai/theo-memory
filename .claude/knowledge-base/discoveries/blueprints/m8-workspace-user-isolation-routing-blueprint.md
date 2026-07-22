# Blueprint: M8 — `(workspace, user)` isolation + agent-chosen session↔global routing

> Deep-research blueprint grounding M8 against `mem0` and `graphiti`. Verdict target ≥ SHIPPABLE_WITH_CAVEATS. All citations resolve under `.claude/knowledge-base/references/`. Produced by `/discover-execute` from `m8-workspace-user-isolation-routing-plan.md` v1.1.

**Slug:** `m8-workspace-user-isolation-routing`
**Created:** 2026-07-21
**Sources:** `mem0` (Apache-2.0), `graphiti` (Apache-2.0)

## Context

M8 hardens theo-memory's `(workspace, user)` into a real isolation boundary and adds agent-chosen `session`↔`global` routing (ROADMAP.md § M8, revised 2026-07-21). Today `SessionScope.userId?` / `AgentScope.userId?` are optional (`packages/core/src/domain/scope.ts:16-17,23-24`) and `scope.ts:74-76` calls `user_id` within a workspace "a partition, NOT the security boundary" — a latent cross-user exposure in a multi-tenant, multi-user system. Before designing M8 we investigate how `mem0` and `graphiti` shape their scope key, enforce isolation, route durable-vs-ephemeral writes, carry attribution, and index the composite key — so M8 borrows a proven shape (Unbreakable Rule 9) rather than inventing one.

## Objective

Ground each M8 decision — mandatory `user_id`, query-layer isolation, agent-chosen routing, orthogonal `attributed_to`, composite index — in real reference code, and surface the one gap (a cross-user negative test) that M8 must originate. Success = every research question answered with a resolving citation, all four coverage corners populated, and each recommendation mapped to a specific M8 DoD item.

## Executive summary

The field validates every load-bearing decision in M8's corrected model:

1. **Composite scope keys are the norm, not the exception.** mem0 composes `user_id` + `agent_id` + `run_id` into BOTH the stored metadata AND the query filter, and requires **at least one** (`_build_filters_and_metadata`, `main.py:342-366`). theo-memory's `(workspace, user[, session])` is the same shape, one level deeper (workspace as the outer tenant anchor).
2. **The isolation mechanism = the same key in storage AND in the query filter.** mem0 writes the ids into `base_metadata_template` and the identical ids into `effective_query_filters` (`main.py:342-360`); a query for `user_id=A` can never match `user_id=B`'s rows. This is app-layer filter composition, enforced natively at the store via SQL `payload->>'user_id' = %s` (`vector_stores/pgvector.py:37,50`).
3. **Attribution is a distinct, query-time-only dimension.** mem0's `actor_id` is "For query-time filtering" and is deliberately NOT written into the storage metadata ("the actor for storage is typically derived from message content at a later stage", `main.py:308-311,366-369`). This is exactly M8's `attributed_to` (user vs agent), orthogonal to the scope key.
4. **The caller chooses the scope.** mem0's `add()` takes the ids as keyword args (`main.py:721-733`); whichever the caller passes IS the scope. That is M8's "the agent chooses session vs global".
5. **The partition key belongs in EVERY index** — graphiti puts `group_id` in every composite range index AND a dedicated single-column index per label (`graph_queries.py:32-70`). This is the at-scale bottleneck answer for M8's composite `(workspace_id, user_id[, session_id])` index.

The one gap the field does NOT close for us: **neither reference ships a dedicated cross-user retrieval NEGATIVE test** (query as A must return zero of B's rows). mem0 unit-tests the filter builder; graphiti integration-tests positive `group_id` retrieval. M8 must therefore CLOSE this gap with its own hard-gate integration test — do not copy the absence.

## Coverage Corner 1 — Integration Tests

**Q4 — How does mem0 prove scope isolation?** mem0's `tests/memory/test_main.py` exercises the filter path (`filters={}` / `effective_filters={}` on add, e.g. `:60,271`) and metadata scoping (`"user_id": "test_user"`, `:222`), and the mandatory-id contract is enforced in production code (`_build_filters_and_metadata` raises `Mem0ValidationError VALIDATION_001` "At least one of 'user_id', 'agent_id', or 'run_id' must be provided", `main.py:360-366`). **Finding (EC-2 confirmed):** there is NO dedicated cross-user negative test asserting "a query scoped to user A returns zero of user B's memories". Isolation is proven only at the filter-COMPOSITION level, not at the retrieval level.

**Q5 — How does graphiti prove `group_id` partition isolation?** `tests/test_node_int.py` creates nodes with an explicit `group_id` (`:33,47,64,79`) and retrieves them via `EntityNode.get_by_group_ids(graph_driver, [group_id], limit=2, with_embeddings=True)` (`:106-107`) against a real graph driver — a positive integration test that the partition filter scopes retrieval. Again, it is a positive scoping test, not a cross-group negative test.

**Borrow for M8:** the integration-test *shape* (real DB, scope-in → scoped rows out) is correct and matches theo-memory's existing suite. **M8 must ADD what neither ships:** a cross-user NEGATIVE integration test against real `ankane/pgvector:v0.5.1` — user B's recall returns zero of user A's `global`/`session` rows. This is already an M8 DoD hard gate; the field confirms it is a genuine novel contribution, not a copy.

## Coverage Corner 2 — Dependencies

**Q6 — Store + driver + native vs app-layer enforcement.** mem0's pgvector path depends on `vecs>=0.4.0` + `psycopg>=3.2.8` + `psycopg-pool>=3.2.6,<4.0.0` (`pyproject.toml:32,41-42`). The scope filter is enforced **natively in SQL**: `_build_filter_conditions` (`vector_stores/pgvector.py:50`) translates the processed filter dict into WHERE fragments using JSONB extraction — `payload->>%s = %s` for equality (`:37`), `payload->>%s = ANY(%s)` for `in` (`:43`). So scope ids live in a JSONB `payload` column and are filtered by `payload->>'user_id' = 'A'`.

graphiti backs onto a graph store (Neo4j / FalkorDB / Kuzu, per `GraphProvider`) and enforces the partition via Cypher `group_id` predicates + the per-label indexes below.

**Contrast that shapes M8:** mem0 puts scope ids in a JSONB `payload` (flexible, but a JSONB expression index is weaker than a native btree). **theo-memory already uses DEDICATED COLUMNS** (`workspace_id`, `user_id`, `session_id`) — strictly better for the composite-filter bottleneck. M8 keeps the dedicated-column model and adds a composite btree index leading with the partition columns (see Techniques). Do NOT regress to JSONB-payload scoping.

## Coverage Corner 3 — Tools

**Q7 — Local-dev + test-DB story.** graphiti stands up a REAL Neo4j for integration tests via `docker-compose.test.yml`: `neo4j:5.26.2` with a healthcheck and the service `depends_on: neo4j: condition: service_healthy` (`docker-compose.test.yml:1-30`). mem0 uses `pytest>=8.2.2` + `pytest-asyncio>=0.23.7` (`pyproject.toml:78-88`) with `psycopg`/`vecs` against a real Postgres+pgvector.

**Borrow for M8:** this is exactly theo-memory's existing convention (integration tests against real `ankane/pgvector:v0.5.1`). No new tooling needed — M8's isolation + routing integration tests ride the existing real-pgvector harness (Rule 9: reuse, don't add).

## Coverage Corner 4 — Techniques

**Q1 — Scope-key shape (the core).** mem0's `_build_filters_and_metadata` (`main.py:287`) validates and trims each of `user_id`/`agent_id`/`run_id` (`:340-342`), and for each provided id writes it into BOTH `base_metadata_template` (storage) and `effective_query_filters` (query) (`:344-360`), appending to `session_ids_provided`. If none provided → `Mem0ValidationError VALIDATION_001` (`:360-366`). A helper `_build_session_scope(filters)` (`:372`) builds a deterministic composite scope string `agent_id=…&run_id=…&user_id=…` from the sorted ids. **Verdict:** mem0's scope key is a COMPOSITE of session ids, at-least-one mandatory, mirrored identically into storage + query. → M8's `(workspace, user[, session])` is the same shape with `workspace` as the outer mandatory anchor and `user` promoted to mandatory (closing theo-memory's current optional `SessionScope.userId?`).

**Q3 — Durable vs ephemeral + attribution.** Durable = `user_id`; ephemeral = `run_id` (session) optionally bounded by `expiration_date`, normalized to `YYYY-MM-DD` via `_normalize_expiration_date` (`main.py:388-403`) and hidden from search once expired. Attribution = `actor_id`, resolved by precedence `actor_id arg → filters["actor_id"]` (`:366-369`), used ONLY for query filtering and explicitly NOT stored in the metadata template ("the actor for storage is typically derived from message content", `:308-311`). → M8: the CALLER (agent) chooses durable (`global`/`user_id`) vs ephemeral (`session`/`session_id`); `attributed_to` (user vs agent) is the query-time-and-storage attribution dimension, orthogonal to the scope key. mem0 keeps attribution out of the scope key — M8 does the same (`attributed_to` is a column, never part of the isolation key).

**Q2 — Partition-key index discipline (the bottleneck).** graphiti places `group_id` in EVERY index: FalkorDB composite range indexes lead each label with `(n.uuid, n.group_id, …)` (`graph_queries.py:32-49`), and the Neo4j path adds a dedicated single-column `group_id` index for every node and edge label (`entity_group_id … ON (n.group_id)`, `episode_group_id`, `relation_group_id`, `mention_group_id`, `has_episode_group_id`, `:64-70`). → M8: the composite `(workspace_id, user_id[, session_id])` filter runs on EVERY read; it MUST be backed by a composite btree index leading with those columns on `memories` (and `entities`/`recall_traces`). Without it, the per-user isolation filter is a full-scan bottleneck at scale. This is the load-bearing performance decision M8's benchmark must measure (filter latency with vs without the composite index).

## Cross-cutting Comparison

| Dimension | mem0 | graphiti | theo-memory (M8 target) |
|---|---|---|---|
| Scope key | composite `user_id`+`agent_id`+`run_id`, ≥1 mandatory (`main.py:342-366`) | single `group_id` partition (`nodes.py:96`) | composite `(workspace, user[, session])`, `workspace`+`user` mandatory |
| Where stored | JSONB `payload` (`pgvector.py:37`) | graph node/edge prop | **dedicated columns** (better index) |
| Isolation enforcement | native SQL `payload->>k = v` (`pgvector.py:50`) | Cypher `group_id` predicate | native SQL on dedicated columns |
| Attribution | `actor_id`, query-time only, not stored in scope (`main.py:308-311,366`) | n/a | `attributed_to` (user/agent), orthogonal column |
| Durable vs ephemeral | `user_id` vs `run_id`+`expiration_date` (`main.py:388`) | n/a (all durable) | `global (workspace,user)` vs `session (workspace,user,session)` |
| Who chooses scope | the caller (add() kwargs, `main.py:721`) | the caller (group_id) | the agent (Claude Code) |
| Index discipline | JSONB expr index | partition key in EVERY index (`graph_queries.py:32-70`) | composite btree leading with `(workspace_id, user_id, …)` |
| Cross-user NEGATIVE test | ABSENT (filter-composition only) | ABSENT (positive group_id only) | **M8 ADDS it (hard gate)** |

## ADRs

### D1 — Keep dedicated scope columns; do NOT adopt mem0's JSONB-payload scoping

**Decision:** M8 keeps theo-memory's dedicated `workspace_id`/`user_id`/`session_id` columns and adds a composite btree index; it does NOT move scope ids into a JSONB payload.

**Rationale:** mem0's JSONB `payload->>'user_id'` (`pgvector.py:37`) is flexible but forces expression indexes; a native composite btree on dedicated columns is faster for the per-read isolation filter. graphiti's "partition key in every index" discipline (`graph_queries.py:32-70`) is the performance lesson, and dedicated columns realize it better than JSONB. **Rejected alternative:** JSONB-payload scoping (regresses index quality).

### D2 — Attribution (`attributed_to`) is orthogonal to the isolation key, never part of it

**Decision:** `attributed_to` (user vs agent) is a column that coexists in every scope; it is NEVER a component of the `(workspace, user[, session])` isolation key.

**Rationale:** mem0 deliberately keeps `actor_id` out of the stored scope and uses it only for query-time narrowing (`main.py:308-311,366-369`). Folding attribution into the isolation key would (a) fragment a user's memory by author and (b) risk a cross-attribution leak. **Rejected alternative:** `(workspace, user, actor)` as the key (fragments the user's own space).

### D3 — graphiti is the single-key + index-discipline reference, not a composite-key source (from plan ADR D3 / EC-4)

**Decision:** graphiti's `group_id` is a single partition key ("partition of the graph", `nodes.py:96`); we borrow only its index-in-every-query discipline, not a 3-part key.

**Rationale:** graphiti does not model per-user-within-tenant sub-scoping. The composite `(workspace, user, session)` shape comes from mem0 + theo-memory's own model. **Rejected alternative:** drop graphiti (rejected — its index discipline is the exact bottleneck answer).

## Recommendations → M8 DoD mapping

| Recommendation | Grounded in | M8 DoD item |
|---|---|---|
| Make `user_id` mandatory in Session/Agent scopes; compose `(workspace, user, session)` mirrored into storage + query filter | mem0 `main.py:342-366` (≥1 mandatory, mirrored) | "`user_id` MANDATORY … every query filters by the FULL composite key" |
| Enforce the scope filter natively on dedicated columns (not JSONB) | mem0 `pgvector.py:37,50` + D1 | "every store/recall query filters by the full composite key of the Principal" |
| Ship a cross-user NEGATIVE integration test (user B → 0 of user A's rows) — the field does NOT have one | Q4/Q5 gap (mem0/graphiti both absent) | "Cross-user isolation invariant PROVEN (hard gate)" |
| `attributed_to` = orthogonal column (user/agent), never in the key | mem0 `main.py:308-311` + D2 | "Attribution recorded per memory: `attributed_to` = user \| agent" |
| The agent chooses scope on write (add() kwargs pattern) | mem0 `main.py:721-733` | "the agent decides `global` vs `session`" |
| Add a composite btree index leading with `(workspace_id, user_id[, session_id])`; benchmark filter latency with/without | graphiti `graph_queries.py:32-70` + D1 | (feeds the M8 benchmark: filter latency at scale) |
| Model ephemeral `session` with decay (existing forgetting pipeline), durable `global` without | mem0 `run_id`+`expiration_date` `main.py:388` | "hook auto-write → session … MCP durable → global" |

## Blocked questions

(none — all 7 questions answered.)
