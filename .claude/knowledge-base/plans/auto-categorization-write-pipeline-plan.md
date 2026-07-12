# Plan: Default-on LLM auto-categorization in the write pipeline

> **Version 1.1** — absorbs the `/edge-case-plan` MUST-FIX items (EC-1 length cap + EC-2 trim/normalize on the LLM path; EC-3/EC-4/EC-5 tests; EC-6/EC-7 documentation notes) from `knowledge-base/reviews/auto-categorization-write-pipeline-edge-cases-2026-07-12.md`.
>
> **Version 1.0** — TheMemory today stores a `category` ONLY when the caller supplies one (`RememberOptions.category`); the LLM extraction pipeline deliberately does NOT infer it (the category-filter plan's operator-only-inference decision). This plan adds **default-on LLM auto-categorization**: the existing extraction LLM call also emits a per-fact `category` (piggybacked, mirroring `attributed_to`), chosen from a HYBRID taxonomy (fixed configurable list preferred, free-form fallback otherwise). An explicit caller category always wins; there is NO backfill; the enrichment is fail-soft (a categorization miss never fails `remember()`) and observable (a new OTel event). The dashboard `category` column (already working) then shows a category for every new memory instead of `—`.

## Goal

> "Enable every TheMemory `remember()` write to auto-assign a `category` via the existing extraction LLM call so that new memories carry a non-null category without caller input, measured by `vitest run --config vitest.contract.config.ts` on the new integration test `auto-categorization pipeline populates payload.category from the LLM draft when no operator category is supplied` returning green."

## Context

The `/dogfood` UI run (2026-07-11) surfaced that the dashboard **Memories** tab shows `—` in the CATEGORY column for every seeded memory. Investigation confirmed this is not a bug: the read path works end-to-end (themory `metadata.category` → BFF top-level `category` → dashboard column; verified by creating a memory with `category:"preferences"` which rendered correctly). The `—` appears because those memories were written via plain `remember(text)` with no category, and TheMemory's current design (the category-filter plan's operator-only-inference decision) treats category as **operator-supplied vocabulary, not model-derived**.

The project owner directed (2026-07-12) that categorization become **automatic and default-on** so the UX is populated out of the box, with three locked design decisions: HYBRID taxonomy (fixed list + free-form fallback), default-on (explicit caller category still wins), and NO backfill of existing rows.

This is a net-new feature. The P0 feature freeze was lifted 2026-06-21 (full unfreeze), so new features proceed via the normal cycle; the P0 hardening quality bar still applies.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/memory-event.ts` | 184 | `6100394` (2026-06-23) | Typed `MEMORY_EVENTS` union (Princípio 3 observability) consumed by `emitEvent` | Existing 16 literals stay; `MemoryEvent` derived type stays `(typeof MEMORY_EVENTS)[number]` |
| `packages/core/src/domain/options.ts` | 318 | `6100394` (2026-06-23) | `RememberOptions` / `RecallOptions` / config types; `category?: string` at line 70 with the "Inference contract (ADR D1)" JSDoc | `RememberOptions.category` stays `readonly category?: string`; operator-supplied precedence stays; no breaking rename |
| `packages/core/src/domain/extraction/prompt.ts` | 195 | `6100394` (2026-06-23) | Builds the extraction prompt + the zod schema the LLM output is parsed against (`attributed_to: z.string().optional()` at line 172) | JSON contract stays backward-compatible; new field is OPTIONAL (old outputs still parse) |
| `packages/core/src/domain/extraction/pipeline.ts` | 710 | `6100394` (2026-06-23) | The 8-phase write pipeline; propagates `attributed_to` (line 595-597) and operator `category` (line 604-605) into `payload` | Operator `options.category` precedence (line 604) is preserved; `remember()` never throws on enrichment; existing `attributed_to` propagation untouched |
| `packages/core/src/domain/extraction/taxonomy.ts` (NEW) | 0 | — | (file to be created) — default taxonomy constant + source-classification helper | — |
| `packages/core/src/domain/extraction/taxonomy.test.ts` (NEW) | 0 | — | (file to be created) — RED tests for the taxonomy helper | — |
| `packages/core/src/domain/memory-event.test.ts` (NEW or existing) | 0 | — | RED test asserting the new event literal is in the union | — |
| `packages/core/src/domain/extraction/prompt.test.ts` (existing: `packages/core/src/domain/extraction-prompt.test.ts`) | — | `6100394` | Existing prompt/schema tests | Extend, do not break existing assertions |
| `packages/core/src/domain/extraction-pipeline-autocategory.test.ts` (NEW) | 0 | — | (file to be created) — integration RED tests for the LLM-category propagation + precedence + fail-soft | — |

Every file in a `#### Files to edit` block below appears in this table.

### Current callers / dependents

- **Symbol:** `runExtractionPipeline(...)` in `packages/core/src/domain/extraction/pipeline.ts`
  - **Callers (production):** the `Memory.remember()` composition in `packages/core/src/domain/` (the pipeline is the write path invoked by every `remember()`); reached from `packages/core/src/index.ts` factory wiring.
  - **Callers (tests):** `packages/core/src/domain/extraction-pipeline.test.ts`, `packages/core/src/domain/extraction-pipeline-category.test.ts`, `packages/core/src/domain/extraction-phase7.test.ts`.
  - **External (public API consumed by other repos):** indirect — the REST `POST /v1/remember` (`packages/api`) and MCP tools call `remember()`; the OUTPUT contract change (a memory now carries `metadata.category`) is additive and already surfaced by the gateway BFF `category` column. No signature break.
