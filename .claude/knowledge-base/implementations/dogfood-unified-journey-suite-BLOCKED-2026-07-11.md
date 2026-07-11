# BLOCKED — /implement dogfood-unified-journey-suite (iteration 1, task T0.1)

**Date:** 2026-07-11
**Halt reason:** Stop Condition #3 (cycle-implement.md) — *the plan task assumes behavior contradicted by reality*.
**Promise emitted:** NONE (honest BLOCKED > false completion, Unbreakable Rule 3).

## What is blocked

**T0.1** (ADR-0019 + LOCKED golden-rule amendment). The substantive work is DONE and correct:
- `.claude/knowledge-base/adrs/ADR-0019-dogfood-unified-journey-suite.md` authored.
- `.claude/rules/dogfood-golden-rule.md` amended: § 3 hard caps #3–#7 (all-anchor per Q1, EC-2 secret cap, EC-3 oracle_result cap, EC-7 no-anchor guard), § 5 frontmatter (`journey:`/`aliases:` EC-1, `oracle_result:` EC-3, EC-2 redaction), § 9 journey-catalog section citing ADR-0019.
- **Verdict tokens preserved** (`EVIDENCE_INSUFFICIENT` ×3, `EVIDENCE_WITH_CAVEATS` ×1 — the file never literally contained `EVIDENCE_SUFFICIENT`; that token lives in `cycle-rule-schema.md`). **Status vocab preserved** (planned/wired/running/paused/abandoned all present).
- The golden-rule + ADR edits add **ZERO new `check_xrefs` FAIL**.

## The blocker (plan oracle vs. repo reality)

The plan's T0.1 GREEN gate is *"`check_xrefs.py` + `test_e2e_smoke.py` green"*. **Both scripts were ALREADY FAILING at HEAD (`1a73c94`), before any work on this plan**, due to pre-existing repo-wide debt unrelated to /dogfood:

```
test_e2e_smoke.py @ HEAD (golden-rule edit stashed):
  ✗ Python syntax
  ✗ Cross-references        (307 WARN / 4 FAIL)
  ✗ Skill frontmatter
  Overall: FAIL

check_xrefs.py @ HEAD: Overall FAIL — 4 [FAIL] of class `skill_cycle_contract_resolves`:
  - 3 PRE-EXISTING (other cycles' sepa-knowledge skills: cycle-sepa.md, cycle-fixes.md)
  - 1 from THIS cycle's Step-2.5 SEPA-knowledge skill (cycle-rule.md misparse) — a generation artifact of the same class
```

So the literal oracle *"both scripts green"* **cannot be satisfied by T0.1** — it would require first fixing unrelated pre-existing repo debt (Python syntax errors elsewhere, the `skill_cycle_contract_resolves` false-positive class, skill-frontmatter issues), which is out of this plan's scope and out of T0.1's scope.

## Why this surfaced only now

`/plan-confidence` scored the plan structurally (SHIPPABLE_WITH_CAVEATS) but does not run `test_e2e_smoke.py`/`check_xrefs.py` against the live tree — so the green-baseline assumption went unchallenged until the halt-loop's first real oracle run.

## Recommended human action (pick one)

1. **Adjust the plan oracle (recommended, small):** change T0.1 + T4.1 GREEN gates from *"protocol scripts green"* to *"protocol scripts add NO NEW FAIL/WARN beyond the committed baseline"* (a delta-based oracle — the honest intent). Re-run `/plan-improve` or edit the two tasks' TDD/DoD, then `/implement --resume`. The script tasks (T1.1/T1.2, vitest oracles) are unaffected.
2. **Fix the pre-existing repo debt first (larger, separate cycle):** a `/to-plan` for "repair test_e2e_smoke/check_xrefs baseline" (Python syntax errors + the `skill_cycle_contract_resolves` false-positive for auto-generated SEPA-knowledge skills + skill-frontmatter), land it, THEN resume this plan against a genuinely-green baseline.
3. **Accept a delta-oracle now, manually:** confirm T0.1's edits add zero new FAIL (already verified) and proceed — but this needs your explicit sign-off since it reinterprets the plan's locked oracle.

## State on disk (uncommitted — for your review)

- `ADR-0019-...md` (new), `dogfood-golden-rule.md` (amended), the SEPA agent + knowledge skill, the implementation contract, `.progress-...json`, this report. Nothing committed for T0.1 yet (its literal GREEN gate did not pass).
- The ralph-loop was **cancelled** (a plan-oracle-vs-reality blocker cannot be self-resolved by iterating).

`/review` and `/release` MUST NOT run until this is resolved.
