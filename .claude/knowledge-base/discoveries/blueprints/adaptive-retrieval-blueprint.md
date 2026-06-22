# Blueprint: Adaptive Retrieval (Self-RAG / CRAG decision hooks)

**Slug:** `adaptive-retrieval`
**Discovery plan:** `.claude/knowledge-base/discoveries/plans/adaptive-retrieval-plan.md`
**Date:** 2026-06-22
**/discover-confidence verdict:** SHIPPABLE (0 hard caps)

## Context

Roadmap Item 13 (v1.2, unfrozen 2026-06-21): add `shouldRetrieve` + `wasRetrievalGood` adaptive-retrieval decision hooks (Self-RAG `arXiv:2310.11511` / CRAG `arXiv:2401.15884` / Adaptive-RAG `arXiv:2403.14403`). Today `recall()` runs the full 9-step pipeline unconditionally (`packages/core/src/domain/retrieval/pipeline.ts:7-17`) — it embeds + hits pgvector for EVERY query (even ones that need no memory) and returns whatever passes the `threshold` gate even when the top result is weak. This blueprint decides how an opt-in adaptive policy reuses the SHIPPED opt-in-DIP seam (the cross-encoder reranker, `packages/core/src/domain/dip/reranker.ts`, hooks the same `recall()` pipeline) to (a) SKIP retrieval pre-emptively and (b) GRADE-and-CORRECT weak retrievals — both observable (Princípio 3) and fail-soft.

## Objective

Decide the DIP shape, the pipeline seam, the key-free default impl, the fail-soft + observability contract, and the GOAL-test shape for an opt-in adaptive-retrieval policy, so `cycle-plan` implements it with zero re-scoping.

## Executive summary

The feature is a **structural mirror of the shipped cross-encoder reranker**: a new DIP (`AdaptiveRetrievalPolicy`) with ≤ 2 methods (`shouldRetrieve` pre-embed + `assess` post-threshold), wired OPT-IN via `createLocalMemory({ retrievalPolicy })` + a `RecallOptions.adaptive` toggle, DEFAULT OFF (byte-unchanged). The default impl is a **key-free heuristic** (mirrors `LocalTransformerEmbedder` key-free default + the reranker/ontology zero-dep precedent): `shouldRetrieve` returns true unless the query matches a no-retrieval signal; `assess` grades by the top combined-score and, when below a corrective floor, applies ONE bounded corrective (relax `threshold` and re-run the score-combine over the already-fetched over-fetch pool — NO second embed, NO external fallback). Three new observable events (`retrieval_skipped` / `retrieval_corrected` / `retrieval_low_confidence`) extend the `MEMORY_EVENTS` union (`packages/core/src/domain/memory-event.ts:16`). Fail-soft: a policy error NEVER fails recall (mirrors the reranker `recall_rerank_failed` catch at `pipeline.ts:97`). ZERO new dependency. The clones confirm the originality: mem0's `infer` flag gates INGESTION not retrieval (`controlling-memory-ingestion.mdx:323`); neither mem0 nor letta has a Self-RAG pre-retrieval gate or a CRAG grade-and-correct.

## Coverage Corner 1 — Integration Tests

**Q4 — shipped opt-in-DIP GOAL-test shape (real pgvector, opt-in vs default-byte-unchanged, stage-actually-fired).** The reranker GOAL (`tests/integration/reranker.test.ts:34-40`) is the template: `import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory'`; an isolated DB (`const ISOLATED_DB = 'themem_reranker_goal'`); `describe.skipIf(ROOT_PG_URI === '')` (no flaky CI); a deterministic queue-LLM so the STORED text equals the fixture while the feature under test runs real; assertions that prove the stage FIRED and is not a passthrough (reranker.test.ts asserts the reranked top differs from the cosine-baseline score). Adaptive GOAL skeleton:
- **shouldRetrieve=false ⇒ skip:** wire a policy whose `shouldRetrieve` returns false for a sentinel query → `recall()` returns `[]` WITHOUT embedding (assert via a spy embedder call-count 0) AND emits `retrieval_skipped`.
- **grade-correct fires on weak top:** seed a single weakly-related memory; with a corrective floor above the natural top-score, assert the corrective relaxes threshold and still returns the row (or emits `retrieval_low_confidence` when even relaxation finds nothing) — proving `assess` ran.
- **default unchanged:** no `adaptive` option ⇒ identical results to a plain `recall()` (byte-unchanged regression).

