---
slug: embedder-registry
milestone_id: Item24
created_at: 2026-06-22
goal: Add createEmbedder(spec) — a string-keyed embedder registry with lazy dynamic-import + install-hint errors — plus 3 fetch-based adapters (Ollama/Voyage/Google, zero new dep), measured by an integration test where a registry-built embedder round-trips remember+recall against real pgvector and the registry fails loud on unknown-key + missing-dep.
---

# Plan: embedder-registry

> **Version 1.0** — Roadmap Item 24 (3rd opportunistic, `memory-gaps-roadmap.md`). Adds `createEmbedder(spec)` — a string-keyed embedder registry (provider key → lazy `await import()` → `Embedder`) with `EmbedderUnavailableError` install-hint for absent SDK deps + `EmbedderError` for unknown keys — plus 3 NEW fetch-based first-party adapters (Ollama / Voyage / Google Gemini, ZERO new dependency), narrowing the catalog 3 → 6. ADDITIVE: the `createLocalMemory({ embedder })` instance path is unchanged. Grounded in `embedder-registry-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89).

## Goal

> "Add `createEmbedder(spec)` (string-keyed registry, lazy dynamic-import, install-hint errors) + 3 fetch-based adapters (Ollama/Voyage/Google, zero new dep), measured by `tests/integration/embedder-registry.test.ts`: a registry-built embedder (stub `fetch`) round-trips `remember`+`recall` against real `ankane/pgvector:v0.5.1`; `createEmbedder({provider:'bogus'})` throws `EmbedderError`; a registry-built fetch adapter shapes the right HTTP request + parses the vector; AND the registry module does NOT statically pull the `openai`/`@xenova` deps (bundle isolation)."

## Context

TheMemory ships 3 `Embedder` adapters (`DeterministicStubEmbedder`, `OpenAIEmbedder`, `LocalTransformerEmbedder`), each subpath-exported (`@usetheo/memory/embedders/{stub,openai,local}`) + passed to `createLocalMemory({ embedder })` as a DIP INSTANCE. There is no string-keyed selection. Roadmap Item 24 adds a registry (mem0 `EmbedderFactory.provider_to_class` analog: `mem0/utils/factory.py` — string→class-path map + `importlib` lazy load + `create`) + install-hint errors + 1-3 new adapters. The blueprint confirmed: (a) the registry is a `{provider: () => import('./x.js')}` lazy-loader map (TS dynamic-import analog of importlib); (b) the lazy-import precedent is shipped (`scoped-memory.ts:350` `await import(...)`, the `cache-pg`/`reranker-local` subpaths); (c) install-hint typed errors mirror `SkillExecutorUnavailableError` (`errors.ts:514`) + the unknown-key raise mirrors mem0's `ValueError`; (d) Ollama/Voyage/Google each expose a plain HTTP embeddings endpoint → fetch-based, ZERO new dep (Node 22 global `fetch`). The `Embedder` DIP is 2 methods (`embed`/`embedBatch`, ADR-0008).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariant to preserve |
|---|---|---|---|---|
| `packages/core/src/infrastructure/embedders/ollama.ts` (NEW) | 0 | — | fetch-based Ollama `Embedder` (injectable fetch) | — |
| `packages/core/src/infrastructure/embedders/voyage.ts` (NEW) | 0 | — | fetch-based Voyage `Embedder` | — |
| `packages/core/src/infrastructure/embedders/google.ts` (NEW) | 0 | — | fetch-based Google Gemini `Embedder` | — |
| `packages/core/src/infrastructure/embedders/registry.ts` (NEW) | 0 | — | `createEmbedder` + `EMBEDDER_REGISTRY` lazy loaders + `EmbedderProvider`/`EmbedderSpec` | NO static adapter imports (bundle isolation) |
| `packages/core/src/infrastructure/embedders/{ollama,voyage,google,registry}.test.ts` (NEW) | 0 | — | unit tests (stub fetch / lazy resolve) | — |
| `packages/core/src/domain/errors.ts` | (exists) | — | typed errors (`EmbedderError` `:338`, `SkillExecutorUnavailableError` `:514`) | additive `EmbedderUnavailableError` |
| `packages/core/src/domain/errors.test.ts` | (exists) | — | error tests | add `EmbedderUnavailableError` case |
| `packages/core/src/domain/index.ts` | — | — | public barrel (errors export block) | additive `EmbedderUnavailableError` in the existing `export {…} from './errors.js'` block (NO new export statement → p0-audit core count unchanged) |
| `packages/core/package.json` | — | — | `exports` map + `optionalDependencies` | additive `./embedders/{ollama,voyage,google,registry}` subpaths; NO new optionalDependency (fetch-based) |
| `tests/integration/embedder-registry.test.ts` (NEW) | 0 | — | GOAL: registry-built embedder round-trips vs real pgvector + unknown-key/missing-dep + bundle isolation | — |
| `tests/integration/subpath-isolation.test.ts` + `tests/integration/p0-audit/full-public-surface.test.ts` | (exists) | — | isolation + subpath smoke | add the 4 new subpaths (registry isolation + smokes) |

### Current callers / dependents

- **Symbol:** `Embedder` DIP (`dip/embedder.ts`) — 2 methods (`embed`/`embedBatch`). The 3 new adapters + the registry's return type satisfy it.
- **Symbol:** `embedders/index.ts` barrel — statically re-exports `DeterministicStubEmbedder`/`OpenAIEmbedder`/`LocalTransformerEmbedder` (pulls the SDK deps; pre-existing, by design). The registry lives in a SEPARATE module (`registry.ts`) with only dynamic imports so `@usetheo/memory/embedders/registry` stays light.
- **Symbol:** `SkillExecutorUnavailableError` (`errors.ts:514`) — the install-hint template for `EmbedderUnavailableError`.
- **Symbol:** `await import(...)` (`scoped-memory.ts:350`) — the lazy dynamic-import precedent.
- **Symbol:** `createLocalMemory({ embedder })` (`factory.ts`) — unchanged; the registry produces an `Embedder` the consumer passes here.

### Domain glossary
- **Embedder registry** — `createEmbedder(spec)`: a string-keyed factory mapping a provider key → a lazy-loaded `Embedder`. Additive convenience over the DIP-instance path.
- **Lazy dynamic-import** — `await import('./adapter.js')` so an adapter's optional dep loads ONLY when its provider is requested (bundle isolation).
- **Install-hint error** — `EmbedderUnavailableError`: thrown when an SDK-based adapter's optional dep is absent, carrying the `npm install …` hint.
- **fetch-based adapter** — an `Embedder` over the Node-global `fetch` (no SDK dep); injectable `fetch` for testing.

### Architecture boundaries affected
Per `architecture.md`: the new adapters + the registry live in `packages/core/src/infrastructure/embedders/` (infrastructure). `EmbedderUnavailableError` lives in `packages/core/src/domain/errors.ts` (domain). The registry module imports adapters ONLY via dynamic `import()` (bundle isolation). No new boundary; mirrors the shipped embedder subpath pattern.

## Prior Art & Related Work

- **mem0 `EmbedderFactory`** (`.claude/knowledge-base/references/mem0/mem0/utils/factory.py`) — `provider_to_class` string→class-path map + `load_class` (importlib) + `create(provider, config)` + unsupported-provider raise. The registry's primary source.
- **mem0 embedder adapters** (`.claude/knowledge-base/references/mem0/mem0/embeddings/{ollama,gemini,together}.py`) — the request/response shapes the fetch-based ports mirror.
- **TheMemory embedders** (`packages/core/src/infrastructure/embedders/{stub,openai,local}.ts`) — the `Embedder` DIP + the existing adapters the registry wraps.
- **TheMemory lazy-import + subpath isolation** (`scoped-memory.ts:350`, `@usetheo/memory/{cache-pg,reranker-local}`) — the registry's lazy mechanism + the bundle-isolation precedent.
- **TheMemory typed install-hint error** (`errors.ts:514` `SkillExecutorUnavailableError`) — the `EmbedderUnavailableError` template.
- Blueprint: `.claude/knowledge-base/discoveries/blueprints/embedder-registry-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89).

