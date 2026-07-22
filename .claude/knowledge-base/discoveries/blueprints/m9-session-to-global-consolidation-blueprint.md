# Blueprint: M9 — Session → Global Consolidation (within `(workspace, user)`)

> **Version 1.0.** Grounds M9's `ConsolidationPolicy` — promoting durable `session (workspace, user, session)` memories UP to `global (workspace, user)` at the `reflect`/session boundary, with provenance, non-promoted decay, and isolation — against real mem0 + graphiti code AND theo-memory's already-shipped reflect / ConflictResolutionPolicy / EvictionPolicy machinery. **Central finding:** M9 needs NO new consolidation engine and NO new store — it is a COMPOSITION of shipped seams (Unbreakable Rule 9). Source research: `.claude/knowledge-base/discoveries/plans/m9-session-to-global-consolidation-plan.md` (SHIPPABLE_WITH_CAVEATS 89) + its edge-case review.

**Slug:** `m9-session-to-global-consolidation`
**Owner:** usetheodev (via `/goal` M9 directive)
**Created:** 2026-07-22

## Context

M8 (shipped on `develop`, PR #106) fills the ephemeral `session (workspace, user, session)` scope via agent-chosen routing; without promotion, a durable fact captured mid-conversation decays with the session noise under the shipped triadic eviction. M9 closes that gap. This blueprint is triggered by ROADMAP.md § M9 (added 2026-07-21) and grounded in the SHIPPED reflect / ConflictResolutionPolicy (v0.7 distillation) / EvictionPolicy (v0.4b) machinery + theo-memory Princípio 1 (`theo-memory/CLAUDE.md § Princípio 1`), and researched against mem0 + graphiti. It MUST stay inside the user's isolation (`theo-data/CLAUDE.md` invariant 2 `workspace_id == tenant_id`).

## Objective

Decide HOW to compose a `session → global` `ConsolidationPolicy` (promotion trigger + provenance + non-promoted decay + isolation) by REUSING theo-memory's shipped seams, informed by how mem0 and graphiti promote short-term → durable memory — so `/to-plan` can build M9 as a thin orchestration, not a new engine. Success = every M9 DoD item maps onto a named shipped seam with a verified citation.

## Executive summary

A session→global promotion is exactly a `ConflictResolutionResult` produced by the shipped `ConflictResolutionPolicy.consolidate(...)`, fired at the shipped `ReflectionPolicy.shouldReflect(...)` boundary (NOT per-write, unlike mem0), persisted by the shipped `applyConsolidation` transaction (bi-temporal `t_invalid` soft-delete of the source + `derivedFrom` lineage + an `INSERT` into the shipped `consolidation_history` audit table), with the promotion candidate cluster fetched incrementally via the shipped over-fetch recall (the semantically-related subset, never a full session scan). The `confirmation_count ≥ 3` promotion rule is grounded in theo-memory's OWN Princípio 1 — neither reference has a count-threshold analog (honest finding, not copied). Isolation is preserved for free: every seam already carries `workspace_id` + the scope tier; a promotion moves a row from `session_id=S` to `session_id=NULL` while keeping the SAME `workspace_id`+`user_id`.

## Coverage Corner 1 — Integration Tests

**How graphiti proves temporal supersession against a real DB, and the M9 analog.**

- graphiti's `graph_driver` fixture is `@pytest.fixture(params=drivers)` — one param per enabled backend — clearing state before yield and closing after (`.claude/knowledge-base/references/graphiti/tests/helpers_test.py:118-128`); backends gated by `DISABLE_NEO4J`/`DISABLE_FALKORDB`/`DISABLE_KUZU`/`DISABLE_NEPTUNE` env flags (`:34-68`), connection via `NEO4J_URI` (`:70-72`); `docker-compose.test.yml` provisions a real `neo4j:5.26.2` with a healthcheck gate.
- The persistence proof: `test_entity_edge` builds an `EntityEdge(... expired_at=now, valid_at=now, invalid_at=now ...)` (`.claude/knowledge-base/references/graphiti/tests/test_edge_int.py:189-200`), saves + round-trips it asserting `edge_count == 1` + field equality (`:204-240`). The supersession-algorithm assertions (flipping `invalid_at`) live in the UNIT tier (`resolve_edge_contradictions`), not the integration file — a division M9 mirrors.
- **M9 analog:** theo-memory's `createIsolatedDb()` clones a migrated template DB per test via `CREATE DATABASE … TEMPLATE …`, requiring `THEOMEM_PG_URI`, throwing if unset (`tests/integration/_helpers/isolated-db.ts:46-62`). The M9 isolation-hard-gate integration test (real `ankane/pgvector`): 3 session mentions of one fact by user A → 1 promoted `global` row under `(workspace, userA)` with `derivedFrom` to the 3 sources + a `consolidation_history` row; a one-off session fact is NOT promoted and decays; user B in the same workspace sees none of it (asserting the promoted row kept the SAME `workspace_id`+`user_id`). This is the graphiti `graph_driver` pattern ported to Postgres.

## Coverage Corner 2 — Dependencies

**What consolidation needs beyond the vector store + LLM — and why M9 adds NOTHING.**

- **mem0** bolts on a **separate SQLite history/audit store**: `self.db = SQLiteManager(self.config.history_db_path)` (`.claude/knowledge-base/references/mem0/mem0/memory/main.py:461`), written on every ADD/UPDATE/DELETE (`:1020-1040`, `:2018`), backed by `sqlalchemy>=2.0.31` (`.claude/knowledge-base/references/mem0/pyproject.toml`). Core deps: `qdrant-client`, `openai`, `pydantic`, `httpx`, `posthog`, `pytz` (`.claude/knowledge-base/references/mem0/pyproject.toml`).
- **graphiti** uses `neo4j>=5.26.0` (the graph is the audit trail) + `openai`, `tenacity`, `numpy`, `python-dotenv`, `posthog` (`.claude/knowledge-base/references/graphiti/pyproject.toml`). No relational/separate audit store.
- **M9 decision — reuse, add NO new dependency + NO new store.** theo-memory already ships the exact audit substrate mem0 bolts on separately: the `consolidation_history` table (migration `packages/core/src/infrastructure/db/migrations/0007_distillation_columns.sql:14-42`; drizzle model `packages/core/src/infrastructure/db/schema.ts:483`) with `kept_memory_id` (FK `ON DELETE SET NULL` for GDPR survival), `rejected_memory_ids` jsonb, `reason`, `policy_name`, `original_episode_ids` jsonb, `created_at`; plus the `history` table (migration `0000_crazy_mimic.sql`). A promotion is one `consolidation_history` row (`policy_name` = the M9 policy, `original_episode_ids` = the session source ids, `kept_memory_id` = the promoted global row) — strictly cheaper than mem0's separate SQLite, honoring Princípio 3.

## Coverage Corner 3 — Tools

**Local + CI test-invocation, and the M9 two-tier mapping.**

- **mem0:** `make test` → `hatch run test` + per-version `test-py-3.10/3.11/3.12` (`.claude/knowledge-base/references/mem0/Makefile:42-52`).
- **graphiti:** `make test` → `DISABLE_FALKORDB=1 DISABLE_KUZU=1 DISABLE_NEPTUNE=1 uv run pytest -m "not integration"` (`.claude/knowledge-base/references/graphiti/Makefile:29`) — unit-only by default; integration needs the compose'd Neo4j; `asyncio_mode = auto` + the `integration` marker (`.claude/knowledge-base/references/graphiti/pytest.ini`).
- **M9 mapping:** the same two-tier split — theo-memory's `npm test` (fast contract/unit) + `npm run test:integration` (real pgvector via `THEOMEM_PG_URI`, harness `tests/integration/_helpers/isolated-db.ts`). M9's consolidation-decision unit tests go in the contract tier; the supersession-against-real-pgvector proof goes in the integration tier — mirroring graphiti's `not integration`/`integration` division. This is the SHIPPED CI shape (M5 `integration.yml` gate) — no new tooling.

## Coverage Corner 4 — Techniques

**The three reusable algorithms + how each maps onto a shipped seam.**

### 4.1 The consolidation DECISION (mem0 → ConflictResolutionPolicy)

mem0's `DEFAULT_UPDATE_MEMORY_PROMPT` is a four-op algorithm — ADD (new id), UPDATE (same topic/more info, KEEP the id), DELETE (contradiction), NONE (already present) — with the JSON envelope (`event` + `old_memory`, `old_memory` required only on UPDATE) assembled by `get_update_memory_messages` (`.claude/knowledge-base/references/mem0/mem0/configs/prompts.py:176-324`, `:406-460`). Provenance flows via `linked_memory_ids` (the ADD path links a new memory to related existing ones — `.claude/knowledge-base/references/mem0/mem0/configs/prompts.py:464-520`) and via `add_history(memory_id, prev_value, data, "UPDATE")` on the UPDATE path (`.claude/knowledge-base/references/mem0/mem0/memory/main.py:1972-2036`).

> **HONEST FINDING (edge-case EC-1 + CHECKPOINT-1):** mem0's decision fires PER-WRITE inside `add()`→`_add_to_vector_store`, and the four-op decision loop is a *reusable prompt/design artifact* — the current live auto-path is ADD-only (`.claude/knowledge-base/references/mem0/mem0/memory/main.py:835-1040` only emits `event:"ADD"`; `get_update_memory_messages` is imported-but-unwired in the current checkout). M9 reuses the DECISION SHAPE, not the trigger timing.

**Maps onto:** `ConflictResolutionPolicy.consolidate(candidates, ctx): Promise<ConflictResolutionResult[]>` (`packages/core/src/domain/dip/conflict-resolution-policy.ts:71-78`). mem0's four-op → `ConflictResolutionResult{ keptMemoryId, rejectedMemoryIds[], reason, policyName, originalEpisodeIds[] }` (`:51-57`): `keptMemoryId`=survivor, `rejectedMemoryIds`=soft-delete targets, `reason`=verbatim rationale, `originalEpisodeIds`=lineage (mem0's `linked_memory_ids`). The shipped `LlmJudgedMergeConflictPolicy` (`packages/core/src/domain/conflict-resolution/llm-judged-merge.ts`) already implements this seam.

