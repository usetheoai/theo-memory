---
slug: write-side-speaker-attribution
milestone_id: M29
created_at: 2026-07-27
goal: Parametrize the extraction speaker token by attributedTo so assistant first-person speech is stored as the `assistant` subject (never `user`), measured by an A/B benchmark reaching mem0 attribution parity, with the infer:false verbatim path byte-identical.
---

# Plan: Write-side speaker attribution (#160) · M29

## Goal

When a turn is `attributedTo:'assistant'`, the extraction MUST represent the first-person
speaker as the entity `assistant` (fact/entity/relation subject), NEVER `user` — proven by
an A/B benchmark where the assistant-attribution rate reaches parity with mem0 on a mixed
transcript, while the `infer:false` verbatim path stays byte-identical.

## Context

Dogfound defect #160. Root cause is single-layer: `packages/core/src/domain/extraction/prompt.ts`
hardcodes the first-person speaker as the literal entity `user` (lines 48-50, 67-70, 73, 196),
ignoring `attributedTo`. The kit posts the assistant Stop summary with `attributedTo:'assistant'`
and `infer:true`; the extraction then stores "user analisou X" for what the assistant did.
Grounded in the community reference mem0 (`.claude/knowledge-base/references/mem0`): `parse_messages`
(utils.py:61) role-labels every line; `ADDITIVE_EXTRACTION_PROMPT` mandates "Attribute correctly:
use 'User' for user-stated facts, frame assistant content appropriately" + `attributed_to` per fact;
`AGENT_CONTEXT_SUFFIX` frames agent actions as "Agent recommended [X]". Empirical A/B this session:
mem0 stored "**Assistant** evaluated…" vs theo-memory "**user** analisou…" for the SAME actions.
The `attributed_to` COLUMN is already correct (pipeline.ts:315-321, M26 fix) — only the human-readable
fact TEXT / entity subject is wrong.

## Baseline Context

### Files that will be touched

| File | LoC today | Last sha | Role |
|---|---|---|---|
| `packages/core/src/domain/extraction/prompt.ts` | 244 | 4a64b4b | speaker token hardcoded `user` (48-50, 73, 196) — primary fix (parametrize by speaker) |
| `packages/core/src/domain/extraction/pipeline.ts` | ~450 | 6580682 | derive speaker from `options.attributedTo`, pass into prompt gen |
| `packages/core/src/domain/extraction/prompt_test.ts` | (exists) | — | RED unit test: speaker='assistant' → prompt contains assistant-speaker directive |
| `packages/core/src/domain/extraction/pipeline*_test.ts` | (exists) | — | RED: attributedTo:'assistant' produces assistant-subject facts (stubbed LLM) |
| `packages/eval/src/stages/extraction/write-quality.ts` | (exists) | — | A/B metric: assistant-attribution ratio + mixed-transcript fixture |
| `CHANGELOG.md` | — | — | Unbreakable Rule 6 |

### Current callers / dependents

- `generateAdditiveExtractionPrompt` (`prompt.ts:166`) — ONLY producer of the extraction system
  prompt; called by `runExtractionPipeline` (`pipeline.ts:109`).
- `runExtractionPipeline` (`pipeline.ts:52`) already reads `options.attributedTo` (`pipeline.ts:315`)
  and writes the `attributed_to` column (`pipeline.ts:321`). The speaker token is NOT yet threaded
  into `generateAdditiveExtractionPrompt`.
- `infer:false` branch (`pipeline.ts:75`) → `runInferFalsePath` — MUST stay untouched (verbatim).

### Domain glossary

- **Speaker token** — the entity name used for the first-person author of a message in `entities`/
  `relations`/`memory[].text`. Today always `user`; this plan makes it `assistant` when
  `attributedTo:'assistant'`.
- **Prefix-override** — the established pattern (prompt.ts:125 comment) where a high-priority prefix
  line overrides a default rule baked into `SYSTEM_PROMPT` (used already for ontology + language).

### Architecture boundaries affected

Domain-only (`packages/core/src/domain/extraction`). Pure, no I/O. No inner→outer import. REST/kit
unchanged (the kit already sends `attributedTo:'assistant'`).

## Prior Art & Related Work

- mem0 `parse_messages` (utils.py:61), `ADDITIVE_EXTRACTION_PROMPT` + `AGENT_CONTEXT_SUFFIX`
  (`configs/prompts.py`) — the community discipline being ported.
