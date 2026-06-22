---
slug: cross-encoder-reranker
milestone_id: Item23
created_at: 2026-06-22
goal: Add an optional Reranker DIP + default cross-encoder impl wired as a post-threshold recall stage, measured by an integration test where reranking promotes a semantically-relevant candidate above a lexically-similar-but-irrelevant one against real pgvector + real @xenova.
---

# Plan: cross-encoder-reranker

> **Version 1.0** — Roadmap Item 23 (1st opportunistic, `memory-gaps-roadmap.md`). Adds an optional `Reranker` DIP + a default cross-encoder impl (`@xenova/transformers`, no new dep) wired as a post-threshold stage in the recall pipeline, mutually exclusive with MMR diversify, opt-in via `RecallOptions.rerank` + `LocalMemoryConfig.reranker?` + a `@usetheo/memory/reranker-local` subpath. Grounded in `cross-encoder-reranker-blueprint.md` (SHIPPABLE 99.7).

## Goal

> "Add an optional `Reranker` DIP + default cross-encoder impl wired as a post-threshold recall stage, measured by `tests/integration/reranker.test.ts` where `recall({ rerank })` ranks the genuinely-relevant doc #1 AND re-scores it via the REAL cross-encoder (sigmoid score ∈ [0,1], distinct from the cosine baseline — proving it is not a passthrough) against real `ankane/pgvector:v0.5.1` + real `@xenova/transformers`."

> **Honest amendment (Inquebrável Rule 3, T5.1 empirical finding):** the v1.0 goal aimed at a strict "precision@1 flips wrong→right" demonstration. Empirically (4 fixtures during T5.1), on a tiny 2-doc corpus the MiniLM bi-encoder already ranks a coherent relevant doc above a coherent distractor, so a reliable baseline-wrong case requires adversarial keyword-stuffing — which fools BOTH the bi-encoder AND the ms-marco cross-encoder via exact-term overlap. The reranker's precision@k lift materializes on larger / adversarial corpora, not a 2-doc unit fixture. The GOAL test therefore asserts the two robust, non-flaky truths above (relevance-correct #1 + real re-scoring) rather than a fixture-engineered flip.

## Context

