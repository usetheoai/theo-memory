---
slug: entity-label-language-determinism
milestone_id: EntityLabelLanguageDeterminism
created_at: 2026-06-23
goal: Guarantee the extracted entities[] names and relations[] labels are emitted in the SAME language as the input by reusing the EG-4 deterministic detector and a referential-integrity-preserving corrective translation map, measured by a hardened real-LLM GOAL where an English input persists English entity/relation labels (NO Portuguese tokens) and a Portuguese input persists Portuguese labels.
---

# Plan: entity-label-language-determinism

> **Version 1.0** — EG-5 of the entity-graph-dogfood-remediation-roadmap. The COMPLETE live-test (2026-06-23, dev stack themory v0.20.4) confirmed EG-4 fixed the `memory[].text` FACT language (EN input → EN facts) but surfaced a residual: the `entities[]` names + `relations[]` labels still drift to Portuguese for an English input. Isolated under a fresh scope: input "My name is Daniel, I work as a product manager at Acme and I enjoy surfing on weekends" → FACTS EN ("User works as a product manager at Acme", "User enjoys surfing on weekends") but ENTITIES mixed: `Acme`, `Daniel`, `product manager` (EN) vs `surfar`, `fins de semana` (PT); the graph edges point at the PT nodes. This poisons the dashboard Graph/Entities tabs (a single user shows EN + PT nodes) and entity dedup (the same entity asserted in two languages resolves to two nodes). EG-5 extends the EG-4 source-language guarantee to entity/relation labels, reusing the shipped `eld` detector + the corrective-rewrite pattern, with a referential-integrity-preserving translation MAP so relation source/destination stay connected to their renamed nodes. Scope: `packages/core` extraction — ONE new module, a pipeline edit, ONE new MEMORY_EVENT literal. NO new dependency (reuses `eld`), NO migration, NO DIP widening, NO public-export change, NO schema change.

## Goal

> "Guarantee the extracted `entities[]` names and `relations[]` labels are emitted in the SAME language as the input — by detecting the aggregate label language (`eld`, already shipped) and, on a confident mismatch vs the input language, applying ONE corrective translation MAP (same surface string → same translation, applied to entity names AND relation source/relationship/destination for referential integrity) — measured by `tests/integration/entity-label-language-determinism.test.ts` (REAL OpenAI) where the canonical dogfood English input persists entity labels whose joined text does NOT match `/surfar|fins de semana|gerente|cientista|escalada/` and DOES contain an English token (`/surf|weekend|manager|scientist|climb/`), and a Portuguese input persists Portuguese labels (NOT `/\bsurfing\b|\bweekend\b|\bmanager\b/`)."

## Context

