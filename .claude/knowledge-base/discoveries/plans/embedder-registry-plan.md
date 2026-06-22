# Discovery Plan: Embedder registry + more providers

> **Version 1.0** — investigate a string-keyed **embedder registry** (provider key → lazy dynamic-import → `Embedder`) with install-hint typed errors for missing optional deps, plus 1-3 new first-party `Embedder` adapters, to narrow TheMemory's 3-provider catalog (stub/openai/local) toward the 8+ of peers. In scope: `mem0`'s `EmbedderFactory` (`mem0/utils/factory.py` — the string→class-path map + `importlib` lazy load + `create`) + `mem0/embeddings/{ollama,gemini,together}.py` (candidate adapter shapes). Output: a blueprint that locks (a) the registry/factory shape + the lazy-import mechanism, (b) the install-hint error contract, (c) the new-adapter set + their request/response shaping (prefer fetch-based = zero new dep), (d) the opt-in surface + subpath/bundle-isolation, (e) the test pattern (stubbed client, no live API in unit tests).

**Slug:** `embedder-registry`
**Owner:** project-owner
**Created:** 2026-06-22
**Time budget:** 3h (mem0: 2h, TheMemory-self grounding: 1h — per ADR D1)

## Context

Roadmap Item 24 (`memory-gaps-roadmap.md` opportunistic #3, next after Item 15 shipped v0.16.0) calls for "String-keyed embedder registry with lazy dynamic-import + install-hint errors; ship 1-3 more first-party adapters (e.g. Google/Voyage/Ollama) to narrow the 3-vs-8 provider gap." TheMemory ships 3 `Embedder` adapters today — `DeterministicStubEmbedder`, `OpenAIEmbedder`, `LocalTransformerEmbedder` — each subpath-exported (`@usetheo/memory/embedders/{stub,openai,local}`) and passed to `createLocalMemory({ embedder })` as a DIP INSTANCE. There is NO string-keyed selection: a consumer must import the concrete class. mem0 solves this with `EmbedderFactory.provider_to_class` (a `{key: 'module.Class'}` map) + `load_class` (importlib) + `create(provider, config)`. The TS analog is a registry mapping a provider key → a lazy `() => import('./adapter.js')` loader, so the heavy/optional dep (the `openai` SDK, `@xenova/transformers`) loads ONLY when its key is requested. The subpath dynamic-import isolation precedent is shipped (`@usetheo/memory/cache-pg`, `reranker-local`). Install-hint errors mirror the existing `EmbedderError`/`SkillExecutorUnavailableError` typed-error discipline.

## Objective

Decide the embedder registry/factory shape + lazy-import mechanism, the install-hint error contract, the new-adapter set (+ their request/response shaping + dep cost), the opt-in surface, and the test pattern — so `/to-plan` produces an implementation plan with zero open architectural questions. Measurable success criteria for the blueprint:

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/` OR the project's own `src/`
- [ ] Cross-cutting comparison table populated for mem0's factory vs the target registry
- [ ] Recommendations: one concrete decision per research question (registry shape, lazy-import, install-hint error, new-adapter set, config surface, tests)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mem0/` | `mem0/utils/factory.py` (EmbedderFactory + load_class), `mem0/embeddings/{ollama,gemini,together,openai,base}.py` | The string→class-path registry + importlib lazy load + concrete adapter request/response shapes (ollama/gemini/together = candidate ports) |
| `.claude/knowledge-base/references/` (TheMemory self) | `packages/core/src/infrastructure/embedders/{index,openai,local,stub}.ts`, `packages/core/src/domain/dip/embedder.ts`, `errors.ts`, `package.json#exports`, the `cache-pg`/`reranker-local` subpath dynamic-import precedent | The `Embedder` DIP, the existing adapters (the registry wraps them), the subpath/lazy-import + typed-error precedents |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| Replacing the DIP-instance config path (`createLocalMemory({ embedder: <instance> })`) | the registry is ADDITIVE — the instance path stays; the registry is a convenience string-keyed factory on top |
| A managed/cloud embedding-pricing layer | that is Roadmap Item 7 (TheoCloud), separate |
| LangChain / aggregator adapters (`mem0/embeddings/langchain.py`) | <!-- DEFER-CORNER: techniques | an aggregator-wrapping adapter pulls a heavy framework dep + is a different shape (wrap-a-framework vs a first-party provider). Out of scope for v1; the registry must accommodate it later as just another key. --> |
| `.claude/knowledge-base/references/*/{build,dist,.venv,node_modules}/` | Build artifacts |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** mem0: 2h (EmbedderFactory + load_class + 2-3 adapter shapes), TheMemory-self: 1h (the Embedder DIP + existing adapters + subpath/lazy-import/typed-error precedents).

**Rationale:** mem0's factory is the direct analog for the registry; the candidate-adapter ports (ollama/gemini/together) are only visible by reading their embed() request/response; the self-pass locks the lazy-import + subpath + install-hint precedents.

**Stop condition — per question (mandatory):** Fase A empty after 3 retries with different query variants → mark BLOCKED "Fase A exhausted", continue. No padding.

**Stop condition — per project (mandatory):** budget exhausted with N pending → mark BLOCKED "budget exhausted", continue. If every remaining question is `done` or honestly `blocked` → emit `<promise>BLUEPRINT_BLOCKED</promise>` (never `BLUEPRINT_COMPLETE` from a blocked state).

**Anti-pattern:** NEVER fabricate Fase B answers for an exhausted Fase A (Unbreakable Rule 3).

**Consequences:** the loop stops per-project on budget exhaustion; blocked questions surface as next-discovery seed.

### D2 — Investigation depth

**Decision:** Read mem0's `factory.py` (EmbedderFactory + load_class + create) end-to-end + the 2-3 candidate adapters' `embed()` request/response end-to-end; Read the TheMemory `Embedder` DIP + the 3 existing adapters + the cache-pg/reranker-local subpath dynamic-import + the typed-error classes.

**Rationale:** the registry's lazy-load + the install-hint contract + each adapter's HTTP/SDK shape are only correct if read end-to-end; a Grep-only pass would miss the importlib error path + the request/response field names.

**Alternatives considered:** Grep-only (misses semantics), single-adapter sample (misses the registry-vs-adapter split).

**Consequences:** higher per-file cost, bounded by the small file set.

### D3 — Prefer fetch-based new adapters (zero new dep) where the provider exposes a plain HTTP embeddings endpoint

**Decision:** the discovery will evaluate which candidate new adapters (Ollama / Voyage / Google Gemini) can be implemented with the Node-global `fetch` (no new SDK dep) vs which need an SDK; prefer the fetch-based ones for v1 (Inquebrável Rule 9 + the local-embedder/openai optional-dep burden).

**Rationale:** a fetch-based adapter adds ZERO production deps + is trivially unit-testable via a stubbed `fetch`/client; an SDK-based adapter adds an optionalDependency + the install-hint burden. The registry must support BOTH (the openai/local adapters are SDK-based today).

**Alternatives considered:** SDK for every provider (rejected — needless dep weight), fetch for every provider incl. openai/local (rejected — those are shipped SDK-based; don't rewrite).

**Consequences:** the new-adapter set leans fetch-based; the registry's lazy-import + install-hint machinery is exercised by the existing SDK adapters (openai/local).

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | What is mem0's embedder registry shape (provider→class map) + lazy-load mechanism + create() error path? | techniques | mem0 | `grep -n "provider_to_class\|load_class\|def create\|importlib\|Unsupported" mem0/mem0/utils/factory.py` | Read `factory.py` EmbedderFactory + load_class + create end-to-end | The `{key: 'module.Class'}` map + importlib dynamic load + the unsupported-provider raise — the registry contract to mirror |
| Q2 | How do the candidate adapters (ollama/gemini/together) shape their embed() request + response, and which need an SDK vs plain HTTP? | techniques | mem0 | `grep -n "def embed\|client\|requests\|http\|import\|api_key\|base_url\|model" mem0/mem0/embeddings/ollama.py mem0/mem0/embeddings/gemini.py mem0/mem0/embeddings/together.py` | Read each `embed()` + constructor end-to-end | Per-adapter: endpoint/SDK, request body, response field (`embeddings`/`data[].embedding`), default model/dims — informs the fetch-based ports |
| Q3 | How does TheMemory lazy-dynamic-import an optional-dep module today, and how is the heavy dep kept out of the default bundle? | tools | TheMemory self | `grep -rn "await import(\|dynamic import\|reranker-local\|cache-pg\|optionalDependencies" packages/core/src packages/core/package.json` | Read the cache-pg/reranker-local subpath index + the scoped-memory dynamic-import + package.json exports + optionalDependencies | The `await import('./x.js')` lazy pattern + the subpath-isolation test + the optionalDependencies list — the registry's lazy-load mechanism |
| Q4 | What typed-error + install-hint pattern exists for a missing optional dep, to reuse for the registry? | tools | TheMemory self | `grep -n "Unavailable\|install\|optionalDep\|EmbedderError\|class .*Error" packages/core/src/domain/errors.ts packages/core/src/infrastructure/embedders/openai.ts packages/core/src/infrastructure/embedders/local.ts` | Read `errors.ts` (EmbedderError / SkillExecutorUnavailableError) + the openai/local optional-dep guidance | The typed-error class + the install-hint message convention to mirror for `createEmbedder('openai')` when the SDK is absent |
| Q5 | What is the `Embedder` DIP + the existing adapters' constructor/config shape the registry must satisfy? | techniques | TheMemory self | `grep -n "interface Embedder\|class .*Embedder\|constructor\|embeddingDim\|EMBED_MODEL" packages/core/src/domain/dip/embedder.ts packages/core/src/infrastructure/embedders/*.ts` | Read the DIP + the 3 adapter constructors | The 2-method DIP + how each adapter takes config (model/dim/apiKey) — the registry's `createEmbedder(key, config)` config shape |
| Q6 | How does mem0 test its embedders (stubbed client vs live), to mirror for the new fetch-based adapters? | tests | mem0 | `find mem0 -path '*test*embed*' -o -path '*embed*test*' ; grep -rn "mock\|patch\|monkeypatch\|def test_" mem0/tests/embeddings/ 2>/dev/null` | Read an embedder test (e.g. tests/embeddings/test_ollama.py) | The stub-the-client + assert-request/response pattern to mirror (no live API in unit tests; integration gated on a key) |

Question budget: 6 total. Per-corner: techniques ×3 (Q1, Q2, Q5), tools ×2 (Q3, Q4), tests ×1 (Q6). deps corner folded into Q2/D3 (which adapters need a dep) — see DEFER-CORNER. All non-deferred corners populated; max 3/corner respected.

<!-- DEFER-CORNER: deps | the dependency question is folded into Q2 + ADR D3 (the discovery decides which new adapters are fetch-based = zero new dep vs SDK-based = a new optionalDependency). The registry itself adds NO dep (a string→loader map). A formal deps-audit runs in cycle-plan regardless. -->

## Coverage Matrix

| Question | Corner | Method (Fase A) | Method (Fase B) | Status |
|---|---|---|---|---|
| Q1 | techniques | grep provider_to_class/load_class | Read factory.py | planned |
| Q2 | techniques | grep embed/client/http per adapter | Read ollama/gemini/together embed() | planned |
| Q3 | tools | grep await import / subpath | Read cache-pg/reranker-local + package.json | planned |
| Q4 | tools | grep Unavailable/install/EmbedderError | Read errors.ts + openai/local guidance | planned |
| Q5 | techniques | grep Embedder DIP + ctors | Read DIP + 3 adapters | planned |
| Q6 | tests | find embedder tests | Read an embedder test | planned |
| (deps) | deps | — | — | DEFER-CORNER (folded into Q2/D3) |

All corners populated or explicitly DEFER-CORNER'd. techniques ×3, tools ×2, tests ×1, deps deferred.

## Halt-loop Checkpoints

Before marking each question `done`, the `/discover-execute` loop MUST verify:

1. Every cited path resolves (`Path.exists()`) — no fabricated citation.
2. Q1 captures the EXACT registry contract (map shape + lazy-load + unsupported-provider error).
3. Q2 produces a CONCRETE per-adapter verdict: fetch-based (zero dep) vs SDK-based (+ which dep).
4. Q3 produces the exact `await import(...)` lazy pattern + the bundle-isolation test the registry must pass.

## Acceptance Criteria

- [ ] 6/6 questions `done` (or honestly `blocked` with reason).
- [ ] Every citation backed by a real `.claude/knowledge-base/references/` path OR a real `packages/core/src/` path.
- [ ] Cross-cutting table: mem0 EmbedderFactory vs the target registry (map shape, lazy load, error, config).
- [ ] ≥ 1 ADR in the blueprint (registry shape; lazy-import + install-hint; new-adapter set + dep policy).
- [ ] Recommendations: registry/factory API, lazy-import mechanism, install-hint error, the new-adapter set (fetch-based preferred), config surface, test pattern.

## Global Definition of Done

- [ ] `/discover-confidence embedder-registry` ≥ SHIPPABLE_WITH_CAVEATS per `.claude/rules/discover-blueprint-golden-rule.md`.
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/embedder-registry-blueprint.md`.
- [ ] No fabricated citations (hard cap).
- [ ] All coverage corners populated or DEFER-CORNER'd (hard cap).