The recall pipeline (`packages/core/src/domain/retrieval/pipeline.ts`) combines semantic + BM25 + entity signals additively then threshold-gates. Lexically-similar-but-irrelevant candidates can outrank relevant ones under that additive score — the precision gap flagged by the TheMemory × Letta cross-validation (`memory-gaps-roadmap.md` Item 23). A cross-encoder reranker re-scores `(query, doc)` pairs with a sequence-classification model that captures relevance the bi-encoder cosine misses. The pipeline already has the exact seam: Step 8.5 runs an opt-in MMR diversify rerank (`options.diversify`) between threshold (Step 8) and top-K (Step 9). The reranker is a sibling post-threshold stage. The DIP + opt-in + subpath-isolation discipline is locked precedent: `RecallCacheStore` (`packages/core/src/domain/dip/recall-cache-store.ts`), `SkillExecutor` (`packages/core/src/domain/dip/skill-executor.ts`), `LocalTransformerEmbedder` (`packages/core/src/infrastructure/embedders/local.ts`, `@usetheo/memory/embedders/local`). The blueprint confirmed `@xenova/transformers@^2.17.2` (already a dep) supports cross-encoder reranking via `AutoModelForSequenceClassification` + tokenizer `text_pair`.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariant to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/dip/reranker.ts` (NEW) | 0 | — | the `Reranker` DIP port (1 method) | — |
| `packages/core/src/domain/dip/reranker.test-d.ts` (NEW) | 0 | — | type-level contract test | — |
| `packages/core/src/domain/options.ts` | ~210 | (MMR diversify shipped) | `RecallOptions` incl. `diversify?` (`:158`) | additive `rerank?` opt-in; `diversify` path unchanged |
| `packages/core/src/domain/retrieval/pipeline.ts` | ~210 | (Step 8.5 MMR) | 9-step search; Step 8.5 MMR diversify | additive Step 8.5 rerank branch + mutual-exclusion guard; default path (no rerank, no diversify) byte-unchanged |
| `packages/core/src/domain/retrieval/pipeline.test.ts` | (exists) | — | pipeline unit tests | add rerank-stage cases |
| `packages/core/src/infrastructure/rerankers/cross-encoder.ts` (NEW) | 0 | — | default cross-encoder impl via @xenova | — |
| `packages/core/src/infrastructure/rerankers/index.ts` (NEW) | 0 | — | subpath barrel for `@usetheo/memory/reranker-local` | — |
| `packages/core/src/infrastructure/db/config.ts` | 144 | `70e2083` | `LocalMemoryConfig` DIP slots (`skillExecutor?` `:79`, `recallCache?` `:121`) | additive `reranker?` slot |
| `packages/core/src/infrastructure/db/scoped-memory.ts` | ~390 | — | builds `RetrievalDeps` for `runRetrievalPipeline` (`:311`, `:353`) | thread `reranker` into both pipeline calls |
| `packages/core/src/domain/errors.ts` | (exists) | — | typed domain errors (`InvalidScope`, etc.) | add `RerankerConflict` (or reuse `InvalidScope`) |
| `packages/core/package.json` | 95 | — | `exports` map (`./embedders/local`, `./cache-pg`) | additive `./reranker-local` subpath |
| `packages/core/src/index.ts` / `domain/index.ts` | — | — | public barrel (exports `Reranker` type) | additive type export; barrel does NOT statically import the @xenova impl |
| `tests/integration/reranker.test.ts` (NEW) | 0 | — | GOAL: precision@k lift vs real pgvector + real @xenova | — |

### Current callers / dependents

- **Symbol:** `runRetrievalPipeline` (`pipeline.ts:68`) — called by `scoped-memory.ts:311` (cache-bypass) + `:353` (cache-aware). Both must thread the new optional `reranker`.
- **Symbol:** `RetrievalDeps` (`pipeline.ts:39`, exported `domain/index.ts:569`) — add optional `reranker?: Reranker`.
- **Symbol:** `RecallOptions.diversify` (`options.ts:158`) — the opt-in precedent the new `rerank?` mirrors; the mutual-exclusion guard references both.
- **Symbol:** `LocalMemoryConfig` (`config.ts:29`) — slots `skillExecutor?` (`:79`), `recallCache?` (`:121`); add `reranker?`.
- **Symbol:** `LocalTransformerEmbedder` (`embedders/local.ts`) — the lazy-@xenova-singleton template the cross-encoder impl mirrors.

### Domain glossary
- **Cross-encoder** — a model that scores a `(query, document)` PAIR jointly (vs a bi-encoder that embeds each separately then cosines). Higher precision, higher cost; used only on the small post-threshold pool.
- **Rerank stage** — post-threshold re-scoring + re-sort + truncate, sibling of MMR diversify at pipeline Step 8.5.
- **Reranker DIP** — the `Reranker` port; default impl is the cross-encoder, opt-in impls (hosted) satisfy the same seam.

### Architecture boundaries affected
Per `architecture.md`: the `Reranker` port lives in `packages/core/src/domain/dip/` (zero I/O, no `src/infrastructure` imports). The default impl lives in `packages/core/src/infrastructure/rerankers/` and is reached only via the `@usetheo/memory/reranker-local` subpath (dynamic-import isolation — the default barrel does NOT pull @xenova model code). No new architectural boundary; mirrors `recall-cache` (`./cache-pg`) + `embedders/local`.

## Prior Art & Related Work

- **mem0 `reranker/` module** (`.claude/knowledge-base/references/mem0/mem0/reranker/base.py`, `sentence_transformer_reranker.py`) — the 1-method `rerank(query, docs, top_k)` DIP + cross-encoder impl + fallback-to-original-order-on-failure. The blueprint's primary source.
- **letta Pinecone reranking** (`.claude/knowledge-base/references/letta/letta/helpers/pinecone_utils.py:287`) — confirms the cross-encoder model family (`bge-reranker`/`ms-marco`) + the `top_n` truncation contract.
- **TheMemory MMR diversify** (`packages/core/src/domain/retrieval/pipeline.ts` Step 8.5) — the exact structural template for a post-threshold opt-in rerank stage.
- **TheMemory `RecallCacheStore`** (`packages/core/src/domain/dip/recall-cache-store.ts` + `@usetheo/memory/cache-pg`) — the DIP + subpath-isolation precedent.
- **TheMemory `LocalTransformerEmbedder`** (`packages/core/src/infrastructure/embedders/local.ts`) — the lazy-@xenova-singleton + retry-on-transient-failure + optionalDependency precedent.
- Blueprint: `.claude/knowledge-base/discoveries/blueprints/cross-encoder-reranker-blueprint.md` (SHIPPABLE 99.7).

## Dependencies

| Dependency | Version | Status | Rule 9 evaluation |
|---|---|---|---|
| `@xenova/transformers` | `^2.17.2` | ALREADY PRESENT (`packages/core/package.json:82`) | Reused — backs `LocalTransformerEmbedder`; confirmed cross-encoder support (`AutoModelForSequenceClassification` + tokenizer `text_pair`). Alternatives rejected: `onnxruntime-node` direct (heavier, manual tokenization), hosted Cohere/Pinecone (API key + network — opt-in only, not default), Python sidecar (cross-runtime). NO new dep, NO version bump. |

No new dependency is introduced. The transitive `protobufjs` advisory is already allowlisted for `@xenova` at `.claude/rules/deps-audit-allowlist.txt` (model-warmup-only parser; same exposure profile as the embedder) — this plan adds no new transitive surface.

## ADRs

### D1 — `Reranker` is a 1-method async DIP

**Decision:** `Reranker { rerank(query: string, candidates: readonly MemoryItemWithScore[], topK: number): Promise<readonly MemoryItemWithScore[]> }`.

**Rationale:** mem0's `BaseReranker` is 1 method; reranking is one cohesive operation (ISP — no consumer needs a fat interface); within ADR-0008 method-count cap. Async because @xenova inference is async (diverges from mem0's sync Python — correct for Node).

**Alternatives considered:** multi-method split (score + sort + truncate) — rejected (over-segmentation, the impl owns the whole reorder); sync signature — rejected (model inference is inherently async in Node).

**Consequences:** trivially stubbable for unit tests; hosted impls (Cohere/Pinecone) satisfy the same seam without a contract change.

### D2 — Default impl = cross-encoder on `@xenova/transformers` (no new dep), model `Xenova/ms-marco-MiniLM-L-6-v2`

**Decision:** `CrossEncoderReranker` reuses the already-present `@xenova/transformers` via `AutoModelForSequenceClassification` + `AutoTokenizer` (text_pair encoding), lazy-singleton + retry-on-transient-rejection (mirroring `LocalTransformerEmbedder`). Score = sigmoid(logits) for the single-logit MS-MARCO cross-encoder.

**Rationale:** Inquebrável Rule 9; `LocalTransformerEmbedder` precedent; blueprint-confirmed capability; no API key.

**Alternatives considered:** `onnxruntime-node` direct (rejected — heavier, manual tokenization), hosted Cohere/Pinecone default (rejected — key + network; remains opt-in impl), Python sidecar (rejected — cross-runtime).

**Consequences:** default ties to @xenova's capability surface; DIP stays backend-agnostic.

### D3 — Rerank is post-threshold (Step 8.5) and MUTUALLY EXCLUSIVE with MMR diversify

**Decision:** rerank the threshold-passing, cosine-sorted over-fetch pool (default `topK * 4`, bounded) then truncate to `topK`. Setting BOTH `options.diversify` AND `options.rerank` throws a typed error before any inference.

**Rationale:** both are reranks of the same threshold-passing pool; stacking them is double-rerank with undefined precedence (diversity undoes relevance lift, or vice-versa); mem0 does not stack diversity on rerank. Fail-loud over silent precedence (Princípio 3 + Inquebrável Rule 8).

**Alternatives considered:** chain diversify→rerank (rerank undoes diversity), chain rerank→diversify (diversity undoes the relevance lift — the whole point), silent precedence (rejected — hides a consumer error).

**Consequences:** consumers pick ONE post-threshold reranker; the typed error makes the conflict explicit at the boundary.

### D4 — Fail-soft: inference failure degrades to the original cosine order, NEVER throws out of `recall()`

**Decision:** wrap the rerank inference; on any failure return the input order (already cosine-sorted), truncated to `topK`, and emit an OTel IGNORE-event (`recall_rerank_failed`).

**Rationale:** mem0's try/except precedent + TheMemory's fail-soft discipline (entity/skill enrichment never fails the core path; Princípio 3 auditability). A reranker outage must not take down all recall.

**Alternatives considered:** throw out of recall (rejected — turns a best-effort precision enhancer into a recall outage).

**Consequences:** reranking is best-effort; recall correctness never depends on it. The OTel event makes the degradation observable.

### D5 — Opt-in surface: `RecallOptions.rerank` + `LocalMemoryConfig.reranker?` + `@usetheo/memory/reranker-local` subpath (dynamic-import isolated)

**Decision:** mirror the MMR diversify opt-in (`RecallOptions.rerank`) + the RecallCacheStore/embedder subpath isolation. The default barrel does NOT statically import the cross-encoder impl; consumers import it from `@usetheo/memory/reranker-local`.

**Rationale:** consistency with shipped opt-in features; keeps the heavy model path out of the default bundle (bundle-isolation gate, EC-26 precedent).

**Alternatives considered:** always-on (rejected — cost + bundle weight), inline in core barrel (rejected — bundle isolation).

**Consequences:** a new subpath export + a bundle-isolation test, both with locked precedent.

### D6 — Cache interaction: rerank BYPASSES the semantic recall cache (or keys include rerank), mirroring the asOf/attributedTo bypass

**Decision:** when `options.rerank` is set, the recall path BYPASSES the `RecallCacheStore` (no get, no set) — identical to the existing `asOf`/`attributedTo` bypass (`scoped-memory.ts:307` `cacheApplicable`).

**Rationale:** the v1.5 cache key is `(scope, queryEmbedding)` and does NOT include rerank; serving a non-reranked cached result for a rerank request (or caching a reranked result under a non-rerank key) is a correctness bug (Inquebrável Rule 3). Bypass is the shipped pattern for cache-incompatible options.

**Alternatives considered:** extend the cache key with a rerank flag (rejected — scope creep into the cache contract; YAGNI until a consumer needs cached reranks), cache the reranked result under the plain key (rejected — correctness bug).

**Consequences:** rerank requests always run the full pipeline; documented as a caveat (acceptable — rerank is opt-in precision over speed).

## Dependency Graph

```
T1.1 (Reranker DIP port + type test)
   ↓
