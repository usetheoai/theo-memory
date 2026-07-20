# Blueprint: Accountable Forgetting — modeling and exposing the negative-space of memory

> **Version 1.0** — Synthesizes how **Graphiti (Zep)** and **OpenMemory (Mem0)** model temporal supersession, discard/dedup decisions, and provenance, in order to design TheMemory's differentiator: a queryable, per-tenant-governed `explain(recallId)` / `replay(scope, asOf)` surface that reports what memory ignored / deduplicated / superseded / evicted, **and why**. Every borrowed technique is mapped onto TheMemory's existing Postgres tables (`entities` / `memory_entities` / `entity_edges`, migrations `0018`/`0019`/`0022`) and the `memory-event.ts` IGNORE events — **no graph DB** (Roadmap Item 14 declined). Finding in one line: Graphiti persists the *result* of supersession (temporal stamps on a retained edge) but not the *reason*; OpenMemory models discard as *state* not *time* and *hides* the negative-space from the consumer. Neither exposes a per-recall, tenant-governed "why it was dropped" trace — that gap is TheMemory's unique surface.

**Slug:** `accountable-forgetting`
**Source plan:** `.claude/knowledge-base/discoveries/plans/accountable-forgetting-plan.md`
**Owner:** paulohenriquevn
**Generated:** 2026-07-20 via `/discover-execute`
**Confidence verdict:** SHIPPABLE_WITH_CAVEATS (updated by `/discover-confidence`)

## Context

The competitive de-risk (WebSearch 2026-07-20, recorded in the plan) showed the broad "explainable/auditable memory" narrative is **not free**: Zep already owns *provenance + bi-temporal* publicly, and observability vendors already trace memory reads/writes as spans. The surviving, unique slice is the **negative-space**: no competitor exposes, per recall, the sub-threshold-filtered candidates, the dedup collisions, the zero-fact extractions, and the evicted memories — governed by tenant (Principal + RBAC + fail-closed), not merely observed by an external sink. TheMemory already emits the three previously-silent IGNORE events in `packages/core/src/domain/memory-event.ts` (`dedup_collision_confirmed`, `extraction_zero_facts`, `recall_threshold_filtered`) and carries `MemoryItem.rejectedAsDuplicate`. What is missing is the **legible surface** that stitches events + `asOf` + provenance + Principal into `explain(recallId)` / `replay(scope, asOf)`. Before designing that (via `/to-plan`), this blueprint dissects how the two SOTA systems model the "discard / supersession / provenance" half — to differentiate from Zep and to map each technique onto the three existing Postgres tables.

## Objective

Enable the reader to decide **how to implement the `explain`/`replay` (accountable forgetting) surface on the existing Postgres+pgvector stack, without a graph DB, differentiated from Zep's provenance narrative** — by grounding each design choice in what Graphiti and OpenMemory actually do (and fail to do) in source.

---

## Coverage Corner 1 — Integration Tests

> How the temporal/supersession boundary is tested. This is Q6. Project A = Graphiti; Project B = OpenMemory (the absence of a temporal test is itself the finding).

### Project A — Graphiti

Graphiti tests supersession at two altitudes: **mocked-unit** (dedup/invalidate logic in isolation) and **real-driver integration** (temporal fields survive a save/load round-trip against Neo4j).

- **Mocked-unit pattern**: `tests/test_add_triplet.py:44-49` builds a mock LLM whose `generate_response` returns the resolve shape `{'duplicate_facts': [], 'invalidate_facts': []}`; the test then patches `resolve_extracted_edge` to return `(edge, [], [])` and asserts merge behavior (`.claude/knowledge-base/references/graphiti/tests/test_add_triplet.py:127-141`). The dedup/invalidate decision is stubbed, not exercised against a store.
- **Real-driver integration fixture**: `tests/test_edge_int.py` uses a `graph_driver` fixture (real Neo4j via docker-compose). `test_entity_edge` constructs an `EntityEdge` with all temporal fields set — `expired_at=now, valid_at=now, invalid_at=now` (`.claude/knowledge-base/references/graphiti/tests/test_edge_int.py:196-198`), saves it (`edge.save(graph_driver)`, line 204), reloads via `EntityEdge.get_by_uuid`, and asserts the round-trip identity of the edge (`.claude/knowledge-base/references/graphiti/tests/test_edge_int.py:208-223`). This is the **"the invalidated fact remains, with its stamp"** pattern — the superseded edge is not deleted; its temporal columns survive persistence.
- **Dedup-decision assertion shape**: `tests/utils/maintenance/test_edge_operations.py:436-450` feeds three near-identical edges (differing only in whitespace/case) into `resolve_extracted_edges` and asserts the fast-path exact-dedup collapses 3→1: `resolve_call_count == 1`, `len(resolved_edges) == 1`, **`invalidated_edges == []`** (no spurious invalidation). Assertion is: *the dedup happened AND nothing was wrongly superseded.*
- **Coverage split**: integration tests are marked `_int` and gated behind the `integration` pytest marker (excluded by default — see Corner 3). Unit tests mock the driver; `_int` tests use the real one. What they assert about temporal stamps is *persistence round-trip*, not the LLM's rationale (which is never stored — see Corner 4 / Q2).

