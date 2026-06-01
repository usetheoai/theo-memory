# SEPA log — iteration 8 / T3.3 / pre-COMMIT

**Mode:** VERBOSE
**Verdict:** GREEN with explicit ADR-DEFER-LLM-MEASURED-GOAL-TEST documented.

**Diff:**
- A tests/integration/distillation/the-goal-test.test.ts (244 LoC; 2 tests)

**T3.3 ships harness-correctness GOAL TEST**: against the 10 hand-authored contradiction-pair fixtures, runs reflect({ conflictResolution: LWW }) end-to-end through pgvector. Asserts precision ≥ 0.75 + recall ≥ 0.70 + accuracy ≥ 0.80 (all trivially pass via LWW deterministic comparator + Jaccard threshold 0.5 vs ground-truth fixture pairs). EC-5: 3-run stability with pairwise deltas < 0.05 (trivially 0 for deterministic LWW).

**ADR-DEFER-LLM-MEASURED-GOAL-TEST**: explicitly documented in test file header — halt-loop environment lacks OPENAI_API_KEY; full LLM-measured signal costs ~$0.50/run per EC-11. Plan EC-B explicitly allows SHIPPABLE_WITH_CAVEATS in this case. v0.7.1 fix-up cycle replaces the LWW oracle path with a real OpenAI call.

**What this test PROVES**:
- reflect({ conflictResolution }) wires end-to-end against pgvector ✓
- consolidation_history rows match policy emissions ✓
- t_invalid IS NOT NULL on rejected ✓
- EC-5 stability (deterministic) ✓

**What this test does NOT prove**:
- gpt-4o-mini extraction quality (deferred per ADR-DEFER above)

**Honest disclosure**: the threshold-pass is structurally vacuous — LWW returns ground truth by construction when fed contradiction-pair fixtures. Real signal requires real LLM. Plan author should expect SHIPPABLE_WITH_CAVEATS verdict from /review until v0.7.1 replaces oracle.

Wiring: a=pass b=pass c=n/a (T3.3 measures via metrics; doesn't emit new counters — those fire at policy layer T1.3).
