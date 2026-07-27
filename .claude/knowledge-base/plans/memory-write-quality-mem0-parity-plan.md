---
slug: memory-write-quality-mem0-parity
milestone_id: M27
created_at: 2026-07-27
goal: Bring infer:true write output to mem0-grade durable-fact quality, measured by the M21 eval extraction stage reaching a declared single-third-person-fact ratio, with the infer:false verbatim path byte-identical.
---

# Plan: Memory write quality — durable-fact distillation (mem0 parity) · M27

## Goal

Rewrite the `infer:true` extraction discipline so every stored item is an atomic, declarative,
standalone, third-person durable fact — proven by the M21 eval extraction stage reaching a
single-third-person-fact ratio ≥ 0.90 on a fixed transcript that today produces dumps/questions,
while the `infer:false` verbatim path stays byte-identical.

## Context

Grounded in blueprint `memory-write-quality-mem0-parity`
(`.claude/knowledge-base/discoveries/blueprints/`, SHIPPABLE 100). Root cause is three-layer (kit
sends raw 400-word narration; extraction `SYSTEM_PROMPT` has no fact-quality discipline; `infer`
defaults to extraction). The dogfound pollution: 400-word transcript dumps, assistant questions
(`Quer que eu prossiga…?`), first-person voice (`Minha recomendação:`) stored as facts. v0.51.0 fixed
WHO (attribution); this fixes WHAT/HOW.

## Baseline Context

### Files that will be touched

| File | LoC today | Last sha | Role |
|---|---|---|---|
| `packages/core/src/domain/extraction/prompt.ts` | 222 | 4a64b4b | `SYSTEM_PROMPT` + schema — the primary fix (fact discipline + few-shot) |
| `packages/core/src/domain/extraction/fact-gate.ts` | 0 (NEW) | — | deterministic backstop filter (interrogative / first-person-conversational) |
| `packages/core/src/domain/extraction/pipeline.ts` | 458 | 6580682 | one-line wire of the gate on the `infer:true` branch (DO NOT grow — over budget) |
| `packages/core/src/domain/memory-event.ts` | 274 | 6050507 | add `extraction_fact_gate_dropped` typed event (Princípio 3) |
| `packages/api/src/server/handlers/scopes.ts` | 120 | 6580682 | expose `attributed_to` in the scopes-memories list response |
| `docs/claude-code-kit/hooks/theo-remember.mjs` | 65 | 33a8e27 | fix the stale `infer=false verbatim` comment; set `infer:true` explicitly |
| `packages/eval/src/stages/extraction/run.ts` | 200 | 827633d | parity metric (single-third-person-fact ratio) + fixture |

### Current callers / dependents

- `runExtractionPipeline` (`packages/core/src/domain/extraction/pipeline.ts:50`) is called by
  `packages/core/src/infrastructure/db/scoped-memory.ts:93` (the SDK `remember`), which
  `packages/api/src/server/handlers/remember.ts:72` calls, which the kit hook
  `docs/claude-code-kit/hooks/theo-remember.mjs` posts to. Full chain verified.
- `generateAdditiveExtractionPrompt` (`extraction/prompt.ts`) is the ONLY producer of `SYSTEM_PROMPT`.
- `infer:false` branch: `pipeline.ts:73` → `runInferFalsePath` (`extraction/infer-false-path.ts`).

### Domain glossary

- **Durable fact** — atomic (one idea), declarative (not a question), standalone (no turn context
  needed), third-person (subject named). The unit mem0 stores.
- **Backstop gate** — deterministic post-extraction filter; belt-and-suspenders for prompt misses.
- **Single-third-person-fact ratio** — eval metric: stored items that are one third-person fact /
  total stored items, on a fixed transcript.

### Architecture boundaries affected

Domain (`packages/core/src/domain/extraction`) defines the pipeline; the gate is domain logic (pure,
no I/O). REST (`packages/api`) is the boundary that validates input. The dashboard UI + gateway
passthrough are **theo-cloud** (cross-repo) — the theo-memory deliverable is the REST field exposure
(`handlers/scopes.ts`). No inner→outer import is introduced.

## Prior Art & Related Work

- Blueprint `memory-write-quality-mem0-parity` (`.claude/knowledge-base/discoveries/blueprints/`) —
  the mem0 prompt-discipline study + 3-layer root cause + 4 ADRs.
- mem0 `FACT_RETRIEVAL_PROMPT` / `USER_MEMORY_EXTRACTION_PROMPT`
  (`knowledge-base/references/mem0/mem0/configs/prompts.py`) + `normalize_facts`
  (`knowledge-base/references/mem0/mem0/memory/utils.py`).
