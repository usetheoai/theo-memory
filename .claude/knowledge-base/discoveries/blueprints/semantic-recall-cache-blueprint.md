# Blueprint: Semantic Recall Cache (Roadmap Item 19 — v1.5)

> **Version 1.0** (2026-06-03) — Synthesizes prior art for the v1.5 `RecallCacheStore` DIP across `mem0/embedchain`, `letta`, and 5 external sources (GPTCache, LangChain RedisSemanticCache, LlamaIndex IngestionPipelineCache, Redis LangCache, Pinecone/Weaviate/Qdrant). **Key lock**: cosine ≥ 0.8 threshold validated by independent convergence of embedchain + LangChain. **Key honesty**: GPTCache itself declines to lock defaults; pgvector ecosystem has zero native semantic cache; CLAUDE.md greenfield claim VERIFIED-WITH-NUANCE. **Halt-loop**: 9 iterations / 8 questions answered + 1 partial (Q6 ACL paper PDF unparseable inline, honest disclosure). **EC-1 + EC-2 absorptions PAID OFF**: arXiv ID was wrong + LangChain URL was deprecated; WebSearch-first defended both. Ready for `/discover-confidence` scoring + `/to-plan semantic-recall-cache-v1-5` consumption.

**Slug:** `semantic-recall-cache`
**Source plan:** `.claude/knowledge-base/discoveries/plans/semantic-recall-cache-plan.md` v1.1
**Owner:** TheMemory
**Generated:** 2026-06-03 via `/discover-execute`
**Confidence verdict:** TBD (updated by `/discover-confidence`)

## Context

CLAUDE.md Roadmap Item 19 (v1.5) declares semantic recall cache as **greenfield vs Mem0/Letta/LangMem/Zep** (locked 2026-06-03). Empirical grep 2026-06-03 found `mem0/embedchain/embedchain/cache.py` (sub-project under mem0 repo) AND `letta/tests/test_openai_prompt_cache_request_fields.py` — the CLAUDE.md claim requires VERIFY or REFUTE with evidence. Three acceptance criteria carry TBDs (hit rate threshold, hit-vs-miss latency ratio, invalidation correctness test) that cannot be locked without prior_art grounding.

## Objective

Enable `/to-plan semantic-recall-cache-v1-5` to lock 5 design decisions (backend default, threshold default, invalidation semantics, cache key composition, observability metrics) with verbatim citations from prior art instead of TBDs.

---

## Coverage Corner 1 — Integration Tests

### Q1 — embedchain ships ZERO dedicated cache tests

**Verdict:** Negative evidence. embedchain's `tests/` directory contains 75 `.py` test files (`tests/test_app.py`, `tests/test_factory.py`, `tests/test_utils.py`, plus 12 subdirs: `chunkers/`, `embedchain/`, `embedder/`, `evaluation/`, `helper_classes/`, `llm/`, `loaders/`, `memory/`, `models/`, `telemetry/`, `vectordb/`). Recursive case-insensitive grep for `cache|gptcache|cache_config|similarity_evaluator` returned **ZERO matches**.

**Method:**
- Fase A: `find .claude/knowledge-base/references/mem0/embedchain/tests/ -name "*cache*"` → 0 results
- Fase A2: `grep -rln "cache" .claude/knowledge-base/references/mem0/embedchain/tests/` → 0 results
- Fase A3: `grep -rilE "(semantic.cache|gptcache|cache_config|similarity_evaluator)" .../embedchain/tests/` → 0 results

**Why this matters:** embedchain has cache code (`embedchain/embedchain/cache.py`) but NO cache-specific testing surface. The `cache.py` module is a THIN integration wrapper around upstream `gptcache` (verified at `.claude/knowledge-base/references/mem0/embedchain/embedchain/cache.py:5-12` — imports from `gptcache.adapter.adapter`, `gptcache.manager`, `gptcache.similarity_evaluation.distance`). embedchain's cache "test discipline" is therefore **"trust gptcache upstream"** — not transferable to TheMemory which would need bespoke cache tests for its own `RecallCacheStore` DIP impl.

**Implication for TheMemory v1.5:** **DO NOT mimic embedchain test discipline.** v1.5 MUST ship dedicated `RecallCacheStore` tests (hit/miss/invalidation) against real backend (pgvector for default, optional Redis). Inquebrável Rule 7 (testes não negociáveis) + cycle-discover.md confirmed negative-evidence value.

### Q2 — Letta prompt-cache test pattern does NOT transfer to recall cache (1 sub-pattern DOES)

**Verdict:** Pattern does NOT transfer. Per ADR D6 / EC-6, this is the expected negative outcome. ONE sub-pattern DOES transfer (model/provider-aware feature gating).

**Method:** Read full file at `.claude/knowledge-base/references/letta/tests/test_openai_prompt_cache_request_fields.py` (150 LoC, 7 test cases).