```python
# .claude/knowledge-base/references/graphiti/tests/test_edge_int.py:196-206
        expired_at=now,
        valid_at=now,
        invalid_at=now,
        group_id=group_id,
    )
    edge_embedding = await entity_edge.generate_embedding(mock_embedder)
    edge_count = await get_edge_count(graph_driver, [entity_edge.uuid])
    assert edge_count == 0
    await entity_edge.save(graph_driver)
    edge_count = await get_edge_count(graph_driver, [entity_edge.uuid])
    assert edge_count == 1
```

### Project B — OpenMemory

**Finding: OpenMemory has NO temporal/supersession integration test.** The only test module under the API is `.claude/knowledge-base/references/mem0/openmemory/api/tests/test_mcp_server.py` (confirmed: `ls .../openmemory/api/tests/` returns `__init__.py` + `test_mcp_server.py` only). A grep for `valid_at|invalid_at|supersed|expired|MemoryStatusHistory` across `openmemory/api/tests/` returns zero matches. The state-transition audit table (`MemoryStatusHistory`, Corner 4 / Q3) is **never asserted** by a test. This absence is the Corner-1 signal for Project B: the negative-space is not just hidden from the consumer (Q3) — it is also **unprotected by a regression test**, so its provenance bug (both `old_state` branches equal `deleted`, Q3) went uncaught. For TheMemory, the lesson is inverted into a requirement: the `explain`/`replay` surface MUST be covered by an integration test asserting the IGNORE/evict decision is written and queryable (mirrors `.claude/rules/testing.md § 4.1` — boundary is integration territory, not unit-with-mock).

---

## Coverage Corner 2 — Dependencies

> Runtime deps each system pulls for the temporal/provenance layer, and whether TheMemory can mirror without a graph DB. This is Q4.

### Project A — Graphiti

A **graph DB is a hard, non-optional runtime dependency**. `neo4j>=5.26.0` sits in core `dependencies`, not an extra.

| Dependency | Version | Why | Citation |
|---|---|---|---|
| `neo4j` | `>=5.26.0` | **Mandatory** default graph store — the substrate for edges + temporal fields | `.claude/knowledge-base/references/graphiti/pyproject.toml:15` |
| `pydantic` | `>=2.11.5` | `EntityEdge` / `EpisodicNode` models incl. temporal fields | `.claude/knowledge-base/references/graphiti/pyproject.toml:14` |
| `openai` | `>=1.91.0` | LLM for dedup-resolve + timestamp extraction | `.claude/knowledge-base/references/graphiti/pyproject.toml:16` |
| `tenacity` | `>=9.0.0` | retry on LLM/driver calls | `.claude/knowledge-base/references/graphiti/pyproject.toml:17` |
| `posthog` | `>=3.0.0` | telemetry | `.claude/knowledge-base/references/graphiti/pyproject.toml:20` |
| `falkordb` / `kuzu` / `neptune` | extras | alternate graph backends (swap Neo4j, never *remove* the graph DB); `kuzu` marked deprecated/unmaintained | `.claude/knowledge-base/references/graphiti/pyproject.toml:31-40` |
| `opentelemetry-*` (`tracing`) | extra | OTel spans | `.claude/knowledge-base/references/graphiti/pyproject.toml:41` |

There is no relational (Postgres) option: every persistence path in `edge_db_queries.py` is Cypher/graph (`MATCH ... MERGE (source)-[e:RELATES_TO]->(target)`, `.claude/knowledge-base/references/graphiti/graphiti_core/models/edges/edge_db_queries.py:111-121`).

### Project B — OpenMemory

Uses **Postgres-relational (SQLAlchemy + Alembic) for the state/audit layer** and Qdrant for vectors — the state/audit substrate is exactly TheMemory's.

