---
slug: domain-ontologies
milestone_id: Item15
created_at: 2026-06-22
goal: Add an optional domain Ontology (typed entity/relation vocabulary) injected into the LLM extraction prompt + validated post-parse, persisted in the existing Postgres tables (no migration), measured by an integration test where a configured ontology types extracted entities and coerces out-of-vocab types to OTHER against real pgvector.
---

# Plan: domain-ontologies

> **Version 1.0** — Roadmap Item 15 (2nd opportunistic, `memory-gaps-roadmap.md`). Adds an optional domain `Ontology` (typed entity-type + relation-type vocabulary, built-ins medical/legal/code/support) injected into the extraction prompt + validated post-parse (out-of-vocab entity types coerce to `OTHER`, observable), persisted in the EXISTING `entities.type` + `entity_edges.relation` columns — NO poly-store, NO migration. Opt-in via `MemoryConfig.ontology?`. Grounded in `domain-ontologies-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89).

## Goal

> "Add an optional domain `Ontology` (typed entity/relation vocabulary) injected into the LLM extraction prompt + validated post-parse, persisted in the existing Postgres tables (no migration), measured by `tests/integration/ontology.test.ts` where a configured ontology (a) causes a domain-typed entity to persist with its domain type in `entities.type` and (b) coerces an out-of-vocab entity type to `OTHER` + emits `ontology_type_coerced`, against real `ankane/pgvector:v0.5.1`; AND the default path (no ontology) is byte-unchanged."

## Context

TheMemory's extraction pipeline (`packages/core/src/domain/extraction/prompt.ts`) LLM-emits `entities {name, type}` + `relations {source, relationship, destination}` with a fixed generic vocabulary (`PERSON|ORG|PLACE|PRODUCT|CONCEPT|OTHER`), persisted to the shipped `entities` + `entity_edges` tables. Roadmap Item 15 layers a typed domain ontology over this (competitive attack on Cognee: "typed domain ontologies WITHOUT poly-store complexity", `CLAUDE.md § Competitive superiority matrix`). The blueprint confirmed: (a) mem0's custom-categories is the prior-art pattern (domain vocabulary injected into the extraction prompt + LLM-constrained output); (b) the composer `generateAdditiveExtractionPrompt(existing, newMessages, customInstructions?)` (`prompt.ts:96`) + the post-parse seam (`extraction/pipeline.ts:369` `AdditiveExtractionSchema.parse`) are the integration points; (c) `ExtractionDeps` (`pipeline.ts:45`) already threads `customInstructions?`; (d) the `entities.type` (text, `schema.ts:342`) + `entity_edges.relation` (text) columns carry arbitrary domain types TODAY — **NO migration** (D3). The opt-in slot precedent: `MemoryConfig`/`LocalMemoryConfig.{entityBoost?, skillExecutor?, recallCache?, reranker?}`.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariant to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/ontology.ts` (NEW) | 0 | — | `Ontology` type + `BUILTIN_ONTOLOGIES` + `resolveOntology` + zod validator | — |
| `packages/core/src/domain/ontology.test.ts` (NEW) | 0 | — | unit tests (registry, resolve, validation) | — |
| `packages/core/src/domain/extraction/prompt.ts` | ~150 | (slice2) | `generateAdditiveExtractionPrompt` (`:96`) + `SYSTEM_PROMPT` + `AdditiveExtractionSchema` (`:122`) | additive `ontology?` param renders a vocab directive; default (absent) byte-unchanged |
| `packages/core/src/domain/extraction/prompt.test.ts` | (exists) | — | prompt composer tests | add ontology-injection cases |
| `packages/core/src/domain/extraction/pipeline.ts` | ~550 | (slice2) | extraction orchestrator; `ExtractionDeps` (`:45`), composer call (`:338`), parse (`:369`) | additive post-parse ontology validation/coercion; `ExtractionDeps.ontology?` thread; default path byte-unchanged |
| `packages/core/src/domain/extraction/pipeline.test.ts` (or `extraction-pipeline.test.ts`) | (exists) | — | pipeline unit tests | add coercion + event cases |
| `packages/core/src/domain/memory-event.ts` | (exists) | — | MEMORY_EVENTS typed union | additive `ontology_type_coerced` literal |
| `packages/core/src/domain/memory-event.test.ts` | (exists) | — | event union tests | bump count + assert new member |
| `packages/core/src/domain/memory-store.ts` | ~230 | — | `MemoryConfig` (`:203`) | additive `ontology?` slot |
| `packages/core/src/infrastructure/db/factory.ts` (or `index.ts`) | — | — | builds `ExtractionDeps` from config | resolve `config.ontology` → `ExtractionDeps.ontology` |
| `packages/core/src/domain/index.ts` + `packages/core/src/index.ts` | — | — | public barrels | additive `Ontology`/`BUILTIN_ONTOLOGIES`/`OntologyName` exports + JSDoc+@see |
| `tests/integration/p0-audit/exports-contract.test.ts` + `exports-root.test.ts` + `full-public-surface.test.ts` | (exists) | — | export-surface count snapshots | bump counts for the new public exports (same-task, no drift) |
| `CHANGELOG.md` | — | — | Keep-a-Changelog | `[Unreleased] § Added` entry |
| `tests/integration/ontology.test.ts` (NEW) | 0 | — | GOAL: domain-typed entity persists + out-of-vocab coerces vs real pgvector | — |

