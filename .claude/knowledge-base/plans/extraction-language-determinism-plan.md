---
slug: extraction-language-determinism
milestone_id: ExtractionLanguageDeterminism
created_at: 2026-06-23
goal: Pin the extraction prompt so the persisted memory[].text fact is emitted in the SAME language as the input (never translated), extending the existing source-language rule that already covers entity names + relation labels, measured by a real-LLM GOAL where a Portuguese input persists a Portuguese fact and an English input persists an English fact.
---

# Plan: extraction-language-determinism

> **Version 1.1** — EG-4 of the entity-graph-dogfood-remediation-roadmap. v1.1 absorbs the `/edge-case-plan` SHOULD-TEST EC-1 (robust anti-flake GOAL assertion: stems + word-boundary absent-translation; non-cognate inputs). See `.claude/knowledge-base/reviews/extraction-language-determinism-edge-cases-2026-06-23.md` (0 MUST FIX). The 2026-06-23 dogfood showed the write pipeline storing facts in a non-deterministic language: `"i live in Lisbon"` (EN input) was stored as `"user mora em Lisboa"` (translated to PT), while `"My name is Paulo and I work as a software engineer"` stayed EN. ROOT CAUSE (investigated): the extraction SYSTEM_PROMPT's `LANGUAGE:` rule pins ONLY entity names + relationship labels to the source language ("Emit every entity name AND every `relationship` label in that SAME language/script — NEVER translate"); it says NOTHING about the `memory[].text` FACT, so the LLM freely translates the fact text. This plan extends the SAME source-language-preservation rule to the fact `text` (option b, consistent with the shipped entity/relation rule). Scope: `packages/core` — a prompt clause + a deterministic prompt unit test + a real-LLM GOAL. ZERO new dependency, NO migration, NO DIP widening, NO public-export change.

## Goal

> "Enable the extraction prompt to pin the persisted `memory[].text` fact to the SAME language/script as the input (never translate) — extending the existing source-language rule that already covers entity names + relation labels — measured by `tests/integration/extraction-language-determinism.test.ts` (REAL OpenAI) where `remember()` of a Portuguese sentence persists a fact that stays Portuguese (contains a PT content token, NOT its English translation) and an English sentence persists an English fact."

## Context

EG-4 of `.claude/knowledge-base/roadmaps/entity-graph-dogfood-remediation-roadmap.md`. Evidence: a PT/EN inconsistency in the stored fact text + the Graph edge labels were PT while some facts were EN. The entity/relation labels are ALREADY pinned to the source language (`prompt.ts:61-66`, shipped with the entity-relation slices), which is why the Graph showed PT edges ("ama", "planeja uma viagem para"). The gap is ONLY the `memory[].text` fact, which has no language directive and drifts.

