# Blueprint: Entity + Relation Extraction WITHOUT a Graph DB

**Slug:** entity-relation-extraction-no-graphdb
**Plan:** `.claude/knowledge-base/discoveries/plans/entity-relation-extraction-no-graphdb-plan.md`
**Date:** 2026-06-19
**Status:** COMPLETE (6/6 questions answered; 1 half-question honestly BLOCKED per EC-1)
**Clones studied:** `mem0` (PRIMARY), `letta` (SECONDARY). LangMem not present in the clone.

## Context

CTO live session 2026-06-19: can TheMemory offer a Mem0-style "entity graph view" (entities the agent extracted + how memories connect them) **without** adopting a graph database (the owner explicitly rejected the Item 14 graph backend)? This blueprint reads the reference clones to answer: what is the minimal Postgres-only architecture for entities (nodes) + relations (edges) + a dashboard graph view, and what does each reference teach about the hard parts.

## Objective

Specify a no-graph-DB architecture for entity + relation extraction in TheMemory, with ≥ 2 independent reference citations per load-bearing claim: (a) entity-extraction strategy + dependency cost; (b) relation (triple) representation + normalization; (c) relational persistence + entity-resolution; (d) listing/graph REST shape.

## Coverage Corner 1 — Integration Tests

### Mem0

Entity extraction is covered by a focused unit/behavior suite — `.claude/knowledge-base/references/mem0/tests/utils/test_entity_extraction.py` (101 LoC, 9 tests). The asserted cases form a ready-made TDD RED checklist for any TheMemory extractor:

- `test_proper_nouns` (`:15`) — proper-noun entities surface.
- `test_quoted_text` (`:24`) — quoted titles (e.g. `"The Great Gatsby"`) become entities.
- `test_compound_nouns` (`:31`) — multi-word noun compounds (e.g. "machine learning").
- `test_empty_string` (`:40`) — empty input → `[]` (never null).
- `test_no_entities` (`:46`) — generic-only text ("things and stuff") yields no entities (`"things"`/`"stuff"` filtered).
- `test_deduplication` (`:55`) — repeated entity ("Google ... Google") deduped to ≤ 1.
- `test_returns_tuples` (`:62`) — every entity is a `(type, text)` tuple where `type ∈ {"PROPER","QUOTED","COMPOUND","NOUN"}` (`:69`).
- `test_batch_processing` (`:74`) + `test_empty_input` (`:88`) + `test_consistency_with_single` (`:93`) — batch path equals single path.

**Lesson for TheMemory:** the extractor contract is testable with pure-text fixtures (no DB, no LLM, deterministic) — a true unit layer. Entity TYPE is a closed enum, which maps cleanly to a Postgres `entities.type` column. The dedup test (`:55`) is the entity-resolution acceptance anchor.

### Letta

Letta tests identities at the manager/ORM boundary (relational), not as text extraction — consistent with EC-3: Letta is persistence/resolution evidence, not extraction. The unique-constraint behavior (see Corner 4 / Q3) is what a TheMemory `entity_edges`/`entities` integration test against real `ankane/pgvector:v0.5.1` would mirror (insert duplicate → constraint fires).

### LangMem

Not present in the clone (`.claude/knowledge-base/references/` holds only `mem0` + `letta`). Deferred per plan ADR D3 — no entity/relation surface.

## Coverage Corner 2 — Dependencies

### Mem0

Entity extraction is **spaCy-dependent**, gated behind an OPTIONAL extra:

- `.claude/knowledge-base/references/mem0/pyproject.toml:27-28` — `nlp = [ "spacy>=3.7.0", ... ]` — spaCy is NOT a core dependency; it lives in the `[nlp]` extra.
- `.claude/knowledge-base/references/mem0/mem0/utils/spacy_models.py:27` — if spaCy is absent the loader raises with the install hint `pip install mem0ai[nlp]`.
- `.claude/knowledge-base/references/mem0/mem0/utils/spacy_models.py:22,30-35` — even with spaCy installed, the `en_core_web_sm` model is downloaded on-demand at first use (`spacy.cli.download`).
- `.claude/knowledge-base/references/mem0/mem0/utils/entity_extraction.py:137` — `extract_entities` does a lazy `from mem0.utils.spacy_models import get_nlp_full` (so importing the module does not force spaCy).

