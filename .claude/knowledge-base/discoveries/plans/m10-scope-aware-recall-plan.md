# Discovery Plan: M10 — Scope-aware recall (global + current session union, ranked)

> **Version 1.0.** Grounds M10's scope-aware ranking: recall unions the user's durable `global (workspace, user)` with the current `session (workspace, user, session)` under a ranking that boosts SESSION rows by recency and GLOBAL rows by stability (confirmation_count/age), opt-in via `RecallOptions.scopes`, ALWAYS filtered by `(workspace, user)`, surfacing attribution (user/agent) per result — the default preserving today's single-scope recall (backward-compat). Blueprint output: a composition design that REUSES the shipped 9-step retrieval pipeline (Unbreakable Rule 9).

**Slug:** `m10-scope-aware-recall`
**Owner:** usetheodev (via `/goal` M10 directive)
**Created:** 2026-07-22
**Time budget:** 2.5h (mem0: 1h ranking, graphiti: 1h rerank/RRF, shipped-pipeline confirmation: 0.5h — ADR D1)

## Context

M8 (shipped on `develop`) already makes a session recall return `session ∪ global` (the hierarchical recall). What M8 does NOT do is RANK the union scope-aware: a session recall today ranks purely by the additive composite score, so a durable global fact and an ephemeral session note compete on raw similarity alone. M10 adds the scope-aware reweight the ROADMAP § M10 requires: session rows recency-boosted (the current conversation should surface), global rows stability-boosted (durable, high-`confirmation_count` facts should not be buried under session noise) — exactly as the assistant's own memory blends durable knowledge with the current thread, strictly within `(workspace, user)`.

Grounded in ROADMAP.md § M10 (added 2026-07-21) + theo-memory Princípio 1 (relevance is a continuous score combining orthogonal signals — recency/confirmation/similarity, `theo-memory/CLAUDE.md § Princípio 1`) + Princípio 2 (prioritization + diversity over volume). MUST stay inside `(workspace, user)` (`theo-data/CLAUDE.md` invariant 2). Independent of M9 (recall works without auto-promotion).

## Objective

**One sentence:** decide HOW to add scope-aware ranking (session recency-boost + global stability-boost) + `RecallOptions.scopes` opt-in + attribution surfacing to the shipped 9-step retrieval pipeline, informed by how mem0 and graphiti rank/rerank recall results.

Measurable success criteria for the blueprint:

- [ ] All research questions answered with verified `references/{mem0,graphiti}/` citations.
- [ ] The scope-aware ranking recommendation maps onto the shipped `pipeline.ts` additive scoring + (if present) a `Reranker` DIP — reuse-first (Rule 9).
- [ ] A recall@k benchmark methodology proposed (before/after the scope-aware weights on a fixture set), per the ROADMAP M10 risk #2 mitigation.
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS.

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mem0/` | the recall/search + any rerank/score path in `mem0/memory/` | mem0's ranking (similarity vs recency/importance) is the closest single-scope analog |
| `.claude/knowledge-base/references/graphiti/` | `graphiti_core/search/` (RRF / MMR / node-distance rerankers) | graphiti's multi-strategy reranker catalog is the richest ranking prior art |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/*/docs/`, examples, build artifacts | not source of truth |
| A cross-encoder/neural reranker dependency (onnx/torch) | ROADMAP Item 23 (reranker DIP) is a SEPARATE milestone; M10 is a deterministic scope-weight reranking, no heavy dep (YAGNI) |
| ai-memory (not cloned) | Cross-Project Rule — cited conceptually only if at all (ADR D2) |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** mem0 1h, graphiti 1h (the reranker catalog), shipped-pipeline confirmation 0.5h.

**Rationale:** M10 reuses the shipped 9-step additive pipeline (semantic+bm25+entity, threshold, top-K, MMR) — the external research is a focused check on scope-aware/recency-vs-stability weighting. graphiti has the richer reranker prior art (RRF/MMR/node-distance), hence equal depth.

**Stop conditions:** per-question Fase A empty after 3 retries → BLOCKED "Fase A exhausted", continue. Per-project budget exhausted → mark remaining BLOCKED, continue; all-blocked → `BLUEPRINT_BLOCKED`.

### D2 — Deterministic scope-weight reranking, NOT a neural reranker (YAGNI + Item 23 boundary)

**Decision:** M10 ships a DETERMINISTIC scope-aware reweight (a scoring adjustment by scope-tier + recency + confirmation_count), NOT a cross-encoder/neural reranker.

**Rationale:** the ROADMAP separates M10 (scope-aware recall) from Item 23 (optional cross-encoder `Reranker` DIP). A deterministic weight is explainable (Princípio 3), dependency-free, and sufficient for "session recency vs global stability". A neural reranker would be a different, heavier milestone.

**Consequences:** the blueprint's recommendation must express the ranking as a deterministic, documented weight over signals the recalled row ALREADY carries (scope, confirmation_count, created_at/last_accessed_at).

### D3 — Reuse-first framing (Unbreakable Rule 9)

**Decision:** every research question maps the reference's ranking pattern onto the SHIPPED `pipeline.ts` additive scoring + `RecallOptions` + (if present) a `Reranker` seam — the blueprint's deliverable is a COMPOSITION, not a new ranking engine.

**Rationale:** ROADMAP M10 + Princípio 1 already define the signals (recency/confirmation/similarity) as shipped; M10 only adds the scope-aware weighting stage.

## Research Questions

