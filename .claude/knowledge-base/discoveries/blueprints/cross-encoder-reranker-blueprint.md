# Blueprint: Cross-encoder reranker (Reranker DIP)

> Output of `/discover-execute cross-encoder-reranker`. Source plan: `.claude/knowledge-base/discoveries/plans/cross-encoder-reranker-plan.md`. 7/7 research questions answered against `.claude/knowledge-base/references/{mem0,letta}`. Decides the `Reranker` DIP shape, the default cross-encoder impl (model + backend), the pipeline insertion point, the fallback policy, and the opt-in surface for Roadmap Item 23.

**Slug:** `cross-encoder-reranker`
**Created:** 2026-06-22
**Verdict target:** SHIPPABLE_WITH_CAVEATS

## Context

Roadmap Item 23 (`memory-gaps-roadmap.md`, 1st opportunistic post-M1/M2) needs an optional cross-encoder reranker wired as a post-threshold stage in the recall pipeline to lift precision@k — the precision gap flagged by the TheMemory × Letta cross-validation (3.58/5). The recall pipeline (`packages/core/src/domain/retrieval/pipeline.ts`) already exposes the exact seam (Step 8.5 opt-in MMR diversify) and the DIP/opt-in/subpath-isolation discipline is locked precedent (`RecallCacheStore`, `SkillExecutor`, `LocalTransformerEmbedder`). This discovery investigated mem0's `reranker/` module + letta's hosted reranking to lock the borrowed shape before `/to-plan`.

## Objective

Decide the `Reranker` DIP method shape, the default cross-encoder impl (model + backend), the pipeline insertion point (relative to MMR diversify), the fallback policy, and the opt-in surface — so `/to-plan` produces an implementation plan with zero open architectural questions.

## Executive summary