### Current callers / dependents

- **Symbol:** `generateAdditiveExtractionPrompt` (`prompt.ts:96`) — called by `extraction/pipeline.ts:338`. Adding an optional trailing `ontology?` param is backward-compatible.
- **Symbol:** `AdditiveExtractionSchema` (`prompt.ts:122`) — `entities[].type` is `z.string().optional()` (`:135`); the post-parse validation reads it. Unchanged schema; validation is a new step AFTER `.parse`.
- **Symbol:** `ExtractionDeps` (`pipeline.ts:45`) — already has `customInstructions?` (`:51`); add `ontology?: Ontology`.
- **Symbol:** `MemoryConfig` (`memory-store.ts:203`) — opt-in slot precedent; add `ontology?: Ontology | OntologyName`.
- **Symbol:** `entities.type` (`schema.ts:342`, text) + `entity_edges.relation` (text) — persist domain types with NO migration (D3).
- **Symbol:** `linkEntities` (`extraction/entity-linking.ts`, called `pipeline.ts:542`) — persists `llmEntities` (with `.type`) to the entity store; the coerced types flow through unchanged.

### Domain glossary
- **Ontology** — a typed domain vocabulary `{ name, entityTypes[], relationTypes[], description? }`. NOT OWL/RDF; a validation vocabulary (ADR D1).
- **Prompt injection (ontology)** — substituting/augmenting the extraction prompt's entity-type + relation guidance with the ontology vocabulary.
- **Coercion** — mapping an LLM-emitted entity type outside the ontology vocabulary to `OTHER` (kept, not dropped), emitting `ontology_type_coerced` (Princípio 3).

### Architecture boundaries affected
Per `architecture.md`: `Ontology` + `BUILTIN_ONTOLOGIES` + `resolveOntology` live in `packages/core/src/domain/` (pure, zero I/O). The prompt injection + post-parse validation live in `domain/extraction/` (pure). The factory wiring lives in `infrastructure/db/`. No new boundary; no new store; no migration. Mirrors the `entityBoost?` opt-in (extraction-affecting config).

## Prior Art & Related Work

