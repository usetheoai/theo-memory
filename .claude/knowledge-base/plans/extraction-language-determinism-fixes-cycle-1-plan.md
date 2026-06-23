---
slug: extraction-language-determinism-fixes-cycle-1
milestone_id: ExtractionLanguageDeterminismFixesCycle1
created_at: 2026-06-23
goal: Guarantee the persisted memory[].text fact is emitted in the SAME language as the input by deterministically detecting the input language and injecting the explicit target-language NAME into the extraction prompt (concrete instruction, not LLM self-detection), measured by a hardened real-LLM GOAL where the canonical dogfood English sentence persists English facts (NO Portuguese tokens) and a Portuguese sentence persists Portuguese facts.
---

# Plan: extraction-language-determinism-fixes-cycle-1

> **Version 1.0** — fixes-cycle-1 for EG-4 of the entity-graph-dogfood-remediation-roadmap. The shipped EG-4 (v0.20.3, prompt-only "write each fact in the SAME language") was proven INSUFFICIENT by the 2026-06-23 integrated live-test: with the real `gpt-4o-mini`, the English input `"My name is Sarah, I work as a data scientist at Acme and I love rock climbing"` was persisted as Portuguese facts (`"Sarah ama escalada."`, `"Sarah trabalha como cientista de dados na Acme."`) — reproduced 3/3 over fresh scopes against the running dev stack (gateway v0.7.0 + themory v0.20.3, OpenAI real). The shipped GOAL test (`tests/integration/extraction-language-determinism.test.ts`) used the exact sentence `"My favorite hobby is hiking on weekends"` and asserts the fact does NOT match `/caminha|trilha/`; in the live run the model produced exactly `"caminhadas"/"trilhas"` — i.e. that test would FAIL now; it passed at release via real-LLM non-determinism (or a keyless skip) — a FALSE GREEN. ROOT CAUSE: the prompt asks the model to SELF-DETECT the input language ("detect the input language … write each fact in the SAME language"); web prior art (PaLM, BLOOM) documents that self-detect/"wrong-language generation" is a measurable failure mode, while injecting the EXPLICIT target-language name is far more reliable. FIX: detect the input language DETERMINISTICALLY (`franc-min`, MIT, pure-JS) and inject the explicit language NAME into the extraction prompt ("Write ALL facts in ENGLISH."), add a one-shot bilingual reinforcement, and add a fail-soft post-extraction language-mismatch OTel guard (Princípio 3 observability). Scope: `packages/core` extraction — ONE new tiny dependency (`franc-min`), ONE new module, prompt + pipeline edits, ONE new MEMORY_EVENT literal. NO migration, NO DIP widening, NO public-export change, NO schema change.

## Goal

> "Guarantee the persisted `memory[].text` fact is emitted in the SAME language/script as the input — by deterministically detecting the input language (`franc-min`) and injecting the EXPLICIT target-language name into the extraction prompt (a concrete instruction the model follows, not self-detection) — measured by `tests/integration/extraction-language-determinism.test.ts` (REAL OpenAI, hardened) where the canonical dogfood English sentence `"My name is Sarah, I work as a data scientist and I love rock climbing"` persists facts whose joined text matches `/\bdata\b/` AND `/\bclimb/` AND does NOT match `/cientista|escalada|caminhada|trilha/`, and a Portuguese sentence persists Portuguese facts (matches `/engenheiro/`, NOT `/\bengineer\b/`)."

## Context