## Dependencies

| Dependency | Version | Status | Rule 9 evaluation |
|---|---|---|---|
| (none) | — | — | The registry is a string→loader map (zero dep). The 3 new adapters use the Node-global `fetch` (Node 22; zero dep). The existing SDK adapters keep their `optionalDependencies` (`openai`, `@xenova/transformers`). Alternatives rejected: an SDK per new provider (`ollama`/`@google/genai`/voyage SDK) — needless optionalDependency weight + install-hint burden (D3); fetch is built-in + trivially stubbable. NO new dependency. |

NO new dependency. deps-audit confirms zero new CVE surface in cycle-plan.

## ADRs

### D1 — `createEmbedder(spec)` async factory + a `{provider: lazy-loader}` registry map
**Decision:** `createEmbedder(spec: EmbedderSpec): Promise<Embedder>`; internal `EMBEDDER_REGISTRY: Record<EmbedderProvider, (spec) => Promise<Embedder>>` where each loader does `await import('./adapter.js')` then constructs. **Rationale:** mirrors mem0's factory (map + dynamic load + create) in TS; async because the load + (SDK adapters) the optional dep are async. **Alternatives:** sync static-import factory (rejected — pulls every dep, defeats isolation); `MemoryConfig.embedder` accepting a spec (rejected — changes the DIP config type + forces async into the Memory factory; keep `createEmbedder` standalone + additive). **Consequences:** the instance path is unchanged; the registry is convenience.