- v0.51.0 attribution fix + its regression `tests/integration/kit-attribution-write.test.ts` — the
  test shape Phase 1/2 mirror.
- M21 eval harness `packages/eval/src/stages/extraction` — the measurement substrate.

## ADRs

### ADR-1 — Fix at the extraction prompt, not by wrapping mem0

Port mem0's prompt discipline (studied); add no mem0 SDK dep, no vendor store. **Alternatives
rejected:** (a) wrap mem0's Python extractor — cross-runtime + vendor lock, violates the locked
out-of-scope "Wrapping mem0 as a backend"; (b) deterministic gate only — a regex cannot SPLIT a
400-word narration into atomic facts; only the LLM can, so the prompt carries the discipline and the
gate is a backstop. Cites `parsimony-ladder.md` (reuse zod + pipeline, no new dep).

### ADR-2 — Gate is a backstop, default-ON only on `infer:true`

`infer:false` is the explicit verbatim contract (ADR-0001 escape hatch) and stays byte-identical.
**Alternative rejected:** gate both paths — breaks the verbatim guarantee. Cites `architecture.md`
(transform at the right layer) + `error-handling.md` (typed event, not a silent drop).

### ADR-3 — Cleanup is soft-delete / re-distill, never hard-delete

Reversibility (`t_invalid`) + per-item audit event satisfy Princípio 3. **Alternative rejected:**
hard-delete — irreversible, may lose a legitimate fact inside a dump.

### ADR-4 — Parity closes on the M21 eval metric, not subjective review

DoD closes on a measured ratio within a declared margin of mem0 on the same transcript, run ≥ 3×.
**Alternative rejected:** manual "looks better" review — non-reproducible.

## Dependencies

(none — no new runtime dependency. Reuse installed `zod` + the existing extraction pipeline +
`@usetheo/memory-eval`. Parsimony ladder rung 4. `/deps-audit` confirms no CVE surface change.)

## Failure scenarios

The extraction pipeline calls an external LLM (external I/O).

- **LLM timeout / 5xx during extraction** — already handled: `runExtractionPipeline` has per-row
  fallback + `extraction_zero_facts` event. The new gate runs AFTER the LLM returns; if the LLM
  errored there are no drafts to gate (no new failure mode). Test: stub LLM throwing → pipeline
  returns the existing fallback, gate is a no-op.
- **LLM returns object-shaped facts** (`{"fact": "…"}`) — adopt mem0's `normalize_facts` coercion;
  test asserts a `{fact: "x"}` element resolves to the string `"x"`, not dropped.
- **Cleanup partial failure** — one row's re-distill fails: skip that row with an audit event,
  continue (graceful degradation); dry-run always precedes; never hard-delete.

## Coverage Matrix

| Requirement (DoD bullet / blueprint rec) | Task |
|---|---|
| Gate "durable fact?" on `infer:true`, RED-first (question NOT stored) | T1.1, T2.1 |
| Prompt discipline: atomic/declarative/3rd-person + few-shot | T1.1 |
| Multi-fact narration SPLIT into atomic facts | T1.2 |
| `infer:false` verbatim byte-identical | T2.2 |
| Kit hook delivers/uses extraction, stale comment fixed, explicit infer | T3.1 |
| One-shot cleanup (dry-run → soft-delete/re-distill, audit) | T4.1 |
| Dashboard exposes `attributed_to` (theo-memory REST side) | T5.1 |
| Objective parity metric via M21 eval | T6.1 |
| Parse robustness (object→string) | T2.3 |
| Integration validation (full chain green + benchmark) | T7.1 |

## Phase 1 — Extraction prompt discipline (primary leverage)

### T1.1 — Durable-fact contract + few-shot in `SYSTEM_PROMPT`

#### Why this step
The prompt is the 80/20: only the LLM can split a 400-word narration into atomic facts and reject a
question. Rationale: blueprint Rec 1 + ADR-1 → the fix must live in the prompt; mem0's `prompts.py`
is the template.

#### Files to edit
- `packages/core/src/domain/extraction/prompt.ts` (222 LoC → keep ≤ 300)
- `packages/core/src/domain/extraction/prompt.test.ts` (NEW or extend)

#### TDD
- `test_prompt_declares_durable_fact_contract`: `SYSTEM_PROMPT.includes('atomic')` AND
  `includes('third person')` AND `includes('declarative')` → true. Fails today (absent) → RED.
- `test_prompt_has_question_to_empty_fewshot`: the composed prompt contains a few-shot whose input is
  a question and whose `memory` output is `[]` → assert the substring present. RED today.
- `test_prompt_language_block_unchanged`: the language/accent directive substring is still present
  (regression guard) → true.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- `grep -c 'atomic' prompt.ts` ≥ 1 AND the composed prompt contains ≥ 4 few-shot examples
  (assertable by counting `Input:`/example markers in the test).