| Dependency | Version | Why | Citation |
|---|---|---|---|
| `sqlalchemy` | `>=1.4.0` | ORM for `Memory` / `MemoryStatusHistory` state tables | `.claude/knowledge-base/references/mem0/openmemory/api/requirements.txt:3` |
| `alembic` | `>=1.7.0` | schema migrations for the state/audit tables | `.claude/knowledge-base/references/mem0/openmemory/api/requirements.txt:5` |
| `psycopg2-binary` | `>=2.9.0` | Postgres driver (relational audit layer) | `.claude/knowledge-base/references/mem0/openmemory/api/requirements.txt:6` |
| `mem0ai` | `>=0.1.92` | the decision engine (ADD/UPDATE/DELETE/NONE) + Qdrant vectors | `.claude/knowledge-base/references/mem0/openmemory/api/requirements.txt:10` |
| `fastapi` / `starlette` | `>=0.68` / `>=0.40` | REST + MCP transport | `.claude/knowledge-base/references/mem0/openmemory/api/requirements.txt:1,13` |
| `openai` / `anthropic` / `ollama` | pinned | LLM providers | `.claude/knowledge-base/references/mem0/openmemory/api/requirements.txt:11,19,20` |

Vector store is Qdrant, provisioned as `mem0_store` in `.claude/knowledge-base/references/mem0/openmemory/docker-compose.yml:2-7`. Note the relational audit DB defaults to SQLite in dev (`rm -f api/openmemory.db`, `.claude/knowledge-base/references/mem0/openmemory/Makefile:34`), with Postgres available via `psycopg2`.

### Verdict — TheMemory can mirror WITHOUT a graph DB