### D2 — Lazy dynamic-import per provider; `EmbedderUnavailableError` (install hint) for absent SDK deps; `EmbedderError` for unknown keys
**Decision:** each loader uses `await import('./x.js')`; the SDK loaders (openai/local) wrap it + on module-not-found throw `EmbedderUnavailableError('<provider>', '<dep>')`; an unknown provider → `EmbedderError` listing valid keys. **Rationale:** dynamic import = bundle isolation; typed install-hint mirrors `SkillExecutorUnavailableError`; unknown-key mirrors mem0's raise (fail-loud, Rule 8). **Alternatives:** generic Error (rejected — untyped), silent stub fallback (rejected — hides config error). **Consequences:** a new `EmbedderUnavailableError` class; the registry never statically imports an adapter.

### D3 — Ship 3 NEW fetch-based adapters (Ollama, Voyage, Google Gemini) — ZERO new dependency
**Decision:** Ollama (`POST {baseUrl}/api/embed`, default `http://localhost:11434`, no key), Voyage (`POST https://api.voyageai.com/v1/embeddings`, Bearer key), Google Gemini (`POST …/v1beta/models/{model}:embedContent?key=`), all over the Node-global `fetch` with an injectable `fetch` ctor option for testing. **Rationale:** Rule 9 + each exposes a plain HTTP endpoint → no SDK dep; fetch = trivially stub-testable + air-gapped CI. **Alternatives:** SDK per provider (rejected — dep weight); reuse OpenAIEmbedder w/ baseURL for Voyage (rejected v1 — response shape differs; a dedicated adapter is clearer). **Consequences:** catalog 3 → 6, zero new deps; each adapter subpath-isolated + unit-tested via a stub fetch + integration-gated.

