# Review: create-memory-preset

**Date:** 2026-07-12
**Diff base:** `17296fe` (v0.33.0 RELEASED — this session's changes only; `main` is 715 commits behind and NOT a valid review base)
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-memory-layer, domain-api-design
**Findings:** 0 BLOCKER · 0 HIGH · 1 MEDIUM · 5 LOW · rest INFO
**Verdict:** `READY_TO_MERGE` (after fixes commit `32e44da` — all MEDIUM + actionable LOW resolved)

## Consolidated findings

### MEDIUM (resolved)

**F-MED-1 — plan-promised compile-time type test was replaced by a runtime test** (flagged by cross-validation F-xval-1, tests F-tests-1, api-design F-dom-api-1; architecture F-arch-3 as LOW).
- The plan (T2.1 § Files to edit + Drawbacks row 3) declared a type-level test in `domain/index.test-d.ts` proving the non-breaking overload at compile time + a discriminator-collision tripwire. That file was untouched; a runtime `factory-dispatch.test.ts` was added instead. The existing `index.test-d.ts:100` uses a synthetic factory that never references the real `createMemory`, so it could not catch a regression. Net: a public overload shipped with no compile-time non-breaking guard, and the exact risk the plan named (a future `postgres` field on `LocalMemoryConfig` silently misrouting full-config callers) had no tripwire.
- **Resolution:** added `packages/core/src/infrastructure/db/__tests__/create-memory-preset.test-d.ts` — `expectTypeOf(createMemory)` callable with BOTH shapes, returns `Promise<DisposableMemory>`, and `expectTypeOf<LocalMemoryConfig>().not.toHaveProperty('postgres')` as the tripwire. Picked up by the contract typecheck (`__tests__` glob); 4/4 green.

### LOW

- **F-LOW-1 (tests, resolved)** — `factory-dispatch.test.ts` only asserted the preset branch. Added a full-config-branch assertion (`resolvePreset` NOT called for `LocalMemoryConfig`) + a `beforeEach` mock-clear.
- **F-LOW-2 (tests, resolved)** — EC-4 negative test asserted the class but not the message and skipped the whitespace-only branch. Pinned the `InvalidPresetConfig` message + added a whitespace-only `postgres` test (`testing.md §4.1`).
- **F-LOW-3 (api-design, resolved)** — public exports carried `@see` only at the barrel; added `@see` at the `CreateMemoryPresetConfig` + `InvalidPresetConfig` definition sites.
- **F-LOW-4 (memory-layer, accepted/disclosed)** — one OpenAI key per process (module-global lazy singleton). Already disclosed in preset JSDoc + CHANGELOG with the full-config path as the escape hatch (Rule 3). No code change for this plan.
- **F-LOW-5 (cross-validation, accepted/disclosed)** — the export-count reconcile absorbed 3 pre-existing unrelated deltas beyond this cycle's +1. Disclosed with in-line provenance in `full-public-surface.test.ts` + the commit body. Benign.

### INFO (positives verified against real code, not plan claims)

- **wiring — CLEAN**: every new symbol has a functional production caller; `assemblePresetMemory` correctly `@internal` (deep-imported by the test, absent from both barrels + `package.json#exports`); integration test hits the real pgvector boundary.
- **memory-layer — CLEAN**: Mem0-shape pipeline reused (not bypassed); `embeddingDim=1536` threaded identically (footgun closed, `probeEmbedder` enforces); dispose-wrap preserves prototype methods (no-spread); auto-migrate consistent with Item 18; 3 fundamental principles inherited unchanged.
- **architecture — sound**: factory↔preset cycle ESM-safe (function-body consumption only); DIP boundary respected; no `any`; `preset.ts` 171 / `factory.ts` 302 LoC (≤500); no paper-names.
- **cross-validation**: 4/4 tasks map 1:1 to commits; all 5 ADRs respected; all 9 edge cases absorbed; Coverage Matrix 12/12; no plan drift.
- **GOAL test is a real wiring proof**, not a tautology; mock design sound; CI/secret hygiene exemplary (EC-17 loud-fail; live-OpenAI opt-in).

## Cross-validation summary
- Plan tasks: 4 · Fully implemented: 4 · Partial: 0 · Missing: 0 · Diverged: 1 (T2.1 test-shape — now reconciled by the type-test addition).

## Quality gates summary
- npm test (full contract suite): PASS · typecheck: PASS · lint: PASS (0 warnings) · code_quality: PASS (100, no-network) · wiring_triad: pillar (a) 0 uncalled symbols.
- GOAL integration test vs real `ankane/pgvector:v0.5.1`: 3 passed / 1 skipped (live-OpenAI opt-in).

## Spawned agents (audit trail)
- `.claude/agents/review-create-memory-preset-2026-07-12/{architecture,tests,wiring,cross-validation,domain-memory-layer,domain-api-design}.md` + `findings/*.yaml`

## Handoff decision
**READY_TO_MERGE.** 0 BLOCKER, 0 HIGH. The single MEDIUM and the three actionable LOW findings were fixed in a follow-up commit (compile-time type guard restored, negative cases strengthened, docs polished). The two remaining LOW findings are consciously accepted + disclosed. Next: `/release` (PR `develop` → `main`, human-approved merge + semver tag).