**Lesson for TheMemory (EC-5):** the spaCy path carries a real cost — a heavy dependency PLUS a runtime model download (bad for air-gapped CI, ~12MB model). For a TS/Node stack this is even worse (spaCy is Python). **The no-new-heavy-dep alternative** is to reuse TheMemory's EXISTING extraction LLM call (the write pipeline already calls an LLM to extract facts) and have it ALSO emit entities + relations — zero new dependency. See ADR D1.

### Letta

Pure SQLAlchemy + Postgres — no NLP/graph dependency for identities (`.claude/knowledge-base/references/letta/letta/orm/identity.py:9-11` imports only `sqlalchemy`). Confirms the persistence half needs zero new deps on top of pg.

### LangMem

N/A (not cloned).

## Coverage Corner 3 — Tools

### Mem0

Mem0 OSS exposes an entity **node LISTING** API (NOT a graph endpoint — EC-2 guard):

- `.claude/knowledge-base/references/mem0/server/routers/entities.py` — `GET /entities` (`:45 list_entities`) returns `list[Entity]` where `Entity{id, type, total_memories, created_at, updated_at}`.
- Aggregation technique (`:46-66`): scans memory payloads, buckets by `(entity_type, value)`, increments `total_memories`, tracks `min(created_at)`/`max(updated_at)` per bucket, sorts by `(type, id)`.
- `EntityType = Literal["user","agent","run"]` with `TYPE_TO_FIELD` mapping to `user_id`/`agent_id`/`run_id` — i.e. Mem0's "entities" endpoint is really an aggregation over the SCOPE fields, conceptually close to TheMemory's current `attributed_to`-derived entities tab.
- `DELETE /{entity_type}/{entity_id}` (`delete_entity`) — curation parallel to our skill forget.
- A CLI mirror exists at `.claude/knowledge-base/references/mem0/cli/python/src/mem0_cli/commands/entities.py`.

**EC-2 honest note:** there is NO `{nodes, edges}` graph endpoint anywhere in the OSS clone — the Pro/Enterprise "Graph view" frontend is closed-source. The `{nodes, edges}` REST shape proposed for TheMemory below is OUR synthesis, with no OSS precedent for the EDGES half.

### Letta

Identity CRUD via `IdentityManager` (`.claude/knowledge-base/references/letta/letta/services/identity_manager.py`) — `list_identities_async` (`:33`, filterable by `identifier_key` `:55-56`), `get`, `create`, `upsert`, `update`. Relational listing, not graph.

### LangMem

N/A.

## Coverage Corner 4 — Techniques

### Technique 1 — Entity extraction (nodes) WITHOUT LLM or graph DB (Q1)

`.claude/knowledge-base/references/mem0/mem0/utils/entity_extraction.py`:
- Contract (`:11`, `:123`): `extract_entities(text: str) -> List[Tuple[str, str]]` returning `(TYPE, text)` pairs; `TYPE ∈ {"PROPER","QUOTED","COMPOUND","NOUN"}`.
- Mechanism (`:137-139`): spaCy NLP doc → `_extract_entities_from_doc`. Extracts proper nouns, quoted spans, noun compounds, and a noun fallback.
- Noise filtering: module-level stoplists `_GENERIC_HEADS` (thing/stuff/way/...), `_CIRCUMSTANTIAL_MODS` (solo/individual/team/...), `_NON_SPECIFIC_ADJ` (many/few/great/...) drop low-signal candidates BEFORE they become entities.

**Takeaway:** entity extraction is a deterministic text→list transform — NO graph DB and (in Mem0) NO LLM. The output shape (type + text) is exactly two columns. The filtering stoplists are the difference between a useful node set and noise.

### Technique 2 — Relation (triple) representation + normalization (Q2)

`.claude/knowledge-base/references/mem0/mem0/memory/utils.py`:
- Triple shape (`:78`): `f"{entity['source']} -- {entity['relationship']} -- {entity['destination']}"` — relations are plain dicts `{source, relationship, destination}`.
- Normalization (`:271-291`): lowercases, replaces spaces with underscores, guards the required keys `("source","relationship","destination")` (`:282`) to avoid KeyError on malformed LLM output (`[{}]`).
- `sanitize_relationship_for_cypher` (`:218`) — graph-DB-specific (Cypher), therefore **droppable** for a Postgres edge table; the normalization (lowercase/underscore/required-key) is reusable as-is.