EG-5 of `.claude/knowledge-base/roadmaps/entity-graph-dogfood-remediation-roadmap.md`, surfaced by the EG-4 complete live-test. The graph/entities surface is the user-visible consequence: the live dashboard Graph showed a single user's nodes split across `product manager`/`surfar`/`fins de semana`. Mixed-language entity labels hurt (a) the dashboard Graph/Entities UX (incoherent), (b) entity resolution/dedup (`(scope, normalized_key)` UNIQUE keys differ across languages → duplicate nodes for the same real-world entity — Princípio 2), and (c) cross-fact graph coherence (a relation edge in PT next to an EN fact). EG-4 already pinned `memory[].text`; EG-5 closes the adjacent entities[]/relations[] surface using the SAME deterministic-detect + corrective-rewrite machinery. Honors Princípio 2 (consistent labels dedup correctly) + Princípio 3 (the correction is observable via a typed OTel event).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/extraction/language.ts` | 95 | `457cf96` (2026-06-23) | EG-4 deterministic detector (`detectInputLanguage` via `eld`, ISO-639-1 + name map + short/undetermined/unmapped → null) | reused AS-IS by EG-5 (no change); `detectInputLanguage` is the shared aggregate detector |
| `packages/core/src/domain/extraction/pipeline.ts` | ~640 | `457cf96` (2026-06-23) | the write-pipeline extraction phase; EG-4 fact-correction guard runs after Zod parse; `llmEntities`+`relations` set at parse, ontology-coerced, then persisted via `linkEntities(...)` (Phase 7) | the EG-4 fact guard kept; ontology coercion order kept; `linkEntities` call shape kept; extraction stays fail-soft; `remember()` NEVER fails on a label-guard error |
| `packages/core/src/domain/extraction/entity-linking.ts` | ~210 | (entity-relation slices) | `RelationTriple { source, relationship, destination }` + `linkEntities(items, filters, deps, tracer, relations?, llmEntities?)` persists nodes + edges | `RelationTriple` shape unchanged; `linkEntities` signature unchanged (EG-5 corrects the data BEFORE this call) |
| `packages/core/src/domain/memory-event.ts` | 173 | `457cf96` (2026-06-23) | the `MEMORY_EVENTS` typed union (36 literals incl. `extraction_language_mismatch`) | existing literals UNCHANGED; one literal appended (additive widening) |
| `packages/core/src/domain/extraction/label-language.ts` (NEW) | 0 | — | (to create) — `correctEntityRelationLanguage(llm, entities, relations, target)`: aggregate-detect joined labels, on mismatch build a `{original:translated}` map via ONE LLM call, apply to entity names + relation triples | — |
| `packages/core/src/domain/extraction-pipeline.test.ts` | ~490 | `457cf96` (2026-06-23) | pipeline wiring tests (stub LLM + OTel exporter) | existing assertions stay green |
| `tests/integration/entity-label-language-determinism.test.ts` (NEW) | 0 | — | (to create) — real-LLM GOAL: EN input → EN entity/relation labels, PT input → PT labels | — |

### Current callers / dependents

- **Symbol:** `detectInputLanguage` (`language.ts`) — already called once in `pipeline.ts` for the input. EG-5 reuses it to detect the aggregate label language (over joined entity/relation surfaces). No change to the function.
- **Symbol:** `llmEntities` (`{ name: string; type?: string }[]`) + `relations` (`RelationTriple[]`) in `pipeline.ts` — set at parse (`:431-432`), ontology-coerced (`:520`), persisted via `linkEntities` (`:678`). EG-5 corrects them in-place (reassign the `let`s) AFTER the EG-4 fact guard and BEFORE `linkEntities`.
- **Symbol:** `MEMORY_EVENTS` / `emitEvent` — appending `extraction_label_language_mismatch` is additive; existing consumers unaffected.
- **Symbol:** `LLM.generateResponse` (`deps.llm`) — EG-5's corrective map call uses `{ type: 'json' }` (returns the parsed object); the existing `extractResponseText` precedent handles non-string shapes. No new dependency.

### Domain glossary

- **entity/relation label** — the surface strings the LLM extracts into `entities[].name` and `relations[].{source,relationship,destination}`. These are the graph NODES + EDGE labels. They drift language today.
- **referential integrity** — relation `source`/`destination` reference entity names by surface; a correction MUST rename an entity AND every relation endpoint that points at it identically, or the graph edges orphan. Guaranteed by applying ONE distinct-surface→translation map everywhere.
- **the "user" exception** — the speaker node is always the literal token `user`; it is excluded from translation (preserved verbatim), mirroring the EG-4 fact rule.

### Architecture boundaries affected

- **`packages/core/src/domain/extraction`** — one new local module + a pipeline edit. No type/contract/DIP change (ADR-0008 untouched), no new export, no migration. The only external I/O is the pre-existing LLM port (one extra `generateResponse` call ONLY when a label mismatch is detected).

## Prior Art & Related Work

- **Internal (the direct precedent):** EG-4 `extraction-language-determinism-fixes-cycle-1` shipped `detectInputLanguage` (`eld`) + the aggregate-detect + corrective-rewrite + fail-soft + OTel pattern for `memory[].text`. EG-5 is the same machinery applied to labels. The complete live-test report `.claude/knowledge-base/reviews/extraction-language-determinism-fixes-cycle-1-review-2026-06-23.md` records the residual EG-5 closes.
- **Web research (EG-4, 2026-06-23):** explicit target-language + post-hoc verification with a language-ID tool is the reliable production pattern (PaLM/BLOOM wrong-language generation). EG-5 reuses the shipped `eld` detector + a focused translation call (translation is a task LLMs do reliably).