Mixed-language fact storage hurts (a) dedup (the MD5 hash of "i live in Lisbon" ≠ "user mora em Lisboa" → the same fact asserted twice in different languages would not dedup), (b) semantic-recall consistency (query-vs-fact language mismatch lowers cosine), and (c) the user-visible Memories tab (facts flip language unpredictably). The fix is a single prompt clause extending the established rule. Honors Princípio 2 (priorização/diversidade — consistent facts dedup correctly) + Princípio 3 (the behavior is testable against a real LLM, not hand-waved).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/extraction/prompt.ts` | 179 | `ef61073` (2026-06-22) | composes the extraction SYSTEM_PROMPT + Zod schema; the `LANGUAGE:` clause (`:61-66`) pins entity/relation language | the existing entity/relation language rule UNCHANGED; the "user" speaker exception kept; JSON output format unchanged; diacritic-preservation kept; ontology/custom-instruction prefixes unchanged |
| `packages/core/src/domain/extraction-prompt.test.ts` | ~80 | `ef61073` (2026-06-22) | unit tests for `escapeMarkdownHeaders` + `generateAdditiveExtractionPrompt` structure | existing assertions stay green |
| `tests/integration/extraction-language-determinism.test.ts` (NEW) | 0 | — | (file to be created) — real-LLM GOAL: PT input → PT fact, EN input → EN fact | — |

### Current callers / dependents

- **Symbol:** `SYSTEM_PROMPT` (module const in `prompt.ts`) — consumed by `generateAdditiveExtractionPrompt` (`prompt.ts:120+`), which the write pipeline calls (`extraction/pipeline.ts:369` → `deps.llm.generateResponse({ role: 'system', content: prompt })` `:377-380`).
  - **Callers (production):** the write pipeline Phase 2 extraction (`pipeline.ts`).
  - **Callers (tests):** `extraction-prompt.test.ts`.
  - **External (other repos):** NO — the prompt is package-internal; consumers see only `remember()` behavior.
- **Symbol:** `OpenAILLM` (`@usetheo/memory/llms/openai`) — env-based real LLM (`OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_CHAT_MODEL`), constructed no-arg. The GOAL wires it for the real-LLM assertion.

### Domain glossary

- **fact text (`memory[].text`)** — the canonical fact string the LLM extracts and the pipeline persists (then MD5-hashed for dedup). This is what drifts language today.
- **source-language preservation** — the rule (already applied to entity/relation labels) that the LLM must emit in the input's language, never translating. EG-4 extends it to the fact text.
- **the "user" exception** — the speaker is always the literal token `user` regardless of input language (the one allowed non-source-language token); unchanged by EG-4.

### Architecture boundaries affected

- **`packages/core/src/domain/extraction`** — a prompt-string change only. No type/contract/DIP change (ADR-0008 untouched), no new export, no migration. The pipeline + schema are unchanged.

## Prior Art & Related Work

- **Internal precedent:** the existing `LANGUAGE:` clause in `prompt.ts:61-66` (entity/relation source-language rule, shipped with the entity-relation-extraction slices). EG-4 mirrors its phrasing for the fact text.
- **Reference:** `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/prompts/` (the Mem0 reference prompt our extractor was derived from).
- **Roadmap:** `.claude/knowledge-base/roadmaps/entity-graph-dogfood-remediation-roadmap.md § EG-4`.
- **Composes with:** EG-2 (v0.20.1) + EG-3 (v0.20.2) — the same write pipeline.

## Objective

- [ ] SYSTEM_PROMPT pins `memory[].text` to the source language (never translate), extending the existing entity/relation rule.
- [ ] A deterministic prompt unit test asserts the fact-language clause is present.
- [ ] Real-LLM GOAL: PT input → PT fact (not translated); EN input → EN fact.
- [ ] The existing entity/relation language rule + the "user" exception + the JSON format are unchanged.

## ADRs

### D1 — Preserve the SOURCE language of the fact text (NOT force English)
- **Decision:** extend the `LANGUAGE:` clause so the `memory[].text` fact is emitted in the SAME language/script as the input, never translated/transliterated — identical to the rule already governing entity names + relation labels.
- **Rationale:** consistency with the shipped entity/relation rule (a fact and its extracted entities/edges should be ONE language, not a fact in EN with PT edges); preserves the user's language (least surprising in the Memories tab); keeps dedup stable (the same fact in the same language hashes equally). One prompt clause, zero structural change (KISS).
- **Alternatives considered:** (a) force ALL output to canonical English — REJECTED: contradicts the already-shipped entity/relation source-language rule (would require ALSO changing that, a bigger breaking change), discards the user's language, and re-introduces the very translation the dogfood flagged as wrong (`Lisbon`→`Lisboa` was a translation; forcing EN would translate PINGS the other way). (b) add a config knob for output language — REJECTED: YAGNI; no consumer asked for it; one deterministic rule is simpler.
- **Consequences:** facts stay in the input language; multilingual deployments get consistent fact+entity+edge language. The dedup hash is now stable per source language. No schema/type change.

### D2 — Validate the behavior with a REAL LLM (the correctness is LLM-behavioral)
- **Decision:** the GOAL test uses a REAL OpenAI LLM (`OpenAILLM`, gated `skipIf` no `OPENAI_API_KEY`); a deterministic prompt unit test guards the structural clause for CI without a key.
- **Rationale:** whether the LLM HONORS the language instruction is a property of the LLM following the prompt — a stub/mock cannot prove it (Inquebrável Rule 3: a mock GOAL here would be theater). Per the project rule "NEVER mock — use a real LLM for the GOAL". The deterministic unit test still gives CI a structural guarantee (the clause exists) when no key is present.
- **Alternatives considered:** stub LLM echoing a fixed fact — REJECTED: proves nothing about prompt-following (vacuous). 
- **Consequences:** the GOAL runs only where `OPENAI_API_KEY` is set (local / keyed CI); the unit test is the always-on guard. Real-LLM variance mitigated by a robust language assertion (PT content token present AND its EN translation absent) on a clear input.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Real-LLM GOAL is non-deterministic (could flake) | Medium | `skipIf` no key (never blocks CI without a key); assert a ROBUST language property (PT content token present AND obvious EN translation absent) on a clear unambiguous input; one case per language to minimize surface | core |
| The LLM may still occasionally translate despite the instruction | Low | The instruction mirrors the entity/relation rule which the dogfood showed the LLM DOES honor (PT edges were preserved); the unit test guarantees the clause is present even if a future model drifts | core |
| Changing the prompt could perturb other extraction behavior (entities/relations/ids) | Low | The change is ADDITIVE (one clause appended to LANGUAGE); existing prompt-structure unit tests + the full extraction suite guard against regression | core |

## Unresolved Questions

- Q1 — Should existing pre-EG-4 mixed-language facts be re-normalized? NO — historical rows are immutable (ADD-only); EG-4 fixes go-forward extraction only. Out of scope (consistent with the EC-1 no-backfill precedent of v1.1).
- Q2 — Should recall queries also be language-pinned? Recall embeds the raw query as-is (no extraction); cross-language recall is a separate semantic concern, not this fact-language fix. Out of scope.

## Dependencies

**(none — ZERO new dependency.)** A prompt-string change + tests. The GOAL uses the already-shipped `OpenAILLM` (`@usetheo/memory/llms/openai`) + the `openai` dep that already backs it. No npm change, no version pin, no registry fetch.

## Dependency Graph

```
Phase 1 (prompt clause + deterministic unit test) ──▶ Phase 2 (real-LLM GOAL + full gate)
```

---

## Phase 1: Pin the fact-text language

**Objective:** the SYSTEM_PROMPT instructs the LLM to keep the fact text in the source language; a unit test guards it.

### T1.1 — Extend the LANGUAGE clause to cover `memory[].text`

#### Objective
Add a sentence to the `LANGUAGE:` block so the `memory[].text` fact is emitted in the input's language, never translated.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — appends to the existing `LANGUAGE:` clause in `SYSTEM_PROMPT` (`prompt.ts`) a directive that the `memory[].text` fact MUST also be in the source language (never translated/transliterated), with a concrete example; adds a `extraction-prompt.test.ts` assertion that the prompt contains the fact-language directive.
2. **Why it is necessary now** — per D1 this is the single locus of the divergence; the entity/relation rule is already there (`:61-66`) but the fact text is uncovered. Cite root cause `prompt.ts:61-66` (covers entity/relation only).

#### Evidence
- `prompt.ts:61-66` — the LANGUAGE clause: "Emit every entity name AND every `relationship` label in that SAME language/script — NEVER translate". No mention of `memory[].text`.
- Dogfood: `"i live in Lisbon"` → stored `"user mora em Lisboa"` (fact translated EN→PT).

#### Files to edit
```
packages/core/src/domain/extraction/prompt.ts — extend the LANGUAGE clause in SYSTEM_PROMPT to cover memory[].text fact
packages/core/src/domain/extraction-prompt.test.ts — RED: assert SYSTEM_PROMPT pins the fact text language
```

#### Deep file dependency analysis
- `prompt.ts` (Baseline row, sha `ef61073`) — `SYSTEM_PROMPT` const gains one sentence in the LANGUAGE block. `generateAdditiveExtractionPrompt` + schema unchanged. Downstream: the pipeline passes the longer prompt verbatim; no code change.
- `extraction-prompt.test.ts` — add one assertion on the prompt string (deterministic, no LLM).

#### Deep Dives
- **Exact change:** in the LANGUAGE block, add: "This applies to the `memory[].text` fact too: write each fact in the SAME language as the input — NEVER translate it (an English input yields an English fact; a Portuguese input yields a Portuguese fact). The literal token \"user\" remains the only allowed exception."
- **Invariant:** the entity/relation rule + the "user" exception + JSON format + diacritic rule are unchanged (the addition is appended, not a rewrite).
- **Edge case:** mixed-language input (rare) — the LLM picks the dominant language; acceptable (not worse than today). Not asserted.

#### Pseudo-code / Signatures
```pseudocode
SYSTEM_PROMPT LANGUAGE block (after the existing entity/relation sentences) gains:
  "memory[].text MUST be in the SAME language as the input — NEVER translate
   (EN input -> EN fact; PT input -> PT fact). 'user' is the only exception."
