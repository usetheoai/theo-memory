# SEPA — Iteration 2 / Task T1.1 / Phase Pre-COMMIT / Mode VERBOSE

Date: 2026-05-31
Agent ID: a3d6eb43e184f9de7
Verdict: NEEDS FIXES (2 MAJOR) → main session absorbed both → re-stage + commit landed cleanly.

## Findings absorbed

- **[MAJOR M1]** Count discrepancy: original claim "12 in-tree call sites migrated"; actual = 11 because `evict-soft-delete.test.ts:162` (the `observedPolicy` block) was missed. Pattern was `new TriadicScoringPolicy(\n  undefined,\n  undefined,\n  null,\n  null,\n  observedEvictor,\n)` — multi-line — didn't match the single-line `grep`. **Fix:** migrated line 162 → `new TriadicScoringPolicy({ evictor: observedEvictor })`; `evict-soft-delete.test.ts` 7/7 PASS post-fix; count now genuinely 12.
- **[MAJOR M2]** Wiring footer overcooked: original draft had `b=ADR-DEFER (TriadicScoringPolicyOptions is a TS interface; structural exercise…)`. SEPA: the **task's primary symbol is the class**, and `check_wiring.py --symbol TriadicScoringPolicy` shows pillar (b) PASS with 8 integration tests. Inventing an ADR-DEFER for the co-shipped type would be noise. **Fix:** footer simplified to `a=PASS (6 callers) b=PASS (8 integration tests) c=N/A (no metric declared)`.

## MINOR noted (not blocking)

- **[m1]** CHANGELOG `[Unreleased]` has pre-existing structural rot (two `### Added` blocks across one Unreleased section). Inserting `### Deprecated` between Changed and the second Added makes the ordering slightly worse but the rot predates T1.1. Logged as a future `chore(docs): consolidate CHANGELOG Unreleased section` candidate; not a commit blocker.
- **[m2]** Body had two paragraphs covering the null-guard rationale (EC-2 absorption + SEPA pre-RED extension). Collapsed in final commit body.

## Outcome

T1.1 CRITICAL F-arch-1 CLOSED via ADR D5. EC-2 absorption extended (null guard) per SEPA pre-RED. 12 call sites migrated. 6 RED-then-GREEN tests + 39/39 integration tests + 526/528 contract tests + 0 type errors + 0 lint errors.

## Empirical gates post-commit

- npm test: 526 passing / 2 skipped / 528 total
- THEOMEM_PG_URI=... npm run test:integration -- tests/integration/eviction tests/integration/forgetting → 39/39 PASS
- npm run typecheck: exit 0
- npm run lint: exit 0
- No Co-Authored-By trailer (grep returns 0)
- File-size: `src/local/eviction/triadic-scoring-policy.ts` = 448 LoC (under 500 budget)

Next iteration: T2.1 (CRITICAL F-dom-db-2 — db:push wraps trigger psql apply; EC-9 absorption: README prerequisites lists psql).