### D4 — Each new adapter + the registry get their own subpath + bundle-isolation test
**Decision:** `@usetheo/memory/embedders/{ollama,voyage,google,registry}` subpaths (mirror `embedders/local`); `createEmbedder`/`EmbedderProvider`/`EmbedderSpec` ship from `embedders/registry`; `EmbedderUnavailableError` from the default barrel (errors block). **Rationale:** consistency with shipped subpath isolation; the registry subpath stays light (dynamic imports only). **Alternatives:** root-barrel adapter export (rejected — pulls deps into the default bundle; forbidden by Cycle-1 ADR D4). **Consequences:** new subpath exports + bundle-isolation tests + p0-audit subpath-smoke additions (same-task).

## Dependency Graph

```
T1.1 (EmbedderUnavailableError + export)
   ↓
T2.1 (Ollama adapter) ── T2.2 (Voyage adapter) ── T2.3 (Google adapter)   [parallel]
   ↓                          ↓                         ↓
T3.1 (createEmbedder registry + lazy loaders + subpaths + bundle isolation)
   ↓
T4.1 (Integration Validation — GOAL test + full gate)
```

## Phase 1 — Typed error

### T1.1 — `EmbedderUnavailableError` + public export

#### Why this step
**Action:** add `EmbedderUnavailableError(provider, dep)` to `errors.ts` (mirror `SkillExecutorUnavailableError`) + export it from the domain barrel's errors block.
**Reasoning:** the registry's SDK-loader install-hint path (T3.1) throws it; it must exist + be catchable by consumers first. Cites ADR D2.

#### TDD
- RED: `errors.test.ts` — `new EmbedderUnavailableError('openai', 'openai')` is `instanceof Error`, `name === 'EmbedderUnavailableError'`, message contains the dep + an install hint; preserves `cause`.
- GREEN: add the class.
- REFACTOR: JSDoc citing ADR D2 + the SkillExecutorUnavailableError precedent.

#### Files to edit
- `packages/core/src/domain/errors.ts`
- `packages/core/src/domain/errors.test.ts`
- `packages/core/src/domain/index.ts` (add `EmbedderUnavailableError` to the existing errors `export {…}` block — NO new export statement)

#### Deep file dependency analysis
`errors.ts` is the typed-error module. Adding a name to the existing barrel `export {…}` block does NOT add an export STATEMENT (p0-audit core count stays 54).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `npx tsc --noEmit` passes; `errors.test.ts` green.
- [ ] `EmbedderUnavailableError` carries a stable `name` + an install-hint message (asserted).
- [ ] Reachable from the default barrel (`import { EmbedderUnavailableError } from '@usetheo/memory'`).
- [ ] p0-audit core export-statement count UNCHANGED (54) — verified by the existing p0-audit tests staying green.

#### DoD
- [ ] `npx vitest run --config vitest.contract.config.ts packages/core/src/domain/errors.test.ts` green.
- [ ] CHANGELOG `[Unreleased] § Added` notes `EmbedderUnavailableError` + the registry.

## Phase 2 — New fetch-based adapters

### T2.1 — Ollama adapter · T2.2 — Voyage adapter · T2.3 — Google Gemini adapter

#### Why this step
**Action:** implement 3 `Embedder` adapters over the Node-global `fetch`, each with an injectable `fetch` ctor option + `{ model?, baseUrl?/apiKey? }`. Ollama: `POST {baseUrl}/api/embed` `{model, input}` → `embeddings`. Voyage: `POST https://api.voyageai.com/v1/embeddings` Bearer → `data[].embedding`. Google: `POST …/{model}:embedContent?key=` → `embedding.values` (single) / batch via `:batchEmbedContents`.
**Reasoning:** the 3 new providers (D3) — fetch-based, zero dep. Each is independent (parallel). Cites the mem0 adapter shapes (Q2) + the `Embedder` DIP (Q5).

#### TDD (per adapter)
- RED: `<adapter>.test.ts` — with a STUB `fetch`: `embed(text)` issues the right URL + headers + body (model, input, auth) and returns the parsed vector; `embedBatch([])` short-circuits to `[]`; `embedBatch([a,b])` preserves order; an HTTP non-2xx → `EmbedderError` (typed throw, not a raw fetch error).
- GREEN: implement.
- REFACTOR: JSDoc citing ADR D3 + the provider's endpoint.

