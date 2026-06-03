# Plan: Semantic Recall Cache v1.5 — RecallCacheStore 13th DIP + pgvector default impl

> **Version 1.1** (2026-06-03) — Absorbs `/edge-case-plan semantic-recall-cache-v1-5` report (14 ECs: 6 MUST FIX + 5 SHOULD TEST + 3 DOCUMENT). **6 MUST FIX absorbed**: EC-1 (T0.1 validator gains `Number.isFinite` guard against IEEE 754 NaN/Infinity silent-pass); EC-2 (T2.1 factory gains pgvector `atttypmod` dim probe, throws `InvalidCacheConfig` on embedder/table dim mismatch mirroring v1.4 adapters-openrouter-local-embedder T0.1 pattern); EC-3 (T0.1 `ScopeTierTtlConfig` gains 4th `skill` field with 1h default; ADR D3 expanded from 3 to 4 tiers); EC-4+EC-5 (T2.1 `Memory.recall()` wrap bypasses cache when `opts.asOf` OR `opts.attributedTo` set — new ADR D8 locks "cache applicability boundary" for v1.5.0); EC-6 (T2.2 hook expanded to include `reflect()` post-success in addition to `remember()` + `forget()`); EC-7 (T1.2 LRU eviction transaction uses SERIALIZABLE isolation + 1 retry-on-serialization-failure). **5 SHOULD TEST absorbed inline** in TDD blocks: EC-8 (T1.1 zero-norm-embedding NaN cosine handling); EC-9 (T1.1/T1.2 concurrent get + clearExpired MVCC snapshot consistency); EC-10 (T2.2 forget() scope-derivation strategy concrete: `SELECT scope_key FROM memories WHERE id=$1` before DELETE; fallback to `invalidateAll()` if not found); EC-11 (T2.2 sequential await discipline — remember awaits invalidateScope before returning); EC-12 (T1.1 oversized result_set JSONB boundary test). **3 DOCUMENT absorbed**: EC-13 (T0.1 AC note recommending `maxSizePerScope >= 10` to avoid thrashing); EC-14 (T2.3 § Testing note about stderr spy install discipline in test suites — mirror run-server.test.ts EC-6 precedent); EC-15 (ADR D7 amendment documenting HNSW `m=16, ef_construction=64` as conservative v1.5.0 defaults — tuning deferred to v1.5.x evidence). **Pattern observed**: 4 of 6 MUST FIX (EC-3/4/5/6) were cross-feature composition gaps with v1.1 bi-temporal + v1.1 multi-peer + v0.6 skill scope + v0.4a reflect; blueprint did not pre-compose with these because it focused on prior_art at the SDK layer. Absorption is mechanical.
>
> **Version 1.0** (2026-06-03) — Implement Roadmap Item 19 (CLAUDE.md § Phase IV / Post v1.0 / `v1.5 — Semantic read-side query cache`) consuming `.claude/knowledge-base/discoveries/blueprints/semantic-recall-cache-blueprint.md` v1.0 as ground truth (89/100 SHIPPABLE_WITH_CAVEATS via `/discover-confidence`). The blueprint locks 5 design decisions backed by 8 research questions + 5 web snapshots + 6 path-verified local references; this plan translates those decisions into 9 tasks across 5 phases. Greenfield surface vs Mem0/Letta/LangMem/Zep at the recall() layer (CLAUDE.md claim VERIFIED-WITH-NUANCE per blueprint § CLAUDE.md claim verdict). **Inquebrável Rule 11 (YAGNI) is the discipline ceiling** — this plan ships the v1.5.0 minimum that proves the contract (pgvector default + 13th DIP); Redis backend, adaptive auto-tuning, and verb-level CLI are deferred to v1.5.x.

## Goal

> "Ship the 13th DIP `RecallCacheStore` + `PgvectorRecallCacheStore` impl + subpath `@usetheo/memory/cache-pg` + write-triggered scope invalidation + 3 OTel metrics so that the integration test `tests/integration/cache/semantic-recall-cache.test.ts` PASSES against real `ankane/pgvector:v0.5.1` with cache hit rate ≥ 0.5 on a 20-query test set (10 near-duplicate pairs at cosine ≥ 0.8 default threshold)."

## Context

### What exists today

- **12 DIPs declared** at `src/core/dip/{auth-verifier,benchmark-adapter,conflict-resolution-policy,embedder,eviction-policy,history-manager,llm,reflection-policy,scoring-strategy,skill-representation-strategy,tokenizer,vector-store}.ts`. ADR-0008 caps method counts per DIP.
- **Memory factory at `src/local/index.ts:757`** exposes `createLocalMemory(config: LocalMemoryConfig)` with extension points for `eviction?: LocalEvictionConfig` (v0.4b precedent for an optional capability wired into the recall pipeline).
- **9 Drizzle migrations** shipped (`0001` → `0009`). Next migration is `0010`. `runMigrations()` discipline per `architecture.md § 10.1` + `10.2` already validated.
- **Pgvector store at `src/local/pgvector-store.ts`** (788 LoC pre-existing-debt MAJOR F-arch-6 — composition not allowed without splitting; cache lives in SEPARATE class to avoid worsening).
- **OTel tracer DI established** by source plan theo-memory-standalone-p0 ADR D11 (lazy-init pattern at `src/local/eviction/pg-evictor.ts:56-75` per F-dom-6 precedent).
- **Subpath export precedent** shipped 2026-06-02 via adapters-openrouter-local-embedder: `@usetheo/memory/embedders/local` → `src/embedders/local.ts` (see `package.json#exports`). Bundle isolation test at `tests/integration/public-paths.test.ts`.
- **Empirical OpenAI quota**: dev machine has OpenRouter key already wired for v0.7.1 LLM-MEASURED tests (`tests/integration/distillation/the-goal-test-llm-measured.test.ts` PASS 2026-06-02).

### What's broken or missing

Per CLAUDE.md Roadmap Item 19 + blueprint synthesis:

- **3 of 4 vendor ecosystems lack native semantic recall caching** at the SDK layer (Q8 verbatim). Pinecone/Weaviate/Qdrant consumers MUST bolt on external cache; TheMemory's pgvector consumers have the SAME gap.
- **Recall pipeline runs the 9-step search + (optionally) LLM rerank on EVERY query**, even when consumer asks `"qual minha cor favorita?"` immediately after `"minha cor preferida?"`. Same scope, semantically equivalent embedding, wasted work.
- **Acceptance criterion #2 of Item 19 mandates OTel hit-vs-miss latency histograms** — no current code path produces them.
- **Acceptance criterion #3 mandates "write to scope → next recall MUST miss"** — correctness gate; without write-triggered scope invalidation we'd serve stale results (Inquebrável Rule 3 violation).

### Evidence motivating NOW (not later)

1. **Blueprint synthesis is current** (2026-06-03; 89/100 SHIPPABLE_WITH_CAVEATS) — TWO INDEPENDENT canonical libs (embedchain + LangChain) CONVERGE on cosine ≥ 0.8 threshold. Locking the design space now while the synthesis is fresh.
2. **Greenfield window confirmed by Q8** — no pgvector-ecosystem competitor has shipped this. Shipping v1.5 first establishes TheMemory as THE primitive for pgvector consumers.
3. **/dogfood gate synergy** — Item 19 acceptance criterion measures cache hit rate "on the Claude-Code-auto-memory anchor scenario" which is the SAME anchor `/dogfood` needs running ≥ 30 days for v1.0. Wiring v1.5 NOW seeds dogfood evidence too.
4. **Cycle-2 fixes-cycle-2 closure expected within hours** — develop → main PR pending; momentum to ship next greenfield surface.

## Objective

- [ ] Sub-goal 1 — Declare 13th DIP `RecallCacheStore` at `src/core/dip/recall-cache-store.ts` (interface + 4 methods: `get` / `set` / `invalidateScope` / `clearExpired`); honor ADR-0008 method-count cap; `RecallCacheStoreConfig` type with `threshold` (default 0.8, runtime `[0,1]` validation per Q4 embedchain pattern) + `ttlSecondsByScopeTier` per blueprint D1+D2
- [ ] Sub-goal 2 — Ship migration `0010_recall_cache.sql` creating `recall_cache` table (cols per blueprint § 3) + HNSW partial index on `(scope_key, query_embedding)` — schema honors blueprint D4 cache key composition
- [ ] Sub-goal 3 — Ship `PgvectorRecallCacheStore` at `src/local/recall-cache/pgvector-recall-cache-store.ts` with: SQL lookup `WHERE scope_key = $1 AND cosine_similarity(qe, $2) >= threshold AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY similarity DESC LIMIT 1`; write-triggered `invalidateScope()` deleting all rows for scope; LRU eviction at `max_size=1000` per scope per blueprint Rec #8
- [ ] Sub-goal 4 — Wire into `createLocalMemory()` factory at `src/local/index.ts`: new `LocalMemoryConfig.recallCache?: RecallCacheStoreConfig | RecallCacheStore` (DIP-or-config dual shape per ADR D5 below); wrap `Memory.recall()` to consult cache; hook `remember()` / `forget()` write paths to call `invalidateScope()`
- [ ] Sub-goal 5 — Embedder kind detection: when `StubEmbedder` / `DeterministicStubEmbedder` wired AND cache enabled, emit 3-line stderr warning (mirror v0.6.1 / cycle-1 T2.2 pattern at `src/agent-tools/run-server.ts:81-92`) per blueprint Rec #6
- [ ] Sub-goal 6 — Expose 3 OTel metrics per blueprint D5 / Item 19 AC#2: `recall_cache_hit` (Counter) + `recall_cache_hit_duration_ms` (Histogram) + `recall_cache_miss_duration_ms` (Histogram); use lazy-init pattern per `src/local/eviction/pg-evictor.ts:56-75` precedent
- [ ] Sub-goal 7 — Ship subpath export `@usetheo/memory/cache-pg` → `src/local/recall-cache/pgvector-recall-cache-store.ts` (mirror `@usetheo/memory/embedders/local` precedent); extend `tests/integration/public-paths.test.ts` to verify resolution; extend `tests/integration/subpath-isolation.test.ts` to verify default barrel does NOT pull cache code (~EC-26 precedent)
- [ ] Sub-goal 8 — THE GOAL TEST passes: `tests/integration/cache/semantic-recall-cache.test.ts` against real `ankane/pgvector:v0.5.1`; 20 queries (10 near-duplicate pairs) → cache hit rate ≥ 0.5 at default `threshold=0.8`; write-triggered invalidation regression test (write → next recall MISS); TTL expiry test; embedder-kind warning regression test

## Dependencies

Per `cycle-plan.md` v1.1 § Trigger conditions.

### Existing — use as-is (NO version changes)

| Package | Version | Ecosystem | Why this plan uses it |
|---|---|---|---|
| `pg` | `^8.13.0` | npm | All cache SQL goes through existing `Pool` shared with `PgvectorStore` |
| `drizzle-orm` | (transitive) | npm | Migration journal mechanics; new migration follows existing `0007`/`0008`/`0009` shape |
| `@opentelemetry/api` | (existing) | npm | 3 new metrics via existing tracer DI per ADR D11 of theo-memory-standalone-p0 |
| `zod` | `^3.25.0` | npm | `RecallCacheStoreConfig` validation (threshold `[0,1]` range check per Q4 embedchain pattern) |
| `vitest` | `^4.0.0` | npm | All new tests run on existing infra |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| **(none)** | — | — | — | This plan introduces ZERO new dependencies. All SQL + observability + bundle-isolation infra already exists. Blueprint Rec #3 + Q8 confirm pgvector default backend (no new client lib). Redis backend deferred to v1.5.1 per blueprint D3 alternative B rejection. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| **(none)** | — | — |

