---
slug: entity-extraction-noise-filter
milestone_id: EntityExtractionNoiseFilter
created_at: 2026-06-23
goal: Add a shared deterministic entity-noise filter at the linkEntities chokepoint so pronoun/contraction/generic-role/verb-fragment nodes (I'm, m reading, love science, user) are dropped from the entity-graph on BOTH the LLM-primary and compromise-fallback paths, measured by a GOAL integration test where remember() of a known sentence persists Dune + Frank Herbert and excludes the 4 noise tokens.
---

# Plan: entity-extraction-noise-filter

> **Version 1.1** — EG-2 of the entity-graph-dogfood-remediation-roadmap. v1.1 absorbs the `/edge-case-plan` MUST FIX items EC-1 (capitalized-proper exception so `Love Island`/`Watch Dogs` survive) + EC-2 (narrowed COMMON_BASE_VERB to perception/desire verbs only, so `watch list`/`think tank`/`read me` survive) + SHOULD-TEST EC-3 (possessive kept) + EC-4 (non-vacuous GOAL) + DOCUMENT EC-5 (standalone `People` accepted). See `.claude/knowledge-base/reviews/entity-extraction-noise-filter-edge-cases-2026-06-23.md`. A real end-user Chrome-MCP dogfood of TheMemory v0.20.0 (real OpenAI) showed the entity-graph + Entities tab polluted with noise nodes (`I'm`, `m reading`, `love science`, `user`) alongside good ones (Dune, Frank Herbert, Japan, ramen, trains). This plan adds ONE shared, pure, deterministic noise filter applied at the `linkEntities`/`upsertNodes` chokepoint — which covers BOTH node sources (LLM-primary AND compromise-fallback) — plus minimal defense-in-depth in the compromise extractor. Pure domain logic, ZERO new dependency, NO public export, NO migration, NO DIP widening (ADR-0008). Evolves the existing Postgres entity-graph (NO graph DB — Item 14 declined).

## Goal

> "Enable the entity-graph to drop pronoun/contraction/generic-role/verb-fragment nodes at the `linkEntities` chokepoint (covering both the LLM-primary and compromise-fallback node sources) so the Entities/Graph surfaces show only real entities, measured by `tests/integration/entity-noise-filter.test.ts` where `remember()` of `\"I'm reading Dune by Frank Herbert and I love science fiction novels\"` against real `ankane/pgvector:v0.5.1` persists entities INCLUDING `Dune` + `Frank Herbert` and EXCLUDING `I'm`, `m reading`, `love science`, and `user`."

## Context

The 2026-06-23 live-test + Chrome-MCP end-user dogfood (`.claude/knowledge-base/roadmaps/entity-graph-dogfood-remediation-roadmap.md` § EG-2) surfaced that the Entities tab + Graph view + the distinct-entities aggregation are polluted: for the seeded memory `"I'm reading Dune by Frank Herbert and I love science fiction novels"`, the stored entities included `I'm`, `m reading`, `love science` and the generic `user` — none are real entities. The good nodes (Dune, Frank Herbert, Japan, ramen, trains, Paulo, software engineer, hiking) appeared alongside them, so the failure is precision (over-extraction), not recall.

Root cause (already investigated — see Baseline Context): nodes are LLM-PRIMARY via `linkEntities()`, with `CompromiseEntityExtractor` as the English-only fallback. The single chokepoint `upsertNodes()` filters ONLY by `length >= 2` + relation-predicate + dedup — it applies NO pronoun/contraction/generic/verb-fragment filter, and crucially the LLM-primary path has NO content filter at all. The compromise extractor's `cleanCandidateName()` strips boundary function-words but misses contractions (`I'm`, `m`), base-form-verb-led compounds (`love science` — `love` is deliberately NOT in `CONJUGATED_VERB`), and generic role words (`user`).

This plan is hardening of an already-shipped surface (the entity-graph). It honors `CLAUDE.md § Princípio 2` (priorização/diversidade > volume) + Princípio 3 (fail-soft + observable). Scope: `packages/core` ONLY.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/extraction/entity-noise-filter.ts` (NEW) | 0 | — | (file to be created) — pure deterministic noise predicate | — |
| `packages/core/src/domain/extraction/entity-noise-filter.test.ts` (NEW) | 0 | — | (file to be created) — unit tests for the predicate | — |
| `packages/core/src/domain/extraction/entity-linking.ts` | 270 | `63284d3` (2026-06-22) | Phase-7 node + edge linking; `upsertNodes()` is the single chokepoint both node sources flow through | fail-soft (a linking error MUST NEVER fail `remember()`); LLM-primary + compromise-fallback branches unchanged in shape; multilingual surface names preserved; EC-2/EC-3 guards kept |
| `packages/core/src/domain/extraction/entity-linking.test.ts` (NEW) | 0 | — | (file to be created) — unit test that `upsertNodes` drops noise on both paths | — |
| `packages/core/src/infrastructure/extraction/compromise-entity-extractor.ts` | 272 | `7d10204` (2026-06-20) | default `EntityExtractor`; `cleanCandidateName()` strips boundary function-words | `cleanCandidateName` stays exported for its existing tests; multilingual proper nouns (`São`, `José`) preserved; QUOTED bypass kept |
| `packages/core/src/infrastructure/extraction/compromise-entity-extractor.test.ts` | ~+ | `7d10204` (2026-06-20) | 14 existing unit tests for the extractor | existing assertions stay green |
| `tests/integration/entity-noise-filter.test.ts` (NEW) | 0 | — | (file to be created) — GOAL integration test vs real pgvector | — |

### Current callers / dependents

- **Symbol:** `linkEntities()` in `packages/core/src/domain/extraction/entity-linking.ts:75`
  - **Callers (production):** the write pipeline `packages/core/src/domain/extraction/pipeline.ts` (Phase 7). Enumerate: `grep -rln 'linkEntities' --include='*.ts' packages/core/src | grep -v test`.
  - **Callers (tests):** none today (no `entity-linking.test.ts`) — this plan adds the first.
  - **External (other repos):** NO — `linkEntities` is package-internal (not in `packages/core/src/index.ts`).
- **Symbol:** `cleanCandidateName()` in `packages/core/src/infrastructure/extraction/compromise-entity-extractor.ts:81` (exported)
  - **Callers (production):** `pushUnique()` in the same file (`:136`).
  - **Callers (tests):** `compromise-entity-extractor.test.ts`.
  - **External:** NO — package-internal export for testability (precedent for §9 internal-helper testing).
- **Symbol (NEW):** `isEntityNoise()` in the new `entity-noise-filter.ts` — consumed by `upsertNodes()` (both branches) and, optionally for defense-in-depth, by the compromise extractor. NOT added to `packages/core/src/index.ts` (internal).

### Domain glossary

- **node (entity)** — a row in `entities` (resolved per `(scope, normalized_key)`), surfaced in the Entities/Graph dashboard tabs.
- **LLM-primary path** — `linkEntities` upserts nodes from `llmEntities` (the write-pipeline LLM's multilingual entity list) when present.
- **compromise-fallback path** — when the LLM emitted no entities, `CompromiseEntityExtractor.extract(text)` supplies English-only nodes.
- **chokepoint** — `upsertNodes()`: the single function both node sources pass through before persistence; the correct single locus for a shared filter.
- **noise node** — a stored "entity" that is actually a pronoun/contraction (`I'm`, `m`), a generic role word (`user`), or a verb-led/clause fragment (`love science`, `m reading`).

### Architecture boundaries affected

- **`packages/core/src/domain/`** — the new filter is pure domain logic (no I/O), consistent with `architecture.md § 3` (domain owns pure logic; no import from `local/`/`cloud/`). The filter lives next to `entity-linking.ts` under `domain/extraction/`.
- **No DIP widening** — `EntityExtractor` + `MemoryEntityStore` interfaces UNCHANGED (ADR-0008 method counts preserved). The filter is a free function, not a port method.
- **No public API change** — `architecture.md § 9`: the filter is NOT added to `src/index.ts`; it is package-internal and unit-tested directly (same precedent as the exported-for-test `cleanCandidateName`).

## Prior Art & Related Work

- **Internal blueprint:** `.claude/knowledge-base/discoveries/blueprints/entity-relation-extraction-no-graphdb-blueprint.md` — D1 (compromise as the TS-native extractor with regex fallback) + the LLM-primary node decision.
- **Reference project:** `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/utils/entity_extraction.ts` — our `CompromiseEntityExtractor` was ported from it (same `GENERIC_HEADS` shape, lines ~18+). The new filter extends the same stoplist philosophy with pronoun/contraction/generic-role coverage that the port omitted.
- **Internal ADR:** ADR-0008 (DIP method counts) — constrains the fix to NOT add a port method.
- **Roadmap:** `.claude/knowledge-base/roadmaps/entity-graph-dogfood-remediation-roadmap.md § EG-2`.

## Objective

- [ ] A new pure `isEntityNoise(name): boolean` predicate exists and is unit-tested (drops the noise set; keeps the recall set incl. multilingual proper nouns).
- [ ] `upsertNodes()` drops noise on BOTH the LLM-primary AND the compromise-fallback path (single chokepoint), unit-tested.
- [ ] The compromise extractor's `cleanCandidateName()` gains defense-in-depth for contractions + base-form-verb-led compounds, with existing tests still green.
- [ ] GOAL integration test passes against real pgvector: `Dune` + `Frank Herbert` persisted; `I'm` / `m reading` / `love science` / `user` absent.
- [ ] Fail-soft preserved: a thrown filter never fails `remember()`.

## ADRs

### D1 — Deterministic shared filter at the chokepoint (NOT compromise-POS-only)
- **Decision:** implement a pure deterministic `isEntityNoise(name)` (stoplists + structural rules) and apply it inside `upsertNodes()`, the single function both node sources flow through.
- **Rationale:** the LLM-primary path (the dominant source per Baseline) currently has NO content filter — fixing only the compromise extractor would leave LLM noise (`user`) unfiltered. A pure function at the chokepoint fixes both paths in one place (DRY/SRP) and works dependency-free (KISS — `architecture.md § 7`).
- **Alternatives considered:** (a) replace `nouns().out('array')` with compromise POS-tag filtering (`.match('#Noun')` minus `#Pronoun`/`#Verb`/`#Copula`) — REJECTED: compromise is an OPTIONAL lazy dep, so a POS-only approach does nothing on the regex-fallback path AND nothing on the LLM path; it also adds coupling to compromise's tag taxonomy. (b) Filter only in the compromise extractor — REJECTED: misses the LLM-primary noise.
- **Consequences:** one new pure module; both paths cleaned; compromise POS may still augment later (non-blocking). Stoplists are English-biased — see D2.

### D2 — Drop only KNOWN English noise tokens; never drop unknown tokens (multilingual safety)
- **Decision:** `isEntityNoise` returns true ONLY for tokens matching explicit English pronoun/contraction/generic-role stoplists or structural rules (single function word, contraction-suffix-only, verb-led 2-word compound). Unknown / non-English tokens are KEPT.
- **Rationale:** nodes are multilingual (the LLM emits surface names in the input language). A broad heuristic risks dropping legitimate non-English entities (`São Paulo`, `José`). Bias to precision-loss-avoidance: only drop what we KNOW is noise (`CLAUDE.md § Princípio 2` favors the right entities, but not at the cost of silently deleting real foreign ones).
- **Alternatives considered:** language-detect + per-language stoplists — REJECTED (YAGNI; +dependency; the observed noise is English structural fragments). ASCII-folding to normalize — REJECTED (would corrupt `São`→`Sao`).
- **Consequences:** some non-English noise may slip through (acceptable; better than dropping real entities). English coverage is the 80/20 win.

### D3 — `fiction novels` is KEPT (borderline compound), not dropped
- **Decision:** the GOAL test asserts the 4 unambiguous noise tokens are dropped; `fiction novels` is treated as an acceptable-keep.
- **Rationale:** `fiction novels` is a grammatically real compound noun phrase (modifier `fiction` + head `novels`); dropping it would require dropping legitimate compounds, hurting recall (the failure mode we are NOT introducing). Precision target is pronouns/contractions/verbs/generics, not low-value-but-real noun phrases.
- **Alternatives considered:** add `novels`/`fiction` to a stoplist — REJECTED (arbitrary; opens a slippery slope of topic-word banning). 
- **Consequences:** `fiction novels` remains a node. Documented so reviewers do not flag it as a miss.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Over-aggressive stoplist drops a legitimate entity (e.g. a band literally named "User") | Medium | D2 limits drops to KNOWN English noise + structural rules; keep set in unit tests includes edge proper nouns; precision-biased, recall-protected | core |
| English bias leaves some non-English noise unfiltered | Low | Accepted per D2 (better than dropping real foreign entities); revisitable if a future dogfood shows non-English noise | core |
| Filter throws and breaks `remember()` | High | The filter is pure + total (no I/O, no regex backtracking on unbounded input — names are ≤ a few tokens); applied inside the existing Phase-7 try/catch which is fail-soft (Princípio 3); a unit test asserts a pathological input returns a boolean, never throws | core |

## Unresolved Questions

- Q1 — Should `fiction novels` (and similar borderline compounds) eventually be demoted? Deferred per D3; revisit only if dogfood evidence shows they hurt UX.
- Q2 — Should the LLM extraction prompt ALSO be tightened to emit fewer junk entities (upstream of this filter)? That is EG-4's neighbor / a separate concern; this plan filters at persistence, language-agnostic. Out of scope here.

## Dependencies

**(none — ZERO new dependency.)** This plan adds only a pure in-package domain module (`entity-noise-filter.ts`) consumed by existing in-package code (`entity-linking.ts`, `compromise-entity-extractor.ts`). No new npm package is introduced, used, or removed. `compromise` remains the existing OPTIONAL lazy dep (untouched). No version pin changes. No registry fetch. Rule 9 (Não Reinvente) N/A — no library would replace a 1-file pure stoplist predicate (a dependency would be heavier than the code).

## Dependency Graph

```
Phase 1 (pure filter + unit tests) ──▶ Phase 2 (wire at chokepoint + extractor DiD) ──▶ Phase 3 (GOAL integration + full gate)
```

Sequential: Phase 2 imports the Phase 1 module; Phase 3 exercises the wired result.

---

## Phase 1: Pure noise filter

**Objective:** create the dependency-free `isEntityNoise` predicate with full unit coverage.

### T1.1 — `isEntityNoise` pure predicate + unit tests

#### Objective
A pure, total, deterministic `isEntityNoise(name: string): boolean` that returns `true` when the name is a pronoun/contraction/generic-role/verb-fragment that should NOT be a node.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — introduces `packages/core/src/domain/extraction/entity-noise-filter.ts` exporting `isEntityNoise`, with stoplists (pronouns, pronoun-contractions, generic roles) + structural rules (single function word; token that is only a contraction remnant like `m`/`s`; 2-word compound whose first token is a common base-form verb like `love`/`like`/`want`).
2. **Why it is necessary now** — per D1 the chokepoint needs ONE shared predicate; building it pure-and-first (TDD) lets Phase 2 wire a proven function. Cite Baseline `entity-linking.ts:97` (the filter-less chokepoint) + ADR D1/D2.

#### Evidence
- Noise observed in the dogfood: `I'm`, `m reading`, `love science`, `user` (roadmap § EG-2; reproduced in `packages/core` Entities tab during the 2026-06-23 run).
- `compromise-entity-extractor.ts:65` `CONJUGATED_VERB` deliberately excludes base forms (`love`), so `love science` survives today — the new predicate's verb-led-compound rule closes it.

#### Files to edit
```
packages/core/src/domain/extraction/entity-noise-filter.ts — NEW: export isEntityNoise + the stoplist constants
packages/core/src/domain/extraction/entity-noise-filter.test.ts — RED tests first (drop set + keep set + totality)
```

#### Deep file dependency analysis
- New module, no current dependents. Phase 2 will import `isEntityNoise` into `entity-linking.ts` (domain→domain, allowed). No `local/`/`cloud/` import (architecture § 3).

#### Deep Dives
- **Signature:** `export function isEntityNoise(name: string): boolean`.
- **Stoplists (UPPER_SNAKE_CASE Sets, lowercased compare):** `PRONOUNS` (i, me, we, us, you, he, him, she, her, they, them, it), `PRONOUN_CONTRACTIONS` (i'm, i've, i'd, i'll, we're, we've, you're, they're, he's, she's, it's, that's, there's), `CONTRACTION_REMNANTS` (m, re, ve, ll, d, s — single-letter/2-letter apostrophe remnants), `GENERIC_ROLE` (user, users, person, people, someone, somebody, anyone, everybody, everyone, thing, things).
- **`COMMON_BASE_VERB` (NARROWED per EC-2):** perception/desire/cognition verbs ONLY — `{love, like, want, need, hate, enjoy, prefer, dislike}`. Action verbs (`read`, `watch`, `play`, `make`, `take`, `get`, `see`, `think`, `feel`) are DELIBERATELY EXCLUDED because they head legitimate noun compounds (`watch list`, `read me`, `play station`, `make file`, `think tank`, `feel good`) — including them would regress recall. The narrowed set still drops the observed noise `love science` (love ∈ set).
- **Structural rules:** (a) after lowercasing+trim, if the whole name ∈ any stoplist → noise; (b) single token that is a CONTRACTION_REMNANT → noise; (c) exactly 2 tokens where token[0] ∈ COMMON_BASE_VERB **AND the ORIGINAL `tokens[0]` does NOT start with an uppercase letter** (the capitalized-proper exception, EC-1 — rescues `Love Island`, `Watch Dogs`, `Read Only`) → noise (`love science`); `m reading` is caught by rule (b) on the remnant `m`; (d) otherwise → NOT noise (keeps unknown/foreign tokens per D2).
- **Totality / invariant:** never throws for any string (incl. empty, whitespace, unicode, very long); returns a boolean always.
- **Edge cases:** empty/whitespace → treat as noise (true) — but note `upsertNodes` already drops <2 chars, so this is belt-and-suspenders; `"São Paulo"` → false (kept); `"José"` → false; `"User"` (capitalized) → still noise via GENERIC_ROLE lowercased compare (a generic role is generic regardless of case); `"Love Island"` → false (kept, EC-1 capitalized-proper exception); `"watch list"` → false (kept, EC-2 action verb excluded); `"user's"` (possessive) → false/KEPT (EC-3 — low harm, KISS, pinned by a test); standalone `"People"` → true/dropped (EC-5 — accepted; the *People* brand case appears as the 2-word `"People magazine"` which is kept).

#### Pseudo-code / Signatures
```pseudocode
function isEntityNoise(name):
  s = name.trim().toLowerCase()
  if s.length == 0: return true
  tokens = s.split(/\s+/)
  if tokens.length == 1:
    if PRONOUNS.has(s) or PRONOUN_CONTRACTIONS.has(s) or CONTRACTION_REMNANTS.has(s) or GENERIC_ROLE.has(s): return true
    return false
  if tokens.length == 1..n and whole s in (PRONOUN_CONTRACTIONS): return true   # "i'm"
  if tokens.length == 2:
    if CONTRACTION_REMNANTS.has(tokens[0]): return true                          # "m reading"
    origFirst = name.trim().split(/\s+/)[0]                                       # original case
    firstIsProper = /^\p{Lu}/u.test(origFirst)                                   # EC-1
    if COMMON_BASE_VERB.has(tokens[0]) and not firstIsProper: return true        # "love science", NOT "Love Island"
  return false

# Examples
isEntityNoise("I'm")          -> true
isEntityNoise("m reading")    -> true
isEntityNoise("love science") -> true
isEntityNoise("user")         -> true
isEntityNoise("Dune")         -> false
isEntityNoise("Frank Herbert")-> false
isEntityNoise("São Paulo")    -> false
isEntityNoise("Love Island")  -> false   # EC-1 capitalized-proper exception
isEntityNoise("watch list")   -> false   # EC-2 action verb excluded
isEntityNoise("think tank")   -> false   # EC-2
isEntityNoise("user's")       -> false   # EC-3 possessive kept (KISS)
```

#### Tasks
1. Write RED tests (drop set + keep set + totality) FIRST.
2. Create `entity-noise-filter.ts` with the stoplists + rules to GREEN them.
3. REFACTOR: extract the Sets as module consts; no behavior change.

#### TDD
```
RED:  isEntityNoise drops the observed noise set — it("drops pronoun/contraction/generic/verb-fragment nodes") asserts true for ["I'm","m reading","love science","user","I","me","we","i've","User","People"]
RED:  isEntityNoise keeps the recall set — it("keeps real entities incl. multilingual + verb-homograph compounds") asserts false for ["Dune","Frank Herbert","Japan","ramen","trains","software engineer","machine learning","São Paulo","José","fiction novels","Love Island","watch list","think tank","read me","People magazine","user's"]
RED:  totality — it("never throws + always returns boolean") over ["","   ","\n","x".repeat(5000),"🜲","O'Brien"] returns a boolean (and "O'Brien" stays false — Irish surname, not a contraction remnant)
GREEN: implement entity-noise-filter.ts
REFACTOR: None expected (single pure function)
VERIFY: npx vitest run packages/core/src/domain/extraction/entity-noise-filter.test.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — the filter is a pure synchronous function; the only `async` in scope is the pre-existing `embedBatch` call, untouched by this plan.

#### Acceptance Criteria
- [ ] Drop set `returns true` for `["I'm","m reading","love science","user","People"]` — asserted by `npx vitest run packages/core/src/domain/extraction/entity-noise-filter.test.ts`.
- [ ] Keep set `returns false` for `["Dune","Frank Herbert","São Paulo","José","Love Island","watch list","think tank","user's"]` — same test command `exit code 0`.
- [ ] `isEntityNoise` `returns` a boolean and never throws — totality test asserts via `expect(() => isEntityNoise(x)).not.toThrow()`.
- [ ] Pass: complexity — every changed file cyclomatic `<= 10` (manual audit per `rules/architecture.md`).
- [ ] Pass: coverage `>= 100` on the new file — `npx vitest run --coverage` reports `100%`.
- [ ] Pass: lint — `npm run lint` `exit code 0` (zero warnings).
- [ ] Pass: size — file `<= 500` lines (`wc -l`).

#### DoD
- [ ] Tests green — `npx vitest run packages/core/src/domain/extraction/entity-noise-filter.test.ts`
- [ ] Zero type errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected

---

## Phase 2: Wire at the chokepoint + extractor defense-in-depth

**Objective:** drop noise on both node sources via the chokepoint, plus harden the compromise fallback.

### T2.1 — Apply `isEntityNoise` inside `upsertNodes()` (both paths)

#### Objective
Filter noise candidates in `upsertNodes()` so BOTH the LLM-primary and compromise-fallback branches are cleaned at the single chokepoint.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — adds a `.filter((e) => !isEntityNoise(e.name))` to the `upsertNodes` candidate cleaning chain (alongside the existing EC-2 length + relation-predicate + dedup filters), and adds the first `entity-linking.test.ts` unit test proving both paths drop noise.
2. **Why it is necessary now** — per D1 this is the ONLY locus that covers the LLM-primary path (which has no filter today, Baseline `entity-linking.ts:97-124`). Doing it here (not only in the extractor) is what fixes the dominant source.

#### Evidence
- `entity-linking.ts:102-110` — current `cleaned` chain has length/predicate/dedup but NO content-noise filter.
- `entity-linking.ts:131-149` — LLM path; `entity-linking.ts:150-161` — compromise path; both call `upsertNodes`, confirming it is the shared chokepoint.

#### Files to edit
```
packages/core/src/domain/extraction/entity-linking.ts — import isEntityNoise; add one filter step in upsertNodes' cleaned chain
packages/core/src/domain/extraction/entity-linking.test.ts — NEW: unit test (fake MemoryEntityStore + fake Embedder) asserting noise dropped on both LLM + compromise inputs, and fail-soft on a thrown filter is impossible (filter is total) — assert real entities still upserted
```

#### Deep file dependency analysis
- `entity-linking.ts` (Baseline row, sha `63284d3`) — `upsertNodes` gains one pure filter call; the LLM-primary and compromise branches are UNCHANGED in shape. Downstream: the write pipeline (Phase 7 caller) is unaffected (same signature). Fail-soft try/catch around linking (`entity-linking.ts:130-168`) is preserved.
- New test uses in-memory fakes for `MemoryEntityStore` + `Embedder` (no pgvector) — fast unit test.

#### Deep Dives
- **Exact change:** in the `cleaned` chain, insert `.filter((e) => !isEntityNoise(e.name))` after the EC-2 length filter and before/after the relation-predicate filter (order-independent; place after length for cheapness).
- **Invariant preserved:** EC-2 (≥2), EC-3 (cap 50), relation-predicate drop, dedup — all kept; multilingual names preserved (D2 keeps unknown tokens); fail-soft unchanged.
- **Edge case:** if filtering empties `cleaned`, the existing `if (cleaned.length === 0) return;` guard already handles it (no embed call).

#### Pseudo-code / Signatures
```pseudocode
const cleaned = candidates
  .filter(e => e.name.length >= 2 && e.normalizedKey.length >= 2)  // EC-2 (existing)
  .filter(e => !isEntityNoise(e.name))                            // NEW (D1)
  .filter(e => !relationPredicates.has(e.normalizedKey))          // existing
  .filter(dedup)                                                   // existing
  .slice(0, MAX_ENTITIES_PER_MEMORY)                              // EC-3 (existing)
```

#### Tasks
1. Write RED `entity-linking.test.ts` asserting noise dropped + real entities kept on both LLM-list input and compromise-extractor input.
2. Import `isEntityNoise`; add the filter step. GREEN.
3. REFACTOR: none expected.

#### TDD
```
RED:  it("upsertNodes drops noise from the LLM-primary path") — given llmEntities ["Dune","Frank Herbert","user","love science"], the fake MemoryEntityStore.upsertAndLink receives only ["Dune","Frank Herbert"]
RED:  it("upsertNodes drops noise from the compromise fallback path") — given an extractor returning ["Dune","I'm","m reading"], store receives only ["Dune"]
RED:  it("real entities still linked (recall preserved)") — ["São Paulo","José"] both reach the store
GREEN: add the isEntityNoise filter step
REFACTOR: None expected
VERIFY: npx vitest run packages/core/src/domain/extraction/entity-linking.test.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — the filter is a pure synchronous function; the only `async` in scope is the pre-existing `embedBatch` call, untouched by this plan.

#### Acceptance Criteria
- [ ] LLM-path test: fake store `assertEquals` received names `equals ["Dune","Frank Herbert"]` — `npx vitest run packages/core/src/domain/extraction/entity-linking.test.ts` `exit code 0`.
- [ ] Compromise-path test: fake store `contains` `"Dune"` and `returns` no noise — same test command.
- [ ] Recall test: store `contains` `["São Paulo","José"]` (multilingual preserved).
- [ ] Pass: complexity `<= 10`; coverage `>= 90` on changed lines (`npx vitest run --coverage`); `npm run lint` `exit code 0`; size `<= 500`.

#### DoD
- [ ] Tests green — `npx vitest run packages/core/src/domain/extraction/entity-linking.test.ts`
- [ ] Zero type errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`

### T2.2 — Defense-in-depth in `cleanCandidateName()` (compromise extractor)

#### Objective
Make the compromise fallback itself drop contractions + base-form-verb-led compounds, so the fallback path is clean even before the chokepoint (belt-and-suspenders + keeps the extractor's own contract honest).

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — `cleanCandidateName` (or `pushUnique`) reuses `isEntityNoise` to return `null` for `I'm` / `m reading` / `love science`, and the existing 14 tests stay green.
2. **Why it is necessary now** — the extractor is a published default `EntityExtractor`; cleaning it at the source improves any direct consumer of the extractor (not only the linking path) and keeps the two layers consistent (DRY via the shared predicate). Cite ADR D1 (shared predicate) + Baseline `compromise-entity-extractor.ts:81`.

#### Evidence
- `compromise-entity-extractor.ts:88` — `cleanCandidateName` only checks `CONJUGATED_VERB` for first/last token; base-form `love` slips through (`love science`).
- `compromise-entity-extractor.ts:136` — `pushUnique` is where `cleanCandidateName` is applied; the natural injection point.

#### Files to edit
```
packages/core/src/infrastructure/extraction/compromise-entity-extractor.ts — reuse isEntityNoise in pushUnique (after cleanCandidateName) to drop contraction/verb-led/generic noise
packages/core/src/infrastructure/extraction/compromise-entity-extractor.test.ts — add RED cases for "I'm","m reading","love science","user" dropped; keep cases green
```

#### Deep file dependency analysis
- Infra → domain import (`compromise-entity-extractor.ts` imports `isEntityNoise` from `domain/extraction/entity-noise-filter.ts`) — allowed (infra may depend on domain, architecture § 3).
- `cleanCandidateName` signature UNCHANGED (still exported for its tests). The drop happens in `pushUnique` via `isEntityNoise`, so existing `cleanCandidateName` tests are unaffected.

#### Deep Dives
- **Exact change:** in `pushUnique`, after computing `name` (post-`cleanCandidateName`), add `if (type !== 'QUOTED' && isEntityNoise(name)) return;`. QUOTED spans bypass (intentional — a quoted title may be anything).
- **Invariant:** multilingual proper nouns preserved (D2); QUOTED bypass kept; existing 14 tests green.

#### Tasks
1. RED: add extractor tests for the 4 noise tokens dropped + keep cases.
2. Wire `isEntityNoise` in `pushUnique`. GREEN.
3. REFACTOR: none expected.

#### TDD
```
RED:  it("extractor drops contraction/verb-led/generic noise") — extract("I'm reading Dune and I love science") has names that include "Dune" and exclude "I'm","m reading","love science"
RED:  it("extractor keeps multilingual proper nouns") — extract("São Paulo and José") includes "São Paulo"/"José"
GREEN: add isEntityNoise guard in pushUnique
REFACTOR: None expected
VERIFY: npx vitest run packages/core/src/infrastructure/extraction/compromise-entity-extractor.test.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — the filter is a pure synchronous function; the only `async` in scope is the pre-existing `embedBatch` call, untouched by this plan.

#### Acceptance Criteria
- [ ] Extractor `extract("I'm reading Dune...")` `contains` `"Dune"` and `returns` no `["I'm","m reading","love science"]` — `npx vitest run packages/core/src/infrastructure/extraction/compromise-entity-extractor.test.ts` `exit code 0`.
- [ ] All 14 pre-existing extractor tests still `green` — same test command `exit code 0`.
- [ ] Pass: complexity `<= 10`; coverage `>= 90` on changed lines (`npx vitest run --coverage`); `npm run lint` `exit code 0`; size `<= 500`.

#### DoD
- [ ] Tests green — `npx vitest run packages/core/src/infrastructure/extraction/compromise-entity-extractor.test.ts`
- [ ] Zero type errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Pronoun/contraction noise (`I'm`, `m reading`) dropped | T1.1, T2.1, T2.2 | predicate + chokepoint + extractor DiD |
| 2 | Verb-led compound noise (`love science`) dropped | T1.1, T2.1, T2.2 | base-verb compound rule |
| 3 | Generic-role noise (`user`) dropped — incl. LLM-primary path | T1.1, T2.1 | GENERIC_ROLE stoplist applied at the chokepoint (covers LLM path) |
| 4 | Real + multilingual entities preserved (recall) | T1.1, T2.1, T2.2 | D2 keep-unknown rule + keep-set tests |
| 5 | Fail-soft preserved (filter never fails remember) | T1.1 (totality), T2.1 | pure total function inside Phase-7 try/catch |
| 6 | End-to-end proof vs real pgvector | T3.1 | GOAL integration test |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npx vitest run` (contract) + the new files green
- [ ] Zero type errors — `npm run typecheck` (`tsc -p tsconfig.contract.json`)
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected (per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased] § Fixed`
- [ ] Backward compatibility preserved across public API (NO public export added; DIP method counts unchanged per ADR-0008)
- [ ] No paper names in `src/**` (per `no-paper-names-in-code.md`)
- [ ] Plan-specific: GOAL integration test green vs real `ankane/pgvector:v0.5.1`
- [ ] **Runtime-metric proof** — the existing `entity_linked` OTel event still fires (noise filtering does not suppress the event); observed in the GOAL integration run
- [ ] **Plan archived** — after `/review` READY_TO_MERGE + PR merged, move to `knowledge-base/plans/completed/`

## Failure scenarios

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres:entities` (pgvector, DB) | entity linking throws mid-upsert | the GOAL/unit asserts the existing Phase-7 try/catch swallows it + emits `entity_linking_failed` | `remember()` STILL returns its stored memories (fail-soft, Princípio 3); noise filter (pure, total) never the cause |
| embedder (batch embed of node names) | embed returns empty for a name | existing `F-M2` guard filters zero-dim embeddings | node skipped, no `[]::vector` persisted; unchanged by this plan |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate the filter end-to-end against a real workload.

### T3.1 — GOAL integration test vs real pgvector

#### Objective
`remember()` of the dogfood sentence persists `Dune` + `Frank Herbert` and excludes `I'm` / `m reading` / `love science` / `user`.

#### Files to edit
```
tests/integration/entity-noise-filter.test.ts — NEW: real pgvector (skipIf no THEOMEM_PG_URI); remember the sentence; query the entities for the scope; assert include/exclude sets
```

#### TDD
```
RED:  it("entity-graph excludes noise nodes end-to-end") — after remember(), the persisted entities for the user scope INCLUDE Dune + Frank Herbert and EXCLUDE I'm / m reading / love science / user
GREEN: (passes once Phase 1+2 are wired)
REFACTOR: None expected
VERIFY: npx vitest run -c vitest.integration.config.ts tests/integration/entity-noise-filter.test.ts --no-file-parallelism
```

LLM source per the project rule (NEVER mock — use a REAL LLM for the GOAL when `OPENAI_API_KEY` is exported; otherwise use the `infer:false`/caller-supplied-fact path OR a queued deterministic LLM that returns the known facts so the test is reachable in CI without a key — the entity noise is reproduced via the compromise fallback + an llmEntities list that includes the noise tokens). The assertion is on the PERSISTED entities, which is what the filter governs.

**EC-4 (non-vacuous):** the test MUST guarantee the noise tokens actually reach `upsertNodes` so the filter is genuinely exercised — assert BOTH that the include-set `{Dune, Frank Herbert}` is present AND that the exclude-set `{I'm, m reading, love science, user}` is absent, where the node source provably contained ≥1 noise token before filtering (real-LLM run asserted to emit noise, OR a queued `llmEntities` that explicitly includes the noise tokens, OR the compromise fallback over the dogfood sentence). A test where no noise was ever generated passes vacuously and is rejected.

#### Concurrency tests (only when applicable)

(none — single-threaded) — the GOAL is a sequential remember()→query assertion; the only async is the pre-existing pgvector/embedder I/O, untouched by this plan.

### Execution
```
npm run typecheck
npm run lint
npx vitest run            # contract/unit incl. the 3 new unit files
npx vitest run -c vitest.integration.config.ts tests/integration/entity-noise-filter.test.ts --no-file-parallelism
```

### Acceptance Criteria
- [ ] All unit suites `green` — `npx vitest run` `exit code 0` (filter + linking + extractor)
- [ ] GOAL integration `green` vs real pgvector — `npx vitest run -c vitest.integration.config.ts tests/integration/entity-noise-filter.test.ts` `exit code 0` (persisted entities `contains` `["Dune","Frank Herbert"]` and `returns` none of `["I'm","m reading","love science","user"]`)
- [ ] Coverage `>= 90` on changed files (`npx vitest run --coverage`; filter file `100%`)
- [ ] Zero type errors — `npm run typecheck` `exit code 0`; zero lint warnings — `npm run lint` `exit code 0`
- [ ] `metric entity_linked emits` still observed in the integration run (filtering does not suppress it)
- [ ] Fail-soft row exercised — `given` a thrown linking `when` remember() runs `then` it `returns` its stored memories

### If Validation Fails
1. Separate plan-caused failures from pre-existing (`pgvector-store.test.ts` dual-module + mem0 clone tests are known pre-existing per prior cycles).
2. Fix plan-caused failures; re-run.
3. Log pre-existing in the PR description.
