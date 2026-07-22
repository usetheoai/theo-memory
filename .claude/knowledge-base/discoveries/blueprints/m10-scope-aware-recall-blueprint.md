# Blueprint: M10 — Scope-aware recall (global + current session union, ranked)

> **Version 1.0.** Grounds M10's scope-aware ranking against real mem0 + graphiti ranking code AND theo-memory's shipped 9-step retrieval pipeline. **Central findings:** (1) scope-aware reweighting is **theo-memory-NOVEL** — neither mem0 (single-pool, scope-blind) nor graphiti (RRF fuses by search-METHOD, not scope) reweights by which scope a row came from; (2) the union is already shipped (M8 hierarchical predicate), so M10 is a thin **opt-in post-threshold reweight stage** composing the shipped pipeline + `Reranker` DIP (Rule 9); (3) a **load-bearing gap** — the recall `search` SQL does NOT project `created_at`/`last_accessed_at`, so the recency boost is not computable today; M10 must extend the projection. Source research: `.claude/knowledge-base/discoveries/plans/m10-scope-aware-recall-plan.md` (SHIPPABLE_WITH_CAVEATS 89).

**Slug:** `m10-scope-aware-recall`
**Owner:** usetheodev (via `/goal` M10 directive)
**Created:** 2026-07-22

## Context

M8 (shipped) makes a session recall return `session ∪ global` via the hierarchical SQL predicate (`packages/core/src/infrastructure/db/pgvector-store.ts:199-212`) — one pool spanning both scopes, over which the shipped single-pool additive ranker runs. It does NOT rank scope-aware: a durable global fact and an ephemeral session note compete on raw composite similarity. M10 adds the scope-aware reweight ROADMAP § M10 requires — session rows recency-boosted, global rows stability-boosted (`confirmation_count`/age) — opt-in via `RecallOptions.scopes`, always inside `(workspace, user)`, surfacing attribution. Grounded in Princípio 1 (relevance = continuous score over orthogonal signals) + Princípio 2 (prioritization over volume).

## Objective

Decide HOW to add scope-aware ranking + `RecallOptions.scopes` + attribution surfacing to the shipped 9-step pipeline as a deterministic (non-neural, ADR D2) opt-in reweight stage — so `/to-plan` can build M10 as a thin composition, not a new ranking engine — including the search-projection extension the recency boost requires and a recall@k benchmark methodology.

## Coverage Corner 1 — Integration Tests

**How the references test ranking order, and the M10 analog.**