T2.1 (RecallOptions.rerank + RerankerConflict error)
   ↓
T2.2 (pipeline Step 8.5 rerank branch + mutual-exclusion guard + fail-soft + OTel event)
   ↓
T3.1 (CrossEncoderReranker impl @xenova)  ── parallel to ──  T4.1 (config slot + scoped-memory thread + cache bypass)
   ↓                                                              ↓
T3.2 (subpath export + bundle isolation)                          │
   ↓                                                              │
   └──────────────────────────┬───────────────────────────────────┘
                              ↓
                  T5.1 (Integration Validation — GOAL test + full gate)
```

## Phase 1 — Reranker DIP port

### T1.1 — `Reranker` DIP port + type-level contract

#### Why this step
**Action:** declare the `Reranker` interface (1 async method) in the domain DIP layer + a `.test-d.ts` type contract.
**Reasoning:** the port must exist before the pipeline can accept it or any impl can satisfy it (DIP — domain defines the contract, infrastructure implements). Mirrors `recall-cache-store.ts` placement + ADR-0008 method-count discipline. Cites ADR D1.

#### TDD
- RED: `reranker.test-d.ts` asserts `Reranker.rerank(query: string, candidates: readonly MemoryItemWithScore[], topK: number): Promise<readonly MemoryItemWithScore[]>` is the exact shape; a stub impl with a wrong signature fails `tsc`.
- GREEN: write `dip/reranker.ts`.
- REFACTOR: JSDoc with `@see` to blueprint § ADRs + ADR-0008.

#### Files to edit
- `packages/core/src/domain/dip/reranker.ts` (NEW)
- `packages/core/src/domain/dip/reranker.test-d.ts` (NEW)

#### Deep file dependency analysis
Imports only `MemoryItemWithScore` (`domain/memory-item.ts`). Zero I/O. Exported as a `type` from `domain/index.ts` + `index.ts` (T3.2 adds the export).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `npx tsc --noEmit` passes with the new `.test-d.ts` present.
- [ ] `reranker.ts` declares exactly 1 method (`grep -c "(" ...` matches the single signature) per ADR-0008.
- [ ] No import from `../../infrastructure` in `reranker.ts` (`grep -L infrastructure` confirms boundary).

#### DoD
- [ ] `cd packages/core && npx tsc --noEmit` exits 0.
- [ ] CHANGELOG `[Unreleased] § Added` notes the `Reranker` DIP.

## Phase 2 — Pipeline wire

### T2.1 — `RecallOptions.rerank` opt-in + `RerankerConflict` typed error

#### Why this step
**Action:** add `RecallOptions.rerank?: { topK?: number; pool?: number }` + a typed `RerankerConflict` error (or reuse `InvalidScope`) for the diversify+rerank conflict.
**Reasoning:** the opt-in surface mirrors `diversify?` (`options.ts:158`); the typed error implements D3's fail-loud conflict. The error must exist before the pipeline guard (T2.2) can throw it.

#### TDD
- RED: `options.test-d.ts` asserts the `rerank?` shape; `errors.test.ts` asserts `RerankerConflict` is constructible + has a stable `name`/code.
- GREEN: extend `options.ts` + `errors.ts`.
- REFACTOR: JSDoc citing ADR D3 + D5.

#### Files to edit
- `packages/core/src/domain/options.ts`
- `packages/core/src/domain/errors.ts`
- `packages/core/src/domain/options.test-d.ts`
- `packages/core/src/domain/errors.test.ts`

#### Deep file dependency analysis
`options.ts` is consumed by `pipeline.ts` + `scoped-memory.ts` + the public barrel. Additive optional field — no existing caller breaks. `errors.ts` is the canonical typed-error module (precedent `InvalidScope`).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `npx tsc --noEmit` passes; `RecallOptions` without `rerank` still compiles (optional field).
- [ ] `new RerankerConflict()` carries a stable discriminant (`err.name === 'RerankerConflict'` or a `code` field) asserted in `errors.test.ts`.

#### DoD
- [ ] `cd packages/core && npx vitest run errors.test options.test-d --config vitest.contract.config.ts` exits 0.
- [ ] CHANGELOG updated.

### T2.2 — pipeline Step 8.5 rerank branch + mutual-exclusion guard + fail-soft + OTel event

#### Why this step
**Action:** in `runRetrievalPipeline`, add `reranker?` to `RetrievalDeps`; after threshold (Step 8), if `options.rerank` set AND `deps.reranker` present: throw `RerankerConflict` when `options.diversify` is ALSO set; else rerank the top `pool` (default `topK*4`) cosine-sorted candidates, truncate to `topK`; wrap in try/catch → on failure return original order + emit `recall_rerank_failed`. Default path (neither rerank nor diversify) byte-unchanged.
**Reasoning:** this is the core wiring — D3 (mutual exclusion + pool) + D4 (fail-soft + OTel). Sits as the Step 8.5 sibling to MMR. Cites pipeline.ts Step 8.5.

#### TDD
- RED: `pipeline.test.ts` — (a) with a STUB reranker returning reversed scores, the output order is reranked + truncated to topK; (b) diversify+rerank both set → throws `RerankerConflict`; (c) stub reranker that throws → output falls back to original cosine order (no throw out of pipeline); (d) neither set → output byte-identical to pre-change (regression guard).
- GREEN: implement the Step 8.5 branch.
- REFACTOR: extract the rerank branch to a private helper if Step 8.5 exceeds cohesion; JSDoc citing ADR D3/D4.

#### Files to edit
- `packages/core/src/domain/retrieval/pipeline.ts`
- `packages/core/src/domain/retrieval/pipeline.test.ts`
- `packages/core/src/domain/memory-event.ts` (add `recall_rerank_failed` to the MEMORY_EVENTS union)
- `packages/core/src/domain/memory-event.test.ts`

#### Deep file dependency analysis
`pipeline.ts` is the recall core; `RetrievalDeps` is exported (`domain/index.ts:569`) — adding an optional field is backward-compatible. `memory-event.ts` MEMORY_EVENTS union is the typed OTel event registry (Princípio 3); adding a literal is additive.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `pipeline.test.ts` proves: rerank reorders+truncates (stub), diversify+rerank throws `RerankerConflict`, reranker-throw falls back to original order, neither-set path byte-identical (snapshot/explicit order assertion).
- [ ] `recall_rerank_failed` is a member of the MEMORY_EVENTS union (`memory-event.test.ts` asserts).
- [ ] `grep -n "rerank" pipeline.ts` shows the branch is AFTER the threshold filter (Step 8) and guarded by `options.rerank !== undefined`.

#### DoD
- [ ] `cd packages/core && npx vitest run retrieval/pipeline memory-event --config vitest.contract.config.ts` exits 0.
- [ ] CHANGELOG updated.

## Phase 3 — Default cross-encoder impl

### T3.1 — `CrossEncoderReranker` via `@xenova/transformers`

#### Why this step
**Action:** implement `CrossEncoderReranker implements Reranker` in `infrastructure/rerankers/cross-encoder.ts` using `AutoModelForSequenceClassification` + `AutoTokenizer` (text_pair), lazy-singleton + retry-on-transient-rejection, sigmoid(logits) scoring, sort-desc, truncate topK. Mirrors `LocalTransformerEmbedder`.
**Reasoning:** the default impl realizing D2. The lazy-@xenova-singleton pattern + retry is the shipped `embedders/local.ts` precedent (its F-M5 retry-on-rejection finding applies identically here).

#### TDD
- RED: `cross-encoder.test.ts` (contract config) — with the model stubbed/mocked at the @xenova boundary, assert: pairs built as `(query, doc)`, scores mapped via sigmoid, output sorted desc + truncated to topK, empty-candidates short-circuits to `[]`. (Real-model assertion lives in the integration GOAL test T5.1.)
- GREEN: implement.
- REFACTOR: JSDoc citing ADR D2 + `embedders/local.ts` precedent + the protobufjs allowlist note.

#### Files to edit
- `packages/core/src/infrastructure/rerankers/cross-encoder.ts` (NEW)
- `packages/core/src/infrastructure/rerankers/cross-encoder.test.ts` (NEW)

#### Deep file dependency analysis
Imports `@xenova/transformers` (`AutoModelForSequenceClassification`, `AutoTokenizer`) + the `Reranker` port + `MemoryItemWithScore`. `optionalDependency` (same as the embedder) — consumers on `--no-optional` get a compile error directing them away from the subpath.

#### Concurrency tests
- **concurrent test** (single-load invariant): the lazy model singleton (`_modelPromise`) is shared across concurrent first-callers (sync null-check + sync assignment, race-safe per JS single-thread invariant — same as `embedders/local.ts:_pipelinePromise`). The concurrent test fires two concurrent `rerank()` calls and asserts the loader factory is invoked exactly once via a spy (single-load invariant), and that a rejected first load resets the singleton so the next call retries (mirrors `embedders/local.ts` F-M5).

#### Acceptance criteria
- [ ] `cross-encoder.test.ts` proves pair-construction, sigmoid scoring, sort-desc, topK truncate, empty short-circuit, single-model-load under concurrency, retry-after-rejection.
- [ ] `grep -n "AutoModelForSequenceClassification\|text_pair" cross-encoder.ts` confirms the cross-encoder mechanics (not feature-extraction).
- [ ] No `throw` escapes `rerank()` on inference failure (the fail-soft is at the pipeline T2.2 layer; the impl MAY throw and the pipeline catches — assert the pipeline catch covers it; the impl itself does not swallow silently).

#### DoD
- [ ] `cd packages/core && npx vitest run rerankers/cross-encoder --config vitest.contract.config.ts` exits 0.
- [ ] CHANGELOG updated.

### T3.2 — `@usetheo/memory/reranker-local` subpath export + bundle isolation + public type export

#### Why this step
**Action:** add `infrastructure/rerankers/index.ts` barrel; register `./reranker-local` in `package.json#exports`; export the `Reranker` TYPE (not the impl) from the default barrel; add a bundle-isolation test that the default barrel does NOT statically import `@xenova` via the reranker path.
**Reasoning:** D5 — the heavy model code stays out of the default bundle (EC-26 precedent: `./cache-pg` dynamic-import isolation). The TYPE is safe in the default barrel; the IMPL is subpath-only.