## Implementation deviation (honest disclosure — Inquebrável Rule 3)

ADR D1 originally proposed **aggregate-detect-then-correct** (mirror EG-4): detect the joined-labels language and only correct on a confident mismatch. During T1.1 this proved UNRELIABLE for labels (unlike facts): entity/relation labels in one extraction are SHORT and MIXED (English nouns + Portuguese ones, e.g. `product manager` + `surfar` + `fins de semana`), and `eld` classifies the mixed join as the MAJORITY language (`'en'`), so a detect-gate would SKIP and the PT labels would leak. Empirically: `eld.detect("Acme Daniel product manager surfar fins de semana") === 'en'`. The corrected approach (D1 below) is **always-on normalization gated only by input-language-detected + ≥1 non-speaker label**: one bounded map call asks the model to translate ONLY the terms not already in the target language (it no-ops already-target terms). Trade-off: one extra LLM call per `remember()` that extracts entities (disclosed in Drawbacks; a future optimization can merge it with the EG-4 fact-correction call).

## ADRs

### D1 — Always-on label normalization to the input language (one bounded map call)

**Decision:** When the input language is detected (the EG-4 `detectInputLanguage` on the input, reliable) AND ≥1 distinct non-speaker label exists, make ONE `generateResponse({type:'json'})` call asking the model to translate to the input language ONLY the labels not already in it, returning a `{ original: translated }` map (omitting already-target terms). Apply the map to entity names AND relation source/relationship/destination. Do NOT gate on label-language detection (mixed short labels detect as the majority language → unreliable).

**Rationale:** Entity/relation labels are short AND mixed within a single extraction, so detect-gating skips the mixed case (live evidence above). Always-on normalization is the only reliable path; the model cheaply no-ops already-target terms (empty/partial map → `corrected` low). Reuses `detectInputLanguage` for the INPUT only (reliable on the full sentence). Zero new dependency.

**Alternatives rejected:**
- (a) Aggregate-detect-then-correct (the original D1) — REJECTED in-cycle: mixed short labels detect as the majority language; the gate skips and PT labels leak.
- (b) Per-label detection trigger — REJECTED: short labels mis-classify (`surfar`→Icelandic, `fins de semana`→Catalan); entity-only-PT-noun sets with no PT relation verb would not trigger.
- (c) Trust the prompt directive only (no guard) — REJECTED: the live-test proved the directive ("entity names ... in {name}") does NOT eliminate label drift.

### D2 — ONE corrective translation MAP applied for referential integrity

**Decision:** On a confident mismatch, make ONE `generateResponse({type:'json'})` call asking the model to translate each DISTINCT label to the input language, returning a JSON object `{original: translated}`. Apply the map to `entities[].name` AND `relations[].{source,relationship,destination}` — the SAME surface always maps to the SAME translation, so a relation endpoint stays connected to its renamed node. Labels absent from the map (or empty translation) keep the original (defensive).

**Rationale:** A single map preserves graph referential integrity (renaming entity "surfar"→"surfing" renames the relation endpoint "surfar"→"surfing" identically). One bounded call (not N per-label). Translation is reliable for the model. Fail-soft.

**Alternatives rejected:**
- (a) Per-label rewrite (N calls) — REJECTED: N LLM calls + risk that a relation's `source` and the matching entity `name` translate divergently → orphan edges.
- (b) Re-send the whole `entities`/`relations` JSON to "translate the structure" — REJECTED: the model may drop/add items or alter structure; the map is surgical.

### D3 — Fail-soft guard + `extraction_label_language_mismatch` OTel event; preserve `user`

**Decision:** Wrap the correction in its own try/catch; on ANY error keep the original labels. Exclude the literal `user` from the distinct-label set (never translated), and never let a label map ONTO `user`. Emit `extraction_label_language_mismatch` `{input_language, label_count, corrected}` when `corrected > 0` (no-op discipline; the always-on path re-attempts every write, so a transient map failure is corrected on the next remember). NEVER drops an entity/relation, NEVER fails `remember()`.