### 4.2 Temporal SUPERSESSION (graphiti → shipped bi-temporal)

graphiti's `resolve_edge_contradictions` is storage-agnostic timestamp arithmetic: for a contradicted edge whose old `valid_at` predates the new edge's `valid_at`, it stamps `invalid_at = new.valid_at` (event-time close) + `expired_at = utc_now()` (transaction-time close); non-overlapping intervals are skipped (`.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/edge_operations.py:538-573`). `add_episode` surfaces `(resolved, invalidated, new)` to the caller (`.claude/knowledge-base/references/graphiti/graphiti_core/graphiti.py:606-678`). Node summaries are recomputed from accrued edges (`.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/node_operations.py:726-782`).

> **HONEST FINDING (edge-case EC-2 + CHECKPOINT-2):** this is timestamp math, NOT a graph-store feature. Extract the interval-overlap algorithm; NEVER propose a graph backend (theo-memory Item 14 declined).

**Maps onto:** theo-memory's shipped two-axis bi-temporal model — `t_valid`/`t_invalid` on `memories` (ADR-0006/0011) + `derivedFrom` lineage written by the reflect path (`packages/core/src/infrastructure/db/reflect-orchestrator.ts:215`). graphiti's `edge.invalid_at = new.valid_at` = theo-memory's `t_invalid` soft-delete inside `applyConsolidation` (`packages/core/src/infrastructure/db/pgvector-store.ts:1053-1073`). Node-summary regen = shipped Item 29 (evolving entity summaries), on-demand variant.