#### Files to edit
- `packages/core/src/infrastructure/embedders/{ollama,voyage,google}.ts` (NEW)
- `packages/core/src/infrastructure/embedders/{ollama,voyage,google}.test.ts` (NEW)

#### Deep file dependency analysis
Each imports only `Embedder` + `EmbedderError`. The injectable `fetch` (`fetchImpl?: typeof fetch`) defaults to the global — keeps the adapter testable without network + air-gapped CI.

#### Concurrency tests
(none — single-threaded)

#### Failure scenarios
- **Provider HTTP 5xx / network error / non-2xx:** the adapter wraps the fetch result + throws a typed `EmbedderError` with the status (happy-path tests do NOT prove this — each adapter test includes a non-2xx case). Reproduced in each `<adapter>.test.ts`.
- **Malformed response (missing embedding field):** throws `EmbedderError` (not an undefined-deref). Reproduced per adapter.

#### Acceptance criteria
- [ ] Each adapter: correct request shape (URL/headers/body) + parsed vector + empty-batch short-circuit + order preservation + typed throw on non-2xx/malformed (asserted via stub fetch).
- [ ] No SDK import (`grep -L "from 'openai'\|@xenova\|require(" <adapter>.ts`); only `fetch`.
- [ ] `npx tsc --noEmit` passes; each `<adapter>.test.ts` green.

#### DoD
- [ ] `npx vitest run --config vitest.contract.config.ts packages/core/src/infrastructure/embedders/{ollama,voyage,google}.test.ts` green.
- [ ] CHANGELOG updated.

## Phase 3 — Registry

### T3.1 — `createEmbedder` registry + lazy loaders + subpaths + bundle isolation

#### Why this step
**Action:** `embedders/registry.ts` — `EmbedderProvider` (`'stub'|'openai'|'local'|'ollama'|'voyage'|'google'`), `EmbedderSpec { provider; model?; apiKey?; baseUrl? }`, `EMBEDDER_REGISTRY` (a `Record<provider, (spec)=>Promise<Embedder>>` of DYNAMIC imports), `createEmbedder(spec)`. SDK loaders (openai/local) wrap `await import` + on module-not-found throw `EmbedderUnavailableError`; unknown provider → `EmbedderError` listing valid keys. Add the 4 subpaths to `package.json#exports`; add bundle-isolation + smoke tests.
**Reasoning:** the registry (D1/D2/D4) — the Item's spine. Dynamic imports keep the registry subpath light (bundle isolation). Cites mem0 factory (Q1) + the lazy-import precedent (Q3).

#### TDD
- RED: `registry.test.ts` — `createEmbedder({provider:'stub'})` resolves a `DeterministicStubEmbedder`; `createEmbedder({provider:'ollama', baseUrl})` resolves an `OllamaEmbedder`; `createEmbedder({provider:'bogus'})` rejects with `EmbedderError` (message lists valid keys); a simulated missing-SDK (mock the dynamic import to throw `ERR_MODULE_NOT_FOUND`) → `EmbedderUnavailableError`. Bundle-isolation test (in subpath-isolation.test.ts): importing `@usetheo/memory/embedders/registry` does NOT statically reach `openai.ts`/`local.ts`/the `openai`/`@xenova` deps (static-import-graph walk).
- GREEN: implement registry + exports.
- REFACTOR: JSDoc citing ADR D1/D2/D4.

#### Files to edit
- `packages/core/src/infrastructure/embedders/registry.ts` (NEW)
- `packages/core/src/infrastructure/embedders/registry.test.ts` (NEW)
- `packages/core/package.json` (exports `./embedders/{ollama,voyage,google,registry}`)
- `tests/integration/subpath-isolation.test.ts` (registry isolation assertion)
- `tests/integration/p0-audit/full-public-surface.test.ts` (4 new subpath smoke imports)