**Rationale:** Princípio 3 observability + the EG-4 fail-soft invariant. The `user` exception mirrors the EG-4 fact rule (the speaker node must stay the single canonical `user`).

**Alternatives rejected:**
- (a) Drop mismatched entities — REJECTED: lossy; breaks the graph.
- (b) Observe-only (no correction) — REJECTED: would not fix the user-visible drift.

### D4 — Hardened real-LLM GOAL on entity labels

**Decision:** A real-LLM integration GOAL asserts EN input → entity/relation labels contain an English token AND NOT the PT translations the live-test produced (`surfar`, `fins de semana`, `gerente`); PT input → PT labels, NOT the EN translations. `describe.skipIf(no key||no pg)`.

**Rationale:** Inquebrável Rule 3/5 — the oracle is the exact residual the live-test exposed, against the real model.

**Alternatives rejected:**
- (a) Unit-only with a stub — REJECTED: a stub proves nothing about real label-following; the property is LLM behavior (the corrective map call IS unit-tested with a stub, but the end-to-end GOAL uses the real LLM).

## Dependencies

| Package | Version | Ecosystem | Status | Rule 9 evaluation | CVE status |
|---|---|---|---|---|---|
| `eld` | `^1.0.1` | npm (already a prod dep of `@usetheo/memory` core) | REUSED (no change) | Already evaluated + adopted in EG-4 (Apache-2.0, pure-JS, zero transitive deps, distroless-safe). EG-5 adds NO new dependency — it reuses `detectInputLanguage`. | CLEAN (OSV `{}` for `eld@1.0.1`, confirmed EG-4 2026-06-23). |

No new dependency is introduced. `/deps-audit` is a no-op delta over EG-4.

## Failure scenarios

The label-correction path adds ONE external-I/O call (the LLM map translation) ONLY when a label mismatch is detected; detection is pure-local CPU.

- **LLM map call times out / 5xx / returns non-JSON** — fail-soft: the correction's own `try/catch` keeps the ORIGINAL labels; `remember()` proceeds; no event is emitted (corrected=0, no-op discipline) and the labels are re-normalized on the next write. Test: a stub LLM that throws on the map call → entities/relations unchanged, `remember()` resolves.
- **LLM map returns a partial / extra-key object** — defensive apply: `map[label] ?? label` per label; extra keys ignored. Test: a stub returning a map missing one label → that label kept, others translated.
- **`eld` returns `und`/unmapped on the joined labels** — `detectInputLanguage` returns null → no correction (labels kept). No new failure mode.

## Phases

### Phase 1 — Label-language correction module

### T1.1 — `label-language.ts` + unit tests

**Files to edit:**
- `packages/core/src/domain/extraction/label-language.ts` (NEW) — `correctEntityRelationLanguage(llm, entities, relations, target): Promise<{ entities?, relations?, labelsLanguage: string | null, labelCount: number, corrected: number }>`. Collects distinct labels (entity names ∪ relation source/relationship/destination) EXCLUDING `user`; `detectInputLanguage(joined)`; if null OR equal to `target.iso6391` → returns unchanged with `labelsLanguage`. Else ONE `llm.generateResponse([... translate to target.name, return JSON map ...], {type:'json'})`; parse the object; apply `map[x] ?? x` to entity names + relation triples; count `corrected` = distinct labels whose value changed.
- `packages/core/src/domain/extraction/label-language.test.ts` (NEW) — unit tests (stub LLM).

#### Why this step

Action: isolate the label-correction (detect + map + apply) in a pure-ish, stub-testable module.

Reasoning: SRP — keeps `pipeline.ts` thin; the referential-integrity map application is the load-bearing logic and deserves dedicated unit tests (D2). Reuses `detectInputLanguage` (DRY, D1).

#### TDD

