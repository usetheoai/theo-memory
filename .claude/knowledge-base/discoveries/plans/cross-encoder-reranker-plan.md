# Discovery Plan: Cross-encoder reranker (Reranker DIP)

> **Version 1.0** — investigate how the reference projects implement a post-retrieval reranking stage (cross-encoder / LLM / hosted), so TheMemory can ship Roadmap Item 23: an optional `Reranker` DIP + a default cross-encoder impl wired as a post-threshold stage in the recall pipeline. In scope: `mem0` (full `mem0/reranker/` module — the closest analog) and `letta` (Pinecone-hosted reranking convention). Output: a blueprint that locks (a) the DIP method shape, (b) the default impl's model + backend (reuse `@xenova/transformers`, already a dep — Inquebrável Rule 9), (c) the exact pipeline insertion point relative to the existing MMR diversify stage, (d) the opt-in + subpath-isolation pattern.

**Slug:** `cross-encoder-reranker`
**Owner:** project-owner
**Created:** 2026-06-22
**Time budget:** 3h (mem0: 2h, letta: 1h — per ADR D1)

## Context

Roadmap Item 23 (`memory-gaps-roadmap.md`, re-prioritized to 1st opportunistic 2026-06-22) calls for "an optional cross-encoder reranker (`Reranker` DIP) wired as a post-threshold stage in the recall pipeline; lifts precision@k." The source cross-validation (`cross-validation-output/final_report.md`, TheMemory × Letta 3.58/5) flagged reranking as a precision gap. TheMemory's recall pipeline (`packages/core/src/domain/retrieval/pipeline.ts`) already has the exact structural seam: **Step 8.5** runs an opt-in MMR diversify rerank (`options.diversify`) between threshold-filter (Step 8) and top-K format (Step 9). A cross-encoder reranker is a sibling post-threshold stage. The DIP/opt-in/subpath-isolation discipline is locked precedent: `RecallCacheStore` (`packages/core/src/domain/dip/recall-cache-store.ts`, 13th DIP, `@usetheo/memory/cache-pg` subpath), `SkillExecutor` (`packages/core/src/domain/dip/skill-executor.ts`, opt-in/gated), and `LocalTransformerEmbedder` (`@usetheo/memory/embedders/local`, `@xenova/transformers` reuse). This discovery locks the borrowed shape before `/to-plan`.

## Objective

Decide the `Reranker` DIP method shape, the default cross-encoder impl's model + backend, and the precise pipeline insertion point (relative to MMR diversify), so `/to-plan` can produce an implementation plan with zero open architectural questions. Measurable success criteria for the blueprint:

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated for mem0 + letta
- [ ] Recommendations section gives one concrete decision proposal per research question (DIP shape, default model, backend, pipeline order, fallback policy, opt-in surface)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mem0/` | `mem0/reranker/` (base + 5 impls), `mem0/configs/rerankers/`, `mem0/tests/rerankers/`, `mem0/docs/components/rerankers/` | The closest analog — a complete pluggable reranker module with cross-encoder, LLM, and hosted impls + tests + config shape |
| `.claude/knowledge-base/references/letta/` | `letta/letta/helpers/pinecone_utils.py` | The hosted-reranking convention (`bge-reranker-v2-m3`, `top_n`, `rank_fields`) — validates the model family + the "rerank top_n then return" contract |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/mem0/docs/` (except `components/rerankers/`) | Marketing docs, not source of truth |
| `.claude/knowledge-base/references/*/{build,dist,.venv,node_modules}/` | Build artifacts |
| Hosted-API rerankers (Cohere, ZeroEntropy) as the DEFAULT impl | <!-- DEFER-CORNER: techniques | hosted-API rerankers require an API key + network; the default must be key-free per the LocalTransformerEmbedder precedent. They are studied as DIP-shape evidence (the DIP must accommodate them as opt-in impls) but NOT shipped as the v1 default. --> |
| Python `sentence-transformers` as a runtime dep | TheMemory is TS/Node; the cross-encoder runs via `@xenova/transformers` (already a dep). spaCy-style cross-runtime sidecar REJECTED (same rationale as the entity-extraction `compromise` decision). |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** mem0: 2h (the full reranker module), letta: 1h (pinecone reranking convention only).

