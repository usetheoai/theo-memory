# Blueprint: Embedder registry + more providers

> Output of `/discover-execute embedder-registry`. Source plan: `.claude/knowledge-base/discoveries/plans/embedder-registry-plan.md`. 6/6 research questions answered against `.claude/knowledge-base/references/mem0` + the project's own `packages/core/src`. Decides the embedder registry/factory shape, the lazy-import + install-hint mechanism, the new fetch-based adapter set, the opt-in surface, and the test pattern for Roadmap Item 24.

**Slug:** `embedder-registry`
**Created:** 2026-06-22
**Verdict target:** SHIPPABLE_WITH_CAVEATS

## Context

Roadmap Item 24 needs a "string-keyed embedder registry with lazy dynamic-import + install-hint errors; ship 1-3 more first-party adapters to narrow the 3-vs-8 provider gap." TheMemory ships 3 `Embedder` adapters (`DeterministicStubEmbedder`, `OpenAIEmbedder`, `LocalTransformerEmbedder`), each subpath-exported + passed to `createLocalMemory({ embedder })` as a DIP INSTANCE — there is no string-keyed selection. mem0 solves this with `EmbedderFactory.provider_to_class` (`mem0/utils/factory.py`) + `load_class` (importlib) + `create(provider, config)`. The TS analog is a registry mapping a provider key → a lazy `() => import('./adapter.js')` loader (so the optional dep loads only when requested), with install-hint typed errors for SDK-based adapters whose dep is absent. Lazy-import + subpath isolation are shipped precedents (`@usetheo/memory/{cache-pg,reranker-local}`; `await import()` in `scoped-memory.ts:350`); typed install-hint errors mirror `EmbedderError` + `SkillExecutorUnavailableError` (`errors.ts:338,514`).

## Objective

Decide the registry/factory API + lazy-import mechanism, the install-hint error contract, the new-adapter set + dep policy, the opt-in surface, and the test pattern — so `/to-plan` produces an implementation plan with zero open architectural questions.

## Executive summary