**EC-1 honest BLOCKED half:** the code that PROMPTS the LLM to PRODUCE these triples lives in Mem0's optional `mem0[graph]` extra, which is **NOT in the clone** (the `graphs` package under the mem0 source tree is absent — confirmed via directory listing 2026-06-19). <!-- BLOCKED: relation-extraction prompt lives in absent mem0[graph] extra; no path to cite --> So the extraction step itself is not citeable here. What IS citeable — and what matters for a no-graph-DB design — is the triple SHAPE + normalization, which are storage-agnostic. A triple `(source, relationship, destination)` is three columns + provenance — a Postgres edge row.

### Technique 3 — Relational entity persistence + resolution (Q3)

`letta` identities model the "store + resolve" half relationally:
- Schema (`.claude/knowledge-base/references/letta/letta/orm/identity.py:21-38` + migration `.claude/knowledge-base/references/letta/alembic/versions/a113caac453e_add_identities_table.py:29-42`): table `identities` with `id`, `identifier_key` (the external dedup key), `name`, `identity_type`, `project_id`, `organization_id`, `created_at`, `updated_at`, `is_deleted`.
- Resolution key (`identity.py:24-28`): composite `UniqueConstraint("identifier_key", "project_id", "organization_id")` named `unique_identifier_key_project_id_organization_id` — duplicates are prevented at the DB layer per tenant/project.
- Resolution path (`identity_manager.py:98-116`): `_create_identity_async` explicitly checks for an existing `identifier_key` and raises `UniqueConstraintViolationError`; `upsert_identity_async` (`:142-157`) does get-by-key-then-update-else-create.

**Cross-cite (EC-6):** Mem0's batch dedup is the lighter-weight resolution prior art — `.claude/knowledge-base/references/mem0/mem0/memory/main.py:868-877` builds `global_entities: normalized_key -> (type, text, set[memory_ids])`, deduping entities across memories by a NORMALIZED key, and links entities↔memory at `main.py:511-522` (`_link_entities_for_memory`) into a `{collection}_entities` store (`main.py:394`).

**Takeaway:** entity resolution = a normalized key + a unique constraint (scoped per tenant). Letta proves the DB-constraint approach; Mem0 proves the normalized-key dedup. Neither needs a graph DB.

## Cross-cutting Comparison

| Concern | Mem0 (OSS) | Letta | No-graph-DB feasibility |
|---|---|---|---|
| Entity (node) extraction | spaCy NER, `(type,text)` | n/a (declared, not extracted) | YES — deterministic transform OR reuse existing LLM call |
| Relation (edge) extraction | LLM in absent `mem0[graph]` | n/a | shape known; reuse TheMemory LLM call |
| Triple representation | `{source,relationship,destination}` | n/a | 3 columns + provenance in Postgres |
| Entity resolution | normalized-key dedup (`main.py:868`) | unique constraint (`identity.py:24`) | YES — both are SQL-native |
| Listing API | `GET /entities` node list | identity CRUD | YES — REST over SQL JOINs |
| Graph view | closed Pro frontend | n/a | OUR synthesis (`{nodes,edges}`) |
| Storage backend | vector store / graph extra | Postgres | **Postgres only** |

## ADRs

### D1 — Entity extraction via `compromise` (the Mem0-TS way); relations via the existing LLM call

- **Decision (project-owner, 2026-06-20 live session):** entities (NODES) extracted with the `compromise` npm package — EXACTLY how Mem0's TS implementation does it (`.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/utils/entity_extraction.ts:300` lazy `require("compromise")` + regex fallback) — as an OPTIONAL lazy-loaded dep. Relations (EDGES/triples) reuse TheMemory's EXISTING write-pipeline LLM call (compromise extracts nodes only).
- **Alternatives:** (a) spaCy NER like Mem0-Python — REJECTED: spaCy is Python; TheMemory is TS/Node. Mirroring it would require a Python sidecar/subprocess + `en_core_web_sm` download (`.claude/knowledge-base/references/mem0/mem0/utils/spacy_models.py:30-35`) bundled into the Node Docker image (cross-runtime, +~150MB). "Install spaCy like Mem0" is honestly impossible on a Node stack. (b) `compromise` for nodes — CHOSEN for entities: it IS the Mem0 way on the TS side, JS-native, lazy + regex fallback, no Python. (c) reuse the LLM call for both — partially adopted: it is the only path for RELATIONS (compromise gives nodes only), so edges use it; entities use compromise to keep the deterministic node path offline-capable.
- **Rationale:** Não Reinvente (mirror Mem0-TS faithfully) + KISS (no second runtime) + honesty (spaCy cannot be "installed the same way" on Node — `compromise` is its TS equivalent).

