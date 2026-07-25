---
slug: system-llm-eval
milestone_id: M21
kind: discovery-blueprint
date: 2026-07-25
verdict: SHIPPABLE
references:
  - .claude/knowledge-base/references/graphiti/tests/evals/ (local clone, cited)
  - mem0ai/memory-benchmarks @ 4b61c5d (GitHub, WebFetch — mem0's eval is a submodule)
  - tests/eval/distillation/ + tests/eval/forgetting/ (our own established convention)
---

# Blueprint — Per-stage LLM eval harness for TheMemory (M21)

Deep-research output for M21. Answers: **how do serious memory systems eval their LLM
pipeline, and what does TheMemory build?** Grounded in three independent references
(mem0, graphiti, our own codebase), each cited with a path/URL.

## Objective

An LLM-stage evaluation harness that scores the four LLM-touching stages — **extraction,
reflect (consolidation), distill (episodic→semantic), conflict-resolution** — against
versioned golden fixtures, with a **committed baseline + regression gate** and a
**conditional (LLM-key-gated) CI job** that SKIPs honestly when no key is present.

## Coverage Corner 1 — Integration tests (how references test the boundary)

- **graphiti** (`.claude/knowledge-base/references/graphiti/tests/evals/eval_e2e_graph_building.py`):
  end-to-end graph-building eval. **LLM-as-judge PAIRWISE** — builds a `candidate` graph and
  compares each episode against a committed `baseline_graph_results.json`, asking the judge
  `candidate_is_worse?`; score = fraction not-worse, averaged per user then overall. Dataset:
  LongMemEval oracle (`data/longmemeval_data/longmemeval_oracle.json`, HF dataset). Baseline is
  a committed JSON snapshot; `build_baseline_graph()` writes it, `eval_graph()` compares.
- **mem0** (`mem0ai/memory-benchmarks` @ 4b61c5d, `benchmarks/locomo/run.py`): 4-phase pipeline
  ingest→search→generate→**judge**. **LLM-as-judge ABSOLUTE** (per-example binary CORRECT/WRONG →
  1.0/0.0), aggregated into category accuracy. `--predict-only`/`--evaluate-only` phase split;
  retrieval-depth sweep via top-k cutoffs `[10,20,50,200]`. **No CI gate, no tolerance band**
  (deliberate — cross-model marketing disclaimer).
- **ours** (`tests/integration/distillation/the-goal-test-llm-measured.test.ts`): real
  `gpt-4o-mini` via OpenRouter, **gated on `OPENROUTER_(API_)KEY`** presence → CI skips cleanly.
  Acceptance `precision≥0.75 ∧ recall≥0.70 ∧ conflict-accuracy≥0.80`. Ships with an explicit
  **honesty caveat** (F-M5): categorically-distinct fixtures make a 1.000 vacuous — the test
  proves wiring, not judgment quality.

## Coverage Corner 2 — Dependencies

- **No new runtime dep required.** Metric primitives already exist in
  `tests/eval/distillation/metrics.ts`: `precision`, `recall`, `conflictResolutionAccuracy`,
  `entityOverlapJaccard`, `bleuScore` (BLEU-4 built inline on the existing `natural`
  optionalDependency — see the EC-10 header note; `natural` ships no `BleuScore`).
- **`zod`** (already a core dep) for typed fixture + baseline schemas — the distillation loader
  (`tests/fixtures/distillation/loader.ts`) already validates fixtures with Zod at read time.
- **`tsx`** (already present) runs the harness; npm scripts `eval:distillation`, `eval:forgetting`
  already exist. mem0's lesson: keep datasets + judge-clients OUT of the library dep graph → a
  dedicated eval package is the isolation boundary.

## Coverage Corner 3 — Tools

- Runner via `tsx` (established). Matrix output as `.md` (established:
  `tests/eval/distillation/run.ts` renders a matrix). Baseline as committed JSON (graphiti +
  mem0 both commit golden JSONs: `baseline_graph_results.json`; `results/platform/*.json`).
- CI: **no eval runs in CI today** (`grep eval: .github/workflows` = ∅). The conditional gate is
  genuinely new wiring. Conditional-skip precedent across our suite:
  `process.env.OPENAI_API_KEY`/`OPENROUTER_KEY` presence gate (e.g.
  `tests/integration/extraction-language-determinism.test.ts` `HAS_KEY`).

## Coverage Corner 4 — Techniques (the algorithm/pattern borrowed)

1. **Committed baseline + regression comparator with a tolerance band** (graphiti's baseline
   snapshot + mem0's committed golden JSONs, upgraded with the CI gate + `ε` band that BOTH
   references deliberately omit). `candidate < baseline − ε` on any wired stage → FAIL.
2. **Unified result schema** (mem0 `EvalItem`/`UnifiedResult`, Zod-typed) with per-stage slots.
3. **Phase-separable CLI** (`--predict-only`/`--evaluate-only`) to iterate the judge without
   re-ingest.
4. **LLM-judge with a versioned, lenient-but-bounded rubric** (mem0: partial-credit, paraphrase,
   date-tolerance, anti-"no"-bias) + `temperature=0` + structured JSON `{reasoning,label}`.
5. **Two-tier split** (ours): LLM-free structural harness (always runs, CI-cheap, validates
   loader→metric→matrix) + LLM-measured tier (key-gated, honest SKIP). The regression gate runs
   on the LLM-measured tier when key present.
6. **Non-vacuous fixtures** — hard/ambiguous + negative cases so a green score is not vacuous
   (directly answers the F-M5 caveat + the grill's "golden enviesado / baseline-teatro" risk).

## ADRs (structural decisions for the plan)

- **ADR-E1 — Home: private workspace package `packages/eval` (`@usetheo/memory-eval`,
  `"private": true`).** Alternatives: (a) keep under `tests/eval/` — rejected: second-class,
  the user's explicit ask is to promote it; (b) top-level `eval/` dir — viable but weaker
  dep-isolation; (c) separate repo — rejected as YAGNI (eval must move in lockstep with the
  pipeline). **Evidence:** mem0 keeps its eval OUT of the library via a separate repo/submodule
  (`mem0ai/mem0:.gitmodules` → `mem0ai/memory-benchmarks`) precisely for dep-graph isolation; a
  private workspace package is the in-monorepo form of the same decision. **Hard requirement
  (from the adjacency risk mem0's separate-repo avoids):** `"private": true` + excluded from the
  publish matrix + a **publish-guard test** that fails if the package would be packed/published.
- **ADR-E2 — Metric: reuse `metrics.ts` (Jaccard@0.5 set precision/recall + conflict accuracy),
  NOT BLEU for short facts.** Evidence: the EC-10 header note in
  `tests/eval/distillation/metrics.ts`. mem0 also computes NO BLEU/F1 in its harness (judge-only)
  — but our per-stage thesis needs set-F1 over facts, which mem0 does not do (green-field, see
  ADR-E5).
- **ADR-E3 — Regression gate = committed baseline JSON + comparator with tolerance band `ε`,
  fail-closed.** Alternatives: no gate (mem0's choice) — rejected for a hardening system; exact
  equality — rejected (LLM non-determinism). `ε` default per metric; changing the baseline
  requires PR justification.
- **ADR-E4 — Conditional CI gate keyed on `OPENROUTER_(API_)KEY`/`OPENAI_API_KEY`; honest SKIP
  without key; never fabricate green.** Evidence: our `HAS_KEY` precedent +
  `the-goal-test-llm-measured.test.ts`. The LLM-free structural tier always runs.
- **ADR-E5 — Per-stage scoring is GREEN-FIELD.** mem0 evals **end-to-end QA only** — it never
  scores extraction/consolidation/conflict in isolation (`benchmarks/common/mem0_client.py`
  captures no raw extracted facts). This is TheMemory's differentiator: score each stage. The
  distillation gold set (`tests/fixtures/distillation/`, contradiction-pair category) already
  covers distill+conflict; extraction + reflect golden sets are the new authoring work.
- **ADR-E6 — Migrate the 2 existing evals (distillation, forgetting) into `packages/eval`** to
  avoid split-brain. Non-negotiable: two eval homes is worse than the status quo.

## Bottleneck analysis (the goal demands it)

| Bottleneck | Where it bites | Mitigation |
|---|---|---|
| **LLM cost/latency** (4 stages × N × judge calls) | full LLM-measured run | Two-tier: LLM-free structural harness always; LLM-measured tier key-gated + small fixed subset for the gate; top-k cutoff sweep re-uses one ingest (mem0 pattern). |
| **Flaky non-determinism** | gate stability | `temperature=0` + tolerance band `ε` (not equality) + `N≥3` near the band. |
| **Vacuous fixtures** (F-M5) | a green score proving nothing | fixtures MUST include ambiguous + negative cases; the metric must be able to fail; publish the caveat. **This is the long pole, not the framework.** |
| **CI wiring absent today** | no eval in CI | new conditional job (key-gated, honest SKIP). |
| **Re-work / split-brain** | two eval homes | migrate existing evals; reuse `metrics.ts`; one package. |
| **Accidental publish** | `packages/eval` next to 4 published packages | `"private": true` + publish-matrix exclusion + guard test. |

## What we build (scope handed to /to-plan)

1. `packages/eval` (`@usetheo/memory-eval`, private) — `package.json`/`tsconfig`/README + publish-guard.
2. `src/metrics/` — promote the reusable metric primitives (single source).
3. `src/schema.ts` — Zod unified result + baseline schema.
4. `src/regression.ts` — baseline load + comparator with per-metric tolerance band (fail-closed).
5. `src/stages/{extraction,reflect,distill,conflict}/` — per-stage runner + golden loader.
6. `src/baselines/*.json` — committed baseline seeded from a real LLM-free run.
7. `src/run.ts` — orchestrator (`--predict-only`/`--evaluate-only`, `--stage`, matrix render).
8. Migrate `tests/eval/{distillation,forgetting}` → the package.
9. Conditional CI job + npm scripts `eval`, `eval:{stage}`.
10. Golden sets: extraction (new, hard+negative) + reflect (new) + distill/conflict (reuse).

## Prior art & related work

- graphiti `tests/evals/` (local clone) — pairwise baseline judge.
- mem0 `memory-benchmarks` @ 4b61c5d (GitHub) — absolute judge, unified schema, cutoff sweep;
  end-to-end-only (no per-stage).
- Our `tests/eval/{distillation,forgetting}` + `tests/integration/distillation/the-goal-test-llm-measured.test.ts`
  — the two-tier convention we extend.