Ship `createEmbedder(spec)` — an async factory mapping a provider key (`'stub' | 'openai' | 'local' | 'ollama' | 'voyage' | 'google'`) → a lazy `await import('./adapter.js')` → a constructed `Embedder`. The registry is a `Record<provider, loader>` of DYNAMIC imports, so `createEmbedder('ollama')` never pulls the `openai` SDK or `@xenova` — bundle isolation by construction (the existing static `embedders/index.ts` barrel keeps its direct-class re-exports for consumers who accept the dep). SDK-based loaders (`openai`, `local`) catch the missing-optional-dep error → throw `EmbedderUnavailableError` with an `npm install …` hint (mirroring `SkillExecutorUnavailableError`); an unknown provider key throws `EmbedderError` (mirroring mem0's unsupported-provider raise). Ship 3 NEW first-party adapters — **Ollama**, **Voyage**, **Google Gemini** — all over the Node-global `fetch` (ZERO new dependency; each unit-tested via an injected `fetch`/client stub), narrowing the catalog 3 → 6. The registry is ADDITIVE: `createLocalMemory({ embedder })` still takes a DIP instance; `createEmbedder` is the convenience string-keyed path (`embedder: await createEmbedder({ provider: 'ollama' })`). Each new adapter gets its own subpath (`@usetheo/memory/embedders/{ollama,voyage,google}`) + a bundle-isolation test.

---

## Coverage Corner 1 — Integration Tests

**Q6 — How does mem0 test embedders?** (`.claude/knowledge-base/references/mem0/tests/embeddings/`)

mem0 STUBS the client (the SDK / HTTP) and asserts the request shape + the mapped response: a test constructs the embedder with a mocked client, calls `embed(text)`, and asserts (a) the client was called with the right model + input, (b) the returned vector matches the stubbed `data[0].embedding`/`embeddings`. No live API in unit tests.

**Borrowed test pattern for TheMemory:** each new fetch-based adapter takes an INJECTABLE `fetch` (constructor option defaulting to global `fetch`); the unit test passes a stub `fetch` returning a canned JSON body + asserts (a) the request URL/headers/body (model, input, api-key header), (b) the parsed embedding vector, (c) the empty-batch short-circuit, (d) an HTTP-error → typed throw. The registry test asserts `createEmbedder('ollama')` returns an `OllamaEmbedder` (lazy-import resolves) + `createEmbedder('bogus')` throws `EmbedderError` + `createEmbedder('openai')` with the SDK absent throws `EmbedderUnavailableError` (simulated via a stubbed import failure). ONE integration smoke per adapter, gated on a key / a running Ollama (skipIf), mirrors the `adapters-or-local-e2e-smoke` precedent.

---

## Coverage Corner 2 — Dependencies

**Q2 + ADR D3 — per-adapter dep verdict.** (`mem0/embeddings/{ollama,gemini,together}.py`)

mem0's adapters are SDK-based (`ollama`, `google.genai`, `together`). But each provider also exposes a plain HTTP embeddings endpoint, so the TS ports are **fetch-based (ZERO new dependency)** — Node 22 has global `fetch`:

| New adapter | Endpoint | Auth | Dep |
|---|---|---|---|
| **Ollama** | `POST {baseUrl}/api/embed` (default `http://localhost:11434`) | none (local) | **none** (fetch) |
| **Voyage** | `POST https://api.voyageai.com/v1/embeddings` | `Authorization: Bearer $VOYAGE_API_KEY` | **none** (fetch) |
| **Google Gemini** | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent?key=$GOOGLE_API_KEY` | key query param | **none** (fetch) |

- The registry itself is a `{key: loader}` map — **ZERO dep**.
- The existing SDK adapters (`openai` SDK, `@xenova`) keep their `optionalDependencies` (the registry's lazy-load + install-hint serves THEM).
- **deps-audit implication:** ZERO new production deps for the registry + the 3 new adapters. deps-audit confirms in cycle-plan.

---

## Coverage Corner 3 — Tools

**Q3 — Lazy dynamic-import + bundle isolation.** (`scoped-memory.ts:350`, `cache-pg`/`reranker-local` subpaths, `package.json#exports` + `optionalDependencies`)

- The shipped lazy pattern is `const mod = await import('./x.js')` (scoped-memory.ts:350 for the metrics module; the cache-pg/reranker-local subpaths keep the heavy impl out of the default barrel).
- **Registry mechanism:** `createEmbedder` holds a `Record<provider, () => Promise<Embedder>>` where each value is `async (cfg) => { const m = await import('./ollama.js'); return new m.OllamaEmbedder(cfg); }`. Because the imports are DYNAMIC, the registry module's static graph does NOT include any adapter → `createEmbedder('ollama')` pulls only `ollama.js` (fetch-based, light); never the `openai` SDK.
- **Subpath exports:** add `@usetheo/memory/embedders/{ollama,voyage,google}` (mirror `embedders/local`) + keep `createEmbedder` reachable from `@usetheo/memory/embedders`. A bundle-isolation test asserts importing the default `@usetheo/memory` barrel does NOT pull any embedder adapter, and importing `@usetheo/memory/embedders` (for `createEmbedder`) does NOT statically pull the `openai`/`@xenova` deps.

**Q4 — Install-hint typed error.** (`errors.ts:338` `EmbedderError`, `:514` `SkillExecutorUnavailableError`)

- `SkillExecutorUnavailableError` is the install-hint precedent (thrown when the optional `isolated-vm` addon is absent, message carries the dep name).
- **Registry errors:** (a) unknown provider key → `EmbedderError` (reuse) with the list of valid keys (mirrors mem0's `ValueError: Unsupported Embedder provider`); (b) an SDK-based adapter whose optional dep is absent → a new `EmbedderUnavailableError` (mirror `SkillExecutorUnavailableError`) with `npm install <dep>` hint. The lazy loader for openai/local wraps the `await import` in try/catch → on `ERR_MODULE_NOT_FOUND` re-throw `EmbedderUnavailableError`.

---

## Coverage Corner 4 — Techniques

**Q1 — mem0 registry contract.** (`mem0/utils/factory.py`)

`EmbedderFactory.provider_to_class = {'openai': 'mem0.embeddings.openai.OpenAIEmbedding', 'ollama': '…', 'gemini': '…', …}`. `create(provider, config)` does `class_type = provider_to_class.get(provider)`; if found → `load_class(class_type)` (importlib `import_module` + `getattr`) → instantiate with `BaseEmbedderConfig(**config)`; else `raise ValueError("Unsupported Embedder provider")`. The map + dynamic load + unsupported-raise is the contract to mirror (TS: dynamic `import()` instead of importlib; a typed `EmbedderError` instead of `ValueError`).

**Q5 — The `Embedder` DIP + existing adapter config shapes.** (`dip/embedder.ts`, `embedders/{stub,openai,local}.ts`)

- DIP = 2 methods: `embed(text): Promise<number[]>` + `embedBatch(texts): Promise<number[][]>` (ADR-0008).
- `OpenAIEmbedder`: 0-arg ctor, lazy-singleton `new OpenAI({ apiKey: env })`, model hardcoded `text-embedding-3-small` (a noted `@todo` to accept model via ctor).
- `LocalTransformerEmbedder`: 0-arg ctor, lazy @xenova singleton, model `Xenova/all-MiniLM-L6-v2`, 384-dim.
- `DeterministicStubEmbedder`: deterministic, L2-normalized.
- **Registry config:** `createEmbedder(spec: EmbedderSpec)` where `EmbedderSpec = { provider; model?; apiKey?; baseUrl?; dimensions? }`. The new fetch adapters take `{ model?, apiKey?, baseUrl? }` via ctor (more configurable than the shipped 0-arg openai/local — those stay 0-arg for back-compat; the registry passes through what each accepts).

---

## Cross-cutting comparison

| Dimension | mem0 EmbedderFactory | TheMemory registry (target) |
|---|---|---|
| Map shape | `{key: 'module.Class'}` (string class-path) | `{key: () => import('./x.js')}` (lazy loader fn) |
| Lazy load | `importlib.import_module` + `getattr` | `await import('./x.js')` (dynamic) |
| Unknown provider | `raise ValueError` | throw `EmbedderError` (valid-keys list) |
| Missing dep | (import error bubbles) | typed `EmbedderUnavailableError` + install hint |
| Config | `BaseEmbedderConfig(**config)` | `EmbedderSpec { provider, model?, apiKey?, baseUrl? }` |
| New adapters | SDK-based (ollama/gemini/together) | fetch-based (ollama/voyage/google) — ZERO dep |
| Surface | factory replaces instance | ADDITIVE — instance path stays; registry is convenience |
| Bundle isolation | n/a (Python) | dynamic-import keeps adapter deps out of the barrel |

---

## ADRs

### D1 — `createEmbedder(spec)` async factory + a `{provider: lazy-loader}` registry map
**Decision:** `createEmbedder(spec: EmbedderSpec): Promise<Embedder>`; internal `EMBEDDER_REGISTRY: Record<EmbedderProvider, (spec) => Promise<Embedder>>` where each loader does `await import('./adapter.js')` then constructs. **Rationale:** mirrors mem0's factory (map + dynamic load + create) adapted to TS dynamic import; async because the load + (for SDK adapters) the optional dep are async. **Alternatives:** sync factory with static imports (rejected — defeats bundle isolation, pulls every dep), `MemoryConfig.embedder` accepting a spec directly (rejected — changes the DIP config type + forces async resolution into the Memory factory; keep `createEmbedder` standalone + additive). **Consequences:** the instance path (`createLocalMemory({ embedder })`) is unchanged; the registry is a convenience layer.

### D2 — Lazy dynamic-import per provider; install-hint `EmbedderUnavailableError` for absent SDK deps; `EmbedderError` for unknown keys
**Decision:** each registry loader uses `await import('./x.js')`; SDK-based loaders (openai/local) wrap it + on module-not-found throw `EmbedderUnavailableError('<provider>', '<npm install hint>')`; unknown provider → `EmbedderError` listing valid keys. **Rationale:** dynamic import = bundle isolation (Q3 precedent); typed install-hint mirrors `SkillExecutorUnavailableError`; unknown-key mirrors mem0's unsupported-provider raise (fail-loud, Rule 8). **Alternatives:** generic Error (rejected — untyped), silent fallback to stub (rejected — hides a config error). **Consequences:** a new `EmbedderUnavailableError` class + the registry never statically imports an adapter.

### D3 — Ship 3 NEW fetch-based adapters (Ollama, Voyage, Google Gemini) — ZERO new dependency
**Decision:** implement Ollama / Voyage / Google Gemini as `Embedder` adapters over the Node-global `fetch` (each with an injectable `fetch` for testing), default models per provider. **Rationale:** Inquebrável Rule 9 + each provider exposes a plain HTTP embeddings endpoint, so no SDK dep is needed; fetch-based = trivially unit-testable via a stub fetch + air-gapped CI. **Alternatives:** SDK per provider (rejected — needless optionalDependency weight + install-hint burden), reuse `OpenAIEmbedder` with a baseURL for Voyage/Together (rejected for v1 — Voyage's response shape differs enough; a dedicated adapter is clearer; Together deferred). **Consequences:** catalog 3 → 6 with zero new deps; each new adapter is subpath-isolated + unit-tested via a stub fetch + integration-gated on a key/local Ollama.

### D4 — Each new adapter gets its own subpath + bundle-isolation test; `createEmbedder` ships in the `embedders` barrel
**Decision:** `@usetheo/memory/embedders/{ollama,voyage,google}` subpaths (mirror `embedders/local`); `createEmbedder` + `EmbedderProvider`/`EmbedderSpec` types exported from `@usetheo/memory/embedders`. **Rationale:** consistency with the shipped subpath-isolation; direct-class consumers + the lazy registry both supported. **Alternatives:** root-barrel export of adapters (rejected — pulls deps into the default bundle; the existing ADR D4 of Cycle 1 forbids it). **Consequences:** new subpath exports + bundle-isolation tests + p0-audit export-count reconcile (same-task).

## Recommendations (one per research question)

1. **Q1/registry:** `createEmbedder(spec)` + `{provider: lazy-loader}` map mirroring mem0's factory (D1).
2. **Q2/adapters:** Ollama + Voyage + Google Gemini, all fetch-based, ZERO new dep (D3).
3. **Q3/lazy+isolation:** `await import('./x.js')` per loader; subpath exports + bundle-isolation test (D2/D4).
4. **Q4/errors:** `EmbedderUnavailableError` (install hint, mirror SkillExecutorUnavailableError) for absent SDK deps; `EmbedderError` for unknown keys (D2).
5. **Q5/config:** `EmbedderSpec { provider; model?; apiKey?; baseUrl? }`; new adapters take ctor config; shipped 0-arg adapters unchanged.
6. **Q6/tests:** injectable `fetch` per adapter + stub-fetch unit tests (request shape + parsed vector + empty-batch + HTTP-error throw); registry tests (resolve / unknown-key / missing-dep); ONE integration smoke per adapter (skipIf no key / no local Ollama).

## Blocked questions
(none — 6/6 answered)
