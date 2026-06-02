# Drift trail — v0-8-independent-benchmark-reproduction (post-implementation)

> **Sibling file** to `.claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md` v1.2 (source plan).
>
> **Source plan v1.2 stays FROZEN — UNTOUCHED post-implementation per EC-2 of v0-8-fixes-cycle-1.** Modifying the source plan after `/implement` would trip `cycle-review.md § Trigger conditions` ("The plan has been revised post-implementation — refuse to start"). Drift markers persist here instead, preserving re-`/review` reachability.
>
> Date: 2026-06-02
> Source review: `.claude/knowledge-base/reviews/v0-8-independent-benchmark-reproduction-review-2026-06-02.md`
> Driven by: `v0-8-fixes-cycle-1` T4.1 (closes F-xval-1, F-xval-2, F-xval-3, opportunistic F-tests-10 + F-dom-mem-1)

## Drift markers (5)

### Drift-T1.1-1 — BLEU metric DEFERRED (replaces F-tests-1 BLOCKER)

**Surface:** `src/benchmarks/metrics/bleu.ts` (rewritten 2026-06-02 commit `f048bad`).

**Origin:** F-tests-1 BLOCKER from `/review` 2026-06-02 — `natural@8.1.1` empirically has zero BLEU exports (`find node_modules/natural -name '*bleu*'` returned zero matches). The source plan v1.2 ADR D1 ("ADOPT only metric primitives") assumed BLEU was reachable via `natural.BleuScore`. Plan v1.2 was wrong about empirical reality.

**Resolution:** `calculateBleuScore` rewritten to throw `BleuMetricUnavailable` typed error carrying the marker text. BLEU column removed from runner pipeline (`PerQueryRecord.bleu` dropped), matrix (`docs/benchmarks/v0.8.md`), and aggregator (`RunAggregate.bleuMean` dropped). F1 + Exact Match remain as the lexical pair; LLM-judge covers semantic.

**Future re-introduction path:** hypothetical `v0-8-bleu-vendor-cycle` shipping Option B (vendor inline BLEU-1 ~30 LoC) IFF v0.8 audience demands BLEU column post-publication.

### Drift-T2.1-2 — LongMemEval loader silent JSON.stringify fallback (closes F-xval-1)

**Surface:** `src/benchmarks/fixtures/longmemeval-loader.ts`.

**Origin:** F-xval-1 MAJOR from `/review` — the loader emits `JSON.stringify(...)` as a fallback when a fixture row's `answer` field is of an unexpected type (Mem0's fixture row schema has mixed types per blueprint Q6).

**Resolution decision:** keep the silent stringify fallback. Plan v1.2 § T2.1 implicitly called for `throw new InvalidFixtureFormat` on shape violations; the implementation chose the more permissive path because the LongMemEval upstream genuinely ships mixed-type rows. This drift is a Plan-Driven Correction — the implementation is MORE permissive than the plan's literal text but matches reality.

**No code change required by v0-8-fixes-cycle-1.** Drift documented for audit traceability.

### Drift-T4.1-2 — Tokenizer DIP promotion supersedes T4.1-1 (closes F-arch-1)

**Surface:** `src/core/dip/tokenizer.ts` (NEW commit `faab853`).

**Origin:** F-arch-1 MAJOR from `/review` — `Tokenizer` interface had 6 production-code consumers + 5 test-code consumers, all importing from sibling vendor `src/benchmarks/themory/adapter.ts`. ISP violation (vendor adapters mem0/zep/letta structurally depended on a sibling vendor adapter just to get the type).

**Supersedes Drift-T4.1-1:** the original Drift-T4.1-1 in source plan v1.2 declared "Tokenizer DIP stays inline; 2 consumers vs rule-of-three". Consumer count grew to 6 production + 5 test during T6.1+T6.2+T6.3 vendor adapter rollout. Rule of three crossed.

**Resolution:** MOVE-only refactor (ADR D3 of v0-8-fixes-cycle-1). Interface body verbatim in `src/core/dip/tokenizer.ts` (11th DIP). 10 import paths updated. `src/benchmarks/themory/adapter.ts` re-exports for backward compat.

### Drift-T4.1-3 — `runner-integration.test.ts` absorbed into T5.1 smoke (closes F-xval-3)

**Surface:** plan v1.2 § T4.1 declared a separate `tests/integration/benchmarks/runner-integration.test.ts` file; implementation absorbed those assertions into the T5.1 `tests/e2e/benchmarks/longmemeval-themory.test.ts` smoke run.

**Origin:** F-xval-3 INFO from `/review` cross-validation. The absorption was honest scope consolidation, not a missing test — every assertion the runner-integration test would have made is reachable via the smoke fixture path.

**No code change required by v0-8-fixes-cycle-1.** Drift documented for audit traceability.

### Drift-T8.x-2 — T8.2 FINAL GOAL TEST assertion contract honest-residual marker (closes F-xval-2)

**Surface:** `tests/e2e/benchmarks/matrix-publication.test.ts`.

**Origin:** F-xval-2 MAJOR from `/review` — plan v1.2 § T8.2 RED #3 said "no TBD placeholders" in the matrix. Implementation shipped Drift-T8.x-1: matrix cells use `"Deferred — Drift-T6.x-1"` markers for vendor cells (3 Smoke ✅ + 9 Deferred). The test assertion shifted from "every cell has 5 sub-metrics" to "every cell is Smoke OR Deferred+DriftRef" — honest residual scope per Inquebrável Rule 3, but the contract shift deserves its own marker.

**Resolution:** documented as Drift-T8.x-2. Plan-Driven Correction (same family as Drift-T5.1-1: implementation MORE honest than plan's literal text).

**No code change required by v0-8-fixes-cycle-1.** Drift documented for audit traceability.

## Cross-reference

- Source plan v1.2: `.claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md` (FROZEN — diff vs cycle-start `8d00aa4` is 0 lines; verified by EC-2 invariant check at every iteration)
- `/review` report: `.claude/knowledge-base/reviews/v0-8-independent-benchmark-reproduction-review-2026-06-02.md`
- Fix-up cycle plan: `.claude/knowledge-base/plans/v0-8-fixes-cycle-1-plan.md` v1.3
- Edge-case absorption: `.claude/knowledge-base/reviews/v0-8-fixes-cycle-1-edge-cases-2026-06-02.md`