- **mem0 custom-categories** (`.claude/knowledge-base/references/mem0/openmemory/api/app/utils/categorization.py`, `mem0-plugin/scripts/setup_coding_categories.py`) — the domain-tuned vocabulary injected into the extraction/categorization prompt + LLM-constrained output. The blueprint's primary source.
- **TheMemory extraction pipeline** (`packages/core/src/domain/extraction/prompt.ts` + `pipeline.ts`) — the integration point (composer + post-parse seam).
- **TheMemory opt-in config slots** (`MemoryConfig`/`LocalMemoryConfig.{entityBoost?, skillExecutor?, recallCache?, reranker?}`) — the opt-in precedent.
- **TheMemory entity/relation persistence** (`schema.ts:342` `entities.type`, `entity_edges` migration `0019`, `pg-memory-entity-store.ts:69`) — confirms the text columns carry domain types (D3, no migration).
- Blueprint: `.claude/knowledge-base/discoveries/blueprints/domain-ontologies-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89).

## Dependencies

| Dependency | Version | Status | Rule 9 evaluation |
|---|---|---|---|
| `zod` | (already present) | Reused | Ontology schema validation reuses `zod` (already validates `AdditiveExtractionSchema` + every config). Alternatives rejected: a new validation lib (unjustified — zod is the project standard), OWL/RDF parser (over-engineering, ADR D1). NO new dep, NO version bump. |

NO new dependency is introduced. The ontology is a typed config + a prompt/validation layer over the EXISTING LLM client + pgvector. deps-audit will confirm zero new CVE surface in cycle-plan.

## ADRs

### D1 — `Ontology` = a flat typed entity/relation vocabulary (NOT OWL/RDF, NOT a reasoner)
**Decision:** `Ontology { name; entityTypes: readonly string[]; relationTypes: readonly string[]; description?: string }`. **Rationale:** the feature is "typed schemas over extraction", not formal-ontology reasoning; KISS/YAGNI; mem0's flat custom-categories validates the shape. **Alternatives:** OWL/RDF (rejected — over-engineering, no consumer demand), free-text instructions only (rejected — not typed/validatable). **Consequences:** a validation vocabulary, not a knowledge-representation language.

### D2 — Inject at the extraction prompt + validate post-parse; coerce out-of-vocab entity types to `OTHER` (observable); keep relations
**Decision:** `generateAdditiveExtractionPrompt` gains an `ontology?` param that renders an explicit vocab directive (entityTypes + relationTypes + description); after `AdditiveExtractionSchema.parse`, a validation step coerces out-of-vocab entity `type` → `OTHER` + emits `ontology_type_coerced`; out-of-vocab relations are KEPT (record divergence via the same event). **Rationale:** guiding the LLM (prompt) + validating output (post-parse) is the mem0 pattern; coerce-not-drop preserves data; observability honors Princípio 3; fail-soft — an ontology mismatch NEVER fails `remember()` (mirrors the entity/relation slices' fail-soft). **Alternatives:** drop out-of-vocab entities (rejected — data loss), fail `remember()` (rejected — fail-loud on enrichment is wrong), prompt-only no validation (rejected — LLMs drift). **Consequences:** best-effort typing; remember/recall correctness never depends on it.

### D3 — Persist in the EXISTING `entities.type` + `entity_edges.relation` columns; NO poly-store, NO migration
**Decision:** reuse the shipped text columns; domain types are just values. **Rationale:** confirmed they carry arbitrary text (`schema.ts:342`, `pg-memory-entity-store.ts:69`); competitive thesis "ontologies without poly-store"; Item 14 (graph backend) separate; Rule 9 + KISS. **Alternatives:** new ontology/type table (rejected — poly-store), graph DB (rejected — Item 14). **Consequences:** zero migration; extraction-time-only layer.

### D4 — Opt-in via a zod-validated `MemoryConfig.ontology?` slot (registry key OR custom object); default byte-unchanged
**Decision:** `MemoryConfig.ontology?: Ontology | OntologyName`; resolved + zod-validated at factory; absent = current generic extraction (byte-unchanged). **Rationale:** mirrors shipped opt-in slots; per-instance config beats mem0's project-only limitation. **Alternatives:** always-on default ontology (rejected — changes existing behavior), per-call override (deferred — KISS follow-up). **Consequences:** a new config slot + a built-in registry module; no behavior change for existing callers.

## Dependency Graph

```
T1.1 (Ontology type + BUILTIN_ONTOLOGIES + resolveOntology + zod)
   ↓
T2.1 (prompt composer ontology injection)  ──┐
   ↓                                          │
T2.2 (pipeline post-parse coercion + event + ExtractionDeps.ontology thread)
   ↓
T3.1 (MemoryConfig.ontology slot + factory resolve + public exports + p0-audit count reconcile)
   ↓
