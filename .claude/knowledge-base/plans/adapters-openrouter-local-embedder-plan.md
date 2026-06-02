# Plan: adapters-openrouter-local-embedder

> **Version 1.2** (2026-06-02) — Absorbs the `/review` consolidated report at `.claude/knowledge-base/reviews/adapters-openrouter-local-embedder-review-2026-06-02.md`. **ADR D3 AMENDMENT (closes F-C1 + F-M2):** the destructive `ALTER COLUMN TYPE vector(N) USING NULL` recipe locked in v1.0/v1.1 collides empirically with the existing `vector(1536) NOT NULL` constraint on `memories.embedding` + `entities.embedding` (PG error 23502: "column ... contains null values"). The shipped impl substitutes `DELETE FROM memories; DELETE FROM entities; ALTER COLUMN TYPE vector(N);` inside the same BEGIN/COMMIT transaction. The DELETEs cascade FAR BROADER than ADR EC-B disclosed: (a) `history.memory_id ON DELETE CASCADE` wipes the entire history audit trail; (b) `consolidation_history.kept_memory_id ON DELETE SET NULL` nullifies v0.7 distillation provenance pointers; (c) `memories.superseded_by` self-FK ON DELETE SET NULL breaks v0.6 Voyager supersession chains. **ADR EC-B AMENDMENT (closes F-C1 honesty surface):** the destructive dim change is now disclosed as wiping (i) all rows in `memories` + `entities`, (ii) the entire `history` audit trail via FK cascade, (iii) `consolidation_history.kept_memory_id` pointers, (iv) `memories.superseded_by` chains. Operator MUST accept this widened envelope. **Test gaps closed in v1.2:** F-M1 EC-3 atomic rollback test added; F-M6 DELETE-cascade-behavior test added; F-M7 push-flow path TDD-test added; F-M8 distill consolidation_history SELECT assertion added; F-M9 /api/chat 384-dim memory insert test added; F-M12 EC-5 empty-string + EC-7 warmup network failure + EC-10 missing OPENAI_BASE_URL warn tests added. **Code corrections in v1.2:** F-M4 asymmetric backward-compat guard removed (let inner atttypmod probe handle idempotency); F-M5 rejected-promise singleton reset; F-M10 stale `N+4` comment removed; F-M11 PgvectorStore tracer-signature widening marked BREAKING (theoretical) in CHANGELOG with migration note; F-M13 orphan-schema warning text updated to honest "skipping migrate(); applying explicit dim change only"; F-M15 + F-Mi6 PgvectorStore insert/update/insertBatch dim guard added with typed EmbeddingMismatch; F-Mi4 validateEmbeddingDim throws new dedicated `InvalidEmbeddingDim` error; F-Mi9 CREATE INDEX uses quoted identifiers; F-Mi11 + F-Mi12 test naming hygiene fixes. F-M3 (Drizzle schema.ts hardcoded 1536) mitigated via runtime guard test that fails-loud on drift; full fix deferred to a follow-up `/to-plan parametric-drizzle-schema` cycle since the proper fix touches the SDK's build pipeline (out-of-scope for v1.2 of this cycle).
>
> **Version 1.1** (2026-06-01) — Absorbs ALL 5 MUST FIX edge cases from `/edge-case-plan adapters-openrouter-local-embedder` review at `.claude/knowledge-base/reviews/adapters-openrouter-local-embedder-edge-cases-2026-06-01.md`. **EC-1 (T0.1)** — `embeddingDim` guard now uses `Number.isInteger` to catch NaN/float/Infinity; explicit error message includes the received value. **EC-3 (T0.3)** — the 2 `ALTER COLUMN TYPE` statements (memories + entities) now run inside a single `BEGIN/COMMIT` transaction; ROLLBACK on any failure. **EC-4 (T0.3) — verified empirically against `src/local/migrations/0000_crazy_mimic.sql:44,51`** — HNSW indexes `entities_embedding_hnsw_idx` + `memories_embedding_hnsw_idx` exist on those columns; pgvector REJECTS `ALTER COLUMN TYPE` while indexes are present. T0.3 now drops both HNSW indexes BEFORE the ALTER + recreates them AFTER, all inside the same transaction. **EC-11 (T2.1)** — unknown `THEOMEM_DEMO_BACKEND` value (e.g., typo `local_openrouter` with underscore) now throws explicit `Error` at boot instead of silently falling through to `openai` mode; honors Inquebrável Rule 3. **EC-13 (T2.1) — verified empirically against `vitest.contract.config.ts:5-9`** — RED test path moved from `examples/chat-with-memory/lib/__tests__/memory.test.ts` (UNREACHABLE by include glob) to `tests/unit/examples/chat-with-memory-memory.test.ts` (matches `tests/unit/**/*.test.ts` glob). Avoids /implement Stop Condition #4 (plan defect — Files to edit unreachable) on iteration 1. The 4 SHOULD TEST + 3 DOCUMENT cases stay tracked in the EC review as halt-loop checkpoints during /implement; they do NOT block /deps-audit + /plan-confidence.
>
> **Version 1.0** (2026-06-01) — Unblock the `examples/chat-with-memory/` demo for OpenRouter-only API keys by (a) leveraging the OpenAI Node SDK's native `OPENAI_BASE_URL` env-var support to route chat completions through OpenRouter (ZERO SDK code change), and (b) shipping a new `LocalTransformerEmbedder` (Xenova/all-MiniLM-L6-v2, 384-dim) so embeddings stay local since OpenRouter does NOT proxy `/v1/embeddings`. Backward-compatible SDK changes only — public API surface grows additively (`LocalMemoryConfig.embeddingDim?: number = 1536`, `PgvectorStore({ embeddingDim? })`, `runMigrations(pool, { embeddingDim? })`). Demo singleton (`examples/chat-with-memory/lib/memory.ts`) gains a 3rd backend branch `local-openrouter` selected via new env var `THEOMEM_DEMO_BACKEND={stub|openai|local-openrouter}`.

## Goal

**Enable** the `examples/chat-with-memory/` demo to run end-to-end with an OpenRouter-only API key + local embeddings (no OpenAI account required), so that an operator can `npm run dev` + chat in the browser + exercise the v0.7 Distillation tab (Noop/LWW/LJM) without hitting `429 insufficient_quota`, measured by `tests/integration/examples/chat-with-memory-local-openrouter.test.ts` PASS against the demo HTTP surface with `THEOMEM_DEMO_BACKEND=local-openrouter`, `OPENAI_BASE_URL=https://openrouter.ai/api/v1`, and a valid `sk-or-v1-*` key + the new `/api/info` endpoint returning `{ adapterSource: 'local-openrouter', embedderDim: 384 }`.

The action verb is **enable**; the named observable metric is the integration test pass + `/api/info` JSON shape verbatim match.

## Context

### What exists today (surfaces this plan builds on)

| Surface | Status | Source |
|---|---|---|
| OpenAI Node SDK natively reads `OPENAI_BASE_URL` env var | SHIPPED (upstream openai@4.x) | `node_modules/openai/index.mjs:46` (`Core.readEnv('OPENAI_BASE_URL')`) |
| `Embedder` DIP — 2 methods (`embed`, `embedBatch`) | SHIPPED v0.1 | `src/core/dip/embedder.ts` |
| `MAX_EMBEDDING_DIM = 1536` constant | SHIPPED v0.1 (ADR D1.7) | `src/core/constants.ts` |
| `createLocalMemory` probe (EC-5): asserts embedder output length === MAX_EMBEDDING_DIM | SHIPPED v0.1 | `src/local/index.ts:8` |
| `PgvectorStore` search guard at line 236 (F-dom-4) | SHIPPED | `src/local/pgvector-store.ts:236` |
| Schema literal `vector(1536)` in 2 columns (`memories.embedding`, `entities.embedding`) | SHIPPED v0.1 | `src/local/migrations/0000_crazy_mimic.sql:11,30` |
| `OpenAIEmbedder` lazy singleton (apiKey from env) | SHIPPED Cycle 2 | `src/embedders/openai.ts:42-47` |
| `OpenAILLM` lazy singleton (apiKey from env) | SHIPPED Cycle 2 | `src/llms/openai.ts:55-58` |
| `DeterministicStubEmbedder` (1536-dim, deterministic) | SHIPPED Cycle 1 | `src/embedders/stub.ts` |
| Demo singleton with 2 backends (stub/openai) | SHIPPED v0.6.1 + v0.7 | `examples/chat-with-memory/lib/memory.ts` (280 LoC) |
| `MemorySingleton.adapterSource: 'stub' \| 'openai'` | SHIPPED v0.7 T0.1 | `examples/chat-with-memory/lib/memory.ts:87` |
| Subpath exports: `embedders/{stub,openai}` + `llms/{stub,openai}` | SHIPPED Cycle 2 | `package.json#exports` |
| Vitest contract include: `src/{core,local,theokit,agent-tools,embedders,llms}/**/__tests__/**` | SHIPPED | `vitest.contract.config.ts:5-9` |

### Why this matters NOW

The v0.7 distillation cycle just shipped (commits `039aacb` → `c36c313` → `8d52cca` on develop, today 2026-06-01). The DistillationTab is the user-facing surface but the operator (project owner) has only an **OpenRouter API key (`sk-or-v1-*`)**, not an OpenAI key. Empirical smoke test 2026-06-01 confirms:

1. `OpenAILLM` + `OPENAI_BASE_URL=https://openrouter.ai/api/v1` env var → chat completions route through OpenRouter successfully (SDK supports this natively per `node_modules/openai/index.mjs:46`).
2. `OpenAIEmbedder` with same env override → 429 `insufficient_quota` because **OpenRouter does NOT proxy `/v1/embeddings`** (their docs explicitly state chat-only).
3. Without a working embedder, the demo chat route 500s at first user turn (the `embed()` call powering memory recall is the hot path).

The demo is the dogfood evidence required by `dogfood-golden-rule.md` § anchor scenario. Blocked until the embedder works without OpenAI.

### Accepted risks (declared upfront)