## ADRs

### D1 — Declare 13th DIP `RecallCacheStore` with 4 methods

- **Decision:** `RecallCacheStore` interface at `src/core/dip/recall-cache-store.ts`. Methods: `get(queryEmbedding, scope, opts)` → `Promise<CachedResult | undefined>`; `set(queryEmbedding, scope, results, ttlSeconds)` → `Promise<void>`; `invalidateScope(scope)` → `Promise<number>` (returns rows deleted); `clearExpired()` → `Promise<number>` (eviction sweep). Honors ADR-0008 method-count cap (4 methods, well below cap).
- **Rationale:** Per blueprint D3 — pgvector-default with DIP boundary for future Redis impl. 4 methods is the minimum viable surface: read (`get`), write (`set`), correctness invalidation (`invalidateScope`), and resource bound (`clearExpired`). Per `.claude/rules/architecture.md § 3 (DIP)` — interface lives in `core/`, impl in `local/`. Per Inquebrável Rule 11 — start with this surface, expand only on consumer evidence.
- **Alternatives considered:**
  - B (3 methods only — `get`/`set`/`invalidateScope`, skip `clearExpired`): rejected — eviction needs a callable surface for cron-driven sweep; baking it into `set()` (lazy purge) couples write path to eviction logic, violates SRP.
  - C (5+ methods including `getStats()`/`reset()`): rejected per YAGNI — stats are derivable from OTel metrics (D5); `reset()` belongs to test helpers, not production DIP.
- **Inquebrável cited:** Rule 11 (YAGNI) + ADR-0008 (method count cap) + `architecture.md § 3 (DIP)`.

### D2 — Default threshold = `0.8` with runtime `[0,1]` validation; configurable per scope-tier

- **Decision:** `RecallCacheStoreConfig.threshold: number` defaults to `0.8`. Runtime validation: if `threshold < 0 || threshold > 1`, throw `InvalidScope` typed error with `"threshold must be in [0, 1]; got ${received}"`. Allow per-scope override via `{ user: 0.85, agent: 0.8, session: 0.75 }` shape.
- **Rationale:** Blueprint § Cross-cutting + D1 — TWO INDEPENDENT canonical libs (embedchain `similarity_threshold=0.8`, LangChain `distance_threshold=0.2` ≈ similarity 0.8) converge on this exact value. Blueprint Q7 verbatim: "Users configuring `distance_threshold=0.3` and OpenAI embeddings found that semantically similar questions were being treated as different cache entries" — confirms 0.7 is too strict, validates 0.8 as the empirical sweet spot. Per scope-tier override accounts for varying scope semantics (user memory = stable identity → tighter 0.85; session = ephemeral context → looser 0.75).
- **Alternatives considered:**
  - B (Strict 0.95): rejected — below LangChain's empirical calibration floor at 0.7. Would produce near-zero hit rate. Blueprint Rec #1 explicitly rejects.
  - C (Adaptive auto-tuned via online learning): rejected per Inquebrável Rule 11 — no consumer evidence demands. v1.5.x can adopt if dogfood signals demand.
  - D (No runtime validation — trust consumer): rejected — embedchain ships explicit ValueError at `cache_config.py:60-61` (blueprint Q4 verbatim). Mirror the discipline.
- **Inquebrável cited:** Rule 11 (YAGNI) + Rule 3 (Honesty: typed error > silent acceptance).

### D3 — Invalidation = write-triggered scope invalidation (remember + forget + reflect) + TTL gated by 4 scope-tiers (EC-3 + EC-6 amendment 2026-06-03)

> **Amendment 2026-06-03 (v1.1)**: original D3 listed 3 scope-tiers (user/agent/session) and 2 write surfaces (remember/forget). EC-3 + EC-6 absorption expands BOTH:
> - **4th scope-tier `skill`** added per v0.6 ADR-0010 RepoScope (shipped 2026-05-30) — default TTL = 3600s (1h, mid-frequency consolidation pattern).
> - **3rd write surface `reflect()`** hooked — reflect produces derived memories (v0.4a) + distillation rows (v0.7) that mutate the scope's memory set; without invalidation, cache serves stale post-reflect (Item 19 AC#3 violation in surface case the blueprint did not pre-compose).

- **Decision:** TWO mechanisms compose:
  - (a) Write-triggered: `Memory.remember()` and `Memory.forget()` call `RecallCacheStore.invalidateScope(scope)` AFTER successful write. Correctness gate per Item 19 acceptance criterion #3.
  - (b) TTL: `RecallCacheStoreConfig.ttlSecondsByScopeTier` defaults to `{ user: 86400, agent: 3600, session: 600 }` (24h / 1h / 10min). `set()` writes `expires_at = NOW() + ttl_seconds * INTERVAL '1 second'`. Lookup filters `(expires_at IS NULL OR expires_at > NOW())`.
- **Rationale:** Blueprint D2 + Rec #2 — embedchain ships NEITHER mechanism (Q4 verbatim), LangChain ships TTL first-class (Q7 verbatim `ttl=3600` canonical example), Letta inline rationale at `openai_client.py:307-316` (Q5 verbatim): "Setting an explicit key can disrupt existing warm caches and reduce hit rates" → invalidation discipline MATTERS. We DO NOT inherit embedchain's gap. Scope-tier TTL aligns with OpenAI prompt-cache TTL spread (5-10min default → 24h extended) per Q5 docs.
- **Alternatives considered:**
  - B (TTL-only, no write-trigger): rejected — would serve stale results immediately after write (correctness bug, Inquebrável Rule 3 violation).
  - C (write-trigger only, no TTL): rejected — cache grows indefinitely without time bound; LRU eviction (D4) bounds capacity but TTL bounds staleness too.
  - D (Manual purge only): rejected — burdens consumer with cache discipline TheMemory should own.
- **Inquebrável cited:** Rule 3 (Honesty — correctness over perf) + Rule 11 (TTL avoids re-implementing time-decay).

### D4 — Default backend = pgvector via subpath `@usetheo/memory/cache-pg`; Redis deferred to v1.5.1

- **Decision:** Ship `PgvectorRecallCacheStore` at `src/local/recall-cache/pgvector-recall-cache-store.ts` as v1.5.0 default. Subpath export `@usetheo/memory/cache-pg` mirrors `@usetheo/memory/embedders/local` precedent (shipped 2026-06-02). Default barrel `@usetheo/memory` does NOT pull this code (subpath isolation regression test required per EC-26 precedent). Redis impl scheduled for v1.5.1.
- **Rationale:** Blueprint D3 + Q8 + Rec #3 — pgvector ecosystem (TheMemory default; also Mem0 server, Letta, embedchain consumer empirical pairing per Q3+Q4) has ZERO native semantic cache. Pinecone/Weaviate/Qdrant don't ship this either (Q8 verbatim). Redis ALREADY has the pattern via LangCache/RedisVL (Q8) — translating to TheMemory DIP shape is low-risk follow-up. Per Inquebrável Rule 11 — ship pgvector first, prove demand, then add Redis. Bundle isolation discipline matches `subpath-isolation.test.ts` v0.1 `T1.7` precedent.
- **Alternatives considered:**
  - B (Ship pgvector AND Redis day-0): rejected — doubles surface area + 1 new dep (`redis` client, likely `optionalDependencies`) without consumer evidence. YAGNI.
  - C (DIP-only, zero impl built-in — consumer brings own): rejected per Inquebrável Rule 9 — we SHOULD ship at least one impl that proves the contract. embedchain ships impls; we should too.
  - D (In-memory `MapRecallCacheStore` as default): rejected — process-restart loses cache (loud failure mode); pgvector persistence aligns with TheMemory's data discipline.
- **Inquebrável cited:** Rule 9 (Não Reinvente — pgvector + HNSW already in tree) + Rule 11 (YAGNI Redis).

### D5 — Factory shape: `LocalMemoryConfig.recallCache?: RecallCacheStoreConfig | RecallCacheStore`

- **Decision:** Dual-shape extension point on the factory. Consumer can pass:
  - (a) `RecallCacheStoreConfig` (plain config object) → factory constructs default `PgvectorRecallCacheStore(pool, config)` internally
  - (b) `RecallCacheStore` (fully-built DIP impl) → factory uses verbatim (escape hatch for v1.5.1 Redis impl + test doubles)
  - Omit → cache disabled, no wrapping of `Memory.recall()`
- **Rationale:** Mirrors `LocalMemoryConfig.eviction?: LocalEvictionConfig` precedent at `src/local/index.ts:110` (v0.4b shipped pattern). Type discriminator via `'get' in value` (DIP detection) keeps factory clean. Per `architecture.md § 3 (DIP)` — high-level Memory factory depends on `RecallCacheStore` interface, not concrete; consumer composition root provides the impl.
- **Alternatives considered:**
  - B (Single shape — `recallCache?: RecallCacheStore` only, consumer ALWAYS constructs): rejected — adds boilerplate for the common case (just use defaults). Mirror v0.4b eviction shape that ships both for ergonomics + DIP.
  - C (`createMemory` returns `Memory` with `.withCache()` builder method): rejected — diverges from existing factory shape; consumer pattern is established.