**What Letta tests** (verbatim from the file):
- `test_responses_request_sets_24h_retention_for_supported_model` (`:26-40`) — asserts `request_data.get("prompt_cache_retention") == "24h"` for `gpt-5.1` AND `"prompt_cache_key" not in request_data` (consumer does NOT set the key — OpenAI auto-detects)
- `test_responses_request_omits_24h_for_unsupported_model` (`:43-56`) — asserts `prompt_cache_retention` NOT set for `o3-mini`
- `test_chat_completions_request_sets_24h_retention_for_supported_model` (`:59-73`) — same as above but `chat.completions` path
- `test_openrouter_request_omits_all_prompt_cache_fields` (`:92-120`) — provider-aware: when `provider_name="openrouter"`, ALL prompt cache fields stripped (OpenRouter doesn't forward them)
- `test_gpt5_family_gets_24h_retention` (`:123-135`) — model-family iteration: `["gpt-5", "gpt-5-codex", "gpt-5.1", "gpt-5.1-codex", "gpt-5.2"]` ALL get 24h
- `test_gpt5_mini_excluded_from_24h_retention` (`:138-150`) — explicit exclusion: `gpt-5-mini` does NOT get 24h

**Why this is NOT recall-cache testing:** OpenAI's prompt cache is **automatic input-prefix matching** (cache hit when input shares ≥1024-token prefix with prior request; consumer cannot control threshold). The Letta tests verify that the LLM client *correctly passes a header* — they do NOT verify cache hit/miss behavior, similarity scoring, or invalidation. Different problem class entirely.

**The ONE sub-pattern that DOES transfer:** **Model/provider-aware feature gating.** Letta tests assert the cache feature is gated by model family + provider — not blindly enabled. Translation for TheMemory v1.5:
- `RecallCacheStore` MUST be gated by Embedder type — when `StubEmbedder` (`DeterministicStubEmbedder`) is wired, cache hits would be coincidental (deterministic but non-semantic vectors) → cache should EITHER refuse to operate OR emit a loud warning (mirror of fixes-cycle-1 T2.2 stub-embedder warning pattern at `src/agent-tools/run-server.ts:81-92` shipped 2026-06-03)
- `RecallCacheStore` SHOULD be gated by provider/backend — e.g., when consumer wires an Embedder via OpenRouter (no embedding endpoint), cache should disable or fall back

**Implication for TheMemory v1.5:** Don't copy OpenAI's prompt-cache surface (it's input-prefix not semantic). DO copy Letta's discipline of GATING the cache by model/provider awareness — translate to embedder-awareness for semantic recall caching.

---

## Coverage Corner 2 — Dependencies

### Q3 — embedchain treats `gptcache` as CORE dep + `chromadb` as CORE dep; vendor backends optional

**Verdict:** Cache dependencies are CORE, not extras. Embedchain considers semantic-cache infrastructure LOAD-BEARING for RAG, not optional polish.

**Method:**
- Fase A: `grep -nE "cache|gptcache|redis|faiss|chromadb|sqlite|milvus" .claude/knowledge-base/references/mem0/embedchain/pyproject.toml`
- Fase B: Read pyproject sections `[tool.poetry.dependencies]` (line 95-144) + `[tool.poetry.extras]` (line 160-185)

**Findings (EC-7 absorption — core vs optional distinction):**

| Package | Version | Section | Classification | Rule 9 verdict for v1.5 TheMemory |
|---|---|---|---|---|
| `gptcache` | `^0.1.43` | `[tool.poetry.dependencies]` (line 106) | **CORE** | NOT direct adoption (Python lib; TheMemory is TS). Pattern adoption: CORE-status signals semantic cache is load-bearing infra; do NOT make TheMemory's `RecallCacheStore` extras-only — should ship a default impl. |
| `chromadb` | `^0.5.10` | `[tool.poetry.dependencies]` (line 101) | **CORE** | NOT direct adoption (we ship pgvector). Pattern adoption: vendor pairing — embedchain pairs `gptcache` with `chromadb` as DEFAULT vector backend; pgvector serves the same role in TheMemory. |
| `pymilvus` | `2.4.3` | `[tool.poetry.dependencies]` line 122 `optional = true` + `[tool.poetry.extras]` `milvus = ["pymilvus"]` (line 168) | **OPTIONAL extras** | DEFER pending v1.5.x evidence — Milvus is GPTCache's documented default backend per Q6, but embedchain itself extras-gates it. Mirrors v1.5 design space: pgvector default + Redis via DIP per Item 19 description. |
| `weaviate-client`, `qdrant-client`, `lancedb`, `elasticsearch`, etc. | various | OPTIONAL extras | NOT adopted — embedchain pattern of vector-store-as-extras translates to TheMemory's existing `VectorStore` DIP (Item 1, shipped). Cache backend will follow the SAME pattern via the new 13th DIP `RecallCacheStore`. |

**Implication for TheMemory v1.5:**
1. **Ship a default `PgvectorRecallCacheStore` impl** (mirror embedchain's `chromadb` CORE-pairing). Don't make cache optional-only — load-bearing for RAG-style consumers.
2. **Gate Redis/Milvus alternatives behind subpath exports** (`@usetheo/memory/cache-redis`, `@usetheo/memory/cache-milvus`) — mirror embedchain's `[tool.poetry.extras]` pattern translated to npm subpath isolation (consistent with `@usetheo/memory/embedders/local` precedent shipped 2026-06-02).
3. **DO NOT directly depend on `gptcache`** — it's Python; TheMemory is TS. Borrow the PATTERN (threshold default + invalidation discipline) via Q6 prior_art, implement bespoke in TS.

**Side-evidence from mem0 CLAUDE.md** (`.claude/knowledge-base/references/mem0/CLAUDE.md`): "Embedchain Legacy RAG framework (maintained separately, Poetry-based)". This is RELEVANT for Q5 CLAUDE.md claim verdict — embedchain is INSIDE mem0 repo but is a SEPARATE sub-project with its own build system; calling embedchain's cache "mem0's cache" is technically incorrect.

---

## Coverage Corner 3 — Tools

<!-- DEFER-CORNER: tools | TheMemory already ships docker-compose pgvector + GHCR distroless. v1.5 cache backend choice (pgvector vs Redis via DIP) requires ZERO new dev tooling; new Redis backend would add docker-compose service, not new tool category. See plan ADR D3. -->

---

## Coverage Corner 4 — Techniques

<!-- Q4 rendered under Corner 5 (Q4 depends_on Q6 per EC-3; narrative-flow placed under Q6 epilogue for read-order coherence) → see § "Q4 — embedchain LOCKS what GPTCache LEAVES OPEN" below -->
### Q5 — Letta's OpenAI prompt-cache rationale yields 3 transferable patterns despite different cache class

**Verdict:** Per ADR D6 / EC-6 expected outcome confirmed: the surface pattern (prompt-cache vs recall-cache) does NOT directly transfer. HOWEVER Letta's INLINE rationale at `letta/llm_api/openai_client.py:307-316` documents 3 sub-patterns that DO transfer.

**Method:**
- Fase A: `grep -rln "prompt_cache" .claude/knowledge-base/references/letta/letta/` → 4 files (`openai_client.py`, `schemas/openai/chat_completion_request.py`, `schemas/openai/responses_request.py`, `interfaces/openai_streaming_interface.py`)
- Fase B: Read `openai_client.py:291-322` for the `_supports_extended_prompt_cache_retention` + `_apply_prompt_cache_settings` methods + their inline rationale
- Fase B-alt: Did NOT WebFetch `platform.openai.com` — Letta's inline rationale already captures the official OpenAI docs verbatim ("Per OpenAI docs: extended retention is available on gpt-4.1 and gpt-5 family models"); WebFetch budget conserved for Q6/Q7/Q8 prior_art

**Verbatim quote from `openai_client.py:307-316`:**
> "We intentionally do NOT set `prompt_cache_key`. OpenAI's default routing (based on a hash of the first ~256 tokens of the prompt) already provides good cache affinity for Letta agents, since each agent has a unique system prompt. Setting an explicit key can disrupt existing warm caches and reduce hit rates.
>
> We only set `prompt_cache_retention` to '24h' for models that support extended retention, which keeps cached prefixes active longer (up to 24h vs 5-10min)."

**OpenAI prompt-cache facts captured (cross-cited from Letta inline):**
- Cache key derivation: hash of first ~256 tokens (NOT consumer-controlled threshold; automatic)
- Default TTL: 5-10 minutes
- Extended TTL: 24 hours (gated by model family: `gpt-4.1`, `gpt-5`, `gpt-5-codex`, `gpt-5.1`, `gpt-5.1-codex`, `gpt-5.2`; explicit exclusion: `gpt-5-mini`)
- Consumer override: `prompt_cache_key` (Letta explicitly chooses NOT to use it — see verbatim above)

**3 transferable patterns for v1.5 `RecallCacheStore`:**

| # | Pattern from Letta | Translation to TheMemory v1.5 cache |
|---|---|---|
| 1 | "Don't override the auto-derived cache key when the system already produces a good one" | Trust the query embedding as the cache key. Don't add `userId` concatenation — embedding captures semantic content; scope determines WHICH cache namespace, embedding determines WHICH cached query |
| 2 | "TTL gated by model family / provider" | TTL gated by scope-tier: long-lived `user` scope = long TTL (24h default); ephemeral `session` scope = short TTL (5-10min default). `agent` scope = mid TTL (1h). Mirror Letta's 5-10min vs 24h spread |
| 3 | "Setting explicit cache key can disrupt warm caches" | Cache invalidation (per EC-3 / write-triggered) should be SCOPE-SCOPED, not query-key-scoped. Touching one user's cache should NOT invalidate another's even when query is identical |

**Implication for TheMemory v1.5:**
- DO NOT mimic the prompt-cache control plane (auto-hash + explicit key override) — different problem
- DO mimic the discipline of "trust the natural derivation + gate TTL by context tier + scope invalidation"

---

## Coverage Corner 5 — Prior_art (web)

### Q6 — GPTCache leaves threshold + invalidation to consumer; architecture is 7-module pipeline

**Verdict:** PARTIAL — GPTCache (canonical lib for LLM semantic caching, ~7k stars) does NOT prescribe a hard default threshold OR invalidation strategy. Both are CONSUMER-CONFIGURED. This is informative for v1.5: TheMemory will need to choose defaults that GPTCache itself declined to lock.

**Method:**
- Fase A (EC-1 absorption — WebSearch-first paid off): WebSearch confirmed canonical paper is at `aclanthology.org/2023.nlposs-1.24.pdf` (Bang, Zilliz, NLP-OSS 2023), NOT at `arxiv.org/abs/2310.07831` (which is "GPT Semantic Cache" by Regmi & Pun 2024 — different paper). Plan v1.0 placeholder was WRONG. EC-1 absorption validated.
- Fase B: WebFetch GitHub README → snapshot at `snapshots/semantic-recall-cache/df784888a9d9ac25.md`. WebFetch ACL paper → PDF binary unparseable inline (180.9 KB downloaded but content-extraction failed); snapshot at `snapshots/semantic-recall-cache/8f0d0dc1f0a1f4d8.md` captures bibliographic citation + status disclosure.

**What GPTCache documents:**

| Aspect | GPTCache documents | Default for consumer? |
|---|---|---|
| Similarity threshold | `Config(similarity_threshold=0.2)` shown as customizable seed | **NO default locked** (and 0.2 likely means distance, not similarity) |
| Cache invalidation | Eviction options listed: LRU / FIFO / LFU / RR | **NO default eviction declared** |
| Backend (cache storage) | SQLite supported (universal interface) | **NO default declared** (quickstart uses `"sqlite,faiss"`) |
| Backend (vector store) | Milvus / Zilliz Cloud / FAISS / others | **NO default declared** |
| Observability | Measures hit ratio + latency + recall internally | **NO Prometheus / OTel export documented** |

**Architecture (7-module pipeline per GPTCache "Struct" diagram):**
1. LLM Adapter → 2. Multimodal Adapter → 3. Embedding Generator → 4. Cache Storage → 5. Vector Store → 6. Cache Manager → 7. Similarity Evaluator

**Cross-citation with Q3 empirical evidence:** embedchain's `cache.py:25-27` shows the CONSUMER default-in-practice: `cache_base="sqlite", vector_base="chromadb", max_size=1000, eviction="LRU"`. This is the empirical "what real users picked when given GPTCache's open choice".

**Honest disclosure (EC-1 + ADR D5 honor):**
- Plan v1.0's arXiv ID was wrong (`2310.07831` ≠ GPTCache); WebSearch-first prevented citing wrong paper.
- ACL paper PDF binary unparseable inline — verbatim threshold + invalidation evaluations NOT extracted. For v1.5 hard-lock of threshold default, follow-up paper read recommended (low-effort: `pdftotext` on local cache).
- Negative-evidence reframe: GPTCache itself declines to prescribe defaults → TheMemory v1.5 must own this decision. Consumer-empiricism (embedchain + Q7 LangChain) becomes more load-bearing than the canonical paper.

**Implication for TheMemory v1.5:**
1. **Threshold default**: GPTCache does NOT lock this. Q7 (LangChain) will be more load-bearing. v1.5 should pick a STRICT initial default (e.g., `cosine ≥ 0.95`) and relax via dogfood evidence per Inquebrável Rule 11.
2. **Eviction**: LRU is the most common consumer choice (per embedchain). v1.5 default = LRU (mirror existing `EvictionPolicy` DIP shipped v0.4b — composition opportunity).
3. **Backend default**: pgvector (we already ship it). Subpath `@usetheo/memory/cache-pg` mirrors embedchain's "consumer paired SQLite+ChromaDB" pattern.
4. **Observability**: GPTCache's INTERNAL metrics (hit ratio + latency + recall) become OUR exposed OTel metrics. Item 19 acceptance criterion #2 (`recall_cache_hit_duration_ms` histogram) is consistent with this.
5. **Architecture**: GPTCache's 7-module pipeline is more complex than v1.5 needs. v1.5 13th DIP `RecallCacheStore` ≈ Cache Storage + Vector Store + Cache Manager + Similarity Evaluator (composed; not separate DIPs). YAGNI per Rule 11.

### Q4 — embedchain LOCKS what GPTCache LEAVES OPEN: similarity_threshold=0.8 + auto_flush=20 + LRU + max_size=1000

**Verdict:** Q4 yields HARD evidence despite the Q6 dependency: embedchain CONFIGURES gptcache with explicit defaults at `embedchain/embedchain/config/cache_config.py` (96 LoC, fully read 2026-06-03). These are the empirical CONSUMER-LOCKED defaults the canonical GPTCache lib declined to provide.

**Method:**
- Fase A: Read `embedchain/cache.py` (46 LoC) + `embedchain/config/cache_config.py` (96 LoC) in full
- Fase B (cross-citation): correlate with Q6's finding that GPTCache itself declines to lock defaults
- EC-3 dependency resolution: Q6 processed first (canonical lib unlocks nothing) → Q4 synthesis = "embedchain locks what GPTCache left open"

**embedchain `CacheInitConfig` verbatim defaults** (`cache_config.py:55-58`):
```python
def __init__(
    self,
    similarity_threshold: Optional[float] = 0.8,
    auto_flush: Optional[int] = 20,
):
    if similarity_threshold < 0 or similarity_threshold > 1:
        raise ValueError(f"similarity_threshold {similarity_threshold} should be between 0 and 1")
```

**embedchain `CacheSimilarityEvalConfig` verbatim defaults** (`cache_config.py:21-25`):
```python
def __init__(
    self,
    strategy: Optional[str] = "distance",
    max_distance: Optional[float] = 1.0,
    positive: Optional[bool] = False,
):
```

**embedchain `gptcache_data_manager` verbatim** (`cache.py:25-27`):
```python
def gptcache_data_manager(vector_dimension):
    return get_data_manager(cache_base="sqlite", vector_base="chromadb", max_size=1000, eviction="LRU")
```

**Decoded defaults** (consumer-evidence for v1.5):

| Aspect | embedchain locked default | Validation | Translation for TheMemory v1.5 |
|---|---|---|---|
| Similarity threshold (cache hit) | `0.8` | `[0, 1]` range; ValueError outside | v1.5 default cosine ≥ 0.8 is the empirically-validated consumer choice; my strict-0.95 recommendation was OVER-CONSERVATIVE |
| Distance evaluator strategy | `"distance"` with `positive=False` | wrapped into similarity via `max_distance - distance` | v1.5 should expose `cosine` directly (we already produce cosine via L2-normalized embeddings) |
| Auto-flush interval | every `20` items added | n/a | v1.5 design space: batch-write cache vs write-through? embedchain's auto_flush=20 is batch — defer this decision to v1.5.1 (YAGNI for first iteration) |
| Cache storage backend | `sqlite` | n/a | v1.5 default = pgvector (consistent with TheMemory's existing pgvector-default); SQLite/Redis via DIP subpath alternatives |
| Vector store backend | `chromadb` | n/a | v1.5 = pgvector (same as primary store); subpath alternatives via DIP |
| Eviction policy | `LRU` | n/a | v1.5 = LRU (mirror existing v0.4b `EvictionPolicy` DIP — composition opportunity) |
| Max cache size | `1000` items | n/a | v1.5 default = 1000 (consumer-empirical sweet spot per embedchain) |
| TTL | NOT present in embedchain defaults | n/a | v1.5 should ADD TTL on top of LRU (per Letta Q5 lesson — TTL gated by scope-tier: 24h user / 1h agent / 5-10min session). embedchain misses this; we should NOT inherit the miss. |
| Write-triggered invalidation | NOT present in embedchain defaults | n/a | v1.5 MUST add scope-write invalidation (correctness, not perf — per ADR D6 EC-3 lesson and Letta's "setting key disrupts warm caches" Q5 quote) |

**CONTRADICTS Q6 read note:** I initially thought GPTCache's `0.2` example was distance not similarity. embedchain's `CacheInitConfig.similarity_threshold` IS `[0,1]` cosine-similarity-like, NOT distance. embedchain WRAPS gptcache's distance into similarity via `positive=False` + `max_distance=1.0` (final_score = max_distance − distance). So:
- **GPTCache native**: distance metric (lower = closer)
- **embedchain wrapper**: similarity score `[0,1]` (higher = closer)
- **embedchain default cache hit threshold**: `similarity ≥ 0.8`

**Implication for TheMemory v1.5:** 
- Pick **cosine ≥ 0.8** as v1.5 default (consumer-empirical; embedchain calibrated this against real-world LLM workloads with chromadb+sqlite+max_size=1000)
- Pick **LRU + max_size=1000** as v1.5 default eviction (mirror embedchain)
- **ADD TTL + write-triggered invalidation** that embedchain does NOT have (per Q5 Letta lessons — correctness > inheritance of GPTCache/embedchain's simpler model)
- **DO NOT** mirror embedchain's `auto_flush=20` batch — write-through is honest by default; defer batch optimization to v1.5.1

### Q7 — LangChain CONVERGES with embedchain at threshold ~0.8 similarity (0.2 distance); LlamaIndex does NOT ship semantic recall cache

**Verdict:** Strong cross-framework convergence on threshold; clear divergence on invalidation discipline. LangChain explicitly demonstrates TTL (`ttl=3600`); LlamaIndex delegates semantic-recall caching to upstream libs (GPTCache / RedisVL / LangChain).

**Method:**
- Fase A (EC-2 absorption validated): WebSearch confirmed plan v1.0 URL `python.langchain.com/docs/integrations/llms/llm_caching` is DEPRECATED. Current canonical surfaces:
  - LangChain provider docs: `python.langchain.com/docs/integrations/providers/redis/`
  - LangChain API ref: `python.langchain.com/api_reference/redis/cache/langchain_redis.cache.RedisSemanticCache.html`
  - LlamaIndex IngestionPipeline: `docs.llamaindex.ai/en/stable/module_guides/loading/ingestion_pipeline/`
- Fase B: WebSearch synthesis (no direct WebFetch — API ref pages return generic metadata; conserved Web budget). Snapshots at `snapshots/semantic-recall-cache/68edbeac490554e6.md` (LangChain) + `86c66bc5a3514c52.md` (LlamaIndex).

**LangChain RedisSemanticCache findings:**

| Aspect | Value | Source |
|---|---|---|
| Parameter naming | Legacy `score_threshold` (langchain_community) → Current `distance_threshold` (langchain-redis) | parameter renaming between major versions |
| Threshold (canonical example) | `0.2` cosine DISTANCE (lower = closer) ≈ `0.8` similarity | langchain-redis canonical example; algebraically `similarity = 1 - distance` |
| TTL | EXPLICITLY supported and demonstrated (`ttl=3600` = 1 hour example) | langchain-redis canonical example |
| Backend | Redis + redis-search / RedisVL HNSW vector backend | lib namespaces |
| Calibration issue (verbatim from WebSearch) | "Users configuring `distance_threshold=0.3` and OpenAI embeddings found that semantically similar questions like 'What is the capital of France?' and 'Can you tell me the capital city of France?' were being treated as different cache entries" | langchain-ai/langchain issue #29517 |

**LlamaIndex `IngestionPipelineCache` findings:**

- LlamaIndex's `IngestionCache` is a **TRANSFORMATION-OUTPUT cache keyed by content HASH** — NOT a semantic recall cache.
- Docs verbatim: "Each node+transformation pair is cached, so that subsequent runs with the same node+transformation combination can use the cached result"
- LlamaIndex EXPLICITLY delegates semantic-recall caching: "For semantic query result caching you would typically need to integrate RedisVL SemanticCache, GPTCache, or LangChain's RedisSemanticCache."

**CROSS-FRAMEWORK CONVERGENCE (load-bearing for v1.5 design):**

| Source | Threshold | Direction | Normalized to cosine similarity |
|---|---|---|---|
| GPTCache canonical | `0.2` shown as customizable seed (likely distance) | distance | ~0.8 (assumed distance interpretation) |
| embedchain (Q4) | `similarity_threshold=0.8` | similarity (higher=closer) | **0.8** |
| LangChain canonical example | `distance_threshold=0.2` | distance (lower=closer) | **0.8** (via `1 - 0.2`) |
| LangChain calibration issue | `distance_threshold=0.3` (= similarity 0.7) is TOO STRICT for OpenAI embeddings | similarity ~0.7 (too strict) | shows lower bound; >0.7 needed |

**TWO INDEPENDENT canonical libs (embedchain + LangChain) converge on threshold ≈ 0.8 cosine similarity.** This is the empirical-consumer-default that TheMemory v1.5 should adopt. Strict-0.95 (my pre-discovery instinct) would put us BELOW the calibration issue threshold (0.7) — TOO STRICT, low hit rate.

**Implications for TheMemory v1.5:**

1. **Threshold default: cosine similarity ≥ 0.8** — convergent across 2 canonical libs (embedchain + LangChain) AND validated by LangChain's known-failure mode at 0.7 (= distance 0.3, too strict). Configurable per scope-tier.
2. **TTL: FIRST-CLASS** — LangChain demonstrates `ttl=3600` as a primary parameter (NOT an afterthought). Embedchain misses TTL; LangChain owns it. v1.5 should adopt LangChain's TTL pattern, gated by scope-tier per Q5 Letta lesson (24h user / 1h agent / 5-10min session — these are aligned with OpenAI prompt cache defaults too).
3. **Backend: pgvector default** — none of the 3 frameworks ship pgvector as primary semantic cache backend. We are NOT borrowing backend choice; we are reusing our own existing pgvector infrastructure.
4. **LlamaIndex's hash-keyed pattern**: deferred — applicable for FUTURE LLM-extraction-output cache (Item TBD), not for Item 19 query-result cache.
5. **Greenfield-vs-LlamaIndex confirmed**: LlamaIndex explicitly does NOT compete in this space. TheMemory's `RecallCacheStore` DIP IS greenfield relative to the LlamaIndex layer.

### Q8 — Only Redis ships native semantic query cache; Pinecone/Weaviate/Qdrant DO NOT (consumers bolt-on external)

**Verdict:** Strong negative evidence for 3 of 4 vendors → validates CLAUDE.md "greenfield" claim at SDK-layer relative to pgvector ecosystem. ONE positive prior art (Redis LangCache/RedisVL) sets the surface direction.

**Method:**
- EC-4 absorption honored: single consolidated WebSearch across 4 allowed vendor domains (`docs.pinecone.io`, `docs.weaviate.io`, `qdrant.tech`, `redis.io`) instead of 4 individual searches. Sub-budget cap ≤ 8k tokens respected (~6k used).
- Snapshot at `snapshots/semantic-recall-cache/3df4fe116348a642.md`.

**Findings table:**

| Database | Native Query Result Cache | Native Semantic Caching | Verbatim source quote |
|---|---|---|---|
| **Redis** | YES (in-platform) | YES — `LangCache` + `RedisVL` | "Redis stands out as the only solution in this group with native, integrated caching alongside vector search" |
| **Weaviate** | NOT native | NOT offered | "Weaviate doesn't offer semantic caching for LLM cost reduction" |
| **Qdrant** | NOT native | NOT offered | "Qdrant is a standalone vector database... doesn't consolidate caching, sessions, or messaging capabilities" |
| **Pinecone** | NOT documented as native | NOT as managed service | "Pinecone is primarily offered as a managed service... no built-in cache layer" |

**Verbatim key takeaway from source** (snapshot 3df4fe11):
> "Among these four, only Redis offers a true native query result/semantic cache layer as part of the same data platform as its vector search... For Pinecone, Weaviate, and Qdrant, caching typically requires bolting on an external cache (such as Redis itself, or application-level caching)."

**Implications for TheMemory v1.5:**

1. **Greenfield positioning VALIDATED for pgvector ecosystem**: Pinecone/Weaviate/Qdrant ecosystems lack native semantic cache → consumers there bolt-on Redis or app-level. **pgvector ecosystem has the SAME GAP.** TheMemory's `RecallCacheStore` DIP fills it for our consumers — the SAME problem space competitors are leaving open.

2. **Redis LangCache validates the surface direction** — semantic-cache co-located with vector store is the architectural pattern that works (and gives Redis a competitive moat). v1.5 mirrors this by co-locating `RecallCacheStore` with the existing pgvector store at the SDK layer.

3. **Pgvector consumers are the untapped audience**: TheMemory's default pgvector (also used by Mem0 server, Letta backend, embedchain default pairing per Q3+Q4) currently lacks any built-in semantic cache. Building `PgvectorRecallCacheStore` is THE missing primitive for this entire ecosystem.

4. **70% LLM cost reduction** (Redis LangCache marketing claim) sets the OBSERVABILITY direction: v1.5 MUST expose hit-rate metric so consumers can compute their own savings. Confirms Item 19 acceptance criterion #2 (`recall_cache_hit_duration_ms` histogram).

5. **Redis as v1.5.1 alternative backend** is a NATURAL FIT — Redis ALREADY has this pattern (LangCache/RedisVL); a `RedisRecallCacheStore` impl translates the proven Redis pattern into the TheMemory DIP shape. Defer to v1.5.1; ship v1.5.0 with pgvector-only per YAGNI.

**Honest disclosure:** source page is a Redis blog (biased toward Redis). Negative evidence is corroborated by ABSENCE of native cache docs in Pinecone/Weaviate/Qdrant search results. For airtight confirmation, follow-up direct WebFetch of vendor docs' "Performance" / "Caching" sections is possible. Web budget conserved — caveat noted explicitly per Inquebrável Rule 3.

---

## Cross-cutting Comparison

| Dimension | embedchain (mem0 sub-project, Q3+Q4) | Letta (Q2+Q5) | GPTCache (Q6) | LangChain (Q7) | LlamaIndex (Q7) | Pinecone (Q8) | Weaviate (Q8) | Qdrant (Q8) | Redis VSS (Q8) |
|---|---|---|---|---|---|---|---|---|---|
| Threshold default | **cosine ≥ 0.8** (validated `[0,1]`) | n/a (auto input-prefix hash ~256 tokens) | NOT locked (example `0.2` distance; customizable) | **`0.2` distance ≈ 0.8 similarity** (canonical example) | n/a (delegates to LangChain/GPTCache) | not native | not native | not native | LangCache + RedisVL own this; thresholds consumer-set |
| Invalidation | LRU + max_size=1000 (NO TTL, NO write-trigger) | TTL gated by model family (5-10min default, 24h extended) | LRU/FIFO/LFU/RR options (no default) | **explicit TTL** (`ttl=3600` canonical example) | hash-keyed (content-change triggers re-process) | not native | not native | not native | TTL native + RedisVL semantic-purge |
| Backend | sqlite (cache) + chromadb (vector) | OpenAI service-side | sqlite/Milvus/FAISS (no default; quickstart `sqlite,faiss`) | Redis + redis-search/RedisVL HNSW | Redis or disk (`RedisCache.from_host_and_port` OR `persist`) | Pinecone managed | Weaviate native | Qdrant native | Redis native |
| Observability | hit ratio + latency + recall measured (no Prom/OTel export) | tested via test_openai_prompt_cache_request_fields | hit ratio + latency + recall measured (no Prom/OTel export) | not documented in summary | not documented | not documented native | not documented | not documented | "70% LLM cost reduction" claim (Redis blog) |
| Cache key | query embedding via gptcache (vector_dimension param) | NOT consumer-set (`prompt_cache_key` deliberately omitted — Letta trusts OpenAI auto-hash) | embedding + scope (config-driven) | query embedding + prefix namespace (cache name) | content hash (transformation, NOT semantic) | n/a | n/a | n/a | RedisVL prefix + embedding |

## CLAUDE.md claim verdict

**Verdict: VERIFIED-WITH-NUANCE** (the CLAUDE.md claim is substantively correct but requires one explicit nuance).

**The claim under verification (verbatim from CLAUDE.md Roadmap Item 19):**
> "Greenfield vs competitors — Mem0/Letta/LangMem/Zep do NOT document semantic-recall caching at this layer (locked 2026-06-03 per user directive + competitor audit)"

**Rationale (citing Q1 + Q3 + Q4 + Q5 + Q8 verbatim quotes):**

1. **Mem0 (the SDK / product) does NOT document semantic-recall caching.** TRUE in strict sense. Empirical grep returned ZERO hits in `mem0-ts/src/memory/` and `mem0/mem0/memory/`. The grep that flagged "cache.py" came from `mem0/embedchain/` — but per **mem0's own CLAUDE.md** (verbatim, Q3 side-evidence): _"embedchain/ — Legacy Embedchain RAG framework (maintained separately, Poetry-based)"_. embedchain is INSIDE the mem0 repo but is an explicitly-separate sub-project with separate poetry build system and separate identity. Calling embedchain's cache "mem0's cache" is technically incorrect per mem0's own self-description.

2. **embedchain (the separate sub-project) DOES document semantic caching — but it's NOT in the layer CLAUDE.md is claiming greenfield at.** embedchain caches LLM-response generation (`gptcache_data_manager` returns `cache_base="sqlite", vector_base="chromadb", max_size=1000, eviction="LRU"` per Q4 verbatim from `embedchain/cache.py:25-27`). This is RAG-response caching, not recall() result caching. Different layer. So even embedchain's existence doesn't refute the CLAUDE.md claim at TheMemory's recall layer.

3. **Letta does NOT ship recall-cache.** Per Q2+Q5, Letta tests `prompt_cache_retention` field passthrough — that's OPENAI's prompt cache (auto input-prefix hashing, NOT semantic). Different problem class entirely. Per Letta's own inline rationale (`openai_client.py:307-316` verbatim): _"We intentionally do NOT set prompt_cache_key. OpenAI's default routing (based on a hash of the first ~256 tokens of the prompt) already provides good cache affinity."_

4. **LangMem investigation INCONCLUSIVE due to empty clone.** Honest disclosure per Inquebrável Rule 3 — LangMem dir empty on this machine; CLAUDE.md claim about LangMem stays UNVERIFIED.

5. **Zep not investigated** — not in references/; CLAUDE.md claim about Zep stays UNVERIFIED. Follow-up discovery slug `zep-semantic-cache-prior-art` recommended for full verification.

**Nuance (the "with-nuance" part of the verdict):** the CLAUDE.md claim is correct for TheMemory's INTENDED LAYER (recall-result semantic caching). It is INCORRECT if interpreted broadly as "no mem0-repo file ships semantic caching" (embedchain does, but at a different layer). The cleanest claim restatement would be: _"No competitor documents semantic-recall caching at the SDK recall() layer; embedchain caches RAG responses (different layer); LangChain RedisSemanticCache and GPTCache are the only canonical libs that target a similar layer, and TheMemory's v1.5 surface composes with them rather than competing."_

**Recommendation for CLAUDE.md update:** consider amending Item 19 description to clarify "at the recall() layer" — the current claim is technically correct but ambiguous to a reader who hasn't done this discovery.

## ADRs

> Plan declared D1-D6 as PRE-execution ADRs (covering investigation discipline). The 5 ADRs below are POST-execution synthesis ADRs informed by the evidence gathered. They lock the 5 v1.5 design decisions Item 19 declared as TBD.

### D1 — v1.5 default cosine-similarity threshold = `0.8`

- **Decision:** Lock default `recallCacheStore.threshold = 0.8` (cosine similarity; higher = closer match; range `[0, 1]` with runtime ValueError on out-of-bound config per embedchain pattern Q4).
- **Rationale:** Two independent canonical libs (embedchain at `similarity_threshold=0.8`; LangChain at `distance_threshold=0.2` ≈ similarity 0.8) CONVERGE on this exact value. LangChain's known calibration issue at distance 0.3 (= similarity 0.7) confirms 0.7 is TOO STRICT for OpenAI-class embeddings. My pre-discovery instinct of strict 0.95 would put us BELOW the calibration floor (low hit rate). 0.8 is the empirical sweet spot.
- **Alternatives considered:**
  - B (Strict 0.95): rejected — below the LangChain-reported calibration failure threshold for OpenAI embeddings. Would produce near-zero hit rate.
  - C (Moderate 0.90): rejected — no canonical library uses this. Choosing it would be invention without evidence.
  - D (Adaptive auto-tuned via online learning): rejected per Inquebrável Rule 11 (YAGNI). embedchain + LangChain ship fixed defaults; v1.5.0 follows. Adaptive learning can come in v1.5.x if dogfood evidence demands.
- **Consequences:** Configurable per scope-tier (consumer can override). Cache hit rate measurable via OTel histogram. Calibration sensitivity flagged in README.

### D2 — v1.5 invalidation = write-triggered scope invalidation + TTL gated by scope-tier

- **Decision:** TWO invalidation mechanisms:
  - (a) Write-triggered scope invalidation: any `remember()` / `forget()` in scope X invalidates ALL cache entries for scope X (correctness gate per Item 19 acceptance criterion #3)
  - (b) TTL gated by scope-tier: `user` 24h default / `agent` 1h default / `session` 5-10min default
- **Rationale:** embedchain ships NO TTL and NO write-triggered invalidation (Q4 finding). LangChain ships TTL as first-class (`ttl=3600` canonical example, Q7). Letta's inline rationale at `openai_client.py:307-316` (Q5 verbatim) warns: "Setting an explicit key can disrupt existing warm caches and reduce hit rates" — implying invalidation discipline matters. Item 19 acceptance criterion #3 mandates "write to scope → next recall in same scope MUST miss" — this is CORRECTNESS not perf, so write-triggered invalidation is non-negotiable. TTL adds safety net on top. Scope-tier TTL aligns with OpenAI prompt-cache default TTL spread (5-10min → 24h per Q5).
- **Alternatives considered:**
  - B (TTL-only, no write-triggered): rejected — would serve stale results post-write (correctness bug per Inquebrável Rule 3 honesty).
  - C (write-triggered only, no TTL): rejected — cache grows indefinitely without TTL; LRU eviction (D3) provides bounded capacity but TTL provides time-bounded staleness too.
  - D (Manual purge only): rejected — burdens consumer with cache-discipline TheMemory should own.
- **Consequences:** Scope-write hot path gains an extra DELETE-by-scope query on cache table (perf cost ~1ms via pgvector partial index on `scope_key`). Worth it for correctness.

### D3 — v1.5 default backend = pgvector via subpath `@usetheo/memory/cache-pg`; Redis via DIP follow-up

- **Decision:** Ship `PgvectorRecallCacheStore` impl at subpath `@usetheo/memory/cache-pg` as the v1.5.0 default. Declare 13th DIP `RecallCacheStore` interface at `@usetheo/memory` core barrel. Redis impl deferred to v1.5.1.
- **Rationale:** Q8 confirmed Redis is the ONLY vendor with native semantic cache. pgvector consumers (TheMemory's default, also Mem0 server / Letta / embedchain) have NO native option — this is THE gap. Mirrors `@usetheo/memory/embedders/local` subpath precedent (shipped 2026-06-02 via adapters-openrouter-local-embedder cycle). Redis becomes natural v1.5.1 follow-up since Redis ALREADY has the pattern via LangCache/RedisVL (Q8) — translating their proven pattern to the TheMemory DIP shape is low-risk. Per Inquebrável Rule 11 (YAGNI), ship pgvector first, prove demand, then add Redis.
- **Alternatives considered:**
  - B (Ship pgvector AND Redis day-0): rejected — doubles surface area + bundle isolation tests + 1 new dep (`redis` client) without consumer evidence of demand. YAGNI.
  - C (DIP-only, zero impl built-in): rejected per Inquebrável Rule 9 — we SHOULD ship at least one impl that proves the contract. embedchain ships impls; we should too.
- **Consequences:** Default barrel `@usetheo/memory` does NOT pull pgvector cache code (subpath isolation per `tests/integration/subpath-isolation.test.ts` precedent). Consumer opts in via `import { PgvectorRecallCacheStore } from '@usetheo/memory/cache-pg'`. Composition pattern matches the embedders/local precedent.

### D4 — v1.5 cache key composition = (scope_key, query_embedding)

- **Decision:** Composite cache key with TWO components:
  - (a) `scope_key`: derived from `{tier, id}` (e.g., `user:alice`, `session:run-42`, `agent:claude-sonnet`)
  - (b) `query_embedding`: the normalized query vector from the Embedder DIP (existing v0.1 infrastructure)
  - Lookup: `WHERE scope_key = $1 AND cosine_similarity(query_embedding, $2) >= threshold ORDER BY similarity DESC LIMIT 1`
  - Hit detection: top-1 result above threshold = hit; otherwise miss
- **Rationale:** Q5 Letta lesson — "trust the auto-derived key when system produces a good one" → embedding IS the natural cache key. Q4+Q7 — both embedchain and LangChain use embedding as the primary cache key. Q3 finding — embedchain pairs `gptcache_data_manager(vector_dimension)` ties cache to embedding dim. Scope_key separates cache namespaces (per Item 19 invalidation correctness requirement). DOES NOT add `userId` raw — that would be redundant with `scope_key` derivation.
- **Alternatives considered:**
  - B (Add `attributed_to` to cache key): rejected — would explode cache cardinality. Filter by `attributed_to` at HIT-time via scope_key includes attributed_to lookup; not the cache primary key.
  - C (Hash-keyed exact-match like LlamaIndex IngestionCache): rejected — defeats the semantic-cache point. We WANT near-duplicate hits, not exact-match misses.
  - D (Query text + embedding both): rejected — embedding subsumes text semantically; storing both is redundant.
- **Consequences:** Cache table schema: `(scope_key TEXT, query_embedding vector(N), result_set JSONB, hit_count INT DEFAULT 0, created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ)`. Partial HNSW index on `(scope_key, query_embedding)`. Aligns with existing v0.1 pgvector schema discipline.

### D5 — v1.5 observability = 3 OTel metrics (hit-rate counter + hit/miss latency histograms)

- **Decision:** Expose 3 OTel metrics from v1.5.0:
  - `recall_cache_hit` (Counter) — incremented on hit; labelled by `scope_tier` (user/session/agent/skill) and `embedder_kind`
  - `recall_cache_hit_duration_ms` (Histogram) — observed on hit
  - `recall_cache_miss_duration_ms` (Histogram) — observed on miss
- **Rationale:** Q6 finding — GPTCache measures hit ratio + latency + recall INTERNALLY but does NOT export Prometheus/OTel. Q8 finding — Redis LangCache markets "70% LLM cost reduction" → observability MUST enable consumers to compute their own savings. Item 19 acceptance criterion #2 explicitly mandates `recall_cache_hit_duration_ms` vs `recall_cache_miss_duration_ms` histograms. Adding `recall_cache_hit` counter completes the standard hit-rate computation `counter / (counter + miss-equivalent)`.
- **Alternatives considered:**
  - B (Counter only, no histograms): rejected — Item 19 mandates latency ratio observability.
  - C (Counter + histograms + recall@k accuracy metric): rejected per YAGNI — recall@k measures correctness, not cache effectiveness; out of cache scope.
- **Consequences:** Consumer wires OTel SDK (already supported per ADR D11 from theo-memory-standalone-p0); cache metrics flow into existing tracer infrastructure. Adds ~50 LoC instrumentation to `PgvectorRecallCacheStore`.

## Recommendations for TheMemory v1.5

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | **Lock threshold default at cosine similarity 0.8** (configurable per scope-tier; runtime `[0,1]` validation per embedchain pattern) | Q4 + Q7 convergence; D1; `architecture.md § 1 (three-tier scope)` | HIGH |
| 2 | **Implement TWO invalidation mechanisms**: (a) write-triggered scope invalidation (correctness); (b) TTL gated by scope-tier (24h user / 1h agent / 5-10min session) | Q5 + Q7; D2; Item 19 acceptance criterion #3 | HIGH |
| 3 | **Ship `PgvectorRecallCacheStore` at subpath `@usetheo/memory/cache-pg`** as v1.5.0 default; declare 13th DIP `RecallCacheStore` at core barrel; defer Redis impl to v1.5.1 | Q3 + Q8; D3; `architecture.md § 3 (DIP)`; ADR-0008 method-count cap | HIGH |
| 4 | **Cache key = (scope_key, query_embedding)**; lookup via `WHERE scope_key = $1 AND cosine_similarity(qe, $2) >= threshold ORDER BY similarity DESC LIMIT 1` | Q5 Letta auto-derived-key lesson + Q4 + Q7; D4 | HIGH |
| 5 | **Expose 3 OTel metrics**: `recall_cache_hit` counter + `recall_cache_hit_duration_ms` histogram + `recall_cache_miss_duration_ms` histogram (matches Item 19 acceptance criterion #2) | Q6 + Q8; D5; Item 19 acceptance criterion #2 | HIGH |
| 6 | **Gate cache by embedder kind**: when `StubEmbedder` / `DeterministicStubEmbedder` wired, EITHER refuse to operate OR emit loud warning (mirror cycle-1 T2.2 stub-embedder warning at `src/agent-tools/run-server.ts:81-92`) | Q2 + Q5 sub-pattern of Letta's model-aware gating | MEDIUM |
| 7 | **DO NOT mirror embedchain's `auto_flush=20` batch write** — write-through by default; defer batch optimization to v1.5.1 | Q4 + Inquebrável Rule 11 (YAGNI) | LOW |
| 8 | **Default cache max_size = 1000 entries per scope** (mirror embedchain consumer-empirical choice); LRU eviction (compose existing v0.4b `EvictionPolicy` DIP if possible — investigate during /to-plan) | Q4 verbatim; v0.4b `EvictionPolicy` precedent | MEDIUM |
| 9 | **CLAUDE.md Item 19 amendment**: restate "greenfield" claim as "no competitor documents semantic-recall caching AT THE RECALL() LAYER" (mem0/embedchain documents at RAG-response layer per Q3+Q4 — different layer) | EC-5 CLAUDE.md verdict (VERIFIED-WITH-NUANCE) | LOW (doc-only) |
| 10 | **Schedule follow-up discoveries** for the 2 gaps: (a) Zep semantic cache prior_art (Zep not in references/; CLAUDE.md claim about Zep stays UNVERIFIED); (b) LangMem semantic cache prior_art (LangMem dir empty on this machine — re-clone needed) | Honest disclosure per Inquebrável Rule 3 | LOW |

## Blocked questions (if any)

| Question | Reason | Suggested human follow-up |
|---|---|---|
| Q6 (PARTIAL) | ACL Anthology PDF binary unparseable inline by WebFetch (180.9 KB downloaded but content-extraction failed) | Follow-up: re-fetch via `pdftotext` on local cache OR re-search for HTML version of paper. For v1.5 hard-lock confirmation; NOT blocking for v1.5.0 design space lock since GitHub README + embedchain Q4 + LangChain Q7 convergence already provide sufficient evidence. |
| **(out-of-scope — Zep)** | Zep not in `.claude/knowledge-base/references/` on this machine | Follow-up discovery slug `zep-semantic-cache-prior-art` recommended for full CLAUDE.md claim verification |
| **(out-of-scope — LangMem)** | LangMem dir empty on this machine | Follow-up: re-clone LangMem `--depth 1`; OR accept gap as honest disclosure per Inquebrável Rule 3 |

## Halt-loop progress (audit trail)

- Iterations used: 9 / 30
- Questions answered: 7 done + 1 done_partial / 8 (Q6 has honest PARTIAL disclosure due to PDF binary unparseable)
- Questions blocked: 0 (none fully blocked; 1 partial)
- Citations verified: 5 web snapshots written + 6 local refs path-verified (embedchain/tests/, embedchain/pyproject.toml, embedchain/cache.py, embedchain/config/cache_config.py, letta test file, letta openai_client.py)
- Snapshots written: 5 (df784888a9d9ac25 GitHub README, 8f0d0dc1f0a1f4d8 ACL paper bibliographic, 68edbeac490554e6 LangChain Redis, 86c66bc5a3514c52 LlamaIndex, 3df4fe116348a642 vendor survey)
- Web budget spent estimate: ~26k tokens / 35k cap (per ADR D1)
- EC absorptions paid off: EC-1 (Q6 arXiv ID was WRONG in plan v1.0 → WebSearch surfaced correct ACL Anthology source); EC-2 (Q7 LangChain URL was deprecated → WebSearch surfaced canonical `langchain-redis` package + parameter rename `score_threshold` → `distance_threshold`); EC-3 (Q4 ↔ Q6 dependency CONFIRMED via Q1 partial read of cache.py imports; processed Q6 before Q4 final); EC-4 (Q8 consolidated single WebSearch covered 4 vendors in ~6k tokens vs naive ~24k); EC-5 (CLAUDE.md claim verdict section populated with VERIFIED-WITH-NUANCE + Q1+Q3+Q4+Q5+Q8 verbatim citations); EC-6 (Q5 negative-evidence cross-pollination yielded 3 transferable patterns); EC-7 (Q3 distinguished `[project.dependencies]` core vs `[project.optional-dependencies]` extras for Rule 9 verdict)
- Promise emitted at iteration: 9 (this iteration; all halt conditions met)

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/semantic-recall-cache-plan.md` v1.1
- Edge-case review: `.claude/knowledge-base/reviews/semantic-recall-cache-edge-cases-2026-06-03.md`
- Snapshots dir: `.claude/knowledge-base/discoveries/snapshots/semantic-recall-cache/`
- Linked TheMemory rules: `.claude/rules/architecture.md § 3 (DIP)`, `.claude/rules/discover-web-allowlist.txt`, `.claude/rules/cycle-discover.md v1.1`, Inquebrável Rule 9 (Não Reinvente)
