# Implementation — entity-boost-recall-contribution (M15 / theo-memory#122)

Plan: `.claude/knowledge-base/plans/entity-boost-recall-contribution-plan.md` (v1.1, SHIPPABLE_WITH_CAVEATS 89)
Branch: `develop`. Started 2026-07-24.

## Wiring deferrals (explicit, auditable)

<!-- ADR-DEFER-WIRING-A: T1.1 e T1.2 -->
`matchEntityKeysInQuery` and `countMatchedEntitiesPerMemory` (Phase 1) are pure domain
functions whose production caller is introduced by **T3.1**, per the plan's own phasing —
Phase 1 builds the matching logic, Phase 3 wires it into `pipeline.ts` Step 6.

At T1.1/T1.2 commit time `check_wiring.py` reports pillar (a) FAIL with zero production
callers. That is the truthful state and it is recorded here rather than papered over with a
no-op call, which the wiring gate exists precisely to catch.

Closure condition: **T3.1 MUST bring pillar (a) to PASS for both symbols.** The
post-halt-loop `run_validation.py` re-derives symbols from the committed diffs and re-runs
`check_wiring.py` independently, so a Phase 1 symbol left permanently uncalled fails the
handoff gate. This deferral is therefore bounded by a gate, not by trust.

<!-- ADR-DEFER-WIRING-B: T1.1 e T1.2 -->
Same rationale for pillar (b): the integration test that exercises these functions through a
real boundary is `tests/integration/entity-boost/ranking.test.ts`, created by T3.2. Unit
coverage is complete at Phase 1 (8 + 3 assertions); the boundary test follows the caller.

## Deviation from the plan's T1.1 Deep dive (recorded, not silent)

The plan's T1.1 Deep dive prose said the entity key would have its underscore reverted to a
space before comparison. Implementing that literally makes two of the task's own RED tests
mutually unsatisfiable: reverting `user_id` to `user id` stops it matching the query "o campo
user_id está nulo", while `são_paulo` needs the reversion to match "moro em São Paulo".

The `_` produced by `normalizeEntityKey` is ambiguous once written — it encodes both "was a
space" and "was a literal underscore" — so rewriting it back is lossy in the wrong direction.

The implementation inverts the direction instead: the **query** is normalized into the key's
alphabet with the same `normalizeEntityKey`, and `_` is treated as a word boundary. Both
cases then hold, and the normalization rule keeps a single authoritative representation,
which is what plan ADR D3 actually requires. The plan's TDD section — the binding contract —
is satisfied in full. Surfaced by the SEPA pre-RED consultation.

## Task log

| Task | Status | Commit | Wiring (a/b/c) | Note |
|---|---|---|---|---|
| T1.1 | committed | see git log | defer→T3.1 / defer→T3.2 / n/a | 8/8 unit tests green; 95 LoC |