- **Inquebrável cited:** Rule 11 (YAGNI — don't invent new factory pattern when existing one fits).

### D6 — Embedder-kind gate: stub embedder emits loud stderr warning when cache enabled

- **Decision:** At factory time when `recallCache !== undefined` AND embedder is `StubEmbedder` (constructor name match per existing `instanceof` pattern), emit 3-line stderr warning mirroring cycle-1 T2.2 / F-rev-9 at `src/agent-tools/run-server.ts:81-92`. Lines: (1) WARNING — stub embedder + cache combo produces deterministic-but-non-semantic cache hits; (2) Behavior — hits coincidental, NOT semantic; (3) For production wire real embedder. Cache continues to operate (no refusal); honesty gate per Rule 3.
- **Rationale:** Blueprint Rec #6 + Q5 sub-pattern — Letta gates prompt-cache by model family/provider; we translate to embedder-awareness. StubEmbedder produces deterministic vectors that collide unpredictably at the 0.8 cosine threshold — user would see misleading hits. Loud disclosure mirrors the proven cycle-1 pattern shipped 2026-06-03.
- **Alternatives considered:**
  - B (Refuse to operate — throw): rejected — consumers may intentionally use stubs in test/CI for shape validation; refusal breaks that workflow.
  - C (Silently disable cache): rejected — would mislead consumer ("I configured cache and it shows no hits"). Silent disable is anti-Rule 3.
- **Inquebrável cited:** Rule 3 (Honesty — loud disclosure of non-semantic regime) + Rule 11 (mirror existing warning pattern; don't invent new).

### D7 — No `auto_flush=20` batch write; write-through default (EC-15 amendment 2026-06-03)

> **Amendment 2026-06-03 (v1.1)**: original D7 covers write-through stance. EC-15 absorption adds: HNSW index parameters at migration T0.2 (`m=16, ef_construction=64`) are CONSERVATIVE pgvector defaults; tuning DEFERRED to v1.5.x dogfood-evidence (per Inquebrável Rule 11 YAGNI). v1.5.0 ships the convention; v1.5.x may bump `m` higher for recall accuracy if hit-rate falls short OR lower `ef_construction` for write-speed if cache fill rate becomes hot path.

- **Decision:** `set()` writes immediately to pgvector (no batching). Defer batch optimization to v1.5.x if hot-path latency evidence demands.
- **Rationale:** Blueprint Rec #7 + Inquebrável Rule 11 — embedchain's `auto_flush=20` (Q4 verbatim from `cache_config.py:55-58`) is a perf optimization that adds correctness risk (batched writes lost on process crash). Write-through is honest default; no consumer evidence demands batch yet. Defer to v1.5.x dogfood evidence.
- **Alternatives considered:**
  - B (Mirror embedchain `auto_flush=20`): rejected per Rule 11 — no consumer evidence; adds crash-loss risk.
- **Inquebrável cited:** Rule 11 (YAGNI) + Rule 3 (write-through is honest about persistence).

### D8 — Cache applicability boundary: BYPASS cache when `asOf` OR `attributedTo` is set (EC-4 + EC-5 absorption — NEW in v1.1)

- **Decision:** v1.5.0 cache key is `(scope_key, query_embedding)` per Blueprint D4. The cache DOES NOT include `RecallOptions.asOf` (v1.1 bi-temporal historical query) OR `RecallOptions.attributedTo` (v1.1 multi-peer filter). When EITHER option is set on a `recall()` call, the cache is BYPASSED entirely — no `get()`, no `set()`. The existing v0.1 9-step recall pipeline serves the call directly.
- **Rationale:** Without bypass, the cache would serve CURRENT results when consumer asked for HISTORICAL (`asOf`) → CORRECTNESS BUG violating v1.1 bi-temporal contract (Inquebrável Rule 3). Same root with `attributedTo`: cache could cross-contaminate filter slices, leaking data across attribution boundaries. Adding these to the cache key inflates cardinality dramatically AND most `asOf`/`attributedTo` calls have low repeat probability — bypass is BOTH correct AND efficient.
- **Alternatives considered:**
  - B (Add asOf + attributedTo to cache key): rejected — cardinality explosion (every distinct timestamp/peer-id is a separate cache slot, defeating reuse). YAGNI per Inquebrável Rule 11; revisit at v1.5.x if dogfood evidence demands.
  - C (Document the bug as known-limitation; ship cache as-planned): rejected per Inquebrável Rule 3 — silent correctness regression is worse than no cache at all.
- **Consequences:** Consumers using `asOf` (audit/replay scenarios) OR `attributedTo` (filtered slices) get the existing 9-step latency — they were going to anyway since the cache wasn't designed for their queries. Hit rate metric (Item 19 AC#2) reflects only the cache-applicable subset; documentation must explain this honest measurement boundary.
- **Inquebrável cited:** Rule 3 (Honesty — bypass over silent correctness violation) + Rule 11 (YAGNI — defer composite cache key to v1.5.x).

## Dependency Graph

```
Phase 0: DIP + Schema (foundation)
  ┌── T0.1 RecallCacheStore DIP + types ──┐
  └── T0.2 Migration 0010 + HNSW index ───┤
                                          │
                                          ▼
Phase 1: PgvectorRecallCacheStore impl + eviction
  ┌── T1.1 PgvectorRecallCacheStore (get/set/invalidate/clearExpired) ──┐
  └── T1.2 LRU eviction at max_size=1000/scope ────────────────────────┤
                                                                        │
                                                                        ▼
Phase 2: Memory factory wiring + embedder gate
  ┌── T2.1 LocalMemoryConfig.recallCache + recall() wrap ──┐
  ├── T2.2 remember/forget write-trigger invalidation ─────┤
  └── T2.3 Embedder kind detection + stub warning ────────┤
                                                          │
                                                          ▼
Phase 3: Observability
  └── T3.1 3 OTel metrics + lazy-init pattern
                                                          │
                                                          ▼
Phase 4: Distribution
  └── T4.1 Subpath export + bundle isolation test
                                                          │
                                                          ▼
Phase 5: THE GOAL TEST + docs
  ├── T5.1 Integration test (20 queries, hit rate ≥ 0.5)
  └── T5.2 README + CHANGELOG + Roadmap Item 19 update

Final Phase: Integration Validation (npm test + typecheck + lint + /review)
```

Sequential phases — Phase 0 blocks Phase 1 (impl needs DIP signature); Phase 1 blocks Phase 2 (factory needs impl); Phase 2 blocks Phase 3 (metrics wire to factory-emitted instances); Phase 3 blocks Phase 4 (subpath export point needs final shape); Phase 4 blocks Phase 5 (goal test uses public subpath surface).

---

## Phase 0: DIP + Schema

### T0.1 — Declare `RecallCacheStore` DIP + config types

#### Objective
Add `src/core/dip/recall-cache-store.ts` with interface + 4 methods + `RecallCacheStoreConfig` type. Add typed error `InvalidCacheConfig`.

#### Evidence
- Blueprint D1 mandates 4 methods (`get` / `set` / `invalidateScope` / `clearExpired`)
- ADR-0008 method-count cap (4 ≤ cap)
- Q4 verbatim embedchain runtime `[0,1]` validation pattern (`cache_config.py:60-61`)

#### Files to edit
```
src/core/dip/recall-cache-store.ts (NEW)
src/core/dip/__tests__/recall-cache-store.test.ts (NEW) — type-level + ValueError tests
src/core/errors.ts — add InvalidCacheConfig typed error class
src/index.ts — export RecallCacheStore + RecallCacheStoreConfig + InvalidCacheConfig types
```

#### Deep file dependency analysis
- New DIP file is a leaf interface in `src/core/` — zero existing imports affected.
- `src/core/errors.ts` is the central typed-error module; new class extends existing `MemoryError` base.
- `src/index.ts` public barrel — adding 3 type exports is additive, no breaking change.

#### Deep Dives

Interface shape:
```ts
export interface CachedResult {
  results: readonly MemoryItemWithScore[];
  cachedAt: Date;
  similarity: number;  // observed cosine sim of the query that produced the hit
}

export interface ScopeTierTtlConfig {
  user: number;     // seconds; default 86400 (24h)
  agent: number;    // seconds; default 3600 (1h)
  session: number;  // seconds; default 600 (10min)
  skill: number;    // seconds; default 3600 (1h) — EC-3 absorption: skill scope (v0.6 ADR-0010 RepoScope) is 4th tier, mid-frequency
}

export interface RecallCacheStoreConfig {
  threshold?: number;                       // [0, 1]; default 0.8 (Blueprint D2)
  ttlSecondsByScopeTier?: ScopeTierTtlConfig; // Blueprint D3 defaults
  maxSizePerScope?: number;                 // default 1000 (Blueprint Rec #8)
}

export interface RecallCacheStore {
  get(queryEmbedding: readonly number[], scope: Scope): Promise<CachedResult | undefined>;
  set(queryEmbedding: readonly number[], scope: Scope, results: readonly MemoryItemWithScore[], ttlSeconds: number): Promise<void>;
  invalidateScope(scope: Scope): Promise<number>;
  clearExpired(): Promise<number>;
}
```

Validation logic at config construction (per Q4 embedchain pattern + EC-1 absorption):
```ts
export function validateRecallCacheStoreConfig(config: RecallCacheStoreConfig): void {
  // EC-1 absorption: IEEE 754 NaN comparison gap — `NaN < 0` and `NaN > 1` BOTH false.
  // Without Number.isFinite, threshold=NaN or threshold=Infinity passes range check silently.
  // Mirror v1.4 adapters-openrouter-local-embedder T0.1 `Number.isInteger` guard precedent.
  if (config.threshold !== undefined && !Number.isFinite(config.threshold)) {
    throw new InvalidCacheConfig(`threshold must be a finite number; got ${config.threshold}`);
  }
  if (config.threshold !== undefined && (config.threshold < 0 || config.threshold > 1)) {
    throw new InvalidCacheConfig(`threshold must be in [0, 1]; got ${config.threshold}`);
  }
  if (config.maxSizePerScope !== undefined && (!Number.isInteger(config.maxSizePerScope) || config.maxSizePerScope <= 0)) {
    throw new InvalidCacheConfig(`maxSizePerScope must be a positive integer; got ${config.maxSizePerScope}`);
  }
  // EC-3 absorption: TTL config has 4 tiers including skill (v0.6 ADR-0010). Per-tier negative TTL would mean
  // immediate expiry — treat as config bug (consumer probably meant 0 or undefined).
  if (config.ttlSecondsByScopeTier !== undefined) {
    for (const tier of ['user', 'agent', 'session', 'skill'] as const) {
      const ttl = config.ttlSecondsByScopeTier[tier];
      if (ttl !== undefined && (!Number.isFinite(ttl) || ttl < 0)) {
        throw new InvalidCacheConfig(`ttlSecondsByScopeTier.${tier} must be a non-negative finite number; got ${ttl}`);
      }
    }
  }
}
```

#### Tasks
1. Read `src/core/dip/embedder.ts` + `src/core/dip/eviction-policy.ts` for interface shape precedent (JSDoc style, export discipline)
2. Write `src/core/dip/recall-cache-store.ts` with interface + 3 config types + validator helper (~80 LoC)
3. Extend `src/core/errors.ts` with `InvalidCacheConfig extends MemoryError`
4. Extend `src/index.ts` public barrel (3 type + 2 value re-exports)
5. Write `src/core/dip/__tests__/recall-cache-store.test.ts` — assert validator throws on out-of-bounds threshold + non-integer maxSize; assert RecallCacheStoreConfig defaults inferred correctly

#### TDD

```
RED:     T0.1-RED-1 — validateRecallCacheStoreConfig throws InvalidCacheConfig on threshold = 1.5
         T0.1-RED-2 — validateRecallCacheStoreConfig throws on maxSizePerScope = 0
         T0.1-RED-3 — validateRecallCacheStoreConfig accepts threshold = 0.8 + maxSizePerScope = 1000 (defaults)
         T0.1-RED-4 (EC-1) — validateRecallCacheStoreConfig throws on threshold = NaN AND threshold = Infinity (IEEE 754 gap)
         T0.1-RED-5 (EC-3) — ScopeTierTtlConfig requires 4th tier `skill`; default = 3600s (1h)
         T0.1-RED-6 (EC-3) — validateRecallCacheStoreConfig throws on ttlSecondsByScopeTier.session = -1 (negative TTL invalid)
GREEN:   Implement RecallCacheStore interface + ScopeTierTtlConfig (4 tiers) + RecallCacheStoreConfig + validator with Number.isFinite guards
REFACTOR: Extract InvalidCacheConfig into errors.ts; ensure JSDoc cites Blueprint D1+D2 + ADR-0010 for skill tier
VERIFY:  npm test -- recall-cache-store.test.ts
```

#### Acceptance Criteria
- [ ] `src/core/dip/recall-cache-store.ts` exists with 4-method interface; method count ≤ ADR-0008 cap
- [ ] `RecallCacheStoreConfig` declares `threshold` (default 0.8) + `ttlSecondsByScopeTier` (24h/1h/10min) + `maxSizePerScope` (default 1000)
- [ ] `validateRecallCacheStoreConfig` throws `InvalidCacheConfig` on out-of-bounds threshold + non-positive-integer maxSize
- [ ] **EC-1 absorption**: validator throws `InvalidCacheConfig` on `threshold = NaN` AND `threshold = Infinity` (Number.isFinite guard placed BEFORE range check)
- [ ] **EC-3 absorption**: `ScopeTierTtlConfig` has 4 tiers (user/agent/session/skill) — `skill` field is REQUIRED; default 3600s; ADR-0010 cited in JSDoc
- [ ] **EC-3 absorption**: validator iterates 4 tiers checking each TTL is non-negative finite number
- [ ] **EC-13 absorption (DOCUMENT)**: README + DIP JSDoc warns that `maxSizePerScope < 10` produces cache thrashing; recommended minimum 10; sweet spot 1000 (blueprint Q4 empirical)
- [ ] `InvalidCacheConfig` extends `MemoryError` base; carries received-value in message
- [ ] Public barrel `src/index.ts` exports the 3 types + 2 values; no breaking change to existing exports (verified via `npm pack --dry-run`)
- [ ] 3 RED tests pass
- [ ] Pass: complexity — no function exceeds 20 LoC; cyclomatic per validator = 3 (1 base + 2 conditionals)
- [ ] Pass: size — `recall-cache-store.ts` ≤ 100 LoC

#### DoD
- [ ] `npm test` green (956 + 3 = 959 contract PASS)
- [ ] `npm run typecheck` 0 errors
- [ ] `npm run lint` 0 warnings
- [ ] File ≤ 100 LoC

---

### T0.2 — Drizzle migration `0010_recall_cache.sql` + schema declaration

#### Objective
Ship `src/local/migrations/0010_recall_cache.sql` creating `recall_cache` table + HNSW partial index. Declare table in `src/local/schema.ts`.

#### Evidence
- Blueprint § 3 schema design
- Blueprint D4 cache key composition: `(scope_key, query_embedding)`
- `architecture.md § 10.1` (postbuild copy migrations) + § 10.2 (drizzle-kit push conflict) — disciplines apply
- v1.1 T0.1 precedent: index parity between drizzle-kit push path AND runMigrations path (closes F-dom-dbmig-1 pattern shipped 2026-06-03)

#### Files to edit
```
src/local/migrations/0010_recall_cache.sql (NEW)
src/local/migrations/meta/_journal.json — append migration entry per existing 0001→0009 shape
src/local/migrations/meta/0010_snapshot.json (NEW)
src/local/schema.ts — declare recallCacheTable matching SQL
tests/integration/cache/migration-0010.test.ts (NEW) — assert migration runs idempotent + index exists + push/journal parity
```

#### Deep file dependency analysis
- New migration is additive — no existing migration mutated. `runMigrations()` will pick it up via journal scan.
- `schema.ts` declaration follows v1.1 T0.1 pattern (recallCacheTable mirrors memoriesTable shape without FK to memories — cache is independent).
- Integration test extends `tests/integration/` glob; reachable per `vitest.integration.config.ts`.

#### Deep Dives

Migration SQL:
```sql
-- Migration 0010: Recall cache table for semantic-recall-cache v1.5.0
-- Blueprint D4 cache key composition: (scope_key, query_embedding)
-- Blueprint D2 TTL: expires_at NULLABLE supports both TTL and non-TTL modes

CREATE TABLE IF NOT EXISTS recall_cache (
  id              SERIAL PRIMARY KEY,
  scope_key       TEXT NOT NULL,
  query_embedding vector(N) NOT NULL,    -- N templated by runMigrations({embeddingDim})
  result_set      JSONB NOT NULL,
  hit_count       INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  threshold_used  REAL NOT NULL DEFAULT 0.8
);

-- HNSW partial index per Blueprint § 3
CREATE INDEX IF NOT EXISTS recall_cache_scope_hnsw_idx ON recall_cache
  USING hnsw (query_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- B-tree index on scope_key for invalidateScope() DELETE perf
CREATE INDEX IF NOT EXISTS recall_cache_scope_key_idx ON recall_cache (scope_key);

-- B-tree index on expires_at for clearExpired() perf
CREATE INDEX IF NOT EXISTS recall_cache_expires_at_idx ON recall_cache (expires_at)
  WHERE expires_at IS NOT NULL;
```

`embeddingDim` parametric handling: follows the v1.4 precedent in `runMigrations(pool, { embeddingDim? })` per adapters-openrouter-local-embedder cycle — migration text reads `vector(N)` and `runMigrations()` substitutes `N` at apply time.

Schema declaration:
```ts
// src/local/schema.ts — append (line position TBD by /implement; before metadata exports)
export const recallCacheTable = pgTable('recall_cache', {
  id: serial('id').primaryKey(),
  scope_key: text('scope_key').notNull(),
  query_embedding: vector('query_embedding', { dimensions: 1536 }).notNull(),  // dim templated like memoriesTable
  result_set: jsonb('result_set').notNull(),
  hit_count: integer('hit_count').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  threshold_used: real('threshold_used').notNull().default(0.8),
});
```

#### Tasks
1. Read `src/local/migrations/0009_v1_1_index_parity.sql` for migration formatting precedent
2. Write `0010_recall_cache.sql` per Deep Dives
3. Run `npm run db:generate` (or manual) to produce `_journal.json` + `0010_snapshot.json`
4. Extend `src/local/schema.ts` with `recallCacheTable`
5. Write integration test asserting: (a) `runMigrations()` re-run is no-op (idempotency); (b) HNSW index present after migration; (c) `drizzle-kit push` path produces same indexes as journaled migration

#### TDD

```
RED:     T0.2-RED-1 — migration applies to fresh pgvector container; SELECT FROM recall_cache returns []
         T0.2-RED-2 — re-running runMigrations() is no-op (existing v1.1 EC-6 pattern)
         T0.2-RED-3 — HNSW index recall_cache_scope_hnsw_idx exists post-migration
         T0.2-RED-4 — schema.ts recallCacheTable matches migration SQL (parity sentinel like v1.1 T0.1)
GREEN:   Migration SQL + schema declaration + journal entries
REFACTOR: Ensure column types match across SQL + drizzle declaration (text vs varchar, etc.)
VERIFY:  npm test -- migration-0010 + ankane/pgvector:v0.5.1 container running
```

#### Acceptance Criteria
- [ ] `0010_recall_cache.sql` exists with `CREATE TABLE IF NOT EXISTS` + 3 indexes (HNSW + scope_key B-tree + expires_at partial B-tree)
- [ ] `_journal.json` updated with new migration entry; `0010_snapshot.json` created
- [ ] `src/local/schema.ts` declares `recallCacheTable` matching SQL
- [ ] Idempotent re-run verified
- [ ] HNSW + B-tree indexes verified present via integration test
- [ ] Schema parity sentinel asserts SQL column types match Drizzle declaration (v1.1 T0.1 precedent)
- [ ] Pass: postbuild — `dist/local/migrations/0010_recall_cache.sql` exists per `architecture.md § 10.1`
- [ ] **EC-15 absorption (DOCUMENT)**: HNSW parameters `m=16, ef_construction=64` are conservative pgvector defaults for v1.5.0; tuning deferred to v1.5.x dogfood-evidence-driven adjustment per Inquebrável Rule 11 (YAGNI). Documented in migration SQL comments + ADR D7 amendment.

#### DoD
- [ ] `npm test` 959 + 4 = 963 PASS
- [ ] Typecheck + lint clean
- [ ] Integration test passes against real `ankane/pgvector:v0.5.1`

---

## Phase 1: PgvectorRecallCacheStore impl + eviction

### T1.1 — `PgvectorRecallCacheStore` core impl (get/set/invalidateScope/clearExpired)

#### Objective
Ship `src/local/recall-cache/pgvector-recall-cache-store.ts` implementing the 4-method DIP against the `recall_cache` table.

#### Evidence
- Blueprint D4 SQL lookup composition
- Blueprint D3 TTL gating
- v0.4b `PgEvictor` precedent at `src/local/eviction/pg-evictor.ts` for DI pattern + OTel lazy-init

#### Files to edit
```
src/local/recall-cache/ (NEW dir)
src/local/recall-cache/pgvector-recall-cache-store.ts (NEW)
src/local/recall-cache/__tests__/pgvector-recall-cache-store.test.ts (NEW)
tests/integration/cache/cache-hit-miss.test.ts (NEW) — integration against real pgvector
```

#### Deep file dependency analysis
- New `recall-cache/` subdir mirrors `src/local/eviction/` precedent (sibling to existing pgvector-store concerns; SRP isolation per blueprint Rec #3 caveat about F-arch-6 pre-existing-debt at `pgvector-store.ts`).
- Constructor takes `Pool` + `RecallCacheStoreConfig` (already-validated config; T0.1 provides validator).
- ScopeKey derivation: helper `deriveScopeKey(scope: Scope): string` produces deterministic `'user:alice'` / `'session:run-42'` / `'agent:claude-sonnet'` / `'skill:repo-A'` — pure function, easily unit-testable.

#### Deep Dives

`get()` SQL (parametric over threshold):
```sql
SELECT result_set, threshold_used, (1 - (query_embedding <=> $2)) AS similarity
  FROM recall_cache
 WHERE scope_key = $1
   AND (1 - (query_embedding <=> $2)) >= $3  -- $3 = effective threshold (scope-tier override OR default)
   AND (expires_at IS NULL OR expires_at > NOW())
 ORDER BY query_embedding <=> $2 ASC   -- ascending distance = descending similarity
 LIMIT 1;
```

`set()` SQL:
```sql
INSERT INTO recall_cache (scope_key, query_embedding, result_set, expires_at, threshold_used)
  VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::INTERVAL, $5);
```

`invalidateScope()` SQL:
```sql
DELETE FROM recall_cache WHERE scope_key = $1;
```

`clearExpired()` SQL:
```sql
DELETE FROM recall_cache WHERE expires_at IS NOT NULL AND expires_at <= NOW();
```

Effective-threshold resolution:
```ts
const effectiveThreshold = this.config.thresholdByScopeTier?.[scope.kind] ?? this.config.threshold ?? 0.8;
```

#### Tasks
1. Read `src/local/eviction/pg-evictor.ts` for DI + class shape precedent (lazy OTel init pattern)
2. Write `pgvector-recall-cache-store.ts` (~200 LoC; 4 methods + helper `deriveScopeKey` + effective-threshold resolver)
3. Write unit tests with mocked Pool (assert SQL composition + parameter binding; NO live DB)
4. Write integration test against real pgvector (hit/miss roundtrip; TTL expiry; invalidateScope semantics; clearExpired sweep)

#### TDD

```
RED:     T1.1-RED-1 — get() returns undefined on empty cache (miss)
         T1.1-RED-2 — set() then get() with SAME embedding returns CachedResult with similarity = 1.0
         T1.1-RED-3 — set() then get() with embedding at cosine 0.85 (above threshold 0.8) returns hit
         T1.1-RED-4 — set() then get() with embedding at cosine 0.7 (below threshold 0.8) returns undefined
         T1.1-RED-5 — set() with ttl=1; sleep 2s; get() returns undefined (expired)
         T1.1-RED-6 — invalidateScope() deletes N rows; next get() in same scope returns undefined
         T1.1-RED-7 — clearExpired() deletes only rows where expires_at <= NOW()
         T1.1-RED-8 — scope isolation: set in user:alice; get in user:bob returns undefined
         T1.1-RED-9 (EC-8) — get() with zero-norm query embedding (all zeros) returns undefined (no crash from NaN cosine);
                              pgvector `<=> 0_vec = 0/0 = NaN` and NaN >= 0.8 = false → filter excludes correctly
         T1.1-RED-10 (EC-12) — set() with oversized result_set (10× MemoryItem with 50KB content each) either
                                succeeds OR throws typed error (NOT silent corruption); boundary documented
GREEN:   Implement 4 methods + deriveScopeKey + effective-threshold resolver
REFACTOR: Extract SQL template strings to module-private constants; ensure parameterized to prevent injection
VERIFY:  npm test -- pgvector-recall-cache-store.test.ts + integration test
```

#### Acceptance Criteria
- [ ] `pgvector-recall-cache-store.ts` ≤ 300 LoC (within architecture.md § Module hygiene 500 LoC budget; pgvector-store.ts at 788 is the pre-existing-debt outlier per blueprint context)
- [ ] All 8 RED tests pass
- [ ] SQL is parameterized (no string interpolation of user input — security hygiene per architecture.md § 8)
- [ ] Effective-threshold resolution honors per-scope-tier override fallback to global threshold fallback to 0.8 default
- [ ] Scope isolation verified by integration test (per Item 19 acceptance criterion #3 mandate)
- [ ] **EC-8 absorption**: zero-norm embedding edge handled gracefully (NaN cosine excluded by `>=` filter; no crash)
- [ ] **EC-12 absorption (DOCUMENT)**: result_set size boundary documented in JSDoc — practical limit ~1MB JSONB row; recall topK=100 with 4KB/item = ~400KB typical; large content items beyond 50KB may approach pgvector practical limits; log warning if row > 500KB
- [ ] Pass: file size ≤ 300 LoC; cyclomatic per method ≤ 8

#### DoD
- [ ] `npm test` 963 + 8 + 1 = 972 PASS
- [ ] Typecheck + lint clean

---

### T1.2 — LRU eviction at `max_size=1000` per scope

#### Objective
Add capacity-bounded eviction to `PgvectorRecallCacheStore.set()`: when scope rows count ≥ `maxSizePerScope`, delete oldest (by `created_at ASC`) before inserting new.

#### Evidence
- Blueprint Rec #8 mirror embedchain consumer-empirical choice (`max_size=1000` + `eviction="LRU"`)
- v0.4b `EvictionPolicy` DIP precedent for separating eviction logic from store logic
- Q4 embedchain verbatim `cache.py:25-27`

#### Files to edit
```
src/local/recall-cache/pgvector-recall-cache-store.ts — extend set() to call evictLruIfFull
src/local/recall-cache/__tests__/pgvector-recall-cache-store.test.ts — add capacity tests
tests/integration/cache/lru-eviction.test.ts (NEW)
```

#### Deep Dives

Capacity check + eviction:
```sql
-- 1. Count rows in scope
SELECT COUNT(*) FROM recall_cache WHERE scope_key = $1;

-- 2. If >= maxSizePerScope, delete oldest BEFORE insert
DELETE FROM recall_cache WHERE id IN (
  SELECT id FROM recall_cache
   WHERE scope_key = $1
   ORDER BY created_at ASC
   LIMIT 1   -- delete one to make room for the new insert
);
```

Wrap in transaction with the INSERT for atomicity + EC-7 SERIALIZABLE isolation:
```ts
async set(...) {
  // EC-7 absorption: SERIALIZABLE isolation prevents the race where 2 concurrent set() calls
  // both SELECT COUNT = 1000 → both DELETE oldest → 2 rows deleted instead of 1.
  // Per Postgres docs, SERIALIZABLE may raise serialization_failure (sqlstate 40001); retry once.
  await withSerializableTransactionAndRetry(this.pool, async (tx) => {
    const { rows: [{ count }] } = await tx.query('SELECT COUNT(*)::int AS count FROM recall_cache WHERE scope_key = $1', [scopeKey]);
    if (count >= this.maxSizePerScope) {
      await tx.query('DELETE FROM recall_cache WHERE id IN (SELECT id FROM recall_cache WHERE scope_key = $1 ORDER BY created_at ASC LIMIT 1)', [scopeKey]);
    }
    await tx.query(insertSql, [scopeKey, embedding, resultSet, ttlSeconds, threshold]);
  });
}

// New helper at src/local/recall-cache/serializable-tx.ts:
async function withSerializableTransactionAndRetry<T>(
  pool: Pool,
  work: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      // Postgres serialization_failure → retry once per docs
      if (attempt === 0 && (err as { code?: string })?.code === '40001') continue;
      throw err;
    } finally {
      client.release();
    }
  }
  throw new Error('withSerializableTransactionAndRetry: exhausted 2 attempts');
}
```

#### Tasks
1. Extend `set()` with capacity check inside `withTransaction` (mirror v0.4b `pg-evictor.ts:withTransaction` import + pattern)
2. Add integration test: insert 1001 rows into same scope; verify count stays ≤ 1000 + oldest is evicted

#### TDD

```
RED:     T1.2-RED-1 — insert 1001 distinct queries into user:alice; count stays at 1000
         T1.2-RED-2 — after eviction, oldest row (lowest created_at) is gone
         T1.2-RED-3 — eviction respects scope: user:alice eviction does NOT affect user:bob
         T1.2-RED-4 (EC-7) — 2 concurrent set() calls (Promise.all) on full scope: exactly 1 row deleted, NOT 2; final count = maxSizePerScope
         T1.2-RED-5 (EC-7) — serialization_failure (40001) on first attempt → retry succeeds; both inserts land
         T1.2-RED-6 (EC-9) — concurrent get() during clearExpired() sweep: get returns row OR undefined consistently (no partial state)
GREEN:   Add SERIALIZABLE transaction wrapper + capacity-check + DELETE-oldest before INSERT
REFACTOR: Extract withSerializableTransactionAndRetry() helper to src/local/recall-cache/serializable-tx.ts; document EC-7 race resolution
VERIFY:  Integration test (real pgvector required for SERIALIZABLE semantics — in-memory mocks insufficient)
```

#### Acceptance Criteria
- [ ] 3 RED tests pass
- [ ] Eviction is atomic (transaction-wrapped) — partial state impossible
- [ ] Scope isolation in eviction verified
- [ ] LRU interpretation documented: v1.5.0 uses `created_at ASC` (write-LRU) NOT `last_accessed_at` (read-LRU) — simpler; v1.5.x can add read-LRU if dogfood demands
- [ ] **EC-7 absorption**: SERIALIZABLE transaction isolation + 1 retry-on-40001; helper at `src/local/recall-cache/serializable-tx.ts`
- [ ] **EC-7 race verified**: Promise.all([set, set]) on full scope → final count = maxSizePerScope (exactly 1 delete, not 2)
- [ ] **EC-9 absorption**: concurrent get() during clearExpired() returns consistent snapshot (Postgres MVCC verified)
- [ ] Pass: file size ≤ 300 LoC (cumulative T1.1 + T1.2)

#### DoD
- [ ] `npm test` green; cumulative count climbs by 3 to 975 PASS
- [ ] Typecheck + lint clean

---

## Phase 2: Memory factory wiring + embedder gate

### T2.1 — `LocalMemoryConfig.recallCache` extension + `Memory.recall()` wrapping

#### Objective
Extend `createLocalMemory()` to accept `recallCache?: RecallCacheStoreConfig | RecallCacheStore`; wrap the returned `Memory.recall()` to consult cache before falling through to the existing 9-step pipeline.

#### Evidence
- Blueprint D5 dual-shape factory pattern
- v0.4b `LocalMemoryConfig.eviction?: LocalEvictionConfig` precedent at `src/local/index.ts:110`
- Existing `createLocalMemory()` at `src/local/index.ts:757`

#### Files to edit
```
src/local/index.ts — extend LocalMemoryConfig + factory + Memory wrap
src/local/__tests__/factory-recall-cache.test.ts (NEW)
tests/integration/cache/factory-wiring.test.ts (NEW)
```

#### Deep Dives

LocalMemoryConfig extension:
```ts
export interface LocalMemoryConfig extends MemoryConfig {
  // ...existing
  readonly recallCache?: RecallCacheStoreConfig | RecallCacheStore;
}
```

Type discriminator + EC-2 dim-probe in factory:
```ts
function isRecallCacheStoreInstance(value: unknown): value is RecallCacheStore {
  return typeof value === 'object' && value !== null && 'get' in value && 'set' in value && 'invalidateScope' in value;
}

// EC-2 absorption: pgvector atttypmod probe — mirror v1.4 adapters-openrouter-local-embedder T2.1 pattern.
// Detects embedder/table dim mismatch caused by mid-deployment embedder swap WITHOUT runMigrations({embeddingDim}).
async function probeCacheTableDim(pool: Pool): Promise<number | null> {
  const { rows } = await pool.query<{ atttypmod: number }>(
    `SELECT atttypmod FROM pg_attribute
       WHERE attrelid = 'recall_cache'::regclass AND attname = 'query_embedding'`,
  );
  if (rows.length === 0) return null; // table not yet migrated
  return rows[0].atttypmod; // pgvector stores N directly (verified by v1.4 cycle empirical correction)
}

// Inside createLocalMemory:
let recallCacheStore: RecallCacheStore | undefined;
if (config.recallCache !== undefined) {
  if (isRecallCacheStoreInstance(config.recallCache)) {
    recallCacheStore = config.recallCache;
  } else {
    validateRecallCacheStoreConfig(config.recallCache);
    // EC-2 absorption: dim probe BEFORE constructing the cache store
    const cacheTableDim = await probeCacheTableDim(pool);
    if (cacheTableDim !== null && cacheTableDim !== embedder.dim) {
      throw new InvalidCacheConfig(
        `embedder dim ${embedder.dim} mismatches recall_cache.query_embedding dim ${cacheTableDim}; ` +
        `run runMigrations(pool, { embeddingDim: ${embedder.dim} }) OR DELETE FROM recall_cache before retrying`,
      );
    }
    recallCacheStore = new PgvectorRecallCacheStore(pool, config.recallCache);
  }
}
```

EC-4 + EC-5 absorption — `Memory.recall()` wrap bypasses cache when bi-temporal `asOf` OR multi-peer `attributedTo` is set:
```ts
async recall(query: string, opts?: RecallOptions): Promise<MemoryItemWithScore[]> {
  const scope = this.scope;
  // EC-4 + EC-5 absorption (NEW ADR D8): cache applicability boundary.
  // v1.5.0 cache key is (scope_key, query_embedding) per Blueprint D4. It does NOT include
  // `asOf` (v1.1 bi-temporal) OR `attributedTo` (v1.1 multi-peer). Serving cached current
  // results when consumer asked for historical/filtered slice = correctness bug (Rule 3).
  // BYPASS path: when these options are set, skip cache entirely (no get, no set).
  const cacheApplicable = this.recallCacheStore !== undefined &&
                          opts?.asOf === undefined &&
                          opts?.attributedTo === undefined;
  if (!cacheApplicable) {
    return this.existingRecallPipeline(query, opts);
  }
  // Standard cache-aware path
  const queryEmbedding = await this.embedder.embed(query);
  const cached = await this.recallCacheStore!.get(queryEmbedding, scope);
  if (cached !== undefined) {
    this.metrics?.recall_cache_hit?.add(1, { scope_tier: scope.kind, embedder_kind: this.embedderKind });
    return [...cached.results];
  }
  const results = await this.existingRecallPipeline(query, opts);
  const ttl = this.getScopeTierTtl(scope.kind);
  await this.recallCacheStore!.set(queryEmbedding, scope, results, ttl);
  return results;
}
```

Memory.recall() wrap (lives in `src/local/index.ts` inside the existing Memory wrapper):
```ts
async recall(query: string, opts?: RecallOptions): Promise<MemoryItemWithScore[]> {
  const scope = this.scope;
  if (this.recallCacheStore !== undefined) {
    const queryEmbedding = await this.embedder.embed(query);
    const cached = await this.recallCacheStore.get(queryEmbedding, scope);
    if (cached !== undefined) {
      this.metrics?.recall_cache_hit?.add(1, { scope_tier: scope.kind, embedder_kind: this.embedderKind });
      return [...cached.results];
    }
    // Miss path: existing recall pipeline + write to cache afterward
    const results = await this.existingRecallPipeline(query, opts);
    const ttl = this.getScopeTierTtl(scope.kind);
    await this.recallCacheStore.set(queryEmbedding, scope, results, ttl);
    return results;
  }
  return this.existingRecallPipeline(query, opts);
}
```

#### Tasks
1. Read `src/local/index.ts:100-130` for LocalMemoryConfig shape + `src/local/index.ts:757-820` for createLocalMemory current logic
2. Extend interface with `recallCache?: RecallCacheStoreConfig | RecallCacheStore`
3. Add `isRecallCacheStoreInstance` discriminator + branching factory construction
4. Wrap returned Memory's `recall()` method with cache consult + populate
5. Unit test: factory constructs `PgvectorRecallCacheStore` from config object
6. Unit test: factory uses passed-in DIP impl verbatim (escape hatch)
7. Unit test: factory creates NO cache when `recallCache` undefined
8. Integration test: end-to-end cache populate + hit across two recall() calls with identical query

#### TDD

```
RED:     T2.1-RED-1 — createLocalMemory({ recallCache: undefined }) returns Memory with no cache (recall path unchanged)
         T2.1-RED-2 — createLocalMemory({ recallCache: { threshold: 0.85 } }) constructs PgvectorRecallCacheStore internally
         T2.1-RED-3 — createLocalMemory({ recallCache: customDipInstance }) uses customDipInstance verbatim
         T2.1-RED-4 — second recall() with same query returns cached result; first call does NOT
         T2.1-RED-5 — InvalidCacheConfig thrown from factory when invalid threshold passed via config
         T2.1-RED-6 (EC-2) — createLocalMemory throws InvalidCacheConfig when embedder.dim ≠ probeCacheTableDim(pool)
         T2.1-RED-7 (EC-2) — when recall_cache table does NOT yet exist (cacheTableDim = null), factory does NOT throw (migration path)
         T2.1-RED-8 (EC-4) — recall(q, { asOf: pastDate }) BYPASSES cache (no get, no set; cache counter does NOT increment)
         T2.1-RED-9 (EC-5) — recall(q, { attributedTo: 'system' }) BYPASSES cache (same as EC-4 bypass path)
         T2.1-RED-10 (EC-4+EC-5 combined) — recall(q, { asOf: D, attributedTo: 'user' }) BYPASSES cache
GREEN:   Extend factory + wrap recall() with bypass-when-asOf-or-attributedTo
REFACTOR: Ensure cache wrap does NOT regress existing recall() behavior when cache disabled
VERIFY:  npm test + integration test
```

#### Acceptance Criteria
- [ ] LocalMemoryConfig.recallCache dual-shape accepted
- [ ] Factory discriminator works for both shapes
- [ ] 5 RED tests pass
- [ ] Cache wrap is null-safe (undefined recallCache = original recall behavior; no perf regression)
- [ ] InvalidCacheConfig thrown at factory time NOT at first recall() (fail-fast per architecture.md § 8)
- [ ] **EC-2 absorption**: factory probes `recall_cache.query_embedding` atttypmod via pg_attribute; throws `InvalidCacheConfig` on mismatch with `embedder.dim`; pre-migration null-table case does NOT throw
- [ ] **EC-4 absorption** (ADR D8): when `RecallOptions.asOf !== undefined`, `Memory.recall()` BYPASSES cache (get + set both skipped); existing v1.1 bi-temporal contract preserved
- [ ] **EC-5 absorption** (ADR D8): when `RecallOptions.attributedTo !== undefined`, `Memory.recall()` BYPASSES cache; v1.1 multi-peer filter contract preserved
- [ ] **EC-4 + EC-5 combined**: any single OR combination of asOf/attributedTo triggers full bypass (no partial caching)

#### DoD
- [ ] `npm test` green; cumulative count ≈ 980 PASS
- [ ] Backward compatibility test: all existing `createLocalMemory()` callers in tests/ still pass without modification (verified by full test suite)

---

### T2.2 — Write-triggered scope invalidation in `remember()` / `forget()` / `reflect()` (EC-6 absorption)

#### Objective
Hook `Memory.remember()`, `Memory.forget()`, AND `Memory.reflect()` to call `RecallCacheStore.invalidateScope(scope)` AFTER successful write. Item 19 AC#3 mandate. EC-6 absorption: reflect() produces derived memories (v0.4a) + distillation rows (v0.7) — without hook, cache serves stale results post-reflect. Same bug class as EC-4/EC-5 cross-feature composition gap.

#### Evidence
- Blueprint D3 write-trigger correctness gate
- Item 19 AC#3 verbatim: "write to scope → next recall in same scope MUST miss"

#### Files to edit
```
src/local/index.ts — extend ScopedMemory.remember + Memory.forget to call invalidateScope post-success
src/local/__tests__/cache-invalidation.test.ts (NEW)
tests/integration/cache/invalidation-after-write.test.ts (NEW)
```

#### Deep Dives

Hook placement: post-INSERT, post-COMMIT only (so failed writes don't invalidate the cache unnecessarily).

```ts
async remember(text: string, opts?: RememberOptions): Promise<RememberResult> {
  const result = await this.existingRememberPipeline(text, opts);
  // Post-success cache invalidation per Blueprint D3
  if (this.recallCacheStore !== undefined) {
    await this.recallCacheStore.invalidateScope(this.scope).catch((err) => {
      // Loud failure but don't fail the write — cache failure must not regress remember
      console.error('[cache] invalidateScope failed:', err);
    });
  }
  return result;
}

// Memory.forget: invalidate ALL scopes (cross-scope) since forget is top-level by memoryId
// — though for v1.5.0 we conservatively invalidate just the scope of the forgotten memory
//   if discoverable from the write history; otherwise document the limitation
```

#### Tasks
1. Hook `remember()` and `forget()` post-success
2. Unit test: remember() success → invalidateScope called with correct scope
3. Unit test: remember() failure → invalidateScope NOT called (no unnecessary cache thrash)
4. Integration test: pre-warm cache for user:alice; remember new fact; next recall MUST hit DB not cache

#### TDD

```
RED:     T2.2-RED-1 — remember() success invokes invalidateScope(scope)
         T2.2-RED-2 — remember() FAILURE does NOT invoke invalidateScope
         T2.2-RED-3 — forget() success invokes invalidateScope (scope derivable from memory record per EC-10 strategy)
         T2.2-RED-4 — Item 19 AC#3 regression: pre-warm cache; remember; next recall returns FRESH results (not cached)
         T2.2-RED-5 — invalidateScope failure does NOT propagate; remember() succeeds; loud stderr emitted
         T2.2-RED-6 (EC-6) — reflect() success invokes invalidateScope(scope) post-success
         T2.2-RED-7 (EC-6) — Item 19 AC#3 regression for reflect: pre-warm cache; reflect; next recall returns FRESH results
         T2.2-RED-8 (EC-10) — forget() scope derivation: SELECT scope_key FROM memories WHERE id=$1; invalidate ONLY that scope (not all)
         T2.2-RED-9 (EC-10 fallback) — forget(memoryId) when memory NOT found (already deleted) → invalidateAll() fallback
         T2.2-RED-10 (EC-11) — remember() awaits invalidateScope BEFORE returning (sequential discipline);
                                test: pre-warm cache; await memory.remember("..."); cache.get() immediately after MUST return undefined
GREEN:   Hook remember + forget + reflect with try/catch graceful degradation; EC-10 scope-derivation helper; EC-11 sequential await
REFACTOR: Extract invalidateScopeNonFailing() helper; document EC-10 fallback rationale (already-deleted memory edge)
VERIFY:  Integration test against real pgvector
```

#### Acceptance Criteria
- [ ] 5 RED tests pass
- [ ] Cache invalidation failure does NOT regress write paths (loud failure mode per architecture.md § 8 — log but don't propagate)
- [ ] Item 19 AC#3 PROVEN by integration test
- [ ] **EC-6 absorption**: `reflect()` post-success hooked to call `invalidateScope(scope)` — same try/catch graceful-degradation as remember/forget
- [ ] **EC-10 absorption (concrete decision)**: forget() scope derivation: `SELECT scope_key FROM memories WHERE id = $memoryId` BEFORE the DELETE; invalidate ONLY the derived scope. Fallback: if memory not found (already-deleted or invalid id), call `invalidateAll()` as conservative safety net. Documented in forget() JSDoc.
- [ ] **EC-11 absorption**: remember/forget/reflect AWAIT `invalidateScope()` before returning — no fire-and-forget. Sequential discipline prevents in-flight cache-hit serving stale post-write.

#### DoD
- [ ] `npm test` green; ~985 PASS
- [ ] Typecheck + lint clean

---

### T2.3 — Embedder-kind detection + loud stub warning

#### Objective
At `createLocalMemory()` time, detect `StubEmbedder` / `DeterministicStubEmbedder` and emit 3-line stderr warning when cache is also enabled. Mirror cycle-1 T2.2 pattern.

#### Evidence
- Blueprint Rec #6 + Q5 sub-pattern (Letta model-aware feature gating)
- Cycle-1 T2.2 / F-rev-9 stub-embedder warning at `src/agent-tools/run-server.ts:81-92`

#### Files to edit
```
src/local/index.ts — add embedder-kind detection + warning at factory time
src/local/__tests__/embedder-cache-gate-warning.test.ts (NEW)
```

#### Deep Dives

Detection logic at factory time (after recallCache is wired):
```ts
if (recallCacheStore !== undefined && this.isStubEmbedder(embedder)) {
  process.stderr.write(
    'themory cache: WARNING — Cache enabled with StubEmbedder (DeterministicStubEmbedder / StubEmbedder).\n'
  );
  process.stderr.write(
    'themory cache: Cache hits will be COINCIDENTAL (deterministic but non-semantic vectors), NOT semantic.\n'
  );
  process.stderr.write(
    'themory cache: For production semantic caching, wire OpenAIEmbedder or LocalTransformerEmbedder. See README § Wiring real providers.\n'
  );
}

private isStubEmbedder(embedder: Embedder): boolean {
  return embedder.constructor.name === 'StubEmbedder' ||
         embedder.constructor.name === 'DeterministicStubEmbedder';
}
```

#### Tasks
1. Add `isStubEmbedder` helper + warning emission at factory time
2. Unit test: factory + StubEmbedder + recallCache config → 3-line warning emitted
3. Unit test: factory + StubEmbedder WITHOUT recallCache → NO warning (cache disabled, no concern)
4. Unit test: factory + OpenAIEmbedder + recallCache → NO warning (real embedder)

#### TDD

```
RED:     T2.3-RED-1 — StubEmbedder + recallCache config → stderr matches /stub embedder/i AND /cache/i AND /coincidental/i
         T2.3-RED-2 — StubEmbedder + NO recallCache → ZERO stderr writes from cache module
         T2.3-RED-3 — Mock OpenAIEmbedder (constructor name 'OpenAIEmbedder') + recallCache → NO warning
GREEN:   Implement isStubEmbedder + warning emission
REFACTOR: Move warning text to private constants (mirror run-server.ts pattern)
VERIFY:  npm test -- embedder-cache-gate-warning.test.ts
```

#### Acceptance Criteria
- [ ] 3 RED tests pass
- [ ] Warning text mirrors cycle-1 T2.2 3-line shape (line 1: WARNING + class detected; line 2: behavior disclosure; line 3: production guidance)
- [ ] Detection is constructor.name based (no instanceof — avoids tight coupling)
- [ ] Test infra uses `vi.spyOn(process.stderr, 'write')` per `run-server.test.ts:75-88` precedent
- [ ] **EC-14 absorption (DOCUMENT)**: § Testing note added to T2.3 README — tests that create memory factory with stub embedder + cache MUST install stderr spy in beforeEach (mirror v0.6.1 / cycle-1 EC-6 pattern) to prevent log pollution across the existing 956 test baseline; documented as testing convention

#### DoD
- [ ] `npm test` green; ~988 PASS
- [ ] Typecheck + lint clean

---

## Phase 3: Observability

### T3.1 — 3 OTel metrics (lazy-init pattern)

#### Objective
Expose `recall_cache_hit` Counter + `recall_cache_hit_duration_ms` Histogram + `recall_cache_miss_duration_ms` Histogram. Lazy-init per `src/local/eviction/pg-evictor.ts:56-75` precedent. Item 19 AC#2 mandate.

#### Evidence
- Blueprint D5 + Item 19 AC#2
- F-dom-6 v0.4b `T10.1` lazy-init OTel precedent

#### Files to edit
```
src/local/recall-cache/recall-cache-metrics.ts (NEW) — lazy-init metric resolver
src/local/recall-cache/pgvector-recall-cache-store.ts — instrument get/set with metrics
src/local/recall-cache/__tests__/recall-cache-metrics.test.ts (NEW)
tests/integration/cache/otel-metrics-observed.test.ts (NEW)
```

#### Deep Dives

Lazy metric resolver:
```ts
import { metrics, ValueType } from '@opentelemetry/api';
import type { Counter, Histogram } from '@opentelemetry/api';

let cachedHitCounter: Counter | undefined;
let cachedHitDurationHistogram: Histogram | undefined;
let cachedMissDurationHistogram: Histogram | undefined;

export function getRecallCacheHitCounter(): Counter {
  if (cachedHitCounter === undefined) {
    cachedHitCounter = metrics.getMeter('@usetheo/memory/cache-pg').createCounter('recall_cache_hit', {
      description: 'Number of semantic recall cache hits',
      valueType: ValueType.INT,
    });
  }
  return cachedHitCounter;
}

// Same pattern for the 2 histograms
```

Instrumentation in `pgvector-recall-cache-store.ts`:
```ts
async get(...) {
  const start = performance.now();
  const result = await this.executeGetQuery(queryEmbedding, scope);
  const duration = performance.now() - start;
  if (result !== undefined) {
    getRecallCacheHitCounter().add(1, { scope_tier: scope.kind, embedder_kind: this.embedderKind });
    getRecallCacheHitDurationHistogram().record(duration, { scope_tier: scope.kind });
  }
  return result;
}
```

Miss-path instrumentation lives in `Memory.recall()` wrap (T2.1) since miss is the pipeline fall-through.

#### Tasks
1. Write `recall-cache-metrics.ts` with 3 lazy resolvers
2. Instrument `get()` (hit counter + hit-duration histogram)
3. Instrument `Memory.recall()` miss path (miss-duration histogram)
4. Unit test: lazy-init returns same instance across calls (singleton verification)
5. Integration test: in-memory OTel exporter; perform 5 hits + 5 misses; assert counter at 5 + 5 + 5 histogram observations

#### TDD

```
RED:     T3.1-RED-1 — getRecallCacheHitCounter() returns same Counter across calls (lazy singleton)
         T3.1-RED-2 — hit → counter increments + hit-duration histogram observes
         T3.1-RED-3 — miss → miss-duration histogram observes (NO counter increment)
         T3.1-RED-4 — labels include scope_tier (user/agent/session/skill) + embedder_kind
         T3.1-RED-5 — integration: in-memory exporter sees counter=5 + hit-histo.count=5 + miss-histo.count=5 after 5+5 operations
GREEN:   Implement 3 metric resolvers + instrument get/set/miss-path
REFACTOR: Extract instrumentMethod() wrapper to avoid repetition
VERIFY:  Integration test
```

#### Acceptance Criteria
- [ ] 5 RED tests pass
- [ ] Lazy-init means no metric registration when cache disabled (zero-cost when off)
- [ ] Labels per blueprint D5 + Item 19 AC#2
- [ ] In-memory OTel exporter sees expected counts (integration test verified)
- [ ] Pass: file size ≤ 200 LoC

#### DoD
- [ ] `npm test` green; ~993 PASS

---

## Phase 4: Distribution

### T4.1 — Subpath export `@usetheo/memory/cache-pg` + bundle isolation

#### Objective
Expose `PgvectorRecallCacheStore` + helpers via subpath `@usetheo/memory/cache-pg` mirroring `@usetheo/memory/embedders/local` precedent. Verify default barrel does NOT pull cache code (bundle isolation regression test).

#### Evidence
- Blueprint D4 + Rec #3
- v0.1 `T1.7` EC-26 bundle isolation precedent at `tests/integration/subpath-isolation.test.ts`
- 2026-06-02 `embedders/local` subpath shipped via adapters-openrouter-local-embedder

#### Files to edit
```
src/local/recall-cache/index.ts (NEW) — subpath entry: re-exports PgvectorRecallCacheStore + types
package.json#exports — add ./cache-pg entry
tests/integration/public-paths.test.ts — extend with import-resolution assertion
tests/integration/subpath-isolation.test.ts — extend with negative-import assertion (default barrel does NOT reach src/local/recall-cache/)
```

#### Deep Dives

`package.json#exports` addition:
```json
{
  "./cache-pg": {
    "types": "./src/local/recall-cache/index.ts",
    "default": "./src/local/recall-cache/index.ts"
  }
}
```

`src/local/recall-cache/index.ts`:
```ts
export { PgvectorRecallCacheStore } from './pgvector-recall-cache-store.js';
export type { RecallCacheStore, RecallCacheStoreConfig, CachedResult, ScopeTierTtlConfig } from '../../core/dip/recall-cache-store.js';
```

#### Tasks
1. Create subpath entry point
2. Extend `package.json#exports`
3. Verify `npm pack --dry-run` includes new files
4. Integration test: import from `@usetheo/memory/cache-pg` resolves
5. Bundle isolation test: import from `@usetheo/memory` does NOT transitively pull `pgvector-recall-cache-store.ts` (per EC-26 precedent — recursive static-import walk)

#### TDD

```
RED:     T4.1-RED-1 — import { PgvectorRecallCacheStore } from '@usetheo/memory/cache-pg' resolves at type level
         T4.1-RED-2 — npm pack --dry-run includes src/local/recall-cache/**
         T4.1-RED-3 — recursive static-import walk from @usetheo/memory barrel does NOT reach pgvector-recall-cache-store.ts
GREEN:   Subpath entry + package.json edit
REFACTOR: Mirror embedders/local pattern exactly
VERIFY:  Integration tests
```

#### Acceptance Criteria
- [ ] 3 RED tests pass
- [ ] Subpath resolves via TypeScript
- [ ] `npm pack --dry-run` includes new files
- [ ] Bundle isolation: default barrel does NOT pull cache impl (EC-26 precedent)
- [ ] Pass: backward compat — existing `@usetheo/memory` imports unchanged

#### DoD
- [ ] `npm test` ~996 PASS
- [ ] Typecheck + lint clean

---

## Phase 5: THE GOAL TEST + docs

### T5.1 — THE GOAL TEST integration

#### Objective
Ship `tests/integration/cache/semantic-recall-cache.test.ts` running 20 queries (10 near-duplicate pairs) against real pgvector with default `threshold=0.8`; assert cache hit rate ≥ 0.5. PROVES Item 19 acceptance criterion #1.

#### Evidence
- Item 19 acceptance criterion #1: "Cache hit rate ≥ TBD (lock by v1.5 kickoff)"
- v1.5 kickoff LOCKS the TBD: hit rate ≥ 0.5 on the 20-query test set
- v0.4b `T7.1` THE GOAL TEST precedent (1000 memories + 50 rare queries → recall@10 ≥ 0.70)

#### Files to edit
```
tests/integration/cache/semantic-recall-cache.test.ts (NEW) — THE GOAL TEST
tests/fixtures/cache/near-duplicate-query-pairs.ts (NEW) — 10 hand-authored pairs
```

#### Deep Dives

Hand-authored pairs (designed to test the 0.8 threshold realistically):
```ts
export const NEAR_DUPLICATE_QUERY_PAIRS: readonly { a: string; b: string }[] = [
  { a: "qual minha cor favorita?", b: "minha cor preferida?" },
  { a: "what's my favorite color?", b: "what color do I prefer?" },
  { a: "where do I live?", b: "what's my address?" },
  { a: "do I have any pets?", b: "what pets do I own?" },
  { a: "what's my job?", b: "what do I do for work?" },
  { a: "when's my birthday?", b: "what day was I born?" },
  { a: "what music do I listen to?", b: "what's my favorite music?" },
  { a: "do I have siblings?", b: "any brothers or sisters?" },
  { a: "what's my favorite food?", b: "what food do I like best?" },
  { a: "where did I grow up?", b: "where was I raised?" },
];
```

Test flow:
1. Seed 50 memory items into `user:alice` scope
2. For each pair `(a, b)`: recall(a) [MISS — populates cache]; recall(b) [target HIT if similarity ≥ 0.8]
3. Count hits via OTel metric inspection (or direct cache.get() assertion)
4. Assert hit rate ≥ 0.5 (5 of 10 pairs hit)

#### Tasks
1. Author the 10 query pairs as fixtures
2. Write THE GOAL TEST per flow above
3. Run against real `ankane/pgvector:v0.5.1` container
4. Tune fixtures only if hit rate < 0.5 — but document the tuning honestly per Inquebrável Rule 3 (don't hide the rate adjustment)

#### TDD

```
RED:     T5.1-RED — semantic-recall-cache.test.ts FAILS without cache wired (counter never increments)
GREEN:   With Phase 0-4 shipped, test PASSES: hit rate ≥ 0.5 on 10-pair set
REFACTOR: Document tuning if any pair was reworded; otherwise ship as-authored
VERIFY:  npm test -- semantic-recall-cache.test.ts
```

#### Acceptance Criteria
- [ ] Test exists at declared path
- [ ] Test against real `ankane/pgvector:v0.5.1`
- [ ] **Hit rate ≥ 0.5** asserted
- [ ] Write-triggered invalidation regression test in same file
- [ ] TTL expiry test in same file
- [ ] Embedder-kind warning regression in same file (stub embedder + cache enabled → stderr warning emitted)
- [ ] Honest disclosure if any fixture rewording was needed to reach 0.5 (per Inquebrável Rule 3)

#### DoD
- [ ] Integration test PASSES against real pgvector
- [ ] cumulative npm test ~999 PASS

---

### T5.2 — README + CHANGELOG + Roadmap

#### Objective
Document the v1.5.0 surface for consumers + update Roadmap Item 19 status to Shipped + amend CLAUDE.md per blueprint Rec #9.

#### Evidence
- Inquebrável Rule 6 (CHANGELOG mandatory)
- Blueprint Rec #9 (CLAUDE.md amendment to clarify "at the recall() layer")
- Source plan + cycle-1 + cycle-2 CHANGELOG entry shapes as precedent

#### Files to edit
```
README.md — new "## Semantic recall cache (v1.5)" section: opt-in via createLocalMemory({ recallCache: { threshold: 0.8 } })
CHANGELOG.md — entry under [Unreleased] ### Added covering all 5 ADRs + Item 19 acceptance criteria proof
CLAUDE.md — amend Roadmap Item 19 description: append "at the recall() layer (embedchain caches RAG responses at a different layer)" + flip Status from Planned to Shipped 2026-XX-XX
```

#### Tasks
1. Author README section with example consumer code + threshold/TTL/invalidation explanation
2. Author CHANGELOG entry citing blueprint snapshot files (for traceability)
3. Update CLAUDE.md Item 19 description + status

#### TDD

This task is pure docs — no RED test. Acceptance via PR review.

#### Acceptance Criteria
- [ ] README section has consumer code example that compiles (verify via `npm run typecheck` if quoted in TSDoc; otherwise human-review)
- [ ] CHANGELOG entry under `[Unreleased]` `### Added` mentions 5 ADRs + Item 19 acceptance criteria #1/#2/#3 all proven
- [ ] CLAUDE.md Roadmap Item 19 Status flipped to `Shipped 2026-XX-XX` with cycle-2 PR sha referenced
- [ ] CLAUDE.md amendment per blueprint Rec #9 ("at the recall() layer" clarification)

#### DoD
- [ ] All 3 docs touched
- [ ] No paper names per `.claude/rules/no-paper-names-in-code.md` (the OK reference layer is README/CHANGELOG; technical-direct from `## How it works` downward per CLAUDE.md voice)

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Blueprint D1 — declare 13th DIP `RecallCacheStore` with 4 methods | T0.1 | New `src/core/dip/recall-cache-store.ts` with 4-method interface; ADR-0008 cap honored |
| 2 | Blueprint D2 — default threshold = 0.8 with [0,1] validation | T0.1 + T1.1 | `RecallCacheStoreConfig.threshold` default 0.8; runtime validation throws `InvalidCacheConfig` |
| 3 | Blueprint D3 — write-triggered scope invalidation + TTL gated by scope-tier | T1.1 + T2.2 | `invalidateScope()` SQL + remember/forget post-success hooks; TTL via `expires_at` column + ScopeTierTtlConfig defaults |
| 4 | Blueprint D4 — backend default = pgvector via subpath `@usetheo/memory/cache-pg`; Redis v1.5.1 follow-up | T1.1 + T4.1 | `PgvectorRecallCacheStore` impl + subpath entry point + bundle isolation test |
| 5 | Blueprint D5 — factory shape `LocalMemoryConfig.recallCache?: Config | DIP` | T2.1 | Dual-shape factory extension + type discriminator |
| 6 | Blueprint D6 — stub embedder warning when cache enabled | T2.3 | 3-line stderr warning mirroring cycle-1 T2.2 pattern |
| 7 | Blueprint D7 — no auto_flush batch; write-through default | T1.1 ADR document | ADR D7 documents stance; no batch logic in `set()` |
| 8 | Item 19 acceptance criterion #1 — cache hit rate ≥ 0.5 on 20-query test set | T5.1 | THE GOAL TEST against real pgvector |
| 9 | Item 19 acceptance criterion #2 — `recall_cache_hit_duration_ms` + `recall_cache_miss_duration_ms` histograms | T3.1 | Lazy-init OTel metrics + instrumentation in `get()` + miss path |
| 10 | Item 19 acceptance criterion #3 — write to scope → next recall MUST miss | T2.2 + T5.1 | Write-trigger hook + integration test |
| 11 | Bundle gate — default barrel does NOT pull Redis driver unless wired | T4.1 | Subpath isolation regression test extension |
| 12 | LRU eviction at max_size=1000 per scope (Blueprint Rec #8) | T1.2 | Capacity check + DELETE-oldest in transaction |
| 13 | Migration 0010 + HNSW partial index (Blueprint § 3 schema) | T0.2 | SQL + schema.ts declaration + idempotency test |
| 14 | Backward compat: createLocalMemory() callers without recallCache work unchanged | T2.1 | Null-safe wrap; full test suite passes without modification |
| 15 | `npm test` 999+ PASS (956 baseline + ~43 new) | T0.1 + T0.2 + T1.1 + T1.2 + T2.1 + T2.2 + T2.3 + T3.1 + T4.1 + T5.1 | Each task's DoD includes `npm test` green |
| 16 | `npm run typecheck` 0 errors | T0.1 + T0.2 + T1.1 + T1.2 + T2.1 + T2.2 + T2.3 + T3.1 + T4.1 + T5.1 | Each task's DoD includes typecheck |
| 17 | `npm run lint` 0 warnings | T0.1 + T0.2 + T1.1 + T1.2 + T2.1 + T2.2 + T2.3 + T3.1 + T4.1 + T5.1 | Each task's DoD includes lint |
| 18 | CHANGELOG entry (Inquebrável Rule 6) | T5.2 | One consolidated entry under `[Unreleased]` `### Added` |
| 19 | CLAUDE.md Roadmap Item 19 status flip + "at the recall() layer" amendment (Blueprint Rec #9) | T5.2 | Description amended + Status `Shipped 2026-XX-XX` |
| 20 | Subpath export pattern matches `embedders/local` precedent | T4.1 | Mirror package.json#exports shape; bundle isolation test |
| 21 | DIP boundary respected: `core/` does NOT import from `local/` | T0.1 | DIP interface lives in core/dip/; impl lives in local/recall-cache/; verified via `boundary-check.sh` hook |
| 22 | Loud failure mode for cache failures (architecture.md § 8) | T2.2 | Invalidation failure logged but does NOT propagate to write path |
| 23 | Inquebrável Rule 11 (YAGNI) discipline — Redis deferred to v1.5.1 | T1.1 + T4.1 | ADR D4 explicitly rejects "ship Redis day-0"; T1.1 ships only `PgvectorRecallCacheStore`; T4.1 subpath leaves room for future `@usetheo/memory/cache-redis` |
| 24 | EC-1 — IEEE 754 NaN/Infinity threshold guard | T0.1 | `Number.isFinite` placed BEFORE range check in validator |
| 25 | EC-2 — embedder/cache-table dim mismatch detection | T2.1 | `probeCacheTableDim` pg_attribute probe; InvalidCacheConfig at factory time |
| 26 | EC-3 — `skill` scope tier (v0.6 ADR-0010) covered by TTL config | T0.1 + T2.1 + ADR D3 amendment | `ScopeTierTtlConfig.skill: number` default 3600s |
| 27 | EC-4 — `recall({ asOf })` bypasses cache (v1.1 bi-temporal contract preserved) | T2.1 + ADR D8 | `Memory.recall()` wrap bypasses when `opts.asOf !== undefined` |
| 28 | EC-5 — `recall({ attributedTo })` bypasses cache (v1.1 multi-peer contract preserved) | T2.1 + ADR D8 | `Memory.recall()` wrap bypasses when `opts.attributedTo !== undefined` |
| 29 | EC-6 — `reflect()` hooked to invalidateScope | T2.2 + ADR D3 amendment | 3rd write surface hooked (remember + forget + reflect) |
| 30 | EC-7 — LRU eviction concurrent race | T1.2 | SERIALIZABLE isolation + retry-on-40001 via `withSerializableTransactionAndRetry` helper |
| 31 | EC-8 — zero-norm embedding NaN cosine handled | T1.1 | Test pins `>= filter` excludes NaN correctly |
| 32 | EC-9 — concurrent get + clearExpired MVCC snapshot consistency | T1.1/T1.2 | Test pins Postgres MVCC behavior |
| 33 | EC-10 — forget() scope-derivation concrete strategy | T2.2 | `SELECT scope_key FROM memories WHERE id=$1`; fallback to invalidateAll on not-found |
| 34 | EC-11 — remember/forget/reflect AWAIT invalidateScope before returning | T2.2 | Sequential discipline test |
| 35 | EC-12 — oversized result_set JSONB boundary | T1.1 | Boundary test + JSDoc documents practical limit |
| 36 | EC-13 — `maxSizePerScope < 10` thrashing warning | T0.1 + README | DIP JSDoc + README warn against degenerate config |
| 37 | EC-14 — stderr noise discipline in test suites | T2.3 + § Testing | Convention documented per run-server.test.ts EC-6 precedent |
| 38 | EC-15 — HNSW tuning deferred to v1.5.x evidence | T0.2 + ADR D7 amendment | Migration SQL comment + ADR amendment document the deferral |

**Coverage: 38/38 gaps mapped to tasks (100%)**

## Global Definition of Done

- [ ] All 5 phases (T0.1 → T5.2) completed
- [ ] All tests passing — `npm test` ≥ 999 contract PASS / 2 skipped
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budgets respected per `architecture.md § Module hygiene`:
  - `src/core/dip/recall-cache-store.ts` ≤ 100 LoC
  - `src/local/recall-cache/pgvector-recall-cache-store.ts` ≤ 300 LoC (cumulative T1.1 + T1.2)
  - `src/local/recall-cache/recall-cache-metrics.ts` ≤ 100 LoC
  - `src/local/recall-cache/index.ts` ≤ 50 LoC (subpath entry; re-exports only)
- [ ] CHANGELOG.md updated under `[Unreleased]` `### Added` with consolidated v1.5.0 entry citing 5 ADRs + 3 Item 19 acceptance criteria + blueprint snapshot files
- [ ] CLAUDE.md Roadmap Item 19 description amended (Blueprint Rec #9) + Status flipped to `Shipped 2026-XX-XX`
- [ ] No paper names in `src/**` per `.claude/rules/no-paper-names-in-code.md`
- [ ] **Runtime-metric proof**: 3 OTel metrics observed non-zero during THE GOAL TEST (`tests/integration/cache/semantic-recall-cache.test.ts`) per Item 19 acceptance criterion #2; in-memory OTel exporter snapshot recorded
- [ ] **Wiring triad** for every new public symbol:
  - (a) Static caller: `grep -rl 'PgvectorRecallCacheStore' src/ --exclude='*test*'` returns `src/local/index.ts` (factory) and `src/local/recall-cache/index.ts` (subpath)
  - (b) Integration test: `tests/integration/cache/semantic-recall-cache.test.ts` exercises real pgvector roundtrip
  - (c) Runtime metric: `recall_cache_hit` Counter observed non-zero during integration test
- [ ] Backward compatibility preserved — none of the existing 956 contract tests break without modification
- [ ] Plan archived to `.claude/knowledge-base/plans/completed/` after `/review` returns READY_TO_MERGE
- [ ] Blueprint archived alongside: `.claude/knowledge-base/discoveries/blueprints/semantic-recall-cache-blueprint.md` moves to `.claude/knowledge-base/discoveries/blueprints/completed/` per cycle-discover archive discipline

## Final Phase: Integration Validation (MANDATORY)

> This phase runs AFTER all 9 task commits land. The plan is NOT done until the full chain passes AND `/review` returns READY_TO_MERGE.

**Objective:** Validate that the 9 tasks compose into a working v1.5.0 surface AND that the re-review returns `READY_TO_MERGE` with 0 BLOCKER / 0 CRITICAL / ≤ 1 MAJOR.

### Execution

```bash
npm test                        # ~999 contract / 2 skipped
npm run test:coverage           # ≥ 90% on src/local/recall-cache/ + src/core/dip/recall-cache-store.ts
npm run typecheck               # 0 errors
npm run lint                    # 0 warnings
docker compose up -d pgvector   # for integration tests
npm test -- tests/integration/cache/  # all cache integration tests PASS
```

Then invoke `/review semantic-recall-cache-v1-5` to spawn 6-7 specialized review agents on the v1.5 diff (architecture + tests + wiring + cross-validation + domain-pgvector-schema + domain-memory-layer + domain-observability).

### Acceptance Criteria

- [ ] `npm test` ~999 contract PASS / 2 skipped
- [ ] `npm run test:coverage` ≥ 90% on new files
- [ ] `npm run typecheck` zero TS errors
- [ ] `npm run lint` zero lint warnings
- [ ] Integration tests against real `ankane/pgvector:v0.5.1` all PASS
- [ ] THE GOAL TEST hit rate ≥ 0.5 verified
- [ ] OTel metrics observed non-zero (in-memory exporter snapshot)
- [ ] `/review` re-run returns READY_TO_MERGE or READY_TO_MERGE_WITH_CAVEATS (cycle-1 baseline)
- [ ] `/dogfood` gate remains EVIDENCE_INSUFFICIENT per dogfood-golden-rule.md (this plan does NOT unblock production-ready claims; honestly disclosed)

### If Validation Fails

1. Identify which failures are cycle-2-introduced vs pre-existing.
2. Fix all cycle-2-caused failures via fixes-cycle-1 mechanism if needed.
3. Pre-existing-debt remains accepted-with-caveats; document in PR description.

### If `/review` re-run surfaces NEW MAJOR/CRITICAL introduced by THIS cycle

- HALT per `cycle-review.md` § Hard gates.
- Honest "exhausted" report preferable to false-positive READY_TO_MERGE per Inquebrável Rule 3.
- Consider follow-up `semantic-recall-cache-v1-5-fixes-cycle-1-plan.md` per cycle-1 / cycle-2 precedent established 2026-06-03.