- The **relational audit layer** OpenMemory builds on `sqlalchemy` + `alembic` + `psycopg2` is exactly TheMemory's stack (drizzle + pg). No new dependency.
- The **vector layer** (OpenMemory's Qdrant) is already covered by TheMemory's pgvector — one substrate, not two.
- The **temporal supersession** Graphiti implements on Neo4j edges has a ready relational home: migration `0022` already added `t_valid`/`t_invalid` to `entity_edges` (target columns in our own tree: `packages/core/src/infrastructure/db/migrations/0022_adorable_spacker_dave.sql:1-2`, verified present) with a partial index `entity_edges_active_idx ... WHERE t_invalid IS NULL` (line 3) — the "active edge" filter, for free.
- Therefore **Roadmap Item 14 (Neo4j/AGE) stays declined** (`CLAUDE.md`): Graphiti's Neo4j dependency is the *only* thing forcing a graph DB, and it exists to host a data shape (endpointed, temporally-stamped edges) that two Postgres tables (`entities` + `entity_edges`) already express. Any technique that *requires* native graph traversal is flagged non-portable in Corner 4, not recommended.

---

## Coverage Corner 3 — Tools

> How the temporal/provenance boundary is tested locally: docker-compose + test command + integration marker. This is Q5.

### Project A — Graphiti

- **Test command**: `make test` → `DISABLE_FALKORDB=1 DISABLE_KUZU=1 DISABLE_NEPTUNE=1 uv run pytest -m "not integration"` (`.claude/knowledge-base/references/graphiti/Makefile:28-29`). Integration is **opt-in**: the default run *excludes* the `integration` marker, so temporal round-trip tests against a real driver run only when explicitly requested.
- **Marker registration**: `.claude/knowledge-base/references/graphiti/pytest.ini:2-5` registers `markers = integration: marks tests as integration tests` and sets `asyncio_mode = auto`. (Note: `test_edge_int.py` uses the `_int` filename convention as its integration signal; the `integration` marker is the make-level gate.)
- **Local dev story**: `.claude/knowledge-base/references/graphiti/docker-compose.yml:29-48` provisions `neo4j:5.26.2` (default profile, Bolt `7687` + HTTP `7474`, healthcheck), with `falkordb` behind a `falkordb` profile (lines 50-64). Real graph driver = the docker-compose Neo4j.
- **Toolchain**: `uv` (deps), `ruff` (format+lint), `pyright ./graphiti_core` (types) — `.claude/knowledge-base/references/graphiti/Makefile:15,19-25`.

### Project B — OpenMemory

- **Test command**: container-based — `make test` / `make test-clean` (help text at `.claude/knowledge-base/references/mem0/openmemory/Makefile:15-16`); the API test module is `test_mcp_server.py` (no temporal test — Corner 1).
- **Schema migrations**: `make migrate` → `docker compose exec api alembic upgrade head` (`.claude/knowledge-base/references/mem0/openmemory/Makefile:45-46`), with `downgrade` at line 48-49. The state/audit tables (`memory_status_history`) are Alembic-managed.
- **Local dev story**: `.claude/knowledge-base/references/mem0/openmemory/docker-compose.yml` provisions `qdrant` (`mem0_store`, port 6333, lines 2-7), the API/MCP server (`openmemory-mcp`, port 8765, lines 8-23), and the Next.js UI (port 3000, lines 24-33). Dev DB is SQLite (`api/openmemory.db`, wiped by `make down`).

### Implication for TheMemory's `explain`/`replay` harness

Mirror Graphiti's **integration-opt-in marker + real-store fixture**: the temporal/provenance boundary is integration territory (`.claude/rules/testing.md § 4.1`), so `explain`/`replay` assertions run against real `ankane/pgvector:v0.5.1` (TheMemory's existing convention), gated so the fast unit suite stays green without a DB. Do NOT unit-test supersession with a mocked store (Graphiti's mocked-unit path stubs exactly the decision we care about — `.claude/knowledge-base/references/graphiti/tests/test_add_triplet.py:127-130`).

---

## Coverage Corner 4 — Techniques

> Q1 (temporal supersession), Q2 (discard/dedup decision + reason persistence), Q3 (expose vs hide) live here.

### Technique 1 (Q1) — Temporal supersession of a contradicted fact — soft-invalidate, never delete

Graphiti models an edge (a fact) **bi-temporally** and, on contradiction, **stamps the old edge with when/why it expired instead of deleting it**.

- **The four temporal fields** on `EntityEdge` (`.claude/knowledge-base/references/graphiti/graphiti_core/edges.py:263-282`):
  - `expired_at` — "datetime of when the node was invalidated" (line 271-272) — **transaction-time** invalidation (when the *system* learned the fact was superseded).
  - `valid_at` — "when the fact became true" (line 274-275) — **valid-time** start.
  - `invalid_at` — "when the fact stopped being true" (line 277-278) — **valid-time** end.
  - `reference_time` — the episode timestamp that produced the edge (line 280-281) — provenance anchor.
- **The supersession predicate** — `resolve_edge_contradictions` (`.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/edge_operations.py:538-573`): for each invalidation candidate, it (a) *skips* pairs whose valid-time windows don't overlap (`edge.invalid_at <= resolved.valid_at` OR `resolved.invalid_at <= edge.valid_at`, lines 553-562); (b) else, if the candidate's fact started before the new fact (`edge_valid_at < resolved_edge_valid_at`, lines 564-568), it **closes the old window and stamps expiry**:

```python
# .claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/edge_operations.py:569-571
            edge.invalid_at = resolved_edge.valid_at
            edge.expired_at = edge.expired_at if edge.expired_at is not None else utc_now()
            invalidated_edges.append(edge)
```

  i.e. `invalid_at` (valid-time end) is set to the *new* fact's `valid_at`, and `expired_at` (transaction-time) is stamped `utc_now()` if not already set. The old edge is **retained**, not removed.
- **Where valid_at/invalid_at come from**: `_extract_edge_timestamps` (`.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/edge_operations.py:576-620`) makes a lightweight LLM call over `{fact, reference_time}` to fill valid_at/invalid_at — but only if they are not already set (line 587-588) and an episode reference time exists (line 590-591).
- **Persistence**: `EntityEdge.save` writes all four fields into `edge_data` (`.claude/knowledge-base/references/graphiti/graphiti_core/edges.py:351-355`) and the save query SETs them explicitly: `e.expired_at = $expired_at, e.valid_at = $valid_at, e.invalid_at = $invalid_at, e.reference_time = $reference_time` (`.claude/knowledge-base/references/graphiti/graphiti_core/models/edges/edge_db_queries.py:96-99`). The invalidated edge is UPSERTed (`MERGE`), so supersession is a field-update on a surviving row — **ADD-only / soft-supersession**, aligned with TheMemory's own ADD-only contract (ADR-0003).

**Mapping to TheMemory (ADR D3, no graph DB):** `entity_edges` already carries `t_valid` (default `now()`) and `t_invalid` (nullable) from migration `0022`. Graphiti's `valid_at` → our `t_valid`; Graphiti's `invalid_at` → our `t_invalid`. The partial index `entity_edges_active_idx WHERE t_invalid IS NULL` = Graphiti's "active edge" query. **Caveat worth surfacing:** Graphiti keeps `expired_at` (transaction-time) *separate* from `invalid_at` (valid-time); our single `t_invalid` conflates the two. To match Graphiti's audit fidelity — "when the fact stopped being true" vs "when we learned it" — an accountable-forgetting design should either add a transaction-time column to `entity_edges` OR record the transaction-time in the `explain` event stream (recommended — keeps the table lean, per ADR D2).

### Technique 2 (Q2) — The discard/dedup decision taxonomy, and whether the reason is persisted

Both systems decide to discard/dedup; **neither persists the LLM's rationale**, only the resulting action/stamp. Consolidated taxonomy:

| # | Decision type | System | Where it decides | Reason persisted? | Citation |
|---|---|---|---|---|---|
| 1 | **exact-dedup (fast path)** | Graphiti | normalize fact + same endpoints → reuse existing edge, append episode id | **No** — merge is implicit; only the episode-link is appended | `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/edge_operations.py:684-695` |
| 2 | **entropy-gate** | Graphiti | short/low-entropy names skip fuzzy match, defer to LLM | **No** — a control-flow branch, not stored | `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/dedup_helpers.py:79-85` |
| 3 | **MinHash/LSH fuzzy dedup** | Graphiti | exact-name first; ambiguous→LLM; entropy-gate protects fuzzy; MinHash(32 perms, band 4)→LSH→Jaccard best candidate | **No** — resolved uuid_map only | `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/dedup_helpers.py:220-260` |
| 4 | **LLM-resolve (dedup + contradiction)** | Graphiti | LLM returns `duplicate_facts` + `contradicted_facts` idx lists over related/existing edges | **Partial** — duplicates reuse edge (no reason); contradictions produce timestamps via #5 | `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/edge_operations.py:726-776` |
| 5 | **contradiction-supersession** | Graphiti | see Technique 1 — stamps `invalid_at`/`expired_at` | **Result only** (timestamps), not the rationale | `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/edge_operations.py:538-573` |
| 6 | **LLM ADD/UPDATE/DELETE/NONE** | Mem0 | prompt classifies each new fact vs existing memory into 4 actions | **Action yes, reason no** — history row records action + old→new text; NONE records nothing | `.claude/knowledge-base/references/mem0/mem0/configs/prompts.py:176-266` |

**Graphiti detail.** The fast exact-dedup normalizes with `_normalize_string_exact` (lowercase + whitespace-collapse, `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/dedup_helpers.py:39-42`) and, on match, simply appends the episode and returns the existing edge (`.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/edge_operations.py:686-695`) — the dedup event leaves no trace beyond the episode-link. The entropy gate `_has_high_entropy` requires Shannon entropy ≥ `_NAME_ENTROPY_THRESHOLD = 1.5` (`.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/dedup_helpers.py:31, 79-85`); below it, the name is pushed to `unresolved_indices` for the LLM. The LLM-resolve path validates the returned idx ranges (logs a warning on out-of-range, `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/edge_operations.py:736-742`) and splits `contradicted_facts` into invalidation candidates by offset (`.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/edge_operations.py:770-776`). **Net: Graphiti's "why" (Jaccard score, entropy value, LLM idx classification) is computed and thrown away — only timestamps + episode links survive.**

**Mem0 detail.** The decision engine is the LLM prompt `DEFAULT_UPDATE_MEMORY_PROMPT` (`.claude/knowledge-base/references/mem0/mem0/configs/prompts.py:176-266`), producing per-fact `event ∈ {ADD, UPDATE, DELETE, NONE}` with an `old_memory` field on UPDATE (lines 246-247). The actions dispatch to `_create_memory` → `add_history(..., "ADD")` (`.claude/knowledge-base/references/mem0/mem0/memory/main.py:1921-1930`), `_update_memory` → `add_history(prev_value, data, "UPDATE")` (lines 2018-2027, and note the vector is **overwritten in place** via `vector_store.update`, line 2011 — *destructive*, not ADD-only), and `_delete_memory` → `add_history(prev_value, None, "DELETE", is_deleted=1)` (lines 2050-2060, vector removed at line 2049). **NONE produces no history row at all.** So Mem0-core is *more* auditable than Graphiti at the action level (it records action type + old→new text + `is_deleted`), but (a) it does not store *why* the LLM chose the action, (b) NONE (the "we ignored this" decision) is invisible, and (c) UPDATE/DELETE are destructive at the vector store.

**Mapping to TheMemory.** This taxonomy is the direct input to TheMemory's IGNORE event enum. The five discard types map onto `memory-event.ts` and the three existing IGNORE events (`packages/core/src/domain/memory-event.ts:33,39,46`): exact-dedup + LLM-dedup → `dedup_collision_confirmed` (+ `MemoryItem.rejectedAsDuplicate`); zero-fact extraction → `extraction_zero_facts`; sub-threshold recall drop → `recall_threshold_filtered`; contradiction-supersession → a *new* event (proposed `edge_superseded`) carrying `t_valid`/`t_invalid` on `entity_edges`; eviction → a *new* event (proposed `memory_evicted`). **TheMemory's differentiator is to persist the reason** (the score, the collision target, the superseding edge id) that both SOTA systems discard — see ADR D2.

### Technique 3 (Q3) — What OpenMemory EXPOSES vs HIDES of the negative-space (the anti-pattern)

OpenMemory models discard as **state, not time**, and **hides** the negative-space from the consumer.

- **State, not time.** `MemoryState` is an enum `active | paused | archived | deleted` (`.claude/knowledge-base/references/mem0/openmemory/api/app/models.py:30-34`). The `Memory` row has `created_at` / `updated_at` / `archived_at` / `deleted_at` (`.claude/knowledge-base/references/mem0/openmemory/api/app/models.py:96-99`) — these are *state-transition* timestamps, **not** fact-validity windows. There is no `valid_at`/`invalid_at`; a fact that "stopped being true on date X" cannot be expressed.
- **State-transition audit exists but is shallow.** `MemoryStatusHistory` records `old_state → new_state`, `changed_by`, `changed_at` (`.claude/knowledge-base/references/mem0/openmemory/api/app/models.py:161-173`). It is the closest OpenMemory gets to a provenance trail — a chain of status flips, with no reason and no validity semantics.
- **The negative-space is dropped at the API boundary.** The write path only materializes ADDs: the loop in `create_memory` iterates `qdrant_response['results']` but acts **only** when `result['event'] == 'ADD'` (`.claude/knowledge-base/references/mem0/openmemory/api/app/routers/memories.py:277`). The UPDATE/DELETE/NONE events that mem0-core *did* compute (Technique 2) are silently discarded — never written to OpenMemory's relational DB. The reasoning the engine performed is lost one layer up.
- **Provenance bug — corrupt by construction.** The status-history row written on ADD sets `old_state = MemoryState.deleted if existing_memory else MemoryState.deleted` (`.claude/knowledge-base/references/mem0/openmemory/api/app/routers/memories.py:305`) — **both branches are `deleted`**, so `old_state` is always `deleted` regardless of the true prior state. The one provenance record OpenMemory keeps is wrong, and (Corner 1) no test guards it.
- **Reads hide the negative-space by default.** `list_memories` filters `Memory.state != deleted AND Memory.state != archived` (`.claude/knowledge-base/references/mem0/openmemory/api/app/routers/memories.py:129-130`). The consumer cannot see what was archived/deleted; there is no endpoint that surfaces "what was ignored/deduped/superseded and why."

**Mapping to TheMemory (the anti-pattern to avoid).** This is the negative example. TheMemory must (a) model supersession in *time* (`entity_edges.t_valid`/`t_invalid`, already present) not as an opaque state flip; (b) NOT drop the non-ADD decisions at the API boundary — persist every IGNORE/UPDATE/SUPERSEDE/EVICT decision (`memory-event.ts`); (c) make the negative-space *queryable* via `explain`/`replay` rather than filtering it out of reads; (d) keep provenance correct and test-guarded (`.claude/rules/testing.md § 4.1`).

> **Footnote (per plan EC-2):** node-level dedup — `_resolve_with_similarity` / `_build_candidate_indexes` in `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/node_operations.py:336` / `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/dedup_helpers.py:192-260` — follows the *same* exact→entropy-gate→MinHash/LSH shape as edge dedup and is out of scope as a separate question; it maps to `entities` resolution by `(scope, normalized_key)` the same way edge dedup maps to `entity_edges`.

---

## Cross-cutting Comparison

| Dimension | Graphiti (Zep) | OpenMemory (Mem0) | TheMemory design implication |
|---|---|---|---|
| **Temporal model** | Bi-temporal edges: valid-time (`valid_at`/`invalid_at`) + transaction-time (`expired_at`) (`edges.py:271-278`) | State enum only (`active/paused/archived/deleted`), no validity window (`models.py:30-34,96-99`) | Adopt bi-temporal on `entity_edges` (`t_valid`/`t_invalid` present, mig `0022`); consider adding transaction-time to close the audit gap (D1) |
| **Discard-reason persistence** | Result only — timestamps + episode links; the *why* (Jaccard/entropy/LLM idx) is discarded (`edge_operations.py:686-695,538-573`) | Action + old→new text in history; NONE invisible; no reason (`main.py:1921-2060`) | **Differentiator:** persist the reason (score, collision target, superseding id) — neither SOTA does (D2) |
| **Negative-space exposure** | Superseded edge retained (queryable if you know to filter `invalid_at`), but no first-class "why dropped" API | **Hidden** — non-ADD events dropped at API (`memories.py:277`); reads filter deleted/archived (`memories.py:129-130`); provenance bug (`memories.py:305`) | First-class `explain(recallId)` / `replay(scope, asOf)` — governed by Principal/tenant (D2) |
| **Storage substrate** | Neo4j mandatory (`pyproject.toml:15`), graph-native Cypher | Postgres/SQLAlchemy+Alembic for audit (`requirements.txt:3,5,6`) + Qdrant vectors | Postgres+pgvector already covers both; **no graph DB** (D1, Item 14 declined) |
| **Test approach** | Integration opt-in (`Makefile:28-29`, `pytest.ini`), real Neo4j fixture asserts temporal round-trip (`.claude/knowledge-base/references/graphiti/tests/test_edge_int.py:196-223`); dedup collapse asserted (`.claude/knowledge-base/references/graphiti/tests/utils/maintenance/test_edge_operations.py:436-450`) | **No temporal/supersession test** (only `test_mcp_server.py`); provenance bug uncaught | Integration test vs real pgvector asserting IGNORE/evict decision is written + queryable (`testing.md § 4.1`) |

## ADRs

### D1 — Mirror Graphiti's edge-supersession on `entity_edges.t_valid`/`t_invalid` (no graph DB)

**Decision:** Model contradicted-fact supersession the way Graphiti does — **soft-invalidate a retained edge with temporal stamps, never delete** — implemented on the existing `entity_edges` table via its `t_valid`/`t_invalid` columns (migration `0022`), NOT on a graph DB.

**Rationale:** Graphiti's `resolve_edge_contradictions` sets `invalid_at`/`expired_at` on the superseding-time and keeps the row (`.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/edge_operations.py:569-571`), persisting via a field-update UPSERT (`.claude/knowledge-base/references/graphiti/graphiti_core/models/edges/edge_db_queries.py:96-99`). TheMemory already has the exact relational shape: `entity_edges.t_valid` (default `now()`) + nullable `t_invalid` + the partial "active" index `WHERE t_invalid IS NULL` (`packages/core/src/infrastructure/db/migrations/0022_adorable_spacker_dave.sql:1-3`). The only reason Graphiti needs Neo4j (`.claude/knowledge-base/references/graphiti/pyproject.toml:15`) is to host endpointed edges — which `entities` + `entity_edges` already express relationally. Aligns with TheMemory's ADD-only contract (ADR-0003) and bi-temporal runtime (ADR-0011).

**Alternatives considered:** (a) Adopt Neo4j/AGE (Item 14) — rejected: Item 14 declined in `CLAUDE.md`, violates KISS and the locked stack, and buys nothing the two Postgres tables don't already give. (b) Overwrite/delete the contradicted edge (Mem0's `_update_memory` in-place overwrite, `.claude/knowledge-base/references/mem0/mem0/memory/main.py:2011`) — rejected: destructive, breaks ADD-only and auditability (Princípio 3). (c) State-flip only (OpenMemory `MemoryState`, `.claude/knowledge-base/references/mem0/openmemory/api/app/models.py:30-34`) — rejected: cannot express "the fact stopped being true at time X".

