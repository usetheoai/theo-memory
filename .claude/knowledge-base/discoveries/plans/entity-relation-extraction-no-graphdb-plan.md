---
slug: entity-relation-extraction-no-graphdb
created_at: 2026-06-19
owner: project-owner (CTO live session)
status: DRAFT (discovery plan — edge-cases absorbed, pre-execute)
---

# Discovery Plan: Entity + Relation Extraction WITHOUT a Graph DB

> **Version 1.1** (edge-cases absorbed 2026-06-19 — EC-1 reframes Q2 [relation EXTRACTION prompt is absent from the clone; only the triple SHAPE + normalization are present], EC-2 reframes Q6 [Mem0 OSS exposes a node LISTING, not a graph endpoint; `{nodes,edges}` is our synthesis]. EC-3/EC-4 added as halt-loop checkpoints; EC-5/EC-6 documented. See `.claude/knowledge-base/reviews/entity-relation-extraction-no-graphdb-edge-cases-2026-06-19.md`.)

> **Version 1.0** — Research how the reference projects extract **entities** (NER/LLM), structure **relations** (triples), persist + resolve + list them, so TheMemory can ship an "entity graph view" (nodes + edges + visualization) **on top of the existing Postgres/pgvector**, with **no graph database** (Neo4j/AGE/Neptune). The deliverable is a technical blueprint — NOT code. This investigation is permitted under PRIORITY 0 (study/discovery, not feature implementation); any implementation requires an explicit project-owner unfreeze of Roadmap Followup #3 + a scoped slice.

## Context

During the 2026-06-19 CTO live session, the project owner asked whether TheMemory could offer an entity-graph experience comparable to **Mem0's "Graph view" (Pro/Enterprise)** — "*See the entities Mem0 extracted and how memories connect them*" — **explicitly WITHOUT** adopting a knowledge-graph backend (Item 14 `@usetheo/memory/graph` is a separate module the owner does NOT want).

Evidence that triggered this NOW:
- TheMemory's dashboard already ships an **Entities tab**, but it is weak: it derives entities from the distinct `attributed_to` peers, and the standalone `entities` table is **never populated** by the write pipeline (Roadmap Followup #3; session memory `themory-entities-table-unpopulated`). Confirmed live: the tab renders "No entities under user".
- A quick read of the Mem0 clone showed entity extraction is done **without** a graph DB (spaCy NER) and relations are plain `{source, relationship, destination}` dicts — i.e. relational data. This plan formalizes that read into a citeable blueprint before any decision.

The open question this discovery closes: **what is the minimal, KISS, Postgres-only architecture for entities (nodes) + relations (edges) + a dashboard graph view, and what does each reference project teach about the hard parts (entity resolution, relation extraction quality, dependency cost, API shape)?**

## Objective

