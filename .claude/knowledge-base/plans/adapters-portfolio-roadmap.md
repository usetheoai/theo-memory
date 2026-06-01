# Adapters portfolio roadmap — `@usetheo/memory/{embedders,llms,stores}`

**Created:** 2026-06-01
**Status:** ACTIVE roadmap document; companion to `CLAUDE.md § Macro roadmap`
**Owner:** project owner

## Goal

Match Mem0's adapter portfolio breadth (~52 adapters across embedders + LLMs + vector stores) shipped as **opt-in subpath imports** with each adapter's deps declared in `optionalDependencies`. Close the most-cited gap vs Mem0 in the competitive matrix WITHOUT bundling heavy provider SDKs into the core.

The action verb is **port**; the named observable metric is the **count of adapters shipped + Rule 9 evaluation document for each**.

## Architectural shape (LOCKED before any T0)

### Sub-package convention (mirrors Mem0's category dirs)

```
src/embedders/{name}.ts        → @usetheo/memory/embedders/{name}
src/llms/{name}.ts             → @usetheo/memory/llms/{name}
src/stores/{name}.ts           → @usetheo/memory/stores/{name}
```

Each adapter file:
1. Implements the DIP from `src/core/dip/` (`Embedder`, `LLM`, `VectorStore`)
2. Imports its provider SDK from `optionalDependencies` in `package.json`
3. Throws a clear `ProviderSdkMissing` error at construction if peer not installed (no silent fallback)
4. Has a paired contract test under `src/embedders/__tests__/{name}.test.ts` using DIP shape only

### `optionalDependencies` discipline

- Each new adapter adds its SDK to `optionalDependencies` (NOT `dependencies`)
- `npm install @usetheo/memory` stays lean (no provider sdks pulled by default)
- Consumer who wants Ollama runs `npm install @usetheo/memory ollama`
- README documents each adapter's peer install command

### Schema constraint (gating decision for embedders)

Current schema: `vector(1536)` hardcoded in `0000_initial.sql`. Most community embedders produce ≠ 1536:
- nomic-embed-text (Ollama): 768
- bge-large-en-v1.5: 1024
- all-MiniLM-L6-v2: 384
- gte-large (fastembed): 1024

**Two-phase resolution:**

- **Phase A (P0-P3 embedders)**: ship adapters that PRODUCE 1536-dim vectors OR projection helper. Acceptable subset: OpenAI text-embedding-3-small (1536), Azure OpenAI (1536), Voyage AI voyage-3-lite (configurable), text-embedding-ada-002 (1536 legacy).
- **Phase B (v1.x BREAKING)**: schema migration → `vector(N)` runtime-resolved with auto-detect at boot. Unblocks ALL community embedders (768, 1024, 384 dims). Tracked as separate roadmap item; this document does NOT block on it.

## Adapter inventory + priority tiers

### Embedders — 12 to port

| # | Adapter | Tier | Dim | Phase | Why this tier |
|---|---|---|---|---|---|
| 1 | `stub` — deterministic hash-based 1536-dim | **P0** | 1536 | A | Unblocks F-T4.1-2 debug + offline CI + tests without external dep |
| 2 | `openai` — text-embedding-3-small / ada-002 | **P0** | 1536 | A | Demo already uses it; first SDK adapter beyond mock |
| 3 | `ollama` — nomic-embed-text / mxbai-embed-large | **P1** | 768-1024 | B | #1 community local pattern; growing fast; Mem0 ships it |
| 4 | `huggingface` — sentence-transformers via Transformers.js | **P1** | 384-1024 | B | Largest open ecosystem; Mem0 + Letta both ship |
| 5 | `azure_openai` — Azure-hosted OpenAI | **P2** | 1536 | A | Enterprise breadth; near-identical to openai adapter |
| 6 | `aws_bedrock` — Bedrock Titan / Cohere | **P2** | 1024-1536 | A/B | Enterprise; AWS ecosystem |
| 7 | `vertexai` — Google Vertex AI text-embedding-004 | **P2** | 768 | B | Enterprise; GCP ecosystem |
| 8 | `gemini` — Google Gemini text-embedding-004 | **P2** | 768 | B | Direct Gemini API (non-Vertex) |
| 9 | `fastembed` — ONNX local via fastembed-js | **P3** | 384-1024 | B | Lightweight local without Ollama daemon |
| 10 | `lmstudio` — LM Studio HTTP localhost | **P3** | varies | B | Power user local; Mem0 ships |
| 11 | `together` — Together.ai hosted models | **P3** | varies | B | Aggregator; lower priority |
| 12 | `voyageai` — Voyage AI (best embeddings per recent leaderboards) | **P3** | 1024-1536 | A | Strong technical merit; growing |