A cross-encoder reranker is a post-retrieval stage that re-scores the threshold-passing candidates by feeding each `(query, document)` pair through a sequence-classification model, then re-sorts by that relevance score and truncates to top-K. mem0 ships exactly this as a pluggable module (`mem0/reranker/`): a 1-method DIP (`rerank(query, documents, top_k)`) with five impls (cross-encoder via `sentence-transformers`, LLM-judge, Cohere, HuggingFace, ZeroEntropy). TheMemory will mirror the DIP with a SINGLE default impl — a cross-encoder running on `@xenova/transformers` (already a dep; CONFIRMED to support `AutoModelForSequenceClassification` + tokenizer `text_pair`), model `Xenova/ms-marco-MiniLM-L-6-v2` (the Xenova conversion of mem0's default `cross-encoder/ms-marco-MiniLM-L-6-v2`). It plugs into the recall pipeline as a post-threshold stage **mutually exclusive with MMR diversify** (both are reranks of the threshold-passing pool; running both is double-rerank with undefined semantics). Opt-in via `RecallOptions.rerank` + a `LocalMemoryConfig.reranker?` DIP slot, default impl behind a `@usetheo/memory/reranker-local` subpath (bundle-isolation precedent: `@usetheo/memory/cache-pg`). Fallback-to-original-order on model failure is the load-bearing resilience contract (mem0 ships it; we mirror it).

---

## Coverage Corner 1 — Integration Tests

**Q5 — How does mem0 test its reranker?** (`mem0/mem0/tests/rerankers/test_llm_reranker_rerank.py`)

mem0's reranker tests STUB the model and ASSERT the ordering + score-field contract:

- `test_empty_documents` — `rerank("query", [])` returns `[]` (empty-input short-circuit).
- `test_documents_sorted_by_score_descending` — mock scores `[0.3, 0.9, 0.6]` → result order `[0.9, 0.6, 0.3]`, each carrying `rerank_score`.
- `test_top_k_limits_results` — `top_k=2` → exactly 2 results.
- `test_config_top_k_used_when_arg_not_provided` — config `top_k` is the fallback when the arg is omitted.
- `_extract_score` (LLM impl) parametrized: parses `"0.85"`, `"The score is 0.72."`, clamps to `[0,1]`, falls back to `0.5` on no-number.

**Borrowed test pattern for TheMemory:** stub the cross-encoder (inject a fake `Reranker` returning deterministic scores) for UNIT tests of the pipeline-ordering + top_k + empty-input + fallback contract; run ONE INTEGRATION test with the REAL `@xenova` model + real pgvector proving a query whose lexical-but-irrelevant candidate outranks under raw cosine gets DEMOTED after reranking (precision@k lift). The model is stubbable at the DIP seam (Princípio: DIP enables unit isolation).

---

## Coverage Corner 2 — Dependencies

**Q3 — Model + package, and the TS/Node equivalent.**

- mem0 default model: `cross-encoder/ms-marco-MiniLM-L-6-v2` (`mem0/configs/rerankers/sentence_transformer.py` — `model` default), via Python `sentence-transformers` `CrossEncoder` (`mem0/reranker/sentence_transformer_reranker.py`).
- **TheMemory equivalent — NO new dep (Inquebrável Rule 9):** `@xenova/transformers@^2.17.2` is ALREADY a dep (`packages/core/package.json:82`; backs `LocalTransformerEmbedder`). CONFIRMED capabilities at the installed version:
  - `AutoModelForSequenceClassification` exported (`node_modules/.pnpm/@xenova+transformers@2.17.2/.../src/models.js:5914`).
  - Tokenizer `text_pair` encoding (17 occurrences in `tokenizers.js`) — required to encode `(query, doc)` pairs for a cross-encoder.
  - `text-classification` pipeline factory (`pipelines.js:2832`).
- **Model id for @xenova:** `Xenova/ms-marco-MiniLM-L-6-v2` (the Xenova ONNX conversion of the mem0 default — same architecture, same MS-MARCO training).
- **No API key, no network at runtime** once the model is cached (same offline-capable profile as `LocalTransformerEmbedder`). Model weights are fetched on first load (same CDN profile as the embedder; the build-resilience concern is shared, not new).

**deps-audit implication for `/to-plan`:** ZERO new production deps. The plan's `## Dependencies` section declares "reuses `@xenova/transformers@^2.17.2` (already present)" — no version bump, no new CVE surface.

---

## Coverage Corner 3 — Tools

**Q6 — Config knobs + defaults.** (`mem0/configs/rerankers/base.py` + `sentence_transformer.py`)

| Knob | mem0 default | TheMemory decision |
|---|---|---|
| `model` | `cross-encoder/ms-marco-MiniLM-L-6-v2` | `Xenova/ms-marco-MiniLM-L-6-v2` (constructor option, defaulted) |
| `top_k` | `None` (return all) | expose via `RecallOptions.rerank.topK` (falls back to recall topK) |
| `batch_size` | `32` | constructor option, default `32` (bounded @xenova batch) |
| `device` | `None` (auto) | N/A for @xenova (wasm/cpu); omit (KISS) |
| `show_progress_bar` | `False` | omit (server-side, no TTY) |
| `api_key` | `None` | omit from default impl (hosted impls are opt-in, out-of-scope v1) |

**KISS:** expose only `model` + `batchSize` on the constructor + `topK` via RecallOptions. `device`/`show_progress_bar`/`api_key` are NOT exposed (no consumer value server-side).

**Q7 — Pipeline insertion point.** (`packages/core/src/domain/retrieval/pipeline.ts` Steps 8→9)

The pipeline already has the seam: Step 8 = threshold filter; **Step 8.5 = MMR diversify (opt-in `options.diversify`)**; Step 9 = sort + top-K. The reranker is a SIBLING of Step 8.5 — a post-threshold rerank of the same pool.

**Decision (locked): rerank runs AFTER threshold (Step 8), over the threshold-passing pool, and is MUTUALLY EXCLUSIVE with MMR diversify.**

- Both diversify and rerank are reranks of the threshold-passing candidates. Running both = double-rerank (diversify reorders for variety, then cross-encoder reorders for relevance, undoing diversity — or vice-versa) with undefined precedence. mem0 runs reranking as the single post-search reorder; it does not stack a diversity pass on top.
- If a consumer sets BOTH `options.diversify` AND `options.rerank`, the pipeline throws a typed error (`InvalidScope`/dedicated) — fail-loud, no silent precedence (Princípio 3 + Inquebrável Rule 8). The plan's edge-case pass will lock the exact error type.
- Over-fetch pool for rerank: rerank the top `rerankPool` (default `topK * 4`, bounded — same spirit as MMR's `topPool = topK*3`) of the threshold-passing, cosine-sorted candidates, then truncate to `topK`. Reranking only the over-fetch pool (not the full candidate set) bounds cross-encoder cost.

---

## Coverage Corner 4 — Techniques

**Q1 — DIP method signature + return contract.** (`mem0/reranker/base.py`)

```python
def rerank(self, query: str, documents: List[Dict], top_k: int = None) -> List[Dict]
# returns documents (copied) with an added 'rerank_score' field, sorted desc, truncated to top_k
```

Single-method DIP (`BaseReranker.rerank`). Within ADR-0008's method-count cap (1 method ≤ cap). Contract: pure re-scoring + re-ordering + truncation; adds a score field; never mutates input in place (mem0 `doc.copy()`).

**TheMemory `Reranker` DIP (proposed):**
```ts
export interface Reranker {
  /** Re-score (query, doc) pairs, return re-sorted desc, truncated to topK. Never mutates input. */
  rerank(
    query: string,
    candidates: readonly MemoryItemWithScore[],
    topK: number,
  ): Promise<readonly MemoryItemWithScore[]>;
}
```
- Returns `MemoryItemWithScore[]` with `score` overwritten by the rerank relevance (or a dedicated `rerankScore` carried in metadata — the plan's ADR decides; leaning to overwrite `score` so downstream/`recall()` consumers see the reranked relevance as THE score, mirroring mem0's "rerank_score becomes the ranking key").
- `async` (model inference is async in @xenova) — diverges from mem0's sync Python; correct for Node.

**Q2 — Cross-encoder scoring + fallback policy.** (`mem0/reranker/sentence_transformer_reranker.py`)

- Build pairs `[[query, doc_text], ...]`; `model.predict(pairs, batch_size=...)`; `np` → list; `zip(docs, scores)`; `sort(key=score, reverse=True)`; apply `top_k`; attach `rerank_score`.
- **Fallback (load-bearing):** the whole `rerank()` body is wrapped in `try/except`; on ANY failure it returns the ORIGINAL order with `rerank_score=0.0` (truncated to top_k). **TheMemory mirrors this: a model-inference failure MUST degrade to the input order (already cosine-sorted), never throw out of `recall()`.** This is the same fail-soft discipline as the entity/skill pipelines (a non-core enrichment failure never fails the core path).
- @xenova mechanics: `tokenizer(queries, { text_pair: docs, padding: true, truncation: true })` → `model(inputs)` → `logits` → sigmoid → relevance score per pair.

**Q4 — Hosted path (letta Pinecone).** (`letta/letta/helpers/pinecone_utils.py:287-296`)

letta delegates reranking to Pinecone's hosted index: `rerank={"model": "bge-reranker-v2-m3", "top_n": limit, "rank_fields": [...]}`. Confirms (a) the cross-encoder model FAMILY (`bge-reranker`, `ms-marco` — MS-MARCO-trained cross-encoders are the standard), and (b) the "rerank then return top_n" contract — i.e., the DIP's `topK` truncation param is the right shape. letta's path is a HOSTED reranker; it validates that the DIP must accommodate a hosted impl as an opt-in (our DIP does — any `Reranker` impl, incl. a future Cohere/Pinecone one, satisfies the interface).

---

## Cross-cutting comparison

| Dimension | mem0 | letta | TheMemory decision |
|---|---|---|---|
| DIP shape | `BaseReranker.rerank(query, docs, top_k)` 1 method | hosted (no local DIP) | `Reranker.rerank(query, candidates, topK)` 1 method, async |
| Default model | `cross-encoder/ms-marco-MiniLM-L-6-v2` | `bge-reranker-v2-m3` (hosted) | `Xenova/ms-marco-MiniLM-L-6-v2` |
| Backend | `sentence-transformers` (Python) | Pinecone hosted | `@xenova/transformers` (already dep, in-process) |
| Score field | `rerank_score` added | Pinecone match score | overwrite `MemoryItemWithScore.score` (ADR-decided) |
| Fallback | try/except → original order, score 0.0 | (hosted error → upstream) | fail-soft → original cosine order (NEVER throw out of recall) |
| top_k | arg or config | `top_n` | `RecallOptions.rerank.topK` (falls back to recall topK) |
| Pipeline position | single post-search reorder | in-index | post-threshold Step 8.5, mutually exclusive with MMR diversify |
| Opt-in surface | config provider | always-on hosted | `RecallOptions.rerank` + `LocalMemoryConfig.reranker?` + `@usetheo/memory/reranker-local` subpath |

---

## ADRs

### D1 — `Reranker` is a 1-method DIP (`rerank`), within ADR-0008 method-count cap
**Decision:** single async method `rerank(query, candidates, topK)`. **Rationale:** mem0's `BaseReranker` is 1 method; reranking is one cohesive operation (ISP — no consumer needs a fat interface). **Alternatives:** multi-method (score + sort + truncate split) — rejected (over-segmentation, the impl owns the whole reorder). **Consequences:** trivial to stub for unit tests; hosted impls (Cohere/Pinecone) satisfy the same seam.

### D2 — Default impl = cross-encoder on `@xenova/transformers` (no new dep), model `Xenova/ms-marco-MiniLM-L-6-v2`
**Decision:** reuse the already-present `@xenova/transformers@^2.17.2` via `AutoModelForSequenceClassification` + tokenizer `text_pair`. **Rationale:** Inquebrável Rule 9; `LocalTransformerEmbedder` precedent; CONFIRMED capability at the installed version; no API key. **Alternatives:** `onnxruntime-node` direct (heavier, manual tokenization — rejected), hosted Cohere/Pinecone as default (key+network — rejected per the plan's out-of-scope DEFER; remains an opt-in impl), Python sidecar (cross-runtime — rejected). **Consequences:** default ties to @xenova's capability surface; DIP stays backend-agnostic.

### D3 — Rerank is post-threshold (Step 8.5) and MUTUALLY EXCLUSIVE with MMR diversify
**Decision:** rerank the threshold-passing, cosine-sorted over-fetch pool (default `topK*4`) then truncate to topK; setting BOTH `diversify` and `rerank` throws a typed error. **Rationale:** both are reranks of the same pool; stacking them is double-rerank with undefined precedence; mem0 does not stack diversity on rerank. Fail-loud over silent precedence (Princípio 3, Rule 8). **Alternatives:** chain diversify→rerank (rerank undoes diversity), rerank→diversify (diversity undoes relevance lift — the whole point) — both rejected. **Consequences:** consumers pick ONE post-threshold reranker; the error makes the choice explicit.

### D4 — Fail-soft: model-inference failure degrades to original cosine order, NEVER throws out of `recall()`
**Decision:** wrap the rerank inference; on failure return the input order (already cosine-sorted), truncated to topK, and emit an OTel event (`recall_rerank_failed` or reuse an existing IGNORE-event). **Rationale:** mem0's try/except precedent + TheMemory's fail-soft discipline (entity/skill enrichment never fails the core path; Princípio 3 auditability). **Alternatives:** throw (rejected — a reranker outage would take down all recall). **Consequences:** reranking is a best-effort precision enhancer; recall correctness never depends on it.

### D5 — Opt-in surface: `RecallOptions.rerank` + `LocalMemoryConfig.reranker?` + `@usetheo/memory/reranker-local` subpath
**Decision:** mirror the MMR diversify opt-in (`RecallOptions.rerank`) + the RecallCacheStore/embedder subpath-isolation (default impl behind `@usetheo/memory/reranker-local`, dynamic-import so the default barrel does NOT pull the cross-encoder model code; bundle-isolation gate per EC-26 precedent). **Rationale:** consistency with shipped opt-in features; keeps the heavy model path out of the default bundle. **Alternatives:** always-on (rejected — cost + bundle weight), inline in core barrel (rejected — bundle isolation). **Consequences:** a new subpath export + bundle-isolation test, both with locked precedent.

## Recommendations (one per research question)

1. **Q1/DIP:** ship `Reranker { rerank(query, candidates, topK): Promise<MemoryItemWithScore[]> }` (1 method, async) in `packages/core/src/domain/dip/reranker.ts`.
2. **Q2/scoring+fallback:** cross-encoder pair scoring via sigmoid(logits); fail-soft to original cosine order (D4).
3. **Q3/deps:** reuse `@xenova/transformers` (no new dep); model `Xenova/ms-marco-MiniLM-L-6-v2`.
4. **Q4/hosted:** DIP must remain backend-agnostic so a future hosted impl (Cohere/Pinecone) is a drop-in opt-in (no v1 ship).
5. **Q5/tests:** unit-stub the DIP for ordering/top_k/empty/fallback; ONE integration test with real @xenova + real pgvector proving precision@k lift (a lexically-similar-but-irrelevant candidate demoted).
6. **Q6/tools:** expose `model` + `batchSize` (default 32) on the constructor + `topK` via RecallOptions; omit device/progress/api_key.
7. **Q7/pipeline:** insert as post-threshold Step 8.5 sibling, mutually exclusive with MMR diversify (D3), rerank pool `topK*4`.

## Blocked questions
(none — 7/7 answered)
