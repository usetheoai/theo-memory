# Blueprint: Domain ontologies (typed schemas over LLM extraction)

> Output of `/discover-execute domain-ontologies`. Source plan: `.claude/knowledge-base/discoveries/plans/domain-ontologies-plan.md`. 6/6 research questions answered against `.claude/knowledge-base/references/mem0` + the project's own `packages/core/src`. Decides the `Ontology` shape, the built-in registry (medical/legal/code/support), the prompt-injection + post-extraction validation locus, the opt-in config surface, and the persistence approach (reuse the shipped Postgres tables — NO poly-store) for Roadmap Item 15.

**Slug:** `domain-ontologies`
**Created:** 2026-06-22
**Verdict target:** SHIPPABLE_WITH_CAVEATS

## Context

Roadmap Item 15 needs "typed schemas per domain (medical/legal/code/support) layered over LLM extraction" with the competitive attack "typed domain ontologies WITHOUT poly-store complexity" (vs Cognee — `CLAUDE.md § Competitive superiority matrix`). TheMemory's extraction pipeline (`packages/core/src/domain/extraction/prompt.ts`) already LLM-emits `entities {name, type}` + `relations {source, relationship, destination}`, persisted to the shipped `entities` + `entity_edges` Postgres tables. The entity `type` is a free `z.string().optional()` with a fixed generic vocabulary (`PERSON|ORG|PLACE|PRODUCT|CONCEPT|OTHER`). A domain ontology TYPES this: it constrains the entity-type + relation-type vocabulary to a domain (guiding the LLM + validating its output), persisted in the SAME tables. Prior art: mem0's project-level `custom_categories` + `custom_instructions` + the categorization prompt.

## Objective

Decide the `Ontology` type, the built-in registry, the prompt-injection + post-extraction validation locus, the opt-in config surface, and the persistence approach — so `/to-plan` produces an implementation plan with zero open architectural questions.

## Executive summary

A **domain ontology** here is a typed vocabulary — `{ name, entityTypes[], relationTypes[] }` — that, when configured, (1) is INJECTED into the extraction system prompt (replacing the generic `PERSON|ORG|...` enum + relation guidance with the domain vocabulary), and (2) VALIDATES the LLM's extracted entities/relations post-extraction (out-of-vocab entity types coerce to `OTHER`; out-of-vocab relations are kept but flagged), emitting an observable OTel event per coercion (Princípio 3). It ships as a built-in registry (medical/legal/code/support) + a custom-ontology escape hatch, opt-in via a zod-validated `MemoryConfig.ontology?` slot (mirroring `entityBoost?`/`skillExecutor?`/`reranker?`). It persists in the EXISTING `entities.type` (text) + `entity_edges.relation` (text) columns — **NO new store, NO migration** (the columns already carry arbitrary text — D3 confirmed). This mirrors mem0's custom-categories pattern (domain-tuned vocabulary injected into the extraction prompt + LLM-constrained output) WITHOUT mem0's managed-only limitation (we support per-instance config) and WITHOUT poly-store.

---

## Coverage Corner 1 — Integration Tests

**Q6 — How does mem0 test domain-constrained extraction?** (`.claude/knowledge-base/references/mem0/tests/test_memory.py`, `test_project.py`)

mem0 tests categorization/custom-config by STUBBING the LLM and asserting the constrained output: the project config (`custom_categories`, `custom_instructions`) is set, a memory is added with a stubbed LLM, and the test asserts the categories/output conform to the configured vocabulary. The LLM is mocked (no real provider in unit tests).

**Borrowed test pattern for TheMemory:** the ontology-constrained extraction test injects a stub LLM that returns entities/relations with a MIX of in-vocab + out-of-vocab types; asserts (a) the prompt sent to the LLM contained the ontology vocabulary (prompt-injection proof), (b) in-vocab types persist verbatim, (c) out-of-vocab entity types coerce to `OTHER` + emit the observable event, (d) default path (no ontology configured) is byte-unchanged. The DIP/stub seam makes this a fast unit/contract test; ONE integration test against real pgvector proves an ontology-typed entity persists with its domain type in `entities.type`.

---

## Coverage Corner 2 — Dependencies

**(DEFER-CORNER from the plan — folded into Q5.) NO new dependency.**

- Ontology schema validation reuses **`zod`** (already a dep — used by `AdditiveExtractionSchema` in `extraction/prompt.ts:122` + every config validator).
- Extraction reuses the EXISTING LLM client (the ontology only changes the PROMPT + the post-parse validation; no new model, no new library).
- An ontology is a typed CONFIG object, not a model/runtime dependency. **Zero new production deps; deps-audit will confirm in cycle-plan.**

---

## Coverage Corner 3 — Tools

**Q5 — Config + registry shape (opt-in, no new dep).** (mem0 `custom_prompt`/`custom_categories` + TheMemory `LocalMemoryConfig`)

