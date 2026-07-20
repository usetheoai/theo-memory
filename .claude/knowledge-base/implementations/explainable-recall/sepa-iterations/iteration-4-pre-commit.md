# SEPA pre-COMMIT — iteration 4 / T3.1 (2026-07-20) — ADVERSARIAL VERBOSE

Verdict: PROCEED_WITH_NOTES. 8/8 load-bearing return-contract invariants PASS (D1 bare-array intact; D3 fail-soft in try/catch; DIP type-only import; EC-2/4/5; typed events; once-per-return-path verified — no double-write, no missed path; the rerank early-return is correct).

Findings RESOLVED (follow-up commit 07f5239):
- **HIGH** — pipeline.test.ts covered ONLY semantic_gate (fixture 0.2/0.3 < threshold hit the pre-gate); sub_threshold/nan/mmr_redundant untested; the promised test_pipeline_traces_mmr_drops was missing; the complex MMR block had 0 coverage. → ADDED test_pipeline_traces_sub_threshold_drops (bm25 active → maxScore=2 → composite<threshold) + test_pipeline_traces_mmr_drops (diversify → mmr_redundant + breakdown from candidates Map). All 4 reasons now exercised; nan documented as a defensive/unreachable branch (combineScores never returns NaN from finite inputs).
- **MEDIUM** — adaptive-relax/graph-expansion resurface: a primary-pass drop can flow back into the returned set while still in recallDrops (trace contradicts returned set; double-count with diversify). → writeRecallTrace now prunes recallDrops against the kept set; the rerank branch computes-then-traces-pruned.
- LOW — recall_trace_truncated emitEvent outside try (negligible; OTel not expected to throw). No action.