### 4.3 INCREMENTALITY (both → over-fetch recall + cache)

Neither reference scans the whole scope. mem0 vector-searches only the top-10 semantically-related memories before deciding (`.claude/knowledge-base/references/mem0/mem0/memory/main.py:835-1040`). graphiti fetches a bounded candidate subset per item via hybrid search + deterministic minhash/jaccard dedup before any LLM call (`.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/dedup_helpers.py`; `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/node_operations.py:627-710`).

**Maps onto:** theo-memory's shipped over-fetch 9-step hybrid recall (fetch the related candidate cluster for the promotion decision) + the shipped `RecallCacheStore` (13th DIP, `@usetheo/memory/cache-pg`) to avoid re-embedding near-duplicate promotion queries. M9 consolidation scans the related subset — mitigating M9 risk #2 (write-amplification at scale) exactly as both references do.

## ADRs

### D1 — M9 is a COMPOSITION of shipped seams, not a new engine (Rule 9)

**Decision:** M9 ships a thin `ConsolidationPolicy` that ORCHESTRATES four shipped seams (ReflectionPolicy boundary → over-fetch recall of the related cluster → ConflictResolutionPolicy.consolidate → applyConsolidation transaction), writing one `consolidation_history` row per promotion. No new DIP, no new engine, no new store.

**Rationale:** the research confirms every needed primitive is shipped (reuse-surface list, `conflict-resolution-policy.ts:71-78`, `reflection-policy.ts:30`, `reflect-orchestrator.ts:215`, `pgvector-store.ts:1053-1073`, `0007_distillation_columns.sql`). A parallel engine would violate Rule 9 + duplicate the v0.7 distillation logic.