**Q5 — fail-soft + observability contract.** `memory-event.ts:16` is a typed `MEMORY_EVENTS` string-literal union consumed by `emitEvent(tracer, event, attrs)` (`memory-event.ts:113`); when `tracer` is undefined `emitEvent` is a no-op (`:118`). The reranker fail-soft pattern (`pipeline.ts:74-99`): the stage is wrapped in `try { … } catch (err) { emitEvent(tracer, 'recall_rerank_failed', …); return <original cosine order> }` — "a reranker outage MUST NEVER take down recall" (`pipeline.ts:78`). The adaptive policy copies this: both `shouldRetrieve` and `assess` are wrapped so a policy throw degrades to the NORMAL (non-adaptive) path + an event. New event literals append to the union (no new export statement risk — same block).

## Coverage Corner 2 — Dependencies

**DEFER-CORNER (deps) — ZERO new dependency (confirmed).** The v1 default policy is a key-free heuristic: `shouldRetrieve` uses a string signal (configurable no-retrieval markers / always-true default); `assess` compares the top `MemoryItemWithScore.score` (already computed by `scoring.ts` at `pipeline.ts:15`) against a corrective floor and, on correction, re-runs the EXISTING score-combine over the already-fetched over-fetch pool (`internalLimit = max(topK*4, 60)`, `pipeline.ts:9`) at a relaxed threshold — no second embed, no model, no library. An OPTIONAL LLM-judged policy (Self-RAG reflection / CRAG grader) reuses the EXISTING `LLM` DIP (`packages/core/src/domain/dip/llm.ts`) — still no new dep. This mirrors the reranker (no new dep; `@xenova` was already optional) + ontology (reused zod) zero-dep precedent. A formal `/deps-audit` runs in cycle-plan regardless.

## Coverage Corner 3 — Tools

**DEFER-CORNER (tools) — no new build/test/lint tooling (confirmed).** The feature is a DIP (`packages/core/src/domain/dip/adaptive-retrieval-policy.ts` NEW) + a pipeline-seam wiring in `pipeline.ts` + a `recall()` plumb in `scoped-memory.ts` + an opt-in `RecallOptions.adaptive` field + (optionally) a default-impl subpath `@usetheo/memory/adaptive-local`. It reuses the existing vitest config, the pgvector integration harness (`tests/integration/`), and the `@usetheo/memory/*` subpath build (`postbuild:rewrite-aliases`). No new CLI, no new container, no new linter. Same tooling footprint as the reranker/ontology cycles.

## Coverage Corner 4 — Techniques

**Q1 — the pipeline seam.** `pipeline.ts:7-17` documents the 9 steps: Step 1 preprocess → Step 2 embed query → Step 3 semantic over-fetch → Steps 4-7 BM25/entity/combine → Step 8 threshold filter → Step 9 top-K sort. The reranker/diversify hook **Step 8.5** (after threshold, before topK; `pipeline.ts:45-49`, `:74-99`). Adaptive needs TWO seams:
- **Pre-Step-2 (shouldRetrieve):** the Self-RAG "Retrieve?" gate runs BEFORE the embed (Step 2) so a skip avoids the embed + DB cost entirely. This is a NEW seam at the TOP of the pipeline (or in `scoped-memory.ts` recall() before delegating to the pipeline).
- **Step 8.6 (assess + correct):** the CRAG grade runs AFTER the threshold filter (Step 8) — it inspects the surviving pool's top score; if weak, it re-runs the combine over the Step-3 over-fetch pool at a relaxed threshold (a bounded, in-memory corrective; NO re-embed). Ordering vs reranker: assess runs alongside/after the existing Step 8.5 rerank seam.

