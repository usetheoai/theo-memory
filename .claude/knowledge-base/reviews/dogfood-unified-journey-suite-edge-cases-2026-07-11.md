# Edge Case Review — dogfood-unified-journey-suite

Date: 2026-07-11
Tasks analyzed: 9 (T0.1, T0.2, T1.1, T1.2, T2.1, T2.2, T2.3, T3.1, T4.1)
Cases found: 11 (EDGE: 4, NEGATIVE: 7 | MUST FIX: 3, SHOULD TEST: 5, DOCUMENT: 3)

The plan is well-structured and already carries a strong `## Failure scenarios` table for the external-I/O surfaces (server-warming, dim-mismatch, LLM-empty, Model-B, Kratos, Chrome CDP). The gaps below are concentrated in two real boundaries the plan under-specifies: (1) the **evidence parser** (`run_journey_audit.py`) meeting the *already-existing* evidence files, and (2) the **honesty of the self-reported outcome** — the entire gate rests on `outcome: pass` being trustworthy.

## MUST FIX

### EC-1: Legacy evidence uses `scenario:` frontmatter, not `journey:` — audit ignores it → false INSUFFICIENT
- **Affected task:** T1.1 (`run_journey_audit.py`), T0.1 (golden-rule frontmatter contract)
- **Kind:** NEGATIVE (schema mismatch with existing data)
- **Family:** Format / Backward-compat
- **Scenario:** `knowledge-base/dogfood/evidence/` already holds ~10 files with frontmatter `scenario: claude-code-auto-memory` (the LOCKED anchor). The plan's new audit joins on a `journey:` id. If the parser only reads `journey:`, every existing evidence file is invisible → the preserved anchor journey (Coverage #37) has zero evidence → verdict flips to INSUFFICIENT even though the anchor was `running`. The golden rule (`§ 5`) currently defines `scenario:` as a LOCKED frontmatter field.
- **Impact:** Regression of the current gate state; the "no silent anchor swap" invariant (D1) is violated in practice because the mapped anchor loses its history.
- **Suggested fix:** In `run_journey_audit.py`, accept **either** `journey:` OR `scenario:` as the join key, and in `journeys.md` give the preserved anchor journey an `aliases:` entry (`claude-code-auto-memory`) so legacy evidence matches. Add a T1.1 RED test `audit_legacy_scenario_field_satisfies_mapped_anchor()`.

### EC-2: Secret-redaction regex must ALLOW the documented 12-char prefix but REJECT full secrets
- **Affected task:** T1.1 (redaction gate), T0.1 (golden-rule redaction rule)
- **Kind:** NEGATIVE (false positive/negative on secret detection)
- **Family:** Security / Format
- **Scenario:** The recipe deliberately records key *prefixes* (`theo_live_mp`, 12 chars = `theo_live_` + 2) as safe evidence. A naive gate `theo_live_[A-Za-z0-9_]{8,}` would FLAG that safe prefix (10-char prefix + `mp` — but a longer captured prefix like `theo_live_mpCb6kQ` DOES exceed 8 body chars and would trip). Conversely, too-loose a gate misses a real leaked `theo_live_<43 chars>`. Both failure directions are real.
- **Impact:** Either every legit evidence file is rejected (gate unusable) OR a real secret slips through (Risk row "secrets leak", severity High).
- **Suggested fix:** Redact at the SOURCE (drivers write at most `theo_live_` + first 4 chars, never more) AND make the audit gate reject only bodies ≥ 20 chars after the prefix (`theo_live_[A-Za-z0-9_-]{20,}` and `sk-or-v1-[A-Za-z0-9]{20,}`). One RED test each: `audit_rejects_full_secret()`, `audit_allows_short_prefix()`.