- RED `test('corrects PT entity labels for an EN target via the translation map')` — entities `[{name:'surfar'},{name:'Daniel'}]` + relations `[{source:'user',relationship:'gosta de',destination:'surfar'}]`, target English, stub LLM map `{surfar:'surfing','gosta de':'enjoys'}` → entity `surfing`, relation `{user, enjoys, surfing}` (referential integrity: destination renamed to match).
- RED `test('preserves the literal user token (never translated)')` — `user` never appears as a map key; stays `user`.
- RED `test('no-op when labels already match the target language')` — EN labels + EN target → no LLM call, unchanged, `corrected=0`.
- RED `test('fail-soft: keeps originals when the map call throws')` — stub throws → entities/relations unchanged.
- RED `test('defensive apply: a label missing from the map keeps its original')` — partial map → unmapped label unchanged.
- GREEN: implement.
- REFACTOR: extract the distinct-label collector.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `correctEntityRelationLanguage` renames `surfar`→`surfing` in BOTH the entity and the relation destination (referential integrity asserted with backtick literals `'surfing'`).
- `user` is never translated (asserted `'user'` unchanged).
- Throws nothing on a map-call error (returns original structures).

#### Definition of done

- `npm test -- packages/core/src/domain/extraction/label-language.test.ts` green.
- `npm run typecheck` clean.
- CHANGELOG `[Unreleased]` updated.

### Phase 2 — Pipeline wiring + OTel event

### T2.1 — Wire correction into the pipeline + `extraction_label_language_mismatch`

**Files to edit:**
- `packages/core/src/domain/memory-event.ts` — append `'extraction_label_language_mismatch'`.
- `packages/core/src/domain/extraction/pipeline.ts` — after the EG-4 fact guard (detectedLanguage in scope) and before `linkEntities`, call `correctEntityRelationLanguage(deps.llm, llmEntities, relations, detectedLanguage)`; reassign `llmEntities`/`relations`; emit `extraction_label_language_mismatch` when a mismatch was detected. Wrap in try/catch (fail-soft).
- `packages/core/src/domain/extraction-pipeline.test.ts` — wiring test (stub LLM returns PT entities for an EN input + a map on the correction call; assert persisted nodes/relations are EN + event fired).

#### Why this step

Action: run the label correction in the real write path and make it observable.

Reasoning: completes the wiring triad (caller = pipeline; integration test = GOAL; metric = the OTel event). Placed after the fact guard so both fact + label corrections share the one detected input language; before `linkEntities` so the PERSISTED nodes/edges are already in the input language (Princípio 2 dedup stability).

#### TDD

- RED `test('extraction corrects PT entity labels to EN + emits extraction_label_language_mismatch')` — stub LLM: extraction returns EN facts + PT entities/relations; correction call returns the translation map. Assert `linkEntities` receives EN labels (spy) + the span fired `{input_language:'en', labels_language:'pt', corrected>0}`.
- RED `test('the label guard never fails remember when the correction throws')` — stub throws on the map call → `remember()` resolves; original labels persisted.
- GREEN: implement.
- REFACTOR: keep the guard a single block.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `MEMORY_EVENTS` includes `extraction_label_language_mismatch` (typecheck proves the union widened).
- With a stub, an EN input with PT entities → `linkEntities` is called with EN entity names + EN relation endpoints.
- A forced correction error does NOT reject `remember()`.

#### Definition of done

- `npm test -- packages/core/src/domain/extraction` green.
- `npm run typecheck` + `npm run lint` clean.
- CHANGELOG updated.

### Phase 3 — Final Phase: Integration Validation (hardened real-LLM GOAL)

### T3.1 — Real-LLM GOAL + full-suite + live re-verify

**Files to edit:**
- `tests/integration/entity-label-language-determinism.test.ts` (NEW) — real-LLM GOAL per D4.

#### Why this step

Action: prove the fix against the real model + re-verify the running dev-stack graph shows EN labels.

Reasoning: the integration-validation gate ("eat your own cooking"); the oracle is the exact live-test residual.

#### TDD

- RED (pre-fix): the EN entity-label assertion FAILS on current code (reproduces `surfar`/`fins de semana`).
- GREEN (post-fix): EN input → entity labels joined match `/surf|weekend|manager|scientist|climb/` AND NOT `/surfar|fins de semana|gerente|cientista|escalada/`; PT input → PT labels, NOT `/\bsurfing\b|\bweekend\b/`.
- REFACTOR: none (test-only).

#### Concurrency tests

(none — single-threaded)

#### Failure-scenario validation

- A stub/forced correction error leaves labels untouched and `remember()` resolves (covered in T1.1/T2.1).