**Phase A subset shippable without schema migration**: stub, openai, azure_openai, voyageai (1536-dim variants), bedrock-titan-v2-1536, ada-002.

### LLMs — 20 to port (prioritized differently from embedders)

| # | Adapter | Tier | Why |
|---|---|---|---|
| 1 | `stub` — deterministic | **P0** | Mirror StubLLM in ADR D8; unblock tests |
| 2 | `openai` | **P0** | Demo uses; ubiquitous |
| 3 | `anthropic` — Claude | **P1** | TheoKit's own loop (`@usetheo/sdk` consumes Claude); natural pareamento; first competitive advantage vs Mem0 (Mem0 has anthropic too but we ship native via TheoKit) |
| 4 | `ollama` | **P1** | Local-first; community demand |
| 5 | `azure_openai` | **P2** | Enterprise |
| 6 | `aws_bedrock` (Anthropic-on-Bedrock + Titan) | **P2** | Enterprise |
| 7 | `vertexai` (Gemini-on-Vertex) | **P2** | Enterprise GCP |
| 8 | `gemini` (direct API) | **P2** | Direct |
| 9 | `groq` — fast Llama inference | **P3** | Speed-first community |
| 10 | `deepseek` — open-weight reasoning | **P3** | Cost/perf community |
| 11 | `together` — open-model hosting | **P3** | Open community |
| 12 | `lmstudio` | **P3** | Power user local |
| 13 | `vllm` — high-throughput self-host | **P3** | Self-hosted infra |
| 14 | `litellm` — proxy aggregator | **P3** | Wraps everything; lower priority since native adapters preferred |
| 15-20 | minimax, sarvam, openai_structured, azure_openai_structured, langchain, etc. | **P4** | Long-tail; ship as community contributes |

### Vector stores — 20+ to port (Phase II — gated by schema unification)

| # | Adapter | Tier | Why |
|---|---|---|---|
| 1 | `inmemory` (already shipped) | — | Done |
| 2 | `pgvector` (already shipped) | — | Done |
| 3 | `qdrant` | **P1** | #1 alternative to pgvector for greenfield; growing ecosystem |
| 4 | `pinecone` | **P1** | Managed default for new consumers; well-known |
| 5 | `chroma` | **P2** | Lightweight; Python originally but Node port exists |
| 6 | `weaviate` | **P2** | Growing managed offering |
| 7 | `milvus` | **P3** | Larger ecosystem; enterprise |
| 8 | `redis` (with redis-stack vector) | **P3** | Existing Redis users |
| 9 | `mongodb` (Atlas vector search) | **P3** | MongoDB users |
| 10 | `elasticsearch` (vector search) | **P3** | ES users |
| 11 | `faiss` (local in-process) | **P3** | Lightweight local alternative |
| 12-20+ | azure_ai_search, opensearch, neptune_analytics, baidu, databricks, cassandra, etc. | **P4** | Enterprise long-tail |

**Vector stores carry a heavier architectural burden**: each one has its own filter syntax, partial-update semantics, transactional guarantees. Cycle-per-adapter is realistic; Phase B schema-flexible-dim migration MUST land before broad porting.

## Execution sequencing

### Cycle 1 — **Embedders P0 + LLM P0** (UNBLOCKS F-T4.1-2 debug)

**Scope:** stub adapters for Embedder + LLM. Subpath `@usetheo/memory/embedders/stub` + `@usetheo/memory/llms/stub`. Each takes a seed; produces deterministic output. Demo gains opt-in flag `THEOMEM_USE_STUB_ADAPTERS=1` that wires both. F-T4.1-2 debug becomes reproducible without OpenAI.

**Goal metric:** `examples/chat-with-memory` boots with `THEOMEM_USE_STUB_ADAPTERS=1` + `THEOMEM_PG_URI` set → POST /api/chat returns 200 → raw SQL shows persisted rows with deterministic content. F-T4.1-2 reproducible 100% of the time (same input → same scope distribution).

**Estimated cost:** 30-50k tokens (small cycle).

### Cycle 2 — **OpenAI extract from demo to SDK**

**Scope:** lift `examples/chat-with-memory/lib/openai-adapters.ts` (OpenAIEmbedder + OpenAILLM) into `src/embedders/openai.ts` + `src/llms/openai.ts`. Demo imports from public surface. README documents. First non-stub adapter shipped.

**Goal metric:** `import { OpenAIEmbedder } from "@usetheo/memory/embedders/openai"` works against published package; demo refactored to use it; tests pass.