**Consequences:** Supersession is a `t_invalid` UPDATE on a surviving `entity_edges` row; `recall({ asOf })` filters `(t_valid <= asOf) AND (t_invalid IS NULL OR t_invalid > asOf)` (reuses the ADR-0011 predicate). **Caveat:** our single `t_invalid` conflates valid-time end with transaction-time (Graphiti splits `invalid_at` vs `expired_at`); D2 recovers the transaction-time in the event stream rather than adding a column, keeping the table lean.

### D2 — Expose the negative-space as a first-class, tenant-governed `explain(recallId)` / `replay(scope, asOf)` trace tied to `memory-event.ts`

**Decision:** Build an `explain(recallId)` / `replay(scope, asOf)` surface that stitches the typed IGNORE/SUPERSEDE/EVICT events (`packages/core/src/domain/memory-event.ts`) with the superseding edge's temporal stamps and the resolved **Principal (per-tenant)** — persisting the *reason* each candidate was dropped, which neither Graphiti nor OpenMemory does.

**Rationale:** Graphiti computes dedup/contradiction reasons (Jaccard, entropy ≥ 1.5, LLM idx classification) and discards them, keeping only timestamps (`.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/dedup_helpers.py:79-85`, `.../edge_operations.py:686-695`). OpenMemory drops non-ADD decisions at the API boundary (`.claude/knowledge-base/references/mem0/openmemory/api/app/routers/memories.py:277`), hides deleted/archived from reads (`.../memories.py:129-130`), and even corrupts the one provenance record it keeps (`.../memories.py:305`). The three previously-silent IGNORE events already exist in TheMemory (`packages/core/src/domain/memory-event.ts:33,39,46`); the missing piece is the legible, queryable, tenant-scoped surface. This is the differentiator that survives the Zep de-risk (Zep owns provenance narrative; nobody owns per-recall negative-space governance).

