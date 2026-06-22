---
slug: adaptive-retrieval
milestone_id: Item13
created_at: 2026-06-22
goal: Add an opt-in AdaptiveRetrievalPolicy DIP (shouldRetrieve pre-embed gate + assess post-threshold grade-and-correct) wired into recall(), default OFF, with a key-free heuristic default impl, fail-soft + 3 observable events, measured by a GOAL integration test against real pgvector.
---

# Plan: adaptive-retrieval

> **Version 1.0** — Roadmap Item 13 (v1.2, 4th opportunistic in `memory-gaps-roadmap.md`). Adds an OPT-IN `AdaptiveRetrievalPolicy` DIP — a Self-RAG `shouldRetrieve` pre-embed gate + a CRAG `assess` post-threshold grade-and-correct — wired into `recall()`, DEFAULT OFF (byte-unchanged), with a key-free heuristic default impl, fail-soft, and 3 new observable events. Structural mirror of the shipped cross-encoder reranker (Item 23). Grounded in `adaptive-retrieval-blueprint.md` (SHIPPABLE, 0 hard caps). ZERO new dependency.

## Goal

> "Add `AdaptiveRetrievalPolicy` DIP (`shouldRetrieve` pre-embed gate + `assess` post-threshold grade-and-correct) + a key-free `HeuristicAdaptiveRetrievalPolicy` default, wired opt-in via `createLocalMemory({ retrievalPolicy })` + `RecallOptions.adaptive`, default OFF, fail-soft, emitting `retrieval_skipped`/`retrieval_corrected`/`retrieval_low_confidence`, measured by `tests/integration/adaptive-retrieval.test.ts`: against real `ankane/pgvector:v0.5.1`, a `shouldRetrieve=false` policy makes `recall()` return `[]` WITHOUT embedding (embed-spy count 0) + emits `retrieval_skipped`; a weak-top retrieval triggers the corrective relax (emits `retrieval_corrected`); and a plain `recall()` with no `adaptive` option is byte-identical to today."

## Context

`CLAUDE.md § Roadmap` Item 13 (v1.2): adaptive retrieval — `shouldRetrieve` + `wasRetrievalGood` decision hooks (Self-RAG/CRAG/Adaptive-RAG). Unfrozen 2026-06-21. Today `recall()` runs the full pipeline unconditionally (`packages/core/src/domain/retrieval/pipeline.ts:7-17`): it embeds + queries pgvector for EVERY call and returns whatever passes `threshold` (Step 8) even when the top result is weak. The blueprint decided to mirror the SHIPPED opt-in-DIP seam — the cross-encoder reranker (`packages/core/src/domain/dip/reranker.ts`, hooked at pipeline Step 8.5, `pipeline.ts:74-99`) — adding two seams: a pre-embed `shouldRetrieve` gate (in `scoped-memory.ts` `retrieveResults`, before the embed) + a post-threshold `assess` grade-and-correct (pipeline Step 8.6). Honors `CLAUDE.md § Princípio 2` (priorização > volume) + `§ Princípio 3` (auditability). The clones confirm originality: mem0's `infer` gates ingestion not retrieval; no Self-RAG/CRAG in mem0/letta (blueprint Q3).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariant to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/dip/adaptive-retrieval-policy.ts` (NEW) | 0 | — | the `AdaptiveRetrievalPolicy` DIP (2 methods) + `RetrievalDecision`/`RetrievalAssessment` types | ≤ 2 methods (ADR-0008) |
| `packages/core/src/domain/dip/adaptive-retrieval-policy.test-d.ts` (NEW) | 0 | — | type-level contract test | — |
| `packages/core/src/domain/memory-event.ts` | 129 | — | typed `MEMORY_EVENTS` union (`:16`) + `emitEvent` (`:113`) | append 3 literals; NO new export statement |
| `packages/core/src/domain/options.ts` | 269 | — | `RecallOptions` (`rerank?` block as the opt-in precedent) | additive `adaptive?` toggle; default-OFF |
| `packages/core/src/domain/retrieval/pipeline.ts` | 293 | — | 9-step search; Step 8.5 reranker seam (`:74-99`) | additive Step 8.6 assess+correct; default path byte-unchanged |
| `packages/core/src/infrastructure/db/scoped-memory.ts` | 503 | — | `recall()` (`:267`) → `retrieveResults` (`:301`) | additive pre-embed `shouldRetrieve` gate; default path byte-unchanged |
| `packages/core/src/infrastructure/db/factory.ts` | (exists) | — | `LocalMemoryConfig` + wiring (`reranker` slot precedent) | additive `retrievalPolicy?` slot |
| `packages/core/src/infrastructure/adaptive/heuristic-policy.ts` (NEW) | 0 | — | key-free `HeuristicAdaptiveRetrievalPolicy` default impl | no new dep; pure in-memory |
| `packages/core/src/infrastructure/adaptive/index.ts` (NEW) | 0 | — | `@usetheo/memory/adaptive-local` subpath barrel | — |
| `packages/core/src/infrastructure/adaptive/heuristic-policy.test.ts` (NEW) | 0 | — | unit tests for the heuristic | — |
| `packages/core/package.json` | — | — | `exports` map | additive `./adaptive-local` subpath |
| `tests/integration/adaptive-retrieval.test.ts` (NEW) | 0 | — | GOAL: skip + correct + default-unchanged vs real pgvector | — |
| `tests/integration/subpath-isolation.test.ts` + `tests/integration/p0-audit/full-public-surface.test.ts` | (exist) | — | isolation + subpath smoke | add `adaptive-local` isolation + smoke |
| `vitest.integration.config.ts` | (exists) | — | src aliases for integration tests | add `@usetheo/memory/adaptive-local` alias |

