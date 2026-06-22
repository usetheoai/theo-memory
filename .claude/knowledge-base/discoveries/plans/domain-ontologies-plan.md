# Discovery Plan: Domain ontologies (typed schemas over LLM extraction)

> **Version 1.0** — investigate how to layer an optional, typed **domain ontology** (a per-domain vocabulary of allowed entity types + relation types, e.g. medical / legal / code / support) over TheMemory's EXISTING LLM extraction pipeline, persisted in the SAME 2 Postgres tables (`entities` + `entity_edges`) with NO poly-store (the competitive attack on Cognee — `CLAUDE.md § Competitive superiority matrix`). In scope: `mem0` (custom-categories / custom-instructions / categorization prompt — the closest analog to domain-constrained extraction). Output: a blueprint that locks (a) the `Ontology` shape, (b) the built-in ontology registry (medical/legal/code/support), (c) the exact prompt-injection + post-extraction validation point in the existing pipeline, (d) the opt-in config surface, (e) the persistence (reuse the existing `type` columns, no schema migration OR a minimal additive one).

**Slug:** `domain-ontologies`
**Owner:** project-owner
**Created:** 2026-06-22
**Time budget:** 3h (mem0: 2h, TheMemory-self grounding: 1h — per ADR D1)

## Context

Roadmap Item 15 (`CLAUDE.md § Roadmap` + `memory-gaps-roadmap.md` opportunistic #2, next after Item 23 reranker shipped v0.15.0) calls for "Typed schemas per domain (medical / legal / code / support) layered over LLM extraction" with the competitive attack "Typed domain ontologies **without poly-store complexity**" (vs Cognee). TheMemory's extraction pipeline (`packages/core/src/domain/extraction/prompt.ts`) already emits `entities` (`{name, type: PERSON|ORG|PLACE|PRODUCT|CONCEPT|OTHER}`) + `relations` (`{source, relationship, destination}`) via the LLM, persisted to `entities` + `entity_edges` (the entity-relation-extraction slices, shipped). The entity `type` is currently a free `z.string().optional()` + a fixed generic vocabulary in the prompt. A domain ontology TYPES this: it constrains entity types + relation types to a domain vocabulary, guiding the LLM and validating its output. Depends on Item 9 (distillation, shipped) + the entity/relation slices (shipped). Prior art: mem0's project-level `custom_categories` + `custom_instructions` + the categorization prompt (`openmemory/api/app/utils/categorization.py`, `mem0-plugin/scripts/setup_coding_categories.py`).

## Objective

Decide the `Ontology` type shape, the built-in ontology registry, the prompt-injection + post-extraction validation locus, the opt-in config surface, and the persistence approach — so `/to-plan` produces an implementation plan with zero open architectural questions. Measurable success criteria for the blueprint:

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/` OR to the project's own `src/` (the integration point)
- [ ] Cross-cutting comparison table populated for mem0 (custom-categories) vs the target design
- [ ] Recommendations: one concrete decision per research question (Ontology shape, registry, prompt injection, validation policy, config surface, persistence)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mem0/` | `openmemory/api/app/utils/categorization.py`, `openmemory/api/app/utils/prompts.py`, `mem0-plugin/scripts/setup_coding_categories.py`, `mem0/mem0/configs/` (custom_prompt/custom_categories config shape) | The closest analog — domain-tuned category taxonomy + custom-instruction injection constraining LLM extraction |
| `.claude/knowledge-base/references/` (TheMemory self) | `packages/core/src/domain/extraction/prompt.ts`, `extraction/pipeline.ts`, `dip/entity-extractor.ts`, the `entities`/`entity_edges` schema | The integration point — where an ontology injects into the prompt + validates extracted entities/relations |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| Graph DB / poly-store backends (Neo4j, Apache AGE, Cognee's store) | <!-- DEFER-CORNER: techniques | the entire feature thesis is "ontologies WITHOUT poly-store" (CLAUDE.md competitive matrix); Item 14 (graph backend) stays a separate item. The ontology persists in the EXISTING 2 Postgres tables. --> |
| A user-facing ontology editor / UI | Out of scope — the ontology is a typed config (built-in registry + optional custom), not a dashboard surface |
| OWL / RDF / formal-ontology-language import | Over-engineering for v1 (YAGNI) — a domain ontology here is a typed entity/relation vocabulary, not a formal reasoner |
| `.claude/knowledge-base/references/*/{build,dist,.venv,node_modules}/` | Build artifacts |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** mem0: 2h (categorization + custom-categories + custom-prompt config), TheMemory-self: 1h (the extraction prompt + pipeline + entity/edge persistence integration point).

**Rationale:** mem0's custom-categories is the direct analog for domain-constrained extraction; the TheMemory-self pass locks the exact injection + validation locus (load-bearing — the ontology must plug into the SHIPPED pipeline without a rewrite).

**Stop condition — per question (mandatory):** Fase A empty after 3 retries with different query variants → mark BLOCKED "Fase A exhausted", continue. No padding.

**Stop condition — per project (mandatory):** budget exhausted with N pending → mark BLOCKED "budget exhausted", continue. If every remaining question is `done` or honestly `blocked` → emit `<promise>BLUEPRINT_BLOCKED</promise>` (never `BLUEPRINT_COMPLETE` from a blocked state).

**Anti-pattern:** NEVER fabricate Fase B answers for an exhausted Fase A (Unbreakable Rule 3).

**Consequences:** the loop stops per-project on budget exhaustion; blocked questions surface as next-discovery seed.

### D2 — Investigation depth

**Decision:** Read the mem0 categorization + setup-coding-categories + custom-prompt config end-to-end (small files); Read the TheMemory extraction prompt + pipeline + entity-extractor DIP + the entities/edges schema end-to-end (the integration surface).

**Rationale:** the constraint/validation semantics + the exact prompt-injection point are only visible by reading end-to-end; a Grep-only pass would miss the post-extraction coercion policy + the persistence type-column readiness.

**Alternatives considered:** Grep-only (misses semantics), single-file sample (misses the injection↔validation↔persistence triad).

**Consequences:** higher per-file cost, bounded by the small file set.

### D3 — Persistence: reuse the existing 2 Postgres tables, NO poly-store

**Decision:** the discovery will VALIDATE that the shipped `entities`/`entity_edges` schema can carry domain-typed entities/relations (the `type` column already exists on `entities`) with NO new store, and propose at most a MINIMAL additive migration (e.g., an `ontology` label column) if needed.

**Rationale:** the feature thesis (competitive matrix) is "ontologies without poly-store"; Item 14 (graph backend) stays separate/frozen-adjacent. Inquebrável Rule 9 + KISS.

**Alternatives considered:** new ontology store (rejected — poly-store, the exact thing we attack Cognee on), graph DB (rejected — Item 14, separate).

**Consequences:** the ontology is a typing/validation layer over existing persistence, not a new storage engine.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does mem0 represent a domain-tuned vocabulary (custom_categories) + inject it into the extraction/categorization prompt? | techniques | mem0 | `grep -rn "custom_categories\|custom_instructions\|CATEGORIZATION" mem0/openmemory mem0/mem0/configs` | Read `categorization.py` + `prompts.py` (MEMORY_CATEGORIZATION_PROMPT) + the custom_categories config | The category-taxonomy shape (list of `{name: description}`) + how it's injected into the system prompt + the LLM-constrained output (Pydantic `MemoryCategories`) |
| Q2 | What is a concrete domain ontology example (the coding taxonomy) — shape, granularity, how applied? | techniques | mem0 | `grep -n "CODING_CATEGORIES\|categories" mem0/mem0-plugin/scripts/setup_coding_categories.py` | Read `setup_coding_categories.py` end-to-end | A worked domain taxonomy (architecture_decisions / anti_patterns / task_learnings...) — informs our medical/legal/code/support built-ins |
| Q3 | Where in TheMemory's extraction prompt are entity types + relation labels emitted, and where would an ontology vocabulary inject + constrain them? | techniques | TheMemory self | `grep -n "PERSON\|type\|relationship\|SYSTEM_PROMPT\|entities" packages/core/src/domain/extraction/prompt.ts` | Read `extraction/prompt.ts` (SYSTEM_PROMPT + AdditiveExtractionSchema) end-to-end | The exact prompt lines + Zod schema fields (`entity.type` `z.string().optional()`, `relationship` `z.string()`) where an ontology vocab injects + the validation seam |
| Q4 | How does the extraction pipeline flow entities/relations to persistence, and is the `entities` schema type-ready for domain types (no migration vs minimal additive)? | tools | TheMemory self | `grep -rn "type\|entities\|entity_edges\|insertEntit\|ExtractedEntity" packages/core/src/domain/extraction/pipeline.ts packages/core/src/infrastructure/db/` | Read `extraction/pipeline.ts` + entity-linking + the `entities`/`entity_edges` migration | The persist flow + whether the `type` column carries arbitrary domain types today (D3 confirm/blocker) |
| Q5 | What config + registry shape exposes built-in ontologies (medical/legal/code/support) + a custom ontology, opt-in, without a new dep? | tools | mem0 + TheMemory self | `grep -rn "custom_prompt\|MemoryConfig\|entityBoost\|config" mem0/mem0/configs packages/core/src/infrastructure/db/config.ts` | Read mem0's custom_prompt config + TheMemory `LocalMemoryConfig` (the opt-in slot precedent: `entityBoost?`, `skillExecutor?`, `reranker?`) | The `Ontology` type + a built-in registry + the `MemoryConfig`/`LocalMemoryConfig` opt-in slot (zod-validated, no new dep) |
| Q6 | How does mem0 test categorization (fixtures, what is asserted, real LLM vs stub)? | tests | mem0 | `find mem0 -path '*test*categor*' -o -path '*categor*test*' ; grep -rn "categor" mem0/**/tests* 2>/dev/null` | Read the categorization test (or the closest extraction test) | The stub-LLM + assert-on-constrained-output pattern to mirror in our ontology-constrained extraction test |

Question budget: 6 total. Per-corner: techniques ×3 (Q1, Q2, Q3), tools ×2 (Q4 persistence-readiness, Q5 config/registry), tests ×1 (Q6). deps corner DEFERRED — see DEFER-CORNER below. All non-deferred corners populated; max 3/corner respected.

<!-- DEFER-CORNER: deps | the design reuses zod (already a dep) for ontology schema validation + the existing LLM client for extraction; NO new dependency is anticipated (an ontology is a typed config, not a model/library). The deps question is folded into Q5 (config shape, no new dep). A formal deps-audit runs in cycle-plan regardless. -->

## Coverage Matrix

| Question | Corner | Method (Fase A) | Method (Fase B) | Status |
|---|---|---|---|---|
| Q1 | techniques | grep custom_categories/CATEGORIZATION | Read categorization.py + prompts.py | planned |
| Q2 | techniques | grep CODING_CATEGORIES | Read setup_coding_categories.py | planned |
| Q3 | techniques | grep prompt entity/relation types | Read extraction/prompt.ts | planned |
| Q4 | tools | grep persist flow + schema | Read pipeline + entities/edges migration | planned |
| Q5 | tools | grep config/custom_prompt | Read mem0 config + LocalMemoryConfig | planned |
| Q6 | tests | find categorization test | Read the test | planned |
| (deps) | deps | — | — | DEFER-CORNER (folded into Q5; no new dep) |

All corners populated or explicitly DEFER-CORNER'd. techniques ×3, tools ×2, tests ×1, deps deferred.

## Halt-loop Checkpoints

Before marking each question `done`, the `/discover-execute` loop MUST verify:

1. Every cited path resolves (`Path.exists()`) — no fabricated citation.
2. Q3 captures the EXACT prompt lines + Zod fields where the ontology injects (the load-bearing integration point).
3. Q4 produces a CONCRETE yes/no on whether the `entities.type` column carries arbitrary domain types today (D3 confirm or minimal-migration blocker).
4. Q5 produces an explicit `Ontology` type proposal + the built-in registry list (medical/legal/code/support) + the opt-in config slot.

## Acceptance Criteria

- [ ] 6/6 questions `done` (or honestly `blocked` with reason).
- [ ] Every citation backed by a real `.claude/knowledge-base/references/` path OR a real `packages/core/src/` path.
- [ ] Cross-cutting table: mem0 custom-categories vs the target Ontology design (shape, injection, validation, persistence).
- [ ] ≥ 1 ADR in the blueprint (Ontology shape; prompt-injection+validation locus; persistence-no-poly-store).
- [ ] Recommendations: Ontology type, built-in registry, prompt injection point, validation policy (coerce-to-OTHER vs drop, observable), config surface, persistence approach.

## Global Definition of Done

- [ ] `/discover-confidence domain-ontologies` ≥ SHIPPABLE_WITH_CAVEATS per `.claude/rules/discover-blueprint-golden-rule.md`.
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/domain-ontologies-blueprint.md`.
- [ ] No fabricated citations (hard cap).
- [ ] All coverage corners populated or DEFER-CORNER'd (hard cap).