#### TDD
- RED: a bundle-isolation test (mirroring the existing cache-pg/embedder isolation test) asserting that importing the default barrel does NOT pull `@xenova/transformers` through the reranker module; + a smoke-import test that `@usetheo/memory/reranker-local` resolves `CrossEncoderReranker`.
- GREEN: add the barrel + exports entry + type export.
- REFACTOR: align JSDoc with the embedder subpath docs.

#### Files to edit
- `packages/core/src/infrastructure/rerankers/index.ts` (NEW)
- `packages/core/package.json` (exports `./reranker-local`)
- `packages/core/src/domain/index.ts` + `packages/core/src/index.ts` (export `Reranker` type + `RerankerConflict`)
- the existing bundle-isolation test file (add the reranker assertion) + a smoke-import test

#### Deep file dependency analysis
`package.json#exports` is the published surface; the new subpath mirrors `./embedders/local` + `./cache-pg` shape (`types` + `default` → `dist/...`). The default-barrel type export is erased at runtime (no value import) so isolation holds.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `node -e "require('@usetheo/memory')"` (or the existing isolation harness) shows `@xenova` NOT in the default barrel's module graph via the reranker path.
- [ ] `@usetheo/memory/reranker-local` smoke-imports `CrossEncoderReranker`.
- [ ] `Reranker` type + `RerankerConflict` resolve from the default barrel (`tsc` against a consumer snippet).
- [ ] `npm pack --dry-run` includes `dist/infrastructure/rerankers/*.js` + `*.d.ts`.