- `wc -l packages/core/src/domain/extraction/prompt.ts` ≤ 300.

#### DoD
`pnpm --filter @usetheo/memory exec vitest run src/domain/extraction/prompt.test.ts` exits 0;
`npm run typecheck` exits 0.

### T1.2 — Narration is SPLIT into atomic facts (behavior, stub LLM)

#### Why this step
The mega-dump is the worst symptom; prove the pipeline yields multiple atomic rows when the LLM (per
the new prompt) returns multiple facts.

#### Files to edit
- `packages/core/src/domain/extraction/extraction-fact-quality.test.ts` (NEW)

#### TDD
- `test_narration_splits_into_three_rows`: stub LLM emits 3 atomic third-person facts → pipeline
  persists exactly 3 items, `every(len(text) < 200)` → true. RED before wiring, GREEN after.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
`result.length === 3` AND `result.every(r => r.text.length < 200)` asserted.

#### DoD
The new test file exits 0 under vitest.

## Phase 2 — Deterministic backstop gate

### T2.1 — `fact-gate.ts` drops interrogative / first-person items (infer:true)

#### Why this step
Belt-and-suspenders for prompt misses (ADR-2). A pure, testable filter; no I/O.

#### Files to edit
- `packages/core/src/domain/extraction/fact-gate.ts` (NEW, < 80 LoC)
- `packages/core/src/domain/extraction/fact-gate.test.ts` (NEW)
- `packages/core/src/domain/extraction/pipeline.ts` (ONE-line wire, infer:true branch only)
- `packages/core/src/domain/memory-event.ts` (add `extraction_fact_gate_dropped`)

#### TDD
- `test_gate_drops_interrogative`: `factGate([{text:'Quer que eu prossiga…?'}]).length === 0`. RED
  (module absent).
- `test_gate_keeps_declarative`: `factGate([{text:'user prefers dark roast'}]).length === 1`.
- `test_gate_drops_first_person_opener`: `factGate([{text:'Minha recomendação: X'}]).length === 0`.
- `test_gate_emits_audit_event`: a drop emits `extraction_fact_gate_dropped` (spy on the tracer).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
Gate unit exits 0; `git diff --stat pipeline.ts` shows ≤ 3 added lines; the event union typechecks.

#### DoD
`vitest run src/domain/extraction/fact-gate.test.ts` exits 0; `npm run typecheck` exits 0.

### T2.2 — `infer:false` verbatim path is byte-identical

#### Why this step
ADR-2 — the verbatim contract callers rely on must not regress.

#### Files to edit
- `packages/core/src/domain/extraction/infer-false-path.test.ts` (extend)

#### TDD
- `test_inferfalse_stores_question_verbatim`:
  `remember('Quer que eu prossiga…?', {infer:false})` stores the row unchanged (gate NOT applied).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
Stored row text equals the input exactly; existing infer:false tests remain green.

#### DoD
`vitest run src/domain/extraction/infer-false-path.test.ts` exits 0.

### T2.3 — Parse robustness: object-shaped fact coerced to string

#### Why this step
mem0 `normalize_facts` parity — smaller LLMs return `{fact:"x"}`; do not crash/drop.

#### Files to edit
- `packages/core/src/domain/extraction/pipeline-helpers.ts` + its test

#### TDD
- `test_object_shaped_fact_coerced`: a draft `{fact:'x'}` resolves to the string `'x'` in the
  persisted item. RED before coercion.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
Persisted `text === 'x'`; no throw.

#### DoD
The helper test exits 0.

## Phase 3 — Kit hook honesty

### T3.1 — Fix stale comment + set `infer:true` explicitly

#### Why this step
The hook comment lies ("server stores infer=false verbatim"); make intent explicit.

#### Files to edit
- `docs/claude-code-kit/hooks/theo-remember.mjs` + `theo-remember.test.mjs`

#### TDD
- `test_payload_sets_infer_true`: `buildRememberPayload(...).body.infer === true`. RED (absent).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
`body.infer === true`; the stale comment string is gone (asserted absent in source).

#### DoD
`node --test theo-remember.test.mjs` exits 0.

## Phase 4 — One-shot cleanup of existing pollution

### T4.1 — Cleanup command (dry-run → soft-delete/re-distill, audit)

#### Why this step
The user is staring at polluted rows; ADR-3 makes cleanup reversible + auditable.

#### Files to edit
- `packages/core/src/application/cleanup-write-quality.ts` (NEW) + its test + CLI wiring

#### TDD
- `test_dryrun_reports_without_mutation`: seed 3 polluted + 2 clean rows → dry-run returns the 3 ids,
  DB row count unchanged.