EG-4 of `.claude/knowledge-base/roadmaps/entity-graph-dogfood-remediation-roadmap.md` shipped a prompt-only fix that the live-test disproved. Mixed-language fact storage hurts (a) dedup (the MD5 hash of an English fact ≠ its Portuguese translation, so the same fact asserted in two languages would not dedup — Princípio 2), (b) semantic-recall consistency (query-vs-fact language mismatch lowers cosine), and (c) the user-visible Memories/Graph tabs (facts flip language unpredictably; the live Graph showed `"software engineer"` EN next to `"cientista de dados"` PT under the same user). This cycle replaces the unreliable self-detection with deterministic detection + explicit injection, and adds the verification safety-net the research recommends. Honors Princípio 2 (consistent facts dedup correctly) + Princípio 3 (every IGNORE/mismatch decision is observable via a typed OTel event).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/extraction/prompt.ts` | 181 | `469f43a` (2026-06-23) | composes the extraction SYSTEM_PROMPT + Zod schema; the v0.20.3 `LANGUAGE:` clause pins entity/relation/fact language via self-detection | the existing entity/relation language rule kept; the `user` speaker exception kept; strict JSON output format + `AdditiveExtractionSchema` unchanged; diacritic preservation kept; `ontologyPrefix`/`customPrefix` ordering unchanged |
| `packages/core/src/domain/extraction/pipeline.ts` | 590 | `ef61073` (2026-06-22) | the write-pipeline extraction phase: builds the prompt (`:369`), calls `deps.llm.generateResponse([...],{type:'json'})` (`:377`), coerces + Zod-parses | the existing extraction call shape kept; the `linked_memory_ids` number→string coercion kept; extraction failure stays fail-soft (catch → `[]`); `remember()` NEVER fails on a language-guard error |
| `packages/core/src/domain/memory-event.ts` | 164 | `3e206b2` (2026-06-23) | the `MEMORY_EVENTS` typed union (`emitEvent`); existing literals incl. `extraction_zero_facts`, `entity_noise_filtered` | existing literals UNCHANGED; new literal appended (additive union widening) |
| `packages/core/src/domain/extraction/language.ts` (NEW) | 0 | — | (to create) — `detectInputLanguage(text)` (franc-min wrapper + ISO-639-3→name map + undetermined/short-input guard) + `factLanguageMatches(fact, expected)` | — |
| `packages/core/package.json` | n/a | — | core package manifest | only the `dependencies` map gains `franc-min`; no other field changes |
| `packages/core/src/domain/extraction-prompt.test.ts` | ~80 | `469f43a` (2026-06-23) | unit tests for prompt structure | existing assertions stay green |
| `tests/integration/extraction-language-determinism.test.ts` | 82 | `469f43a` (2026-06-23) | the EG-4 real-LLM GOAL (lenient cognate assertion — the false-green) | REPLACED with the hardened non-cognate assertion (same file path) |

### Current callers / dependents

- **Symbol:** `generateAdditiveExtractionPrompt(existing, messages, customInstructions, ontology)` (`prompt.ts:121`) — the ONLY caller is the write pipeline (`pipeline.ts:369`). A new OPTIONAL 5th parameter `detectedLanguage` is backward-compatible (undefined → no language directive → current behavior). No external repo imports this (package-internal).
- **Symbol:** `runExtractionPipeline` / the extraction phase in `pipeline.ts` — called by `remember()`. Adds a local franc-min detection before prompt build + a post-parse guard. No signature change visible to `remember()` callers.
- **Symbol:** `MEMORY_EVENTS` / `emitEvent` (`memory-event.ts`) — consumed across the write/recall/reflect phases. Appending one literal is additive; existing consumers unaffected.
- **Symbol:** `franc` from `franc-min` (NEW dep) — `franc(text): string` returns an ISO-639-3 code (or `'und'`). Pure-JS, only transitive dep `trigram-utils`. No native bindings → no Docker/distroless build risk.

### Domain glossary

- **input language** — the natural language of the user's message text (`messages[].content`), detected deterministically with `franc-min` (ISO-639-3 code, e.g. `eng`, `por`).
- **target-language injection** — prepending an explicit directive naming the detected language ("Write ALL facts, entity names and relationship labels in ENGLISH.") to the extraction prompt, so the model follows a concrete instruction instead of self-detecting.
- **language-mismatch guard** — a fail-soft post-extraction check: if a persisted fact's detected language differs from the input language, emit the `extraction_language_mismatch` OTel event (observability only — never drops the fact, never fails `remember()`).
- **undetermined (`und`)** — franc's output when the text is too short/ambiguous to classify; the detector returns `null` and NO language directive is injected (behavior byte-unchanged from today).

### Architecture boundaries affected

- **`packages/core/src/domain/extraction`** — adds one local module (`language.ts`) + edits prompt/pipeline. No type/contract/DIP change (ADR-0008 untouched), no new public export from the barrel, no migration. The franc-min call is pure-local CPU (no I/O). The only external I/O in this path is the pre-existing OpenAI extraction call.

## Prior Art & Related Work

- **Web research (2026-06-23)** — explicit target-language injection beats self-detection: PaLM native-vs-default prompt swings translation language by +14 chrF and "native prompts trigger text in the desired language, while the default prompt results in high rates of generating the wrong target language"; BLOOM 0-shot wrong-language ~1/5, mitigated by 1-shot; production pattern = detect input lang with a dedicated tool + state the target language explicitly (spelled-out name) + verify output language post-hoc with a language-ID tool. Sources: [PaLM incidental bilingualism](https://arxiv.org/pdf/2305.10266), [BLOOM translation](https://arxiv.org/pdf/2303.01911), [Microsoft localization guidance](https://learn.microsoft.com/en-us/globalization/localization/ai/localizing-ai-based-features), [translation prompt engineering](https://translated.com/resources/prompt-engineering-for-translation-guiding-ai-behavior).
- **Internal:** the parent EG-4 plan `.claude/knowledge-base/plans/extraction-language-determinism-plan.md` (the prompt-only approach this cycle supersedes) + its edge-case report `.claude/knowledge-base/reviews/extraction-language-determinism-edge-cases-2026-06-23.md`. The existing entity/relation source-language rule in `prompt.ts` is the precedent being made deterministic.
- **Lib:** `franc-min` (MIT) — the same `franc` family the Mem0-TS reference uses elsewhere for NLP utilities; pure-JS, no native bindings (unlike `cld3`/fasttext), so it is safe for the distroless runtime.

## ADRs

### D1 — Deterministic input-language detection (`franc-min`) + explicit target-language injection

**Decision:** Detect the input language with `franc-min` over the joined `messages[].content`. When a language is confidently detected (not `und`, input length ≥ a small threshold), inject an explicit directive naming the language ("Write ALL facts, entity names and relationship labels in ENGLISH — the language of the input. NEVER translate.") as the HIGHEST-priority line of the extraction prompt. When undetermined, inject NOTHING (behavior byte-unchanged from today).

**Rationale:** Honors Inquebrável Rule 9 (use a mature lib — `franc-min` MIT, not a hand-rolled detector). Web prior art (PaLM/BLOOM) shows a concrete "write in ENGLISH" instruction is followed far more reliably than the abstract "detect the language and write in it" the model currently ignores. Determinism: detection is a pure function (no LLM, no I/O) → the directive is reproducible for the same input.

**Alternatives rejected:**
- (a) Stronger prompt-only wording (no detection) — REJECTED: this is what v0.20.3 already does; the live-test proved it fails 3/3 with `gpt-4o-mini`.
- (b) LLM self-detection ("detect the input language") — REJECTED: the current approach; documented failure mode (PaLM/BLOOM wrong-language generation).
- (c) A heavier detector (`cld3`/fasttext) — REJECTED: native bindings break the distroless build (cf. the `sharp`/libvips build-flakiness already on record); `franc-min` is pure-JS.

### D2 — One-shot bilingual reinforcement in the prompt

**Decision:** Add a single compact reinforcement line to `SYSTEM_PROMPT` showing the invariant by example (an English input yields English facts; a Portuguese input yields Portuguese facts), complementing the D1 injected directive.

**Rationale:** BLOOM finding — 1-shot largely mitigates residual wrong-language generation that 0-shot leaves. Cheap (a few tokens), no structural change.

**Alternatives rejected:**
- (a) No reinforcement (D1 injection only) — REJECTED as the sole measure: leaves the BLOOM 0-shot residual; the one line is low-cost insurance.
- (b) Multi-example few-shot block — REJECTED: token cost + YAGNI; one example suffices.

### D3 — Fail-soft post-extraction language-mismatch guard + `extraction_language_mismatch` OTel event

**Decision:** After extraction, for each persisted fact, detect its language; if it differs from the detected input language, emit the new typed `extraction_language_mismatch` MEMORY_EVENT (attributes: `input_language`, `fact_language`, `fact_count`). The guard is OBSERVABILITY ONLY — it NEVER drops the fact and NEVER fails `remember()`.

**Rationale:** Princípio 3 — every language decision becomes observable/auditable; ops can dashboard the residual mismatch rate to know if D1+D2 regress. The research recommends a post-hoc language-ID verification safety-net. Fail-soft matches the existing extraction-failure discipline (catch → `[]`).

**Alternatives rejected:**
- (a) Auto-correcting re-prompt on mismatch — REJECTED for cycle-1: adds a second LLM call (latency + cost) and pipeline complexity; the D1 injection is the fix and the GOAL test validates it. If the real-LLM GOAL proves injection insufficient, the re-prompt is a documented follow-up (see Unresolved Questions). KISS/YAGNI.
- (b) Hard-drop mismatched facts — REJECTED: would make `remember()` lossy on a detector false-positive; violates fail-soft + ADD-only.

### D4 — Hardened real-LLM GOAL test (non-cognate, strict absent-translation)

**Decision:** Replace the lenient cognate assertion in `tests/integration/extraction-language-determinism.test.ts` with the canonical dogfood-shaped non-cognate sentence and a strict absent-translation assertion (EN input → facts match `/\bdata\b/` + `/\bclimb/`, NOT `/cientista|escalada|caminhada|trilha/`; PT input → `/engenheiro/`, NOT `/\bengineer\b/`).

**Rationale:** The shipped test was a false-green (its `hiking` sentence translates to exactly the tokens it failed to forbid). A non-cognate, dogfood-derived sentence is the honest oracle (Inquebrável Rule 3 + 5). Keeps `describe.skipIf(no key)` so keyless CI stays green.

**Alternatives rejected:**
- (a) Keep the lenient test — REJECTED: it is the false-green this cycle exists to fix.
- (b) Mock the LLM — REJECTED: a stub proves nothing about real prompt-following (Inquebrável Rule 3); the property under test is LLM behavior.

## Dependencies

| Package | Version | Ecosystem | Status | Rule 9 evaluation | CVE status |
|---|---|---|---|---|---|
| `franc-min` | `^6.2.0` | npm (prod dep of `@usetheo/memory` core) | NEW | Evaluated `franc`/`franc-min` (MIT, pure-JS, by wooorm, mature), `eld` (Apache-2.0), `cld3`/fasttext (native bindings). Selected `franc-min`: MIT (compatible with Apache-2.0), pure-JS (no native → distroless-safe), lightweight (top languages incl. eng/por/spa/fra/deu/ita), single transitive dep `trigram-utils`. Rejected `eld` (heavier model payload, marginal benefit), `cld3`/fasttext (native bindings break the distroless build). | To be confirmed CLEAN by `/deps-audit` (osv-scanner / npm audit). franc-min has no known CRITICAL/HIGH CVE as of 2026-06-23; deps-audit is the gate. |

Transitive: `trigram-utils` (pure-JS, MIT). No native bindings introduced. Bundle impact: small; the default barrel already ships core — `franc-min` loads with extraction (not isolated behind a subpath), acceptable since extraction is the default write path.

## Failure scenarios

The extraction path performs ONE external-I/O call (the pre-existing OpenAI LLM call). The franc-min detection + the guard are pure-local CPU (no I/O). Scenarios:

- **OpenAI extraction call times out / 5xx / connection reset** — UNCHANGED behavior: the existing `try/catch` around `generateResponse` returns `[]` (extraction yields no facts; `remember()` fail-soft). The D1 detection runs BEFORE the call (pure-local) and the D3 guard runs AFTER a successful parse, so neither adds a new external failure mode. Test: the existing pipeline failure path stays green; a unit test asserts `detectInputLanguage` never throws on empty/garbage input (returns `null`).
- **franc-min returns `und` (short/ambiguous input)** — `detectInputLanguage` returns `null` → no directive injected → current behavior preserved (no new failure). Test: `detectInputLanguage('hi')` / `detectInputLanguage('')` → `null`.
- **Guard detection disagrees with reality (false positive/negative)** — fail-soft: at most an extra/missing OTel event; the fact is always persisted. No `remember()` impact.

## Phases

### Phase 1 — Deterministic detection module + dependency

### T1.1 — Add `franc-min` + `language.ts` detection module

**Files to edit:**
- `packages/core/package.json` — add `"franc-min": "^6.2.0"` to `dependencies`.
- `packages/core/src/domain/extraction/language.ts` (NEW) — `detectInputLanguage(text: string): { iso6393: string; name: string } | null` (franc-min + ISO-639-3→English-name map for the supported set; returns `null` for `und`, for input shorter than the `MIN_DETECT_CHARS` threshold, OR when the detected ISO code has NO entry in the name map — EC-1: never inject a raw ISO code like `cmn`) + `factLanguageMatches(factText, expectedIso6393): boolean` (true when the fact's detected language equals the expected, OR either side is undetermined — fail-soft toward NOT flagging).
- `packages/core/src/domain/extraction/language.test.ts` (NEW) — unit tests.

#### Why this step

Action: introduce the only new dependency and a pure-function detection wrapper that the prompt builder + the guard both consume.

Reasoning: D1 requires deterministic detection BEFORE prompt assembly; isolating it in `language.ts` keeps `prompt.ts`/`pipeline.ts` edits minimal and unit-testable without an LLM (SRP). The `und`/short-input `null` path is what preserves byte-unchanged behavior for inputs franc cannot classify (Baseline Context invariant).

#### TDD

- RED `test('detectInputLanguage returns eng for an English sentence')` — `detectInputLanguage('My name is Sarah and I love rock climbing')?.iso6393` === `'eng'`, `.name` === `'English'`.
- RED `test('detectInputLanguage returns por for a Portuguese sentence')` — `detectInputLanguage('Eu trabalho como engenheiro mecânico em Lisboa')?.iso6393` === `'por'`.
- RED `test('detectInputLanguage returns null for undetermined/short input')` — `detectInputLanguage('hi')` === `null` AND `detectInputLanguage('')` === `null`.
- RED `test('detectInputLanguage never throws on garbage input')` — `detectInputLanguage('@@@ 123 \n')` returns `null` (no throw).
- RED `test('factLanguageMatches is fail-soft when a side is undetermined')` — `factLanguageMatches('ok', 'eng')` === `true` (short fact → undetermined → not flagged).
- RED `test('detectInputLanguage returns null for a detected-but-unmapped ISO code')` (EC-1) — a Mandarin sentence whose franc code `cmn` is NOT in the name map → `detectInputLanguage(...)` === `null` (never inject a raw `cmn` directive).
- GREEN: implement with `franc-min`.
- REFACTOR: extract the ISO-639-3→name map to a module const.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `detectInputLanguage` returns `{ iso6393: 'eng', name: 'English' }` for the canonical EN sentence and `{ iso6393: 'por', name: 'Portuguese' }` for the canonical PT sentence (asserted with backtick literals `'eng'` / `'por'`).
- `detectInputLanguage` returns `null` (not a throw) for `''`, `'hi'`, and `'@@@ 123'`.
- `package.json` `dependencies` contains `franc-min` at `^6.2.0`.

#### Definition of done

- `npm test -- packages/core/src/domain/extraction/language.test.ts` green.
- `npm run typecheck` clean.
- CHANGELOG `[Unreleased]` updated.

### Phase 2 — Prompt injection + one-shot reinforcement

### T2.1 — Inject the explicit target language + one-shot reinforcement into the prompt

**Files to edit:**
- `packages/core/src/domain/extraction/prompt.ts` — add an OPTIONAL 5th param `detectedLanguage?: { name: string }` to `generateAdditiveExtractionPrompt`; when present, prepend a `LANGUAGE DIRECTIVE` line naming the language ("Write ALL facts, entity names and relationship labels in {name} — the language of the input. NEVER translate or transliterate."). Add the D2 one-shot reinforcement to `SYSTEM_PROMPT`. Preserve `ontologyPrefix`/`customPrefix` ordering (directive goes FIRST, before ontology/custom).
- `packages/core/src/domain/extraction-prompt.test.ts` — assertions for the injected directive + backward-compat (no param → no directive).

#### Why this step

Action: make the prompt builder emit the concrete target-language instruction when a language was detected.

Reasoning: D1's core mechanism. The optional param keeps the single caller backward-compatible and makes the directive deterministically testable without an LLM (assert the substring is present/absent). Prepending (highest priority) reflects the prior-art finding that the language constraint must be salient.

#### TDD

- RED `test('generateAdditiveExtractionPrompt injects the explicit language when detected')` — calling with `detectedLanguage: { name: 'English' }` → `prompt` contains `'in English'` AND `'NEVER translate'`.
- RED `test('generateAdditiveExtractionPrompt omits the directive when no language given')` — calling WITHOUT the param → `prompt` does NOT contain `'LANGUAGE DIRECTIVE'` (byte-compat with today).
- RED `test('SYSTEM_PROMPT carries the one-shot bilingual reinforcement')` — prompt contains both an English-in→English-out and a Portuguese-in→Portuguese-out cue.
- GREEN: implement.
- REFACTOR: keep the directive assembly a single helper.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- With `detectedLanguage: { name: 'English' }`, the returned prompt string contains the literal `in English` and `NEVER translate` (asserted via backtick substrings).
- Without the param, the prompt is unchanged (no `LANGUAGE DIRECTIVE` substring) — backward-compatible.
- Existing `extraction-prompt.test.ts` assertions stay green.

#### Definition of done

- `npm test -- packages/core/src/domain/extraction-prompt.test.ts` green.
- `npm run typecheck` clean.
- CHANGELOG updated.

### Phase 3 — Pipeline wiring + fail-soft guard + OTel event

### T3.1 — Detect-and-inject in the pipeline + `extraction_language_mismatch` guard

**Files to edit:**
- `packages/core/src/domain/memory-event.ts` — append `'extraction_language_mismatch'` to `MEMORY_EVENTS`.
- `packages/core/src/domain/extraction/pipeline.ts` — before `generateAdditiveExtractionPrompt` (`:369`), compute `detectInputLanguage(messages.map(m=>m.content).join('\n'))` and pass it through; after the successful Zod parse, run the fail-soft guard: if any persisted fact's `factLanguageMatches(fact.text, detected.iso6393)` is false, `emitEvent(tracer, 'extraction_language_mismatch', {...})`. Wrap the guard in its own try/catch so it can NEVER fail `remember()`.
- `packages/core/src/domain/extraction/pipeline.test.ts` (or the nearest existing pipeline unit test) — unit-test the wiring with a stub LLM.

#### Why this step

Action: connect detection → prompt and add the observability guard, completing the wiring triad (caller = pipeline; integration test = the GOAL; runtime metric = the OTel event).

Reasoning: D1 must run in the real write path (not just be available); D3's guard is the Princípio 3 runtime signal. The dedicated try/catch around the guard upholds the fail-soft invariant (Baseline Context: `remember()` NEVER fails on a language-guard error).

#### TDD

- RED `test('extraction injects the detected language into the system prompt')` — stub LLM captures the system message; given an English user message, the captured prompt contains `in English`.
- RED `test('extraction emits extraction_language_mismatch when a fact language differs from the input')` — stub LLM returns a Portuguese fact for an English input; a spy `emitEvent` records `extraction_language_mismatch`.
- RED `test('the language guard never fails remember when detection throws')` — force the guard's detector to throw (monkeypatch/spy); `remember()` still resolves with the facts (fail-soft).
- GREEN: implement.
- REFACTOR: keep the guard a single private helper.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `MEMORY_EVENTS` includes the literal `extraction_language_mismatch` (typed union widened additively; `npm run typecheck` proves it).
- With a stub LLM, an English user message produces a system prompt containing `in English` (wiring proven without a real LLM).
- A forced guard error does NOT reject `remember()` (fail-soft asserted).

#### Definition of done

- `npm test -- packages/core/src/domain/extraction` green.
- `npm run typecheck` + `npm run lint` clean.
- CHANGELOG updated.

### Phase 4 — Final Phase: Integration Validation (hardened real-LLM GOAL)

### T4.1 — Hardened real-LLM GOAL + full-suite + live re-verify

**Files to edit:**
- `tests/integration/extraction-language-determinism.test.ts` — replace the lenient assertions per D4 (non-cognate dogfood sentence; strict absent-translation both directions). Keep `describe.skipIf(no key || no pg)`.

#### Why this step

Action: prove the fix holds against the REAL LLM with the honest oracle, then re-verify in the running dev stack.

Reasoning: Inquebrável Rule 3/5 — the GOAL must be the property the live-test exposed, not a cognate-lenient proxy. The integration-validation phase is the "eat your own cooking" gate.

#### TDD

- RED (pre-fix, real LLM): the hardened EN assertion FAILS on the current prompt-only code (reproduces the live-test regression).
- GREEN (post-fix): EN input `"My name is Sarah, I work as a data scientist and I love rock climbing"` → joined facts match `/\bdata\b/` AND `/\bclimb/`, do NOT match `/cientista|escalada|caminhada|trilha/`; PT input `"Eu trabalho como engenheiro mecânico"` → matches `/engenheiro/`, NOT `/\bengineer\b/`.
- REFACTOR: none (test-only).

#### Concurrency tests

(none — single-threaded)

#### Failure-scenario validation

- Confirm the extraction `try/catch` still returns `[]` on an LLM error (no new external failure mode introduced by detection/guard).

#### Acceptance criteria

- The hardened GOAL test PASSES with the real LLM (`OPENAI_API_KEY` set, `gpt-4o-mini`): EN→EN (no PT tokens), PT→PT (no EN tokens).
- The full suite (`npm test`) is green (zero regressions); `npm run typecheck` + `npm run lint` clean.
- Live re-verify: against the running dev stack, `POST /v1/remember` of the canonical EN sentence under a FRESH scope persists English facts (no `cientista`/`escalada`), reproduced via the `themory` REST `:18081`.

#### Definition of done

- `npm test` full suite green; coverage gate on `packages/core/src/domain/extraction` holds.
- `/code-quality` verdict ∈ {PASS, PASS_WITH_CAVEATS}.
- The live EN→EN re-verify is captured (curl output) in the implementation report.
- CHANGELOG `[Unreleased]` has the EG-4 fixes-cycle-1 entry.
- Plan archived after `/review` READY_TO_MERGE + merge.

## Dependency Graph

- T1.1 (detection module + dep) → blocks T2.1 (prompt consumes the name) and T3.1 (pipeline + guard consume detection).
- T2.1 + T3.1 → block T4.1 (GOAL needs injection wired end-to-end).
- T1.1 and T2.1 are partially parallelizable (prompt param can be added against the type before the impl lands), but the safe order is T1.1 → T2.1 → T3.1 → T4.1.

## Coverage Matrix

| # | Goal claim / requirement | Detail | Task |
|---|---|---|---|
| 1 | Deterministically detect the input language (franc-min, MIT) | pure-function detection wrapper | T1.1 |
| 2 | undetermined/short input yields no directive (byte-unchanged behavior) | franc und path returns null | T1.1 |
| 3 | New dep CVE-clean + Rule-9 evaluated + version pinned | franc-min added in this task; gated by deps-audit | T1.1 |
| 4 | Inject the EXPLICIT target-language name into the prompt | optional detectedLanguage param prepends directive | T2.1 |
| 5 | One-shot bilingual reinforcement (BLOOM mitigation) | SYSTEM_PROMPT example line | T2.1 |
| 6 | Wire detect-then-inject into the real write pipeline | pipeline builds prompt with detected language | T3.1 |
| 7 | Fail-soft post-extraction language-mismatch guard | guard never drops a fact nor fails remember | T3.1 |
| 8 | extraction_language_mismatch OTel event (Princípio 3) | typed MEMORY_EVENTS literal appended | T3.1 |
| 9 | remember never fails on a guard error | dedicated try/catch around the guard | T3.1 |
| 10 | No public-export / schema / migration change (additive only) | union widened additively; no barrel/DIP change | T3.1 |
| 11 | Hardened non-cognate real-LLM GOAL (EN to EN, PT to PT) | replaces the false-green cognate test | T4.1 |
| 12 | Live re-verify against the running dev stack | curl EN remember persists English facts | T4.1 |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `franc-min` mis-detects very short or code-switched inputs (e.g. one PT word in an EN sentence) | Medium | The `und`/short-input `null` path skips injection (no regression vs today); the guard is fail-soft (observe only). Threshold `MIN_DETECT_CHARS` tuned in T1.1. | implementer |
| Explicit injection still leaves a residual wrong-language rate with `gpt-4o-mini` | Medium | D2 one-shot reinforcement + the D3 guard surfaces the residual rate via OTel; if the hardened GOAL still fails, the auto-correct re-prompt (D3 alt-a) is the documented follow-up. | implementer |
| New prod dependency on the default write path increases bundle a touch | Low | `franc-min` is pure-JS + one transitive dep; no native bindings; extraction is already the default path. `/deps-audit` gates CVE/license. | reviewer |
| Adding a `MEMORY_EVENTS` literal could break an exhaustive switch elsewhere | Low | `npm run typecheck` proves exhaustiveness; the union is widened additively and existing consumers default-handle. | implementer |

## Unresolved Questions

- If the D1 injection + D2 one-shot still leave the hardened GOAL flaky with `gpt-4o-mini`, do we add the D3 alt-a auto-correct re-prompt in THIS cycle or a follow-up? Resolution at T4.1: implement injection+guard first; only escalate to the re-prompt if the real-LLM GOAL does not pass deterministically — recorded honestly in the implementation report (no silent scope creep).
- `MIN_DETECT_CHARS` exact value — resolved empirically in T1.1 (start at a small value that classifies the dogfood sentences while returning `null` for `'hi'`).

## Global Definition of Done

- [ ] All tasks T1.1–T4.1 complete with green TDD.
- [ ] `npm test` full suite green (zero regressions); `npm run typecheck` + `npm run lint` clean.
- [ ] Hardened real-LLM GOAL passes (EN→EN, PT→PT) + live dev-stack EN→EN re-verify captured.
- [ ] `/deps-audit` CLEAN for `franc-min` (no CRITICAL/HIGH CVE; Rule-9 evaluated; version pinned).
- [ ] `/code-quality` verdict ∈ {PASS, PASS_WITH_CAVEATS} (no dead code / fabricated symbol; `franc-min` recognized).
- [ ] No paper names in `src/**`/tests (per `no-paper-names-in-code.md`).
- [ ] CHANGELOG `[Unreleased]` updated (Fixed).
- [ ] `/review` returns READY_TO_MERGE.
- [ ] Plan archived to `completed/` after merge.