- **Symbol:** `RememberOptions.category` in `packages/core/src/domain/options.ts:70`
  - **Callers (production):** `pipeline.ts:213` (verbatim path) and `pipeline.ts:604` (LLM path).
  - **External:** the API layer maps `POST /v1/remember` body `category` → `RememberOptions.category`. Unchanged (still honored, now as the override).
- **Symbol:** `MEMORY_EVENTS` in `packages/core/src/domain/memory-event.ts:16`
  - **Callers (production):** `emitEvent(tracer, <literal>, ...)` throughout the pipeline; `MemoryEvent` type derived at line 159.
  - **External:** no — internal observability union.

### Domain glossary

- **write pipeline** — the 8-phase `runExtractionPipeline` that turns a `remember()` input into persisted memory rows (extract → embed → dedup → persist).
- **draft / extracted fact** — one `{ id, text, attributed_to?, linked_memory_ids? }` object the LLM emits per fact in the extraction JSON; the plan adds an optional `category` to this shape.
- **operator-supplied category** — a `category` passed by the caller in `RememberOptions`; per the current ADR D1 it is the ONLY source of category today.
- **payload** — the `Record<string, string|number|boolean|null>` written to the vector store; the pgvector store hoists `payload['category']` to the top-level `category` column.
- **fixed taxonomy** — a configurable closed list of category labels the LLM is instructed to prefer.
- **suggested category** — a free-form label the LLM emits when no fixed-taxonomy label fits (the hybrid fallback).

### Architecture boundaries affected

- **Domain layer only** (`packages/core/src/domain/**`) — no interface/application/infrastructure crossing. The change lives inside the existing extraction domain module. Per `rules/architecture.md § 1`, the domain defines the contract; no adapter changes are required (the pgvector store already hoists `payload['category']`).
- **DIP:** reuses the existing `LLM` DIP (`packages/core/src/domain/dip/llm.ts`) — no new port, no new dependency (`rules/parsimony-ladder.md` rung 4).

## Prior Art & Related Work

