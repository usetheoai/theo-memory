---
slug: system-llm-eval
milestone_id: M21
created_at: 2026-07-25
goal: Ship a private packages/eval package that scores the LLM stages against golden fixtures with a versioned baseline + conditional CI regression gate.
---

# Plan: Per-stage LLM eval harness (`@usetheo/memory-eval`)

> **Version 1.0** — Promote TheMemory's eval from `tests/eval/` scaffolding to a first-class private workspace package `packages/eval` (`@usetheo/memory-eval`, `"private": true`). It scores the LLM-touching stages (extraction + the consolidation path reflect/distill/conflict) against versioned golden fixtures, commits a baseline, and fails a **conditional** CI gate when a stage regresses beyond a tolerance band — SKIPping honestly when no LLM key is present. Migrates the two existing evals (distillation, forgetting) so there is one eval home, not two. Grounded in the M21 discovery blueprint (mem0 + graphiti + our own convention).

## Goal

> "Enable TheMemory maintainers to detect LLM-stage quality regressions so that a prompt/model change that degrades extraction or consolidation fails the build, measured by `pnpm --filter @usetheo/memory-eval test` passing AND `packages/eval/src/regression.ts` failing a seeded-regression fixture."

## Context

M21 (ROADMAP.md) closes the honest gap that the highest-variance part of the system — the LLM stages — has **no repeatable, versioned eval** (only one-off fixtures inside unit tests). The discovery blueprint (`.claude/knowledge-base/discoveries/blueprints/system-llm-eval-blueprint.md`) found: mem0 keeps its eval in a **separate repo** (`mem0ai/memory-benchmarks`, dep-graph isolation) and scores **end-to-end QA only** — never a single stage; graphiti uses a **committed baseline + pairwise LLM-judge**; our own `tests/eval/{distillation,forgetting}` already established a two-tier convention (LLM-free harness + key-gated LLM-measured test) but lives under `tests/` as a second-class citizen and runs in **no CI job**. The project owner chose (this session) to promote it to a private workspace package. This is an INTERNAL quality eval, not a comparative benchmark — ADR-0020 / `public-copy.md § 4` are untouched.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `tests/eval/distillation/metrics.ts` | 138 | `c061222` (2026-07-17) | Pure metric fns (precision/recall/conflictAccuracy/jaccard/bleu) | Function signatures + Jaccard@0.5 semantics MUST stay identical after move |
| `tests/eval/distillation/run.ts` | 157 | `c061222` (2026-07-17) | LLM-free distillation eval runner + matrix render | Matrix output shape preserved for downstream readers |
| `tests/eval/forgetting/run.ts` | 220 | `c061222` (2026-07-17) | LLM-free forgetting eval (recall@10 across eviction strategies) | recall@10 semantics preserved |
| `tests/fixtures/distillation/loader.ts` | 86 | `c061222` (2026-07-17) | Zod-validated gold-set loader (200 fixtures, hand vs procedural) | Loader contract + `source==='hand'` filter preserved |
| `tests/integration/distillation/the-goal-test-llm-measured.test.ts` | 272 | `6fad64e` (2026-07-17) | Key-gated real-LLM measured signal for consolidation | Its metric import path updates to the new package; behavior unchanged |
| `packages/core/src/domain/extraction/pipeline.ts` | 444 | `820a97d` (2026-07-23) | The extraction stage under eval (read-only — eval consumes it) | NOT modified by this plan (eval is read-only over it) |
| `pnpm-workspace.yaml` | 3 | `c061222` (2026-07-17) | Workspace globs (`packages/*`) | `packages/*` already includes the new package — no edit needed |
| `packages/eval/package.json` (NEW) | 0 | — | (private eval package manifest) | — |
| `packages/eval/tsconfig.json` (NEW) | 0 | — | (eval tsconfig) | — |
| `packages/eval/src/metrics/index.ts` (NEW) | 0 | — | (promoted metric primitives) | — |
| `packages/eval/src/schema.ts` (NEW) | 0 | — | (Zod unified result + baseline schema) | — |
| `packages/eval/src/regression.ts` (NEW) | 0 | — | (baseline load + tolerance-band comparator, fail-closed) | — |
| `packages/eval/src/stages/extraction/{golden.ts,run.ts}` (NEW) | 0 | — | (extraction golden loader + LLM-free structural runner) | — |
| `packages/eval/src/stages/consolidation/run.ts` (NEW) | 0 | — | (reflect/distill/conflict runner over the migrated distillation gold set) | — |
| `packages/eval/src/baselines/*.json` (NEW) | 0 | — | (committed baseline seeded from a real LLM-free run) | — |
| `packages/eval/src/run.ts` (NEW) | 0 | — | (orchestrator CLI: --stage, --predict-only/--evaluate-only, matrix) | — |
| `packages/eval/src/__tests__/*.test.ts` (NEW) | 0 | — | (unit/integration tests for the framework) | — |
| `packages/eval/datasets/extraction/*.json` (NEW) | 0 | — | (hand-authored extraction golden: hard + negative cases) | — |
| `.github/workflows/eval.yml` (NEW) | 0 | — | (conditional key-gated eval CI job) | — |
| `packages/eval/README.md` (NEW) | 0 | — | (repro doc) | — |
| `CHANGELOG.md` | — | — | Public contract | `[Unreleased]` gets an Added entry |