#### Deep file dependency analysis
`registry.ts` imports `Embedder` + the error types STATICALLY (light) but every ADAPTER via `await import()` (dynamic) → its static graph excludes the SDKs. The subpath `./embedders/registry` resolves to `registry.js`. The new fetch-adapter subpaths resolve to their `.js`.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `createEmbedder` resolves all 6 providers; unknown key → `EmbedderError` (valid-keys list); missing SDK → `EmbedderUnavailableError`.
- [ ] `@usetheo/memory/embedders/registry` static-import graph does NOT include `openai`/`@xenova` (bundle-isolation test).
- [ ] The 4 new subpaths smoke-import (registry resolves `createEmbedder`; each adapter resolves its class).
- [ ] `npm pack --dry-run` ships the 4 new `dist/infrastructure/embedders/*.js` + `.d.ts`.

#### DoD
- [ ] `npx vitest run --config vitest.contract.config.ts packages/core/src/infrastructure/embedders/registry.test.ts` green; isolation + smoke tests green.
- [ ] CHANGELOG `[Unreleased] § Added` notes the 4 subpaths.

## Phase 4 — Integration Validation

### T4.1 — GOAL integration test + full gate

#### Why this step
**Action:** the GOAL test against real `ankane/pgvector:v0.5.1`: build an embedder via `createEmbedder({provider:'ollama', baseUrl, fetchImpl: stubFetch})` (stub fetch returns deterministic 384-dim vectors), wire it into `createLocalMemory({ embedder, embeddingDim: 384 })`, `remember` + `recall` → assert the round-trip returns the stored memory (proving a registry-built fetch adapter works end-to-end with real persistence). Plus: `createEmbedder({provider:'bogus'})` rejects `EmbedderError`; bundle isolation holds. Plus full typecheck/lint/coverage + `/code-quality`.
**Reasoning:** the "eat your own cooking" gate proving the registry + a new adapter end-to-end with real pgvector (the provider HTTP is a deterministic stub fetch — the registry + adapter + persistence are real; honest pattern matching the reranker/ontology GOALs). The real-provider HTTP is integration-gated separately (skipIf no key / no local Ollama).

#### TDD
- RED: `tests/integration/embedder-registry.test.ts` — the registry-built-embedder round-trip + unknown-key.
- GREEN: implemented by prior phases.
- REFACTOR: isolated DB (`themem_embedder_registry`) + `pool.end()` teardown.

#### Files to edit
- `tests/integration/embedder-registry.test.ts` (NEW)
- `vitest.integration.config.ts` (aliases for the 4 new subpaths if imported by name)

#### Deep file dependency analysis
Runs under `vitest.integration.config.ts` (gated by `THEOMEM_PG_URI`). Uses `createEmbedder` + `createLocalMemory` + `PgvectorStore`. The stub fetch returns canned vectors so the round-trip is deterministic.

#### Concurrency tests
(none — single-threaded)

#### Failure scenarios
- **Unknown provider key:** `createEmbedder({provider:'bogus'})` → `EmbedderError` (fail-fast config error). Reproduced T3.1 + T4.1.
- **Absent SDK dep for openai/local:** `EmbedderUnavailableError` (install hint). Reproduced T3.1 (simulated import failure).
- **(per-adapter HTTP failures)** covered in Phase 2 failure scenarios.

#### Acceptance criteria
- [ ] `THEOMEM_PG_URI=… npx vitest run tests/integration/embedder-registry.test.ts --config vitest.integration.config.ts` PASSES: registry-built embedder round-trips remember+recall vs real pgvector; unknown-key throws `EmbedderError`.
- [ ] `cd packages/core && npx tsc --noEmit` exits 0; `npm test` green; integration suite green (0 failed).
- [ ] `/code-quality embedder-registry` ∈ {PASS, PASS_WITH_CAVEATS} (no FAIL_HARD/INVALID; no symbol_fabrication, no dead_public_export).
- [ ] No paper names in `src/**` / tests.