**Alternatives considered:** (a) Emit to an external OTel sink only (the observability-vendor approach) — rejected: not tenant-governed, not queryable-by-recall, and leaks infra type into the domain (`.claude/rules/architecture.md § 2` — the event is domain, the sink is infrastructure; `explain` must not expose the sink). (b) State-transition history table à la OpenMemory `MemoryStatusHistory` (`.claude/knowledge-base/references/mem0/openmemory/api/app/models.py:161-173`) — rejected: records *what state* changed, not *why a candidate was dropped*, and carries no validity semantics. (c) Store the reason only for supersession (Graphiti-parity) — rejected: leaves the recall-time drops (`recall_threshold_filtered`) and eviction invisible, which is exactly the unique surface.

**Consequences:** `explain`/`replay` becomes a read over the event stream keyed by `recallId`/`scope`, scoped by the resolved Principal (fail-closed on missing credential, per platform invariants). The event stream carries the transaction-time D1 left out of `entity_edges`, and the reason payload (score, collision target id, superseding edge id, filtered_count). Adds two proposed events (`edge_superseded`, `memory_evicted`) to `MEMORY_EVENTS`. Read-side is integration-tested against real pgvector (`.claude/rules/testing.md § 4.1`) — the exact test OpenMemory lacks.

## Recommendations for the project