# generateAdditiveExtractionPrompt + AdditiveExtractionSchema unchanged.
```

#### Tasks
1. RED: add `extraction-prompt.test.ts` assertion that the prompt contains the fact-language directive (e.g. matches /memory\[\]\.text.*SAME language/i or the specific phrase).
2. Append the clause to SYSTEM_PROMPT. GREEN.
3. REFACTOR: none expected.

#### TDD
```
RED:  it("SYSTEM_PROMPT pins the memory[].text fact to the source language") — generateAdditiveExtractionPrompt([],[{role:'user',content:'x'}]).prompt matches the fact-language directive AND still contains the entity/relation language rule (no regression)
GREEN: append the clause
REFACTOR: None expected
VERIFY: npx vitest run packages/core/src/domain/extraction-prompt.test.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — a pure string composition; no async, no shared state.

#### Acceptance Criteria
- [ ] `SYSTEM_PROMPT` `contains` the fact-language directive — `npx vitest run packages/core/src/domain/extraction-prompt.test.ts` `exit code 0`.
- [ ] The existing entity/relation LANGUAGE rule + "user" exception still `present` (no regression) — same test asserts both.
- [ ] Pass: complexity `<= 10`; coverage `>= 90` on changed lines (`npx vitest run --coverage`); `npm run lint` `exit code 0`; size `<= 500`.

