# Discovery Plan: M9 — Session → Global Consolidation (within `(workspace, user)`)

> **Version 1.0.** This discovery grounds M9's `ConsolidationPolicy` — promoting durable `session (workspace, user, session)` memories UP to `global (workspace, user)` at session boundary / `reflect`, with `derivedFrom` provenance, while non-promoted session memories decay via the shipped triadic eviction — against real mem0/graphiti code AND the already-shipped theo-memory reflect / ConflictResolutionPolicy / EvictionPolicy machinery. Blueprint output: a composition design that REUSES the shipped machinery (Unbreakable Rule 9), never a parallel consolidation engine.

**Slug:** `m9-session-to-global-consolidation`
**Owner:** usetheodev (via `/goal` M9 directive)
**Created:** 2026-07-22
**Time budget:** 3h (mem0: 1.5h, graphiti: 1h, internal-machinery confirmation: 0.5h — per ADR D1)

## Context

M8 (shipped on `develop`, PR #106) fills the ephemeral `session (workspace, user, session)` scope: the MCP agent now routes writes between `global` and `session`, and the hierarchical recall makes a session see `session ∪ global`. But **without promotion, a durable fact captured mid-conversation decays with the session noise** (the shipped triadic eviction — `TriadicScoringPolicy`, Ebbinghaus + LRU + LLM-importance — evicts session rows on capacity). M9 closes that: at session boundary / `reflect`, promote the session memories that prove durable up to that same user's `global` scope.

This is the ai-memory "session observations consolidate at session-end" pattern, grounded in theo-memory **Princípio 1** (`confirmation_count` as a durability signal, per `theo-memory/CLAUDE.md § Princípio 1`) + the shipped **reflect** / **ConflictResolutionPolicy** (v0.7 distillation) / **EvictionPolicy** (v0.4b) machinery. It MUST stay strictly inside the user's isolation — promotion never crosses `(workspace, user)` (the M8 boundary; `theo-data/CLAUDE.md` invariant 2 `workspace_id == tenant_id`).

Evidence triggering it now: ROADMAP.md § M9 (added 2026-07-21 by `/roadmap-feature`), whose DoD requires a `ConsolidationPolicy` reusing the reflect / ConflictResolutionPolicy + triadic-eviction machinery (Rule 9), an isolation hard-gate, and an integration test on real pgvector.

## Objective

**One sentence:** decide HOW to compose a `session → global` `ConsolidationPolicy` (promotion trigger + provenance + non-promoted decay + isolation) by reusing theo-memory's shipped reflect / ConflictResolutionPolicy / EvictionPolicy machinery, informed by how mem0 and graphiti promote short-term → durable memory.

Measurable success criteria for the blueprint:

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/{mem0,graphiti}/` (verified paths).
- [ ] Cross-cutting comparison table populated for mem0 + graphiti on the promotion trigger, provenance, isolation, and incrementality dimensions.
- [ ] Recommendations section proposes ONE concrete decision per research question, mapped onto the shipped theo-memory DIPs (ConflictResolutionPolicy / ReflectionPolicy / EvictionPolicy) — reuse-first (Rule 9).
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS.

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mem0/` | the memory add/update/consolidate pipeline + its tests (exact paths pending exploration) | mem0 is the closest analog for short-term → durable promotion + the ADD/UPDATE/NOOP LLM decision + provenance/history |
| `.claude/knowledge-base/references/graphiti/` | the episode → semantic/entity consolidation + temporal invalidation + node-summary paths + its tests (exact paths pending exploration) | graphiti's episode-consolidation + supersession is the temporal-provenance analog |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/*/docs/`, `README*`, examples | Marketing / narrative, not source of truth |
| `.claude/knowledge-base/references/*/{build,dist,.venv,node_modules}/` | Build artifacts |
| ai-memory (`akitaonrails/ai-memory`) | NOT cloned into references — cited conceptually only; per Cross-Project Rule, never claim a feature without reading its source. Deferred (ADR D2). |
| Any graph-DB backend consolidation (Neo4j-native) | theo-memory Item 14 graph backend is declined; M9 stays Postgres-relational |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** mem0: 1.5h (primary analog), graphiti: 1h (temporal-provenance analog), internal-machinery confirmation: 0.5h.

**Rationale:** M9 is grounded PRIMARILY in already-shipped internal machinery (reflect / ConflictResolutionPolicy / EvictionPolicy / confirmation_count / derivedFrom — all confirmed present in `packages/core/src/domain/`), so the external research is a lighter check on the promotion-trigger + provenance patterns; mem0's ADD/UPDATE decision is the closest analog, hence the deepest external dive.

**Alternatives considered:** equal split (rejected — mem0 is the closer analog); single-project (rejected — graphiti's temporal supersession is a distinct provenance angle); no external research (rejected — the `/goal` mandates the full CYCLE with no skipped steps, and the promotion-trigger design benefits from prior art).

**Stop condition — per question:** Fase A empty after 3 retries with different query variants → mark BLOCKED "Fase A exhausted", continue. **Per project:** budget exhausted with questions pending → mark remaining BLOCKED "budget exhausted", continue; all-blocked → emit `BLUEPRINT_BLOCKED`, never `BLUEPRINT_COMPLETE`.

### D2 — ai-memory cited conceptually, NOT researched (not cloned)

**Decision:** the ROADMAP's "ai-memory session-end consolidation" citation is conceptual context only; ai-memory is NOT in `references/`, so no question targets it.

**Rationale:** Quality Rule 2 — every citation must resolve to a real `references/` path. Citing ai-memory files would be a fabricated-citation hard cap. mem0 + graphiti (both cloned) cover the same promotion-pattern space.

**Consequences:** the blueprint's promotion-trigger recommendation is grounded in mem0/graphiti + the internal machinery, not ai-memory.

### D3 — Reuse-first framing (Unbreakable Rule 9)

**Decision:** every research question is framed as "how does the reference do X, so we can map it onto the SHIPPED theo-memory DIP" — the blueprint's deliverable is a COMPOSITION of `ConflictResolutionPolicy` (merge/supersede on promotion), `ReflectionPolicy` (the boundary trigger), and `EvictionPolicy` (non-promoted decay), never a new parallel engine.

**Rationale:** M9 DoD explicitly says "reusing the reflect / ConflictResolutionPolicy + triadic-eviction machinery (Rule 9)". A parallel consolidation engine would violate Rule 9 + duplicate the shipped distillation logic.

**Consequences:** the blueprint's Recommendations MUST name the specific shipped DIP each borrowed pattern maps onto.

## Research questions

Six questions across the four corners (techniques ×3, integration-tests ×1, dependencies ×1, tools ×1). Every method path is verified to exist.

### Q1 — [techniques] How does mem0 decide ADD vs UPDATE vs DELETE vs NONE for an incoming fact that overlaps existing memory, and what carries provenance from the source(s) to the consolidated memory?

- **Method:** Read `.claude/knowledge-base/references/mem0/mem0/configs/prompts.py:176-320` (`DEFAULT_UPDATE_MEMORY_PROMPT` — the ADD/UPDATE/DELETE/NONE decision spec) + `:406-460` (`get_update_memory_messages`, output `event` + `old_memory`) + `:464-520` (`ADDITIVE_EXTRACTION_PROMPT` with `linked_memory_ids` provenance) + `.claude/knowledge-base/references/mem0/mem0/memory/main.py:1972-2036` (`_update_memory` overwrite + history `UPDATE`).
- **Expected answer shape:** a decision table (event → action → provenance field) + a one-paragraph mapping onto theo-memory's shipped `ConflictResolutionPolicy` (`packages/core/src/domain/dip/conflict-resolution-policy.ts:28-71`, `ConsolidationCandidate`/`ConflictResolutionResult`).

### Q2 — [techniques] How does graphiti supersede an older fact when a newer episode contradicts it (temporal provenance), and how does it regenerate a node summary as facts accrue?

- **Method:** Read `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/edge_operations.py:325-560` (`resolve_extracted_edges` + `resolve_edge_contradictions` — invalidation) + `.claude/knowledge-base/references/graphiti/graphiti_core/graphiti.py:606-678` (`add_episode` returns `(resolved, invalidated, new)`) + `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/node_operations.py:726-782` (`extract_attributes_from_nodes`, `should_summarize_node`).
- **Expected answer shape:** the supersede-vs-duplicate rule (valid_at/invalid_at) + a note on whether promotion should carry a supersession link, mapped onto theo-memory's shipped bi-temporal `t_valid`/`t_invalid` + `derivedFrom` (`packages/core/src/infrastructure/db/reflect-orchestrator.ts:215`).

### Q3 — [techniques] Is consolidation INCREMENTAL — does mem0/graphiti scan the whole scope per boundary, or only the semantically-related subset — i.e. how is the write-amplification bottleneck (M9 risk #2) avoided?

- **Method:** Read `.claude/knowledge-base/references/mem0/mem0/memory/main.py:835-1040` (`_add_to_vector_store` — vector-search the RELATED memories before the update decision, not a full scan) + `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/dedup_helpers.py` (deterministic normalize before LLM dedup) + `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/node_operations.py:627-710` (`resolve_extracted_nodes` — semantic retrieval → deterministic → LLM).
- **Expected answer shape:** confirmation that promotion should be scoped to the semantically-related subset of `(workspace, user)` (not a full session scan) + how this maps onto theo-memory's over-fetch recall + the recall-cache SERIALIZABLE-retry helper.

### Q4 — [integration-tests] How does graphiti test episode-consolidation/invalidation against a REAL database, and which assertions prove supersession?

- **Method:** Read `.claude/knowledge-base/references/graphiti/tests/helpers_test.py:24-72` (the `graph_driver` real-DB fixture + `DISABLE_*` flags) + `.claude/knowledge-base/references/graphiti/tests/test_edge_int.py` (integration assertions) + `.claude/knowledge-base/references/graphiti/docker-compose.test.yml`.
- **Expected answer shape:** the real-DB harness pattern (fixture + env-gated driver + docker-compose) mapped onto theo-memory's `THEOMEM_PG_URI` + `createIsolatedDb` integration harness, and the exact assertion that proves a promotion kept the same `(workspace, user)` (M9 isolation hard gate).

### Q5 — [dependencies] What runtime deps does mem0's consolidation require beyond the vector store + LLM (a separate history/audit store?), and what does graphiti pull in for temporal edges?

- **Method:** Read `.claude/knowledge-base/references/mem0/pyproject.toml` (qdrant/chromadb + `[test]` extra) + `.claude/knowledge-base/references/mem0/mem0/memory/main.py:461` + `:1020-1040` (`SQLiteManager` history DB — the audit store) + `.claude/knowledge-base/references/graphiti/pyproject.toml`.
- **Expected answer shape:** a dep list + a decision on whether theo-memory needs a NEW store for promotion audit (recommendation: NO — reuse the shipped `history` table + `consolidation_history` from v0.7, per Rule 9).

### Q6 — [tools] How do mem0 + graphiti run their consolidation tests locally (test command + live-DB story + CI shape)?

- **Method:** Read `.claude/knowledge-base/references/mem0/Makefile:42-52` (`make test` → `hatch run test`) + `.claude/knowledge-base/references/graphiti/Makefile:29` (`make test` → `uv run pytest -m "not integration"`; integration by enabling a driver) + `.claude/knowledge-base/references/graphiti/pytest.ini` (the `integration` marker).
- **Expected answer shape:** the local + CI test-invocation pattern, mapped onto theo-memory's `npm test` (contract) + `npm run test:integration` (real pgvector) split — confirming M9's integration test runs under the existing `test:integration` gate.

## Coverage Matrix

100% mapping — every question → ≥ 1 verified method path. All corners covered.

| # | Corner | Method (verified path) | Answer format |
|---|---|---|---|
| Q1 | Techniques | `mem0/mem0/configs/prompts.py:176-320,406-460,464-520` + `mem0/mem0/memory/main.py:1972-2036` | decision table + DIP mapping |
| Q2 | Techniques | `graphiti/graphiti_core/utils/maintenance/edge_operations.py:325-560` + `graphiti/graphiti_core/graphiti.py:606-678` + `node_operations.py:726-782` | supersede rule + bi-temporal mapping |
| Q3 | Techniques | `mem0/mem0/memory/main.py:835-1040` + `graphiti/graphiti_core/utils/maintenance/{dedup_helpers.py,node_operations.py:627-710}` | incrementality confirmation |
| Q4 | Integration tests | `graphiti/tests/helpers_test.py:24-72` + `graphiti/tests/test_edge_int.py` + `graphiti/docker-compose.test.yml` | harness pattern + isolation assertion |
| Q5 | Dependencies | `mem0/pyproject.toml` + `mem0/mem0/memory/main.py:461,1020-1040` + `graphiti/pyproject.toml` | dep list + reuse-vs-new-store decision |
| Q6 | Tools | `mem0/Makefile:42-52` + `graphiti/Makefile:29` + `graphiti/pytest.ini` | test-invocation pattern |

## Halt-loop checkpoints

- Before marking a question `done`: its answer cites ≥ 1 verified `references/` path AND names the theo-memory DIP it maps onto (ADR D3).
- Before `BLUEPRINT_COMPLETE`: all four corners populated; every citation resolves on disk; ≥ 1 ADR; the isolation-preservation technique explicitly addressed (M9 hard gate).

## Acceptance Criteria

- [ ] Every research question answered OR honestly `blocked` with reason.
- [ ] Every citation backed by a real `references/{mem0,graphiti}/` path.
- [ ] The four-corner coverage is complete (integration-tests / deps / tools / techniques).
- [ ] The promotion-trigger, provenance, isolation, and incrementality dimensions each have a concrete recommendation mapped onto a shipped theo-memory DIP.

## Global Definition of Done

Links to `/discover-confidence` golden rule (`.claude/rules/discover-blueprint-golden-rule.md`) + thresholds (`.claude/rules/discover-blueprint-thresholds.txt`). Verdict ≥ SHIPPABLE_WITH_CAVEATS required before `/to-plan` consumes the blueprint.