#### DoD
- [ ] All Phase 1-3 tests green + this integration test green.
- [ ] `/code-quality` PASS.
- [ ] CHANGELOG `[Unreleased]` complete (Added: createEmbedder registry, EmbedderUnavailableError, Ollama/Voyage/Google adapters, 4 subpaths).

## Coverage Matrix

| Goal claim / blueprint recommendation | Task(s) |
|---|---|
| `createEmbedder(spec)` registry + lazy loaders [D1, Rec 1] | T3.1 |
| Lazy dynamic-import + bundle isolation [D2, Rec 3] | T3.1 |
| `EmbedderUnavailableError` install-hint + `EmbedderError` unknown-key [D2, Rec 4] | T1.1 + T3.1 |
| Ollama adapter (fetch, zero dep) [D3, Rec 2] | T2.1 |
| Voyage adapter (fetch, zero dep) [D3, Rec 2] | T2.2 |
| Google Gemini adapter (fetch, zero dep) [D3, Rec 2] | T2.3 |
| Per-adapter request/response shaping + typed HTTP-error throw [Q2, Rec 6] | T2.1/T2.2/T2.3 |
| `EmbedderSpec` config shape [Q5, Rec 5] | T3.1 |
| 4 new subpaths + bundle-isolation + smoke [D4] | T3.1 |
| ADDITIVE — instance path unchanged | T3.1 (no MemoryConfig change) |
| No new dep (fetch + registry) [deps-audit] | T2.x + T3.1 + Dependencies section |
| GOAL: registry-built embedder round-trips vs real pgvector [Rec 6] | T4.1 |

100% of Goal claims + blueprint recommendations mapped to tasks.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Each new HTTP adapter's request/response shape could drift from the provider's API | MEDIUM | unit-test the exact request + a canned response per adapter; integration smoke gated on a real key/local Ollama documents the live contract | impl |
| Bundle isolation regression (registry statically pulls an SDK) | HIGH | dynamic-import-only in registry.ts + a static-import-graph bundle-isolation test (T3.1) | impl |
| Public-surface count drift (new subpaths/exports) | LOW | EmbedderUnavailableError folds into the existing errors export block (no new statement); subpath smokes added same-task | impl |
| fetch-based adapters assume Node 18+ global fetch | LOW | the package already targets Node 22 (distroless/nodejs22); documented | plan |

## Unresolved Questions

(none — every decision is resolved at plan time via D1-D4 grounded in the blueprint.)

## Failure scenarios

- **Unknown provider key:** `createEmbedder({provider:'bogus'})` → typed `EmbedderError` (valid-keys list). Reproduced T3.1 + T4.1.
- **Absent SDK dep (openai/local):** lazy loader catches module-not-found → `EmbedderUnavailableError` install hint. Reproduced T3.1.
- **Provider HTTP non-2xx / network / malformed response:** the fetch adapter throws a typed `EmbedderError` (not a raw/undefined error). Reproduced per adapter (T2.x).

## Global Definition of Done

- [ ] All tasks T1.1 → T4.1 complete with TDD RED→GREEN→REFACTOR.
- [ ] `cd packages/core && npx tsc --noEmit` exits 0.
- [ ] Contract suite (`npm test`) green; integration suite green (incl. the GOAL test vs real pgvector).
- [ ] `/code-quality embedder-registry` ∈ {PASS, PASS_WITH_CAVEATS}.
- [ ] Bundle isolation: `@usetheo/memory/embedders/registry` ⊅ openai/@xenova; default barrel ⊅ any adapter.
- [ ] No paper names in `src/**` / tests.
- [ ] CHANGELOG `[Unreleased]` updated (Added).
- [ ] `/review embedder-registry` → READY_TO_MERGE (0 BLOCKER, ≤2 HIGH with mitigation).
- [ ] Plan archived to `knowledge-base/plans/completed/` after merge.