**Alternatives considered:** (a) a standalone consolidation service (rejected — duplicates reflect/distillation); (b) mem0's per-write decision loop (rejected — wrong trigger timing per EC-1); (c) a graph backend for supersession (rejected — EC-2, Item 14 declined).

### D2 — Trigger is the ReflectionPolicy boundary, NOT per-write

**Decision:** promotion fires at `ReflectionPolicy.shouldReflect(scope, trigger)` (boundary/threshold/sleep-time), never per remember().

**Rationale:** EC-1/CHECKPOINT-1 — mem0's per-write timing is inappropriate for "promote what proved durable AT session boundary." theo-memory already ships the boundary trigger (`packages/core/src/domain/dip/reflection-policy.ts:21-37`).

### D3 — The `confirmation_count ≥ 3` rule is grounded in Princípio 1, NOT copied

**Decision:** the promotion rule (`confirmation_count ≥ N (N≥3)` OR LLM-judged durable OR agent-marked) is grounded in theo-memory's own `confirmation_count` (Princípio 1) + optionally `EvictionPolicy.score` — explicitly NOT attributed to mem0/graphiti.

**Rationale:** CHECKPOINT-3 — neither reference has a count-threshold analog (mem0 dedups by hash+link; graphiti resolves by semantic/temporal identity). Claiming a reference for the ≥3 rule would be fabricated provenance (Rule 3). The signal already ships (`confirmation_count` read at `packages/core/src/infrastructure/db/pgvector-store.ts:480`; migration `0011_confirmation_count_and_composite_unique.sql`).

### D4 — Reuse `consolidation_history` for the promotion audit (no new store)

**Decision:** each promotion writes one `consolidation_history` row (shipped, migration `0007_distillation_columns.sql:14-42`); no new audit store.

**Rationale:** Corner 2 — mem0 needs a separate SQLite for this; theo-memory already has the exact table (Princípio 3 auditability for free).

## Recommendations (one per research question)

| Q | Recommendation | Shipped seam |
|---|---|---|
| Q1 | Reuse the four-op DECISION shape (not the per-write timing) via the LLM-judged conflict policy | `ConflictResolutionPolicy.consolidate` (`conflict-resolution-policy.ts:74`) + `llm-judged-merge.ts` |
| Q2 | Supersession = `t_invalid` soft-delete + `derivedFrom` (relational bi-temporal), never a graph store | `reflect-orchestrator.ts:215` + `applyConsolidation` (`pgvector-store.ts:1053-1073`) |
| Q3 | Fetch the related candidate cluster via over-fetch recall + `RecallCacheStore`; never full-scan the session | shipped 9-step recall + `@usetheo/memory/cache-pg` |
| Q4 | Prove isolation on real pgvector via `createIsolatedDb`; assert the promoted row kept the SAME `(workspace_id,user_id)` | `tests/integration/_helpers/isolated-db.ts:46-62` |
| Q5 | Add NO new store — one `consolidation_history` row per promotion | migration `0007_distillation_columns.sql:14-42` |
| Q6 | Consolidation-decision tests in the contract tier; supersession proof in the integration tier | `npm test` + `npm run test:integration` |

## Cross-cutting Comparison

| Axis | mem0 | graphiti | M9 reuse decision |
|---|---|---|---|
| Trigger timing | per-write (`main.py:835`) | per-episode (`graphiti.py:606-678`) | boundary-fired via `ReflectionPolicy.shouldReflect` (`reflection-policy.ts:30`) |
| Decision | 4-op prompt (live path ADD-only) (`prompts.py:176-324`) | interval-overlap supersession (`edge_operations.py:538-573`) | `ConflictResolutionPolicy.consolidate → ConflictResolutionResult[]` |
| Provenance | `linked_memory_ids` + `add_history` (`main.py:2018`) | `episodes[]` + `expired_at`/`invalid_at` | `originalEpisodeIds` + `derivedFrom` + `consolidation_history` |
| Isolation | `user_id`/`run_id` filters (`main.py:880`) | `group_id` (`edge_operations.py:397`) | shipped `workspace_id` + scope tiers (`reflect-orchestrator.ts:219`) |
| Incrementality | top-10 vector search (`main.py:882`) | hybrid-search subset (`edge_operations.py:392`) | over-fetch recall + `RecallCacheStore` |
| Audit store | separate SQLite (`main.py:461`) | none (graph is audit) | reuse `consolidation_history` (no new store) |

## Coverage Matrix

All four corners populated with verified citations (Integration Tests §1, Dependencies §2, Tools §3, Techniques §4). Every `references/` and `packages/core/src/` path cited above was verified to exist during the research (2026-07-22). No fabricated citation.
