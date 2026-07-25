# Review: pipeline-decomposition-behavior-frozen (M19 — #124)

**Date:** 2026-07-25
**Reviewers (spawned agents):** 3 — architecture, cross-validation/behavior-preservation, wiring
**Findings:** 3 total (BLOCKER: 0, HIGH: 0, MEDIUM: 0, LOW: 1, INFO: 2)
**Verdict:** READY_TO_MERGE

A behavior-preserving refactor: `pipeline.ts` 726 → 292 lines, decomposed into 8 cohesive modules.
All three agents independently confirmed zero behavior change and structural correctness. The
behavior-preservation is not merely asserted — it is independently verified: the benchmark artifact
is byte-identical to origin/main, no existing test assertion was edited, and the orchestration body
is line-for-line identical to the pre-refactor code.

## Behavior-preservation proof (cross-validation, independently verified)

| DoD item | Status | Evidence |
|---|---|---|
| `pipeline.ts` < 300 lines | PASS | `wc -l` = 292 (was 726) |
| No test assertion edited | PASS | `git diff origin/main..HEAD -- '*.test.ts'` = exactly one file, ADDED (`stages-extraction.test.ts`) |
| `filterAtThreshold` byte-equivalent | PASS | same gate logic; `drops.push` factored to a private `recordDrop` (same fields/reasons) |
| `applyGraphExpansionStage` banded-score math | PASS | identical floor / 0.999 band / shared-entities ratio / Math.min / sort / fail-soft |
| `makeRowToItem` byte-equivalent | PASS | `scope`/`now` parameterized, same order; attributedTo/confirmationCount/created_at/payloadToScore identical |
| Duplicated blocks extracted | PASS | `recordDrop` (drops-push) + `toCandidate` (bm25 candidate assembly) DRY helpers |
| Benchmark identical (monotonic 0 / churn@0.8 0 / precision 1.0) | PASS (strongest) | `entity-boost-m18.json` empty diff vs origin/main |
| Orchestration order preserved | PASS | post-threshold body line-for-line identical: threshold→sort→map→adaptive→graph→conflict→scopes→rerank→diversify/topK→trace |

Author-run (not re-executed by the agents, but the load-bearing proofs above ARE): full contract
suite 1355 pass; entity-boost + reranker + entities + cache integration 61 pass vs real
`ankane/pgvector:v0.5.1`.

## Findings (all advisory)

- **M19-A1 (LOW, architecture)** — `threshold-filter.ts` owns both the gate algorithm AND the shared
  scoring types (`Payload`/`Candidate`/`ScoredRow`/`DroppedCandidate`) that 5 modules import — a mild
  SRP smell. Explicitly plan-sanctioned (ADR D1) and cycle-free. Deferred: a dedicated `stages/types.ts`
  belongs in a future NON-frozen refactor, not under this behavior-frozen cycle (moving types now would
  add churn with no behavior benefit).
- **M19-A2 (INFO, architecture/cross-validation traceability)** — `candidate-assembly.ts` is a 7th
  extraction beyond the plan's six named tasks (T1.1-T1.6). Legitimate cohesive extraction (Steps 6-7)
  needed to reach < 300 LoC, byte-parity with the old inline block, and it de-duplicates the bm25
  candidate block the quality hook flagged. Documented here for traceability; behavior-preserving.
- **M19-A3 (INFO, architecture)** — cosmetic: the `export type { RetrievalDeps }` re-export sits between
  the import block and the `runRetrievalPipeline` doc-comment. No functional impact; left as-is.

## Wiring
All 8 extracted stage functions have a production caller; `filterAtThreshold` retains BOTH call sites
(initial pass + adaptive-relax re-filter); `runRetrievalPipeline` signature byte-identical, still the
single entry consumed by `scoped-retrieval.ts` + `scoped-skill-memory.ts`; lint + tsc clean.

## Quality gates
- `/code-quality`: PASS, cap 100, zero hard caps.
- Full contract suite 1355 pass; integration 61 pass; benchmark three numbers identical.
- LONG FILE (726 > 300) + all hook-flagged duplicate blocks: resolved.

## Handoff decision
READY_TO_MERGE → `/release`. No BLOCKER, no HIGH, no MEDIUM. The #1 milestone risk (a subtle ranking
bug introduced by the refactor) was hunted line-by-line by cross-validation and found ABSENT; the
benchmark byte-identity is the empirical seal.
