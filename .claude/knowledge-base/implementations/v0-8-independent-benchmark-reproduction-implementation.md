# Implementation Working Contract — v0-8-independent-benchmark-reproduction

**Plan:** `.claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md` (v1.2 — SHIPPABLE_WITH_CAVEATS 84.8/100)
**Spawned:** 2026-06-02 by `/implement` (cycle-implement.md v1.5)
**Started at HEAD:** `8784052` (post cycle-plan v0.8 completion)
**Scaffolding HEAD:** `b157065`

## Plan drifts documented (NOT defects requiring cycle-plan re-loop)

| ID | Drift | Resolution |
|---|---|---|
| Drift-T0.1-1 | Plan v1.2 lines 240 + 321 reference `src/core/dip/index.ts` re-export; **file does not exist**. v0.7 ConflictResolutionPolicy precedent re-exports through `src/core/index.ts` (lines 115-119). | Followed v0.7 precedent — re-export via `src/core/index.ts`. Cosmetic drift; intent preserved. |

## Task list (dependency order)

(unchanged from spawn — see scaffolding commit `b157065`)

## SEPA load-bearing risks

(unchanged from spawn — see scaffolding commit `b157065`)

## ADR cross-references (mandatory per task)

(unchanged from spawn — see scaffolding commit `b157065`)
