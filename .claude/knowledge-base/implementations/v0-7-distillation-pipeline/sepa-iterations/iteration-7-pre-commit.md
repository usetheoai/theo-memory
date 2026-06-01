# SEPA log — iteration 7 / T3.2 / pre-COMMIT

**Mode:** VERBOSE
**Verdict:** GREEN with EC-10 honest correction.

**Diff:**
- A docs/distillation-evaluation/metrics.ts (139 LoC; tokenize, bleuScore, entityOverlapJaccard, precision, recall, conflictResolutionAccuracy)
- A docs/distillation-evaluation/run.ts (158 LoC; eval harness — LLM-free per T3.2/T3.3 split)
- A docs/distillation-evaluation/README.md (81 LoC; documents EC-11 pre-conditions)
- A docs/distillation-evaluation.md (matrix output — generated)
- A tests/unit/distillation/precision-recall.test.ts (109 LoC; 8 assertions)
- M package.json (+1 line: eval:distillation script)

**EC-10 honest correction**: plan v1.1 absorbed EC-10 saying "BLEU via natural.BleuScore (already in optionalDependencies per v0.6.1; zero new deps)". `natural` v8.1.0 does NOT export a BleuScore symbol — it ships NGrams, WordTokenizer, distance metrics. Plan EC-10 absorption was fabricated. Honest fix: BLEU implemented INLINE in metrics.ts using natural.NGrams + natural.WordTokenizer primitives. Zero new deps preserved. Documented in file header.

**Decision: precision/recall use Jaccard, not BLEU**: BLEU-4 is too strict for short distillation facts ("paulo likes coffee" vs "paulo prefers coffee" scores ~0 in BLEU-2+ due to middle-token mismatch). Jaccard captures the semantic overlap correctly. bleuScore stays public as a separate utility.

**T3.2/T3.3 split (architecturally honest)**: T3.2 harness is LLM-free (synthetic decisions) — keeps CI cost at $0 + validates harness shape. T3.3 GOAL TEST will measure real LLM signal against pgvector + OpenAI (~$0.50/run per EC-11 cost disclosure).

**EC-11 pre-conditions documented verbatim in README**: 5 items — compose:up, THEOMEM_PG_URI, OPENAI_API_KEY, db:push, cost disclosure ~$0.50.

**Tests**: 16/16 PASS across gold-set-shape + precision-recall.

**Wiring**: a=pass (run.ts imports metrics + loader; package.json script), b=pass (8 unit tests on precision-recall), c=n/a (no runtime counter at T3.2; the metric helpers ARE the measurement, not counter emissions).

No paper-names; no vocab-lock.