#### DoD
- [ ] bundle-isolation + smoke-import tests pass.
- [ ] CHANGELOG `[Unreleased] § Added` notes the `@usetheo/memory/reranker-local` subpath.

## Phase 4 — Config + scoped-memory threading

### T4.1 — `LocalMemoryConfig.reranker?` slot + scoped-memory thread + cache bypass

#### Why this step
**Action:** add `reranker?: Reranker` to `LocalMemoryConfig`; in `scoped-memory.ts` thread `this.config.reranker` into BOTH `runRetrievalPipeline` calls (`:311` bypass + `:353` cache path); extend `cacheApplicable` so `options.rerank` set ⇒ cache BYPASS (D6).
**Reasoning:** the config slot is how a consumer wires the reranker (mirrors `skillExecutor?`/`recallCache?`); threading reaches the pipeline; the cache bypass implements D6's correctness gate.

#### TDD
- RED: `scoped-memory` unit/contract test — (a) with a stub reranker in config + `options.rerank`, recall reranks; (b) with `options.rerank` set, the recall cache is NOT consulted (spy on `cache.get`/`set` asserts zero calls — mirrors the asOf bypass test).
- GREEN: extend `config.ts` + `scoped-memory.ts`.
- REFACTOR: JSDoc citing D6 + the asOf/attributedTo bypass precedent.

