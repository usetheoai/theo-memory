# Review: cross-encoder-reranker

**Date:** 2026-06-22
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-memory-layer, domain-database
**Findings:** 22 total (BLOCKER: 0, HIGH: 0, MEDIUM: 4, LOW: 8, INFO: 10)
**Verdict:** READY_TO_MERGE

The cross-encoder-reranker feature (Roadmap Item 23) passed all 6 specialist reviews with **zero BLOCKER, zero HIGH**. The 4 MEDIUM findings were **closed inline** (commit `fe195f0`); the LOW/INFO findings are advisory and accepted with rationale below.

## MEDIUM findings (all closed inline)

### F-arch-3 — @xenova output narrowed without a runtime guard → CLOSED
- Found by: architecture. File: `packages/core/src/infrastructure/rerankers/cross-encoder.ts`.
- The `as unknown as RunSequenceClassifier` cast had no runtime guard on `output.logits.data`; a future @xenova shape drift would silently yield `?? 0` scores (quiet precision regression) instead of tripping ADR D4 fail-soft.
- **Fix:** added a runtime shape guard that throws a `TypeError` when `logits.data` is missing/short → caught by the pipeline try/catch → `recall_rerank_failed` emitted (observable degradation).

### F-arch-2 — `runRetrievalPipeline` cohesion (rerank branch inline) → CLOSED
- Found by: architecture. File: `packages/core/src/domain/retrieval/pipeline.ts`.
- Plan T2.2's REFACTOR step anticipated extracting the rerank branch. The function carried both post-threshold strategies inline (~200 LoC).
- **Fix:** extracted Step 8.5a to the module-level `applyRerankStage` helper; the main function now delegates in one line.

### F-tests-2 — missing retry-after-rejection test (T3.1 AC) → CLOSED
- Found by: tests. File: `packages/core/src/infrastructure/rerankers/cross-encoder.test.ts`.
- T3.1's concurrency AC mandated a test that a rejected first model load resets the lazy singleton so the next call retries (F-M5 parity). Only the single-load invariant was tested.
- **Fix:** added `retry-after-rejection` test (mock rejects the first load for a model id, asserts the second call retries + succeeds + two load attempts total).

### F-tests-1 — `RecallOptions.rerank` type-contract not asserted (T2.1 AC) → CLOSED
- Found by: tests. File: `packages/core/src/domain/options.test-d.ts`.
- T2.1 RED mandated asserting the `rerank?` opt-in shape at the type level.
- **Fix:** added `expectTypeOf<RecallOptions['rerank']>()` assertion for `{ readonly topK?; readonly pool? } | undefined`.

## LOW / INFO findings (advisory — accepted)

- **Rerank SUCCESS path reuses `extraction_completed` OTel event** (F-wire-1 LOW, F-dom-1 INFO, F-dom-db-2 LOW — flagged by 3 agents). ACCEPTED: this follows the pipeline's pre-existing event-reuse convention (Step 1 reuses `extraction_started` for "search started"). The load-bearing Princípio 3 requirement — the IGNORE/degrade decision — emits the dedicated typed `recall_rerank_failed` member of MEMORY_EVENTS on fail-soft, verified via a real OTel span assertion. A dedicated `recall_rerank_succeeded` event is optional post-merge polish, not a defect.
- **`.score` semantic shift between rerank/non-rerank modes** (architecture LOW) — documented in JSDoc; the reranked `score` is the cross-encoder sigmoid relevance (intentional per blueprint Rec 1). ACCEPTED.
- **Consumer `rerank.pool` > over-fetch ceiling silently capped** (F-dom-db-1 LOW) — safe (the `.slice()` operates on the already-bounded `internalLimit = max(topK*4, 60)` fetch; no SQL DOS). JSDoc note deferred. ACCEPTED.
- **GOAL test doesn't call `memory.dispose()`** (F-dom-db-3 LOW) — leak-free here (no cron configured); latent fragility only. ACCEPTED.
- **DoD command paths reference `packages/core/vitest.contract.config.ts`** (F-xval-3 INFO) — configs live at repo root; no functional impact (tests pass from root). ACCEPTED.

## Cross-validation summary

- Plan tasks: 7 (T1.1, T2.1, T2.2, T3.1, T3.2, T4.1, T5.1)
- Fully implemented: **7** · Partial: 0 · Missing: 0 · Diverged (without ADR): 0
- ADR compliance: **6/6** (D1 1-method DIP · D2 cross-encoder @xenova text_pair+sigmoid no-new-dep · D3 post-threshold + mutual-exclusion fail-loud · D4 fail-soft + `recall_rerank_failed` · D5 opt-in surface + subpath isolation · D6 cache bypass)
- Coverage Matrix: 14/14 rows mapped + implemented
- **Goal honest amendment** (F-xval-1 LOW): the plan Goal was re-scoped post-/implement from "precision@1 flips wrong→right" to "relevance-correct #1 + real cross-encoder re-scoring" — verified as an Inquebrável-Rule-3 honesty-strengthening amendment (disclosed in both plan + test JSDoc, implementation faithfully satisfies the amended measurable), NOT a silent contract-weakening. Downgraded from the template's nominal BLOCKER to LOW.
- **M1/M2 drift reconciliation** (F-xval-2 INFO): commit `9af8f9c` reconciles pre-existing M1 v0.13 / M2 v0.14 public-surface drift (export-count snapshots + JSDoc + episode.ts Buffer portability) that left 4 pg-gated p0-audit files red. Honestly disclosed with project-owner sign-off; the reranker's own +1 export is cleanly separated from the absorbed drift. NOT silent scope creep.

## Quality gates summary

- `npm test` (contract): **1104 passed | 2 skipped**, 0 failed
- `npx vitest --config vitest.integration.config.ts` (full): **111 files passed | 8 skipped**, 0 failed (incl. the 4 previously-red p0-audit files now green + the reranker GOAL test)
- `npm run typecheck`: **0 errors**
- `npm run lint`: **0 warnings**
- `/code-quality cross-encoder-reranker`: **PASS 100** (0 hard caps, 0 soft caps, no symbol_fabrication, no dead_public_export)
- Wiring triad: CALLER (createLocalMemory → config.reranker → scoped-memory → pipeline Step 8.5a, full path connected) + INTEGRATION TEST (real pgvector + real @xenova) + METRIC (`recall_rerank_failed` in MEMORY_EVENTS, real span asserted) — all honest PASS. Bundle isolation: default barrel ⊅ @xenova via reranker (13 isolation tests pass).
- Deps: ZERO new dependencies (reuses `@xenova/transformers@^2.17.2`).

## Spawned agents (audit trail)

- `.claude/agents/review-cross-encoder-reranker-2026-06-22/architecture.md`
- `.claude/agents/review-cross-encoder-reranker-2026-06-22/tests.md`
- `.claude/agents/review-cross-encoder-reranker-2026-06-22/wiring.md`
- `.claude/agents/review-cross-encoder-reranker-2026-06-22/cross-validation.md`
- `.claude/agents/review-cross-encoder-reranker-2026-06-22/domain-memory-layer.md`
- `.claude/agents/review-cross-encoder-reranker-2026-06-22/domain-database.md`
- Findings: `.claude/agents/review-cross-encoder-reranker-2026-06-22/findings/*.yml`

## Handoff decision

**READY_TO_MERGE** — 0 BLOCKER, 0 HIGH, all 4 MEDIUM closed inline (`fe195f0`), LOW/INFO accepted with rationale. Next: `/release` (cut `develop` → `main` semver tag).