### Current callers / dependents

- **`Reranker` DIP** (`dip/reranker.ts:43-47`) — 1 method, async, "MUST NOT mutate input", default impl behind a subpath. The structural template for `AdaptiveRetrievalPolicy`.
- **`RecallOptions.rerank`** (`options.ts`) — the opt-in toggle precedent (`rerank?: { topK?; pool? }`, default-OFF, byte-unchanged).
- **pipeline Step 8.5** (`pipeline.ts:74-99`) — the post-threshold extraction-point + fail-soft try/catch (`recall_rerank_failed` at `:97`, "outage MUST NEVER take down recall" `:78`). The template for Step 8.6.
- **`scoped-memory.ts` `retrieveResults`** (`:301`) — where the pre-embed gate goes (before the cache/embed at `:325+`).
- **`MEMORY_EVENTS`** (`memory-event.ts:16`) + **`emitEvent`** (`:113`, no-op when tracer undefined `:118`) — the observability surface.
- **`factory.ts`** `LocalMemoryConfig` — the `reranker` opt-in slot precedent for `retrievalPolicy`.

### Domain glossary
- **shouldRetrieve** — Self-RAG "Retrieve?" pre-embed gate; when it returns `{retrieve:false}`, `recall()` returns `[]` without embedding (saves embed + DB cost) + emits `retrieval_skipped`.
- **assess** — CRAG grade-and-correct; inspects the threshold-passing pool's top score; when weak, the pipeline applies ONE bounded corrective (re-filter the already-fetched combined pool at a relaxed threshold — NO re-embed, NO external fallback) + emits `retrieval_corrected`, or `retrieval_low_confidence` when even relaxation yields nothing.
- **corrective floor** — the top-score threshold below which `assess` recommends a relax.
- **opt-in / default-OFF** — when no `adaptive` option + no `retrievalPolicy` config, the pipeline is byte-identical to v0.17.

### Architecture boundaries affected

- **DIP layer (`packages/core/src/domain/dip/`)** — a NEW `AdaptiveRetrievalPolicy` port is declared here. Per `architecture.md § 3` (DIP boundary), the domain declares the interface; the infrastructure implements it. No domain→infrastructure import is introduced.
- **Retrieval domain (`packages/core/src/domain/retrieval/pipeline.ts`)** — the Step 8.6 assess+correct stage is added at the SAME post-threshold seam the reranker (Step 8.5) already occupies; it consumes the `AdaptiveRetrievalPolicy` TYPE only (DIP-clean), never an impl.
- **Infrastructure (`packages/core/src/infrastructure/adaptive/`)** — the default `HeuristicAdaptiveRetrievalPolicy` impl lives here, behind the `@usetheo/memory/adaptive-local` subpath (bundle isolation, ADR D5) — the default barrel does NOT statically import it.
- **Composition root (`packages/core/src/infrastructure/db/factory.ts` + `scoped-memory.ts`)** — the `retrievalPolicy?` DIP instance is injected here (mirrors the `reranker` slot) and threaded into the pipeline `deps`; no new cross-layer dependency direction is created (high-level recall depends on the abstraction, not the concrete heuristic).
- **Public API surface (`package.json#exports`)** — additive `./adaptive-local` subpath; the root barrel + `/contract` surface gain only the DIP TYPE (zero-runtime), preserving the p0-audit export-count discipline.