- **mem0 tests the pure ranker with explicit order assertions** — `.claude/knowledge-base/references/mem0/tests/utils/test_scoring.py`: `test_semantic_plus_bm25` asserts `scored[0]["id"] == "b"` with `pytest.approx(0.75)` after a BM25 boost flips the order (`:65-78`), plus `test_semantic_only` identity order (`:54-63`) and BM25-normalize boundary tests (`:35-50`). This pure-function order-correctness pattern is the template M10 copies for its scope-reweight unit test.
- **graphiti** has NO isolated unit test for `rrf`/`mmr`; its fusion rerankers are proven via integration (`.claude/knowledge-base/references/graphiti/tests/test_graphiti_int.py`) over the real-DB `graph_driver` fixture (`.claude/knowledge-base/references/graphiti/tests/helpers_test.py:24-72`); the cross-encoder client has a sorted-score unit assertion (`.claude/knowledge-base/references/graphiti/tests/cross_encoder/test_gemini_reranker_client.py:107-121`).
- **M10 analog:** a fast unit test on the deterministic scope-reweight function (mem0's `test_scoring.py` template — assert a session row's recency boost re-orders it above a stale session row, and a high-`confirmation_count` global row above a one-off) + a real-pgvector integration recall@k test via `THEOMEM_PG_URI` + `createIsolatedDb` (the ROADMAP M10 acceptance: a session-only fact surfaces in-session for its author; a stale session fact is deprioritized; a global fact surfaces across the user's sessions; nothing leaks to another user).

## Coverage Corner 2 — Dependencies

**What the ranking needs — and why M10 adds NOTHING.**

- **graphiti** MMR L2-normalizes embeddings with `numpy` (already a graphiti dep, `.claude/knowledge-base/references/graphiti/pyproject.toml`); its rerankers otherwise need no extra runtime dep (RRF/node-distance are pure arithmetic). The cross-encoder path needs a model dep — explicitly OUT of M10 scope (ADR D2 / ROADMAP Item 23).
- **mem0** `score_and_rank` is pure Python arithmetic (`.claude/knowledge-base/references/mem0/mem0/utils/scoring.py:60-139`); no ranking-specific dep beyond the embedder/store (`.claude/knowledge-base/references/mem0/pyproject.toml`).
- **M10 decision — add NO new dependency.** The scope-aware reweight is arithmetic over signals the row already carries (scope, `confirmation_count`, `created_at`/`last_accessed_at`); theo-memory already ships MMR cosine math in `packages/core/src/domain/retrieval/mmr.ts` (reused if the reweight needs vector ops). Deterministic weight = zero deps (ADR D2).

## Coverage Corner 3 — Tools

**Local + CI test-invocation, and the M10 mapping.**

- **mem0:** `make test` → `hatch run test` (`.claude/knowledge-base/references/mem0/Makefile:42-52`) — the pure-ranker `test_scoring.py` runs in the fast unit tier.
- **graphiti:** `make test` → `uv run pytest -m "not integration"` (`.claude/knowledge-base/references/graphiti/Makefile:29`); ranking integration needs the compose'd DB; `asyncio_mode = auto` + `integration` marker (`.claude/knowledge-base/references/graphiti/pytest.ini`).
- **M10 mapping:** the shipped two-tier split — `npm test` (the deterministic scope-reweight pure-function unit test) + `npm run test:integration` (the recall@k / scope-order proof on real pgvector via `THEOMEM_PG_URI`). No new tooling; the M5 CI `integration.yml` gate already runs it.

## Coverage Corner 4 — Techniques

**The ranking patterns + the M10 composition.**

### 4.1 mem0 — additive composite, scope-blind (Q1)

`score_and_rank` computes `combined = (semantic + bm25 + entity_boost) / max_possible` (capped 1.0), semantic-threshold gating BEFORE combine, `max_possible ∈ {1.0..2.5}` by active signals, final `sort(desc)[:top_k]` (`.claude/knowledge-base/references/mem0/mem0/utils/scoring.py:97-139`). **NO recency/importance term; scope-blind** — all scope keys collapse to one `effective_filters` into ONE `vector_store.search` (`.claude/knowledge-base/references/mem0/mem0/memory/main.py:1598-1600`); `created_at`/`updated_at` are display-only (`main.py:1668-1669`). Reranking is opt-in cross-encoder AFTER the composite (`main.py:1342, 1455-1461`).

**Maps onto:** theo-memory's shipped `combineScores`/`maxPossible` (`packages/core/src/domain/scoring.ts:65-101`) — byte-identical additive shape. M10's scope-reweight is a NEW stage AFTER this combine, not a change to it.

### 4.2 graphiti — pluggable rerankers, RRF-default, no recency (Q2)

Five per-result-type strategies (`.claude/knowledge-base/references/graphiti/graphiti_core/search/search_config.py:53-77`): `rrf` (default), `node_distance`, `episode_mentions`, `mmr`, `cross_encoder`. `rrf(results, rank_const=1)` sums `1/(i+rank_const)` across ranked lists (`.claude/knowledge-base/references/graphiti/graphiti_core/search/search_utils.py:1780-1795`); `node_distance_reranker` scores `1/hops` (`:1798-1857`); `episode_mentions` re-sorts by mention frequency — a stability-like signal (`:1860-1898`); `maximal_marginal_relevance` (`:1901+`). Thin config: `mmr_lambda` + `reranker_min_score` (`search_config.py:84,118`). **Ordering is always `score DESC`; no recency term.**

**Maps onto:** the SHIPPED `Reranker` DIP (`packages/core/src/domain/dip/reranker.ts:32-46`, one method `rerank(query, candidates, topK)`, wired at `pipeline.ts:596-611`) + the shipped `mmr.ts`. M10's scope-reweight is a deterministic reranker in the SAME opt-in-stage shape (mutually exclusive with `diversify`/`rerank`, λ/weight config, `emitEvent` observability, fail-soft — mirroring `RecallOptions.diversify` at `options.ts:167-170`).

### 4.3 Scope-aware reweighting is theo-memory-NOVEL (Q3 — honest)

> **HONEST FINDING:** NEITHER reference reweights by scope/source. mem0 is single-pool; graphiti's RRF fuses lists from different search METHODS (cosine/fulltext/BFS) symmetrically by rank-position, NOT by scope. The closest shipped analog to "union two scopes then rank as one pool" is the M8 hierarchical predicate (`pgvector-store.ts:199-212`) — one SQL pool over session ∪ global. **M10 adds a per-source reweight on that union — genuinely novel vs both refs.** The reusable primitives are the SHAPE (additive-composite + pluggable-reranker + λ config), not a scope-reweight algorithm; M10 designs the weight from theo-memory's OWN Princípio 1 signals (deterministic, explainable).

## ADRs

### D1 — M10 is a thin opt-in post-threshold reweight STAGE, not a new ranking engine (Rule 9)

**Decision:** M10 ships a deterministic scope-aware reweight as a NEW opt-in stage in the shipped pipeline (mirroring the `diversify`/`rerank` post-threshold stages), gated by a new `RecallOptions.scopes` field; the default path is byte-identical to today (backward-compat).

**Rationale:** the union is shipped (M8), the additive score is shipped (`scoring.ts`), the reranker-stage pattern is shipped (`pipeline.ts:596-611` + the `Reranker` DIP). M10 only adds the scope-weight arithmetic. **Alternatives:** (i) change `scoring.ts` to add a scope term (rejected — mutates the base score for ALL callers, not opt-in); (ii) a neural reranker (rejected — ADR D2 / Item 23 boundary).

### D2 — Deterministic scope-weight, NOT a neural reranker

**Decision:** the reweight is deterministic arithmetic over the row's scope-tier + recency (`created_at`/`last_accessed_at` age) + `confirmation_count` — no model dependency.

**Rationale:** explainable (Princípio 3), dependency-free, sufficient for "session recency vs global stability"; the cross-encoder `Reranker` is a separate milestone (ROADMAP Item 23). **Alternative:** RRF-style rank-fusion (rejected — fuses by rank position, cannot express "boost this SCOPE", the exact M10 requirement).

### D3 — Extend the recall search projection to carry the recency signal (the load-bearing gap)

**Decision:** the vector `search` SQL `cols` (`pgvector-store.ts:514-516`) — which today projects `confirmation_count` but OMITS `created_at`/`last_accessed_at` — MUST be extended so `rowToResult`/`rowToItem` carry real timestamps; today `rowToItem` hardcodes `createdAt: now` (`pipeline.ts:531-532`), making a recency boost impossible.

**Rationale:** the recency half of the scope-weight is uncomputable without it. The column plumbing already exists on the `getAll`/page path (`pgvector-store.ts:746-747`), so this is a projection extension, not a schema change. **Consequence:** a small, well-scoped change to the hottest query — benchmark the projection cost (extra columns are cheap; the recall@k benchmark covers it).

### D4 — Isolation is enforced UPSTREAM of ranking (no new isolation surface)

**Decision:** the scope-reweight operates on an already-`(workspace, user)`-safe pool — `composeFilters` (`pgvector-store.ts:184-212`) applies the workspace+user+hierarchy predicate BEFORE ranking, so the reweight never sees another user's rows.

**Rationale:** M8's isolation hard gate already holds; M10's cross-user hard-gate test asserts the union query still filters by the FULL `(workspace_id, user_id)` (ROADMAP M10 risk #1). **Consequence:** no new isolation code — reuse + re-assert via test.

## Recommendations (one per research question)

| Q | Recommendation | Shipped seam |
|---|---|---|
| Q1 | Keep the additive `combineScores` as the BASE score; add the scope-weight as a separate post-combine stage | `scoring.ts:65-101` |
| Q2 | Implement the scope-reweight in the shipped `Reranker`-DIP opt-in-stage shape (mutually exclusive w/ diversify/rerank, λ config, fail-soft, emitEvent) | `dip/reranker.ts` + `pipeline.ts:588-611` |
| Q3 | Design the scope-weight from Princípio 1 signals (theo-memory-novel — no ref algorithm to port); document it as deterministic + explainable | `theo-memory/CLAUDE.md § Princípio 1` |
| Q4 | Pure-function order unit test (mem0 `test_scoring.py` template) + real-pgvector recall@k integration test | `THEOMEM_PG_URI` + `createIsolatedDb` |
| Q5 | Add NO dependency — arithmetic over shipped signals; reuse `mmr.ts` if vector ops needed | `retrieval/mmr.ts` |
| Q6 | Unit in `npm test`, recall@k in `npm run test:integration` (M5 CI gate) | `package.json` scripts |

Plus the load-bearing prerequisite (D3): extend the `search` `cols` projection with `created_at` + `last_accessed_at` and surface them on `MemoryItemWithScore` (`memory-item.ts:23,71` already declare the fields) so the recency boost is computable, and add `RecallOptions.scopes` (`options.ts` has no `scopes` today).

## Cross-cutting Comparison

| Axis | mem0 | graphiti | M10 reuse decision |
|---|---|---|---|
| Base ranking | additive composite (`scoring.py:97-139`) | per-method lists `ORDER BY score DESC` | reuse shipped additive `combineScores` |
| Reranker | opt-in cross-encoder (`main.py:1342`) | pluggable rrf/mmr/node_distance/cross_encoder (`search_config.py:53-77`) | reuse shipped `Reranker` DIP opt-in-stage shape |
| Recency in ranking | none (display-only) | none (`score DESC` only) | **M10 adds it** — but must extend the search projection first (D3) |
| Scope-aware reweight | none (single pool) | none (RRF fuses methods, not scopes) | **M10-novel** — deterministic scope-weight (D2) |
| Isolation vs ranking | filter pre-search | `group_ids` pre-filter | reuse `composeFilters` upstream; re-assert via hard-gate test (D4) |
| Config | reranker on/off | `mmr_lambda` + `min_score` | `RecallOptions.scopes` + deterministic weights |

## Coverage Matrix

All four corners populated with verified citations (Integration Tests §1, Dependencies §2, Tools §3, Techniques §4). Every `references/` and `packages/core/src/` path cited above verified to exist on disk (2026-07-22). No fabricated citation.
