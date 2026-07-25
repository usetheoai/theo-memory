# Review: stale-recall-and-abstention (M22 · #141 + #140)

**Date:** 2026-07-25
**Reviewers:** 3 adversarial specialists (correctness/invariant, tests/regression-risk, cross-validation/honesty) + orchestrator independent verification.
**Verdict:** READY_TO_MERGE

## Consolidated

All three specialists → **READY_TO_MERGE**. Zero BLOCKER, zero HIGH. The #1 risk — byte-identical recall when `recencyCollapse` is OFF — was independently PROVEN (guarded no-op; `scoring.ts` untouched; T1.1 green). The #141 RED→GREEN fixture is genuinely non-vacuous (verified by rebuild+run: default recall surfaces stale `27:12`; the collapse flips to fresh `25:50` + `superseded_recency` audit drop; stub embedder makes the OLDER row *more* relevant so only the collapse can decide). Findings (all LOW/INFO/one soft MEDIUM) addressed in fix commit `ea09524`:

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| F-1 (rev1) | LOW | Greedy mutable-representative collapse can transitively drop a non-duplicate (A~B, B~C, A≁C) | FIXED — `collapseByRecency` now uses STABLE-SEED single-linkage (compare against the fixed cluster seed); strictly more conservative; regression test proves `c` survives. |
| F-2 (rev1) | LOW | Collapse emitted no OTel event → silent when no recall-trace store wired (Princípio 3 tension) | FIXED — emits `recency_collapse_applied` {collapsed_count, pool_size} (52nd MEMORY_EVENT); mirrors `scope_reweight_applied`; emit inside the stage to keep pipeline.ts ≤300 LoC. |
| M22-02 (rev2) | MEDIUM | eval test "resolves to stale dist" | NOT A DEFECT — the eval `vitest.config.ts` aliases `@usetheo/memory` → `../core/src` (verified), so `pnpm --filter @usetheo/memory-eval test` uses live core src and is self-contained (26/1 green without a rebuild). The reviewer's `require.resolve` path (dist) is not the test path. |
| M22-03 / rev3-F2 (LOW) | LOW | `recencyCollapse + scopes` mutual-exclusion untested; 3-cluster untested | FIXED — added the `scopes` row + the F-1 3-cluster case. |
| M22-04 (rev2) | LOW | `graphExpand`/`adaptive` + `recencyCollapse` combination unspecified | DOCUMENTED — JSDoc now states recencyCollapse COMPOSES with graphExpand/adaptive (they change pool membership; the rerank family re-orders the same pool and is the mutually-exclusive set). |
| rev3-F1 | LOW | #140 comment said "being closed" but issue OPEN | FIXED — #140 CLOSED with a final resolution comment. |
| rev3-F5 | INFO | benchmark doc said 1373, actual 1374 | FIXED — bumped to 1374 (now 1377 after the batch). |

## Positive verifications (independently confirmed)

- **Byte-identical-OFF PROVEN** — the stage is a guarded no-op when `recencyCollapse` is absent; `scoring.ts` not in the diff; T1.1 asserts the unchanged golden order.
- **Collapse correct** — keeps MAX `createdAt`; cosine over candidate embeddings; deterministic tiebreak (createdAt → score → id); ADD-only honored (dropped row persisted, `asOf`-recoverable, recorded as `superseded_recency`).
- **Mutual-exclusion + cache-bypass** present (RerankerConflict guard + `scoped-retrieval.ts` bypass), each tested.
- **options.ts → recall-options.ts split** behavior-preserving (re-export; 3 asOf tests repointed, assertions unchanged).
- **#141 RED→GREEN non-vacuous** — accuracy=1 iff bug-present AND fixed; cannot pass vacuously.
- **#140** — `shouldAbstain` pure + tested (empty/low/high/boundary); wired before the answerer; core decline honest + well-reasoned.
- **Honesty** — read-time-only disclosed in JSDoc + CHANGELOG + benchmark doc; opt-in default-OFF confirmed.

## Quality gates (orchestrator-run, post-batch)

- `npm test` (full contract suite) → **179 files, 1377 passed, 3 skipped, 0 type errors**.
- `pnpm --filter @usetheo/memory-eval test` → 26 passed, 1 skipped.
- `npm run typecheck` → exit 0.
- `/code-quality` → PASS_WITH_CAVEATS (89; no-network symbol-fab soft-floor, HARD=0).
- `npm run lint` → BLOCKED by the pre-existing #123 brace-expansion breakage (issue #138), independent of M22; the `check_quality.py` code-smell gate + tsc cover the changed files.

## Handoff

READY_TO_MERGE → `/release`. Plan carries `milestone_id: M22` → post-merge flips ROADMAP.md M22 → `[x]`; closes #141 (core fix shipped); #140 already closed (decline + harness fix).