### D2 — Persist entities + relations in two Postgres tables; NO graph DB

- **Decision:** `entities(id, scope, type, name, normalized_key, created_at, updated_at)` + `entity_edges(id, source_entity_id, target_entity_id, relation, source_memory_id, created_at)`. Entity resolution via UNIQUE `(scope, normalized_key)` (Letta `identity.py:24-28` precedent). Edges carry `source_memory_id` provenance (Princípio 3 auditability).
- **Alternatives:** (a) Neo4j/Apache AGE/Neptune (Item 14) — REJECTED by owner; only justified by deep multi-hop traversal, which the dashboard view (1–2 hops) does not need. (b) single JSON column of triples on `memories` — REJECTED: not queryable/aggregatable, breaks the listing endpoint. (c) two relational tables — CHOSEN: nodes+edges are relational data; `JOIN` covers 1–2 hop rendering; zero new infra; stays "on top of pgvector".
- **Rationale:** a graph is nodes+edges; Postgres models that natively. The graph DB only wins on recursive traversal — out of scope.

## Recommendations for TheMemory

1. **Extraction:** extend the existing extraction LLM call to emit `{entities[], relations[]}` (D1). Keep fail-soft: malformed triple → skip with an OTel event (mirror `utils.py:282` required-key guard).
2. **Persistence:** two tables (D2); resolution by `(scope, normalized_key)` UNIQUE; edges carry memory provenance.
3. **Resolution:** normalized-key dedup (lowercase + underscore, per `utils.py:271-291` and `main.py:868`), guarded by the UNIQUE constraint (per Letta `identity.py:24`).
4. **REST:** `GET /v1/scopes/:type/:id/graph` → `{ nodes: Entity[], edges: Edge[] }`. Mirror the node-listing aggregation shape from `entities.py:46-66` (per-entity `total_memories`); the edges half is new (EC-2).
5. **Dashboard:** replace the current weak `attributed_to`-derived Entities list with a real node listing first, then a `{nodes,edges}` graph view (cytoscape/react-flow) — frontend-only, no backend graph dep.
6. **Why NOT a graph DB:** the owner's constraint is correct — for a 1–2 hop dashboard view, two Postgres tables + JOINs suffice. A graph backend (Item 14) is reserved for future deep-traversal use cases and stays FROZEN.

## Blocked questions (if any)

- **Q2 (half) — BLOCKED:** the relation-EXTRACTION prompt/LLM-call is in Mem0's optional `mem0[graph]` module, absent from the clone (EC-1). The triple SHAPE + normalization ARE answered from `utils.py`. No fabricated path cited. Recommendation: the extraction step is designed via D1 (reuse our own LLM call), so the missing reference does not block implementation.

## Halt-loop progress (audit trail)

| Q | Corner | Status | Key citation |
|---|---|---|---|
| Q1 | techniques | done | `mem0/mem0/utils/entity_extraction.py:11,123,137` |
| Q2 | techniques | done (extraction half blocked, EC-1) | `mem0/mem0/memory/utils.py:78,271-291` |
| Q3 | techniques | done | `.claude/knowledge-base/references/letta/letta/orm/identity.py:24-38` + `identity_manager.py:98-116` |
| Q4 | tests | done | `.claude/knowledge-base/references/mem0/tests/utils/test_entity_extraction.py:15-101` |
| Q5 | deps | done | `.claude/knowledge-base/references/mem0/pyproject.toml:27` + `.claude/knowledge-base/references/mem0/mem0/utils/spacy_models.py:22-35` |
| Q6 | tools | done | `.claude/knowledge-base/references/mem0/server/routers/entities.py:45-66` |

## Related

- Plan: `.claude/knowledge-base/discoveries/plans/entity-relation-extraction-no-graphdb-plan.md`
- Edge cases: `.claude/knowledge-base/reviews/entity-relation-extraction-no-graphdb-edge-cases-2026-06-19.md`
- Frozen roadmap: Followup #3 (entity NER extraction) + Item 14 (graph backend — OUT of scope)
- Session memory: `themory-entities-table-unpopulated`