- **Internal plan — `.claude/knowledge-base/plans/themory-category-filter-server-side-plan.md`** — the READ/filter side of category (its operator-only-inference decision "category is operator vocabulary, NOT model-derived" is superseded here by this plan's ADR D1; its immutability contract and its NULL-does-not-match filter semantic are preserved). This plan is its write-side complement.
- **Code precedent — `attributed_to`** — the per-fact LLM-emitted field this plan mirrors exactly: the LLM emits it per draft (`packages/core/src/domain/extraction/prompt.ts:172` zod optional; `packages/core/src/domain/extraction/pipeline.ts:595-597` optional propagation). Auto-categorization reuses that proven, in-tree pattern.
- **Rule — `rules/no-paper-names-in-code.md`** — no paper/marketing names in `src/**` identifiers, comments, or tests.
- **Rule — `rules/error-handling.md § 1` (fail-fast) + § 5** — enrichment that is NOT core correctness (categorization) is fail-soft; a swallowed *categorization* miss is acceptable ONLY because it is observable (OTel event) and the memory itself still persists.
- **Rule — `rules/parsimony-ladder.md` rung 4** — reuse the already-installed LLM call rather than adding a second round-trip.

## Dependencies

This plan introduces **NO new dependency** (parsimony ladder rung 4 — reuse what is installed).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `zod` | `^3` (as declared in `packages/core/package.json`) | npm | The extraction output schema (`prompt.ts`) already uses `zod`; adding `category: z.string().optional()` reuses it |
| (internal) `LLM` DIP | n/a (in-repo `packages/core/src/domain/dip/llm.ts`) | — | The extraction call already runs; auto-categorization piggybacks its output — no new client, no new provider SDK |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | — | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Objective

- [ ] The extraction LLM output schema accepts an OPTIONAL per-fact `category` (backward-compatible; old outputs still parse).
- [ ] The extraction prompt instructs the LLM to pick a fixed-taxonomy label, or emit a short free-form label when none fits (hybrid) — asserted by `prompt_lists_the_taxonomy`.
- [ ] When the caller supplies `options.category`, it OVERRIDES the LLM-inferred category (operator precedence preserved).
- [ ] When the caller supplies NO category and auto-categorization is enabled (default), the LLM-inferred category is written to `payload['category']`.
- [ ] Auto-categorization is default-on with an off-switch in config; disabling it restores the operator-only behavior — asserted by `disabled_flag_restores_operator_only`.
- [ ] A categorization miss (LLM omits/malforms `category`) NEVER fails `remember()`; the memory persists with `category` unset.
- [ ] A new typed OTel event records each auto-assignment with a `source` attribute (`taxonomy` vs `suggested`).
- [ ] No backfill: existing rows keep `category = NULL` (design ADR D5; no migration in the diff).

## ADRs

### D1 — Auto-categorization piggybacks on the existing extraction LLM call (mirrors `attributed_to`); supersedes the category-filter plan's operator-only-inference decision
- **Decision:** Extend the extraction prompt + zod schema so the LLM emits an optional `category` per fact in the SAME call that already extracts facts and `attributed_to`. The pipeline reads `extracted[i].category` in the existing per-fact loop.
- **Rationale:** The extraction LLM call already runs on every `remember()`; adding one field to its output contract is zero extra round-trips (parsimony rung 4). `attributed_to` proves the exact pattern is sound in this codebase. `themory-category-filter-server-side` ADR D1 deliberately made category operator-only; the project owner (2026-07-12) reversed that intent for UX. This plan explicitly supersedes ADR D1 and updates the `RememberOptions.category` JSDoc accordingly.
- **Alternatives considered:** A separate dedicated categorization LLM call after extraction — REJECTED: a second round-trip per `remember()` adds latency + token cost for a field the existing call can emit (parsimony rung 4 + KISS).
- **Consequences:** Enables non-null categories for free; couples category quality to the extraction model; requires updating the ADR D1 JSDoc so the codebase does not contradict itself.

### D2 — Hybrid taxonomy: fixed configurable list preferred, free-form fallback; source tracked in the OTel event, NOT a new column
- **Decision:** Ship a `DEFAULT_CATEGORY_TAXONOMY` constant (e.g. `personal`, `preferences`, `work`, `relationships`, `location`, `health`, `technical`, `financial`, `other`), overridable via config. The prompt lists it and instructs the LLM to pick one, or emit a short free-form label when none fits. A helper classifies each assigned label as `taxonomy` (in the list) or `suggested` (free-form); that classification is recorded ONLY in the OTel event attribute — the persisted value stays a plain string in the existing `category` column.
- **Rationale:** A closed list keeps the dashboard filter (`themory-category-filter-server-side`) meaningful and avoids label explosion; the fallback keeps expressiveness. Tracking `source` in observability (not a new persisted `category_source` column) means NO schema migration — the `category` column already exists (KISS, YAGNI).
- **Alternatives considered:** (a) Free-form only — REJECTED: inconsistent labels (`job` vs `work`) pollute the filter. (b) A new `category_source` column — REJECTED: a schema migration for a distinction only ops-observability needs today (YAGNI).
- **Consequences:** The persisted category is a flat string (dashboard-compatible today); if the UI later needs to visually flag "suggested", that is a follow-up that reads the OTel signal or re-derives via the taxonomy list.

### D3 — Default-on with an off-switch; explicit caller category always wins
- **Decision:** Add an `autoCategorize` config knob (default `enabled: true`). When the caller passes `options.category`, it is written verbatim and the LLM category is ignored (operator precedence). When absent and enabled, the LLM category is written. When disabled, behavior is exactly today's (operator-only).
- **Rationale:** The owner chose default-on for immediate UX. Operator precedence preserves the existing immutability/operator-vocabulary contract (the category-filter plan's immutability contract) for callers who DO supply a category. The off-switch is a non-breaking escape hatch.
- **Alternatives considered:** Opt-in default-off — REJECTED: the owner directive is default-on; opt-in leaves the dashboard empty by default (the very problem this plan fixes).
- **Consequences:** Every `remember()` now writes a category by default; a deployment that wants the old behavior sets `autoCategorize.enabled = false`.

### D4 — Fail-soft: a categorization miss never fails `remember()`
- **Decision:** If the LLM omits `category`, emits a non-string, or the field fails zod, the fact still persists with `category` unset; an OTel event records the miss. Category assignment is wrapped so no exception from the enrichment path can propagate out of the per-fact loop.
- **Rationale:** Category is enrichment, not core correctness (`rules/error-handling.md § 5` — distinguish recoverable enrichment from a real failure). Losing a memory because categorization hiccupped would be a far worse outcome. Mirrors the `attributed_to` optional-propagation precedent (an absent `attributed_to` is simply not written).
- **Alternatives considered:** Hard-fail `remember()` on categorization error — REJECTED: violates fail-soft; a non-critical enrichment must never destroy the primary write.
- **Consequences:** A degraded LLM silently yields uncategorized memories (visible via the OTel event volume), never lost memories.

### D5 — No backfill: new writes only
- **Decision:** Auto-categorization applies to `remember()` calls from this change forward. Pre-existing rows keep `category = NULL`.
- **Rationale:** Mirrors the established no-backfill precedents (`v1-1` `attributed_to` EC-1; `themory-category-filter-server-side` EC-9). A mass backfill is LLM cost over the full history + idempotency complexity for marginal value.
- **Alternatives considered:** A batch/reflect backfill job — REJECTED (deferred, YAGNI): can be a separate plan if demand appears.
- **Consequences:** The dashboard shows categories for new memories only; old rows stay `—` (honest, matches the no-backfill precedent).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Category quality is only as good as the extraction model; a weak model may mislabel or over-use `other` | Medium | Taxonomy is configurable; `source` in the OTel event lets ops measure the `suggested`/`other` ratio and tune the taxonomy/prompt | Memory team |
| Label explosion from the free-form fallback pollutes the dashboard filter | Medium | The prompt strongly prefers the fixed list; the OTel `source=suggested` metric surfaces drift; taxonomy can be tightened | Memory team |
| Adding a field to the extraction prompt could perturb the existing fact/`attributed_to` extraction quality | Medium | The new field is additive + optional; existing extraction tests must stay green (regression gate); prompt change is minimal | Memory team |
| Default-on changes existing single-tenant behavior (memories that were `—` are now categorized) | Low | Non-breaking (additive enrichment); off-switch restores prior behavior; no schema migration | Memory team |

## Unresolved Questions

- Q1 — What is the final fixed taxonomy list? (This plan ships a sensible default; the owner may tune it. Not a merge blocker — it is a config constant.)
- Q2 — Should the LLM emit ONE category per fact, or is a single batch-level category acceptable when the LLM extracts N facts from one input? (Plan default: per-fact, mirroring `attributed_to`; `/edge-case-plan` to confirm the multi-fact case.)
- Q3 — Does a `suggested` (free-form) label need to be visually distinguished in the dashboard, or is the OTel signal enough for now? (Plan default: OTel only; UI distinction is a deferred follow-up per ADR D2.)

## Dependency Graph

```
Phase 1 (contract: event + config + taxonomy) ──▶ Phase 2 (prompt + schema) ──▶ Phase 3 (pipeline wiring) ──▶ Phase 4 (integration validation)
```

All phases are sequential: Phase 2 needs the taxonomy constant from Phase 1; Phase 3 needs the schema field from Phase 2; Phase 4 exercises the whole chain.

---

## Phase 1: Contract — event literal, config knob, taxonomy constant

**Objective:** Add the observability event, the config knob, and the hybrid-taxonomy constant + source-classifier that the later phases consume.

### T1.1 — Add the `category_auto_assigned` event literal

#### Objective
Add one typed literal to `MEMORY_EVENTS` so each auto-assignment is observable (Princípio 3).

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — appends `'category_auto_assigned'` to the `MEMORY_EVENTS` array with a doc comment describing its attributes (`source`, `fact_count`).
2. **Why it is necessary now** — the pipeline (Phase 3) will call `emitEvent(tracer, 'category_auto_assigned', …)`; the literal must exist in the union first or the typed `emitEvent` call will not type-check (ADR D4 observability requirement).

#### Evidence
`packages/core/src/domain/memory-event.ts:16` defines `MEMORY_EVENTS`; `:159` derives `MemoryEvent = (typeof MEMORY_EVENTS)[number]`. The existing `extraction_zero_facts`/`dedup_skipped` literals are the precedent for an IGNORE/enrichment event.

#### Files to edit
```
packages/core/src/domain/memory-event.ts — add 'category_auto_assigned' literal + doc comment
packages/core/src/domain/memory-event.test.ts — RED test asserting the literal is present (create if absent)
```

#### Deep file dependency analysis
- `memory-event.ts` today (Baseline row) holds the union consumed by `emitEvent`. Adding a literal widens `MemoryEvent`; no caller breaks (union widening is backward-compatible). Downstream `emitEvent` in `pipeline.ts` (Phase 3) will use it.

#### Deep Dives
- Invariant: existing 16 literals stay verbatim; the derived-type expression stays unchanged. Edge case: the doc comment must not contain a paper/marketing name (`rules/no-paper-names-in-code.md`).

#### Tasks
1. Add `'category_auto_assigned'` to the `MEMORY_EVENTS` array with a one-line attribute doc.
2. Add/extend a test asserting `MEMORY_EVENTS.includes('category_auto_assigned')`.

#### TDD
```
RED:     memory_events_includes_category_auto_assigned() — asserts the literal is in MEMORY_EVENTS (fails before the edit)
GREEN:   add the literal
REFACTOR: None expected
VERIFY:  npm test -- memory-event
```

#### Concurrency tests
_Posture:_ (none — single-threaded)

#### Acceptance Criteria
- [ ] `MEMORY_EVENTS` contains `category_auto_assigned`; `MemoryEvent` still derives from it.
- [ ] No paper/marketing name in the added comment — `grep` of the paper-name token list returns 0 hits.
- [ ] Pass: lint — `npm run lint` zero warnings on the file.
- [ ] Pass: size — file ≤ 500 lines.

#### DoD
- [ ] `npm test -- memory-event` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings
- [ ] CHANGELOG `[Unreleased]` updated

### T1.2 — Add the hybrid taxonomy constant + source classifier + config knob

#### Objective
Create `DEFAULT_CATEGORY_TAXONOMY` + a `classifyCategorySource(label, taxonomy)` helper, and add the `autoCategorize` config knob; update the `RememberOptions.category` JSDoc to supersede ADR D1.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — creates `extraction/taxonomy.ts` with the default list + a pure `classifyCategorySource` returning `'taxonomy' | 'suggested'`; adds an `autoCategorize?: { enabled?: boolean; taxonomy?: readonly string[] }` config type; edits the `RememberOptions.category` JSDoc so it no longer asserts "the LLM does NOT auto-derive a category" (that is now false).
2. **Why it is necessary now** — Phase 2 needs the taxonomy list to build the prompt; Phase 3 needs the classifier for the OTel `source` attribute and the config knob for the on/off + precedence logic (ADR D2, D3). Leaving the stale JSDoc would make the codebase contradict itself (`rules/no-paper-names` sibling honesty principle).

#### Evidence
`options.ts:52-54` currently states: "**Inference contract (ADR D1)**: category is OPERATOR-supplied; the LLM extraction pipeline does NOT auto-derive a category". `options.ts:164-188` shows the `reranker` config-knob JSDoc precedent for adding a `LocalMemoryConfig`-style option. No existing taxonomy constant (`grep` for `personal|preferences|relationships` in `prompt.ts` returned nothing).

#### Files to edit
```
packages/core/src/domain/extraction/taxonomy.ts (NEW) — DEFAULT_CATEGORY_TAXONOMY + classifyCategorySource()
packages/core/src/domain/extraction/taxonomy.test.ts (NEW) — RED tests for the classifier + default list shape
packages/core/src/domain/options.ts — add autoCategorize config type; update RememberOptions.category JSDoc (supersede ADR D1)
```

#### Deep file dependency analysis
- `taxonomy.ts` (NEW) is a leaf pure module (no imports beyond types) — safe to add. `options.ts` (Baseline row) adds a config field; existing consumers of `RememberOptions`/config are unaffected (new field is optional). The JSDoc edit is documentation-only.

#### Deep Dives
- `DEFAULT_CATEGORY_TAXONOMY`: `readonly string[]` — `['personal','preferences','work','relationships','location','health','technical','financial','other']`.
- `classifyCategorySource(label: string, taxonomy: readonly string[]): 'taxonomy' | 'suggested'` — case-insensitive membership test; returns `'taxonomy'` if `label` matches a taxonomy entry, else `'suggested'`.
- Config type: `autoCategorize?: { enabled?: boolean; taxonomy?: readonly string[] }`. Default resolution (in Phase 3): `enabled ?? true`, `taxonomy ?? DEFAULT_CATEGORY_TAXONOMY`.
- Invariant: the taxonomy list contains no paper/marketing name; `classifyCategorySource` is pure/deterministic (no clock/RNG).

#### Pseudo-code / Signatures
```pseudocode
DEFAULT_CATEGORY_TAXONOMY = ['personal','preferences','work','relationships','location','health','technical','financial','other']

function classifyCategorySource(label, taxonomy):
  norm = label.trim().toLowerCase()
  return taxonomy.some(t => t.toLowerCase() === norm) ? 'taxonomy' : 'suggested'

# Example
input:  ('work', DEFAULT_CATEGORY_TAXONOMY)      -> 'taxonomy'
input:  ('side-hustle', DEFAULT_CATEGORY_TAXONOMY) -> 'suggested'
```

#### Tasks
1. Create `taxonomy.ts` with the constant + `classifyCategorySource`.
2. Add the `autoCategorize` config field to the relevant config interface in `options.ts`.
3. Rewrite the `RememberOptions.category` JSDoc: caller category is now an OVERRIDE of the default LLM auto-categorization (cite this plan ADR D1/D3); remove the false "does NOT auto-derive" sentence.

#### TDD
```
RED:     classify_returns_taxonomy_for_listed_label() — 'work' -> 'taxonomy'
RED:     classify_returns_suggested_for_unlisted_label() — 'side-hustle' -> 'suggested'
RED:     classify_is_case_insensitive() — 'Work' -> 'taxonomy'
RED:     default_taxonomy_is_non_empty_and_lowercase() — shape assertion
GREEN:   implement taxonomy.ts
REFACTOR: None expected
VERIFY:  npm test -- taxonomy
```

#### Concurrency tests
_Posture:_ (none — single-threaded)

#### Acceptance Criteria
- [ ] `classifyCategorySource` returns `'taxonomy'`/`'suggested'` per the tests; case-insensitive.
- [ ] `RememberOptions.category` JSDoc no longer claims the LLM does not auto-derive; cites this plan.
- [ ] No paper/marketing name in the taxonomy or comments — `grep` of the paper-name token list returns 0 hits.
- [ ] Pass: coverage — `npm test` ≥ 90% on `taxonomy.ts` (pure module → 100% reachable).
- [ ] Pass: lint / size — zero warnings; files ≤ 500 lines.

#### DoD
- [ ] `npm test -- taxonomy` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings
- [ ] CHANGELOG `[Unreleased]` updated

---

## Phase 2: Prompt + schema — the LLM emits a per-fact `category`

**Objective:** Teach the extraction LLM to emit an optional `category` per fact, chosen from the taxonomy with a free-form fallback.

### T2.1 — Add `category` to the extraction prompt + zod schema

#### Objective
Extend the extraction prompt with the hybrid-taxonomy instruction and add `category: z.string().optional()` to the output schema, mirroring `attributed_to`.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — injects the fixed taxonomy list + a "pick one, or a short free-form label if none fits" instruction into the prompt, adds `category` to the JSON shape example, and adds `category: z.string().optional()` to the zod schema (next to `attributed_to`).
2. **Why it is necessary now** — Phase 3 reads `extracted[i].category`; that field only exists if the schema parses it and the prompt asks for it. The optionality keeps old/degenerate LLM outputs parseable (ADR D4 fail-soft).

#### Evidence
`prompt.ts:73` JSON shape `{ "memory": [{ "id", "text", "attributed_to", "linked_memory_ids"? }] }`; `prompt.ts:172` `attributed_to: z.string().optional()`. The taxonomy list comes from T1.2's `DEFAULT_CATEGORY_TAXONOMY` (or the configured list threaded in).

#### Files to edit
```
packages/core/src/domain/extraction/prompt.ts — add category to the prompt text + JSON example + zod schema (optional); accept the taxonomy list as a builder input
packages/core/src/domain/extraction-prompt.test.ts — RED: schema parses an output WITH category; RED: schema still parses an output WITHOUT category; RED: prompt text lists the taxonomy
```

#### Deep file dependency analysis
- `prompt.ts` (Baseline row) builds the prompt + schema. Adding an optional schema field is backward-compatible (old outputs parse). If the prompt builder is a pure function, thread the taxonomy as a parameter (default `DEFAULT_CATEGORY_TAXONOMY`) so `pipeline.ts` can pass the configured list. Downstream: `pipeline.ts:400/455` types the parsed `extracted` array — T3.1 widens that type.

#### Deep Dives
- zod: `category: z.string().optional()` — never `.min(1)` here (fail-soft: an empty/malformed value is tolerated at parse, filtered in the pipeline).
- Prompt instruction (paraphrase, no paper names): "Assign each fact a single lowercase `category`. Prefer one of: <taxonomy>. If none fits, use a short (≤ 64 chars) lowercase label." The **lowercase** hint (EC-2) keeps auto-labels consistent with the lowercase `DEFAULT_CATEGORY_TAXONOMY` and the exact-match dashboard filter.
- **EC-4 (empty taxonomy):** when the configured taxonomy is `[]`, the prompt still asks for a `category` but omits the "Prefer one of:" clause (no dangling empty list) — pure free-form mode; `classifyCategorySource(x, [])` returns `'suggested'`.
- Invariant: existing `attributed_to`/`linked_memory_ids` schema + prompt assertions stay green.

#### Tasks
1. Add `category` to the JSON-shape example line + the field-description block.
2. Inject the taxonomy list into the prompt (parameter with default).
3. Add `category: z.string().optional()` to the schema.

#### TDD
```
RED:     schema_parses_output_with_category() — { memory:[{id,text,category}] } parses, category preserved
RED:     schema_parses_output_without_category() — backward-compat, category undefined
RED:     prompt_lists_the_taxonomy() — the built prompt contains each default taxonomy label
RED:     empty_taxonomy_still_requests_a_label() — EC-4: taxonomy=[] -> prompt asks for category, no dangling "Prefer one of:" empty list
RED:     prompt_instructs_lowercase() — EC-2: the prompt asks for a lowercase label
GREEN:   implement the prompt + schema change
REFACTOR: None expected
VERIFY:  npm test -- extraction-prompt
```

#### Concurrency tests
_Posture:_ (none — single-threaded)

#### Acceptance Criteria
- [ ] Schema parses outputs with AND without `category` (backward-compatible).
- [ ] Prompt text contains the taxonomy labels — asserted by `prompt_lists_the_taxonomy`.
- [ ] Existing prompt/schema tests stay green (regression gate) — `npm test -- extraction-prompt` returns exit 0.
- [ ] No paper/marketing name added — `grep` of the paper-name token list returns 0 hits.
- [ ] Pass: lint / size / coverage on the changed file.

#### DoD
- [ ] `npm test -- extraction-prompt` green (new + pre-existing)
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings
- [ ] CHANGELOG `[Unreleased]` updated

---

## Phase 3: Pipeline wiring — propagate the LLM category with operator precedence, fail-soft, OTel

**Objective:** Write the LLM-inferred category into `payload['category']` when the caller supplied none and auto-categorization is enabled, fail-soft, with the observability event.

### T3.1 — Propagate `extracted[i].category` with operator override + fail-soft + event

#### Objective
In the per-fact loop, when `options.category === undefined` and `autoCategorize.enabled !== false`, set `payload['category'] = extracted[i].category` (when present + valid), emit `category_auto_assigned`, and never throw.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — widens the `extracted` array type with `category?: string`; adds an operator-precedence branch to the existing `category` propagation at `pipeline.ts:604`; classifies the source via `classifyCategorySource`; emits the OTel event; wraps the read so a malformed value cannot throw.
2. **Why it is necessary now** — this is the actual behavior change; everything before it (event, config, taxonomy, schema) exists solely to make this task type-check and stay observable + fail-soft (ADR D1/D3/D4).

#### Evidence
`pipeline.ts:604-605`: `if (options?.category !== undefined) payload['category'] = options.category;` — the operator path. `pipeline.ts:595-597`: the `attributed_to` optional-propagation precedent. `pipeline.ts:400/455`: the `extracted` element type `{ id; text; attributed_to?; linked_memory_ids? }` to widen.

#### Files to edit
```
packages/core/src/domain/extraction/pipeline.ts — widen extracted type with category?; add operator-precedence + LLM-category branch; emit category_auto_assigned; fail-soft wrap; thread taxonomy/config to the prompt builder
packages/core/src/domain/extraction-pipeline-autocategory.test.ts (NEW) — RED tests (see TDD)
```

#### Deep file dependency analysis
- `pipeline.ts` (Baseline row) — the per-fact loop persists `payload`. This task adds a conditional after the existing operator-`category` line. Operator precedence: if `options.category` is set, keep today's behavior EXACTLY (do not overwrite with LLM). Downstream: the pgvector store already hoists `payload['category']` (no store change). The verbatim `infer:false` path (line 213) is NOT auto-categorized (no LLM ran) — it keeps operator-only behavior; document that as an edge case.

#### Deep Dives
- Precedence logic (per fact):
  - `options.category !== undefined` → `payload['category'] = options.category` (unchanged; no event).
  - else if `autoCategorize.enabled !== false` and `typeof extracted[i].category === 'string'` → **trim + bound-check (EC-1/EC-2/EC-5):** `const c = extracted[i].category.trim(); if (c.length >= 1 && c.length <= 64) { payload['category'] = c; emitEvent(tracer, 'category_auto_assigned', { source: classifyCategorySource(c, taxonomy), fact_count: 1 }); }` — the SAME 1-64 bound the operator path enforces (`pipeline.ts:353`), but **fail-soft here** (out-of-bound → leave unset, NEVER throw `InvalidScope`, per ADR D4).
  - else → leave `category` unset (no throw, no event; the memory persists uncategorized — ADR D4).
- **EC-1 (length cap):** the LLM path applies the operator path's 1-64 char bound, but a violation drops the value (fail-soft) instead of throwing — an oversized LLM label must never corrupt the exact-match filter column nor fail `remember()`.
- **EC-2 (normalize):** the stored value is `.trim()`ed (and the prompt requests lowercase) so an auto-label matches the exact-match dashboard filter (`themory-category-filter-server-side` ADR D5) and is consistent with operator labels.
- **EC-5 (whitespace-only):** `"   "` trims to length 0 → treated as absent (no write, no event).
- **EC-6 (verbatim path):** the `infer:false` verbatim path (`pipeline.ts:213`) runs NO LLM, so it is NOT auto-categorized — a `remember(text, { infer:false })` with no operator category yields an uncategorized memory. This is intentional (ADR D1 single-round-trip: no separate categorization call).
- **EC-7 (re-remember idempotency):** on a dedup collision (same fact hash), the UPSERT does NOT overwrite `category` (the category-filter plan's immutability contract, first-write wins), so a non-deterministic auto-category on a second `remember()` of the same fact leaves the original intact.
- Fail-soft: the LLM-category read is inside the existing loop; the `typeof` + bound guards make it a total function so no exception can propagate (KISS — prefer guards over try/catch); if any residual throw were possible it is swallowed at the enrichment boundary so `remember()` never fails (ADR D4).
- Invariant: `attributed_to` propagation (595-597) untouched; operator `category` precedence (604) preserved; verbatim path (213) unchanged.

#### Pseudo-code / Signatures
```pseudocode
# inside the per-fact loop, replacing lines ~604-605
if options?.category !== undefined:
  payload['category'] = options.category            # operator wins (unchanged)
elif autoCategorize.enabled !== false:
  cat = extracted[i]?.category
  if typeof cat === 'string':
    c = cat.trim()                                  # EC-2 normalize
    if c.length >= 1 and c.length <= 64:            # EC-1 bound (fail-soft, no throw)
      payload['category'] = c
      emitEvent(tracer, 'category_auto_assigned', { source: classifyCategorySource(c, taxonomy), fact_count: 1 })
    # else (EC-1 oversized / EC-5 whitespace-only): leave unset, fail-soft
  # else: non-string dropped by zod at parse (EC-3); leave unset

# Example
input:  remember("Bob loves hiking"), options={}, LLM draft {text:"Bob enjoys hiking", category:"preferences"}
output: payload.category === "preferences"; event category_auto_assigned{source:"taxonomy"}

input:  remember("x"), options={category:"work"}, LLM draft {..., category:"preferences"}
output: payload.category === "work"  (operator wins; no auto event)

input:  remember("y"), options={}, LLM draft {..., category:"  a-very-long-label-over-sixty-four-characters-................................"}
output: payload.category unset  (EC-1: >64 after trim, dropped fail-soft; remember() still returns the row)
```

#### Tasks
1. Widen the `extracted` element type with `category?: string` (lines 400 + 455).
2. Add the precedence branch after the operator-`category` line.
3. Emit `category_auto_assigned` with `source` + `fact_count`.
4. Thread the configured taxonomy/enabled flag from the Memory config into the prompt builder + this branch.
5. Guard the read so no malformed value throws.

#### TDD
```
RED:     autocategory_populates_when_no_operator_category() — no options.category, LLM draft has category -> payload.category === draft category
RED:     operator_category_overrides_llm() — options.category set -> payload.category === operator value, LLM category ignored, no auto event
RED:     disabled_flag_restores_operator_only() — autoCategorize.enabled=false + no operator category -> payload.category unset
RED:     failsoft_when_llm_omits_category() — LLM draft without category -> memory still persists, payload.category unset, remember() does NOT throw
RED:     emits_category_auto_assigned_event_with_source() — stub tracer records the event with source attribute
RED:     autocategory_drops_oversized_label() — EC-1: LLM category > 64 chars -> payload.category unset, remember() does NOT throw (no InvalidScope)
RED:     autocategory_trims_and_stores() — EC-2: LLM category "  work " -> payload.category === "work"
RED:     autocategory_drops_non_string() — EC-3: LLM category 123/null dropped by zod -> unset, no throw
RED:     autocategory_drops_whitespace_only() — EC-5: LLM category "   " -> unset (trim length 0)
GREEN:   implement the branch + type widening + threading
REFACTOR: extract a small pure helper if the branch exceeds ~10 lines (SRP)
VERIFY:  npm test -- extraction-pipeline-autocategory
```

#### Concurrency tests
_Posture:_ (none — single-threaded)

#### Acceptance Criteria
- [ ] LLM category populates `payload.category` when no operator category and enabled — asserted by `autocategory_populates_when_no_operator_category`.
- [ ] Operator category overrides; no auto event fires in that case — asserted by `operator_category_overrides_llm`.
- [ ] Disabled flag restores operator-only behavior — asserted by `disabled_flag_restores_operator_only`.
- [ ] Fail-soft: LLM omitting/malforming category never fails `remember()`; memory persists uncategorized.
- [ ] EC-1: an LLM category > 64 chars (after trim) is DROPPED fail-soft (no write, no `InvalidScope` throw).
- [ ] EC-2: the stored auto-category is `.trim()`ed (matches the exact-match filter); prompt requests lowercase.
- [ ] EC-5: a whitespace-only LLM category is treated as absent — asserted by `autocategory_drops_whitespace_only`.
- [ ] `category_auto_assigned` fires with a `source` attribute (only when a value is actually written).
- [ ] `attributed_to` propagation + verbatim path behavior unchanged — `npm test` full contract suite returns exit 0.
- [ ] Pass: complexity ≤ 10 on the changed function; coverage ≥ 90% on changed lines (fail-soft branch: 100%); lint zero; file ≤ 500 lines (pipeline.ts is 710 today — this task adds a small branch; if it pushes a function over budget, extract the helper per SRP rather than inlining).

#### DoD
- [ ] `npm test` green (full contract suite — no regression)
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings
- [ ] CHANGELOG `[Unreleased]` updated

---

## Phase 4: Integration Validation

**Objective:** Prove the whole chain end-to-end with a stub LLM and confirm the full quality gate.

### T4.1 — End-to-end pipeline test + full gate

#### Objective
Run the full extraction pipeline with a stub LLM emitting per-fact categories and assert the persisted payload + precedence + fail-soft + event, then run the whole contract gate.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — drives `runExtractionPipeline` with a `StubVectorStore` + a stub `LLM` returning drafts with `category`, asserting the persisted `payload.category` for the auto, override, disabled, and fail-soft cases; then runs `npm test && npm run typecheck && npm run lint`.
2. **Why it is necessary now** — the unit tests in Phase 3 mock at the branch level; this integration test proves the schema (Phase 2) + branch (Phase 3) compose correctly through the real pipeline, which is the plan's Goal metric.

#### Evidence
`extraction-pipeline-category.test.ts` already drives `runExtractionPipeline` with a `StubVectorStore` (lines 22-55 shown in baseline) — the exact harness to extend for the auto-categorization case.

#### Files to edit
```
packages/core/src/domain/extraction-pipeline-autocategory.test.ts (NEW) — the integration cases (extends the existing StubVectorStore harness)
```

#### Deep file dependency analysis
- Reuses the `StubVectorStore`/stub-LLM harness from `extraction-pipeline-category.test.ts` (DRY — do not reinvent the stubs). Asserts on `store.inserted[i].category`.

#### Deep Dives
- The Goal test name: `auto-categorization pipeline populates payload.category from the LLM draft when no operator category is supplied`.
- Invariant: the same harness that proves operator-category (existing test) must still pass.

#### Tasks
1. Add the integration test with the four cases (auto / override / disabled / fail-soft) + event assertion.
2. Run the full gate.

#### TDD
```
RED:     auto-categorization pipeline populates payload.category from the LLM draft when no operator category is supplied() — THE GOAL TEST
RED:     integration_operator_override() — operator category wins through the full pipeline
RED:     integration_failsoft_persists_uncategorized() — LLM omits category -> row persisted with category unset
GREEN:   (covered by Phase 2 + 3 implementation; this phase writes the tests + confirms)
REFACTOR: None expected
VERIFY:  npm test && npm run typecheck && npm run lint
```

#### Concurrency tests
_Posture:_ (none — single-threaded)

#### Failure scenarios

The extraction LLM is external I/O (pre-existing call; this plan does not add a new external dependency, but it does consume a new field from the LLM output). The categorization-specific failure modes:

| Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|
| LLM omits `category` on a draft | stub LLM returns a draft without `category` | memory persists with `category` unset; `remember()` returns normally; no `category_auto_assigned` event for that fact |
| LLM returns a non-string / empty `category` | stub returns `category: ""` (or a non-string that zod drops to `undefined`) | treated as absent (fail-soft, ADR D4); memory persists uncategorized |
| LLM extraction call itself fails / times out | (pre-existing behavior — unchanged by this plan) | existing pipeline error handling applies; categorization adds no new failure surface |

#### Acceptance Criteria
- [ ] THE GOAL TEST `auto-categorization pipeline populates payload.category from the LLM draft when no operator category is supplied` passes.
- [ ] Operator-override + fail-soft integration cases pass — `integration_operator_override` + `integration_failsoft_persists_uncategorized` green.
- [ ] Full contract suite green (no regression) — `npm test` returns exit 0.
- [ ] Pass: `npm run typecheck` zero errors; `npm run lint` zero warnings; coverage ≥ 90% on changed files.

#### DoD
- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings
- [ ] CHANGELOG `[Unreleased]` updated with the feature entry
- [ ] File-size budget respected (per `architecture.md`)

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | LLM emits a per-fact category (piggyback on extraction call) | T2.1, T3.1 | zod `category` field + prompt instruction; pipeline reads `extracted[i].category` |
| 2 | Hybrid taxonomy (fixed list + free-form fallback) | T1.2, T2.1 | `DEFAULT_CATEGORY_TAXONOMY` + prompt "pick one or short label"; `classifyCategorySource` |
| 3 | Explicit caller category always wins | T3.1 | operator-precedence branch before the LLM branch |
| 4 | Default-on with off-switch | T1.2, T3.1 | `autoCategorize.enabled` (default true) config knob honored in the branch |
| 5 | Fail-soft (categorization never fails remember()) | T3.1, T4.1 | `typeof` guard + no-throw enrichment boundary; fail-soft integration test |
| 6 | Observable (OTel event) | T1.1, T3.1 | `category_auto_assigned` literal + `emitEvent` with `source` |
| 7 | No backfill (new writes only) | (design — ADR D5) | no migration/job; existing rows keep `category=NULL` |
| 8 | Supersede `themory-category-filter-server-side` ADR D1 | T1.2 (JSDoc) + ADR D1 | JSDoc rewritten; ADR names + supersedes the prior decision |
| 9 | No paper names in code | T1.1, T1.2, T2.1, T3.1 | enforced per `rules/no-paper-names-in-code.md` in every changed file + test |
| 10 | Dashboard `category` column shows the new value | T4.1 | the integration test proves `payload.category` populates; the gateway BFF `category` column (verified 2026-07-11) reads it — no dashboard change needed |
| 11 | EC-1 — LLM category length cap (1-64, fail-soft) | T3.1 | trim + bound guard drops out-of-range labels without throwing |
| 12 | EC-2 — normalize stored auto-category (trim + lowercase) | T2.1, T3.1 | `.trim()` on store + lowercase prompt hint; matches exact-match filter |
| 13 | EC-3 — non-string LLM category | T2.1, T3.1 | zod `.string().optional()` drops it; `typeof` guard confirms |
| 14 | EC-4 — empty taxonomy config | T1.2, T2.1 | prompt omits the "Prefer one of:" clause; classify returns `suggested` |
| 15 | EC-5 — whitespace-only LLM category | T3.1 | trim length 0 → treated as absent |
| 16 | EC-6 — verbatim (`infer:false`) path not auto-categorized | T3.1 (documented) | intentional (no LLM ran; ADR D1 single round-trip) |
| 17 | EC-7 — re-remember does not change stored category | T3.1 (documented) | category-filter immutability contract (first-write wins on dedup UPSERT) |

**Coverage: 17/17 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed — every task `status=committed` in `.progress-auto-categorization-write-pipeline.json`
- [ ] All tests passing — `npm test` (vitest contract) green
- [ ] Zero type errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] Coverage ≥ 90% on changed files (fail-soft branch 100%)
- [ ] File-size budget respected (per `rules/architecture.md`); if `pipeline.ts` grows past budget, extract a helper (SRP)
- [ ] CHANGELOG `[Unreleased]` updated (Added: default-on auto-categorization; Changed: supersede category-filter ADR D1 operator-only inference contract)
- [ ] `rules/no-paper-names-in-code.md` respected across `src/**` — `grep` of the paper-name token list returns 0 hits
- [ ] THE GOAL TEST (`auto-categorization pipeline populates payload.category from the LLM draft when no operator category is supplied`) green