T4.1 (Integration Validation — GOAL test + full gate)
```

## Phase 1 — Ontology domain type + registry

### T1.1 — `Ontology` type + `BUILTIN_ONTOLOGIES` + `resolveOntology` + zod validator

#### Why this step
**Action:** declare the `Ontology` interface + `OntologyName` union + `BUILTIN_ONTOLOGIES` registry (medical/legal/code/support) + `resolveOntology(name|object): Ontology` + a zod schema validating a custom ontology, in `domain/ontology.ts`.
**Reasoning:** the type + registry must exist before the prompt/pipeline/config can consume them (DIP — domain owns the contract). Cites ADR D1 + the blueprint registry (Rec 2).

#### TDD
- RED: `ontology.test.ts` asserts: each built-in resolves with non-empty `entityTypes`/`relationTypes`; `resolveOntology('medical')` returns the medical built-in; `resolveOntology(customObj)` validates + returns it; an invalid custom (empty entityTypes) throws a typed error (`InvalidOntology` or reuse `InvalidScope`); `resolveOntology('bogus')` throws.
- GREEN: write `ontology.ts`.
- REFACTOR: JSDoc + `@see` blueprint § ADRs.

#### Files to edit
- `packages/core/src/domain/ontology.ts` (NEW)
- `packages/core/src/domain/ontology.test.ts` (NEW)
- `packages/core/src/domain/errors.ts` (add `InvalidOntology` if not reusing `InvalidScope`)

#### Deep file dependency analysis
Imports only `zod` + (optionally) `errors.ts`. Zero I/O. Exported from `domain/index.ts` + `index.ts` (T3.1). The `entityTypes` MUST include `OTHER` (the coercion fallback) — enforced by the validator.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `npx tsc --noEmit` passes; `ontology.test.ts` green.
- [ ] `BUILTIN_ONTOLOGIES` has exactly the 4 keys `medical|legal|code|support`, each with non-empty `entityTypes` (incl. `OTHER`) + `relationTypes` (asserted).
- [ ] `resolveOntology` handles registry-key, custom-object (validated), and rejects unknown key + invalid custom (typed throw).
- [ ] No import from `../infrastructure` in `ontology.ts` (`grep -L` confirms boundary).

#### DoD
- [ ] `cd packages/core && npx tsc --noEmit` exits 0; `npx vitest run --config vitest.contract.config.ts packages/core/src/domain/ontology.test.ts` green.
- [ ] CHANGELOG `[Unreleased] § Added` notes the `Ontology` + registry.

## Phase 2 — Extraction injection + validation

### T2.1 — prompt composer ontology injection

#### Why this step
**Action:** add an optional `ontology?: Ontology` param to `generateAdditiveExtractionPrompt`; when present, prepend an explicit vocab directive ("Use ONLY these entity types: [...]; ONLY these relationship types: [...]; domain: <description>") so the LLM is guided to the domain vocabulary.
**Reasoning:** prompt injection is the mem0 pattern (Q1); the composer already supports a `customInstructions` prefix, so the ontology directive composes cleanly. Cites ADR D2.

#### TDD
- RED: `prompt.test.ts` — with an ontology, the composed prompt CONTAINS the ontology's entity types + relation types + description; without an ontology, the prompt is byte-identical to today (regression).
- GREEN: implement the directive rendering.
- REFACTOR: extract a `renderOntologyDirective(ontology)` helper; JSDoc citing ADR D2.

#### Files to edit
- `packages/core/src/domain/extraction/prompt.ts`
- `packages/core/src/domain/extraction/prompt.test.ts`

#### Deep file dependency analysis
`generateAdditiveExtractionPrompt` is called once (`pipeline.ts:338`). Adding an optional trailing param is backward-compatible. The directive is prose prepended to `SYSTEM_PROMPT` (does not rewrite the const — minimal blast radius).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] With an ontology, the prompt contains every `entityTypes` + `relationTypes` token + the `description`.
- [ ] Without an ontology, `generateAdditiveExtractionPrompt(e, m)` output is byte-identical to pre-change (explicit string assertion).
- [ ] `grep -n "ontology" prompt.ts` shows the directive is gated on `ontology !== undefined`.

#### DoD
- [ ] `npx vitest run --config vitest.contract.config.ts packages/core/src/domain/extraction/prompt.test.ts` green.
- [ ] CHANGELOG updated.

### T2.2 — pipeline post-parse coercion + `ontology_type_coerced` event + `ExtractionDeps.ontology` thread

#### Why this step
**Action:** add `ontology?: Ontology` to `ExtractionDeps`; pass it to `generateAdditiveExtractionPrompt` at the composer call; after `AdditiveExtractionSchema.parse`, when an ontology is set, validate each extracted entity `type` against `ontology.entityTypes` — out-of-vocab → coerce to `OTHER` + emit `ontology_type_coerced` (with `{from, to: 'OTHER', name}`); out-of-vocab relations kept (emit the event recording divergence). Add `ontology_type_coerced` to MEMORY_EVENTS.
**Reasoning:** the post-parse seam (`pipeline.ts:369`) is where the LLM output is validated; coercion + observability implement ADR D2; fail-soft (wrap in try/catch consistent with the entity-linking fail-soft so an ontology error never fails `remember()`).

#### TDD
- RED: `extraction-pipeline.test.ts` — with a stub LLM returning a MIX of in-vocab + out-of-vocab entity types + an ontology in deps: (a) in-vocab types pass through verbatim, (b) out-of-vocab type → `OTHER` in the persisted entities, (c) `ontology_type_coerced` emitted (real OTel span assertion), (d) no ontology in deps → entities pass through unchanged (regression), (e) the composer received the ontology (prompt contains vocab).
- GREEN: implement the post-parse validation + thread.
- REFACTOR: extract `applyOntology(entities, relations, ontology, tracer)` pure helper (testable in isolation); JSDoc.

#### Files to edit
- `packages/core/src/domain/extraction/pipeline.ts`
- `packages/core/src/domain/extraction/pipeline.test.ts` (or `extraction-pipeline.test.ts`)
- `packages/core/src/domain/memory-event.ts`
- `packages/core/src/domain/memory-event.test.ts`

#### Deep file dependency analysis
`ExtractionDeps` is built by the factory (T3.1). The post-parse step runs between `.parse` (`:369`) and `linkEntities` (`:542`) so the coerced `llmEntities` flow to persistence unchanged. `applyOntology` is pure (entities + ontology → coerced entities + events). MEMORY_EVENTS union add is additive (Princípio 3 registry).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `ontology_type_coerced` is a MEMORY_EVENTS member (asserted; count bumped).
- [ ] Stub-LLM test proves: in-vocab verbatim, out-of-vocab → `OTHER`, event emitted, no-ontology unchanged.
- [ ] An ontology validation error does NOT throw out of the extraction pipeline (fail-soft — `remember()` still succeeds; asserted).
- [ ] `grep -n "ontology" pipeline.ts` shows the validation is gated on `deps.ontology !== undefined`.

#### DoD
- [ ] `npx vitest run --config vitest.contract.config.ts packages/core/src/domain/extraction-pipeline.test.ts packages/core/src/domain/memory-event.test.ts` green.
- [ ] CHANGELOG updated.

## Phase 3 — Config wiring + public surface

### T3.1 — `MemoryConfig.ontology?` slot + factory resolve + public exports + p0-audit reconcile

#### Why this step
**Action:** add `ontology?: Ontology | OntologyName` to `MemoryConfig`; in the factory, `resolveOntology(config.ontology)` (when set) → `ExtractionDeps.ontology`; export `Ontology` (type), `OntologyName` (type), `BUILTIN_ONTOLOGIES` (value), `resolveOntology` (value) from the public barrels with JSDoc+@see; bump the p0-audit export-count snapshots IN THE SAME TASK (no drift — lesson from the reranker cycle).
**Reasoning:** the config slot is how a consumer enables an ontology (mirrors `entityBoost?`/`reranker?`); the factory resolves it once; the public surface must register the new exports + their count.

#### TDD
- RED: `factory`/config test — `createLocalMemory({ ontology: 'medical' })` resolves + threads to extraction (a remember with a stub LLM shows the prompt carried the medical vocab + coercion applied); `createLocalMemory({})` (no ontology) extraction unchanged; invalid ontology key → typed throw at factory.
- GREEN: extend `memory-store.ts` + factory + barrels.
- REFACTOR: JSDoc; align with the opt-in-slot precedent.

#### Files to edit
- `packages/core/src/domain/memory-store.ts` (`MemoryConfig.ontology?`)
- `packages/core/src/infrastructure/db/factory.ts` (or `index.ts`) (resolve + thread)
- `packages/core/src/domain/index.ts` + `packages/core/src/index.ts` (exports + JSDoc+@see)
- the factory/config test file
- `tests/integration/p0-audit/exports-contract.test.ts` + `exports-root.test.ts` + `full-public-surface.test.ts` (bump counts for the new exports)

#### Deep file dependency analysis
`MemoryConfig` is consumed by the factory + every Memory ctor. Additive optional slot — no caller breaks. The public-export count snapshots (currently core 52 / root 15 after the reranker cycle) must bump by the number of new `export` statements added (resolve at implementation time + update the assertions + their comments in the same commit).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `MemoryConfig` accepts `ontology?` (tsc); omitting it compiles; `createLocalMemory({ ontology: 'medical' })` works.
- [ ] Public barrels export `Ontology`, `OntologyName`, `BUILTIN_ONTOLOGIES`, `resolveOntology` with JSDoc+@see each.
- [ ] p0-audit export-count tests pass with the updated snapshots (core/root counts reflect the new exports).
- [ ] default path (no ontology) byte-unchanged (regression assertion).

#### DoD
- [ ] `cd packages/core && npx vitest run --config vitest.contract.config.ts` green for touched files; p0-audit count tests green.
- [ ] CHANGELOG updated.

## Phase 4 — Integration Validation

### T4.1 — GOAL integration test + full gate

#### Why this step
**Action:** the GOAL test against real `ankane/pgvector:v0.5.1`: configure `createLocalMemory({ ontology: 'medical', ... })` with a stub LLM returning a medical-domain entity (in-vocab, e.g. type `Diagnosis`) + an out-of-vocab entity (e.g. type `Wizard`); `remember()` a text; assert (a) the in-vocab entity persists with `type='Diagnosis'` in `entities.type`, (b) the out-of-vocab entity persists with `type='OTHER'`, (c) `ontology_type_coerced` emitted. Plus an OPTIONAL real-LLM variant (skipIf no `OPENAI_API_KEY`/`OPENROUTER_KEY`) proving the injected prompt steers a real LLM toward the domain vocab. Plus full typecheck/lint/coverage + `/code-quality`.
**Reasoning:** the "eat your own cooking" gate proving the ontology end-to-end with real persistence (the LLM is the deterministic input; the ontology layer + pgvector are real — same honest pattern as the reranker GOAL, disclosed). The real-LLM variant honors the "use real LLM" directive when a key is available.

#### TDD
- RED: `tests/integration/ontology.test.ts` — the medical-ontology persist+coerce scenario (fails before T2.2/T3.1).
- GREEN: implemented by prior phases; this is the end-to-end proof.
- REFACTOR: isolated DB (`themem_ontology_goal`) + `pool.end()` teardown.

#### Files to edit
- `tests/integration/ontology.test.ts` (NEW)
- `vitest.integration.config.ts` (no new alias needed — ontology is on the default barrel)

#### Deep file dependency analysis
Runs under `vitest.integration.config.ts` (gated by `THEOMEM_PG_URI`). Uses `createLocalMemory({ ontology: 'medical', vectorStore: PgvectorStore, embedder, llm: stub })`. Reads back `entities.type` via SQL or the entity store to assert persisted domain types.

#### Concurrency tests
(none — single-threaded)

#### Failure scenarios
- **LLM emits a type outside the ontology vocab:** coerced to `OTHER` + `ontology_type_coerced` — the PRIMARY asserted behavior (D2), not a failure to recover from but the designed path. Reproduced in T2.2 + T4.1.
- **Ontology validation throws internally:** fail-soft — `remember()` still succeeds, entities persist with raw types (the ontology layer degrades). Reproduced in T2.2 (no new external I/O — the ontology adds no network/DB call beyond the existing extraction LLM + pg writes).

#### Acceptance criteria
- [ ] `THEOMEM_PG_URI=... npx vitest run tests/integration/ontology.test.ts --config vitest.integration.config.ts` PASSES: in-vocab `type` persists, out-of-vocab → `OTHER`, event emitted, default path unchanged.
- [ ] `cd packages/core && npx tsc --noEmit` exits 0; `npm test` (contract) green; integration suite green (0 failed).
- [ ] `/code-quality domain-ontologies` ∈ {PASS, PASS_WITH_CAVEATS} (no FAIL_HARD/INVALID; no symbol_fabrication, no dead_public_export).
- [ ] No paper names in `src/**` / tests.

#### DoD
- [ ] All Phase 1-3 tests green + this integration test green.
- [ ] `/code-quality` PASS.
- [ ] CHANGELOG `[Unreleased]` complete (Added: Ontology, BUILTIN_ONTOLOGIES, MemoryConfig.ontology, ontology_type_coerced).

## Coverage Matrix

| Goal claim / blueprint recommendation | Task(s) |
|---|---|
| `Ontology` type (flat typed vocab) [D1, Rec 1] | T1.1 |
| Built-in registry medical/legal/code/support [Rec 2, Q2] | T1.1 |
| `resolveOntology` (key/object/validate) [D4, Q5] | T1.1 |
| Prompt injection of the ontology vocab [D2, Rec 1/3, Q1/Q3] | T2.1 |
| Post-parse coercion out-of-vocab → OTHER + observable [D2, Rec 3] | T2.2 |
| Keep out-of-vocab relations (no data loss) [D2] | T2.2 |
| `ontology_type_coerced` OTel event [D2, Princípio 3] | T2.2 |
| Fail-soft (ontology error never fails remember) [D2] | T2.2 + T4.1 failure scenarios |
| `ExtractionDeps.ontology` thread | T2.2 |
| `MemoryConfig.ontology?` opt-in slot [D4, Q5] | T3.1 |
| Factory resolve + thread | T3.1 |
| Public exports (Ontology/OntologyName/BUILTIN_ONTOLOGIES/resolveOntology) | T3.1 |
| p0-audit export-count reconcile (no drift) | T3.1 |
| Persistence: reuse entities.type/entity_edges.relation, NO migration [D3, Q4] | T2.2 (no migration) + T4.1 (assert persisted type) |
| No new dep (zod reuse) [deps-audit] | T1.1 + Dependencies section |
| GOAL: domain-typed persist + coerce vs real pgvector [Q6, Rec 6] | T4.1 |

100% of Goal claims + blueprint recommendations mapped to tasks.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| LLM ignores the ontology vocab directive (drifts to generic types) | MEDIUM | post-parse coercion is the safety net (out-of-vocab → OTHER, observable); the prompt directive is best-effort guidance, validation is the enforcement | impl |
| Ontology coercion silently loses domain nuance (everything → OTHER if vocab too narrow) | MEDIUM | observability (`ontology_type_coerced` count) surfaces a too-narrow vocab; built-ins are curated with `OTHER` always allowed | impl |
| Public-export count drift (new exports break p0-audit snapshots) | LOW | bump the snapshots IN T3.1 (same task) — lesson from the reranker cycle | impl |
| Scope creep into a formal-ontology reasoner | LOW | ADR D1 bounds it to a flat vocab; OWL/RDF explicitly rejected | plan |

## Unresolved Questions

(none — every decision is resolved at plan time via D1-D4 grounded in the blueprint.)

## Failure scenarios

- **LLM emits out-of-vocab entity type:** coerced to `OTHER` + `ontology_type_coerced` (the designed D2 path). Reproduced T2.2 + T4.1.
- **Ontology resolution given an unknown registry key:** typed throw at factory (fail-fast config error — distinct from the runtime fail-soft coercion). Reproduced T1.1 + T3.1.
- **(none — no NEW external I/O)** — the ontology is a prompt + in-memory validation layer over the existing extraction LLM call + pg writes; it adds no new network/DB dependency, so no new timeout/5xx failure mode beyond the already-covered extraction path.

## Global Definition of Done

- [ ] All tasks T1.1 → T4.1 complete with TDD RED→GREEN→REFACTOR.
- [ ] `cd packages/core && npx tsc --noEmit` exits 0.
- [ ] Contract suite (`npm test`) green; integration suite green (incl. the GOAL test vs real pgvector).
- [ ] `/code-quality domain-ontologies` ∈ {PASS, PASS_WITH_CAVEATS}.
- [ ] p0-audit export-surface snapshots reconciled (no red).
- [ ] No paper names in `src/**` / tests.
- [ ] CHANGELOG `[Unreleased]` updated (Added).
- [ ] `/review domain-ontologies` → READY_TO_MERGE (0 BLOCKER, ≤2 HIGH with mitigation).
- [ ] Plan archived to `knowledge-base/plans/completed/` after merge.
