# Mem0 (TypeScript SDK) — Exploration Report

**Date:** 2026-05-21
**Explored by:** Claude (Paulo)
**Source:** `theo-memory/referencia/mem0/mem0-ts/` (cloned `--depth 1` from [mem0ai/mem0](https://github.com/mem0ai/mem0))
**Version:** `mem0ai@3.0.3` (npm)
**License:** Apache-2.0
**Investigated question:** *"You asked TheMemory to 'work IGUAL ao Mem0'. What does that mean in concrete code? What do we copy, what do we change?"*

This report is the foundation for the TheMemory API contract. Read it before proposing implementation changes — the design decisions here are evidence-grounded, not vibes.

---

## 1. Context — why we explored

`/CLAUDE.md` (root, 2026-05-21 update) instructs `@usetheo/memory` to ship with **Mem0-shape architecture**: vector + LLM extraction + hybrid retrieval (semantic + BM25 + entity matching). The Mem0 TypeScript SDK is the closest existing implementation in our target language and most of our target stack. Studying it answers:

- What the public API surface actually looks like in TypeScript
- How they abstract providers (LLMs, embeddings, vector stores) — our DIP boundaries
- How the two-stage Extract→Update pipeline ships as code (vs. the diagrams in the [`landscape doc`](../agentic-memory-landscape.md))
- How they map user / agent / session scopes onto storage (it maps **perfectly** onto our User / Session / Agent tiers — confirmed below)
- Where we should diverge (we will diverge — important divergences flagged in §10)

---

## 2. Architecture — provider pattern with three DIP boundaries

Mem0 TS exposes a single concrete class `Memory` (`src/oss/src/memory/index.ts`, 1708 lines) that composes three abstract providers.

### 2.1 DIP boundaries (interfaces)

Three minimal interfaces sit between the `Memory` class and infrastructure:

```typescript
// src/oss/src/vector_stores/base.ts — 34 LOC
export interface VectorStore {
  insert(vectors: number[][], ids: string[], payloads: Record<string, any>[]): Promise<void>;
  search(query: number[], topK?: number, filters?: SearchFilters): Promise<VectorStoreResult[]>;
  keywordSearch?(query: string, topK?: number, filters?: SearchFilters): Promise<VectorStoreResult[] | null>;
  get(vectorId: string): Promise<VectorStoreResult | null>;
  update(vectorId: string, vector: number[], payload: Record<string, any>): Promise<void>;
  delete(vectorId: string): Promise<void>;
  deleteCol(): Promise<void>;
  list(filters?: SearchFilters, topK?: number): Promise<[VectorStoreResult[], number]>;
  getUserId(): Promise<string>;
  setUserId(userId: string): Promise<void>;
  initialize(): Promise<void>;
}

// src/oss/src/llms/base.ts — 19 LOC
export interface LLM {
  generateResponse(messages, response_format?, tools?): Promise<any>;
  generateChat(messages: Message[]): Promise<LLMResponse>;
}

// src/oss/src/embeddings/base.ts — 4 LOC
export interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

Plus a fourth for audit history:

```typescript
// src/oss/src/storage/base.ts — 37 LOC
export interface HistoryManager {
  addHistory(memoryId, previousValue, newValue, action, createdAt?, updatedAt?, isDeleted?): Promise<void>;
  getHistory(memoryId): Promise<any[]>;
  reset(): Promise<void>;
  close(): void;
  // V3 optional methods
  saveMessages?(messages, sessionScope): Promise<void>;
  getLastMessages?(sessionScope, limit?): Promise<...>;
  batchAddHistory?(records): Promise<void>;
}
```

**Observation:** The four interfaces are **minimal, ortogonal, and total** — no leaky abstractions. `keywordSearch` is optional (graceful degradation), and the V3 history methods are also optional (older backends keep working). This is excellent DIP hygiene.

### 2.2 Provider registration via Factory pattern

```typescript
// In Memory constructor:
this.embedder = EmbedderFactory.create(this.config.embedder.provider, this.config.embedder.config);
this.llm = LLMFactory.create(this.config.llm.provider, this.config.llm.config);
this.db = HistoryManagerFactory.create(this.config.historyStore!.provider, this.config.historyStore!);
// Vector store deferred to _autoInitialize() so embedding dim can be probed first
```

Provider is a **string key** (`"openai"`, `"qdrant"`, `"pgvector"`). Factory class switches on the string and returns the concrete implementation. Config is `Record<string, any>` validated by Zod. **Trade-off:** loses TypeScript type safety on config; gains runtime extensibility (community can register providers without touching core types).

### 2.3 Provider catalog (what they shipped)

| Category | Count | Notable |
|---|---|---|
| Vector stores | 9 (TS) / 30 (Python) | `memory`, `qdrant`, `pgvector`, `redis`, `supabase`, `azure_ai_search`, `vectorize` (Cloudflare), `langchain` (adapter), `memory` (in-memory dev) |
| LLMs | 10 (TS) | `openai`, `anthropic`, `google`, `groq`, `mistral`, `azure`, `ollama`, `lmstudio`, `deepseek`, `langchain`, `openai_structured` |
| Embeddings | 6 (TS) | `openai`, `google`, `azure`, `ollama`, `lmstudio`, `langchain` |
| History managers | 4 (TS) | `Dummy`, `Memory` (in-memory), `SQLite`, `Supabase` |

**Adapter pattern:** `langchain` appears in every category — Mem0 ships a single LangChain adapter per category that delegates to LangChain's own provider catalog. **This is a smart shortcut for ecosystem reach.** We should consider an adapter for the equivalent in our stack (no equivalent exists in `@usetheo/sdk` yet — our adapter would be to `@usetheo/sdk`'s provider abstraction once it stabilizes).

### 2.4 Auto-detected embedding dimension

```typescript
private async _autoInitialize(): Promise<void> {
  if (!this.config.vectorStore.config.dimension) {
    const probe = await this.embedder.embed("dimension probe");
    this.config.vectorStore.config.dimension = probe.length;
  }
  // ... then create vector store
}
```

The vector store is **lazily created after** a probe embedding. User doesn't have to know that `text-embedding-3-small` is 1536 dimensions and `text-embedding-3-large` is 3072. **Adopt this** — it's a small UX win that saves users from a recurring footgun.

---

## 3. Public API surface

### 3.1 The `Memory` class

```typescript
class Memory {
  constructor(config: Partial<MemoryConfig> = {});  // synchronous, defers init

  // Write
  add(messages: string | Message[], config: AddMemoryOptions): Promise<SearchResult>;

  // Read
  search(query: string, config: SearchMemoryOptions): Promise<SearchResult>;
  get(memoryId: string): Promise<MemoryItem | null>;
  getAll(config: GetAllMemoryOptions): Promise<SearchResult>;
  history(memoryId: string): Promise<any[]>;

  // Mutate
  update(memoryId: string, data: string): Promise<{ message: string }>;
  delete(memoryId: string): Promise<{ message: string }>;
  deleteAll(config: DeleteAllMemoryOptions): Promise<{ message: string }>;

  // Lifecycle
  reset(): Promise<void>;
}
```

### 3.2 The three-scope model — `user_id` / `agent_id` / `run_id`

This is the most important finding for TheMemory's design.

```typescript
// src/oss/src/memory/memory.types.ts
export interface Entity {
  userId?: string;
  agentId?: string;
  runId?: string;
}

// In add():
if (!filters.user_id && !filters.agent_id && !filters.run_id) {
  throw new Error("One of the filters: userId, agentId or runId is required!");
}
```

**Mem0's three scopes map directly to our three tiers:**

| Mem0 | TheMemory | Lifetime |
|---|---|---|
| `user_id` | **User tier** | Durable, cross-session |
| `agent_id` | **Agent tier** | Durable, learned by the agent |
| `run_id` | **Session tier** | Window-bounded (one conversation) |

Our README already uses `memory.session(sessionId)` where Mem0 uses `run_id`. The semantics are identical — we just renamed "run" to "session" for clarity. **The mapping is 1:1.** Implementation-wise, scope is passed as a `filters` object both ways through the pipeline.

**API ergonomics divergence:** Mem0 passes scope as flat options on each call (`memory.add(messages, { userId, agentId, runId })`). Our README proposes a **scoped sub-object** API (`memory.user(userId).remember(text)`). The Mem0 shape is one fewer call but harder to type-narrow. The TheMemory shape is more verbose but lets TypeScript narrow the return type per tier. **Keep our scoped shape** — it pays for itself in DX and type safety.

### 3.3 Three-scope validation (defensive)

Mem0 actively **rejects** top-level entity params:

```typescript
function rejectTopLevelEntityParams(config, methodName) {
  const invalidKeys = Object.keys(config).filter(k => ENTITY_PARAMS.includes(k));
  if (invalidKeys.length > 0) {
    throw new Error(`Top-level entity parameters [${invalidKeys}] are not supported in ${methodName}(). Use filters: { userId: "..." } instead.`);
  }
}
```

History: they had a v1 API that took scope at top level, then changed to nested `filters`. The validator was added to **prevent silent regressions when users follow old docs**. We don't have this history — our v1 ships with the scoped sub-object API, so we don't need this guard. But the lesson is: **validate API contracts in code, not just in docs**. Reject ambiguity instead of accepting it permissively.

---

## 4. The `add()` pipeline — six phases

`memory/index.ts:507-560` (public method) → `addToVectorStore()` at line 562 (the actual work).

### 4.1 Fast path — `infer: false`

If the caller passes `infer: false`, the pipeline is skipped entirely:

```typescript
if (!infer) {
  for (const message of messages) {
    const memoryId = await this.createMemory(message.content, {}, metadata);
    returnedMemories.push({ id: memoryId, memory: message.content, metadata: { event: "ADD" } });
  }
  return returnedMemories;
}
```

Use case: **direct fact insertion**, no extraction. The user already knows what should be remembered; no LLM call needed. **Adopt this escape hatch.** Saves money and latency when the agent / framework has already done the extraction work.

### 4.2 The phased batch pipeline (when `infer: true`, default)

```
Phase 0 — Context gathering
  └─ buildSessionScope(filters) → string key
  └─ db.getLastMessages?(sessionScope, 10) → last 10 turns from history (if backend supports)

Phase 1 — Existing memory retrieval
  └─ embed(new messages joined)
  └─ vectorStore.search(embedding, topK=10, filters)
  └─ Map UUIDs → integer indexes (anti-hallucination: LLM never sees raw UUIDs)

Phase 2 — LLM extraction (SINGLE call)
  └─ system prompt = ADDITIVE_EXTRACTION_PROMPT  (+ AGENT_CONTEXT_SUFFIX if agent-scoped)
  └─ user prompt = generateAdditiveExtractionPrompt({ existingMemories, newMessages, lastKMessages, customInstructions })
  └─ llm.generateResponse(messages, { type: "json_object" })
  └─ Parse with Zod schema AdditiveExtractionSchema → array of { id?, text, attributed_to?, linked_memory_ids? }

Phase 3 — Batch embed extracted memories
  └─ embedder.embedBatch(memTexts) → embedding per text
  └─ Fallback to individual embed() if batch fails

Phase 4-5 — Hash dedup + CPU processing
  └─ existingHashes = Set of MD5 hashes from Phase 1 results
  └─ For each extracted memory:
       hash = MD5(text)
       if hash in existingHashes or seenHashes → skip
       textLemmatized = lemmatizeForBm25(text)  // precomputed for BM25 search
       Build payload: { data, textLemmatized, hash, createdAt, updatedAt, user_id, agent_id, run_id, attributedTo? }

Phase 6 — Batch persist
  └─ vectorStore.insert([all vectors], [all ids], [all payloads])
  └─ Fallback to one-by-one insert if batch fails
  └─ Batch history records via db.batchAddHistory?()
  └─ Save raw messages via db.saveMessages?() — for next call's Phase 0
```

### 4.3 Key insights

1. **Single LLM call, not two-stage.** The `landscape doc` (2026-05-16) described Mem0 v2.0 as "two-stage: Extract → Update". The actual v3 code consolidates into one LLM call with the additive prompt. The "two stages" are: (1) retrieve context + dedup candidates *before* the LLM call, (2) run the single LLM call with that context. **Update our internal contract** — the pipeline is logically two-phase but mechanically one LLM call.

2. **UUID → integer mapping is anti-hallucination.** The LLM sees `{ id: "0", text: "..." }, { id: "1", text: "..." }`. If it tries to invent or recombine a memory, the integer references stay valid. UUIDs are mapped back on the way out.

3. **MD5 hash dedup is exact-match only.** Two memories saying *"User likes coffee"* and *"User likes Coffee"* (capitalization) will both be stored. Dedup catches identical text, not semantic duplicates. The LLM is responsible for semantic dedup via the existing-memory context passed in the prompt.

4. **ADD-only is enforced by the prompt, not the code.** The pipeline writes new records without overwriting. The LLM, however, can be instructed to *suppress* a new memory if it's redundant with existing ones (that's the dedup context). So the "ADD-only" guarantee depends on the prompt working correctly.

5. **Lemmatization is precomputed at write.** `textLemmatized` lives in the payload alongside `data`. BM25 search reads `textLemmatized`. **Adopt this** — keeps search-time CPU cost low and avoids re-tokenizing on every query.

6. **Robust fallbacks at every I/O boundary.** Batch embed fails? Fall back to individual. Batch insert fails? Fall back to one-by-one. LLM extraction errors? Save the raw message anyway. **Adopt this defensiveness** — memory writes should degrade gracefully, not block the agent.

7. **`attributed_to` field for multi-peer scenarios.** The LLM can mark a memory as *"about user X, said by user Y"*. Stored in payload. We didn't plan for this in our README — worth considering if we add multi-peer modeling (Honcho-style).

---

## 5. The `search()` pipeline — nine steps

`memory/index.ts:1037-1269`. This is where the hybrid retrieval lives.

```
Step 1 — Preprocess query
  └─ queryLemmatized = lemmatizeForBm25(query)
  └─ queryEntities = extractEntities(query) → [{ type, text }, ...]

Step 2 — Embed query

Step 3 — Semantic search (over-fetch)
  └─ internalLimit = max(topK * 4, 60)
  └─ vectorStore.search(embedding, internalLimit, filters)

Step 4 — Keyword search (optional)
  └─ if vectorStore.keywordSearch is defined:
       vectorStore.keywordSearch(queryLemmatized, internalLimit, filters)

Step 5 — Compute BM25 scores
  └─ [midpoint, steepness] = getBm25Params(query, queryLemmatized)
  └─ For each keyword result: normalizedScore = sigmoid(rawScore, midpoint, steepness)

Step 6 — Compute entity boosts (from separate entity store)
  └─ deduped = first 8 unique entities
  └─ For each entity:
       entityEmbed = embed(entity.text)
       matches = entityStore.search(entityEmbed, 500, filters)
       For each match with similarity >= 0.5:
         spread = 1.0 / (1.0 + 0.001 * (numLinked - 1)^2)  // attenuates over-linked entities
         boost = similarity * 0.5 * spread
         For each linkedMemoryId: entityBoosts[id] = max(existing, boost)

Step 7 — Build candidate set from semantic results

Step 8 — Score and rank (additive)
  └─ For each candidate (must have semanticScore >= threshold):
       combined = (semanticScore + bm25Score + entityBoost) / maxPossible
  └─ Sort desc, take topK

Step 9 — Format results (strip internal payload fields, project to MemoryItem)
```

### 5.1 The scoring formula — what Mem0 actually does

**Our README claimed:** `score = recency × importance × relevance` (Generative Agents, Park et al. 2023).

**What Mem0 actually does** (`utils/scoring.ts`):

```typescript
const hasBm25 = bm25Scores has entries;
const hasEntity = entityBoosts has entries;

let maxPossible = 1.0;
if (hasBm25) maxPossible += 1.0;
if (hasEntity) maxPossible += 0.5;  // ENTITY_BOOST_WEIGHT

// Threshold gates semantic BEFORE combining
if (semanticScore < threshold) skip;

combined = (semanticScore + bm25Score + entityBoost) / maxPossible;
```

**Three material differences from our README:**

| Dimension | Generative Agents (our README) | Mem0 (actual) |
|---|---|---|
| Score combination | **Multiplicative** (recency × importance × relevance) | **Additive** (semantic + bm25 + entity_boost) / max_possible |
| Recency decay | Yes (exponential, half-life configurable) | **None** — no time-based scoring |
| LLM-judged importance | Yes (1–10 at write, cached) | **None** — no importance scoring |
| Threshold | After combining | **Before** combining (gates semantic only) |

**This is a meaningful divergence.** See §10 for our decision.

### 5.2 The separate entity store

Entity boost works via a **second vector store** (`_entityStore`). Each entity becomes a vector with `linkedMemoryIds: string[]` in its payload pointing back to the memories that mention it. At query time, the search embeds query entities and matches against the entity store, then boosts the linked memories.

**Trade-off:** Two vector stores doubles the storage + write cost but enables clean entity-based boosting without a graph database. Spread-attenuation prevents common entities ("user", "the") from dominating. **Adopt this approach** — it's how you get a Zep-style entity boost without paying for a graph database. For TheMemory we'd have one pgvector table for memories and another for entities.

### 5.3 Over-fetch ratio

```typescript
const internalLimit = Math.max(topK * 4, 60);
```

Semantic search retrieves 4× the requested topK (minimum 60). Gives the scorer a wider pool to rerank. **Adopt this**, with the same defaults. The cost is one vector query — cheap compared to the LLM call.

---

## 6. Storage history — audit trail

`storage/base.ts:HistoryManager` is the **non-vector storage** layer that tracks every mutation:

```typescript
addHistory(memoryId, previousValue, newValue, action, createdAt, updatedAt, isDeleted)
```

Backends:
- **DummyHistoryManager** — null implementation (when `disableHistory: true`)
- **MemoryHistoryManager** — in-process Map (for tests / ephemeral usage)
- **SQLiteManager** — local SQLite file
- **SupabaseHistoryManager** — Postgres via Supabase REST

**V3 additions (optional methods):**
- `saveMessages(messages, sessionScope)` — store raw user/assistant turns for Phase 0 context gathering
- `getLastMessages(sessionScope, limit)` — pull recent turns for Phase 0
- `batchAddHistory(records)` — write many history records in one transaction

**Insight:** the history manager is **separate from the vector store**. Audit trail does not need ANN — it needs ordered append + filtered read. SQLite is enough. **Adopt this split:** TheMemory's local mode should use Postgres for *both* (pgvector for vectors, regular tables for history) but the interfaces stay separate.

---

## 7. Build / test / packaging

`package.json` highlights:

- **Build:** `tsup` (CJS + ESM, source-map enabled, tree-shake on, `splitting: false`, no minify). Type declarations resolved via `dts: { resolve: true }`.
- **Test:** `jest` (unit + integration via separate config).
- **Linter:** none in the TS SDK (per Mem0's own AGENTS.md — they use Prettier-only here, Biome in `cli/node/`, ESLint in `vercel-ai-sdk/`).
- **Package manager:** `pnpm@10.5.2` pinned via `packageManager` field.
- **Subpath exports:** `mem0ai` for hosted client, `mem0ai/oss` for self-hosted. Their existing client-cloud split via subpath is the same shape our two-runtime model needs.
- **Peer dependencies:** every vector store / LLM / embedding provider is `peerDependencies` — installed only if used. **Adopt this.** Keeps the install lean.
- **`engines`:** Node `>= 18`. Their own AGENTS.md tests on Node 20 and 22.

---

## 8. What to ADOPT for TheMemory

In order of priority:

1. **The three minimal DIP interfaces** — `VectorStore`, `LLM`, `Embedder` — almost verbatim. Their shape is right. Add ours: `MemoryStore` (the top-level facade Mem0 implements as the `Memory` class itself).
2. **Three-scope filtering** — `user_id` / `agent_id` / `run_id` (we rename `run_id` → `session_id`). Map directly to our User / Agent / Session tiers. **The shape is already validated by production.**
3. **The 6-phase write pipeline** (Phase 0 context → Phase 1 existing retrieval → Phase 2 single LLM call → Phase 3 batch embed → Phase 4-5 dedup → Phase 6 batch persist). Don't reinvent.
4. **`infer: false` escape hatch** — when the caller already has facts to insert, skip the LLM. Saves money + latency.
5. **UUID → integer mapping for LLM prompts** — anti-hallucination trick at near-zero cost.
6. **MD5 hash dedup** — cheap exact-match dedup. Stops the obvious case; semantic dedup is the LLM's job in the extraction prompt.
7. **Lemmatized text precomputed at write** — `textLemmatized` in payload. BM25 read latency stays low.
8. **Over-fetch ratio `max(topK * 4, 60)`** — wider rerank pool, one extra vector query.
9. **Separate entity vector store** — clean entity boost without a graph database. Spread-attenuated boost formula prevents common-entity over-boost.
10. **Robust fallbacks** at every I/O boundary — batch fails → individual; insert fails → one-by-one. Memory writes degrade, don't block.
11. **Auto-detected embedding dimension** via probe call. Eliminates a recurring user footgun.
12. **`HistoryManager` separated from `VectorStore`** — audit doesn't need ANN. SQLite is enough for local; Postgres for TheoCloud.
13. **Subpath exports for runtime split** — `@usetheo/memory` (default) + `@usetheo/memory/cloud` for TheoCloud, `@usetheo/memory/local` for Postgres. Their `mem0ai` vs `mem0ai/oss` is the pattern.
14. **Peer dependencies for every backend provider.** Lean install.
15. **`Zod` for config validation** at the public boundary, `Record<string, any>` internally. Same trade-off they made.

---

## 9. What to AVOID / change for TheMemory

1. **String-keyed Factory pattern.** Loses TS type safety on config; we can do better with a typed registry (`createMemoryStore<"pgvector">({ connectionString, ... })` where the config type is conditional on the provider tag).
2. **`Record<string, any>` payloads.** Mem0's payloads are typed at runtime via Zod only. We have a known three-tier scope shape — we can type the payload statically. Provider-specific extras stay `unknown`.
3. **`generateResponse` LLM interface returning `any`.** Their LLM contract is loose. We have `@usetheo/sdk` and can build on its typed event stream / structured output contract instead. Better composability with the rest of our ecosystem.
4. **Top-level-entity-param rejection guard.** We don't need this because we ship v1 with the scoped sub-object API from day one. No legacy to defend against.
5. **`telemetry` baked into the core class.** Mem0 has `captureClientEvent` calls inside `add` / `search` / etc., wired to PostHog. This is a load-bearing dependency that ships out of the box. For TheMemory: telemetry behind an explicit `observability` interface (off by default for OSS, on by default in TheoCloud), not implicit.
6. **No file-level documentation.** Mem0's `memory/index.ts` is 1708 lines with minimal section comments. We should keep our equivalent under 800 LOC (root `CLAUDE.md` rule) and split into separate files per phase: `pipeline/extract.ts`, `pipeline/embed.ts`, `pipeline/dedup.ts`, `pipeline/persist.ts`, `pipeline/score.ts`, etc.
7. **Provider catalog of 9 vector stores + 10 LLMs + 6 embeddings on day one.** Our roadmap (`README.md`) is more modest: 1 vector store (pgvector) + 1 LLM (OpenAI via `@usetheo/sdk`) + 1 embedding (OpenAI) for v0.1. Don't ship 9 implementations of an interface we haven't proven yet (YAGNI + DRY).

---

## 10. Critical divergences — design decisions to lock

### 10.1 Scoring formula — our `recency × importance × relevance` vs Mem0's additive

**The decision (locked here, 2026-05-21):** Adopt Mem0's additive formula for v0.1. Defer Generative Agents-style scoring (recency × importance × relevance) to v0.4 (Reflection + Forgetting) as an *optional* scoring strategy behind a strategy interface.

**Why:**

- **Mem0's formula is shipped, tested, and proven against real workloads.** The Generative Agents paper showed the multiplicative formula was *better than cosine alone* for long-horizon agents — but Mem0's formula already beats cosine via BM25 + entity boost. Comparing the two would require benchmarks, not vibes.
- **Recency decay is non-trivial to get right.** Half-life per tier, sandbox-time vs wall-clock, batch update of scores — all open problems. Shipping the additive formula first lets us defer this design without holding up v0.1.
- **Importance LLM scoring is expensive.** One extra LLM call per memory write. Mem0 doesn't pay this cost. We shouldn't either, at least not by default.

**README update needed:** the retrieval section in `theo-memory/README.md` is currently wrong about how scoring will work. It promised Generative Agents-style; v0.1 will be Mem0-style. Update the README's "Retrieval — Mem0-shape, multi-signal" section to reflect the actual additive formula. Treat Generative Agents-style as v0.4 roadmap.

### 10.2 Two-runtime split via subpath exports

**Decision (locked here):** Adopt Mem0's pattern: `@usetheo/memory` (local mode default) and `@usetheo/memory/cloud` (TheoCloud-managed). This is cleaner than passing a runtime flag.

```typescript
// Local — default subpath
import { Memory } from "@usetheo/memory";
const mem = await Memory.create({ local: { storage: { type: "postgres", url } } });

// Cloud — explicit subpath
import { Memory } from "@usetheo/memory/cloud";
const mem = await Memory.create({ apiKey: process.env.THEOKIT_API_KEY! });
```

The `cloud` subpath ships a separate dist that talks to TheoCloud and doesn't ship the local runtime dependencies (pgvector libs, BM25 utils, LLM provider catalog). Smaller bundle for cloud-only consumers.

### 10.3 Three-scope shape (`user_id` / `agent_id` / `session_id`)

**Decision (locked here):** Map our User / Agent / Session tiers to Mem0's three-scope filter shape internally. Public API stays the scoped sub-object form (`memory.user(id).remember(...)`). Internally, both shapes resolve to the same `filters` object passed to the vector store.

This gives us: Mem0-shape backend semantics + TheMemory-shape DX.

### 10.4 Public API method names

**Decision (locked here, divergence from Mem0):** Keep our README's `remember / recall / forget / reflect` verbs. They are clearer than Mem0's `add / search / delete / (no reflect)`. The cost of the divergence is non-zero — Mem0 documentation and learnings don't translate directly — but the gain is worth it for TheoKit users.

**Mapping:**

| TheMemory verb | Mem0 method | Notes |
|---|---|---|
| `remember(fact, options)` | `add(messages, options)` | Same semantics; the tier-scoped form (`memory.user(id).remember(text)`) wraps it |
| `recall(query, options)` | `search(query, options)` | Same semantics |
| `forget(predicate, options)` | `delete(memoryId)` / `deleteAll(...)` | We accept a predicate (`{ olderThan: "30d" }`); Mem0 takes only IDs |
| `reflect(options)` | *(not implemented)* | Our roadmap 0.4 — Mem0 has no equivalent today |
| *(no equivalent)* | `update(memoryId, data)` | TheMemory is ADD-only by design; updates create new memories with attribution |
| *(no equivalent)* | `history(memoryId)` | Useful for audit — should we add it? See §11 |

### 10.5 `update()` and `history()` — do we ship them?

Mem0 has both. TheMemory's README claims ADD-only writes. There's tension here.

**Decision (proposed):** Ship `history(memoryId)` for audit trails (cheap, no new code paths). Do **not** ship `update(memoryId, data)` — it contradicts ADD-only. If a user wants the effect of "update", they should `forget(id)` + `remember(newText)`, which the ADD-only pipeline handles correctly.

**Open question (§11):** Mem0's `update()` does technically write a new record and link via history. Is that compatible with ADD-only in spirit? Worth thinking through.

---

## 11. Open questions for the contract

These need answers before the contract is locked at v0.0:

1. **Multi-peer / `attributed_to`.** Do we support multi-party scenarios (memory A is *"about user X, said by user Y"*) on day one? Mem0 has `attributed_to` in the payload but it's an optional add. TheMemory roadmap doesn't mention it.
2. **`update()` vs ADD-only.** Reread §10.5 — is there a sensible `update` semantics inside an ADD-only system? Or do we hold the line?
3. **Reflection trigger.** Mem0 has no `reflect()`. We promised one in v0.4. What triggers it? Background scheduler? Explicit call? Threshold-based (when N new memories since last reflection)? This shapes the storage layer.
4. **Bi-temporal validity on local mode.** Cloud will ship `t_valid` / `t_invalid` for premium audit. Should local also store these (so the column is always there) and just expose them in cloud? Or different schemas?
5. **Entity store opt-out.** Mem0's entity store doubles storage cost. For a minimal local setup, the user might want to skip it. Configurable flag `entityBoost: false`?
6. **`THEOKIT_API_KEY` reuse vs `MEM0_API_KEY` separation.** Our README claims one key for the whole ecosystem. Implementation needs to confirm the cloud auth path is the same as `@usetheo/sdk`'s.

---

## 12. References

- **Mem0 TS SDK source:** `theo-memory/referencia/mem0/mem0-ts/src/oss/src/` (Apache-2.0)
- **Mem0 AGENTS.md:** `theo-memory/referencia/mem0/CLAUDE.md` (Apache-2.0) — read for repository-wide context
- **Landscape doc:** `theo-memory/docs/agentic-memory-landscape.md` (2026-05-16, internal)
- **TheMemory README:** `theo-memory/README.md` (this is the document this report updates the design of)
- **TheMemory positioning memory:** `/home/paulo/.claude/projects/-home-paulo-Projetos-usetheo-theo-memory/memory/themory_positioning.md`
- **TheMemory API contract memory:** `/home/paulo/.claude/projects/-home-paulo-Projetos-usetheo-theo-memory/memory/themory_api_contract.md`
- **Generative Agents:** Park et al. 2023, [arxiv 2304.03442](https://arxiv.org/abs/2304.03442)
- **MemGPT (Letta basis):** Packer et al. 2023, [arxiv 2310.08560](https://arxiv.org/abs/2310.08560)

---

**Next exploration recommendations:**
- **Letta** (`theo-memory/referencia/letta/`) — read for Postgres+pgvector schema + Alembic migration shape + the sleep-time agent pattern (relevant to our `reflect()` design).
- **LangMem** (`theo-memory/referencia/langmem/`) — read for the procedural memory implementation (prompt rewriting). Smallest of the three; least time investment.
