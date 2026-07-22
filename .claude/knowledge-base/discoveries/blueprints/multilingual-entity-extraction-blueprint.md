# Blueprint — Multilingual entity extraction (global-grade graph memory)

**Date:** 2026-07-22 · **Trigger:** issue #111 (83% graph noise after the M12 import) · **Research:** 3 parallel deep-research agents — local reference clones (mem0 `9383e9a` 2026-07-20 + graphiti/Zep), web SOTA 2024-2026 (Zep paper arXiv:2501.13956, mem0 paper arXiv:2504.19413, GraphRAG arXiv:2404.16130, GLiNER arXiv:2311.08526, CORE-KG/LINK-KG/KG-denoising), and the full trace of our own pipeline.

## The finding that reframes everything

Our LLM-primary multilingual extraction ALREADY EXISTS: Phase 2 of the write pipeline emits `entities[]+relations[]` in the input's language from the SAME LLM call as fact extraction (`packages/core/src/domain/extraction/prompt.ts:44-73`), and Phase 7 (`entity-linking.ts:137-155`) consumes them as the PRIMARY node source. The noise came from ONE divergence: `infer:false` (the import path) calls `linkEntities` with no LLM entities (`pipeline-helpers.ts:227`), falling back to the English-only `CompromiseEntityExtractor` per item — **mem0 upstream does NOT do this** (`mem0/memory/main.py:836-870` skips entity linking entirely on `infer=False`). Our 2026-06-20 change that enabled entity extraction on the verbatim path diverged from the reference and created #111.

## What the market does (evidence)

- **Zep/graphiti (gold standard):** 100% LLM extraction (gpt-4o-mini), structured output, closed typed-entity enum with integer IDs, NEVER-extract exclusion lists, "when in doubt do NOT extract", Wikipedia-article specificity test. Dedup cascade: exact normalized match → MinHash/LSH Jaccard ≥0.9 (entropy-gated) → LLM only for the residue. Edges REJECTED unless both endpoints are in the extracted-entity list. Bulk: multiple episodes batched per call with per-episode indices.
- **mem0 v2 (pivot):** RETREATED from explicit LLM triples to cheap syntactic entity signals (spaCy/compromise — the ancestor of our bug) used only for retrieval ranking; `infer:false` skips entities entirely. Their entity layer is English-only hardcoded — an anti-pattern we inherited via the TS port.
- **Nobody** ships a language-detection gate on an LLM extraction path — the LLM IS the multilingual gate. Local NLP (GLiNER-multi via ONNX) is viable as an OPTIONAL nodes-only fallback, never the primary (~300-500MB model breaks our 200MB image target; uint8 quantization degrades badly).
- **Cost:** entity+relation extraction ≈ doubles write tokens (mem0: 7K→14K/conversation) ≈ $0.0002-0.0005/write on 4o-mini-class. Batch API −50% for offline tiers. Batches stay small (5-8 short memories) — GraphRAG documents recall collapse on large chunks.

## ADRs

### D1 — `infer:false` stops running the heuristic extractor (mem0 parity)
The verbatim path gets NO entity extraction inline. Rejected alternative: keep the hardened compromise on that path — even hardened, an EN-only heuristic over global corpora produces structural noise (83% measured), and the reference explicitly avoids it.

### D2 — The graph for verbatim/imported memories comes from an async LLM batch backfill
A batch job (graphiti bulk pattern: 5-8 memories per call, per-item indices, strict JSON schema) reuses the EXISTING Phase-2 prompt's `entities+relations` block to populate `entities`/`memory_entities`/`entity_edges` for memories lacking links — multilingual by construction, out of the hot path, Batch-API-eligible (−50%), idempotent via the existing `ON CONFLICT` upserts (`pg-memory-entity-store.ts:27`). Runs post-import and/or via reflect. Rejected alternatives: (a) 1 LLM call inline per imported item (435 sequential calls, latency already bit us in #109); (b) GLiNER-multi as primary (nodes-only — no edges, no summaries — and Docker-size prohibitive).

### D3 — Prompt hardening, graphiti-grade (the antidote to the 83%)
Closed entity-type enum (8-12 types incl. `Technology/Tool/Project` so technical corpora have a legal bucket) with integer IDs + NEVER-extract rules (dates, pronouns, abstract concepts, generic nouns, relation-words, **code identifiers/paths/versions/hashes**) + "when in doubt, do NOT extract". Out-of-enum type → discarded at parse with an OTel discard event (Princípio 3).

### D4 — Deterministic pre/post filters around any LLM extraction
Pre: strip fenced code blocks + inline code before the LLM sees text. Post: reject camelCase/snake_case/dotted-path/hex-sha shapes, length 2-80, symbol-density cap. Cheap, testable, language-independent.

### D5 — Entity resolution hardening (beat the references)
Keep `(scope, normalized_key)` UNIQUE + add **Unicode accent folding** to normalization (graphiti's documented gap: "São Paulo" ≠ "Sao Paulo" until an LLM saves it). Ambiguous-band LLM adjudication deferred to reflect batch (never inline). Add a mechanical per-write entity cap (neither reference has one — adversarial density guard).

### D6 — CompromiseEntityExtractor: demoted to hardened EN-only fallback (SHIPPED)
Already implemented + green (47/47): redaction-marker strip, QUOTED ≤6 words, `eld` language gate — non-English text skips the `nouns()` paths and drops lone sentence-initial capitals BY POSITION (no per-language vocabulary, global by construction). Used only when the LLM emitted no entities on an `infer:true` write.

### D7 — GLiNER-multi = optional local fallback, backlog only
`onnx-community/gliner_multi-v2.1` fp16 behind the `EntityExtractor` DIP for air-gapped/local mode (same niche as LocalTransformerEmbedder). Not bundled (image size), not primary (nodes-only). Backlog item, not in this cycle.

### D8 — Entity GC folds into the same initiative (issue #110)
Zero-link entities are collected transactionally on hard-forget + an idempotent sweep (`NOT EXISTS` refcount), with OTel counts. Single-mention degree-0 aging via soft-invalidate aligns with the accountable-forgetting differentiator.

## Execution plan

- **Phase A (unblocks the authorized wipe + clean re-import, S effort):** D1 (skip heuristic extraction on `infer:false` — RED test first) + D6 (shipped). Wipe the authorized dev memory base; re-import → clean memories, graph populated only by organic `infer:true` writes until Phase B ships.
- **Phase B (new roadmap milestone — full cycle /to-plan → /implement → /review):** D2 batch backfill + D3 prompt hardening + D4 filters + D5 resolution + D8 GC. This is the feature that puts the ENTIRE memory base (imported + verbatim + derived) on the graph, multilingual, at controlled cost.

## Sources
Zep arXiv:2501.13956 · mem0 arXiv:2504.19413 · GraphRAG arXiv:2404.16130 · GLiNER arXiv:2311.08526 / GLiNER2 arXiv:2507.18546 · CORE-KG arXiv:2506.21607 · KG-denoising arXiv:2510.14271 · graphiti `prompts/extract_nodes.py` + `dedup_helpers.py` (local clone, cited file:line in the research transcripts) · mem0 `memory/main.py` + `utils/entity_extraction.py` (local clone) · GDELT LLM-vs-NER blog · Zep engineering blog.