## Prior Art & Related Work

- **Internal (load-bearing):** the cross-encoder reranker cycle (Item 23, `cross-encoder-reranker-plan.md` + `tests/integration/reranker.test.ts`) — the opt-in-DIP + Step-8.5 seam + fail-soft + GOAL-test pattern this plan copies. The MMR diversify (`principles-alignment-hardening`) + ontology (Item 15) cycles are sibling opt-in-DIP precedents.
- **External (literature, cited in prose not as paths):** Self-RAG (Asai et al. 2023, `arXiv:2310.11511`) — `shouldRetrieve` reflection; CRAG (Yan et al. 2024, `arXiv:2401.15884`) — grade-and-correct; Adaptive-RAG (Jeong et al. 2024, `arXiv:2403.14403`) — complexity routing (studied for DIP shape only; key-free heuristic default per blueprint ADR D3).
- **Clones (confirmed-absent baseline):** mem0 `infer` gates ingestion not retrieval (`controlling-memory-ingestion.mdx:323`); mem0 `search()` has only threshold/top_k/reranker (`mem0/memory/main.py:144`); no Self-RAG/CRAG in mem0/letta.

## Dependencies

No new dependency. The default `HeuristicAdaptiveRetrievalPolicy` is pure in-memory (top-score comparison + string-signal gate). An optional LLM-judged policy (follow-up) reuses the EXISTING `LLM` DIP (`dip/llm.ts`). Mirrors the reranker (`@xenova` already optional) + ontology (reused zod) zero-dep precedent. `/deps-audit` confirms below.

| Dependency | Version | New? | Rule 9 evaluation |
|---|---|---|---|
| (none) | — | No | The feature is a DIP + pipeline-seam wiring + a key-free heuristic; no library is needed. An LLM-judged variant (deferred) reuses the existing `LLM` DIP. No alternatives to evaluate because no dependency is introduced. |

## ADRs

### D1 — `AdaptiveRetrievalPolicy` DIP, exactly 2 methods (`shouldRetrieve` + `assess`)
**Decision:** one cohesive DIP with the two decision hooks. `shouldRetrieve(query, scope): Promise<RetrievalDecision>` where `RetrievalDecision = { retrieve: boolean; reason?: string }`; `assess(query, results): Promise<RetrievalAssessment>` where `RetrievalAssessment = { sufficient: boolean; action: 'accept' | 'relax' | 'reject'; relaxedThreshold?: number; reason?: string }`.
**Rationale:** ISP — both hooks are the single concern "adapt the retrieval". 2 methods within ADR-0008 cap (Reranker=1, ConflictResolutionPolicy=1). The policy DECIDES (pure); the pipeline ACTS on the decision (SRP separation).
**Alternatives:** two separate DIPs (rejected — over-segmented, two config slots for one concern); fold into `Reranker` (rejected — different concern: retrieve-or-not vs rescore-relevance); a single `adapt(query, results)` (rejected — cannot gate BEFORE embed, loses the cost-saving skip).
**Consequences:** new `dip/adaptive-retrieval-policy.ts` + a default impl + a config slot.