Six questions across the four corners (techniques ×3, tests ×1, deps ×1, tools ×1). Every method path is verified to exist on disk (checked 2026-07-22).

| # | Question | Corner | Reference project(s) | Fase A (broad map) | Fase B (deep — Read) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Does mem0 rank recall by pure vector similarity, or a COMPOSITE with recency/importance — and is the ranking scope/filter-aware? | techniques | `.claude/knowledge-base/references/mem0/` | Grep `score_and_rank`, `sort`, `score`, `created_at` in `mem0/mem0/utils/` + `mem0/mem0/memory/main.py` | Read `mem0/mem0/utils/scoring.py:60` (`score_and_rank`) + its call site in `mem0/mem0/memory/main.py:1335` (`search`) | Prose + citation: composite vs pure-similarity; does it weight recency/importance? mapped onto theo-memory's additive `scoring.ts` |
| Q2 | What reranker strategies does graphiti ship (RRF / node-distance / MMR / cross-encoder) and how are they configured/weighted? | techniques | `.claude/knowledge-base/references/graphiti/` | Grep `rrf`, `mmr`, `node_distance`, `Reranker` in `graphiti_core/search/` | Read `graphiti_core/search/search_utils.py:1780` (`rrf`) + `:1798` (`node_distance_reranker`) + `:1901` (`maximal_marginal_relevance`) + `graphiti_core/search/search_config.py:53-61` (`EdgeReranker`/`NodeReranker` enums) | Reranker catalog + config shape, mapped onto the SHIPPED `Reranker` DIP (`packages/core/src/domain/dip/reranker.ts`) + `mmr.ts` |
| Q3 | Does either reference COMBINE results from multiple scopes/sources with per-source weighting (union → scope-aware reweight), or is ranking always single-pool? | techniques | `.claude/knowledge-base/references/mem0/`, `.claude/knowledge-base/references/graphiti/` | Grep `combine`, `merge`, `group`, `source` in `graphiti_core/search/search.py` + mem0 `search` | Read `graphiti_core/search/search.py` (the search-combine) + `mem0/mem0/memory/main.py:1335` (single-pool filter search) | Honest verdict: is per-scope reweighting a KNOWN ref pattern or theo-memory-specific (grounding ADR D2's deterministic scope-weight) |
| Q4 | How does graphiti exercise its search/reranking against a real DB (does the expected order surface)? | tests | `.claude/knowledge-base/references/graphiti/` | Grep `search`, `rrf`, `SearchConfig` in `graphiti/tests/` | Read `graphiti/tests/test_graphiti_int.py` (search integration) + `graphiti/tests/helpers_test.py:24-72` (the real-DB `graph_driver` fixture) | Ranking-test pattern mapped onto theo-memory's `THEOMEM_PG_URI` + a recall@k fixture assertion (M10 benchmark methodology) |
| Q5 | What runtime deps does the ranking/reranking need (numpy for MMR cosine, etc.)? | deps | `.claude/knowledge-base/references/graphiti/`, `.claude/knowledge-base/references/mem0/` | Grep `numpy`, `scipy` in `graphiti/pyproject.toml` + `mem0/pyproject.toml` | Read `graphiti/pyproject.toml` (numpy) + `mem0/pyproject.toml` | Dep list + recommendation: theo-memory reuses its shipped `mmr.ts` (no new dep — the scope-weight is arithmetic on shipped signals, ADR D2) |
| Q6 | How are the ranking tests run locally (unit vs live-DB)? | tools | `.claude/knowledge-base/references/graphiti/`, `.claude/knowledge-base/references/mem0/` | SKIP (text-shape) — Glob `Makefile`, `pytest.ini` in both | Read `graphiti/Makefile:29` + `graphiti/pytest.ini` + `mem0/Makefile:42-52` | Test-invocation pattern mapped onto theo-memory's `npm test` (scoring unit) + `npm run test:integration` (recall@k on real pgvector) |

## Coverage Matrix

100% mapping — every question → ≥ 1 verified method path; all four corners covered (techniques Q1/Q2/Q3, tests Q4, deps Q5, tools Q6). Every `references/` path in the table above verified to exist on disk (2026-07-22): `mem0/mem0/utils/scoring.py`, `mem0/mem0/memory/main.py`, `graphiti/graphiti_core/search/{search_utils.py,search_config.py,search.py}`, `graphiti/tests/{test_graphiti_int.py,helpers_test.py}`, `{mem0,graphiti}/pyproject.toml`, `{mem0,graphiti}/Makefile`, `graphiti/pytest.ini`. No corner deferred.

## Halt-loop checkpoints

- Before a question is `done`: its answer cites ≥ 1 verified `references/` path AND names the shipped `pipeline.ts`/`RecallOptions` seam it maps onto (ADR D3).
- Before `BLUEPRINT_COMPLETE`: all four corners populated; every citation resolves; ≥ 1 ADR; the scope-aware ranking + the recall@k benchmark methodology + the `(workspace,user)` isolation invariant each addressed.

## Acceptance Criteria

- [ ] Every research question answered OR honestly `blocked`.
- [ ] Every citation backed by a real `references/{mem0,graphiti}/` path.
- [ ] Four-corner coverage complete.
- [ ] Scope-aware ranking, attribution surfacing, and the recall@k benchmark each have a concrete recommendation mapped onto a shipped seam.

## Global Definition of Done

Links to `/discover-confidence` golden rule (`.claude/rules/discover-blueprint-golden-rule.md`) + thresholds. Verdict ≥ SHIPPABLE_WITH_CAVEATS before `/to-plan`.