#### Acceptance criteria

- The hardened GOAL passes with the real LLM (`gpt-4o-mini`): EN→EN labels, PT→PT labels.
- Full suite (`npm test`) green (zero regressions); typecheck + lint clean.
- Live re-verify: against the running dev stack (rebuilt image), an EN remember's `GET /v1/scopes/user/:id/entities` shows EN labels (no `surfar`/`fins de semana`).

#### Definition of done

- `npm test` full suite green; `npm run build` succeeds (dist reflects src for the GOAL).
- `/code-quality` verdict ∈ {PASS, PASS_WITH_CAVEATS}.
- Live EN entity-label re-verify captured in the implementation report.
- CHANGELOG `[Unreleased]` has the EG-5 entry.
- Plan archived after `/review` READY_TO_MERGE + merge.

## Dependency Graph

- T1.1 (module + unit) → blocks T2.1 (pipeline consumes it) → blocks T3.1 (GOAL needs it wired). Safe order T1.1 → T2.1 → T3.1.

## Coverage Matrix

| # | Goal claim / requirement | Detail | Task |
|---|---|---|---|
| 1 | Aggregate-detect label language (reuse eld) | joined distinct labels, excl user | T1.1 |
| 2 | Corrective translation MAP with referential integrity | same surface→same translation on names + relation endpoints | T1.1 |
| 3 | Preserve the literal user token | excluded from the map | T1.1 |
| 4 | Fail-soft on correction error (defensive apply) | keep originals; map[x] ?? x | T1.1 |
| 5 | Wire correction into the real write pipeline | runs after fact guard, before linkEntities | T2.1 |
| 6 | extraction_label_language_mismatch OTel event | typed literal + emit with corrected count | T2.1 |
| 7 | remember never fails on a label-guard error | dedicated try/catch | T2.1 |
| 8 | No new dependency / schema / migration / export | reuse eld; additive union only | T2.1 |
| 9 | Hardened real-LLM GOAL (EN labels EN, PT labels PT) | non-cognate absent-translation | T3.1 |
| 10 | Live re-verify graph/entities labels EN | dev-stack entities endpoint | T3.1 |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| The map LLM call mistranslates a proper name (e.g. "Acme") | Medium | The prompt pins "preserve proper names"; proper names are usually language-neutral; a wrong map value is bounded to that label + observable (`corrected` count). | implementer |
| Extra LLM call per `remember()` that extracts entities (ALWAYS-ON; detect-gating is unreliable for mixed short labels) | Low | One bounded call regardless of label count; only when the input language is detected + ≥1 non-speaker label. A future optimization merges it with the EG-4 fact-correction call (Unresolved Questions). Disclosed in CHANGELOG. | reviewer |
| Renamed entity collides with an existing node of the target language | Low | This is the DESIRED dedup convergence (Princípio 2) — two language variants resolving to one node is correct, not a defect. | reviewer |
| `eld` mis-detects the joined labels | Low | Same `null`-on-uncertain fail-soft as EG-4 → no correction, labels kept (no regression vs today). | implementer |

## Unresolved Questions

- Should the corrective map call be merged with the EG-4 fact-correction call to save one round-trip when BOTH facts and labels mismatch? Resolution: keep them SEPARATE in EG-5 (KISS; the fact guard already shipped; merging is a future optimization, not correctness). Documented; no silent scope creep.

## Global Definition of Done

- [ ] T1.1–T3.1 complete with green TDD.
- [ ] `npm test` full suite green; `npm run typecheck` + `npm run lint` clean; `npm run build` succeeds.
- [ ] Hardened real-LLM GOAL passes (EN labels EN, PT labels PT) + live dev-stack entity-label re-verify captured.
- [ ] `/deps-audit` no-op (no new dep; eld already CLEAN).
- [ ] `/code-quality` verdict ∈ {PASS, PASS_WITH_CAVEATS}.
- [ ] No paper names in `src/**`/tests.
- [ ] CHANGELOG `[Unreleased]` updated (Fixed).
- [ ] `/review` returns READY_TO_MERGE.
- [ ] Plan archived to `completed/` after merge.