- `test_apply_soft_deletes_polluted_only`: apply → the 3 polluted rows have `t_invalid` set, the 2
  clean rows untouched; a per-item audit event exists.

#### Concurrency tests
(none — single-threaded)

#### Failure scenarios
One row fails re-distill → skipped with an audit event, run continues (asserted).

#### Acceptance criteria
Integration against real `ankane/pgvector:v0.5.1`: dry-run lists exactly 3; apply soft-deletes
exactly 3; 2 intact; audit events present.

#### DoD
`vitest run --config vitest.integration.config.ts` for the cleanup test exits 0.

## Phase 5 — Surface `attributed_to` (theo-memory REST side)

### T5.1 — Scopes-memories list response includes `attributed_to`

#### Why this step
DoD bullet 4; the theo-cloud dashboard column + gateway passthrough is the cross-repo companion.

#### Files to edit
- `packages/api/src/server/handlers/scopes.ts` + its test

#### TDD
- `test_scopes_list_includes_attributed_to`:
  `GET /v1/scopes/user/:id/memories` → each item has an `attributed_to` field (from the stored
  column / `MemoryItem.metadata` per `_attributed-peer.ts`). RED (absent today).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
Response items each contain `attributed_to`; OpenAPI/schema documents the field.

#### DoD
`vitest run` for the scopes handler test exits 0.

## Phase 6 — Benchmark (the objective DoD number)

### T6.1 — M21 eval extraction-stage parity metric

#### Why this step
ADR-4: the DoD closes on a measured number, not opinion.

#### Files to edit
- `packages/eval/src/stages/extraction/run.ts` (metric + fixture) + `docs/benchmarks/`

#### TDD
- `test_single_fact_ratio_computed`: given a labeled set (`['user prefers X', 'Quer prosseguir?']`),
  the ratio function returns `0.5`. RED before the metric exists.

#### Concurrency tests
(none — single-threaded)
pre-existing and scope-isolated, not introduced here.)

#### Failure scenarios
Eval LLM 5xx on one example → `runSafely` scores it a miss (existing harness), run continues.

#### Acceptance criteria
`docs/benchmarks/m27-write-quality-vs-mem0.md` records the ratio over ≥ 3 runs (mean ± std) ≥ 0.90.

#### DoD
The metric unit test exits 0 AND the benchmark artifact exists with the number.

## Phase 7 — Integration Validation (final)

### T7.1 — Full chain green + benchmark evidence

#### Why this step
The "eat your own cooking" gate — the milestone is not done until the whole chain proves it.

#### Files to edit
- `CHANGELOG.md` (Unreleased) + the benchmark artifact

#### TDD
- N/A (aggregation gate) — runs `run_validation.py memory-write-quality-mem0-parity`.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
`run_validation.py memory-write-quality-mem0-parity` exits 0; `/code-quality` verdict ∈
{PASS, PASS_WITH_CAVEATS}; benchmark artifact present with the parity number ≥ 0.90;
`npm run typecheck` + `npm run lint` exit 0.

#### DoD
All of the above true; CHANGELOG `[Unreleased]` updated.

## Global Definition of Done

- Every Phase task exits 0 (unit + integration real pgvector).
- `infer:false` verbatim byte-identical (T2.2 proof).
- Parity metric ≥ 0.90 recorded with ≥ 3 runs (benchmark evidence).
- `pipeline.ts` not grown; `prompt.ts` ≤ 300 LoC.
- CHANGELOG updated; typecheck + lint exit 0; `/code-quality` + `/review` pass.

## Drawbacks & Risks

| # | Risk | Severity | Mitigation | Owner |
|---|---|---|---|---|
| R1 | Over-filtering (false negatives): the prompt/gate drops a legitimate conversationally-phrased fact. | HIGH | T6.1 eval measures recall of a labeled fact-set; gate threshold config-overridable; gate is conservative (only clear interrogatives / first-person openers). | memory-core |
| R2 | Language regression: new English few-shot biases non-English inputs to English. | MED | Keep the language directive at highest priority; add a Portuguese few-shot line; a PT-input test asserts a PT fact out. | memory-core |
| R3 | Cleanup data loss: soft-delete a legitimate row. | MED | Dry-run first, `t_invalid` reversible, per-item audit event, never hard-delete (ADR-3). | memory-core |

## Unresolved Questions

- Q1: The theo-cloud dashboard column + gateway passthrough (DoD bullet 4 UI half) is cross-repo;
  this plan delivers the theo-memory REST field (T5.1) and the theo-cloud UI is a companion PR done
  against the `../theo-cloud` sibling during implement — noted, not silently dropped.
