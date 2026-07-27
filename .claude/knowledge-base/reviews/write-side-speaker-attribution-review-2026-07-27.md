# Review: write-side-speaker-attribution (M29 / #160)

**Date:** 2026-07-27
**Reviewer:** independent general-purpose review agent (fresh eyes)
**Findings:** BLOCKER 0, HIGH 0, MEDIUM 1 (reconciled), LOW 2 (accepted), INFO several
**Verdict:** READY_TO_MERGE

## Summary
Fix parametrizes the extraction speaker token by `attributedTo`; assistant first-person speech now
attaches to the `assistant` node instead of `user` (#160). Domain-only, reuses the prefix-override
pattern (ADR-1), infer:false verbatim untouched. 8 new tests + 44/44 guardian suite + 168/168 extraction
suite; typecheck 0; lint 0/0. Live A/B (real gpt-4o-mini): assistant-attribution 0.00 → 1.00, no
user-path regression.

## Findings
- MEDIUM `roadmap-plan-scope-divergence` — ROADMAP M29 DoD listed a no-meta-extraction bullet the plan
  descoped to M30. **RECONCILED**: ROADMAP M29 bullet marked `[DEFERRED → M30]`, "NÃO shipou no M29".
- LOW `t3.1-mechanism-divergence` — T3.1 shipped as a measured benchmark doc (0.00→1.00, 3 runs) rather
  than a coded eval metric; no CI regression guard for the ratio. Accepted; M30 candidate.
- LOW `non-assistant-peer-text-asymmetry` — arbitrary peer-id keeps `user` speaker text (assistant-only
  by ADR-2 scope). Pre-existing, in-scope.
- INFO — correctness (a)(b)(c) confirmed; architecture clean; infer:false untouched; other caller
  (cli/reextract) defaults to `user` (no regression); tests genuinely RED-on-unfixed, non-tautological.

## Verdict
READY_TO_MERGE — no BLOCKER, 0 HIGH; the single MEDIUM traceability item is reconciled in ROADMAP.md.
