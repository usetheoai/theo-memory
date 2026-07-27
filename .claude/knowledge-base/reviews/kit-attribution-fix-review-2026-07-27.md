# Review: kit-attribution-fix

**Date:** 2026-07-27
**Reviewers (spawned agents):** 3 (correctness/architecture, test-quality, adversarial-skeptic) — focused diff review (ad-hoc bug fix, no `/to-plan`; the cross-validation phase does not apply).
**Scope:** commits `0afcf46` (fix + unit test) + `ffd20cf` (integration test) + review-hardening (uncommitted at review time).
**Verdict:** READY_TO_MERGE

## Change under review

Extraction (`infer:true`) path now treats request-level `RememberOptions.attributedTo` as authoritative over the LLM's per-fact `attributed_to` guess (`packages/core/src/domain/extraction/pipeline.ts`). Fixes: assistant Stop-hook summaries were stored `attributed_to='user'`, polluting user preferences (found via dogfood; the deployed dashboard re-populated the wiped DB with mis-attributed assistant output).

## Findings (consolidated, most-severe first) + resolution

| # | Severity | Finding | Reviewer | Resolution |
|---|---|---|---|---|
| F1 | MEDIUM | Empty-string `attributedTo` wins (`'' ?? x === ''`) → persists a spurious empty-string owner; REST accepted `''` (no `.min(1)`). Fix newly introduced this on the `infer:true` SDK path. | skeptic (C) + tests | **FIXED** — pipeline treats blank as absent (falls through to LLM guess); REST `schemas.attributedTo` gains `.min(1)` (validate-at-boundary). Unit case added. |
| F2 | MEDIUM | Public JSDoc (`options.ts`) still claimed "the LLM guess wins when `infer:true`" — the exact behavior the fix reversed → doc/code contract lie (PRIORITY 0 sub-goal 1). | skeptic (secondary) | **FIXED** — JSDoc rewritten to the authority contract + the two mutually-exclusive modes. |
| F3 | MEDIUM | Single-fact stub made `.every()` run over a 1-element array (misleading); an `extracted[0]`-only fix would pass. Symmetric direction (`user` over an `assistant` guess) not pinned. | test-auditor | **FIXED** — added LOOP-WIDE (3 mixed-guess facts → all take the origin) + SYMMETRIC (declared `user` beats LLM `assistant`) unit cases. |
| F4 | LOW (by-design) | Passing `attributedTo` on a multi-peer `infer:true` ingest flattens all facts to one peer; an assistant turn recapping a user preference buckets it to `assistant`. | correctness (L1) + skeptic (A/B) | **ACCEPTED + DOCUMENTED** — this is the Mem0 discipline (a declared-origin turn is that origin). The two modes are mutually exclusive; JSDoc + pipeline docstring now state it. Not a defect. |
| F5 | INFO | `infer:true` multi-peer path has zero integration coverage. | skeptic (B) | Deferred to **M26** (test-suite seam audit) — logged, not silently dropped. |

## Quality gates

- Unit `extraction-attribution.test.ts`: 6/6 (origin-overrides-guess, multi-peer-fallback, no-fabricated-owner, loop-wide, symmetric, blank-as-absent).
- Integration `tests/integration/kit-attribution-write.test.ts` (real pgvector): 2/2. RED→GREEN verified at both layers (fix reverted via sed → both go red).
- Regression `extraction-pipeline.test.ts`: 24/24 (v1.1 multi-peer preserved).
- API `handlers.test.ts`: 26/26 (`.min(1)` no regression).
- `npm run typecheck`: clean.

## Note

Pre-existing debt (not expanded): `pipeline.ts` 458 LoC (> 300 budget) — a split is a separate refactor, out of scope for this targeted fix.

## Handoff decision

READY_TO_MERGE — every actionable finding fixed + re-verified; F4 is a documented by-design tradeoff; F5 logged to M26.