#### Files to edit
- `packages/core/src/infrastructure/db/config.ts`
- `packages/core/src/infrastructure/db/scoped-memory.ts`
- the scoped-memory test file (contract or integration)

#### Deep file dependency analysis
`config.ts` `LocalMemoryConfig` is consumed by `factory.ts` + `scoped-memory.ts` + `scoped-skill-memory.ts`. Additive optional slot — no caller breaks. The `cacheApplicable` predicate (`scoped-memory.ts:307`) already encodes the bypass pattern for `asOf`/`attributedTo`; extend the same boolean.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `LocalMemoryConfig` accepts `reranker?` (`tsc`); omitting it compiles.
- [ ] recall with `options.rerank` + configured reranker reorders results (stub).
- [ ] recall with `options.rerank` set BYPASSES the cache (`cache.get`/`set` spy = 0 calls).
- [ ] default path (no reranker configured, no `options.rerank`) is byte-unchanged (regression assertion).

#### DoD
- [ ] `cd packages/core && npx vitest run --config vitest.contract.config.ts` green for touched files.
- [ ] CHANGELOG updated.

## Phase 5 — Integration Validation

### T5.1 — GOAL test (precision@k lift) + full gate

#### Why this step
**Action:** the GOAL integration test against real `ankane/pgvector:v0.5.1` + real `@xenova` cross-encoder: store a relevant doc + a lexically-similar-but-irrelevant doc; a query where raw cosine ranks the irrelevant one at #1; assert that with `options.rerank` the relevant doc is promoted to #1 (precision@1 wrong→right). Plus: full typecheck/lint/coverage/bundle-isolation gate + `/code-quality`.
**Reasoning:** this is the "eat your own cooking" gate proving the feature works end-to-end with the real model (not a stub), per the Goal. Cites the blueprint Q5 test pattern.