**Rationale:** mem0 is the direct analog (a pluggable reranker module mirroring exactly the DIP shape we will build); letta only confirms the model family + the top_n contract via its hosted path. Equal split would over-invest in letta's single relevant file.

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 retries with different query variants, mark BLOCKED with reason "Fase A exhausted" and continue. Do NOT pad with unrelated hotspots.

**Stop condition — per project (mandatory):** When a project's budget is exhausted with N questions pending, mark them BLOCKED with reason "budget exhausted" and continue. If every remaining question is `done` or honestly `blocked`, emit `<promise>BLUEPRINT_BLOCKED</promise>` (never `BLUEPRINT_COMPLETE` from a blocked state).

**Anti-pattern:** NEVER fabricate Fase B answers to close a question whose Fase A was exhausted (Unbreakable Rule 3).

**Consequences:** the loop stops per-project on budget exhaustion; blocked questions surface in the blueprint as next-discovery seed.

### D2 — Investigation depth

**Decision:** Read each in-scope reranker source file end-to-end (mem0's module is small — base + 5 impls ≈ 6 files); Grep+Read for the letta pinecone path (one file, one symbol).

**Rationale:** the DIP method shape and the fallback/score-combination semantics are load-bearing and only visible by reading the impl end-to-end; a Grep-only pass would miss the fallback-to-original-order behavior (`sentence_transformer_reranker.py` `except` branch) and the score-field contract (`rerank_score`).

**Alternatives considered:** Grep-only (misses semantics), single-file sample (misses the cross-impl DIP commonality).

**Consequences:** higher per-file cost, bounded by the module's small size.

### D3 — Default backend = `@xenova/transformers` (already a dep), NOT a new heavy dep

**Decision:** the discovery will VALIDATE (not assume) that `@xenova/transformers` supports cross-encoder/reranker ONNX models in-process, and treat it as the candidate default backend.

**Rationale:** Inquebrável Rule 9 (Não Reinvente) + the `LocalTransformerEmbedder` precedent (`@xenova/transformers` already backs the default embedder; no API key). A new dep (onnxruntime-node direct, or a hosted API) raises the deps-audit + bundle-isolation burden. The blueprint must confirm @xenova exposes a cross-encoder/sequence-classification path; if it does NOT, the blueprint records the blocker and proposes the next-cheapest option.

**Alternatives considered:** `onnxruntime-node` direct (heavier, manual tokenization), Cohere/hosted API (key + network — rejected as default per the out-of-scope DEFER), Python sidecar (cross-runtime — rejected).

**Consequences:** ties the default impl to the @xenova capability surface; the DIP itself stays backend-agnostic so hosted impls remain opt-in.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — grep/ast map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | What is the reranker DIP method signature + return contract (score field, top_k, ordering)? | techniques | mem0 | `grep -n "def rerank" mem0/mem0/reranker/*.py` | Read `reranker/base.py` + `reranker/sentence_transformer_reranker.py` end-to-end | Method signature table + the `rerank_score` field contract + sort-desc + top_k semantics |
| Q2 | How does the cross-encoder impl score query-document pairs, and what is its failure/fallback policy? | techniques | mem0 | `grep -n "CrossEncoder\|predict\|except\|fallback" mem0/mem0/reranker/sentence_transformer_reranker.py` | Read the `rerank()` body incl. the `except` branch | Pair-construction + batch predict + sort + the documented fallback-to-original-order-on-failure behavior |
| Q3 | What model + which package backs the cross-encoder, and is there a TS/Node equivalent already in TheMemory? | deps | mem0 + (TheMemory self) | `grep -rn "ms-marco\|cross-encoder\|sentence_transformers\|model=" mem0/mem0/configs/rerankers/ mem0/mem0/reranker/` ; check TheMemory `package.json` for `@xenova/transformers` | Read `configs/rerankers/sentence_transformer.py` (default model) + confirm `@xenova` presence + cross-encoder support | Default model id (`cross-encoder/ms-marco-MiniLM-L-6-v2`) + the @xenova reuse decision (D3) with a verified support note |
| Q4 | How does the hosted path (letta Pinecone) frame reranking — model family, top_n, return contract? | techniques | letta | `grep -n "rerank" letta/letta/helpers/pinecone_utils.py` | Read the rerank call site | Confirms the `bge-reranker-v2-m3` family + `top_n` + "rerank then return top_n" — validates the DIP's top_k param is the right shape |
| Q5 | How does mem0 test its reranker (fixtures, what is asserted, real model vs stub)? | tests | mem0 | `ls mem0/tests/rerankers/ ; grep -n "def test_\|assert\|mock\|monkeypatch" mem0/tests/rerankers/*.py` | Read `tests/rerankers/test_llm_reranker_rerank.py` + `conftest.py` | Test pattern: what is stubbed (the model) vs asserted (ordering + score field), to mirror in our integration test |
| Q6 | What config knobs does the reranker expose (batch_size, device, top_k, model) and how are they defaulted? | tools | mem0 | `grep -n "batch_size\|device\|top_k\|show_progress\|model" mem0/mem0/configs/rerankers/*.py` | Read `configs/rerankers/base.py` + `sentence_transformer.py` | Config-knob table → informs the default impl's constructor options + which we expose vs hardcode (KISS) |
| Q7 | Where exactly should the rerank stage sit relative to the existing MMR diversify stage (Step 8.5) and threshold (Step 8)? | tools | TheMemory self (grounded by mem0 ordering) | `grep -n "Step 8\|diversify\|mmrRerank\|threshold" packages/core/src/domain/retrieval/pipeline.ts` | Read pipeline.ts Steps 8→9 + mem0's search call-order around its reranker | Decision: rerank AFTER threshold; interaction rule with diversify (mutually exclusive vs chained); over-fetch pool sizing |

Question budget: 7 total. Per-corner: techniques ×3 (Q1, Q2, Q4), deps ×1 (Q3), tests ×1 (Q5), tools ×2 (Q6 config knobs, Q7 pipeline-ordering decision). All four corners populated; max 3/corner respected (Q7 is a wiring/ordering decision → tools corner, not a borrowed algorithm).

## Coverage Matrix

| Question | Corner | Method (Fase A) | Method (Fase B) | Status |
|---|---|---|---|---|
| Q1 | techniques | grep `def rerank` | Read base + sentence_transformer | planned |
| Q2 | techniques | grep CrossEncoder/except | Read rerank() body | planned |
| Q3 | deps | grep model id + @xenova check | Read config + confirm dep | planned |
| Q4 | techniques | grep rerank in pinecone_utils | Read call site | planned |
| Q5 | tests | ls + grep test asserts | Read test + conftest | planned |
| Q6 | tools | grep config knobs | Read config base + st | planned |
| Q7 | tools | grep pipeline Step 8/diversify | Read pipeline + mem0 order | planned |

All four corners (techniques/deps/tools/tests) populated. No DEFER-CORNER markers needed (the hosted-default deferral is a scope exclusion, not a corner deferral).

## Halt-loop Checkpoints

Before marking each question `done`, the `/discover-execute` loop MUST verify:

1. Every cited path resolves (`Path.exists()`) — no fabricated citation.
2. Q1/Q2 capture the `except`/fallback branch verbatim (the fallback-to-original-order is the load-bearing resilience contract).
3. Q3 records a CONCRETE yes/no on `@xenova` cross-encoder support (read the dep's exports or docs), not an assumption.
4. Q7 produces an explicit ordering decision with the diversify-interaction rule (chained vs mutually exclusive).

## Acceptance Criteria

- [ ] 7/7 questions `done` (or honestly `blocked` with reason).
- [ ] Every citation backed by a real `.claude/knowledge-base/references/` path.
- [ ] Cross-cutting table: mem0 vs letta on (DIP shape, model, backend, fallback, top_k contract).
- [ ] ≥ 1 ADR section in the blueprint (DIP method count per ADR-0008; default model+backend; pipeline order).
- [ ] Recommendations: DIP signature, default model, backend (D3 confirmed/blocked), pipeline insertion point, fallback policy, opt-in surface (RecallOptions.rerank + config slot + subpath).

## Global Definition of Done

- [ ] `/discover-confidence cross-encoder-reranker` ≥ SHIPPABLE_WITH_CAVEATS per `.claude/rules/discover-blueprint-golden-rule.md`.
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/cross-encoder-reranker-blueprint.md`.
- [ ] No fabricated citations (hard cap).
- [ ] All 4 coverage corners populated (hard cap).