> Recommendations only — do NOT touch product code. Each maps a technique to the existing tables + `memory-event.ts`.

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | Implement contradiction-supersession as a `t_invalid` UPDATE on the retained `entity_edges` row (never delete), reusing the `entity_edges_active_idx WHERE t_invalid IS NULL` filter — mirror Graphiti's `resolve_edge_contradictions` predicate | Q1, D1, `CLAUDE.md` Item 14 declined, ADR-0003 (ADD-only) | HIGH |
| 2 | Add a transaction-time dimension to the `explain` event payload (not a new column) so "when the fact stopped being true" (`t_invalid`) is distinct from "when we learned it" — recovers Graphiti's `invalid_at` vs `expired_at` split without widening `entity_edges` | Q1, D1, `.claude/rules/architecture.md § 3` | MEDIUM |
| 3 | Persist the *reason* for every discard (exact-dedup / entropy-gate / LLM-dedup / contradiction / eviction) in the event stream — the score/collision-target/superseding-id that Graphiti and Mem0 throw away — keyed to the existing `dedup_collision_confirmed` / `extraction_zero_facts` / `recall_threshold_filtered` events | Q2, D2, `packages/core/src/domain/memory-event.ts` | HIGH |
| 4 | Add two typed events to `MEMORY_EVENTS` — `edge_superseded` (carries superseding `entity_edges` id + `t_valid`/`t_invalid`) and `memory_evicted` (carries eviction reason: Ebbinghaus/LRU/LLM-importance) — completing the discard taxonomy | Q2, D2, `packages/core/src/domain/memory-event.ts` | HIGH |
| 5 | Build `explain(recallId)` / `replay(scope, asOf)` as a domain read over the event stream, scoped by the resolved Principal (tenant), fail-closed — NOT filtering the negative-space out of reads (the OpenMemory anti-pattern) | Q3, D2, `.claude/rules/architecture.md § 2` (DIP: event=domain, sink=infra) | HIGH |
| 6 | Do NOT drop non-ADD decisions at the REST/MCP boundary the way OpenMemory does (`memories.py:277`) — the API layer must forward every UPDATE/SUPERSEDE/IGNORE/EVICT decision to the event stream | Q3, D2 | MEDIUM |
| 7 | Cover `explain`/`replay` with an integration test vs real `ankane/pgvector:v0.5.1` asserting the IGNORE/evict decision is written AND queryable-by-recall — the temporal regression test OpenMemory lacks; gate it integration-opt-in like Graphiti | Q5, Q6, `.claude/rules/testing.md § 4.1` | HIGH |
| 8 | Keep provenance correct + test-guarded — avoid OpenMemory's `old_state` construction bug (`memories.py:305`) by asserting the recorded prior-state/superseding-id round-trips | Q3, Q6, `.claude/rules/testing.md § 4.1` | MEDIUM |

## Blocked questions (if any)

None. All six research questions (Q1–Q6) were answered with line-exact citations to real files under both reference clones (graphiti + mem0). One deliberate non-question (node-level dedup) is recorded as a footnote per plan EC-2, not a blocked question.

## Halt-loop progress (audit trail)

- Iterations used: 1 (single-pass, all hotspots pre-verified in the plan's "Verified reference anchors")
- Questions answered: 6 / 6
- Questions blocked: 0
- Citations verified: 45+ line-exact references (all opened via Read/grep before citing)
- Promise emitted at iteration: 1 (`BLUEPRINT_COMPLETE`)

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/accountable-forgetting-plan.md`
- Confidence report: `.claude/knowledge-base/reviews/accountable-forgetting-confidence-2026-07-20.md` (generated by `/discover-confidence`)
- Linked project rules: `.claude/rules/architecture.md`, `.claude/rules/testing.md`
- Our-side anchors (recommendations target these — do not edit here): `packages/core/src/domain/memory-event.ts` (IGNORE events), `packages/core/src/infrastructure/db/migrations/0022_adorable_spacker_dave.sql` (`t_valid`/`t_invalid` on `entity_edges`), migrations `0018_entity_nodes.sql` / `0019_entity_edges.sql`