**Q2 — the opt-in-DIP shape.** The `Reranker` DIP is **1 method** (`rerank(query, candidates, topK)`, `reranker.ts:43-47`) — ISP-minimal, async, "MUST NOT mutate input", default impl behind `@usetheo/memory/reranker-local` (`reranker.ts:25-26`). The `ConflictResolutionPolicy` (`dip/conflict-resolution-policy.ts`) is the multi-impl precedent (Noop / LastWriteWins / LlmJudged). `AdaptiveRetrievalPolicy` proposal (≤ 2 methods, within ADR-0008 cap):
```ts
interface AdaptiveRetrievalPolicy {
  shouldRetrieve(query: string, scope: Scope): Promise<RetrievalDecision>; // {retrieve: boolean; reason?: string}
  assess(query: string, results: readonly MemoryItemWithScore[]):
    Promise<RetrievalAssessment>; // {sufficient: boolean; action: 'accept'|'relax'|'reject'; relaxedThreshold?: number}
}
```
Opt-in wiring mirrors `RecallOptions.rerank` (`options.ts` — the `rerank?: { topK?; pool? }` block): a new `adaptive?: { correctiveFloor?: number; relaxedThreshold?: number }` toggle + a `createLocalMemory({ retrievalPolicy })` instance slot. DEFAULT (undefined) ⇒ byte-unchanged (the same default-OFF rule the reranker/diversify/ontology all follow).

**Q3 — clone presence/absence (honest baseline).** CONFIRMED ABSENT in both clones. mem0: `controlling-memory-ingestion.mdx:323,330-334` documents `infer=True/False` — but that gates **ingestion** (whether the write-pipeline extracts facts), NOT retrieval; mem0's `search()` (`mem0/memory/main.py:144` `_validate_search_params`) has only `threshold` + `top_k` + an optional configured `reranker` (`:349`), with NO `should_retrieve` pre-gate and NO post-retrieval grade-and-correct. letta: no `should_retrieve` / `retrieval_router` / `self_rag` / `corrective` symbol under `letta/services/`. The adaptive-retrieval decision hooks are therefore ORIGINAL to TheMemory among the clones; the prior art is the research literature (Self-RAG/CRAG/Adaptive-RAG) + our own opt-in-DIP seam. This confirms the design borrows the SHAPE (opt-in DIP) from our shipped code and the SEMANTICS (skip / grade-correct) from the papers.

## Cross-cutting comparison

| Dimension | mem0 | letta | TheMemory (proposed) |
|---|---|---|---|
| Pre-retrieval skip gate (Self-RAG "Retrieve?") | ABSENT (only `infer` ingestion gate) | ABSENT | `shouldRetrieve` (pre-embed, opt-in, key-free default) |
| Post-retrieval grade-and-correct (CRAG) | ABSENT (static `threshold` only) | ABSENT | `assess` → bounded in-memory relax-corrective (no re-embed, no web fallback) |
| Opt-in DIP + default-OFF | n/a | n/a | mirrors shipped `Reranker` DIP (`reranker.ts`) |
| Fail-soft (outage never fails recall) | n/a | n/a | mirrors `recall_rerank_failed` catch (`pipeline.ts:97`) |
| Observability | limited | limited | 3 new `MEMORY_EVENTS` literals (Princípio 3) |
| New dependency | — | — | ZERO (heuristic default; optional LLM reuses existing LLM DIP) |

## ADRs

### D1 — `AdaptiveRetrievalPolicy` DIP, ≤ 2 methods (`shouldRetrieve` + `assess`), within ADR-0008 cap
**Decision:** one cohesive DIP with the two decision hooks the roadmap names. **Rationale:** ISP — both hooks belong to "adapt the retrieval"; splitting into two DIPs would force consumers to wire two slots for one concern. ≤ 2 methods honors ADR-0008 (the `Reranker` is 1, `ConflictResolutionPolicy` is 1; 2 is within cap). **Alternatives:** two separate DIPs (rejected — over-segmented); fold into `Reranker` (rejected — different concern: relevance-rescore vs retrieve-or-not). **Consequences:** a new `dip/adaptive-retrieval-policy.ts` + a default impl.