### D2 — Two seams: `shouldRetrieve` PRE-embed (scoped-memory), `assess` POST-threshold (pipeline Step 8.6)
**Decision:** the gate runs at the top of `scoped-memory.ts retrieveResults` (before the embed on either cache/non-cache path); the grade-and-correct runs in `pipeline.ts` after Step 8 (threshold), reusing the Step 8.5 extraction-point pattern. The pipeline retains the pre-threshold combined pool so the corrective can re-filter it at a relaxed threshold WITHOUT a re-embed.
**Rationale:** Self-RAG gates before retrieval (skip ⇒ no embed cost); CRAG grades after — the seams map 1:1 to the papers + reuse the proven post-threshold seam. Gating in scoped-memory (not the vector store) respects the DIP boundary (`architecture.md § 3`).
**Alternatives:** post-retrieval seam only (rejected — loses the skip's cost saving); gate inside the vector store (rejected — boundary violation); re-embed + re-query on correction (rejected — cost + the over-fetch pool already holds the rows below threshold).
**Consequences:** `retrieveResults` gains a pre-embed branch; `pipeline.ts` gains a Step 8.6 + must keep the combined pool addressable.

### D3 — Default impl is a KEY-FREE heuristic; corrective is bounded in-memory (no re-embed, no external fallback)
**Decision:** ship `HeuristicAdaptiveRetrievalPolicy` (key-free): `shouldRetrieve` returns `{retrieve:true}` unless the query matches a configurable no-retrieval signal (default: always retrieve — conservative); `assess` returns `action:'relax'` with `relaxedThreshold = threshold/2` when the top score < `correctiveFloor`, `action:'accept'` otherwise. NO re-embed, NO external service.
**Rationale:** KISS/YAGNI + the locked "memory layer NOT agent runtime" override — full CRAG web-search fallback is an agent-runtime concern (blueprint DEFER-CORNER → TheoKit). Key-free mirrors `LocalTransformerEmbedder`. Deterministic ⇒ testable without a key.
**Alternatives:** LLM-judged default (rejected — needs a key, non-deterministic, slow default); web-search corrective (rejected — out of scope per override); ML complexity classifier (rejected — needs a model, YAGNI for v1).
**Consequences:** the default is deterministic + testable; an optional LLM-judged impl is a clean follow-up behind the SAME DIP.
**EC-1 absorption (edge-case-plan):** the pipeline applies the relax ONLY when `0 ≤ relaxedThreshold < originalThreshold`; an out-of-range or non-narrowing `relaxedThreshold` is treated as `accept` (no correction, no event) — prevents a no-op widening or a garbage-surfacing out-of-range value.

### D4 — Opt-in + default-OFF + fail-soft + 3 observable events
**Decision:** `RecallOptions.adaptive?: { correctiveFloor?: number; relaxedThreshold?: number }` + `createLocalMemory({ retrievalPolicy })`; the adaptive path runs ONLY when BOTH a policy is wired AND `adaptive` is set (or a documented default-on-when-policy-wired rule — chosen: adaptive runs when a `retrievalPolicy` is wired; `RecallOptions.adaptive` tunes it; default OFF means no policy wired ⇒ byte-unchanged). Both hooks are fail-soft (a throw degrades to the normal path + an event). Emit `retrieval_skipped` (shouldRetrieve=false), `retrieval_corrected` (relax fired), `retrieval_low_confidence` (relaxation still empty / reject).
**Rationale:** the exact contract the reranker/diversify/ontology shipped — proven, reviewer-familiar, no behavior change for existing callers. Princípio 3: every skip/correct decision is observable.
**Alternatives:** on-by-default (rejected — breaks byte-unchanged); throw-on-policy-error (rejected — a non-critical enhancement must never fail recall, Rule 8 spirit + the reranker fail-soft precedent).
**Consequences:** 3 event literals append to `MEMORY_EVENTS`; the GOAL test asserts skip + correct + default-unchanged.

### D5 — `@usetheo/memory/adaptive-local` subpath for the default impl (bundle isolation)
**Decision:** ship `HeuristicAdaptiveRetrievalPolicy` behind a dedicated subpath, NOT the default barrel.
**Rationale:** mirrors `@usetheo/memory/reranker-local` (`reranker.ts:25-26`) — the DIP TYPE is reachable from the barrel (zero-runtime), the IMPL is subpath-isolated. Keeps the default import light.
**Alternatives:** export from the root barrel (rejected — the impl is opt-in; the barrel stays minimal); no subpath (rejected — breaks the established per-impl-subpath convention).
**Consequences:** a new `./adaptive-local` export + a bundle-isolation test (the default barrel does NOT reach `heuristic-policy.ts`).

## Dependency Graph

```
T1.1 (DIP port) ─┬─> T2.1 (events + RecallOptions.adaptive)
                 └─> T4.1 (heuristic default impl) ── depends on T1.1 only
T2.1 ─> T3.1 (pipeline Step 8.6 assess + scoped-memory shouldRetrieve gate + fail-soft + events)
T3.1, T4.1 ─> T4.2 (config slot + scoped-memory thread + subpath + isolation + smoke)
T4.2 ─> T5.1 (GOAL integration + full gate)
```

Phases 1→2→3→4→5 sequential; T4.1 may parallelize with T2.1/T3.1 (depends on T1.1 only).

## Phase 1 — AdaptiveRetrievalPolicy DIP port

### T1.1 — `AdaptiveRetrievalPolicy` DIP + type-level contract

#### Why this step
**Action:** create `dip/adaptive-retrieval-policy.ts` — the `AdaptiveRetrievalPolicy` interface (2 methods) + `RetrievalDecision` + `RetrievalAssessment` types, with JSDoc citing ADR D1 + the contract (MUST NOT mutate input; fail-soft is the pipeline's job).
**Reasoning:** the DIP is the spine; every downstream task depends on its shape. Mirrors the `Reranker` DIP (`reranker.ts`) for ISP-minimal + async + DIP-boundary discipline (ADR D1, `architecture.md § 3`).

#### TDD
- RED: `adaptive-retrieval-policy.test-d.ts` — `expectTypeOf<AdaptiveRetrievalPolicy['shouldRetrieve']>` returns `Promise<RetrievalDecision>`; `assess` returns `Promise<RetrievalAssessment>`; `RetrievalAssessment['action']` is `'accept'|'relax'|'reject'`.
- GREEN: declare the interface + types.
- REFACTOR: JSDoc citing ADR D1 + ADR-0008 method cap.

#### Files to edit
- `packages/core/src/domain/dip/adaptive-retrieval-policy.ts` (NEW)
- `packages/core/src/domain/dip/adaptive-retrieval-policy.test-d.ts` (NEW)

#### Deep file dependency analysis
Imports `MemoryItemWithScore` (existing domain type) + `Scope`. No runtime deps. Pure type module — bundle-neutral.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `AdaptiveRetrievalPolicy` has exactly 2 methods (ADR-0008 cap).
- [ ] `RetrievalDecision` + `RetrievalAssessment` types exported.
- [ ] `tsc --noEmit` clean; type-level test green.

#### DoD
- [ ] `npx vitest run --config vitest.contract.config.ts packages/core/src/domain/dip/adaptive-retrieval-policy.test-d.ts` green.
- [ ] CHANGELOG `[Unreleased] § Added` started.

## Phase 2 — Events + opt-in option

### T2.1 — 3 `MEMORY_EVENTS` literals + `RecallOptions.adaptive` toggle

#### Why this step
**Action:** append `retrieval_skipped`, `retrieval_corrected`, `retrieval_low_confidence` to `MEMORY_EVENTS` (`memory-event.ts:16`) + add `RecallOptions.adaptive?: { correctiveFloor?: number; relaxedThreshold?: number }` to `options.ts`.
**Reasoning:** the observability surface (Princípio 3) + the opt-in toggle must exist before the pipeline can emit/consume them. Mirrors the `recall_rerank_failed` literal + the `rerank?` toggle.

#### TDD
- RED: `memory-event.test.ts` — assert the 3 new literals are in `MEMORY_EVENTS`; `options.test-d.ts` — assert `RecallOptions['adaptive']` shape.
- GREEN: append literals + toggle.
- REFACTOR: JSDoc on each literal (when fired) + the toggle (default-OFF).

#### Files to edit
- `packages/core/src/domain/memory-event.ts`
- `packages/core/src/domain/memory-event.test.ts`
- `packages/core/src/domain/options.ts`
- `packages/core/src/domain/options.test-d.ts`

#### Deep file dependency analysis
`MEMORY_EVENTS` is a `readonly` tuple; appending literals widens `MemoryEvent` (`:104`) — purely additive. `RecallOptions.adaptive` is optional → no breaking change.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] 3 new literals present; `MemoryEvent` union widened.
- [ ] `RecallOptions.adaptive` optional; default-OFF preserved.

#### DoD
- [ ] `npx vitest run --config vitest.contract.config.ts packages/core/src/domain/memory-event.test.ts packages/core/src/domain/options.test-d.ts` green.

## Phase 3 — Pipeline + scoped-memory seams

### T3.1 — pre-embed `shouldRetrieve` gate + pipeline Step 8.6 assess+correct (fail-soft + events)

#### Why this step
**Action:** (a) in `scoped-memory.ts retrieveResults`, BEFORE the embed: if a `retrievalPolicy` is wired AND adaptive is active, call `shouldRetrieve`; on `{retrieve:false}` emit `retrieval_skipped` + return `[]`. (b) in `pipeline.ts`, after Step 8: call `assess(query, results)`; on `action:'relax'` re-filter the retained combined pool at `relaxedThreshold` + emit `retrieval_corrected`; on `reject`/empty-after-relax emit `retrieval_low_confidence`. Both wrapped fail-soft (throw ⇒ normal path + no crash).
**Reasoning:** the two seams ARE the feature. Reuses the Step 8.5 fail-soft try/catch pattern (`pipeline.ts:74-99`). The corrective is bounded in-memory (ADR D2/D3 — the over-fetch pool `pipeline.ts:9` already holds sub-threshold rows; no re-embed).

#### TDD
- RED: pipeline unit test with a stub policy — `assess` returns `relax` ⇒ a sub-threshold row surfaces + `retrieval_corrected` emitted (spy tracer); `assess` throws ⇒ normal results, no crash (fail-soft); scoped-memory test — `shouldRetrieve=false` ⇒ `[]` + embed-spy NOT called + `retrieval_skipped`.
- GREEN: implement both seams.
- REFACTOR: extract the assess+correct into a Step-8.6 helper (mirror `applyRerank` `pipeline.ts:74`).

#### Files to edit
- `packages/core/src/domain/retrieval/pipeline.ts`
- `packages/core/src/domain/retrieval/pipeline.test.ts`
- `packages/core/src/infrastructure/db/scoped-memory.ts`
- `packages/core/src/infrastructure/db/scoped-memory.test.ts` (or the existing scoped-memory unit test)

#### Deep file dependency analysis
`pipeline.ts` already imports `emitEvent` + has the combined pool pre-threshold; Step 8.6 reads it. `scoped-memory.ts retrieveResults` (`:301`) runs before the embed on both paths — the gate slots at the top. Default path (no policy) is byte-unchanged: both branches are guarded by `policy !== undefined`.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `shouldRetrieve=false` ⇒ `recall()` returns `[]`, embedder NOT called, `retrieval_skipped` emitted.
- [ ] `assess` relax ⇒ a sub-threshold row surfaces, `retrieval_corrected` emitted.
- [ ] EC-1: relax applied ONLY when `0 ≤ relaxedThreshold < originalThreshold`; out-of-range/non-narrowing ⇒ treated as accept (no event).
- [ ] EC-2: relax fires but pool yields 0 rows ⇒ `retrieval_low_confidence` emitted, original results returned, no throw.
- [ ] EC-3: `RecallOptions.adaptive` set but NO `retrievalPolicy` wired ⇒ byte-identical to plain recall (option-without-policy is a no-op).
- [ ] `assess`/`shouldRetrieve` throw ⇒ normal path, recall never crashes (fail-soft).
- [ ] No policy wired ⇒ byte-identical to v0.17 (default-OFF regression test).

#### DoD
- [ ] `npx vitest run --config vitest.contract.config.ts packages/core/src/domain/retrieval/pipeline.test.ts` + scoped-memory test green.

## Phase 4 — Default impl + config + subpath

### T4.1 — `HeuristicAdaptiveRetrievalPolicy` (key-free default impl)

#### Why this step
**Action:** `infrastructure/adaptive/heuristic-policy.ts` — `shouldRetrieve` returns `{retrieve:true}` by default (configurable no-retrieve markers); `assess` returns `relax` with `relaxedThreshold = threshold/2` when top score < `correctiveFloor`, else `accept`. Pure in-memory, key-free.
**Reasoning:** the default impl makes the feature usable without an LLM key (ADR D3). Deterministic ⇒ unit-testable.

#### TDD
- RED: `heuristic-policy.test.ts` — `shouldRetrieve` true by default + false on a configured marker; `assess` returns `relax` when top < floor, `accept` when top ≥ floor, `low confidence` reason when empty.
- GREEN: implement.
- REFACTOR: JSDoc citing ADR D3; no-paper-names.

#### Files to edit
- `packages/core/src/infrastructure/adaptive/heuristic-policy.ts` (NEW)
- `packages/core/src/infrastructure/adaptive/heuristic-policy.test.ts` (NEW)
- `packages/core/src/infrastructure/adaptive/index.ts` (NEW — subpath barrel)

#### Deep file dependency analysis
Implements `AdaptiveRetrievalPolicy` (T1.1). Imports only domain types. No runtime deps → bundle-light. Lives in a separate module so the subpath stays isolated.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `HeuristicAdaptiveRetrievalPolicy` implements the DIP; key-free; deterministic.
- [ ] Default `shouldRetrieve` is conservative (always retrieve) unless a marker matches.

#### DoD
- [ ] `npx vitest run --config vitest.contract.config.ts packages/core/src/infrastructure/adaptive/` green.

### T4.2 — `LocalMemoryConfig.retrievalPolicy?` slot + scoped-memory thread + subpath export + bundle isolation + smoke

#### Why this step
**Action:** add `retrievalPolicy?: AdaptiveRetrievalPolicy` to `LocalMemoryConfig` (factory.ts), thread it into scoped-memory (so `retrieveResults` + the pipeline opts see it), add the `./adaptive-local` export to `package.json`, the src alias to `vitest.integration.config.ts`, the bundle-isolation assertion + the p0-audit subpath smoke.
**Reasoning:** wires the DIP instance end-to-end (the wiring triad caller) + ships the subpath (ADR D5) with isolation parity to the reranker.

#### TDD
- RED: `subpath-isolation.test.ts` — default barrel does NOT reach `adaptive/heuristic-policy.ts`; `adaptive-local` barrel resolves `HeuristicAdaptiveRetrievalPolicy`. `full-public-surface.test.ts` — `./adaptive-local` smoke-imports.
- GREEN: config slot + thread + exports + alias.
- REFACTOR: JSDoc on the config slot.

#### Files to edit
- `packages/core/src/infrastructure/db/factory.ts`
- `packages/core/src/infrastructure/db/scoped-memory.ts` (thread the policy into pipeline opts + the gate)
- `packages/core/package.json`
- `vitest.integration.config.ts`
- `tests/integration/subpath-isolation.test.ts`
- `tests/integration/p0-audit/full-public-surface.test.ts`

#### Deep file dependency analysis
`LocalMemoryConfig` gains an optional slot (additive). `scoped-memory` passes `retrievalPolicy` into the pipeline `deps` (like `reranker` at `scoped-memory.ts:323`). The `adaptive-local` subpath resolves to `adaptive/index.ts`. Default barrel must NOT statically import the impl (isolation).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `createLocalMemory({ retrievalPolicy })` wires the policy end-to-end.
- [ ] `@usetheo/memory/adaptive-local` resolves `HeuristicAdaptiveRetrievalPolicy`; default barrel does NOT reach the impl (isolation).
- [ ] `npm pack --dry-run` ships `dist/infrastructure/adaptive/*.{js,d.ts}`.

#### DoD
- [ ] isolation + smoke tests green; `tsc` + build clean.

## Phase 5 — Integration Validation

### T5.1 — GOAL integration test + full gate

#### Why this step
**Action:** `tests/integration/adaptive-retrieval.test.ts` against real `ankane/pgvector:v0.5.1`: (1) a `shouldRetrieve=false` policy ⇒ `recall()` returns `[]` + embed-spy count 0 + `retrieval_skipped`; (2) a low `correctiveFloor`-beating weak retrieval ⇒ corrective relax surfaces a sub-threshold row + `retrieval_corrected`; (3) no `retrievalPolicy` ⇒ byte-identical to a plain recall (default-unchanged). Then the full validation gate.
**Reasoning:** THE GOAL — proves the feature works end-to-end against real pgvector + the default is unchanged. Mirrors `reranker.test.ts`.

#### TDD
- RED: the 3-scenario GOAL test (skipIf no `THEOMEM_PG_URI`).
- GREEN: (feature already implemented in P1-4; this asserts end-to-end).
- REFACTOR: honest caveat comment on heuristic determinism.

#### Files to edit
- `tests/integration/adaptive-retrieval.test.ts` (NEW)

#### Deep file dependency analysis
Composes `createLocalMemory({ retrievalPolicy })` + a queue-LLM stub (stored text = fixture) + an embed-spy wrapper to assert the skip path. Real pgvector via `runMigrations`.

#### Concurrency tests
(none — single-threaded)

#### Failure scenarios
(none — no new external I/O touched; the heuristic default is pure in-memory; the existing pgvector failure path is unchanged; the optional LLM-judged impl is deferred. The adaptive hooks are fail-soft per ADR D4 — a policy throw degrades to the normal path, asserted in T3.1.)

#### Acceptance criteria
- [ ] Skip scenario: `[]` + embed-spy 0 + `retrieval_skipped`.
- [ ] Correct scenario: sub-threshold row surfaces + `retrieval_corrected`.
- [ ] Default scenario: byte-identical to plain recall.
- [ ] Contract suite green; `/code-quality` PASS; `tsc`/build/lint clean.

#### DoD
- [ ] `npx vitest run --config vitest.integration.config.ts tests/integration/adaptive-retrieval.test.ts` green vs real pgvector.
- [ ] CHANGELOG `[Unreleased] § Added` notes the feature + subpath.

## Coverage Matrix

| Goal claim | Task(s) |
|---|---|
| `AdaptiveRetrievalPolicy` DIP (shouldRetrieve + assess) | T1.1 |
| 3 observable events + `RecallOptions.adaptive` opt-in | T2.1 |
| pre-embed gate + post-threshold assess-correct seams (fail-soft) | T3.1 |
| key-free heuristic default impl | T4.1 |
| config slot + end-to-end wiring + subpath + isolation | T4.2 |
| GOAL: skip + correct + default-unchanged vs real pgvector | T5.1 |
| default OFF / byte-unchanged | T3.1 (regression) + T5.1 (scenario 3) |
| ZERO new dependency | Dependencies section + /deps-audit |

**Coverage: 8/8 goal claims mapped (100%).**

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| The corrective relax surfaces lower-quality rows (relaxing threshold trades precision for recall) | MEDIUM | The corrective is OPT-IN + bounded (one relax, configurable floor/threshold); default OFF; `retrieval_corrected` makes it observable so operators can tune/disable. Princípio 2 favors priorização — the floor is the guardrail. | impl |
| pipeline Step 8.6 touching the combined pool risks a regression in the default (non-adaptive) path | HIGH | The Step 8.6 branch is guarded by `policy !== undefined`; T3.1 + T5.1 scenario 3 assert byte-identical default output; the existing pipeline tests must stay green. | impl |
| `shouldRetrieve` skip returning `[]` could surprise a caller expecting results | MEDIUM | Opt-in only (no policy ⇒ never skips); `retrieval_skipped` event + the `reason` field make the skip auditable; documented in JSDoc + CHANGELOG. | impl |

## Unresolved Questions

(none — every decision is resolved at plan time. The optional LLM-judged policy is explicitly DEFERRED to a follow-up behind the same DIP per ADR D3; the full CRAG external-fallback is out of scope per the memory-layer-not-runtime override.)

## Failure scenarios

(none — no new external I/O touched. The NEW code (heuristic policy + pipeline Step 8.6 + scoped-memory gate) is pure in-memory; it adds no HTTP/DB/queue call. The existing pgvector recall path is unchanged. The adaptive hooks are fail-soft per ADR D4 — a policy throw degrades to the normal retrieval path, asserted in T3.1.)

## Global Definition of Done

- [ ] All tasks T1.1 → T5.1 complete with green TDD.
- [ ] `tsc --noEmit` (contract) + `tsc -p tsconfig.build.json` (exactOptionalPropertyTypes) clean.
- [ ] Contract suite green; GOAL integration green vs real `ankane/pgvector:v0.5.1`.
- [ ] `/code-quality adaptive-retrieval` PASS (0 hard/soft caps).
- [ ] Default-OFF byte-unchanged proven (T3.1 regression + T5.1 scenario 3).
- [ ] ZERO new dependency (deps-audit PASS).
- [ ] No paper names in `src/**` (Self-RAG/CRAG cite the plan/blueprint, not code).
- [ ] CHANGELOG `[Unreleased] § Added` updated.
- [ ] `/review` READY_TO_MERGE.
- [ ] Plan archived after merge.