#### DoD
- [ ] Tests green — `npx vitest run packages/core/src/domain/extraction-prompt.test.ts`
- [ ] Zero type errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Fact text language non-deterministic (translated) | T1.1 | LANGUAGE clause extended to `memory[].text` |
| 2 | Structural guarantee in CI without a key | T1.1 | deterministic prompt unit test |
| 3 | No regression to entity/relation language rule | T1.1 | unit test asserts both rules present |
| 4 | Real-LLM proof (PT→PT, EN→EN) | T2.1 | GOAL vs real OpenAI |

**Coverage: 4/4 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npx vitest run` (contract) green
- [ ] Zero type errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected (per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased] § Fixed`
- [ ] Backward compatibility preserved (no new export; schema/types unchanged)
- [ ] No paper names in `src/**`
- [ ] Plan-specific: real-LLM GOAL green (PT→PT, EN→EN) when `OPENAI_API_KEY` set
- [ ] **Plan archived** — after `/review` READY_TO_MERGE + PR merged, move to `knowledge-base/plans/completed/`

## Failure scenarios

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| OpenAI chat API (real LLM, GOAL) | API unavailable / no key | `skipIf(OPENAI_API_KEY unset)` skips the GOAL | GOAL skips cleanly (never a false red); the deterministic prompt unit test still guards the clause |
| OpenAI returns a translated fact despite the instruction | model drift | the GOAL asserts the language property; a failure surfaces honestly (not masked) | the GOAL fails loudly → prompt needs strengthening (no silent pass) |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** prove a real LLM honors the fact-language rule.

### T2.1 — Real-LLM GOAL: PT input → PT fact, EN input → EN fact

#### Objective
Against a REAL OpenAI LLM + real pgvector, `remember()` of a PT sentence persists a PT fact (not translated to EN), and an EN sentence persists an EN fact.

#### Files to edit
```
tests/integration/extraction-language-determinism.test.ts — NEW: skipIf(no OPENAI_API_KEY OR no THEOMEM_PG_URI); OpenAILLM real; remember PT + EN; assert stored fact language
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — sequential remember()→getAll() assertions; only the real OpenAI + pgvector I/O is async.

#### TDD
```
RED:  it("a Portuguese input persists a Portuguese fact (not translated)") — remember("Eu trabalho como engenheiro mecânico") → over the lowercase-CONCATENATED fact texts: matches the stem /trabalh/ (covers trabalho/trabalha) AND /engenheiro/, AND does NOT match the EN translation word-boundary regexes /\bworks?\b/ NOR /\bengineer\b/ (EC-1 anti-flake: stems survive rephrasing; word-boundary absent-translation proves no EN drift; "mecânico" avoids the "software" cognate per EC-2)
RED:  it("an English input persists an English fact") — remember("My favorite hobby is hiking on weekends") → concatenated facts match /\bhik/ AND do NOT match the PT translation /caminha|trilha/ (stays EN)
GREEN: passes once T1.1 ships the clause
REFACTOR: None expected
VERIFY: OPENAI_API_KEY=... npx vitest run -c vitest.integration.config.ts tests/integration/extraction-language-determinism.test.ts --no-file-parallelism
```

Per the project rule: REAL LLM (`OpenAILLM`), `skipIf` no `OPENAI_API_KEY`. Robust assertion (content-token present AND obvious cross-language translation absent) on clear single-language inputs to minimize variance.

### Execution
```
npm run typecheck
npm run lint
npx vitest run packages/core/src/domain/extraction-prompt.test.ts   # deterministic prompt unit
OPENAI_API_KEY=... THEOMEM_PG_URI=... npx vitest run -c vitest.integration.config.ts tests/integration/extraction-language-determinism.test.ts --no-file-parallelism
```

### Acceptance Criteria
- [ ] Prompt unit test `green` — `npx vitest run packages/core/src/domain/extraction-prompt.test.ts` `exit code 0`
- [ ] Real-LLM GOAL `green` (PT→PT, EN→EN) when keyed — `exit code 0`
- [ ] Coverage `>= 90` on changed files; zero type errors — `npm run typecheck`; zero lint — `npm run lint`

### If Validation Fails
1. Separate plan-caused from pre-existing.
2. If the real LLM still translates, strengthen the clause wording; re-run.
3. Log pre-existing in the PR description.