### EC-3: `outcome: pass` is self-reported by Claude — a hallucinated green defeats the whole gate
- **Affected task:** T2.1/T2.2/T2.3/T3.1 (drivers), T1.1 (what the audit trusts)
- **Kind:** NEGATIVE (untrustworthy input at the gate's core)
- **Family:** State / Integrity
- **Scenario:** The gate's premise (D2) is Claude-as-human. But `run_journey_audit.py` trusts `outcome: pass` verbatim. If a driver run records `pass` without the oracle actually observing success (LLM optimism, a skipped assertion), the gate emits a false SUFFICIENT — the exact "dogfood theatre" anti-pattern the golden rule (`§ 7`) exists to prevent.
- **Impact:** The gate can be gamed by its own operator; `production-ready` claim rests on prose, not proof.
- **Suggested fix:** Require every evidence file to embed a machine-observable `oracle_result:` field (the raw assertion output: suite exit code, the Chrome `evaluate_script` return, the HTTP status/body-shape), and have `run_journey_audit.py` reject `outcome: pass` when `oracle_result` is absent or empty (`outcome_pass_requires_oracle_result`). Add to the evidence frontmatter contract in T0.1. RED test `audit_pass_without_oracle_result_is_insufficient()`.

## SHOULD TEST

### EC-4: Freshness boundary — evidence dated exactly 30 days ago
- **Affected task:** T1.1
- **Kind:** EDGE (extreme of valid)
- **Suggested test:** `test_audit_evidence_exactly_at_freshness_boundary_is_fresh()` — assert an evidence file dated exactly `today − 30d` is treated as FRESH (inclusive), and `today − 31d` as STALE. Pin `today` via an injected clock (no `Date.now()` in the test).

### EC-5: Two evidence files for the same journey — newest fail must beat older pass
- **Affected task:** T1.1
- **Kind:** NEGATIVE (conflicting state)
- **Suggested test:** `test_audit_newest_fail_supersedes_older_pass()` — assert that when the newest evidence for an anchor journey is `outcome: fail`, the journey counts RED (not rescued by an older pass). Tie-break on identical dates: prefer the lexicographically-last filename (documented, deterministic).

### EC-6: Orphan evidence — `outcome: pass` for a journey id absent from the catalog
- **Affected task:** T1.1
- **Kind:** NEGATIVE (unexpected input)
- **Suggested test:** `test_audit_orphan_evidence_ignored_not_crash()` — assert an evidence file whose id is not in `journeys.md` is ignored (never counts toward SUFFICIENT) and does not crash the parser.

### EC-7: Catalog with zero anchor journeys must NOT vacuously pass
- **Affected task:** T1.1, T1.2
- **Kind:** EDGE (empty-but-parseable)
- **Suggested test:** `test_audit_zero_anchors_is_structural_insufficient()` — a catalog with no `anchor: true` rows must yield INSUFFICIENT (`no_anchor_journeys`), not `EVIDENCE_SUFFICIENT` over an empty anchor set. (`check_journey_catalog.py`'s "≥1 anchor per surface" already blocks this at author-time; the audit needs the runtime guard too.)

### EC-8: Oracle path unresolvable AT RUN TIME (suite renamed/deleted after catalog authored)
- **Affected task:** T2.1/T2.2/T2.3 (drivers)
- **Kind:** NEGATIVE (broken dependency contract)
- **Suggested test:** `test_driver_missing_oracle_records_fail_not_skip()` — when a journey's oracle command/path does not resolve, the driver MUST write `outcome: fail reason=oracle_unresolvable`, never skip silently (a skipped journey with no evidence already trips INSUFFICIENT, but a silent `pass` would not — assert it records `fail`).

## DOCUMENT

### EC-9: `/dogfood run` interrupted mid-suite (dev-stack half-up)
- **Kind:** NEGATIVE (partial operation)
- **Accepted risk:** Fail-safe by design — journeys without fresh green evidence trip INSUFFICIENT on the next `audit`, so an interrupted run can only UNDER-report, never over-report. Resumability (per-journey re-run) is a convenience, not a correctness need; document that `run` is idempotent per-journey and re-running overwrites that journey's evidence.

### EC-10: theo-cloud repo absent / on an incompatible branch
- **Kind:** NEGATIVE (missing cross-repo dependency)
- **Accepted risk:** The UI driver already gates on `make dev-up` health; extend the Failure-scenarios table with one row (`theo-cloud repo missing/incompatible → UI journeys partial reason=devstack_unavailable`). No code guard beyond the health probe; documented, not a MUST FIX because backend surfaces (SDK/API/MCP) remain fully runnable in this repo.

### EC-11: Golden-rule edit silently changes a verdict token / Status value
- **Kind:** NEGATIVE (contract regression)
- **Accepted risk / upgrade to SHOULD TEST:** `test_e2e_smoke.py` checks section presence, not the exact token strings. Add a cheap assertion (a grep test in T0.1's VERIFY) that the token set `{EVIDENCE_SUFFICIENT, EVIDENCE_WITH_CAVEATS, EVIDENCE_INSUFFICIENT}` and the Status vocab `{planned,wired,running,paused,abandoned}` appear verbatim post-edit. Low cost, closes the "backward compat preserved" DoD honestly.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T0.1 | 0 | 2 (EC-2, EC-11) | 1 (EC-2 shared) | 0 | 1 (EC-11) |
| T0.2 | 0 | 0 | 0 | 0 | 0 |
| T1.1 | 3 (EC-4, EC-7) | 4 (EC-1,5,6) | 2 (EC-1, EC-3 shared) | 4 (EC-4,5,6,7) | 0 |
| T1.2 | 1 (EC-7) | 0 | 0 | 1 (EC-7 shared) | 0 |
| T2.1 | 0 | 1 (EC-8) | 0 | 1 (EC-8) | 0 |
| T2.2 | 0 | 1 (EC-8 shared) | 0 | 0 | 0 |
| T2.3 | 0 | 1 (EC-8 shared) | 0 | 0 | 0 |
| T3.1 | 0 | 1 (EC-3 shared) | 1 (EC-3) | 0 | 1 (EC-10) |
| T4.1 | 0 | 1 (EC-9) | 0 | 0 | 1 (EC-9) |

**Coverage check:** every task touching a real input boundary (T1.1 evidence/catalog parser, T0.1 frontmatter contract, drivers' runtime oracle resolution) has ≥1 EDGE and ≥1 NEGATIVE considered. T0.2 (catalog authoring) and T1.2 (structural validator, already TDD'd) carry no new runtime boundary beyond what their own tests cover.

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1, EC-2, EC-3 as MUST-FIX sub-tasks (all land inside T0.1 + T1.1: legacy-`scenario:` alias join, source-side redaction + tightened gate, mandatory `oracle_result` field). EC-4–EC-8 add to the existing T1.1/driver TDD blocks. EC-9–EC-11 are plan notes. None require a new module (KISS honored) — every fix is a parser branch, a frontmatter field, or a test.
