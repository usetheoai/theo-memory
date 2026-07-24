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

## Phase 1 boundary mini review — PHASE_REVIEW_NEEDS_FIX (2026-07-24)

Report: `.claude/knowledge-base/mini-reviews/entity-boost-recall-contribution-phase1-review-2026-07-24.md`.
Two HIGH findings. Both are recorded honestly rather than worked around.

**`wiring_pillar_a_fail` — real, known, bounded.** `matchEntityKeysInQuery` and
`countMatchedEntitiesPerMemory` have no production caller yet. This is the deferral declared
above, and it is a genuine consequence of the plan's phasing: the caller is T3.1, which
cannot run before the Phase 2 port supplies the linked keys. Until then the two symbols are,
accurately, uncalled exports. The finding is NOT dismissed — it is scheduled, and its closure
is enforced by two independent gates: the Phase 3 boundary mini review, and
`run_validation.py`, which re-derives symbols from the committed diffs and re-runs
`check_wiring.py` at handoff. If T3.1 fails to wire them, the handoff fails.

**`scope_drift` — gate calibration, not a violation.** The flagged file is
`entity-boost-recall-contribution-implementation.md`, this very document, which the halt-loop
driver mandates as the implementation working contract. The check compares modified files
against each task's `#### Files to edit` and has no allowance for the loop's own bookkeeping
artifact (`CHANGELOG.md` is allowed; this file is not). No production source outside the
declared scope was touched — the Phase 1 commits contain exactly
`entity-query-match.ts`, `entity-query-match.test.ts` and `CHANGELOG.md`.

Neither finding is a reason to weaken a test or fabricate a caller. Phase 2 proceeds; the
Phase 3 boundary is where the wiring finding must genuinely clear.

## Task log

| Task | Status | Commit | Wiring (a/b/c) | Note |
|---|---|---|---|---|
| T1.1 | committed | `94cc7d8` | defer→T3.1 / defer→T3.2 / n/a | 10 unit tests green (8 do plano + 2 pedidos pelo SEPA: ocorrência não-fronteiriça e chave vazia que travaria o laço) |
| T1.2 | committed | `cc0396e` | defer→T3.1 / defer→T3.2 / n/a | 14 testes verdes no arquivo; casamento por chave distinta, não por memória |

### File-size note

T1.1's acceptance criterion budgeted the file under 120 lines and it was 95 at T1.1 commit
time. T1.2 legitimately adds a second function to the same file, per its own declared
`#### Files to edit`, taking it to 139. The two functions are one cohesive concern
(query↔entity matching); splitting them to satisfy a per-task budget measured after a later
task would be the kind of structure-for-the-metric the parsimony ladder warns against.
Recorded rather than silently passed.

## Next task

**T2.1** — declare `linkedKeysForMemories` on the `MemoryEntityStore` port
(`packages/core/src/domain/dip/memory-entity-store.ts`). Note: every existing test double of
that port must gain the new method or `npm run typecheck` fails — the M14 cycle hit exactly
this when `forgetEntity` was added, and 7 doubles needed updating.