- **EC-A — Xenova model download on first use.** `@xenova/transformers` caches `Xenova/all-MiniLM-L6-v2` (~22 MB) under `~/.cache/transformers-js/` (or `node_modules/.transformers-cache/`) on the first `embed()` call. Requires internet at warmup; subsequent calls are offline. README documents this as a one-time cost.
- **EC-B — Destructive schema dim change.** Calling `runMigrations(pool, { embeddingDim: 384 })` against a DB whose `memories.embedding` is currently `vector(1536)` MUST drop/recreate the column (pgvector does not support `ALTER COLUMN TYPE vector(N → M)` with data preservation when N ≠ M). All existing memories are lost on dim switch. Demo docs flag this as expected; the helper is opt-in via the new arg and never runs implicitly.
- **EC-C — OpenRouter rate limits + model routing fidelity.** `gpt-4o-mini` requested via OpenRouter may transparently route to a different upstream than direct OpenAI; chat reply quality may differ subtly. Out of scope to validate; user accepts.
- **EC-D — OpenRouter JSON response format compat.** The LJM (`LlmJudgedMergeConflictPolicy`) policy uses `response_format: { type: 'json_object' }`. OpenRouter supports this for `gpt-4o-mini` but model routing decisions may strip the field on some upstreams. If it surfaces, EC-10 of the existing OpenAILLM (`{ error: 'non_json_response', raw }`) returns the structured error verbatim — already absorbed in `src/llms/openai.ts:91-96`.
- **EC-E — MiniLM 384-dim semantic quality vs OpenAI 1536.** `all-MiniLM-L6-v2` (384) is a strong baseline but produces lower recall@10 than `text-embedding-3-small` (1536) on long-tail retrieval. Demo functionality unaffected; benchmark-comparable quality is out of scope.
- **EC-F — `@xenova/transformers` ESM/CJS edge.** v2.x is ESM-only; Next.js 15 + the demo's `nodejs` runtime both handle this fine. The SDK's typecheck config (`tsconfig.contract.json`) includes `src/embedders/**/*.ts`; the dep ships its own `.d.ts`. No bundler hack required.

### Compliance scope (rules + principles cited)

- **`architecture.md § 3 — Dependency direction (DIP)`** — `LocalTransformerEmbedder` lives at `src/embedders/local.ts`, implements `Embedder` interface from `src/core/dip/embedder.ts`. NO import from `src/local/` or `src/cloud/`. Mirrors precedent of `OpenAIEmbedder` location.
- **`architecture.md § 6 — Naming conventions`** — file `local.ts` (kebab-case sibling of `openai.ts` + `stub.ts`); class `LocalTransformerEmbedder` (PascalCase, sibling shape of `OpenAIEmbedder`); env var `THEOMEM_DEMO_BACKEND` (`UPPER_SNAKE_CASE` sibling of existing `THEOMEM_USE_STUB_ADAPTERS` + `THEOMEM_PG_URI` + `THEOMEM_EVICTION_DEMO`).
- **`architecture.md § 7 — Module hygiene`** — every NEW file ≤ 500 LoC. `LocalTransformerEmbedder` estimated ~80 LoC; demo `lib/memory.ts` grows by ~50 LoC (currently 280 → estimated 330).
- **`architecture.md § 9 — Public API surface`** — three new public exports: (i) `LocalTransformerEmbedder` via `src/embedders/local.ts` + subpath `@usetheo/memory/embedders/local`, (ii) `LocalMemoryConfig.embeddingDim?: number`, (iii) `PgvectorStore({ embeddingDim? })`. All additive; existing callers continue working with defaults.
- **`testing.md § Pyramid`** — RED tests at all 3 tiers per task: unit (contract) under `src/embedders/__tests__/local.test.ts`; integration under `tests/integration/examples/chat-with-memory-local-openrouter.test.ts`; no E2E (the demo HTTP surface IS the e2e).
- **Inquebrável Rule 9 (Não Reinvente a Roda)** — D1 ADR documents the Xenova evaluation against alternatives (fastembed-js, Ollama, Python sidecar).
- **`no-paper-names-in-code.md`** — class names + JSDoc avoid "Sentence-Transformer" paper-name framing; describe behavior (`LocalTransformerEmbedder` = transformer-based embedder running locally, not "implementing the all-MiniLM-L6-v2 paper").
- **`deps-audit-golden-rule.md`** — `@xenova/transformers` is the ONLY NEW dep introduced. Plan-level `## Dependencies` section declares it with version + Rule 9 evaluation. `/deps-audit` will run after `/edge-case-plan` per `cycle-plan.md` v1.1.

## Objective

- [ ] Sub-goal 1 — `LocalTransformerEmbedder` implements `Embedder` DIP correctly; probe-text input yields 384-dim L2-normalized vector; batch+single calls agree on output for identical input.
- [ ] Sub-goal 2 — `LocalMemoryConfig.embeddingDim?: number` propagates through `createLocalMemory` → `PgvectorStore` constructor → probe assertion. Default 1536 preserves all existing SDK behavior.
- [ ] Sub-goal 3 — `runMigrations(pool, { embeddingDim?: number })` accepts the new option; when `embeddingDim !== 1536`, runs `ALTER TABLE memories ALTER COLUMN embedding TYPE vector(${dim}) USING NULL` (+ same for `entities`) AFTER Drizzle migrations apply. Logs the destructive truncation to stderr.
- [ ] Sub-goal 4 — `OpenAILLM` + `OPENAI_BASE_URL=https://openrouter.ai/api/v1` routes chat completions through OpenRouter empirically (ZERO src/llms/openai.ts code change). Validated by integration test that mocks OpenAI HTTP and asserts the request lands on the configured base URL.
- [ ] Sub-goal 5 — Demo `lib/memory.ts` adds `local-openrouter` backend branch; new env var `THEOMEM_DEMO_BACKEND` selects between `stub` (default when other indicators absent), `openai`, `local-openrouter`. `adapterSource` union widens to `'stub' \| 'openai' \| 'local-openrouter'`.
- [ ] Sub-goal 6 — `/api/info` route extends response to include `embedderDim: number` + accurate `adapterSource`. Existing `/api/info` consumers (UI panel) tolerate the additive field.
- [ ] Sub-goal 7 — `examples/chat-with-memory/README.md` documents all 3 backend modes + how to set `OPENAI_BASE_URL` for OpenRouter + first-use Xenova warmup expectation.
- [ ] Sub-goal 8 — `tests/integration/examples/chat-with-memory-local-openrouter.test.ts` PASS against the demo HTTP surface using `describe.skipIf(...)` reachability probe pattern from v0.7 cycle EC-2.

## ADRs

### D1 — `@xenova/transformers` as the local-embed engine (Inquebrável Rule 9)

**Decision:** Adopt `@xenova/transformers@^2.17.0` (latest 2.x as of 2026-06-01) as a NEW `optionalDependency` of `@usetheo/memory`. Default model `Xenova/all-MiniLM-L6-v2` (384-dim, ~22 MB cache).

**Rationale:** `@xenova/transformers` wins on: zero native build, pure-Wasm runtime, broadest model catalog (all `Xenova/*` repos cover sentence-transformer + ONNX-quantized models), Apache-2.0 license compatible with our MIT, ESM-first matching our module system, and works in both Node and browser (future-proofs a potential client-side embed path).

**Alternatives considered (Rule 9 evaluation matrix — 4 candidates rejected):**

| Candidate | License | Output dim | Native deps | Runtime | Verdict |
|---|---|---|---|---|---|
| `@xenova/transformers` 2.x | Apache-2.0 | 384 (default) / 768 / 1024 (model-configurable) | None (pure JS + Wasm via `onnxruntime-web`) | Node ≥ 18 + browser | **ADOPT** |
| `fastembed-js` 1.x | Apache-2.0 | 384 (model-configurable) | Requires `node-gyp` build of `onnxruntime-node` (native) | Node only | REJECT — native build adds CI friction; same model catalog as Xenova for our use |
| Ollama embed endpoint | MIT (Ollama) | Model-dependent (`nomic-embed-text` = 768) | Requires `ollama serve` daemon | Node + HTTP to localhost | REJECT — daemon dependency is heavy for a primitive embedder; OK as future opt-in adapter |
| Python `sentence-transformers` sidecar | Apache-2.0 | Model-dependent | Python interpreter + pip env | Node + IPC | REJECT — adds Python to the project's runtime contract; not Node-native |
| `llama.cpp` embed (CLI subprocess) | MIT | Model-dependent (LLaMA family) | Native binary | Node + subprocess | REJECT — LLaMA family embeddings are not the canonical retrieval choice; binary deploy is heavyweight |

**Consequences:**
- New `optionalDependency` adds ~22 MB to `node_modules` AFTER first model download (the package itself is ~5 MB; model cache is separate dir).
- Consumers running `npm install --no-optional` get a TypeScript compile error if they import `@usetheo/memory/embedders/local` — mirrors precedent of `OpenAIEmbedder` (`src/embedders/openai.ts` EC-6 JSDoc).
- First `embed()` call downloads the model from HuggingFace CDN (`huggingface.co/Xenova/all-MiniLM-L6-v2`); needs internet at warmup. Documented in JSDoc + README.
- 384-dim output is lower-quality than OpenAI 1536-dim for long-tail retrieval, but adequate for the demo (which uses small memory sets per session).

### D2 — `MAX_EMBEDDING_DIM` stays as the upper cap; runtime `embeddingDim` is additive config

**Decision:** Do NOT remove or modify the `MAX_EMBEDDING_DIM = 1536` constant. Instead, add an optional `embeddingDim?: number` field to `LocalMemoryConfig` (defaults to `MAX_EMBEDDING_DIM`). The probe in `createLocalMemory` asserts `vector.length === config.embeddingDim ?? MAX_EMBEDDING_DIM`. The cap meaning narrows from "must equal" to "must equal config; must be ≤ MAX_EMBEDDING_DIM".

**Rationale:** Preserves the architectural decision in `src/core/constants.ts` JSDoc (pgvector HNSW ≤ 2000-dim ceiling, Mem0 test-suite parity, OpenAI default cover). Backward-compatible: every existing caller continues to pass NO `embeddingDim` and gets 1536. NEW callers wanting a smaller dim (e.g., 384) opt in. Alternatives:

- **REJECT — change `MAX_EMBEDDING_DIM` to a smaller value (e.g., 768)** — would break every existing caller using `OpenAIEmbedder` (1536-dim output) and force a major version bump. v0.1 ADR D1.7 locks the 1536 cap as an upper-bound, not a target.
- **REJECT — remove the probe entirely** — eliminates the EC-5 startup-loud-error safety net. A misconfigured embedder would silently insert wrong-dim vectors and pgvector would error at INSERT time (worse UX).
- **ACCEPT — additive `embeddingDim?: number` on `LocalMemoryConfig`** — clean, backward-compat, intentional.

**Consequences:**
- `LocalMemoryConfig` shape grows by one optional field. TypeScript narrowing remains correct.
- `EmbeddingMismatch` error message text gains the configured dim for clarity (was implicitly always 1536; now `expected ${configuredDim}, got ${actual}`).
- Public API surface widens additively (Sub-goal 2 above).

### D3 — Destructive schema dim change via `runMigrations({ embeddingDim })` is opt-in + documented

**Decision:** `runMigrations(pool, options?: { embeddingDim?: number })` accepts the new option. When `options.embeddingDim` is set AND differs from `MAX_EMBEDDING_DIM`, after Drizzle migrations apply, the helper executes:

```sql
ALTER TABLE memories ALTER COLUMN embedding TYPE vector(${dim}) USING NULL;
ALTER TABLE entities ALTER COLUMN embedding TYPE vector(${dim}) USING NULL;
```

The `USING NULL` clause drops all existing data in those columns (pgvector does not support data-preserving dim change). The helper logs `[runMigrations] WARN: dim change ${old} → ${new} truncates existing embeddings` to stderr.

**Rationale:** Pgvector does not support runtime alter of `vector(N)` dimension preserving data. Three alternatives:

- **REJECT — parametric Drizzle migration template substitution** — Drizzle migration files are static SQL; templating breaks the migration-journal hash discipline (`drizzle.__drizzle_migrations` records SHA-256 of the file contents). Templating would invalidate the journal.
- **REJECT — separate bootstrap helper that bypasses Drizzle entirely** — duplicates the schema definition + scatters truth. The Drizzle migration files remain the source of truth.
- **ACCEPT — post-migration ALTER COLUMN with documented data loss** — minimal SDK surface change, clean separation of concerns (Drizzle owns the static schema; the helper owns the runtime dim swap when explicitly requested). Demo callers accept the data loss because they're switching backends.

**Consequences:**
- New SDK function signature is additive: `runMigrations(pool)` continues to work; `runMigrations(pool, { embeddingDim: 384 })` is the new path.
- Demo callers that switch from `THEOMEM_DEMO_BACKEND=openai` to `local-openrouter` must accept that existing 1536-dim memories vanish. README documents this.
- Helper logs the destructive transition for ops visibility.

### D4 — OpenRouter for chat-completion routing; embeddings stay local (no OpenRouter embed)

**Decision:** OpenRouter is used **only** for chat completions in the new `local-openrouter` demo backend. Embeddings ALWAYS route through `LocalTransformerEmbedder` (local Xenova) in this mode. The SDK does NOT attempt to route embeddings through OpenRouter even if `OPENAI_BASE_URL` is set.

**Rationale:** OpenRouter explicitly does not proxy `/v1/embeddings` (their model catalog at `https://openrouter.ai/api/v1/models` lists only chat models; `/embeddings` returns 404 — verified empirically 2026-06-01). Splitting the embedder and LLM into separate adapter classes (already the case via DIP) makes this clean: `OpenAILLM` reads `OPENAI_BASE_URL` natively → routes to OpenRouter; `LocalTransformerEmbedder` ignores HTTP entirely → runs Wasm locally. Alternatives:

- **REJECT — try OpenRouter for embed first, fall back to local on 404** — fail-closed honesty per Inquebrável Rule 3: pretend OpenRouter does X then silently fall back is misleading. Be explicit: embed = local in this mode.
- **REJECT — ship an `OpenRouterEmbedder` wrapper that routes embed elsewhere (e.g., Voyage)** — adds an additional provider (Voyage) to the contract, multiplying surface area. Out of scope.
- **ACCEPT — split: OpenRouter for chat, local Xenova for embed.**

**Consequences:**
- Demo's `THEOMEM_DEMO_BACKEND=local-openrouter` mode is honest about the split: chat via OpenRouter (network), embed via local Wasm (offline after warmup).
- Documented in README: "Local embeddings, cloud-routed chat."
- Future cycle could add `OpenRouterEmbedder` when OpenRouter ships embed support; not blocked by this plan.

### D5 — `OPENAI_BASE_URL` respected by SDK natively; ZERO src/llms/openai.ts code change

**Decision:** No change to `src/llms/openai.ts` or `src/embedders/openai.ts`. The OpenAI Node SDK (`openai@^4.x`) reads `process.env.OPENAI_BASE_URL` automatically in the `OpenAI` class constructor (verified at `node_modules/openai/index.mjs:46`). Setting the env var before module load is sufficient.

**Rationale:** The native SDK behavior is the canonical mechanism. Adding a constructor `baseURL?: string` param would (a) duplicate functionality the SDK already provides via env var, (b) require non-trivial wiring in the singleton + lazy-init pattern, (c) break the "Cycle 2 MOVE-only" discipline that locked Cycle 2 behavioral parity. Alternatives:

- **REJECT — add `OpenAILLM({ baseURL?: string })` constructor option** — duplicates SDK env-var support. Cycle 2 ADR D3 (MOVE-only) is the relevant precedent.
- **REJECT — wrap `OpenAI` client construction in a factory that injects `baseURL`** — same duplication; less idiomatic; harder to discover.
- **ACCEPT — document the env-var path; demo wires it explicitly.**

