---
slug: test-suite-audit
generated_by: roadmap-feature
milestone_id: M26
date: 2026-07-27
status: completed
---

# Feature grill — test-suite-audit (M26)

## Q1 — What is this feature and why NOW?

**Answer:** Audit the ENTIRE test suite hunting for COVERAGE SEAMS — untested
interactions between features, false-green suites, and missing real-consumer tests.

**Why now:** the attribution bug (assistant-produced memories stored as `user` facts)
passed a fully green suite. Root cause was a seam: `RememberOptions.attributedTo`
(request origin) vs the LLM per-fact `attributed_to` guess, in the `infer:true`
extraction path — each feature was unit-tested on its own side of the seam; their
interaction was never asserted, and no end-to-end test exercised the real consumer
(the Claude Code Stop hook → `/v1/remember` → extraction → stored attribution). The
bug surfaced only in dogfood. This milestone systematizes finding that class of gap.

## Q2 — Dependencies (which milestones must be [x] first)?

**Answer:** None — all M0–M25 are `[x]`. This is a transversal audit of the existing
suite, not tied to any single feature; it can start immediately.

## Q3 — Verifiable Definition of Done (seam-audit DoD)

**Answer:**
1. Inventory of features whose behavior crosses paths (attribution/state across
   `infer:true`/`infer:false`, scope tiers, capture hooks) — the seam map.
2. Every seam lacking an interaction test gets one (RED-first).
3. ≥ 1 real-consumer integration test per capture hook (hook payload → `/v1/remember`
   → real store → assert stored attribution/scope), not just recall parity.
4. Full suite green + typecheck + lint.
5. Report listing seams found + closed (audit artifact).

## Q4 — Top 2 NEW risks

**Answer:**
- R1 (HIGH) Scope explosion: auditing "all tests" can become an infinite refactor
  (the suite is large). Mitigation: time-box + prioritize by criticality (write/auth/
  attribution paths first); do not chase every file.
- R2 (HIGH) False-green recurrence: adding tests that pass but do NOT exercise the real
  seam (repeating the original mistake). Mitigation: every gap-closing test MUST be
  RED-first — prove it fails against the pre-fix behavior before it counts.

## SOTA delta

No new reference peers needed — mem0 is already cloned under
`knowledge-base/references/` and is the canonical reference for the capture/attribution
discipline this audit checks against.