mem0 exposes domain tuning as PROJECT-level config (`custom_categories: [{name: description}]`, `custom_instructions`, `custom_prompt`) — per the platform docs, per-request overrides are NOT supported on the managed API (`setup_coding_categories.py` docstring). TheMemory can do better: a per-instance opt-in config slot.

**TheMemory `Ontology` + registry (proposed):**
```ts
export interface Ontology {
  readonly name: string;                       // 'medical' | 'legal' | 'code' | 'support' | custom
  readonly entityTypes: readonly string[];     // domain entity-type vocabulary
  readonly relationTypes: readonly string[];   // domain relation-type vocabulary
  readonly description?: string;               // injected as the domain hint
}
```
- **Built-in registry** (`BUILTIN_ONTOLOGIES`): `medical` (Symptom/Diagnosis/Medication/Procedure/Anatomy; treats/causes/indicates/contraindicates), `legal` (Party/Contract/Clause/Statute/Court; binds/breaches/cites/governs), `code` (Module/Function/Class/Dependency/Bug; calls/imports/depends_on/fixes — mirrors mem0's coding taxonomy), `support` (Customer/Issue/Product/Resolution/Agent; reports/affects/resolves/escalates).
- **Opt-in slot:** `MemoryConfig.ontology?: Ontology | OntologyName` (string = registry key; object = custom). Validated via zod at factory (mirrors `entityBoost?`, `skillExecutor?`, `recallCache?`, `reranker?` in `LocalMemoryConfig`). Default (absent) = current generic extraction, byte-unchanged.
- **Config knobs:** ontology selection only; no per-call override in v1 (KISS — matches the scope-stable extraction config; per-call could be a follow-up).

**Q4 — Persistence (D3 confirm).** (`packages/core/src/infrastructure/db/schema.ts:342`, `pg-memory-entity-store.ts:69`, `entity_edges` migration `0019`)

- `entities.type` is `text('type')` (schema.ts:342) — `pg-memory-entity-store.ts:69` INSERTs `e.type` + `:102/:119` SELECTs it (fallback `'NOUN'`). It already carries arbitrary text (compromise's `PROPER|QUOTED|COMPOUND|NOUN` AND the LLM's `PERSON|ORG|...`). **A domain entity type (`Symptom`, `Diagnosis`) fits with NO migration.**
- `entity_edges.relation` + `normalized_relation` are `text` (carry arbitrary relation labels). **A domain relation type fits with NO migration.**
- **D3 CONFIRMED: zero schema migration.** The ontology is a pure extraction-time constraint + validation layer over the shipped persistence.

---

## Coverage Corner 4 — Techniques

**Q1 — mem0 domain-vocabulary representation + prompt injection.** (`openmemory/api/app/utils/categorization.py`, `prompts.py`)

mem0's `get_categories_for_memory` sends `MEMORY_CATEGORIZATION_PROMPT` (system) + the memory text (user) to the LLM with `response_format=MemoryCategories` (Pydantic) at temperature 0, returning a constrained category list. The domain vocabulary lives in the prompt (the category taxonomy) + the project config (`custom_categories`); the LLM is CONSTRAINED to emit only from it.

**Q2 — Concrete domain taxonomy example.** (`mem0-plugin/scripts/setup_coding_categories.py`)

`CODING_CATEGORIES` is a list of `{category_name: description}` (architecture_decisions, anti_patterns, task_learnings, ...) — a worked domain ontology. Project-level, applied to every memory automatically. This is the shape our built-in `code` ontology mirrors (entity/relation vocab instead of memory categories, but the same "typed domain vocabulary injected into extraction" pattern).

**Q3 — TheMemory injection + validation locus.** (`packages/core/src/domain/extraction/prompt.ts`)

- The `SYSTEM_PROMPT` (prompt.ts:43-) hardcodes the entity-type enum (`PERSON|ORG|PLACE|PRODUCT|CONCEPT|OTHER`, lines 47/69) + relation guidance (lines 54-59).
- The `AdditiveExtractionSchema` (prompt.ts:122) validates `entities[].type` as `z.string().optional()` (line 135) + `relations[].relationship` as `z.string()` (line 143) — FREE-FORM today.
- **Injection point:** when an ontology is configured, the prompt composer substitutes the entity-type enum + relation guidance with the ontology's `entityTypes`/`relationTypes` vocabulary (+ the `description` hint).
- **Validation point:** a post-parse step (after `AdditiveExtractionSchema.parse`) checks each entity `type` against `ontology.entityTypes`; out-of-vocab → coerce to `OTHER` + emit `ontology_type_coerced` OTel event (Princípio 3 — observable, not silent). Relations out-of-vocab are KEPT (not dropped — don't lose factual links) but the event records the divergence. This is fail-soft: an ontology mismatch NEVER fails `remember()`.

---

## Cross-cutting comparison

| Dimension | mem0 (custom-categories) | TheMemory ontology (target) |
|---|---|---|
| Vocabulary shape | `[{name: description}]` categories | `{ entityTypes[], relationTypes[], description? }` |
| Scope of config | project-level only (managed API; no per-request) | per-instance opt-in (`MemoryConfig.ontology?`) — strictly more flexible |
| Injection | categorization system prompt + custom_categories | extraction `SYSTEM_PROMPT` entity/relation vocab substitution |
| Output constraint | Pydantic `MemoryCategories` + temp 0 | zod `AdditiveExtractionSchema` + post-parse vocab validation |
| Out-of-vocab policy | (re-categorized by LLM) | coerce entity type → `OTHER` + observable event; keep relations |
| Persistence | mem0 stores (vector + optional graph store) | EXISTING `entities.type` + `entity_edges.relation` (text) — NO new store, NO migration |
| Built-ins | coding taxonomy (one example) | medical / legal / code / support registry |
| Poly-store | optional graph store | NONE (the competitive attack — D3) |
| Dep cost | — | ZERO new deps (zod reuse) |

---

## ADRs

### D1 — `Ontology` = a typed entity/relation vocabulary (NOT OWL/RDF, NOT a reasoner)
**Decision:** `Ontology { name; entityTypes[]; relationTypes[]; description? }` — a flat typed vocabulary. **Rationale:** the feature is "typed schemas over extraction", not formal-ontology reasoning; KISS/YAGNI (no OWL import, no inference). mem0's custom-categories validates the flat-vocabulary shape. **Alternatives:** OWL/RDF formal ontology (rejected — over-engineering, no consumer demand), free-text custom_instructions only (rejected — not typed/validatable). **Consequences:** the ontology is a validation vocabulary, not a knowledge-representation language.

### D2 — Inject at the extraction prompt + validate post-parse; coerce out-of-vocab entity types to `OTHER` (observable), keep relations
**Decision:** substitute the entity-type enum + relation guidance in `SYSTEM_PROMPT` with the ontology vocab when configured; after `AdditiveExtractionSchema.parse`, coerce out-of-vocab entity `type` → `OTHER` + emit `ontology_type_coerced`; keep out-of-vocab relations (record divergence). **Rationale:** guiding the LLM (prompt) + validating its output (post-parse) is the mem0 pattern; coerce-not-drop preserves data; observability honors Princípio 3; fail-soft (never fails `remember()`). **Alternatives:** drop out-of-vocab entities (rejected — data loss), reject `remember()` (rejected — fail-loud on enrichment is wrong; entity/relation extraction is already fail-soft per the slices), constrain only via prompt with no validation (rejected — LLMs drift from the vocab). **Consequences:** the ontology is best-effort typing; recall/remember correctness never depends on it.

### D3 — Persist in the EXISTING `entities.type` + `entity_edges.relation` columns; NO poly-store, NO migration
**Decision:** reuse the shipped `entities.type` (text) + `entity_edges.relation`/`normalized_relation` (text) columns; the domain types are just values. **Rationale:** confirmed the columns carry arbitrary text today (`schema.ts:342`, `pg-memory-entity-store.ts:69`); the competitive thesis is "ontologies without poly-store"; Item 14 (graph backend) stays separate. Inquebrável Rule 9 + KISS. **Alternatives:** new ontology/type table (rejected — poly-store, the thing we attack), graph DB (rejected — Item 14). **Consequences:** zero migration; the ontology layer is extraction-time only.

### D4 — Opt-in via a zod-validated `MemoryConfig.ontology?` slot (built-in registry key OR custom object); default byte-unchanged
**Decision:** `MemoryConfig.ontology?: Ontology | OntologyName`; resolved + zod-validated at factory; absent = current generic extraction (byte-unchanged). **Rationale:** mirrors the shipped opt-in slot precedents (`entityBoost?`, `skillExecutor?`, `recallCache?`, `reranker?`); per-instance config beats mem0's project-only limitation. **Alternatives:** always-on with a default ontology (rejected — changes existing extraction behavior), per-call override (deferred — KISS, follow-up). **Consequences:** a new config slot + a built-in registry module; no behavior change for existing callers.

## Recommendations (one per research question)

1. **Q1/representation+injection:** `Ontology` typed vocab injected into `SYSTEM_PROMPT` (substitute the entity-type enum + relation guidance) — mirrors mem0 categorization.
2. **Q2/built-ins:** ship `BUILTIN_ONTOLOGIES` = medical/legal/code/support (the `code` one mirrors mem0's coding taxonomy shape).
3. **Q3/locus:** inject in the prompt composer; validate post-`AdditiveExtractionSchema.parse` (coerce entity type → OTHER + `ontology_type_coerced` event; keep relations).
4. **Q4/persistence:** reuse `entities.type` + `entity_edges.relation` (text) — NO migration (D3).
5. **Q5/config:** `MemoryConfig.ontology?: Ontology | OntologyName`, zod-validated at factory, opt-in, default byte-unchanged.
6. **Q6/tests:** stub-LLM unit/contract test (prompt-injection proof + in-vocab persist + out-of-vocab coerce+event + default-unchanged) + ONE integration test (domain-typed entity persists in `entities.type` vs real pgvector).

## Blocked questions
(none — 6/6 answered)
