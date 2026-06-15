# Follow-ups — reflect/pipeline LoC cycle (2026-06-15)

Post-cycle decision record + tracked debt from the dedicated reflect/pipeline
LoC + LLM-gated-path verification cycle (commit `efb3a4c`).

## Done (commit `efb3a4c`, on develop)

- `LocalScopedMemory.reflect()` 166-line inline orchestration extracted to a
  `this`-free `runReflection(deps, options)` in
  `packages/core/src/infrastructure/db/reflect-orchestrator.ts`.
  `scoped-memory.ts`: 545 → 352 LoC (under the 500-LoC soft budget; closes the
  standing >500-LoC exception, Finding #4).
- Verified: typecheck clean; 930 contract tests green; 9/9 distillation/reflect
  integration tests green against real `ankane/pgvector` + real LLM
  (`the-goal-test-llm-measured` exercises the real-LLM consolidation branch
  through `runReflection`); lint 0 warnings.

## Decision — `extraction/pipeline.ts` accepted at 515 LoC (KISS exception)

Project-owner decision 2026-06-15 (AskUserQuestion): **accept as a documented
KISS exception; do NOT split.**

Rationale:

- 515 LoC is 3% over a SOFT guideline (the 500-LoC budget lives in
  `/plan-confidence` defaults, not an automated `/code-quality` gate — no gate
  is bypassed by this decision).
- The file is already SRP-decomposed: 4 pure helpers (`scopeFromFilters`,
  `buildPayload`, `toMemoryItem`, `patchItemsWithOutcomes`) + two phase helpers
  (`embedBatchWithFallback` Phase 3, `persistWithFallback` Phase 6) +
  `runInferFalsePath` (the verbatim fast-path) are all extracted.
- What remains is the `runExtractionPipeline` orchestrator: the 8 write phases
  as a single sequential narrative where each phase feeds the next. Extracting
  the phases into separate modules would require threading 10+ intermediate
  variables across module boundaries — INCREASING coupling and breaking the
  readable top-to-bottom flow. KISS/YAGNI win over a mechanical LoC target.

Revisit only if the file grows materially past ~550 LoC OR a phase becomes
independently reusable.

## Tracked debt — dim-change canary fails for the entities table at 384-dim

**Status: OPEN — separate follow-up (not caused by the reflect refactor).**

`tests/integration/adapters-or-local-e2e-smoke.test.ts` (the only real-LLM
`remember()`/extraction-path E2E, key-gated) fails in `beforeAll` →
`runMigrations` → `applyDimChange`:

```
[themory] dim-change post-ALTER canary FAILED:
  entities.embedding atttypmod=1536 ≠ targetDim=384
  at applyDimChange (packages/core/src/infrastructure/db/migrations-runner.ts:311)
```

- Repro: fresh isolated DB (`themem_adapters_e2e_smoke`, dropped+recreated by
  the test), default migrations create `embedding` at 1536, then the 384-dim
  local embedder triggers `applyDimChange` → the `memories` ALTER converts but
  the `entities.embedding` column stays at 1536, tripping the value-based canary.
- This blocks an empirical green run of the **extraction** LLM-gated path
  (`runExtractionPipeline`). The extraction path remains covered by the
  non-LLM integration suite; only the real-LLM E2E is blocked.
- Subsystem: migrations dim-change (`migrations-runner.ts::applyDimChange`) —
  unrelated to reflect/scoped-memory; the failure is in `beforeAll` before any
  refactored code runs.
- Suspected cause: the `entities.embedding` `ALTER TYPE vector(N)` is not being
  issued (or is no-op'ing) on the 384-dim path while the `memories` ALTER fires.
  Verify the ALTER block enumerates `entities` symmetrically with `memories`.

Next step: dedicated migrations cycle — reproduce, add a RED test for the
entities-table 384-dim ALTER, fix, confirm the adapters E2E goes green.
