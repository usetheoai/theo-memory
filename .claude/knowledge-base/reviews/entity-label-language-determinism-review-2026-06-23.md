# Review: entity-label-language-determinism (EG-5)

**Date:** 2026-06-23
**Reviewers (spawned agents):** 4 — architecture, tests, wiring+cross-validation, domain(memory-layer)
**Findings:** 0 BLOCKER, 0 HIGH, 0 MEDIUM, 8 LOW/INFO — closed inline or accepted
**Verdict:** READY_TO_MERGE

## Summary

EG-5 extends the EG-4 source-language guarantee from the `memory[].text` fact to the `entities[]` names + `relations[]` labels, which the EG-4 complete live-test showed still drift to Portuguese for an English input (`surfar`/`fins de semana` graph nodes). All 4 review agents converged READY_TO_MERGE (0 BLOCKER/HIGH/MEDIUM). The design is an always-on label-normalization map (detect-gating proved unreliable for mixed short labels — honest in-cycle deviation, documented). Hardened real-LLM GOAL stable 4/4; live dev-stack re-verify 3/3 EN entity labels.

## Findings closed inline

### F-arch-1 (LOW): duplicate `ExtractedEntity` interface name vs the DIP type
- The new module re-declared `ExtractedEntity` with a different shape than `dip/entity-extractor.ts` (name clash trap).
- **Fix:** renamed the module-local interface to `LlmEntityLabel` (matches the pipeline's inline `llmEntities` type; no clash with the DIP `ExtractedEntity`).

### F-dom-8 (LOW): theoretical translate-onto-`user` collision
- If the model mapped a label to the literal `user`, `apply()` would over-merge it into the speaker node.
- **Fix:** `apply()` now guards `t === SPEAKER_TOKEN ? s : t` (a translation equal to `user` is ignored, original kept).

### F-dom-7 / F-test-6 (LOW): plan docs stale vs the always-on deviation
- The plan's Drawbacks row 2 ("only fires on a confident detected mismatch") + ADR D3/EC-5 ("event fires with `corrected=0`, residual observable") predated the in-cycle switch to always-on + emit-on-`corrected>0`.
- **Fix:** aligned ADR D3 (attributes `{input_language, label_count, corrected}`, emit when `corrected>0`), Failure-scenarios EC-5 (no event on error; labels re-normalized next write), and Drawbacks row 2 (always-on cost honestly stated). Plan re-scored SHIPPABLE (0 caps).

## Findings accepted (no change)

- **F-test-4 / F-test-5 (LOW):** the pipeline wiring tests assert the correction RAN via the OTel span (+ `corrected` count) and that `remember()` resolves on a map-error, but do not spy `linkEntities` for the corrected labels (the unit harness wires no `memoryEntityStore`, so `linkEntities` no-ops persistence). The referential-integrity + fail-soft properties ARE proven at the unit layer (`label-language.test.ts`), and the real-LLM GOAL + live re-verify cover end-to-end persistence. Accepted.
- **F-test-7 / parseTranslationMap (INFO):** the JSON-string + bad-value defensive branches are implemented but not unit-tested (OpenAILLM `{type:'json'}` returns an object, never a string). Low-value dead-defensive coverage. Accepted.
- **F-xval-2 (LOW):** the GOAL EN positive regex is slightly looser than the plan Goal wording; the load-bearing assertion is the negative (PT tokens ABSENT), which holds. Accepted.
- **F-arch-2..5, F-dom-1..6, F-wire-1/2, F-xval-1 (INFO):** SRP/DIP clean, fail-soft double-layered, referential integrity proven + tested, Princípio 2 ordering (correction before persist → dedup convergence), Princípio 3 typed event + no-op discipline, `user` preserved in two places, no-paper-names, additive-only, honest-disclosure consistent. No action.

## Cross-validation summary

All 10 Coverage Matrix rows implemented (Row 1 intentionally superseded by the disclosed always-on deviation; Row 10 live re-verify now closed). Wiring triad complete: (a) caller `runExtractionPipeline` → before `linkEntities`; (b) integration GOAL (real LLM + pgvector) + 2 pipeline wiring tests; (c) `extraction_label_language_mismatch` OTel event. Honest disclosure (plan § Implementation deviation) matches the code (no label-language detect-gate; always-on).

## Quality gates

- `npm run typecheck` clean; `npm run lint` clean (changed files).
- Core domain suite **496 pass** (`--no-file-parallelism`; the parallel-run "2 failed/42 errors" was worker contention, not a regression); EG-5 suites 90/90.
- Hardened real-LLM GOAL **4/4** stable (EN labels EN, PT labels PT) vs real gpt-4o-mini + `ankane/pgvector:v0.5.1`.
- Live dev-stack entity-label re-verify **3/3 English** (rebuilt themory image).
- `/plan-confidence` SHIPPABLE; `/deps-audit` no-op (no new dep; eld reused, CLEAN); `/code-quality` PASS (0 caps).

## Spawned agents (audit trail)

architecture (a4ca4e697c5b081d1), tests (a88cb548f88b512ed), wiring+cross-validation (a3c1f1b3d63c9e96c), domain-memory-layer (a6b9ee880159e3f8f).

## Handoff decision

READY_TO_MERGE — 0 BLOCKER/HIGH/MEDIUM; LOW/INFO closed inline or accepted with rationale. Empirically proven against the real LLM (GOAL 4/4) and the running dev stack (3/3 EN labels). Proceed to `/release`.