- M27 (`write-side` fact quality) — the prompt-discipline precedent; M28 (#157) — the recall-side
  speaker-alias, the write/recall pair this closes.
- Empirical A/B this session (mem0 store vs theo-memory store, same actions) — the regression oracle.

## ADRs

### ADR-1 — Parametrize via a high-priority speaker-prefix, not a SYSTEM_PROMPT rewrite

Add a `speaker: 'user'|'assistant'` param to `generateAdditiveExtractionPrompt`; when `assistant`,
prepend a speaker-directive prefix that overrides the default `user` speaker (same mechanism the
ontology/language prefixes already use, prompt.ts:125). **Alternatives rejected:** (a) rewrite
`SYSTEM_PROMPT` as a function of speaker — larger diff, touches the whole prompt, higher regression
surface; (b) post-process the fact text (regex `user`→`assistant`) — corrupts legitimate `user`
facts inside an assistant turn. Cites `parsimony-ladder.md` (minimal change, reuse existing pattern).

### ADR-2 — Speaker derived from `attributedTo`, default `user`

`speaker = options.attributedTo === 'assistant' ? 'assistant' : 'user'`. Preserves every existing
caller (no attributedTo, or user-attributed → `user`, unchanged). **Alternative rejected:** infer
speaker from message role heuristically — the kit already declares `attributedTo` authoritatively
(M26); re-inferring would fight the authoritative signal.

### ADR-3 — infer:false stays byte-identical

The verbatim path (ADR-0001 escape hatch) does not extract, so no speaker token applies.
**Alternative rejected:** none — touching it would break the verbatim contract.

## Dependencies

(none — no new runtime dependency. Reuse installed `zod` + the existing extraction pipeline +
`@usetheo/memory-eval`. Parsimony ladder rung 4.)

## Failure scenarios

The extraction pipeline calls an external LLM (external I/O).

- **LLM ignores the speaker prefix** — the benchmark measures the assistant-attribution ratio over
  ≥ 3 runs; a prefix that does not move the ratio fails the DoD (RED-first proves the gap exists).
- **LLM timeout / 5xx** — unchanged: `runExtractionPipeline` per-row fallback + `extraction_zero_facts`
  event already handle it; the speaker prefix is a prompt-string change with no new failure mode.
- **attributedTo absent / user** — speaker defaults to `user`; identical to today (no regression).

## Coverage Matrix

| Requirement (DoD / blueprint rec) | Task |
|---|---|
| speaker='assistant' → prompt carries assistant-speaker directive (RED-first) | T1.1 |
| attributedTo:'assistant' → facts/entities use `assistant` subject, not `user` (RED-first) | T1.2 |
| pipeline threads speaker from options.attributedTo | T1.2 |
| user-attributed / no-attributedTo → `user` unchanged (no regression) | T1.3 |
| infer:false verbatim byte-identical | T2.1 |
| A/B benchmark: assistant-attribution ratio at mem0 parity, ≥3 runs | T3.1 |
| Full suite green + typecheck + lint + CHANGELOG | T4.1 |

## Phase 1 — Speaker parametrization (primary fix)

### T1.1 — `generateAdditiveExtractionPrompt` accepts `speaker`, emits assistant-speaker directive

#### Why this step
The prompt is the only place the speaker token is decided. Adding a high-priority prefix (the
established override mechanism) is the minimal change that flips the speaker to `assistant` without
rewriting the trusted SYSTEM_PROMPT. Reasoning: mem0's discipline lives entirely in the prompt;
mirroring it here keeps the fix in one layer (ADR-1).

#### Files to edit
- `packages/core/src/domain/extraction/prompt.ts`
- `packages/core/src/domain/extraction/prompt_test.ts`

#### TDD
- RED: `test_generateAdditiveExtractionPrompt_assistant_speaker_directive` — call with `speaker:'assistant'`;
  assert the prompt string contains an assistant-speaker directive (entity named `assistant`, frame
  self-statements as `assistant`/`Agent`) AND does NOT instruct the default `user` speaker for self-statements.
- RED: `test_generateAdditiveExtractionPrompt_default_user_unchanged` — call without speaker (or `'user'`);
  assert the prompt is byte-identical to the current output (no assistant directive).

#### Acceptance criteria
- New optional param `speaker?: 'user'|'assistant'` (default `'user'`); assistant path prepends the directive; user/default path unchanged.

#### DoD
- `pnpm --filter @usetheo/memory run build && pnpm vitest run prompt_test` green.

### T1.2 — pipeline threads `speaker` from `options.attributedTo`; assistant-subject facts

#### Why this step
`runExtractionPipeline` already owns `options.attributedTo` (pipeline.ts:315). Deriving the speaker
there and passing it to the prompt is the wiring that turns the T1.1 capability into observed behavior
end-to-end (ADR-2).

#### Files to edit
- `packages/core/src/domain/extraction/pipeline.ts`
- `packages/core/src/domain/extraction/pipeline` integration test (stubbed LLM)

#### TDD
- RED: with a stubbed LLM echoing the prompt/role, `runExtractionPipeline({attributedTo:'assistant'})`
  yields facts/entities whose subject is `assistant`, not `user`. Current code fails (emits `user`).
- GREEN: `generateAdditiveExtractionPrompt(..., speaker)` where `speaker = attributedTo==='assistant' ? 'assistant' : 'user'`.

#### Acceptance criteria
- The prompt passed to the LLM for an assistant turn contains the assistant directive; user turns do not.

#### DoD
- Integration test green vs stubbed LLM.

### T1.3 — regression guard: user-attributed unchanged

#### Why this step
The fix must not degrade genuine user facts (they must stay `user`). This is the R1 mitigation.

#### Files to edit
- `packages/core/src/domain/extraction/pipeline` test

#### TDD
- RED/GREEN: `runExtractionPipeline({attributedTo:'user'})` and `{}` (no attributedTo) → speaker `user`, subject `user` (unchanged from baseline).

#### DoD
- Test green; no diff in user-attribution behavior.

## Phase 2 — Verbatim invariant

### T2.1 — infer:false byte-identical

#### Why this step
Guard the ADR-0001 verbatim contract (ADR-3).

#### Files to edit
- `packages/core/src/domain/extraction/infer-false-path` test (assert unchanged)

#### TDD
- `runExtractionPipeline({infer:false})` output byte-identical to baseline (speaker param never reaches this branch).

#### DoD
- Existing infer:false tests still green; no new behavior.

## Phase 3 — A/B benchmark (mem0 parity oracle)

### T3.1 — assistant-attribution ratio metric + mixed-transcript fixture

#### Why this step
DoD closes on a measured ratio, not subjective review (mem0-parity discipline). RED-first: the current
transcript produces `user <verb>` for assistant actions.

#### Files to edit
- `packages/eval/src/stages/extraction/write-quality.ts`
- `docs/benchmarks/m29-speaker-attribution-vs-mem0.md`

#### TDD
- RED: metric `assistantAttributionRatio(fixture)` on a mixed user+assistant transcript is low pre-fix
  (assistant actions land as `user`); post-fix reaches parity (assistant actions → `assistant`), ≥ 3 runs, real LLM.

#### Acceptance criteria
- Benchmark doc filled with measured pre/post ratios + mem0 comparison.

#### DoD
- `pnpm --filter @usetheo/memory-eval run <stage>` green; benchmark doc committed.

## Phase 4 — Integration validation

### T4.1 — full suite + gates + CHANGELOG

#### Why this step
The "eat your own cooking" gate.

#### Files to edit
- `CHANGELOG.md`

#### TDD
- `pnpm -w build && pnpm -w test && pnpm -w typecheck && pnpm -w lint` (or per-package equivalents) green.

#### DoD
- All gates green; CHANGELOG `[Unreleased] § Fixed` updated.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Speaker prefix degrades genuine user-fact extraction | HIGH | T1.3 regression guard + A/B measures both user and assistant facts; neither may regress | impl |
| LLM inconsistently honors the assistant directive | MED | ≥3-run benchmark measures the ratio; prefix uses the same high-priority mechanism ontology already relies on | impl |
| Over-suppression of facts embedded in assistant actions | LOW | scope kept to speaker attribution (not meta-extraction) this milestone; embedded facts still extracted, only the subject changes | impl |

## Unresolved Questions

- No-meta-extraction / no-echo-extraction (mem0 discipline) is a NATURAL follow-up but OUT OF SCOPE
  here (YAGNI — this milestone fixes the confirmed #160 attribution defect; meta-extraction is a
  separate, lower-severity noise reduction). Tracked as a candidate M30 if dogfooding shows residual noise.

## Concurrency tests

(none — single-threaded; pure prompt-string + pipeline transformation, no shared mutable state.)