**Consequences:**
- ZERO SDK code change for LLM-routing item (the user's original scope item 1).
- Demo `next dev` invocation now reads `OPENAI_BASE_URL` from `.env`/`.env.local` and the SDK picks it up automatically.
- Integration test (T4.1) validates the routing against the demo HTTP surface; the LLM call landing on the configured base URL is observed via the OpenAILLM lazy singleton + standard SDK behavior (no mock layer required since the demo's running dev server exercises the path end-to-end).

### D6 — Demo singleton extends `adapterSource` union; new env var `THEOMEM_DEMO_BACKEND` selects mode

**Decision:** `examples/chat-with-memory/lib/memory.ts` `MemorySingleton.adapterSource` widens from `'stub' \| 'openai'` to `'stub' \| 'openai' \| 'local-openrouter'`. Mode selection precedence:

1. If `THEOMEM_DEMO_BACKEND === 'stub'` OR (legacy compat) `THEOMEM_USE_STUB_ADAPTERS === '1'` → `stub`
2. Else if `THEOMEM_DEMO_BACKEND === 'local-openrouter'` → `local-openrouter`
3. Else if `THEOMEM_DEMO_BACKEND === 'openai'` OR (default fallback when none set) → `openai`

**Rationale:** Existing `THEOMEM_USE_STUB_ADAPTERS=1` callers continue to work (legacy compat). New `THEOMEM_DEMO_BACKEND` is the canonical selector going forward; the doc deprecates `THEOMEM_USE_STUB_ADAPTERS` in favor of the new name (sunset 2026-09-01). The 3rd value `local-openrouter` is what unblocks the user's actual scenario.

`getConflictResolutionPolicy('llm-judged-merge')` continues to reject when `adapterSource === 'stub'` (existing v0.7 EC-1 guard). For `local-openrouter`, the LLM is `OpenAILLM` (routed to OpenRouter) which can do JSON-judged merges — so LJM is allowed. The check at `lib/memory.ts:269` reads `if (singleton.adapterSource === "stub")` — that condition naturally widens correctly.

**Alternatives considered:**

- **REJECT — replace `THEOMEM_USE_STUB_ADAPTERS` entirely with `THEOMEM_DEMO_BACKEND` in v1.0** — would break every existing dev/CI script that sets the legacy flag (search `.github/workflows/` + local scripts). Compat sunset gives a 90-day migration window.
- **REJECT — use a single env var with comma-separated overrides (e.g., `THEOMEM_OVERRIDES=embedder=stub,llm=openrouter`)** — over-engineered for 3 fixed combinations; harder to grep for; non-canonical compared to existing `THEOMEM_*` per-feature flags.
- **REJECT — auto-detect mode from `OPENAI_BASE_URL` presence (no new env var)** — implicit magic; opaque to operators reading `.env`. The explicit `THEOMEM_DEMO_BACKEND` is the honest signal of intent.
- **ACCEPT — explicit `THEOMEM_DEMO_BACKEND` with 3-value enum + legacy compat shim for `THEOMEM_USE_STUB_ADAPTERS`.**

**Consequences:**
- Demo gains 1 new backend; 3 total modes documented in README.
- `THEOMEM_USE_STUB_ADAPTERS` semantics preserved; new `THEOMEM_DEMO_BACKEND` is the forward path.
- `/api/info` route reflects the new mode in its JSON shape.

### D7 — Subpath export `@usetheo/memory/embedders/local` mirrors existing pattern

**Decision:** Add subpath export `./embedders/local` to `package.json#exports`, mirroring the existing `./embedders/stub` + `./embedders/openai` shape. Public via `import { LocalTransformerEmbedder } from '@usetheo/memory/embedders/local'`.

**Rationale:** Established pattern from Cycle 1 (stub) and Cycle 2 (openai). Consumers expect symmetry. The root `src/index.ts` does NOT re-export the new class (mirrors openai's path — openai is subpath-only too).

**Alternatives considered:**

- **REJECT — re-export `LocalTransformerEmbedder` from root `src/index.ts` barrel** — would force every consumer of `@usetheo/memory` to install `@xenova/transformers` (optionalDependency would become effectively required via tree-shake holes). Subpath-only matches existing OpenAIEmbedder discipline + lets `--no-optional` consumers skip the dep cleanly.
- **REJECT — single barrel under `./embedders` that exports all 3 (stub, openai, local)** — works mechanically but loses the per-provider isolation that lets bundlers tree-shake unused providers. Three subpaths is more idiomatic for optional providers.
- **ACCEPT — `./embedders/local` subpath mirroring `./embedders/openai` + `./embedders/stub`.**

**Consequences:**
- `package.json#exports` grows by one entry; no other surface change at the root index.
- TypeScript consumers `import` via the explicit subpath; auto-import in IDEs surfaces it.
- The publish-readiness integration test (`tests/integration/publish-readiness.test.ts`) MUST be extended in T1.2 to assert the new subpath resolves.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `openai` | `^4.x` (existing) | npm | LLM (chat) adapter — already shipped; reused via env-var override per ADR D5 |
| `pg` | `^8.x` (existing) | npm | Postgres driver — already shipped; required by `PgvectorStore` |
| `drizzle-orm` | `^0.45.x` (existing) | npm | Migration framework — `runMigrations` extension hooks on top |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| `@xenova/transformers` (NEW) | `^2.17.0` | npm | Evaluated: `fastembed-js` (REJECT — `node-gyp` build), Ollama (REJECT — daemon dep), Python `sentence-transformers` (REJECT — Python runtime), `llama.cpp` embed (REJECT — heavy binary). | Pure-Wasm runtime; Apache-2.0; broadest model catalog; ESM-first; Node + browser; no native build |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | This plan only adds; nothing removed |

## Dependency Graph

```
Phase 0 (SDK foundations) ──▶ Phase 1 (LocalTransformerEmbedder + subpath export)
   │                                       │
   ▼                                       ▼
Phase 2 (Demo singleton + /api/info wiring)
   │
   ▼
Phase 3 (README docs + CHANGELOG)
   │
   ▼
Final Phase: Integration Validation
```

Phase 0, 1, 2, 3 are strictly sequential — each depends on the prior. No parallelism opportunities.

---

## Phase 0: SDK Foundations — parametric embedding dim

**Objective:** Make `LocalMemoryConfig`, `PgvectorStore`, and `runMigrations` parametric on embedding dimension, with full backward compatibility (default = 1536).

### T0.1 — Add `embeddingDim?: number` to `LocalMemoryConfig` + probe assertion uses config

#### Objective
Add an optional `embeddingDim?: number` field to `LocalMemoryConfig`. The probe in `createLocalMemory` asserts the embedder's output length matches the configured dim (default 1536).

#### Evidence
Today's probe at `src/local/index.ts:8-15` asserts `vector.length === MAX_EMBEDDING_DIM` (hard-coded 1536). A 384-dim embedder throws `EmbeddingMismatch` at boot. Sub-goal 2 + ADR D2 absorption.

#### Files to edit
```
src/local/index.ts — extend LocalMemoryConfig interface; probe reads config.embeddingDim ?? MAX_EMBEDDING_DIM
src/local/__tests__/factory.test.ts — RED test added first: createLocalMemory with embeddingDim=384 + 384-dim stub embedder passes probe
src/core/errors.ts — extend EmbeddingMismatch error message to include the configured dim (not just MAX_EMBEDDING_DIM)
```

#### Deep file dependency analysis
- `src/local/index.ts` defines `LocalMemoryConfig` interface (the type of `createLocalMemory`'s argument). Adding optional `embeddingDim` is purely additive; no callers break.
- `src/local/__tests__/factory.test.ts` is the existing test surface for `createLocalMemory` — adds new test cases without disturbing existing ones.
- `src/core/errors.ts:EmbeddingMismatch` is consumed by:
  - `src/local/index.ts` probe path
  - `tests/integration/local-runtime.test.ts` (verifies error type, not message)
  - No public consumer of the message text — extending the message is safe.

#### Deep Dives
- **Default value preservation invariant:** `createLocalMemory({ ...existingConfig })` (no `embeddingDim`) MUST produce identical behavior to today. Probe assertion: `effectiveDim = config.embeddingDim ?? MAX_EMBEDDING_DIM`.
- **Integer-only guard (EC-1 absorption):** validation MUST use `Number.isInteger(config.embeddingDim)` BEFORE the bound checks. JavaScript truthiness gotchas: `NaN <= 0` is `false`, `NaN > 1536` is `false`, `Infinity > 1536` is `true` (lucky catch but inconsistent), float `384.5` would pass arithmetic checks but produce invalid `vector(384.5)` SQL. The composite guard is: `if (config.embeddingDim !== undefined && (!Number.isInteger(config.embeddingDim) || config.embeddingDim <= 0 || config.embeddingDim > MAX_EMBEDDING_DIM)) throw new InvalidScope(\`embeddingDim must be a positive integer ≤ ${MAX_EMBEDDING_DIM}; got ${String(config.embeddingDim)}\`);`. The error message MUST include the literal received value (typeof-aware via `String()`) so the operator can diagnose.
- **Upper bound check:** if `config.embeddingDim > MAX_EMBEDDING_DIM`, throw `EmbeddingMismatch` BEFORE running probe (preserves the ADR D1.7 cap rationale — pgvector HNSW ≤ 2000-dim ceiling).
- **Negative / zero check:** if `config.embeddingDim <= 0`, throw `InvalidScope` (or a new dedicated error — defer naming to RED test design). 384 is the canonical small-dim choice but the field accepts any positive integer ≤ MAX_EMBEDDING_DIM.

#### Tasks
1. Extend `LocalMemoryConfig` with `readonly embeddingDim?: number;` (optional, defaults to MAX_EMBEDDING_DIM).
2. Update probe in `createLocalMemory`: `const effectiveDim = config.embeddingDim ?? MAX_EMBEDDING_DIM; if (probeResult.length !== effectiveDim) throw new EmbeddingMismatch(...)`.
3. Pre-flight validation: if `config.embeddingDim !== undefined && (config.embeddingDim <= 0 || config.embeddingDim > MAX_EMBEDDING_DIM)`, throw immediately with explicit message.
4. Update `EmbeddingMismatch` error message to interpolate the configured dim.

#### TDD
```
RED:     test_createLocalMemory_accepts_embeddingDim_384_with_matching_stub_embedder() — passes probe
RED:     test_createLocalMemory_rejects_embeddingDim_0_with_invalid_scope() — throws before probe
RED:     test_createLocalMemory_rejects_embeddingDim_above_MAX_with_explicit_message() — throws before probe
RED:     test_createLocalMemory_rejects_embeddingDim_NaN_with_explicit_message() — EC-1 (Number.isInteger guard)
RED:     test_createLocalMemory_rejects_embeddingDim_float_384_5_with_explicit_message() — EC-1
RED:     test_createLocalMemory_rejects_embeddingDim_Infinity_with_explicit_message() — EC-1
RED:     test_createLocalMemory_error_message_includes_literal_received_value() — EC-1 UX (operator diagnosability)
RED:     test_createLocalMemory_preserves_default_1536_when_embeddingDim_omitted() — backward compat
RED:     test_EmbeddingMismatch_message_includes_configured_dim() — error UX
GREEN:   Extend interface + update probe + pre-flight check (Number.isInteger) + error message
REFACTOR: None expected (additive change)
VERIFY:  npm test -- src/local/__tests__/factory.test.ts
```

#### Acceptance Criteria
- [ ] `LocalMemoryConfig.embeddingDim` field exists as optional number
- [ ] Probe asserts against configured dim, not hard-coded 1536
- [ ] Pre-flight rejects `<= 0`, `> MAX_EMBEDDING_DIM`, **NaN, non-integer (e.g. 384.5), Infinity** with distinct error messages (EC-1 absorption)
- [ ] Error message includes the literal received value (`String(received)`) — EC-1
- [ ] All existing factory tests continue to PASS (backward compat)
- [ ] Pass: complexity — every changed file has cyclomatic complexity ≤ 10
- [ ] Pass: coverage — `npm run test:coverage` ≥ 90% on changed files
- [ ] Pass: lint — `npm run lint` zero warnings on changed files
- [ ] Pass: size — every changed file ≤ 500 lines

#### DoD
- [ ] All RED tests now GREEN
- [ ] `npm test -- src/local/__tests__/factory.test.ts` PASS
- [ ] `npm run typecheck` zero errors
- [ ] No regression in existing `src/local/__tests__/` suite

---

### T0.2 — `PgvectorStore({ embeddingDim? })` accepts dim; search guard reads from config

#### Objective
Extend `PgvectorStore` constructor to accept an optional `embeddingDim?: number` option. The search dimension guard at line 236 reads from the constructor option instead of the constant.

#### Evidence
`src/local/pgvector-store.ts:236` hard-codes `MAX_EMBEDDING_DIM` in the guard error message. After T0.1 ships, the probe enforces dim at the SDK boundary; the search guard needs to match to prevent dim drift.

#### Files to edit
```
src/local/pgvector-store.ts — constructor signature accepts options object; guard reads from this.embeddingDim
src/local/__tests__/pgvector-store.test.ts — RED test: PgvectorStore({ embeddingDim: 384 }) accepts 384-dim search vector
src/local/index.ts — createLocalMemory passes config.embeddingDim through to PgvectorStore constructor when caller uses pgvector backend
```

#### Deep file dependency analysis
- `src/local/pgvector-store.ts` constructor currently takes `(pool: pg.Pool)`. Widening to `(pool: pg.Pool, options?: { embeddingDim?: number })` is additive; existing callers `new PgvectorStore(pool)` continue to work.
- `src/local/index.ts` `createLocalMemory` instantiates the store. Plumbing config.embeddingDim through is mechanical.
- `tests/integration/pgvector-store.test.ts` (integration) — covered indirectly; no direct edit needed unless coverage requires.
- `src/local/index.ts` barrel re-exports `PgvectorStore` — public consumers `new PgvectorStore(pool)` continue to work without the new option.

#### Deep Dives
- **Constructor signature evolution:** preserve positional `pool` as first arg; add optional `options` as second. Avoids breaking call sites.
- **Default propagation:** if `options.embeddingDim` is undefined, use `MAX_EMBEDDING_DIM` (constant import preserved). The store stores the resolved value on a `private readonly embeddingDim: number` field.
- **Search guard rewrite:** `if (query.length !== this.embeddingDim) throw new EmbeddingMismatch(\`PgvectorStore.search: query vector dimension ${query.length} does not match configured ${this.embeddingDim}\`)`.

#### Tasks
1. Add `options?: { embeddingDim?: number }` to constructor.
2. Store `private readonly embeddingDim: number = options?.embeddingDim ?? MAX_EMBEDDING_DIM`.
3. Replace MAX_EMBEDDING_DIM in line-236 guard with `this.embeddingDim`.
4. Update `createLocalMemory` to pass `{ embeddingDim: config.embeddingDim }` to the constructor when instantiating PgvectorStore (in-memory store path unchanged).

#### TDD
```
RED:     test_pgvector_store_accepts_embeddingDim_384_in_constructor() — store instance exists with 384
RED:     test_pgvector_store_search_rejects_mismatched_query_dim() — guard fires when query.length !== this.embeddingDim
RED:     test_pgvector_store_defaults_to_MAX_when_options_omitted() — backward compat
RED:     test_createLocalMemory_pgvector_path_propagates_dim_to_store() — wiring is correct
GREEN:   Constructor signature + private field + guard rewrite + createLocalMemory plumbing
REFACTOR: None expected
VERIFY:  npm test -- src/local/__tests__/pgvector-store.test.ts src/local/__tests__/factory.test.ts
```

#### Acceptance Criteria
- [ ] Constructor accepts optional `{ embeddingDim }` option
- [ ] Search guard uses instance field, not constant
- [ ] All existing PgvectorStore tests PASS unchanged
- [ ] `createLocalMemory` correctly plumbs the config through
- [ ] Pass: complexity, coverage, lint, size (per Global DoD)

#### DoD
- [ ] All RED tests GREEN
- [ ] No regression in existing pgvector-store tests
- [ ] `npm run typecheck` zero errors

---

### T0.3 — `runMigrations(pool, { embeddingDim? })` post-migration ALTER COLUMN

#### Objective
Extend `runMigrations` to accept an optional `{ embeddingDim?: number }` second argument. When the requested dim differs from `MAX_EMBEDDING_DIM`, after Drizzle migrations apply, execute the **DROP+ALTER+RECREATE** sequence on both `memories` and `entities` columns INSIDE A SINGLE TRANSACTION (EC-3 + EC-4 absorption — verified empirically against `0000_crazy_mimic.sql:44,51`). Log the destructive transition to stderr.

#### Evidence
Drizzle migrations are static SQL with hard-coded `vector(1536)`. To support a 384-dim local embedder, the column type must be changed at runtime. ADR D3 documents the decision; T0.3 implements it. Two MUST FIX edge cases absorbed in v1.1: (EC-3) atomic transaction wraps both ALTERs; (EC-4) HNSW indexes `entities_embedding_hnsw_idx` + `memories_embedding_hnsw_idx` confirmed at `src/local/migrations/0000_crazy_mimic.sql:44,51` MUST be dropped before ALTER and recreated after, otherwise pgvector rejects the ALTER with `cannot alter type of a column used in an index`.

#### Files to edit
```
src/local/index.ts — runMigrations signature accepts second optional arg; helper function alterEmbeddingDim() executes post-migration ALTER
src/local/__tests__/migrations.test.ts (NEW or existing migrations test) — RED test: runMigrations(pool, { embeddingDim: 384 }) succeeds + column type is vector(384)
tests/integration/migrations/ — integration coverage against real pgvector (verifies the ALTER runs)
```

#### Deep file dependency analysis
- `src/local/index.ts` exports `runMigrations`. Signature widens additively. Existing callers `runMigrations(pool)` continue.
- Migration test file may or may not exist under `src/local/__tests__/migrations/`; if not, create it. Path is in vitest contract include glob.
- `tests/integration/migrations/` exists — extend with the new dim-change scenario. Path matches vitest integration include.
- Demo `examples/chat-with-memory/lib/memory.ts` calls `runMigrations(pgPool)` at line 103 — Phase 2 wires the optional dim through.

#### Deep Dives
- **ALTER COLUMN incompatibility:** pgvector `vector(N) → vector(M)` with N ≠ M does NOT preserve data even with `USING expression`. The `USING NULL` clause is the safest explicit data-drop. This is the ONLY way to change pgvector column dim short of `DROP COLUMN` + `ADD COLUMN`.
- **HNSW index conflict (EC-4 absorption — verified empirically):** `src/local/migrations/0000_crazy_mimic.sql:44,51` creates `entities_embedding_hnsw_idx` and `memories_embedding_hnsw_idx` (both `USING hnsw (embedding vector_cosine_ops)`). Postgres rejects `ALTER COLUMN TYPE` against a column with any index. The helper MUST execute the full sequence:
  ```sql
  BEGIN;
  DROP INDEX IF EXISTS memories_embedding_hnsw_idx;
  DROP INDEX IF EXISTS entities_embedding_hnsw_idx;
  ALTER TABLE memories ALTER COLUMN embedding TYPE vector(${dim}) USING NULL;
  ALTER TABLE entities ALTER COLUMN embedding TYPE vector(${dim}) USING NULL;
  CREATE INDEX memories_embedding_hnsw_idx ON memories USING hnsw (embedding vector_cosine_ops);
  CREATE INDEX entities_embedding_hnsw_idx ON entities USING hnsw (embedding vector_cosine_ops);
  COMMIT;
  ```
- **Atomic transaction discipline (EC-3 absorption):** the entire 6-statement sequence above runs inside a single `BEGIN/COMMIT`. On any failure (`DROP INDEX`, `ALTER COLUMN`, `CREATE INDEX`), the helper catches, executes `ROLLBACK`, and re-throws — preserving the pre-ALTER schema atomically. Without the transaction wrap, a mid-sequence failure leaves the DB in an inconsistent state (e.g., indexes dropped + columns still 1536-dim) requiring manual recovery.
- **Idempotency:** if the column is ALREADY `vector(${dim})`, the helper short-circuits — checks current `atttypmod` via `pg_attribute` BEFORE the ALTER sequence. If atttypmod matches the requested dim, skip the entire DROP+ALTER+RECREATE. Saves time + avoids gratuitous index churn on a no-op call.
- **Logging:** `console.error` (stderr) per Inquebrável "log structured" convention — visible in dev server log + CI output. Three log lines: (1) pre-transaction `[runMigrations] WARN: dim change ${old} → ${new} truncates existing embeddings + drops/recreates HNSW indexes`, (2) post-transaction `[runMigrations] dim change complete: column types vector(${new}) + indexes recreated`, (3) on rollback `[runMigrations] ERROR: dim change rolled back; schema preserved at vector(${old})`. NO emojis (per CLAUDE.md).
- **Drizzle migration order:** the helper runs Drizzle `migrate()` FIRST (using its own internal transaction); the DROP+ALTER+RECREATE transaction is SEPARATE and runs AFTER. The Drizzle journal `drizzle.__drizzle_migrations` remains consistent because the post-migration ALTER is invisible to Drizzle (no migration file hash registered for it).

#### Tasks
1. Add `options?: { embeddingDim?: number }` to `runMigrations` signature.
2. After Drizzle `migrate()` returns, if `options?.embeddingDim !== undefined && options.embeddingDim !== MAX_EMBEDDING_DIM`:
   - Open a new client from the pool
   - Probe current `atttypmod` from `pg_attribute` for `memories.embedding`; if it already matches `options.embeddingDim`, log "no-op" and return (idempotency short-circuit)
   - Log `[runMigrations] WARN: dim change ${MAX_EMBEDDING_DIM} → ${options.embeddingDim} truncates existing embeddings + drops/recreates HNSW indexes`
   - Execute `BEGIN`
   - In a try block: `DROP INDEX IF EXISTS memories_embedding_hnsw_idx`, `DROP INDEX IF EXISTS entities_embedding_hnsw_idx`, then the 2 `ALTER COLUMN TYPE ... USING NULL`, then the 2 `CREATE INDEX ... USING hnsw ... vector_cosine_ops`
   - On try success: `COMMIT` + log success
   - On catch: `ROLLBACK` + log error + rethrow
   - Always close the client in `finally`
3. Preserve the existing orphan-schema warning path (architecture.md § 10.2) — no regression.

#### TDD
```
RED:     test_runMigrations_accepts_embeddingDim_384() — runs without error
RED:     test_runMigrations_alters_column_to_vector_384_when_requested() — \d memories shows vector(384) after run
RED:     test_runMigrations_logs_warn_on_destructive_dim_change() — stderr captures warning string
RED:     test_runMigrations_no_op_when_embeddingDim_matches_default() — no ALTER emitted
RED:     test_runMigrations_preserves_existing_signature_backward_compat() — runMigrations(pool) works unchanged
RED:     test_runMigrations_recreates_HNSW_indexes_after_dim_change() — EC-4: both *_embedding_hnsw_idx exist post-ALTER with vector(384)
RED:     test_runMigrations_atomic_rollback_on_mid_sequence_failure() — EC-3: simulated ALTER failure leaves schema at original 1536-dim + indexes intact
RED:     test_runMigrations_idempotent_when_called_twice_with_same_dim() — atttypmod short-circuit; no gratuitous DROP/CREATE
RED:     test_runMigrations_short_circuit_logs_noop_when_atttypmod_matches() — observability of the fast path
GREEN:   Add second arg + atttypmod probe + DROP+ALTER+RECREATE inside BEGIN/COMMIT/ROLLBACK + log emission
REFACTOR: None expected
VERIFY:  npm test -- tests/integration/migrations/
```

#### Acceptance Criteria
- [ ] `runMigrations(pool, { embeddingDim: 384 })` succeeds against a fresh DB
- [ ] After execution, `\d memories` reports `vector(384)` AND `\d` shows `memories_embedding_hnsw_idx` recreated (EC-4)
- [ ] After execution, `\d entities` reports `vector(384)` AND `\d` shows `entities_embedding_hnsw_idx` recreated (EC-4)
- [ ] Stderr captures the dim-change warning string + post-success log + (when failure injected) rollback log
- [ ] Mid-sequence failure (e.g., simulate CREATE INDEX error) → `ROLLBACK` executed; schema preserved at vector(1536) + both HNSW indexes intact (EC-3)
- [ ] Idempotent: second call with same dim short-circuits via `atttypmod` check; no gratuitous DROP/CREATE
- [ ] `runMigrations(pool)` (no options) continues to produce vector(1536)
- [ ] Orphan-schema warning path untouched
- [ ] Pass: complexity, coverage, lint, size

#### DoD
- [ ] All RED tests GREEN
- [ ] Integration test against real pgvector (`docker run ankane/pgvector:v0.5.1`) confirms ALTER
- [ ] No regression in existing migration tests

---

## Phase 1: LocalTransformerEmbedder + subpath export

### T1.1 — Ship `LocalTransformerEmbedder` implementing `Embedder` DIP

#### Objective
Create `src/embedders/local.ts` exporting `LocalTransformerEmbedder` (implements `Embedder` from `src/core/dip/embedder.ts`). Uses `@xenova/transformers` with default model `Xenova/all-MiniLM-L6-v2` (384-dim). Lazy singleton pipeline (model loads once per process at first `embed()` call).

#### Evidence
SDK has only `OpenAIEmbedder` (1536, network) + `DeterministicStubEmbedder` (1536, hash-based). Demo needs a real local embedder. Sub-goal 1 above + ADR D1.

#### Files to edit
```
src/embedders/local.ts — NEW: LocalTransformerEmbedder class
src/embedders/__tests__/local.test.ts — NEW: RED tests for embed + embedBatch + dim + determinism + probe text
src/embedders/index.ts — re-export LocalTransformerEmbedder (sibling pattern to existing barrel)
package.json — add @xenova/transformers to optionalDependencies (NEW dep per ADR D1)
```

#### Deep file dependency analysis
- `src/embedders/local.ts` (NEW) imports `Embedder` from `../core/dip/embedder.js` (DIP boundary respected). Imports `pipeline` from `@xenova/transformers`. No other internal deps.
- `src/embedders/__tests__/local.test.ts` (NEW) uses Vitest fixtures. Tests run against the actual Xenova model (model download on first run; CI cache it after first job).
- `src/embedders/index.ts` (existing barrel) gains a re-export line. Pattern: `export { LocalTransformerEmbedder } from './local.js';`
- `package.json` gains a new entry under `optionalDependencies`. May or may not require also adding it to `devDependencies` for test-time resolution — confirm in RED test phase.

#### Deep Dives
- **Lazy singleton pipeline:** module-level `let _pipeline: Promise<FeatureExtractionPipeline> | null = null;` that is set on first `embed()` or `embedBatch()` call via `pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')`. Mirror precedent of `OpenAIEmbedder.client()` pattern.
- **Model parameter (deferred to default):** constructor accepts no model parameter in v1.0 (hard-codes `Xenova/all-MiniLM-L6-v2`). Future cycle can add `new LocalTransformerEmbedder({ model: '...' })`. Per Cycle 2 ADR D3 precedent.
- **L2 normalization:** Xenova returns un-normalized vectors by default. Pass `{ pooling: 'mean', normalize: true }` to the pipeline so output cosine distance is well-defined (matches the StubEmbedder L2-normalization invariant).
- **Tensor → readonly number[]:** Xenova returns a Float32Array-backed Tensor. Convert via `Array.from(output.data)`. Output type matches the DIP signature exactly.
- **Batch:** `embedBatch(texts)` calls the pipeline with an array input. Pipeline natively batches. The output's `dims` field is `[batch_size, 384]`; chunk via `Array.from(output.data).slice(...)` per row. Verify in RED test.
- **Empty batch:** `embedBatch([])` returns `[]` without invoking the pipeline (matches existing OpenAIEmbedder behavior).
- **No `model: string` in JSDoc text** — keep neutral wording per `no-paper-names-in-code.md`: describe as "transformer-based encoder running locally via Wasm" instead of citing model paper name.

#### Tasks
1. Run `npm install --save-optional @xenova/transformers@^2.17.0`
2. Create `src/embedders/local.ts` with the class + lazy pipeline
3. Create `src/embedders/__tests__/local.test.ts` with the RED tests
4. Re-export from `src/embedders/index.ts`
5. Verify `npm test -- src/embedders/__tests__/local.test.ts` runs (may require Vitest config tweak for ESM-only @xenova — defer to GREEN if surfaces)

#### TDD
```
RED:     test_LocalTransformerEmbedder_embed_returns_384_dim_vector() — output.length === 384
RED:     test_LocalTransformerEmbedder_embed_is_pure_same_input_same_output() — determinism
RED:     test_LocalTransformerEmbedder_embed_distinct_inputs_distinct_outputs() — basic collision sanity
RED:     test_LocalTransformerEmbedder_embedBatch_preserves_order() — order invariant
RED:     test_LocalTransformerEmbedder_embedBatch_empty_returns_empty() — empty case
RED:     test_LocalTransformerEmbedder_embed_output_is_L2_normalized() — ||v|| ≈ 1.0 ± 1e-6
RED:     test_LocalTransformerEmbedder_probe_text_returns_correct_dim() — '__themem_probe__' yields 384
GREEN:   Implement class + lazy pipeline + tensor → array conversion
REFACTOR: None expected (mirror OpenAIEmbedder shape)
VERIFY:  npm test -- src/embedders/__tests__/local.test.ts
```

#### Acceptance Criteria
- [ ] `LocalTransformerEmbedder` class exists and exports correctly
- [ ] `embed(text)` returns `readonly number[]` of length 384
- [ ] `embedBatch(texts)` returns rows of length 384 in input order
- [ ] L2 norm of each output vector is 1.0 ± 1e-6
- [ ] Empty batch returns empty
- [ ] Probe text yields valid output
- [ ] `@xenova/transformers` is in `optionalDependencies` (NOT `dependencies`)
- [ ] JSDoc on the class mentions: (i) lazy singleton, (ii) optional dep guidance for `--no-optional` consumers, (iii) first-use model download caveat, (iv) NO paper name in description
- [ ] Pass: complexity, coverage, lint, size (file ≤ 500 LoC; estimated ~80)

#### DoD
- [ ] All RED tests GREEN
- [ ] `npm test -- src/embedders/__tests__/local.test.ts` PASS
- [ ] `npm run typecheck` zero errors
- [ ] First-run model download succeeds (manually verified locally; CI may need cache warmup hint in T4.1)

---

### T1.2 — Subpath export `@usetheo/memory/embedders/local`

#### Objective
Add `"./embedders/local"` to `package.json#exports` mirroring `./embedders/openai` + `./embedders/stub` shape. Extend `tests/integration/publish-readiness.test.ts` to assert the new subpath resolves at consumer-side.

#### Evidence
Sub-goal 8 above + ADR D7. Without this, consumers cannot do `import { LocalTransformerEmbedder } from '@usetheo/memory/embedders/local'`.

#### Files to edit
```
package.json — add ./embedders/local subpath entry under exports
tests/integration/publish-readiness.test.ts — RED test: subpath resolves
tests/integration/public-paths.test.ts — RED test (may overlap publish-readiness): import path resolves at runtime
```

#### Deep file dependency analysis
- `package.json` change is purely declarative. `exports` map gains one new entry; no other field touched.
- `tests/integration/publish-readiness.test.ts` already exercises the publish surface. Extending with the new path is a 2-line addition.
- `tests/integration/public-paths.test.ts` exercises import resolution. Check whether it's the right home for the new RED test vs publish-readiness — defer to test-design step.

#### Deep Dives
- **Exports shape (mirror precedent):**
  ```json
  "./embedders/local": {
    "types": "./src/embedders/local.ts",
    "default": "./src/embedders/local.ts"
  }
  ```
- **No `package.json` build step required.** The repo ships TypeScript sources directly per existing exports pattern.

#### Tasks
1. Add the new subpath entry to `package.json#exports`.
2. RED tests at the integration tier asserting the import path resolves.
3. GREEN: just the package.json edit — tests should now pass.

#### TDD
```
RED:     test_subpath_embedders_local_resolves_via_publish_readiness() — pkg.exports['./embedders/local'] defined
RED:     test_subpath_embedders_local_imports_class_at_runtime() — dynamic import returns LocalTransformerEmbedder
GREEN:   package.json#exports edit
REFACTOR: None
VERIFY:  npm test -- tests/integration/publish-readiness.test.ts tests/integration/public-paths.test.ts
```

#### Acceptance Criteria
- [ ] `package.json#exports./embedders/local` entry exists with `types` + `default`
- [ ] RED tests now GREEN
- [ ] `npm pack --dry-run` lists `src/embedders/local.ts` in the tarball
- [ ] Pass: complexity, coverage, lint, size

#### DoD
- [ ] `import { LocalTransformerEmbedder } from '@usetheo/memory/embedders/local'` works from the demo
- [ ] No regression in existing subpath-related tests

---

## Phase 2: Demo singleton + /api/info wiring

### T2.1 — `lib/memory.ts` adds `local-openrouter` backend; `THEOMEM_DEMO_BACKEND` env var selects

#### Objective
Extend `examples/chat-with-memory/lib/memory.ts` to support 3 backends: `stub`, `openai`, `local-openrouter`. The new env var `THEOMEM_DEMO_BACKEND` is the canonical selector; `THEOMEM_USE_STUB_ADAPTERS=1` continues to work as legacy compat.

#### Evidence
Sub-goal 5 above + ADR D6. The current `resolveAdapters` at line 165-169 has 2 branches; this task adds a 3rd.

#### Files to edit
```
examples/chat-with-memory/lib/memory.ts — extend resolveAdapters + MemorySingleton + getSingleton with local-openrouter mode + EC-11 unknown-value validation
tests/unit/examples/chat-with-memory-memory.test.ts (NEW) — RED tests for 3-way precedence (EC-13 absorption: path moved from examples/chat-with-memory/lib/__tests__/memory.test.ts — UNREACHABLE per vitest.contract.config.ts:5-9 — to tests/unit/examples/ which matches the 'tests/unit/**/*.test.ts' include glob)
tests/integration/examples/chat-with-memory-local-openrouter.test.ts (NEW) — integration test against demo HTTP surface
```

#### Deep file dependency analysis
- `examples/chat-with-memory/lib/memory.ts` currently has `resolveAdapters()` returning `{ embedder, llm, source }` with a 2-branch ternary. Add a 3-way precedence ladder.
- The factory currently calls `runMigrations(pgPool)` at line 103 (inside `buildStore`). When backend is `local-openrouter`, must call `runMigrations(pgPool, { embeddingDim: 384 })` per T0.3.
- `MemorySingleton` interface widens: `adapterSource: 'stub' | 'openai' | 'local-openrouter'`.
- New `/api/info` route (T2.2) reads from this surface.

#### Deep Dives
- **Mode precedence with EC-11 absorption (ADR D6 + EC-11):**
  ```ts
  function resolveBackendMode(): 'stub' | 'openai' | 'local-openrouter' {
    const raw = process.env.THEOMEM_DEMO_BACKEND;
    // EC-11: validate unknown values BEFORE precedence ladder; loud-fail per Inquebrável Rule 3.
    if (raw !== undefined && raw !== '' && !['stub', 'openai', 'local-openrouter'].includes(raw)) {
      throw new Error(
        `Invalid THEOMEM_DEMO_BACKEND='${raw}'; expected one of stub / openai / local-openrouter`,
      );
    }
    if (raw === 'stub') return 'stub';
    if (process.env.THEOMEM_USE_STUB_ADAPTERS === '1') return 'stub';  // legacy
    if (raw === 'local-openrouter') return 'local-openrouter';
    if (raw === 'openai') return 'openai';
    return 'openai';  // default when unset
  }
  ```
  Per EC-11 absorption (verified anti-pattern from v0.7 cycle EC-3): unknown values like `local_openrouter` (underscore typo) or `OPENROUTER` would silently fall through to `openai` default, making the operator believe local-mode is active. Loud-fail at boot is the only honest path.
- **`local-openrouter` factory:**
  - Embedder: `new LocalTransformerEmbedder()` (384-dim, Xenova)
  - LLM: `new OpenAILLM()` — SDK auto-reads `OPENAI_BASE_URL` env (set externally to `https://openrouter.ai/api/v1`)
  - `embeddingDim`: 384 propagated to `createLocalMemory` config + `runMigrations` options
- **`buildStore` modification:** accept `embeddingDim?: number` param. When set, pass to `runMigrations` + `PgvectorStore` constructor.
- **`adapterSource` widening:** `getConflictResolutionPolicy('llm-judged-merge')` at line 269 currently rejects `'stub'`. The condition `if (singleton.adapterSource === 'stub')` naturally widens correctly — `'local-openrouter'` is NOT stub, so LJM proceeds. The OpenAILLM (routed via OpenRouter) handles JSON-judged-merge correctly via EC-10 graceful degradation.
- **Eviction interaction:** existing `THEOMEM_EVICTION_DEMO=1` continues to work for all 3 backends (eviction config doesn't depend on adapter source).

#### Tasks
1. Add `resolveBackendMode()` helper with 3-way precedence ladder.
2. Add `resolveAdaptersForMode(mode)` that returns the right embedder/llm + dim.
3. Plumb `embeddingDim` through `buildStore` → `runMigrations` → `PgvectorStore`.
4. Widen `MemorySingleton.adapterSource` union type.
5. Update console log at line 191 to print the new mode.

#### TDD
```
RED:     test_resolveBackendMode_prefers_THEOMEM_DEMO_BACKEND_over_legacy_stub_flag()
RED:     test_resolveBackendMode_legacy_stub_flag_still_works_for_backward_compat()
RED:     test_resolveBackendMode_defaults_to_openai_when_no_env_set()
RED:     test_resolveBackendMode_returns_local_openrouter_when_explicit()
RED:     test_resolveBackendMode_throws_on_unknown_value_local_underscore_openrouter() — EC-11
RED:     test_resolveBackendMode_throws_on_unknown_value_UPPERCASE() — EC-11
RED:     test_resolveBackendMode_throws_on_unknown_value_typo() — EC-11
RED:     test_resolveBackendMode_error_message_lists_valid_values() — EC-11 (operator diagnosability)
RED:     test_local_openrouter_adapters_uses_LocalTransformerEmbedder_plus_OpenAILLM()
RED:     test_local_openrouter_propagates_embeddingDim_384_to_runMigrations()
RED:     test_local_openrouter_propagates_embeddingDim_384_to_PgvectorStore()
RED:     test_adapterSource_union_includes_local_openrouter()
GREEN:   Extend resolveAdapters + buildStore + getSingleton + types + EC-11 validation
REFACTOR: None expected
VERIFY:  npm test -- tests/unit/examples/chat-with-memory-memory.test.ts
```

#### Acceptance Criteria
- [ ] `THEOMEM_DEMO_BACKEND=local-openrouter` → singleton.adapterSource === 'local-openrouter'
- [ ] `THEOMEM_USE_STUB_ADAPTERS=1` still works (legacy compat preserved)
- [ ] Default (no env set) → `openai` mode (preserves current behavior)
- [ ] **Unknown values (typo, casing, underscore-instead-of-dash) throw `Error` at boot with message listing valid values (EC-11)**
- [ ] `local-openrouter` mode wires LocalTransformerEmbedder + OpenAILLM + dim=384 through the SDK chain
- [ ] **Unit tests live at `tests/unit/examples/chat-with-memory-memory.test.ts` — reachable by vitest contract include `tests/unit/**/*.test.ts` (EC-13)**
- [ ] Existing 2-mode tests in memory.test.ts continue PASS
- [ ] Pass: complexity, coverage, lint, size (file budget: 280 → ~340 LoC after EC-11 validation block)

#### DoD
- [ ] All RED tests GREEN
- [ ] `npm run typecheck` zero errors in demo
- [ ] No regression in existing demo unit tests

---

### T2.2 — `/api/info` route returns `adapterSource` + `embedderDim`

#### Objective
Extend the existing `/api/info` route to return `{ adapterSource, embedderDim }` (plus existing fields). UI panel that displays runtime info reads the new fields.

#### Evidence
Sub-goal 6 above. The integration test in T4.1 verifies `/api/info` returns the right shape after `THEOMEM_DEMO_BACKEND=local-openrouter`.

#### Files to edit
```
examples/chat-with-memory/app/api/info/route.ts — extend GET response with adapterSource + embedderDim
examples/chat-with-memory/components/info-panel.tsx (or equivalent UI consumer) — render new fields
```

#### Deep file dependency analysis
- `/api/info` GET handler likely already returns backend info. Extend to surface adapterSource from singleton + embedderDim (derived from singleton.memory's config or directly from a new singleton field).
- UI panel may not exist as a named component; if `/api/info` is consumed in the sidebar, search for the fetch call.

#### Deep Dives
- **New singleton field:** `MemorySingleton.embedderDim: number` — populated by `resolveAdaptersForMode`. Default 1536 for `openai`/`stub`; 384 for `local-openrouter`.
- **JSON shape:** `{ backend: 'pgvector' | 'in-memory', adapterSource: 'stub' | 'openai' | 'local-openrouter', embedderDim: 1536 | 384, eviction: EvictionState }`.

#### Tasks
1. Add `embedderDim` to MemorySingleton interface.
2. Extend `/api/info` GET to include the two fields.
3. Update UI consumer to render them.

#### TDD
```
RED:     test_api_info_returns_adapterSource_local_openrouter_in_local_mode()
RED:     test_api_info_returns_embedderDim_384_in_local_mode()
RED:     test_api_info_returns_adapterSource_openai_in_openai_mode()
RED:     test_api_info_returns_embedderDim_1536_in_openai_mode()
GREEN:   Extend route + singleton field
REFACTOR: None expected
VERIFY:  npm test -- tests/integration/examples/chat-with-memory-info.test.ts
```

#### Acceptance Criteria
- [ ] `/api/info` returns adapterSource + embedderDim
- [ ] UI panel displays the new fields
- [ ] Existing /api/info consumers tolerate the additive fields
- [ ] Pass: complexity, coverage, lint, size

#### DoD
- [ ] All RED tests GREEN
- [ ] Browser smoke check confirms panel renders new fields

---

## Phase 3: README + CHANGELOG

### T3.1 — `examples/chat-with-memory/README.md` documents 3 modes + OpenRouter setup

#### Objective
Extend the demo README with: (a) the 3 backend modes (stub / openai / local-openrouter), (b) how to set `OPENAI_BASE_URL=https://openrouter.ai/api/v1` for OpenRouter, (c) first-use Xenova model download expectation, (d) destructive-dim-change caveat when switching from openai to local-openrouter (memories vanish).

#### Evidence
Sub-goal 7 above. Without docs, the new backend is undiscoverable.

#### Files to edit
```
examples/chat-with-memory/README.md — add ### Backend modes section (3 modes table + env var matrix + OpenRouter recipe)
examples/chat-with-memory/.env.example — add THEOMEM_DEMO_BACKEND + OPENAI_BASE_URL placeholders (with comments)
CHANGELOG.md — append [Unreleased] § Added entry documenting LocalTransformerEmbedder + parametric embeddingDim + local-openrouter demo backend (Inquebrável Rule 6)
```

#### Deep file dependency analysis
- README has existing structure (Status, Quickstart, etc.). New section sits under Quickstart or Configuration.
- `.env.example` gains commented placeholders.

#### Deep Dives
- **3 mode table:**
  ```
  | Mode | Embedder | LLM | Network | Dim |
  | stub | stub (deterministic) | stub | none | 1536 |
  | openai | OpenAI text-embedding-3-small | OpenAI gpt-4o-mini | OpenAI API | 1536 |
  | local-openrouter | LocalTransformer (Xenova MiniLM) | OpenRouter (any chat-compat) | OpenRouter for chat; LOCAL for embed | 384 |
  ```
- **OpenRouter setup recipe:**
  ```
  # in .env.local:
  OPENAI_API_KEY=sk-or-v1-...your-openrouter-key
  OPENAI_BASE_URL=https://openrouter.ai/api/v1
  THEOMEM_DEMO_BACKEND=local-openrouter
  THEOMEM_PG_URI=postgresql://themem:themem@localhost:5432/themem
  ```
- **Destructive-dim caveat (ADR D3):**
  > If you previously ran with `THEOMEM_DEMO_BACKEND=openai` (1536-dim embeddings persisted), switching to `local-openrouter` (384-dim) drops all existing embedding data. Either start with a fresh DB or accept the truncation.

#### Tasks
1. Add the Backend modes section to README.md
2. Update `.env.example` with the 3 new env vars + comments
3. Document the first-use Xenova model download (~22 MB, one-time, internet required)

#### TDD
```
RED:     N/A (documentation task)
GREEN:   N/A
REFACTOR: N/A
VERIFY:  Manual: grep -E "local-openrouter|OPENAI_BASE_URL|@xenova" examples/chat-with-memory/README.md
```

#### Acceptance Criteria
- [ ] README has explicit Backend modes section
- [ ] OpenRouter recipe is present + copy-pasteable
- [ ] Xenova warmup caveat is documented
- [ ] Destructive-dim caveat is documented
- [ ] `.env.example` lists the 3 new env vars
- [ ] `CHANGELOG.md` § Unreleased § Added has a new entry citing this cycle's deliverables (LocalTransformerEmbedder + parametric embeddingDim + local-openrouter demo backend)

#### DoD
- [ ] README reads cleanly to a new operator
- [ ] No regression in other README content

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Chat fails with OpenRouter (embed 429) | T1.1 + T1.2 | LocalTransformerEmbedder (384-dim Xenova) replaces OpenAIEmbedder for local-openrouter mode |
| 2 | LLM hard-coded to api.openai.com | ADR D5 (no-code) + T2.1 (wire env var) | OpenAI SDK respects OPENAI_BASE_URL natively; demo sets it in local-openrouter mode |
| 3 | Schema vector(1536) blocks dim < 1536 | T0.3 | runMigrations(pool, { embeddingDim: 384 }) post-migration ALTER COLUMN |
| 4 | SDK probe rejects dim != 1536 | T0.1 | LocalMemoryConfig.embeddingDim optional; probe reads config |
| 5 | PgvectorStore search guard hard-coded | T0.2 | Constructor accepts optional embeddingDim; guard reads from instance field |
| 6 | Demo singleton has no local option | T2.1 | Add local-openrouter branch + THEOMEM_DEMO_BACKEND env var |
| 7 | Demo schema bootstrap needs new dim | T2.1 (wires) + T0.3 (SDK helper) | buildStore passes embeddingDim through to runMigrations |
| 8 | Subpath export embedders/local missing | T1.2 | package.json#exports entry + publish-readiness test |
| 9 | README lacks local-openrouter docs | T3.1 | Backend modes section + .env.example + OpenRouter recipe |
| 10 | End-to-end integration not validated | T4.1 (Final Phase) | Integration test against demo HTTP surface |
| 11 | Rule 9 — Xenova vs alternatives | T1.1 | Evaluation matrix in ADR D1 + materialized at T1.1 npm install step (4 alternatives evaluated + rejected) |
| 12 | CHANGELOG entry under [Unreleased] § Added | T3.1 | T3.1 README docs task extended to also append the CHANGELOG entry in the same PR per Inquebrável Rule 6 |
| 13 | New SDK config field discoverability | T0.1 (interface) + T1.2 (subpath) + T3.1 (docs) | Config field exported; subpath visible; README documents |
| 14 | Backward compat for existing 1536-dim callers | T0.1 (default) + T0.2 (default) + T0.3 (no-op when dim matches) | Defaults preserve every existing behavior |
| 15 | EmbeddingMismatch UX during dim mismatch | T0.1 | Error message interpolates configured dim |
| 16 | Destructive ALTER documented | ADR D3 + T3.1 | Caveat explicit in README; logger emits warning |
| 17 | OpenAI SDK native OPENAI_BASE_URL discovery for ops | ADR D5 + T3.1 | Documented in README + ADR |
| 18 | `/api/info` reflects new mode + dim | T2.2 | Route + UI extended |
| 19 | EC-1 — NaN/float/Infinity dim values pass guard silently | T0.1 (v1.1 absorption) | `Number.isInteger` guard + literal value in error message |
| 20 | EC-3 — 2 ALTERs not atomic → partial schema state on failure | T0.3 (v1.1 absorption) | Single `BEGIN/COMMIT` transaction wrapping DROP+ALTER+RECREATE; `ROLLBACK` on catch |
| 21 | EC-4 — pgvector HNSW indexes block ALTER COLUMN TYPE | T0.3 (v1.1 absorption) | DROP HNSW indexes → ALTER → CREATE HNSW indexes inside same transaction |
| 22 | EC-11 — Unknown `THEOMEM_DEMO_BACKEND` value silently falls to openai | T2.1 (v1.1 absorption) | Pre-precedence validation throws `Error` listing valid values |
| 23 | EC-13 — Unit test path under examples/ unreachable by vitest config | T2.1 (v1.1 absorption) | Path moved to `tests/unit/examples/chat-with-memory-memory.test.ts` (matches existing include glob) |

**Coverage: 23/23 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed (Phase 0, Phase 1, Phase 2, Phase 3, Final Phase)
- [ ] All tests passing — `npm test` green (TypeScript)
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected (per `.claude/rules/architecture.md § Module hygiene`) — every changed file ≤ 500 LoC
- [ ] CHANGELOG.md updated under `[Unreleased]` (Inquebrável Rule 6) — single entry under § Added documenting the cycle's deliverables
- [ ] Backward compatibility preserved — `src/index.ts` public API + all existing subpath exports work without changes
- [ ] No paper names in code (per `no-paper-names-in-code.md`) — `LocalTransformerEmbedder` description is behavior-neutral
- [ ] No `Co-Authored-By` trailer in any commit
- [ ] Plan-specific criteria:
  - [ ] `LocalTransformerEmbedder` is sole new public class; `@xenova/transformers` is sole new dep
  - [ ] No SDK src/llms/openai.ts code change (ADR D5: native env-var support is the mechanism)
  - [ ] No SDK src/embedders/openai.ts code change (same; embed via OpenRouter is NOT supported)
  - [ ] Backward compat tests for 1536-dim path all green
- [ ] **Runtime-metric proof** — `/api/info` route returns the new `adapterSource: 'local-openrouter'` + `embedderDim: 384` JSON shape verbatim in integration test workload. Counter-style metric not applicable to this cycle (no new counters introduced).
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR is merged to `main`, move `.claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md` to `.claude/knowledge-base/plans/completed/`. Associated artifacts stay in original locations per `audit-trail-rotation.md`.

## Final Phase: Integration Validation (MANDATORY)

> This phase runs AFTER Phase 0, 1, 2, 3 are complete. The plan is NOT done until the integration validation chain passes.

**Objective:** Validate end-to-end that the `local-openrouter` mode powers the demo HTTP surface successfully — chat replies via OpenRouter, embeddings via local Xenova, distillation via the v0.7 surface that already shipped.

### T4.1 — Integration test against demo HTTP surface (local-openrouter mode)

#### Objective
Write `tests/integration/examples/chat-with-memory-local-openrouter.test.ts` exercising the full demo flow with `THEOMEM_DEMO_BACKEND=local-openrouter`. Skip via reachability probe when `localhost:3000/api/health` is unreachable (mirrors v0.7 cycle EC-2 pattern).

#### Files to edit
```
tests/integration/examples/chat-with-memory-local-openrouter.test.ts (NEW)
```

#### TDD
```
RED:     test_api_health_returns_200_when_local_openrouter_mode()
RED:     test_api_info_returns_adapterSource_local_openrouter_and_embedderDim_384()
RED:     test_api_chat_seeds_memory_with_384_dim_embedding()
RED:     test_api_memory_distill_with_last_write_wins_creates_consolidation_history_row()
GREEN:   Test file authored; tests run against external dev server (probe-skipif when not present)
VERIFY:  npm run dev (in another terminal) && npm test -- tests/integration/examples/chat-with-memory-local-openrouter.test.ts
```

#### Acceptance Criteria
- [ ] Test header documents the pre-condition: `npm run dev` with `THEOMEM_DEMO_BACKEND=local-openrouter` + `OPENAI_BASE_URL=https://openrouter.ai/api/v1`
- [ ] `describe.skipIf(!(await isReachable('http://localhost:3000/api/health')))` skips cleanly in CI
- [ ] All 4 RED test cases now GREEN against a running dev server
- [ ] Test runtime ≤ 60s (Xenova first-use download accounted for)

### Execution

Run the full validation chain:

```bash
npm test                            # unit + integration tests
npm run test:coverage               # coverage report
npm run typecheck                   # zero TS errors
npm run lint                        # zero lint warnings
```

If the project's smoke surface is present:

```bash
# In one terminal:
cd examples/chat-with-memory && \
  THEOMEM_DEMO_BACKEND=local-openrouter \
  OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
  OPENAI_API_KEY=sk-or-v1-... \
  THEOMEM_PG_URI=postgresql://themem:themem@localhost:5432/themem \
  npm run dev

# In another terminal:
npm test -- tests/integration/examples/chat-with-memory-local-openrouter.test.ts
```

### Acceptance Criteria

- [ ] All test suites green
- [ ] Coverage ≥ 90% on changed files
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] `/api/info` returns `adapterSource: 'local-openrouter'` + `embedderDim: 384`
- [ ] `/api/chat` succeeds in local-openrouter mode (chat completion lands via OpenRouter; first embed downloads Xenova model)
- [ ] `/api/memory/distill` policy=`last-write-wins` creates a `consolidation_history` row with policy_name='last-write-wins'
- [ ] No regression in existing test suites (v0.7 distillation tests continue to pass)

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing
2. Fix all plan-caused failures before declaring the plan complete
3. Re-run the validation chain to confirm fixes
4. Pre-existing issues are logged but do NOT block plan completion (document in PR description)