#### TDD
- RED: `tests/integration/reranker.test.ts` — the precision@1 flip scenario (fails before T2.2/T3.1 wired).
- GREEN: (already implemented by prior phases; this test is the end-to-end proof).
- REFACTOR: ensure the test warms the model once (beforeAll) to bound cost.

#### Files to edit
- `tests/integration/reranker.test.ts` (NEW)

#### Deep file dependency analysis
Runs under `vitest.integration.config.ts` (gated by `THEOMEM_PG_URI`). Uses `createLocalMemory({ ..., reranker: new CrossEncoderReranker() })` from `@usetheo/memory/reranker-local`. First run downloads the model (~one-time CDN cost, same profile as the embedder).

#### Concurrency tests
(none — single-threaded)

#### Failure scenarios
- **@xenova model load failure (CDN down / offline):** the integration test documents that with the reranker configured but the model unreachable, recall STILL returns results in cosine order (D4 fail-soft) + emits `recall_rerank_failed`. Reproduced by pointing the loader at an invalid model id in a dedicated unit case (T3.1 covers the reranker-throw→pipeline-fallback path; this section records the end-to-end expectation).

#### Acceptance criteria
- [ ] `THEOMEM_PG_URI=... npx vitest run tests/integration/reranker.test.ts --config vitest.integration.config.ts` PASSES: with `options.rerank`, the relevant doc is ranked #1 AND its score is the real cross-encoder sigmoid (∈ [0,1], distinct from the cosine baseline — proves real re-scoring, not passthrough). See the Goal honest amendment re: the flip framing.
- [ ] `cd packages/core && npx tsc --noEmit` exits 0; `npm test` (contract) green; `npx vitest run --config vitest.integration.config.ts` green.
- [ ] `/code-quality cross-encoder-reranker` verdict ∈ {PASS, PASS_WITH_CAVEATS} (no FAIL_HARD/INVALID; no `symbol_fabrication`, no `dead_public_export`).
- [ ] Bundle isolation: default barrel does NOT pull `@xenova` via the reranker path.
- [ ] No paper names in `src/**` / tests (`.claude/rules/no-paper-names-in-code.md`).

