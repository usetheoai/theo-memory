# Review: m10-scope-aware-recall

**Date:** 2026-07-22
**Reviewers (spawned agents):** 2 parallel (architecture+wiring; tests+cross-validation)
**Diff:** `9e0f45c^..b969dde` (6 M10 task commits) + fix-cycle `ce2cda8`
**Code-quality gate:** PASS_WITH_CAVEATS (89) — `135b071`
**Findings:** 20 total (BLOCKER: 0, HIGH: 1, MEDIUM: 7, LOW: 5, INFO: 7)
**Verdict:** READY_TO_MERGE (all HIGH + MEDIUM resolved in `ce2cda8`)

## HIGH (resolved)

- **F-arch-1 — recall cache omitted `scopes` from the bypass guard.** A wired recall cache skipped the reweight on a HIT and stored the reweighted order under a scopes-blind key on a MISS (poisoning a later plain recall → breaking "default byte-identical"). **FIX:** added `options?.scopes === undefined` to `cacheApplicable` (`scoped-retrieval.ts`), mirroring rerank/graphExpand. Regression test `M10 F-arch-1 — recall({ scopes }) BYPASSES cache`. Verified 19/19 cache suite green.

## MEDIUM (all resolved)

| ID | Summary | Resolution |
|---|---|---|
| F-tests-2 | absent `created_at` → `now` fallback → MAX recency boost (violates AC + Risk #1) | reweight reads recency from projected `metadata['created_at']`; absent/unparseable → NEUTRAL (0). Unit test `test_absent_created_at_is_neutral_not_max_recency`; T4.1 integration re-verified. |
| F-tests-4 | vendor/paper name ("mem0") in a `src/**` test comment (Rule 9) | renamed to "the reference scoring test". |
| F-arch-2 / F-tests-7 | JSDoc `@throws InvalidScope` for the rerank-combo case (impl throws `RerankerConflict`) | corrected JSDoc: RerankerConflict for rerank/diversify combo; InvalidScope only for out-of-`[0,1]`. |
| F-tests-5 | benchmark recall@k relevant-set = the reweight's own target (tautological framing) | doc/verdict reframed as "surfaces the scope-preferred set into top-k"; real-pipeline proof cited as T4.1; safety proven by the bounded unit test. |
| F-tests-3 | `created_at`-only vs plan's `created_at + last_accessed_at` (undocumented narrowing) | documented as a deliberate KISS/YAGNI v1 choice in the benchmark doc. |
| F-tests-1 | fail-soft + `scope_reweight_failed` declared in plan, not implemented | documented: `scopeAwareReweight` is a TOTAL pure function (no throw path) → the event/catch would be unreachable dead code; fail-soft satisfied by construction (comment at call site). |

## LOW (advisory — documented, consistent with existing precedents)

- **F-tests-6** — projection-cost arm counted 2 columns; M10 added only `created_at`. **FIXED** (marginal `created_at`-only arm ≈ 0.27 ms).
- **F-tests-8** — `rerank: { topPool: 3 }` used a diversify field. **FIXED** → `{ pool: 3 }` (also caught by contract typecheck).
- **F-arch-3** — `recall()` DTO `createdAt` now reflects real row age for ALL callers (a fix, but a behavior change). **DISCLOSED** in CHANGELOG.
- **F-arch-4** — options-shape validation runs deep in the pipeline, not at the boundary. Advisory; consistent with the existing rerank/diversify precedent (RerankerConflict + diversify.lambda validate at the same seam). Not changed unilaterally — would fix all three together or none.
- **F-arch-5** — reweight traces only threshold drops, not topK-overflow demotions. Advisory; consistent with the rerank path. The `scope_reweight_applied` event keeps the stage observable.
- **F-tests-9** — two planned unit artifacts (pgvector-store SQL-string assertion, options.test-d.ts) absent; behavior covered by integration (`created-at-projection.test.ts`) + the pipeline optionality tests. Substitution noted here.

## INFO (clean — no action)

- F-arch-6/9: DIP/SRP/KISS/DRY clean — pure domain fn, `now` injected, helpers named, rowToItem reused.
- F-arch-7: `(workspace,user)` isolation intact — reweight only re-orders an already-filtered pool; reads `session_id` for classification only.
- F-arch-8: wiring pillar (a) confirmed — `options` threaded to `runRetrievalPipeline` at both scoped-retrieval call sites; created_at projected (dual-pathway).
- F-tests-10: T4.1 isolation proof is REAL/non-vacuous (fixed unit-vector embedder → a broken filter WOULD leak; strict `toEqual(['bob private fact'])`).
- F-tests-11: unit suite asserts behavior, covers edges, deterministic (fixed clock).

## Cross-validation

100% of the M10 Coverage Matrix maps to committed tasks (T1.1→T4.2). All DoD/AC items met; the one narrowing (created_at-only) is now documented, not silent.

## Quality gates (post-fix)

- typecheck: PASS (0)
- unit: 60/60 (scope-reweight 6, pipeline 12, factory-recall-cache 19, memory-event + others)
- integration (real pgvector): 2/2 (T1.1 projection, T4.1 ranking+isolation)
- lint: PASS (0)
- code-quality: PASS_WITH_CAVEATS (89) — 27 `symbol_fab_unverifiable_typescript` SOFT_FLOOR (sandbox no-registry class; typecheck authoritative), HARD=0

## Handoff decision

**READY_TO_MERGE.** No BLOCKER; the single HIGH and all 7 MEDIUM findings are resolved in `ce2cda8`; LOW/INFO are advisory and documented. Release is gated on the M8 PR #106 merge (owner action) — M9/M10 commits are post-v0.39.0-cut and cannot open a second `develop→main` PR until #106 closes.
