# Edge Case Review — adaptive-retrieval

Date: 2026-06-22
Tasks analyzed: 6 (T1.1–T5.1)
Edge cases found: 4 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: corrective `relaxedThreshold` ≥ original threshold is a no-op widening that can surface garbage
- **Affected task:** T3.1 / T4.1
- **Family:** Boundary
- **Scenario:** `assess` returns `action:'relax'` with `relaxedThreshold` ≥ the original `threshold` (or > 1 / < 0). Re-filtering at a threshold ≥ the original surfaces nothing new (no-op) OR an out-of-range value surfaces everything (garbage).
- **Impact:** wasted work or precision collapse.
- **Suggested fix:** in the pipeline Step 8.6, clamp: apply the relax ONLY when `0 ≤ relaxedThreshold < originalThreshold`; otherwise treat as `accept` (no correction, no event). One `if`.

## SHOULD TEST

### EC-2: `assess` relax but the over-fetch pool has NOTHING below threshold either
- **Affected task:** T3.1
- **Suggested test:** `test_assess_relax_with_empty_pool_emits_low_confidence` — relax fires but re-filter yields 0 rows ⇒ emit `retrieval_low_confidence`, return the original (possibly empty) results, never throw.

### EC-3: default-OFF must hold even when `RecallOptions.adaptive` IS set but NO `retrievalPolicy` is wired
- **Affected task:** T3.1
- **Suggested test:** `test_adaptive_option_without_policy_is_noop` — `recall(q, { adaptive: {...} })` with no `retrievalPolicy` config ⇒ byte-identical to plain recall (the option alone, without a wired policy, does nothing). Guards against a half-wired surprise.

## DOCUMENT

### EC-4: a `shouldRetrieve=false` skip STILL counts as a recall() invocation in the usage counter
- **Affected task:** T3.1
- **Accepted risk:** the per-scope usage counter (`scoped-memory.ts:286`) counts recall() API invocations, not DB hits; a skipped retrieval is still an invocation. Documented in JSDoc; not changed (changing it would conflate "API called" with "DB queried"). The `retrieval_skipped` event distinguishes the two for dashboards.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T3.1 | 3 | 0 | 2 | 1 |
| T4.1 | 1 | 1 | 0 | 0 |

**Verdict:** PLAN OK (EC-1 absorbed into ADR D3 + T4.1/T3.1 acceptance; EC-2/EC-3 added as SHOULD-TEST; EC-4 documented).