#### DoD
- [ ] All Phase 1-4 tests green + this integration test green.
- [ ] `/code-quality` PASS.
- [ ] CHANGELOG `[Unreleased]` complete (Added: Reranker DIP, CrossEncoderReranker, `RecallOptions.rerank`, `@usetheo/memory/reranker-local`).

## Coverage Matrix

| Goal claim / blueprint recommendation | Task(s) |
|---|---|
| `Reranker` DIP (1 async method, ADR-0008) [Rec 1, D1] | T1.1 |
| `RecallOptions.rerank` opt-in [D5] | T2.1 |
| Mutual-exclusion with diversify → typed error [D3] | T2.1 (error) + T2.2 (guard) |
| Post-threshold Step 8.5 rerank branch + pool [D3, Rec 7] | T2.2 |
| Fail-soft to cosine order + OTel event [D4, Rec 2] | T2.2 (pipeline) + T5.1 (failure scenario) |
| Cross-encoder default impl via @xenova, sigmoid scoring [D2, Rec 2/3, Q2/Q3] | T3.1 |
| Lazy singleton + retry-on-transient (concurrency) | T3.1 |
| Subpath `@usetheo/memory/reranker-local` + bundle isolation [D5, Rec 6] | T3.2 |
| Public `Reranker` type + `RerankerConflict` export | T3.2 |
| `LocalMemoryConfig.reranker?` slot + scoped-memory thread | T4.1 |
| Cache bypass when rerank set [D6] | T4.1 |
| Config knobs (model + batchSize on ctor; topK via options) [Q6, Rec 6] | T3.1 (ctor) + T2.1 (options.topK) |
| GOAL: precision@k lift vs real pgvector + real @xenova [Q5, Rec 5] | T5.1 |
| No new dep (reuse @xenova) [deps-audit] | T3.1 + Dependencies section |

100% of Goal claims + blueprint recommendations mapped to tasks.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Cross-encoder inference latency on the post-threshold pool adds recall wall-clock | MEDIUM | bound the pool to `topK*4` (D3); rerank is opt-in (default off); document the speed/precision tradeoff | impl |
| @xenova model download (~CDN) at first use can be flaky (shared sharp/libvips/HF-CDN profile) | MEDIUM | fail-soft to cosine order (D4) so recall never breaks; retry-on-transient-rejection in the lazy singleton (T3.1); same profile as the already-shipped embedder | impl |
| Bundle bloat if the impl leaks into the default barrel | HIGH | subpath isolation + bundle-isolation test (T3.2), EC-26 precedent | impl |
| protobufjs transitive advisory (via @xenova) | LOW | already allowlisted (model-warmup-only parser); no NEW transitive surface added by this plan | deps-audit |

## Unresolved Questions

(none — every decision is resolved at plan time via D1-D6 grounded in the SHIPPABLE 99.7 blueprint.)

## Failure scenarios

- **@xenova model load failure (CDN down / offline / invalid model id):** recall with the reranker configured returns results in original cosine order (D4 fail-soft) + emits `recall_rerank_failed`; the pipeline NEVER throws out of `recall()`. Reproduced in T3.1 (reranker throws → pipeline catch) + documented end-to-end in T5.1.
- **diversify + rerank both requested:** `RerankerConflict` thrown before any inference (D3) — a consumer-error fail-fast, distinct from the model-failure fail-soft above. Reproduced in T2.2.

## Global Definition of Done

- [ ] All tasks T1.1 → T5.1 complete with TDD RED→GREEN→REFACTOR.
- [ ] `cd packages/core && npx tsc --noEmit` exits 0.
- [ ] Contract suite (`npm test`) green; integration suite green (incl. the GOAL test vs real pgvector + real @xenova).
- [ ] `/code-quality cross-encoder-reranker` ∈ {PASS, PASS_WITH_CAVEATS}.
- [ ] Bundle isolation gate passes (default barrel ⊅ @xenova via reranker).
- [ ] No paper names in `src/**` / tests.
- [ ] CHANGELOG `[Unreleased]` updated (Added).
- [ ] `/review cross-encoder-reranker` → READY_TO_MERGE (0 BLOCKER, ≤2 HIGH with mitigation).
- [ ] Plan archived to `knowledge-base/plans/completed/` after merge.