### Current callers / dependents

- **Symbol:** `precision`, `recall`, `conflictResolutionAccuracy`, `entityOverlapJaccard`, `bleuScore` in `tests/eval/distillation/metrics.ts`
  - **Callers (tests):** `tests/eval/distillation/run.ts`, `tests/integration/distillation/the-goal-test-llm-measured.test.ts` (import from `../../eval/distillation/metrics.js`)
  - **Callers (production):** none — eval-only.
  - **External (other repos):** no.
  - Move plan: re-export from `packages/eval/src/metrics/index.ts`; update the two import sites. `grep -rln "eval/distillation/metrics" tests/` enumerates the sites.
- **Symbol:** `loadGoldSet` in `tests/fixtures/distillation/loader.ts`
  - **Callers (tests):** `tests/eval/distillation/run.ts`, `tests/integration/distillation/*` — updated to the package's re-export or kept in place with a shim.

### Domain glossary

- **stage** — one LLM-touching step of the pipeline: extraction (`remember`), or the consolidation path (reflect → distill → conflict-resolution, one `ConflictResolutionPolicy` code path).
- **golden / gold set** — hand-authored fixtures with ground-truth expected output, Zod-validated at load.
- **baseline** — a committed JSON of per-stage scores from a known-good run; the regression gate compares candidate scores against it.
- **tolerance band (ε)** — per-metric allowed drop below baseline before the gate fails (LLM non-determinism makes exact equality wrong).
- **two-tier** — LLM-free structural harness (always runs) + LLM-measured tier (key-gated, honest SKIP).
- **vacuous score** — a green metric that proves nothing because fixtures are categorically trivial (the F-M5 caveat).

### Architecture boundaries affected

- New workspace package `packages/eval` depends on `@usetheo/memory` (the PUBLIC surface, as a consumer) — a one-directional dependency from the eval tool onto the published library. The library MUST NOT depend on the eval (no inward edge). Per `rules/architecture.md § DIP`: eval is an outer consumer, never imported by the domain.

## Prior Art & Related Work

- **Internal blueprint:** `.claude/knowledge-base/discoveries/blueprints/system-llm-eval-blueprint.md` §"Coverage Corner 4 — Techniques" (baseline+regression+tolerance) and §"ADRs".
- **Reference (local):** `.claude/knowledge-base/references/graphiti/tests/evals/eval_e2e_graph_building.py` — committed baseline snapshot + judge compare (`build_baseline_graph`/`eval_graph`).
- **Reference (GitHub):** `mem0ai/memory-benchmarks` @ 4b61c5d — unified result schema, `--predict-only/--evaluate-only`, top-k cutoff sweep, judge rubric; **end-to-end-only** (no per-stage) → our per-stage scoring is green-field.
- **Our convention:** `tests/eval/distillation/run.ts` + `tests/integration/distillation/the-goal-test-llm-measured.test.ts` — the two-tier pattern we extend + migrate.

## Objective

- [ ] Private `packages/eval` package exists, joins the workspace, and CANNOT be published (guard test).
- [ ] Metric primitives promoted to one source; the two existing import sites updated; no behavior change.
- [ ] Zod unified result + baseline schema; regression comparator with per-metric tolerance band, fail-closed.
- [ ] Extraction golden set (hand-authored, incl. negative + hard cases) + LLM-free structural runner producing real precision/recall.
- [ ] Consolidation (reflect/distill/conflict) wired to the baseline gate over the migrated distillation gold set.
- [ ] Committed baseline JSON + regression gate proven to FAIL on a seeded regression (evidence).
- [ ] Conditional key-gated CI job (honest SKIP without key) + README repro; distillation+forgetting migrated.