**Estimated cost:** 60-90k tokens.

### Cycle 3 — **Ollama embedder + LLM** (P1 local; unblocks offline dev for Phase B)

**Scope:** `@usetheo/memory/embedders/ollama` + `@usetheo/memory/llms/ollama`. Requires Phase B schema flex (or projection helper). Both shipped in same cycle since paired.

**Goal metric:** demo boots with Ollama running locally → no OpenAI needed → full chat round-trip with consistent embeddings.

**Estimated cost:** 100-150k tokens (includes schema phase B work OR projection helper).

### Cycle 4 — **Anthropic LLM** (P1; first TheoKit-native pareamento)

**Scope:** `@usetheo/memory/llms/anthropic`. Consumer pareamento with `@usetheo/sdk` Agent. Marketing win.

**Estimated cost:** 60-80k tokens.

### Cycle 5+ — Phase B schema migration (BREAKING, gates P1/P2 community adapters)

**Scope:** `vector(N)` runtime-resolved; auto-detect dim at boot; migrate existing pgvector schema; document BREAKING change with full runway in CHANGELOG.

**Estimated cost:** 150-250k tokens.

### Cycle 6+ — **P1 community embedders** (HuggingFace, Voyage, fastembed) parallel via Phase B

Each adapter as separate small cycle (50-80k tokens). Order by community demand signal.

### Cycle 7+ — **Vector stores P1** (Qdrant + Pinecone)

Each store carries its own cycle due to filter/upsert/transaction semantics. ~120-180k tokens each.

## Honest constraints + risks

### Rule 9 evaluation for each adapter

Per Inquebrável Rule 9, every NEW adapter cycle MUST include:
- The provider's SDK choice + reasoning (e.g., `openai` npm vs hand-rolled HTTP)
- Rejected alternatives + why
- License compatibility (MIT-compatible only for core; provider SDKs may carry own licenses)
- Maintenance signal (last release, issue response time, ecosystem health)

### Bundle size discipline

`@usetheo/memory` core MUST stay lean. After all adapters ship:
- Default `npm install @usetheo/memory` pulls only `pg` + `drizzle-orm` (current state).
- Consumer who wants Ollama installs `npm install @usetheo/memory ollama`.
- `optionalDependencies` strategy is the contract.

### Schema dim BREAKING change

Phase B = breaking. Honest communication strategy:
1. Announce in CHANGELOG `[Unreleased]` with `**BREAKING**:` prefix + 90-day deprecation window
2. Ship `runMigrations()` that detects old `vector(1536)` schema + migrates with rebuild of embeddings (forces consumer re-index)
3. Document in README's "Migration guides" section (need to create)

### Out of scope for THIS document

- The F-T4.1-2 race condition root-cause analysis itself (separate cycle once Cycle 1 unblocks empirical reproduction)
- TheoCloud cloud adapters (`src/cloud/`) — Item 7 v0.5 separate roadmap
- Skill library expansion (Item 8 v0.6 follow-on) — separate roadmap
- The pre-existing `docs/forgetting-evaluation.md` debt — separate item

## Cross-references

- Mem0 catalog source: `.claude/knowledge-base/references/mem0/mem0/{embeddings,llms,vector_stores}/`
- Architectural rules: `.claude/rules/architecture.md` § 3 (DIP), § 7 (module hygiene), § 9 (public API), § 10 (build pipeline)
- Existing DIPs: `src/core/dip/embedder.ts`, `src/core/dip/llm.ts`, `src/core/dip/vector-store.ts`
- ADR-0008: DIP method counts (constraint on adapter shape)
- ADR D8 (v0.2 binding): existing StubEmbedder + StubLLM precedent
- CLAUDE.md: roadmap Items 1-15 — these adapters live OUTSIDE the macro roadmap as `@usetheo/memory/{adapters,llms,stores}/*` sub-roadmap

## Decision log

| Date | Decision | Rationale | Author |
|---|---|---|---|
| 2026-06-01 | Adapter portfolio matching Mem0 breadth, shipped as opt-in subpath imports with `optionalDependencies` discipline. Schema dim BREAKING migration gated to Phase B (v1.x). | OpenAI quota-exhaust forced surfacing of provider-lock-in risk; competitive matrix vs Mem0 shows portfolio breadth is #1 gap; current architecture (DIP-based) already aligned with pluggable adapter pattern. | project owner via this document |

## Next action

Decide Cycle 1 start: invoke `/to-plan adapters-stub-embedder-llm-cycle-1` to author the first concrete plan (StubEmbedder + StubLLM unblock cycle).