### D2 — Two seams: `shouldRetrieve` PRE-embed, `assess` POST-threshold (Step 8.6)
**Decision:** gate before Step 2 (skip avoids embed+DB cost) + grade after Step 8 (alongside the reranker Step 8.5 seam). **Rationale:** Self-RAG gates before retrieval; CRAG grades after — the seams map 1:1 to the papers + reuse the existing post-threshold extraction point (`pipeline.ts:74`). **Alternatives:** single post-retrieval seam only (rejected — loses the cost-saving skip); gate inside the vector store (rejected — DIP boundary violation, `architecture.md § 3`). **Consequences:** `scoped-memory.ts` recall() gains a pre-pipeline gate; `pipeline.ts` gains a Step 8.6 assess+correct.

### D3 — Default impl is a KEY-FREE heuristic; corrective is bounded in-memory (no re-embed, no external fallback)
**Decision:** ship a heuristic default (top-score floor + threshold relax over the existing over-fetch pool); the corrective NEVER re-embeds and NEVER calls an external service. **Rationale:** KISS/YAGNI + the locked "memory layer NOT agent runtime" override — full CRAG web-search fallback is an agent-runtime concern (DEFER-CORNER, deferred to TheoKit). Key-free mirrors `LocalTransformerEmbedder`. **Alternatives:** LLM-judged default (rejected — needs a key, slower, non-deterministic default); web-search corrective (rejected — out of scope per override). **Consequences:** the default is deterministic + testable without a key; an optional LLM-judged impl is a follow-up behind the same DIP.

### D4 — Opt-in + default-OFF + fail-soft + 3 observable events
**Decision:** `RecallOptions.adaptive` + `createLocalMemory({ retrievalPolicy })`, default OFF (byte-unchanged); both hooks fail-soft to the normal path; emit `retrieval_skipped` / `retrieval_corrected` / `retrieval_low_confidence`. **Rationale:** the exact contract the reranker/diversify/ontology shipped (opt-in, default-preserving, fail-soft, observable) — proven, reviewer-familiar, no behavior change for existing callers. Princípio 3 (auditability): every skip/correct decision is observable. **Alternatives:** on-by-default (rejected — breaks byte-unchanged + surprises callers); throw-on-policy-error (rejected — violates fail-soft Rule 8 spirit for a non-critical enhancement). **Consequences:** 3 new event literals append to `MEMORY_EVENTS`; a GOAL test asserts skip + correct + default-unchanged.

## Recommendations (one per research question)

- **Q1 →** add a pre-embed gate in `scoped-memory.ts` recall() + a Step 8.6 assess-correct in `pipeline.ts` (reuse the Step 8.5 extraction-point pattern).
- **Q2 →** ship `AdaptiveRetrievalPolicy` DIP (2 methods) + opt-in `RecallOptions.adaptive` + `createLocalMemory({ retrievalPolicy })`, default OFF (mirror `RecallOptions.rerank`).
- **Q3 →** design is original among clones; cite the research literature in the plan + our own opt-in-DIP seam as the implementation template; do NOT claim mem0/letta parity.
- **Q4 →** GOAL test against real `ankane/pgvector:v0.5.1`: shouldRetrieve=false ⇒ skip (embed-spy 0 + `retrieval_skipped`); weak-top ⇒ corrective relax fires; default unchanged.
- **Q5 →** append 3 event literals to `MEMORY_EVENTS`; wrap both hooks in the reranker fail-soft try/catch pattern.

## Blocked questions

None — all 5 questions answered (Q3's confirmed-absence is the answer). deps + tools DEFER-CORNER'd with rationale.