> Produce a blueprint that specifies, with ≥ 2 independent reference citations per claim, a **no-graph-DB** architecture for entity + relation extraction in TheMemory: (a) the entity-extraction strategy (NER-only vs reuse-existing-LLM-call vs hybrid) with dependency cost; (b) the relation (triple) representation + the LLM-output normalization technique; (c) the relational persistence + entity-resolution scheme (2 Postgres tables); (d) the listing/graph REST shape; measured by the `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS with all 4 coverage corners populated and zero fabricated citations.

Success criteria for the resulting blueprint:
- Every research question answered with a concrete reference-clone `file:line` citation (under the references clone root).
- A concrete 2-table Postgres schema proposal (entities + entity_edges) with the entity-resolution key strategy.
- An explicit recommendation on entity-extraction approach (NER-only vs LLM-reuse) with the dependency/cost trade-off named.
- A "what graph DB would add (and why we are NOT doing it)" section that ties back to the owner's constraint + Item 14.

## In-scope / Out-of-scope

**In scope — reference projects + subdirectories:**

- **Mem0 (PRIMARY)** — `.claude/knowledge-base/references/mem0/`
  - `mem0/utils/entity_extraction.py` + `mem0/utils/spacy_models.py` (spaCy NER, no-LLM entity path)
  - `mem0/memory/main.py` (entity↔memory linking, batch dedup/resolution)
  - `mem0/memory/utils.py` (relation triple shape `{source, relationship, destination}` + LLM-output normalization)
  - `server/routers/entities.py` + `cli/python/src/mem0_cli/commands/entities.py` (listing API/CLI shape)
  - `tests/utils/test_entity_extraction.py` (extraction test cases)
  - `pyproject.toml` (dependency cost of the NLP extra)
- **Letta (SECONDARY)** — `.claude/knowledge-base/references/letta/`
  - `letta/services/identity_manager.py` + `letta/orm/identity.py` + `alembic/versions/a113caac453e_add_identities_table.py` (relational entity/identity modeling + upsert/unique-constraint resolution in Postgres)

**Out of scope (explicit):**

- Mem0's `mem0[graph]` graph-store backend (Neo4j/Neptune/Memgraph) and any Cypher generation — NOT in the clone, and it is precisely the graph-DB path the owner rejected. We study the triple *shape*, not the graph *storage*.
- LangMem (NOT present in the clone — only `mem0` + `letta` are cloned) — DEFERRED (procedural-memory focus; no entity/relation extraction relevant here). See ADR D3.
- Mem0 `openmemory/`, `vercel-ai-sdk/`, `examples/`, `docs/` — not load-bearing for the extraction technique.
- Any TheMemory implementation, schema migration, or dashboard code — this is discovery only.

## ADRs (how to investigate)

### D1 — Time budget + per-question stop condition

- **Mem0: ~3h** (PRIMARY — entity + relation technique lives here). **Letta: ~1h** (SECONDARY — relational identity model only). **LangMem: 0h** (deferred, D3).
- **Per-question stop condition:** if a question's Fase A (read the cited file) does not yield the answer within ~20 min OR the cited symbol moved, mark the question `blocked` with the reason and continue; do NOT spelunk siblings indefinitely. A blocked question with a documented reason is honest; a fabricated answer is not.
- **Rationale:** Mem0 is the only clone with both halves (entity NER + relation triple shape). Letta adds the relational-persistence lens. LangMem adds nothing here — budgeting time to it would violate YAGNI.

### D2 — Investigation depth: read-level only (no execution)

- The references are a **read-only zone** (boundary-check hook). We Read + Grep; we do NOT run `pip install`, spaCy downloads, or any code inside the clones.
- Depth target: enough to cite the **technique** (algorithm, data shape, schema) at `file:line` — NOT to reproduce or benchmark it. Benchmarks belong to a future implementation slice.
- **Rationale:** discovery answers "how do they do it + does it need a graph DB"; that is answerable by reading. Execution is out of scope and blocked by the hook.

### D3 — Defer LangMem coverage (corner-completeness justification)

- LangMem is in the standard reference triplet but contributes nothing to entity/relation extraction (it is procedural-memory-via-prompt-rewriting). Skipping it is intentional, not an omission.
- All 4 coverage corners are still populated by Mem0 + Letta (see Coverage Matrix). No `DEFER-CORNER` marker is needed because no corner is empty.
- **Rationale:** YAGNI — investigating a project with no relevant surface burns budget for zero signal.

## Research Questions

| # | Question | Corner | Fase A (read) | Fase B (synthesize) |
|---|---|---|---|---|
| Q1 | How does Mem0 extract entities **without an LLM and without a graph DB** (NER approach, output shape, noise filtering)? | techniques | Read `.claude/knowledge-base/references/mem0/mem0/utils/entity_extraction.py` | Document the `extract_entities(text) -> List[Tuple[type, text]]` contract + the generic-head/non-specific-adj filtering; state whether it is regex-only or spaCy-dependent. |
| Q2 | How does Mem0 represent + normalize **relations (triples)** from LLM/tool output? | techniques | Read `.claude/knowledge-base/references/mem0/mem0/memory/utils.py` (lines ~78, ~271-291) | Document the `{source, relationship, destination}` dict shape + the normalization (lowercase, space→underscore, required-key guard); note that `sanitize_*_for_cypher` is graph-DB-specific and therefore droppable for a Postgres edge table. **EC-1 guard:** the relation-EXTRACTION prompt/LLM-call lives in the absent `mem0[graph]` module — mark that half `blocked — not in clone`; do NOT cite a prompt path. The citeable takeaway is the triple SHAPE (graph-DB-agnostic), not the extraction step. |
| Q3 | How does Letta model **entities/identities relationally in Postgres** and resolve duplicates (upsert / unique-constraint)? | techniques | Read `.claude/knowledge-base/references/letta/letta/services/identity_manager.py` + `.claude/knowledge-base/references/letta/letta/orm/identity.py` + `.claude/knowledge-base/references/letta/alembic/versions/a113caac453e_add_identities_table.py` | Document the identity table columns + the `UniqueConstraintViolationError` upsert path; map it to a candidate `entities`/`entity_edges` schema + resolution key for TheMemory. |
| Q4 | How does Mem0 test entity extraction (which cases + edge cases are asserted)? | tests | Read `.claude/knowledge-base/references/mem0/tests/utils/test_entity_extraction.py` | List the asserted cases (proper nouns, quoted text, compounds, empty, generic-only, dedup) → becomes the TDD RED checklist for a future TheMemory extractor. |
| Q5 | What dependency cost does Mem0's entity extraction carry, and is there a no-new-heavy-dep path? | deps | Read `.claude/knowledge-base/references/mem0/mem0/utils/spacy_models.py` + `.claude/knowledge-base/references/mem0/pyproject.toml` | Document that spaCy is an optional `[nlp]` extra requiring an `en_core_web_sm` model download; assess regex-only fallback vs reusing TheMemory's existing extraction LLM call (zero new dep) as the recommended path. |
| Q6 | What is the entity listing API/CLI shape Mem0 exposes (to mirror for a TheMemory `GET .../graph` endpoint)? | tools | Read `.claude/knowledge-base/references/mem0/server/routers/entities.py` + `.claude/knowledge-base/references/mem0/cli/python/src/mem0_cli/commands/entities.py` | Document the `Entity{id,type,total_memories,created_at,updated_at}` node-LISTING response + per-type aggregation. **EC-2 guard:** Mem0 OSS exposes a node LISTING only — there is NO `{nodes,edges}` graph endpoint in the clone (the graph view is closed Pro/Enterprise frontend). State that the `{nodes, edges}` REST shape is OUR synthesis (edges have no OSS precedent); do NOT cite a graph-endpoint path. |

Question budget: 6 total (techniques 3, tests 1, deps 1, tools 1). Within [5,10]; max-3-per-corner respected; every corner ≥ 1 (LangMem deferral via D3, not via empty corner).

## Coverage Matrix

| Corner | Questions | Method present? | Citations pre-validated? |
|---|---|---|---|
| **techniques** | Q1, Q2, Q3 | Yes (Read x4 files) | Yes — all paths confirmed via `[ -f ]` 2026-06-19 |
| **tests** | Q4 | Yes (Read 1 file) | Yes — `mem0/tests/utils/test_entity_extraction.py` confirmed |
| **deps** | Q5 | Yes (Read 2 files) | Yes — `spacy_models.py` + `pyproject.toml` confirmed |
| **tools** | Q6 | Yes (Read 2 files) | Yes — `server/routers/entities.py` + cli `entities.py` confirmed |

100% of corners covered. No `DEFER-CORNER` markers required.

## Halt-loop checkpoints (for /discover-execute)

A question may be marked DONE only when:
1. Its Fase A file was actually Read (not grep-skimmed) and the answer paragraph cites a concrete `file:line`.
2. The blueprint section mapped to the question replaces its `<!-- TBD: Qx -->` placeholder.
3. For Q3/Q6 (schema/API proposals): the proposal is grounded in the cited reference shape, with the divergence from TheMemory's current schema explicitly noted.
4. **EC-3 checkpoint (Q3):** the answer states explicitly that Letta identities are DECLARED first-class records, NOT entities extracted from text — Letta is evidence for relational PERSISTENCE + resolution (`identifier_key` + unique-constraint upsert; cross-cite `mem0/memory/main.py:868` for the normalized-key dedup per EC-6), not for extraction.
5. **EC-4 checkpoint (Q6):** Q6 yields the RESPONSE SHAPE only (fields + aggregation). Pagination, auth, RBAC, route wiring are implementation-plan concerns — out of discovery scope (D1 budget). Mark DONE once the shape table is written; do not design the handler.

## Acceptance Criteria

- All 6 research questions answered OR honestly `blocked` with reason.
- Every citation resolves on disk (no fabricated paths — `discover-confidence` hard cap).
- All 4 coverage corners populated in the blueprint.
- ≥ 1 ADR in the blueprint (expected: entity-extraction-approach decision + the no-graph-DB persistence decision).
- A concrete candidate 2-table Postgres schema (entities + entity_edges) with the entity-resolution key.
- An explicit "why NOT a graph DB (ties to owner constraint + Item 14)" section.

## Global Definition of Done

- `/discover-execute entity-relation-extraction-no-graphdb` emits `<promise>BLUEPRINT_COMPLETE</promise>` with all citations verified by the Step 7 post-promise sanity check.
- `/discover-confidence entity-relation-extraction-no-graphdb` returns verdict ≥ SHIPPABLE_WITH_CAVEATS per `.claude/rules/discover-blueprint-golden-rule.md`.
- Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/entity-relation-extraction-no-graphdb-blueprint.md`.
- Compliance: respects `architecture.md` (any proposed schema must fit the existing DIP boundaries — domain defines the contract, infrastructure persists) and `no-paper-names-in-code.md` (the blueprint MAY cite Mem0/Letta; any future code MUST NOT).

## Cross-references

- Rule (SoT): `.claude/rules/cycle-discover.md`
- Golden rule: `.claude/rules/discover-plan-golden-rule.md`, `.claude/rules/discover-blueprint-golden-rule.md`
- Owner constraint origin: 2026-06-19 CTO live session (entity graph WITHOUT graph DB)
- Related frozen roadmap: Followup #3 (entity NER extraction) + Item 14 (graph backend — explicitly OUT of scope)
- Session memory: `themory-entities-table-unpopulated`