## ADRs

### D1 — Home: private workspace package `packages/eval` (`@usetheo/memory-eval`, `"private": true`)

- Decision: promote the eval to a private pnpm workspace package.
- Rationale: mem0 isolates its eval from the library dep graph via a separate repo; a private workspace package is the in-monorepo form. Dep-isolation + own CI lane.
- Alternatives considered: (a) keep in `tests/eval/` — rejected: second-class, contradicts the owner's explicit ask; (b) top-level `eval/` dir — rejected: weaker dep isolation; (c) separate repo — rejected: YAGNI, fragments the dev loop; eval must move in lockstep with the pipeline.
- Consequences: enables clean deps + CI targeting; constrains — MUST be `"private": true` + excluded from publish + guard test (adjacency-to-published-packages hazard mem0's separate repo avoids).

### D2 — Reuse `metrics.ts` (Jaccard@0.5 set precision/recall + conflict accuracy); no BLEU for the gate

- Decision: the gate metric is set-overlap precision/recall, not BLEU.
- Rationale: EC-10 header in `tests/eval/distillation/metrics.ts` — BLEU collapses on short facts. mem0 also computes no BLEU/F1 (judge-only).
- Alternatives considered: BLEU-4 as the primary metric — rejected (too strict on short facts); LLM-judge-only like mem0 — rejected for the LLM-free tier (needs a deterministic metric to gate cheaply). BLEU kept only as a secondary reported number.
- Consequences: deterministic, cheap gate; constrains — set-overlap can't capture semantic nuance (that's the LLM-measured tier's job).

### D3 — Regression gate = committed baseline JSON + comparator with per-metric tolerance band, fail-closed

- Decision: commit a baseline JSON and fail the gate when a metric drops below `baseline − ε`.
- Rationale: graphiti + mem0 both commit golden JSONs; neither gates on them. A hardening system needs the gate they omit. Tolerance band because LLM output is non-deterministic.
- Alternatives considered: exact equality — rejected (flaky); no gate (mem0) — rejected (defeats the milestone).
- Consequences: catches regressions; constrains — baseline changes require PR justification (guard against baseline-as-theatre).

### D4 — Conditional CI keyed on `OPENROUTER_(API_)KEY`/`OPENAI_API_KEY`; honest SKIP, never fabricate green

- Decision: the LLM-measured tier + baseline gate run only when a key secret is present; SKIP honestly otherwise.
- Rationale: our `HAS_KEY` precedent (`tests/integration/extraction-language-determinism.test.ts`). LLM-free structural tier always runs.
- Alternatives considered: always-run (needs a key in CI, cost + secret exposure) — rejected; never-run — rejected (no gate).
- Consequences: CI stays cheap + keyless-safe; constrains — the strongest signal only fires when a key is configured.

### D5 — Per-stage scoring is green-field; extraction is the distinct new golden, consolidation reuses the distillation gold set

- Decision: score extraction against a new golden; score reflect/distill/conflict against the existing distillation gold set (one code path).
- Rationale: reflect ⊇ distill ⊇ conflict is ONE `ConflictResolutionPolicy` code path already covered by `tests/fixtures/distillation/` (contradiction-pair + 4 other categories). Extraction (`remember`) is the distinct stage with clear ground truth and the highest regression history (#111/#103).
- Alternatives considered: author 4 separate golden sets — rejected (reflect/distill/conflict are the same path; separate sets would be redundant, DRY violation); extraction-only — rejected (leaves consolidation ungated).
- Consequences: honest complete coverage of all four named stages via 2 golden sets; constrains — a future distinct "reflect summary quality" eval (beyond conflict) is a follow-up if a need appears (YAGNI).

### D6 — Migrate the two existing evals into the package

- Decision: move distillation + forgetting evals into `packages/eval`.
- Rationale: two eval homes is worse than one; DRY.
- Alternatives considered: leave them in `tests/eval/` — rejected (split-brain).
- Consequences: one home; constrains — the migration must keep `npm run eval:distillation`/`eval:forgetting` working (or update them).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `packages/eval` accidentally published next to 4 published packages | High | `"private": true` + exclude from publish matrix + **publish-guard test** asserting private+not-in-matrix | maintainer |
| Vacuous golden fixtures inflate scores (F-M5) | High | fixtures MUST include negative + ambiguous cases; a fixture asserting the metric CAN drop below baseline (seeded regression) | maintainer |
| LLM non-determinism makes the gate flaky | Medium | `temperature=0` + tolerance band `ε` (not equality); LLM-measured tier key-gated so keyless CI never flakes | maintainer |
| Migration breaks the two existing eval import sites | Medium | update import paths in the same commit; full suite green gate | maintainer |
| Baseline becomes theatre (blindly re-baselined on regression) | Medium | changing a baseline JSON requires PR justification; the seeded-regression test proves the gate fires | maintainer |

## Unresolved Questions

- Q1 — Does this environment have an LLM key? If not, the LLM-measured tier + baseline gate SKIP honestly; the framework + LLM-free structural tier + deterministic metric evidence still prove 100% functional. (Designed behavior per D4, not a gap.)
- Q2 — Should `npm run eval:*` root scripts delegate to the package, or be replaced by `pnpm --filter`? (Resolve in Phase 4: keep root aliases delegating to the package for backward-compat.)

## Dependencies

No **new** runtime or dev dependency is introduced — every library the eval package needs is already declared in the monorepo (parsimony ladder rung 4: reuse an installed dependency).

| Dependency | Version (as already pinned) | Ecosystem | Rule 9 justification (why this, not hand-rolled) |
|---|---|---|---|
| `@usetheo/memory` | `workspace:*` | npm (workspace) | The library under eval — consumed via its public surface, never re-implemented. |
| `zod` | already in `packages/core` deps | npm | Schema validation for fixtures + baseline — the established validator (`tests/fixtures/distillation/loader.ts`). |
| `natural` | already an optionalDependency (v0.6.1) | npm | BLEU/tokenizer primitives already used by `tests/eval/distillation/metrics.ts`; no new dep. |
| `tsx` | already present | npm | Runs the harness (established: `eval:distillation`/`eval:forgetting`). |
| `vitest` | already the repo test runner | npm | Package unit/integration tests. |

No CVE surface changes because no new package enters the tree. `pnpm audit` before/after is unchanged (recorded in the integration validation phase).

## Dependency Graph

```
Phase 0 (scaffold+guard) ──▶ Phase 1 (metrics+schema+regression) ──▶ Phase 2 (migrate) 
                                                     │
                                                     ▼
                              Phase 3 (per-stage runners) ──▶ Phase 4 (baseline+orchestrator+scripts)
                                                                        │
                                                                        ▼
                                              Phase 5 (CI gate + README + LLM-measured tier)
                                                                        │
                                                                        ▼
                                              Phase 6 (integration validation + benchmark evidence)
```

Sequential; Phase 2 and Phase 3 can partially overlap (both depend only on Phase 1).

---

## Phase 0: Scaffold the private package + publish guard

**Objective:** `packages/eval` exists as a private workspace member that cannot be published.

### T0.1 — Scaffold `@usetheo/memory-eval` (private) + publish-guard test

#### Objective
Create the package manifest, tsconfig, and a test that fails if the package is publishable.

#### Why this step (action + reasoning)
1. Creates `packages/eval/package.json` (`"private": true`, `@usetheo/memory` workspace dep, `tsx`), `tsconfig.json`, and `src/__tests__/publish-guard.test.ts`.
2. It is necessary FIRST because D1's central risk (adjacency to published packages) must be fenced before any code lands; every later phase relies on the package existing. Cites D1.

#### Evidence
`pnpm-workspace.yaml` globs `packages/*` (`c061222`) → the new dir auto-joins. `packages/core/package.json` has no `"private"` and a `files` allow-list — the eval package inverts this (`"private": true`).

#### Files to edit
```
packages/eval/package.json (NEW) — private manifest, workspace dep on @usetheo/memory, tsx, vitest
packages/eval/tsconfig.json (NEW) — extends root tsconfig
packages/eval/src/__tests__/publish-guard.test.ts (NEW) — RED test: asserts package.json "private"===true AND package not in the publish workflow matrix
packages/eval/README.md (NEW) — stub (filled in Phase 5)
```

#### Deep file dependency analysis
- `package.json` (NEW): declares `"private": true`, `"name": "@usetheo/memory-eval"`, deps `@usetheo/memory: "workspace:*"`, devDeps `tsx`, `vitest`, `zod`, `natural`. Downstream: every later `src/**` imports resolve within this package.
- `publish-guard.test.ts` (NEW): reads its own `package.json` + `.github/workflows/publish.yml`; asserts `private===true` and that `@usetheo/memory-eval` does not appear in any publish matrix entry.

#### Deep Dives
- Invariant: `private===true` MUST hold forever (guard test).
- Edge case: if `publish.yml` uses a glob/wildcard for packages, the guard must assert an explicit exclusion of `eval` — read the actual matrix shape first.

#### TDD
```
RED: publish-guard.test.ts asserts package.json.private===true → fails (package.json missing/incomplete)
GREEN: write package.json with "private": true; ensure publish workflow excludes eval
REFACTOR: extract the matrix-read helper if reused
```
Test literal: `test_eval_package_is_private_and_not_in_publish_matrix`.

#### Acceptance criteria
- `pnpm --filter @usetheo/memory-eval test` runs the guard test and it PASSES.
- `pnpm -w install` succeeds with the new workspace member.
- Grep of `.github/workflows/publish.yml` shows `@usetheo/memory-eval` is NOT a publish target.

#### DoD
- [ ] `packages/eval/package.json` has `"private": true`.
- [ ] Publish-guard test green.
- [ ] `pnpm -w install` clean.
- [ ] CHANGELOG `[Unreleased] § Added` updated.

---

## Phase 1: Framework core — metrics + schema + regression comparator

**Objective:** the reusable, LLM-free framework: one metric source, a Zod baseline schema, and a fail-closed regression comparator with a tolerance band.

### T1.1 — Promote metric primitives to `packages/eval/src/metrics/`

#### Objective
Move the pure metric functions to one authoritative source and update callers.

#### Why this step
1. Copies the five pure fns from `tests/eval/distillation/metrics.ts` into `packages/eval/src/metrics/index.ts`; re-points the two import sites.
2. Necessary before per-stage runners so every stage shares one metric definition (DRY). Cites D2 + Baseline Context callers.

#### Evidence
`tests/eval/distillation/metrics.ts:1-138` (the five fns + EC-10 BLEU note). Two importers enumerated in Baseline Context.

#### Files to edit
```
packages/eval/src/metrics/index.ts (NEW) — the five pure fns, verbatim semantics
packages/eval/src/metrics/index.test.ts (NEW) — RED: property tests (precision/recall/jaccard bounds, empty-input edge cases, negative case: mismatched inputs → 0)
tests/eval/distillation/run.ts — update import to the package (or keep until Phase 2 migration)
tests/integration/distillation/the-goal-test-llm-measured.test.ts — update metric import
```

#### Deep Dives
- Invariant: `entityOverlapJaccard` returns [0,1]; `precision([],x)===0`; `recall(x,[])===0`. Negative case: non-array input rejected at the boundary (TS types + runtime guard).

#### TDD
```
RED: metrics/index.test.ts asserts precision/recall/jaccard identities + edge (empty) + negative (type-guard) → fails (module absent)
GREEN: create metrics/index.ts
REFACTOR: none (pure copy)
```
Test literal: `test_precision_recall_jaccard_bounds_and_empty_edges`.

#### Acceptance criteria
- Metric unit tests pass; the two importers compile against the new path.

#### DoD
- [ ] One metric source; both importers updated; full suite green.

### T1.2 — Zod unified result + baseline schema

#### Objective
Typed schemas for a per-stage result and a committed baseline.

#### Why this step
1. `src/schema.ts` defines `StageScore` (`{stage, precision, recall, accuracy?, n, runtimeMs}`) and `Baseline` (`{generatedAt, model, stages: StageScore[]}`), Zod-validated.
2. Necessary before the comparator + baseline seeding (they consume these types). Cites mem0's `EvalItem`/`UnifiedResult` (Prior Art) + our Zod loader precedent.

#### Evidence
mem0 `benchmarks/common/schema.py` `EvalItem`/`UnifiedResult`. Our `tests/fixtures/distillation/loader.ts` Zod-at-read precedent.

#### Files to edit
```
packages/eval/src/schema.ts (NEW)
packages/eval/src/schema.test.ts (NEW) — RED: valid parses; NEGATIVE: out-of-range score / missing field → ZodError
```

#### TDD
```
RED: schema.test.ts asserts a valid Baseline parses AND a score>1 throws ZodError → fails (schema absent)
GREEN: write schema.ts
```
Test literal: `test_baseline_schema_rejects_out_of_range_score`.

#### Acceptance criteria
- Valid baseline parses; invalid (score>1, missing stage) throws typed ZodError.

#### DoD
- [ ] Schema + negative-case test green.

### T1.3 — Regression comparator (tolerance band, fail-closed)

#### Objective
Compare candidate stage scores against a committed baseline; fail if any metric drops below `baseline − ε`.

#### Why this step
1. `src/regression.ts` exports `compareToBaseline(candidate, baseline, tolerance): RegressionResult` returning `{regressed: boolean, details: [...]}`; `assertNoRegression(...)` throws a typed `RegressionError` when regressed.
2. This is the milestone's core new mechanism (D3) — graphiti/mem0 omit it. Necessary before wiring stages to the gate.

#### Evidence
graphiti `eval_graph` compares candidate vs baseline (Prior Art). D3.

#### Files to edit
```
packages/eval/src/regression.ts (NEW)
packages/eval/src/regression.test.ts (NEW) — RED: no-regression passes; SEEDED regression (candidate below band) → RegressionError; EDGE: exactly at band boundary passes; NEGATIVE: unknown stage in candidate → typed error
```

#### Deep Dives
- Algorithm: for each baseline stage, find the candidate stage; for each metric, `if candidate < baseline - tolerance[metric] → regressed`. Missing candidate stage → fail-closed (typed error). Extra candidate stage → warn (not fail).
- Invariant: fail-closed — any ambiguity fails, never silently passes.
- Edge: candidate exactly at `baseline - ε` → NOT regressed (boundary inclusive). Negative: candidate stage name not in baseline → `RegressionError`.

#### TDD
```
RED: regression.test.ts — 4 cases (pass / seeded-regress→throw / boundary / unknown-stage→throw) fail (module absent)
GREEN: write regression.ts
REFACTOR: extract per-metric compare
```
Test literal: `test_regression_gate_fails_closed_on_seeded_drop`.

#### Acceptance criteria
- The seeded-regression case throws `RegressionError`; the boundary case passes; unknown-stage fails-closed.

#### DoD
- [ ] Comparator + 4 tests (incl. seeded regression + boundary edge + fail-closed negative) green.

---

## Phase 2: Migrate the two existing evals

**Objective:** distillation + forgetting live in `packages/eval`; no split-brain.

### T2.1 — Move distillation + forgetting into the package

#### Objective
Relocate the two runners + gold-set loader; update npm scripts.

#### Why this step
1. `git mv` the runners + loader into `packages/eval/src/stages/`; re-point imports at the promoted metrics; keep root `eval:distillation`/`eval:forgetting` as thin delegators.
2. D6 — one eval home. Necessary before Phase 3 adds new stages beside them.

#### Evidence
`tests/eval/{distillation,forgetting}/run.ts` (`c061222`); Baseline Context callers.

#### Files to edit
```
packages/eval/src/stages/consolidation/run.ts (NEW, from distillation/run.ts)
packages/eval/src/stages/forgetting/run.ts (NEW, from forgetting/run.ts)
packages/eval/src/fixtures/distillation-loader.ts (NEW, from tests/fixtures/distillation/loader.ts) OR keep loader in place + import
package.json (root) — eval:distillation/eval:forgetting delegate to pnpm --filter
tests/integration/distillation/the-goal-test-llm-measured.test.ts — metric+loader import paths
```

#### TDD
```
RED: a package test runs the migrated forgetting runner and asserts it produces a matrix (fails: not moved)
GREEN: move files, fix imports
REFACTOR: dedupe loaders
```
Test literal: `test_migrated_runners_execute_and_render_matrix`.

#### Acceptance criteria
- `pnpm --filter @usetheo/memory-eval eval:forgetting` runs; the LLM-measured distillation integration test still compiles + its gate unchanged.

#### DoD
- [ ] Both evals run from the package; old paths removed; full suite green.

---

## Phase 3: Per-stage runners (extraction + consolidation)

**Objective:** extraction golden + runner (new); consolidation wired to the gate.

### T3.1 — Extraction golden set (hand-authored: hard + negative)

#### Objective
Author a Zod-validated extraction golden set with ground-truth expected facts, including negative + ambiguous cases.

#### Why this step
1. `datasets/extraction/*.json` — inputs (text) → expected facts/entities, incl. NEGATIVE cases (noise-only text → zero facts; the #111 function-word case) + ambiguous cases.
2. D5 — extraction is the distinct green-field stage; non-vacuous fixtures are the long pole (Drawbacks F-M5).

#### Evidence
`#111` (extraction noise) + `#103` (language) history; `tests/integration/extraction-language-determinism.test.ts`.

#### Files to edit
```
packages/eval/datasets/extraction/*.json (NEW) — >= 15 cases incl. >=3 negative (noise→0 facts) + >=3 ambiguous
packages/eval/src/stages/extraction/golden.ts (NEW) — Zod loader
packages/eval/src/stages/extraction/golden.test.ts (NEW) — RED: loader validates; NEGATIVE: malformed fixture → ZodError; asserts >=3 negative-case fixtures present
```

#### TDD
```
RED: golden.test.ts asserts loader returns typed rows + >=3 negative cases → fails (dataset/loader absent)
GREEN: author fixtures + loader
```
Test literal: `test_extraction_golden_has_negative_and_ambiguous_cases`.

#### Acceptance criteria
- Loader returns >= 15 typed rows; >= 3 negative + >= 3 ambiguous present; malformed fixture throws ZodError.

#### DoD
- [ ] Extraction golden + loader + non-vacuousness assertion green.

### T3.2 — Extraction structural runner (LLM-free) + consolidation runner wired to metrics

#### Objective
Runners that compute real precision/recall per stage against golden, LLM-free.

#### Why this step
1. `stages/extraction/run.ts` runs the golden through the extraction metric path (LLM-free structural: uses the deterministic entity-linking/noise-filter surface where possible, and marks LLM-required cases for the key-gated tier); `stages/consolidation/run.ts` (from Phase 2) emits `StageScore`.
2. Produces the real numbers the baseline is seeded from. Cites D2 + two-tier (blueprint CC4.5).

#### Evidence
`packages/core/src/domain/extraction/` deterministic surface (entity-noise-filter, entity-linking) — the LLM-free-testable part.

#### Files to edit
```
packages/eval/src/stages/extraction/run.ts (NEW) — emits StageScore{stage:'extraction',...}
packages/eval/src/stages/extraction/run.test.ts (NEW) — RED: runner emits a StageScore with precision/recall in [0,1] over golden
packages/eval/src/stages/consolidation/run.ts — emit StageScore (wire from migrated runner)
```

#### TDD
```
RED: run.test.ts asserts a StageScore with 0<=precision<=1 over the golden → fails (runner absent)
GREEN: write runner
```
Test literal: `test_extraction_runner_emits_valid_stagescore`.

#### Acceptance criteria
- Both runners emit schema-valid `StageScore`; numbers are real (deterministic over golden), not hardcoded.

#### DoD
- [ ] Extraction + consolidation runners emit valid StageScores; tests green.

---

## Phase 4: Baseline + orchestrator + scripts

**Objective:** committed baseline + a run.ts orchestrator + npm scripts; the gate wired.

### T4.1 — Seed baseline + orchestrator + regression wiring

#### Objective
`run.ts` runs stages, renders a matrix, seeds/loads the baseline, and asserts no regression.

#### Why this step
1. `src/run.ts` (`--stage`, `--predict-only/--evaluate-only`, `--update-baseline`) orchestrates runners → StageScores → matrix + `assertNoRegression` against `src/baselines/llm-free.json`.
2. Ties the framework together; the committed baseline is the regression anchor (D3).

#### Evidence
mem0 `--predict-only/--evaluate-only` (Prior Art); graphiti baseline write/compare.

#### Files to edit
```
packages/eval/src/run.ts (NEW)
packages/eval/src/baselines/llm-free.json (NEW) — seeded from a real run
packages/eval/src/run.test.ts (NEW) — RED: run(--evaluate-only) against a DELIBERATELY-lowered baseline passes; against a raised baseline (simulating candidate regression) throws RegressionError
package.json (root) — "eval": "pnpm --filter @usetheo/memory-eval eval"
```

#### TDD
```
RED: run.test.ts — candidate-vs-baseline: no-regress passes, seeded-regress throws → fails (orchestrator absent)
GREEN: write run.ts + seed baseline
REFACTOR: extract matrix render
```
Test literal: `test_orchestrator_gate_passes_baseline_and_fails_seeded_regression`.

#### Acceptance criteria
- `pnpm --filter @usetheo/memory-eval eval` runs, prints a matrix, and exits 0 against the committed baseline; a seeded regression exits non-zero.

#### DoD
- [ ] Orchestrator + committed baseline + regression wiring; gate proven to fire; tests green.

---

## Phase 5: Conditional CI + README + LLM-measured tier

**Objective:** a key-gated CI job + repro doc; the LLM-measured tier wired (honest SKIP).

### T5.1 — Conditional CI job + README + LLM-measured tier

#### Objective
CI runs the LLM-free gate always; runs the LLM-measured tier only when a key secret is present; README documents repro.

#### Why this step
1. `.github/workflows/eval.yml` — job runs `pnpm --filter @usetheo/memory-eval test` + the LLM-free `eval` gate unconditionally; a second step runs the LLM-measured tier only `if: ${{ secrets.OPENROUTER_KEY }}`; README documents the exact commands + cost.
2. D4 — conditional gate, honest SKIP. No eval runs in CI today (blueprint CC3) — this is the new wiring.

#### Evidence
Our `HAS_KEY` conditional-skip precedent; blueprint CC3 (no eval in CI today).

#### Files to edit
```
.github/workflows/eval.yml (NEW)
packages/eval/README.md — repro commands + cost disclosure + honesty caveat (F-M5)
packages/eval/src/stages/*/llm-measured.test.ts (NEW or migrated) — key-gated real-LLM tier; SKIP when no key
```

#### Deep Dives
- Failure scenario (external I/O — LLM API): the LLM-measured tier hits a real LLM endpoint. On timeout/5xx/no-key it MUST SKIP or fail honestly, never fabricate a passing score. The LLM-free gate is unaffected by LLM outages.
- Self-hosted runner (matches existing workflows): the job runs `[self-hosted, linux, x64]` like `security-sast.yml`.

#### TDD
```
RED: a test asserts the LLM-measured describe-block SKIPs when OPENROUTER_KEY is unset (no fabricated green)
GREEN: gate the describe with skipIf(!HAS_KEY)
```
Test literal: `test_llm_measured_tier_skips_without_key`.

#### Acceptance criteria
- `eval.yml` parses (yamllint/act dry-run); the LLM-free gate step has no `if` (always runs); the LLM-measured step is `if: secrets.OPENROUTER_KEY`.
- README has the exact repro command + cost disclosure.

#### DoD
- [ ] CI job + README + honest-SKIP tier; CHANGELOG updated.

## Failure scenarios

External I/O touched: the **LLM API** (OpenRouter/OpenAI) in the LLM-measured tier.

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| LLM API | No key present | unset `OPENROUTER_KEY` in the test env | tier SKIPs (honest), LLM-free gate still runs + passes |
| LLM API | Timeout / 5xx | (LLM-measured tier only) real call fails | test fails LOUDLY with the API error; never a fabricated passing score; LLM-free gate unaffected |
| Baseline file | Missing / malformed baseline JSON | delete/corrupt `baselines/llm-free.json` in a test | `RegressionError`/`ZodError` (fail-closed), never a silent pass |

## Coverage Matrix

| Requirement (from Goal + Objective + DoD) | Task(s) |
|---|---|
| Private package, cannot publish | T0.1 |
| One metric source | T1.1 |
| Zod baseline schema | T1.2 |
| Regression comparator + tolerance band, fail-closed | T1.3 |
| Migrate distillation + forgetting | T2.1 |
| Extraction golden (hard + negative) | T3.1 |
| Per-stage runners emit real scores | T3.2 |
| Committed baseline + gate proven to fire | T4.1 |
| Conditional CI + README + honest-SKIP tier | T5.1 |
| Consolidation (reflect/distill/conflict) gated | T3.2 + T4.1 (over migrated distillation golden) |

## Global Definition of Done

- [ ] `pnpm --filter @usetheo/memory-eval test` green (unit + framework).
- [ ] Publish-guard test green (`"private": true`, not in publish matrix).
- [ ] Regression gate PROVEN to fire on a seeded regression (test evidence) and pass on the committed baseline.
- [ ] Extraction golden has >= 3 negative + >= 3 ambiguous cases (non-vacuous).
- [ ] LLM-measured tier SKIPs honestly without a key (no fabricated green).
- [ ] `.github/workflows/eval.yml` parses; LLM-free gate unconditional, LLM-measured step key-gated.
- [ ] Distillation + forgetting migrated; no eval under `tests/eval/` (or thin delegators only).
- [ ] `npm run typecheck` + `npm run lint` clean; changed files under LoC budget.
- [ ] CHANGELOG `[Unreleased]` updated.
- [ ] Benchmark evidence: the matrix output (`.md`) with real per-stage numbers committed under `docs/benchmarks/`.

## Final Phase: Integration Validation

- [ ] `pnpm -w install` clean with the new workspace member.
- [ ] `pnpm --filter @usetheo/memory-eval test` green.
- [ ] `pnpm --filter @usetheo/memory-eval eval` prints the matrix + exits 0 against the baseline.
- [ ] Seeded-regression test exits non-zero (gate fires).
- [ ] Full repo suite (`npm test`) green (migration did not break existing tests).
- [ ] `npm run typecheck` + `npm run lint` clean.
