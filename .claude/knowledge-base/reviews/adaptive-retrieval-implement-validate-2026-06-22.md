# Implement Validation — adaptive-retrieval (Item 13)

**Date:** 2026-06-22
**Plan:** `.claude/knowledge-base/plans/adaptive-retrieval-plan.md`
**Verdict:** PASS
**Commit:** `ced3ea7` feat(retrieval): adaptive-retrieval Self-RAG/CRAG decision hooks (Item 13)

## Gates

| Gate | Result |
|---|---|
| `tsc --noEmit -p tsconfig.contract.json` | PASS — 0 errors |
| `npm run build` (tsconfig.build, exactOptionalPropertyTypes) | PASS |
| Contract suite (`vitest.contract.config.ts`) | PASS — 1163 passed, 2 skipped (incl. DIP type test, 3 event-union, RecallOptions.adaptive type, 7 pipeline Step 8.6, 3 shouldRetrieve gate, 6 heuristic) |
| GOAL integration (`tests/integration/adaptive-retrieval.test.ts`) vs real `ankane/pgvector:v0.5.1` (canonical integration config) | PASS — 3/3 (skip + correct + default-unchanged) |
| Subpath isolation + smoke (`subpath-isolation.test.ts`, `full-public-surface.test.ts`, `exports-contract/root`) | PASS (serial) — adaptive-local static graph excludes the heuristic impl from the default barrel |
| `/code-quality adaptive-retrieval` | PASS (0 hard/soft caps; languages_audited=[typescript]) |

## Tasks (TDD per task)

- **T1.1** `AdaptiveRetrievalPolicy` DIP (2 methods, ADR-0008) + `RetrievalDecision`/`RetrievalAssessment`/`AdaptiveTuning` + type-level test. GREEN (tsc).
- **T2.1** 3 `MEMORY_EVENTS` literals (28→31) + `RecallOptions.adaptive` toggle + tests. GREEN.
- **T3.1** pre-embed `shouldRetrieve` gate (scoped-memory) + pipeline Step 8.6 `assess`+correct (fail-soft, EC-1 clamp, EC-2 low-confidence) + cache bypass. 7 pipeline + 3 façade tests GREEN.
- **T4.1** key-free `HeuristicAdaptiveRetrievalPolicy` + `adaptive-local` barrel + 6 unit tests. GREEN.
- **T4.2** `LocalMemoryConfig.retrievalPolicy?` slot (factory spreads config) + DIP type export from `/contract` (core 54→55) + `./adaptive-local` subpath + vitest alias + bundle isolation + smoke. GREEN.
- **T5.1** GOAL integration (real pgvector) 3/3 + full gate. GREEN.

## Wiring triad

- **Caller:** `createLocalMemory({ retrievalPolicy })` → `scoped-memory.retrieveResults` (shouldRetrieve gate) + `runRetrievalPipeline` deps.retrievalPolicy (Step 8.6). Exercised end-to-end by the GOAL.
- **Integration test:** `tests/integration/adaptive-retrieval.test.ts` (real pgvector) + subpath-isolation walk.
- **Runtime observability:** 3 typed `MEMORY_EVENTS` literals via `emitEvent` (skip/correct/low-confidence) + fail-soft never-crashes.

## Edge cases absorbed (edge-case-plan)

- EC-1 (relaxedThreshold clamp `0 ≤ rt < threshold`) — pipeline test + heuristic.
- EC-2 (relax surfaces nothing ⇒ low_confidence) — pipeline test.
- EC-3 (adaptive option without wired policy ⇒ no-op) — façade test.
- EC-4 (skip still counts as a recall() invocation) — documented in code.

## Notes / honest disclosure (Inquebrável Rule 3)

- An authoring bug was caught + fixed in-cycle by the build gate: `RecallOptions.adaptive` was initially added to the WRONG interface (`GetAllOptions` via a mis-anchored `category` field); the vitest typecheck (which only covers `*.test-d.ts`) gave a false green, but `npm run build` (full `tsc -p tsconfig.build.json`) caught it. Moved to `RecallOptions`; contract tsc + build now clean. Lesson: the authoritative type gate is `tsc -p tsconfig.contract.json` / `npm run build`, not the vitest typecheck subset.
- Integration suite must run `--no-file-parallelism` (known dist-race flake). Pre-existing `pgvector-store.test.ts` dual-module-identity failures + mem0 reference-clone failures are NOT introduced by this cycle.
- ZERO new dependency (heuristic default is pure in-memory; optional LLM-judged impl deferred behind the same DIP).
