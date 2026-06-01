# SEPA initial brief — adapters-stub-embedder-llm-cycle-1-fixes

**Date:** 2026-06-01
**Plan version:** v1.1 (SHIPPABLE_WITH_CAVEATS 84.4)
**Role acceptance:** ACCEPTED

## Immediate flags (read before T0.1)

### [CRITICAL] Marker format — EC-1 INQUEBRÁVEL

`check_wiring.py:165` regex requires literal ASCII colon `:` between `<symbol>` and `<reason>`. Plan body line 199 + ADR D1 line 86 both show correct format.

**Risk:** sloppy paste of em-dash `—` (autocomplete, copy from prose).
**Evidence:** `.claude/skills/implement/scripts/check_wiring.py:165` regex `rf"<!--\s*ADR-DEFER-WIRING-B:\s*{re.escape(symbol)}\s*:\s*[^>]+?-->"`.
**Action before T0.1 GREEN:** after writing markers, IMMEDIATELY run `python3 .claude/skills/implement/scripts/check_wiring.py --symbol DeterministicStubEmbedder --deferral-path .claude/knowledge-base/implementations/adapters-stub-embedder-llm-cycle-1-implementation.md` and visually confirm exit 0 + `"status": "DEFER"`. Grep is insufficient (substring match passes em-dash).

### [MAJOR] EC-6 source plan edit at T1.2 — commit body invariant

T1.2 edits `adapters-stub-embedder-llm-cycle-1-plan.md` (SOURCE plan). Per `cycle-review.md § Hard gates #2`, mid-cycle plan edits are BLOCKER.

**Evidence:** plan ADR D3 line 121 + plan EC-B line 73.
**Action before T1.2 COMMIT:** commit body MUST contain literal "HONESTY correction NOT scope drift" (or close equivalent) referencing EC-6 + cycle-review.md § Hard gates #2.

### [MAJOR] EC-7 audit-trail edit at T0.1 — commit body invariant + Followups entry

T0.1 amends `adapters-stub-embedder-llm-cycle-1-implement-validate-2026-06-01.md:46`. Editing validation report post-`/implement` is non-standard per `audit-trail-rotation.md`.

**Evidence:** plan § T0.1 line 200 inline note.
**Action:** commit body MUST cite "one-off honesty fix; NOT precedent for retrospective audit edits"; Followups table F2 entry already present at implementation contract line 238 — verify untouched.

### [MAJOR] EC-8 `v[i]!` retention at T3.1

Plan locks option (B); `.at(i) ?? 0` REJECTED (silent fail-zero violates Inquebrável Rule 8 Fail-Fast).

**Evidence:** plan § Accepted risks line 76 (EC-E budget) + sepa.md Surface 5.
**Action at T3.1 post-GREEN:** assert `src/embedders/stub.ts` line ~73 still reads `v[i]!`; previous line begins `// noUncheckedIndexedAccess:`.

### [MAJOR] F-arch-2 D2 — JSDoc-only, NOT constant change

Plan ADR D2 line 99 locks `LCG_HALF_MODULUS_F64` value UNCHANGED.

**Evidence:** plan EC-A line 72 ("Output of embed() is byte-identical").
**Action at T1.2 post-GREEN:** grep `src/embedders/stub.ts` for `LCG_HALF_MODULUS_F64 =`; line content must be unchanged vs HEAD.

## Cross-task surfaces to watch

- **T0.1 → T4.1 GREEN gate:** T4.1 step 6+7 re-runs `check_wiring.py` for both symbols. If T0.1 marker format drifted (em-dash), T4.1 will fail at this gate — late, expensive feedback. SEPA pre-COMMIT for T0.1 MUST verify the regex gate, not just grep.
- **T1.1 → T2.3 (EC-3):** T1.1 strips role-prefix in `concatUserContent`; T2.3 EC-3 line 128 `generateResponse({type:'text'})` path. Verify both touch only their declared file ranges; do NOT cross-pollute.
- **T0.3 CHANGELOG placement (EC-5):** new `### Added` block as FIRST child of `[Unreleased]` (NOT appended to existing block). Visual diff inspection at post-GREEN.
- **T1.2 affects two files in lockstep:** `src/embedders/stub.ts` JSDoc + source plan ADR D2. Skipping one half = honesty fix incomplete (EC-A/EC-B coupling).

## Project-rule compliance pre-check

- `no-paper-names-in-code.md`: needs verification per task (T1.1, T3.1 touch src/ + tests/)
- `dogfood-golden-rule.md` vocabulary lock: verified at T4.1 step 9 grep gate
- `cycle-implement.md § Hard gates #5`: T0.1 closes it via markers; SEPA gates EC-4 regex test actually ran
- `cycle-review.md § Hard gates #2`: T1.2 risk surface; commit body invariant mitigates
- `audit-trail-rotation.md`: T0.1 absorbs as precedent; Followups F2 entry tracks policy update
- Inquebrável Rule 3 (extreme honesty): WHY of F-wire-2 + F-arch-2 + F-arch-3 fixes; verified inline
- Conventional commits format `type(scope)(slug): subject (T-id / F-id)`: per-task COMMIT messages declared; SEPA verifies at pre-COMMIT

## Mode default

TIGHT for pre-RED + post-GREEN; VERBOSE at pre-COMMIT or on CRITICAL findings.
