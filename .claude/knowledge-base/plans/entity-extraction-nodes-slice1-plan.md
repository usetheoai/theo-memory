---
slug: entity-extraction-nodes-slice1
milestone_id:
created_at: 2026-06-20
goal: Populate the entities table from memory text via a compromise-based EntityExtractor (Mem0-TS way) and serve a real per-scope entity (node) listing, replacing the attributed_to-derived stub.
---

# Plan: Entity Extraction (Nodes) — Slice 1

> **Version 1.1** (edge-cases absorbed 2026-06-20 — EC-1 `type` included in the dedup identity [UNIQUE on `(workspace_id, scope, type, normalized_key)`] in T2.1/T3.1; EC-2 empty/short-name drop guard in T1.2/T3.1; EC-3 per-memory entity cap + EC-4 entityBoost-default wiring + EC-5 embedding-dim parity added as SHOULD-TEST tasks; EC-6/EC-7 documented. See `.claude/knowledge-base/reviews/entity-extraction-nodes-slice1-edge-cases-2026-06-20.md`.)

> **Version 1.0** — Wire the long-declared-but-deferred Phase 7 (entity linking) of the write pipeline using a `compromise`-based `EntityExtractor` DIP (the Mem0-TS approach, NOT spaCy), persist extracted entities into the existing `entities` table with a per-scope dedup key + a `memory_entities` provenance link, and upgrade `GET /v1/scopes/:type/:id/entities` to read from the REAL table instead of the `attributed_to`-derived stub. NODES only — relations (edges) + graph view are Slice 2. Unfrozen by project-owner/CTO sign-off 2026-06-20 (CLAUDE.md Amendment 2026-06-20), grounded in blueprint `entity-relation-extraction-no-graphdb` (`/discover-confidence` SHIPPABLE 100).

## Goal

> "Populate the `entities` table from memory text on every `remember()` (entityBoost-gated) via a `compromise`-based extractor, so `GET /v1/scopes/:type/:id/entities` returns the REAL deduplicated entities a scope has accumulated with a correct `memory_count`, measured by the integration test `entitiesHandler returns extracted entities with memory_count from the entities table` passing against real `ankane/pgvector:v0.5.1`."

## Context

The CTO live session (2026-06-19/20) asked for a Mem0-style entity view WITHOUT a graph DB. Discovery (blueprint `entity-relation-extraction-no-graphdb`, SHIPPABLE 100) established the no-graph-DB architecture; the owner unfroze it (CLAUDE.md Amendment 2026-06-20) and locked the technique: entities (nodes) via `compromise` (the Mem0-TS way — `mem0-ts/src/oss/src/utils/entity_extraction.ts:300` lazy `require("compromise")` + regex fallback), NOT spaCy (Python, impossible to "install the same way" on a Node stack). Relations use the LLM call (Slice 2).

Today the `entities` table exists (`schema.ts:325`, migration `0000`) but is **never written** — Phase 7 of the extraction pipeline is a placeholder (`pipeline.ts:514` "entity linking — deferred to v0.2"). The endpoint `entitiesHandler` (`entities.ts:46`) honestly derives a weak entity list from distinct `attributed_to` peers, disclosed as a gap (session memory `themory-entities-table-unpopulated`). Slice 1 closes that gap with real extraction-and-persist.

## Baseline Context (deep review of current state)

### Files that will be touched

**theo-memory repo** (`/home/paulo/Projetos/usetheo/theo-data/theo-memory`):

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/extraction/pipeline.ts` | 520 | `ea9f2dc` | 8-phase write pipeline; Phase 7 (entity linking) is a placeholder at `:514` | Phases 1-6 unchanged; Phase 7 becomes real but stays `entityBoost`-gated (ADR-0007); fail-soft (entity failure MUST NOT fail the remember) |
| `packages/core/src/domain/dip/entity-extractor.ts` (NEW) | 0 | `ea9f2dc` | (new) `EntityExtractor` DIP interface | — |
| `packages/core/src/infrastructure/extraction/compromise-entity-extractor.ts` (NEW) | 0 | `ea9f2dc` | (new) default impl: compromise + regex fallback (Mem0-TS port) | lazy import; never throws on missing dep |
| `packages/core/src/infrastructure/db/schema.ts` | 520 | `bbf8975` | Drizzle schema incl. `entities` (`:325`) | existing `entities` columns kept; ADD `normalized_key` + scope cols + new `memory_entities` table; add-only |
| `packages/core/src/infrastructure/db/migrations/0017_entity_nodes.sql` (NEW) | 0 | `bbf8975` | (new) non-destructive migration | additive only; existing rows survive |
| `packages/api/src/server/handlers/entities.ts` | 81 | `6ee371e` | `entitiesHandler` — attributed_to-derived stub (`:46`) | response SHAPE `{entities:[{id, memory_count, last_seen_at, ...}]}` preserved (gateway + dashboard depend on it) |
| `packages/api/src/server/handlers/__tests__/entities.test.ts` (verify/extend) | 0 | `6ee371e` | unit tests | existing stay green |
| `tests/integration/entities/extract.test.ts` (NEW) | 0 | `6ee371e` | (new) real-pgvector extract→list round-trip | — |
| `package.json` (core) | 0 | `bbf8975` | deps | ADD `compromise` as OPTIONAL dependency (lazy) |

### Current callers / dependents

- `entitiesHandler` is proxied by theo-cloud gateway `internal/themory/client.go` `ListEntities` + surfaced in dashboard `dashboard/src/pages/memory/entities.tsx`. **Slice 1 keeps the response shape** (`{entities:[{id, memory_count, last_seen_at}]}`) so NO gateway/dashboard change is required — the data just becomes real. (Verified: gateway derives nothing extra; dashboard renders the list.)
- `entities` table DDL today (`schema.ts:325-342`): `id, workspace_id, name, embedding, payload, created_at` + `entities_name_idx` + `entities_embedding_hnsw_idx`. NO scope columns, NO memory link → both added by this slice.
- Phase 7 gate: `config.entityBoost` (ADR-0007, default `true`). The pipeline already threads this flag; Slice 1 activates the gated branch.

### Domain glossary

- **Entity (node)** — a `(type, name)` pair extracted from memory text; `type ∈ {PROPER, QUOTED, COMPOUND, NOUN}` (the closed extraction enum).
- **normalized_key** — `name.toLowerCase().replace(/\s+/g,'_')`; the per-scope dedup key (precedent: dedup-by-normalized-key + unique-constraint resolution in the references).
- **memory_entities** — join table `(memory_id, entity_id)` giving `memory_count` + provenance (Princípio 3 auditability).

### Architecture boundaries affected

- **DIP boundary (per `architecture.md`):** `EntityExtractor` is declared in `core/domain/dip` (the domain owns the contract); `CompromiseEntityExtractor` lives in `core/infrastructure/extraction` (infra implements). The pipeline (domain) depends on the interface, never on the concrete impl — same DIP shape as the existing embedder/LLM/vector-store ports. NO new cross-layer import is introduced.
- **Persistence boundary:** the new `memory_entities` table + extended `entities` columns stay inside `core/infrastructure/db`; the handler reads via the existing scoped-memory path, not by importing infra directly.
- **Public surface:** `EntityExtractor` is added to the core barrel (new export, pre-release acceptable); the REST response shape of `GET .../entities` is UNCHANGED (no breaking change at the gateway/dashboard boundary).
- **`compromise` optional-dep boundary:** lazy `require` keeps the default barrel free of a hard `compromise` import (bundle-isolation; mirrors the EC-26 dynamic-import precedent).

## Prior Art & Related Work

- Blueprint `entity-relation-extraction-no-graphdb` (SHIPPABLE 100) — the discovery this plan implements.
- Mem0-TS `compromise` extractor: `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/utils/entity_extraction.ts` (port target — types, stoplists, lazy-load).
- Mem0 entity test checklist: `.claude/knowledge-base/references/mem0/tests/utils/test_entity_extraction.py:15-101` (RED test cases).
- Mem0 dedup-by-normalized-key: `.claude/knowledge-base/references/mem0/mem0/memory/main.py:868-877`.
- Letta unique-constraint resolution: `.claude/knowledge-base/references/letta/letta/orm/identity.py:24-28`.
- Mem0 listing aggregation shape: `.claude/knowledge-base/references/mem0/server/routers/entities.py:46-66`.

## ADRs

### D1 — `EntityExtractor` DIP + `CompromiseEntityExtractor` default (compromise, not spaCy)

- **Decision:** declare an `EntityExtractor` interface in `core/domain/dip` (`extract(text): {type, name}[]`); default impl `CompromiseEntityExtractor` lazy-`require`s `compromise` with a regex-only fallback, porting the Mem0-TS stoplists + 4 entity types.
- **Alternatives:** (a) spaCy via Python sidecar — REJECTED (cross-runtime, +Python in Docker; CLAUDE.md Amendment 2026-06-20 D1). (b) inline in pipeline — REJECTED (violates DIP + SRP; not unit-testable in isolation; ADR-0007 wants entity store swappable). (c) LLM-only for nodes — REJECTED for Slice 1 (compromise is deterministic/offline, cheaper; LLM is reserved for edges in Slice 2). 
- **Rationale:** Não Reinvente (mirror Mem0-TS) + DIP (domain defines the contract; infra implements) + KISS (no second runtime).

### D2 — Persist into existing `entities` table + new `memory_entities` link; resolution by `(workspace_id, scope_signature, normalized_key)` UNIQUE

- **Decision:** extend `entities` with `normalized_key` + `type` + scope columns (`user_id`/`session_id`/`agent_id` nullable, mirroring `memories`); add `memory_entities(memory_id uuid FK ON DELETE CASCADE, entity_id uuid FK ON DELETE CASCADE, PRIMARY KEY(memory_id, entity_id))`. Dedup via `INSERT ... ON CONFLICT (workspace_id, scope_signature, type, normalized_key) DO NOTHING RETURNING id` (then SELECT on conflict). **EC-1:** `type` is part of the dedup identity so "Apple" (PROPER) and "apple" (NOUN) do not silently merge.
- **Alternatives:** (a) graph DB / Item 14 — REJECTED by owner (out of scope). (b) store scope in `payload` jsonb — REJECTED (not indexable; EC-1 of workspace isolation wants real columns). (c) count via scanning payloads like Mem0 (`entities.py`) — REJECTED (O(scope) scan; a join table is O(1) per insert + indexable).
- **Rationale:** relational nodes+links in Postgres; UNIQUE constraint IS the resolution (Letta precedent); CASCADE keeps the GDPR/forget path clean.

### D3 — Endpoint reads the real table; response shape unchanged; fail-soft extraction

- **Decision:** `entitiesHandler` queries `entities JOIN memory_entities` GROUP BY for `memory_count` + `max(created_at)` as `last_seen_at`, scoped by the path scope. Response shape `{entities:[{id, memory_count, last_seen_at}]}` is byte-compatible with today's stub (gateway/dashboard untouched). Phase 7 extraction is **fail-soft**: any extractor/persist error emits an OTel event and is swallowed — a remember() MUST NEVER fail because entity linking failed.
- **Alternatives:** (a) new endpoint — REJECTED (the shape already exists + is wired; reuse it). (b) hard-fail on extraction error — REJECTED (entity linking is a side-benefit, not core to remember; Princípio 3 says observe the IGNORE, do not abort the write).
- **Rationale:** zero downstream churn + honesty (the gap closes silently-better) + fail-fast where it matters (the write) vs fail-soft where it doesn't (the side index).

## Dependencies

| Package | Version | Type | Rule 9 evaluation | CVE check |
|---|---|---|---|---|
| `compromise` | `^14.0.0` | OPTIONAL (lazy `require`, regex fallback) | Evaluated: spaCy (Python — wrong runtime, REJECTED), `wink-nlp` (heavier model deps), `natural` (older, less maintained). `compromise` CHOSEN — it is the exact lib Mem0-TS uses (`entity_extraction.ts`), pure-JS, no native build, MIT license, actively maintained. | `/deps-audit` to confirm zero CRITICAL/HIGH on `^14.0.0` before implement |

## Dependency Graph (phases)

```
Phase 1 (EntityExtractor DIP + compromise impl)  ─┐
Phase 2 (schema + migration 0017)               ─┼─> Phase 3 (wire Phase 7 of pipeline)
                                                  │
Phase 3 ─> Phase 4 (entitiesHandler reads real table)
Phase 4 ─> Phase 5 (Integration Validation)
```

Phase 1 and Phase 2 are independent (parallelizable). Phase 3 needs both. Phase 4 needs Phase 3. Phase 5 needs all.

## Phase 1 — EntityExtractor DIP + CompromiseEntityExtractor

### T1.1 — Declare the `EntityExtractor` DIP

#### Why this step
Action: add `core/domain/dip/entity-extractor.ts` with `interface EntityExtractor { extract(text: string): ReadonlyArray<{ type: EntityType; name: string }> }`.
Reasoning: ADR D1 — the domain owns the contract so the impl is swappable + unit-testable (DIP). EntityType is the closed Mem0 enum.

#### Files to edit
- `packages/core/src/domain/dip/entity-extractor.ts` (NEW)

#### TDD
- RED `test('EntityExtractor type is structurally satisfied by a stub returning typed pairs')` — `expectTypeOf` / a stub impl compiles.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- `npm run typecheck` passes with the new interface exported from the core barrel. Verify: `grep EntityExtractor packages/core/src/index.ts`.

#### DoD
- Interface exported; `npm run typecheck` exit 0.

### T1.2 — `CompromiseEntityExtractor` (Mem0-TS port: compromise + regex fallback)

#### Why this step
Action: implement `infrastructure/extraction/compromise-entity-extractor.ts` — lazy `require('compromise')` in try/catch, regex fallback when absent; port the `GENERIC_HEADS` / `NON_SPECIFIC_ADJ` stoplists + PROPER/QUOTED/COMPOUND/NOUN extraction.
Reasoning: ADR D1 — faithful to `entity_extraction.ts:300`; deterministic + offline-capable; never throws on missing dep.

#### Files to edit
- `packages/core/src/infrastructure/extraction/compromise-entity-extractor.ts` (NEW)
- `package.json` (core) — add `compromise` optional dep

#### TDD (ported from Mem0 `test_entity_extraction.py:15-101`)
- RED `test('extracts proper nouns')` — "John Smith works at Google" → contains PROPER.
- RED `test('extracts quoted text')` — `"The Great Gatsby"` → QUOTED.
- RED `test('extracts compound nouns')` — "machine learning engineer" → COMPOUND.
- RED `test('empty string returns empty array')` — `''` → `[]`.
- RED `test('generic-only text yields no entities')` — "things and stuff" → no "things"/"stuff".
- RED `test('returns (type,name) pairs with type in the closed enum')`.
- RED `test('regex fallback path works when compromise is absent')` — inject a loader that throws → still returns regex entities, never throws.
- RED `test('blank or punctuation-only candidate is dropped')` — EC-2: a candidate whose normalized form is empty OR length < 2 is NOT emitted (no empty-name entity, no wasted embedding).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- All 8 tests green; `npm test -- compromise-entity-extractor` exit 0.
- No-paper-names: the impl JSDoc cites `@see .claude/knowledge-base/.../blueprint` not "Mem0" in identifiers. Verify: `grep -iE 'mem0|spacy' packages/core/src/infrastructure/extraction/compromise-entity-extractor.ts` returns nothing in identifiers (benchmark exemption N/A here).

#### DoD
- 7 tests green; lint clean; fallback proven.

## Phase 2 — Schema + migration

### T2.1 — Extend `entities` + add `memory_entities`; migration 0017

#### Why this step
Action: in `schema.ts` add `normalizedKey` + scope columns to `entities` + a UNIQUE `(workspace_id, user_id, session_id, agent_id, normalized_key)`; add `memoryEntities` table. Generate non-destructive `0017_entity_nodes.sql`.
Reasoning: ADR D2 — UNIQUE is the resolution; join table gives count + provenance with CASCADE for forget.

#### Files to edit
- `packages/core/src/infrastructure/db/schema.ts`
- `packages/core/src/infrastructure/db/migrations/0017_entity_nodes.sql` (NEW)
- `packages/core/src/infrastructure/db/schema.test.ts` (extend)

#### TDD
- RED `test('entities has a unique constraint on (workspace_id, scope, type, normalized_key)')` — schema assertion (EC-1: type in identity).
- RED `test('memory_entities cascades on memory delete')` — insert link, delete memory, link gone (integration, real pg).
- RED `test('entities.embedding dim equals memories MAX_EMBEDDING_DIM')` — EC-5: assert the entity embedding column dim matches the memory embedder output dim (a 384-vs-1536 mismatch would fail the insert).

#### Concurrency tests
- A concurrent test fires two simultaneous extract-persist calls of the same entity under the same scope and asserts an atomic-counter invariant: exactly one `entities` row results (the ON CONFLICT DO NOTHING upsert is the happens-before observation). The test asserts the DB row-count invariant, not merely no-throw.

#### Acceptance criteria
- `npm run db:generate` produces 0017 with only `ADD COLUMN`/`CREATE TABLE`/`CREATE UNIQUE INDEX` (no DROP). Verify: `grep -iE 'drop ' migrations/0017_entity_nodes.sql` returns nothing.
- Drizzle journal in sync (no drift). Verify: `npm run db:check` exit 0.

#### DoD
- Migration additive; schema tests green; journal synced.

## Phase 3 — Wire Phase 7 of the write pipeline

### T3.1 — Activate entity linking (entityBoost-gated, fail-soft)

#### Why this step
Action: at `pipeline.ts:514`, when `config.entityBoost !== false`, for each persisted memory call `entityExtractor.extract(text)`, embed each name, UPSERT into `entities` (ON CONFLICT by normalized_key), insert `memory_entities` links. Wrap in try/catch → `emitEvent(tracer, 'entity_linking_failed', ...)` and swallow.
Reasoning: ADR D3 — fail-soft; the write must never fail because the side index failed (Princípio 3 — observe, don't abort).

#### Files to edit
- `packages/core/src/domain/extraction/pipeline.ts`
- `packages/core/src/domain/extraction/extraction-pipeline.test.ts` (extend)
- the `MEMORY_EVENTS` union — add `entity_linking_failed` literal

#### TDD
- RED `test('remember() with entityBoost persists extracted entities + links')` — stub extractor returns 2 entities → 2 entities rows + 2 link rows.
- RED `test('entityBoost=false skips entity linking entirely')` — no entities rows written.
- RED `test('extractor throwing does NOT fail remember() and emits entity_linking_failed')` — fail-soft proven.
- RED `test('same entity across two memories increments memory_count to 2, entities row stays 1')`.
- RED `test('createLocalMemory defaults entityBoost so Phase 7 runs by default')` — EC-4: the gate defaults ON (ADR-0007) and the factory actually threads it to Phase 7 (else the feature silently never runs).
- RED `test('entity extraction caps at N entities per memory')` — EC-3: a pathological long input cannot spawn unbounded rows/embeddings (per-memory cap, e.g. 50).
- RED `test('empty-normalized-name entity is never persisted')` — EC-2 at the persist layer (defense in depth with T1.2).

#### Concurrency tests
- A concurrent test fires two simultaneous remember() calls carrying the same entity and asserts an atomic-counter invariant: 1 entity row, 2 link rows (the ON CONFLICT upsert is the happens-before observation). Builds on the T2.1 persist-layer race detector coverage.

#### Acceptance criteria
- 4 tests green; `entity_linking_failed` in the typed union. Verify: `grep entity_linking_failed packages/core/src/**/events*.ts`.

#### DoD
- Phase 7 active + gated + fail-soft; tests green.

## Phase 4 — Endpoint reads the real table

### T4.1 — `entitiesHandler` queries `entities`+`memory_entities` (shape unchanged)

#### Why this step
Action: replace the `attributed_to` accumulation in `entities.ts:46-82` with a scope-filtered query over `entities JOIN memory_entities` GROUP BY entity → `{id: name, memory_count, last_seen_at: max(created_at)}`, sorted desc. Keep the exact response shape.
Reasoning: ADR D3 — real data, zero downstream churn (gateway/dashboard untouched).

#### Files to edit
- `packages/api/src/server/handlers/entities.ts`
- `packages/api/src/server/handlers/__tests__/entities.test.ts`

#### TDD
- RED `test('entitiesHandler returns extracted entities with memory_count from the entities table')` — seed entities+links → correct counts, sorted.
- RED `test('empty scope returns { entities: [] }')`.
- RED `test('response shape unchanged: id, memory_count, last_seen_at present')` — guards gateway/dashboard contract.
- RED `test('workspace isolation: another workspace entities not returned')`.

#### Concurrency tests
(none — single-threaded)

#### Failure scenarios
- `## Failure scenarios` — DB unavailable during the GROUP BY query → handler returns 500 with a typed error (not a 200 with `[]` that would mask the outage). Test reproduces via a pool that rejects.

#### Acceptance criteria
- 4 tests green; api suite green. Verify: `npm test -- entities` exit 0.

#### DoD
- Endpoint serves real entities; shape contract held; tests green.

## Phase 5 — Integration Validation (mandatory)

### T5.1 — Real-pgvector extract→list round-trip

#### Why this step
Action: `tests/integration/entities/extract.test.ts` — `createLocalMemory({ entityBoost: true })` against real `ankane/pgvector:v0.5.1`; `remember("John Smith works at Google")`; assert `GET /v1/scopes/user/:id/entities` returns entities incl. a PROPER node with `memory_count >= 1`.
Reasoning: THE GOAL TEST — proves the full chain (extract → persist → list) end-to-end.

#### Files to edit
- `tests/integration/entities/extract.test.ts` (NEW)

#### TDD
- RED THE GOAL TEST as above + the cascade test (delete memory → link gone) + the dedup test (same entity twice → 1 row, count 2).

#### Concurrency tests
(none — single-threaded)

#### Failure scenarios
- extractor lazy-load fails (compromise absent) → regex fallback still yields entities; the round-trip still passes (proves the optional-dep posture).

#### Acceptance criteria
- `THEOMEM_PG_URI=... npm run test:integration -- entities/extract` exit 0.
- Full chain green: `npm test` + `npm run typecheck` + `npm run lint` exit 0.

#### DoD
- GOAL TEST green vs real pgvector; full suite green; CHANGELOG `[Unreleased]` updated.

## Failure scenarios

External-I/O surfaces touched: Postgres (pgvector) writes/reads + the embedder call during entity linking. Per-dependency failure modes + how tests reproduce them + expected behavior:

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| Postgres (entity UPSERT in Phase 7) | INSERT/connection error mid-linking | inject a pool whose entity insert rejects | Phase 7 fail-soft: `entity_linking_failed` OTel event emitted, the `remember()` STILL succeeds (T3.1) |
| Postgres (GROUP BY in handler) | DB unavailable during list | pool that rejects the read | `entitiesHandler` returns 500 typed error, NOT a 200 with `[]` masking the outage (T4.1) |
| Embedder (name embedding in Phase 7) | embedder throws/timeout | stub embedder that rejects | fail-soft per ADR D3 — event emitted, write not aborted (T3.1) |
| `compromise` optional dep | package absent at runtime | loader injected to throw | regex fallback yields entities; never throws (T1.2, T5.1) |
| Postgres (concurrent same-entity insert) | unique-key race | `Promise.all` two identical extract-persist | ON CONFLICT DO NOTHING → exactly one entities row (T2.1, T3.1) |

## Coverage Matrix

| Goal claim / requirement | Task(s) |
|---|---|
| Extract entities via compromise (Mem0-TS way, not spaCy) | T1.1, T1.2 |
| Regex fallback when compromise absent | T1.2, T5.1 |
| Persist into `entities` table + provenance link | T2.1, T3.1 |
| Per-scope dedup (normalized_key UNIQUE) | T2.1, T3.1 |
| Phase 7 gated by entityBoost + fail-soft | T3.1 |
| `memory_count` correct from real table | T3.1, T4.1, T5.1 |
| Endpoint shape unchanged (gateway/dashboard untouched) | T4.1 |
| Workspace isolation | T4.1 |
| EC-1 type in dedup identity (no Apple/apple merge) | T2.1, T3.1 |
| EC-2 empty/short-name drop guard | T1.2, T3.1 |
| EC-3 per-memory entity cap | T3.1 |
| EC-4 entityBoost defaults ON + threaded | T3.1 |
| EC-5 entity embedding dim parity | T2.1 |
| GOAL TEST vs real pgvector | T5.1 |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `compromise` extraction quality < spaCy (JS NLP weaker) | MEDIUM | It is the exact Mem0-TS choice; stoplists ported; quality is a known trade-off, acceptable for a node index; Slice 2 LLM edges add semantic depth. | impl |
| Entity-linking adds write latency (embed N names per remember) | MEDIUM | entityBoost-gated (opt-out); fail-soft so it never blocks; embeddings batched; measure via OTel. | impl |
| Migration on a large existing `memories` table (no backfill) | LOW | No backfill — entities populate forward-only (honest, like v1.1 attributed_to EC-1); document in CHANGELOG. | impl |

## Unresolved Questions

- Should pre-existing memories be backfilled with entities? **Resolved:** NO — forward-only population (mirrors v1.1 attributed_to no-backfill honesty). A backfill job is a separate post-Slice-1 task if demanded.
- Embedding cost per entity name — acceptable? **Resolved:** gated + fail-soft + batched; revisit only if OTel shows regression.

## Global Definition of Done

- [ ] All 5 phases' DoD checked.
- [ ] `npm test` + `npm run typecheck` + `npm run lint` exit 0 (theo-memory).
- [ ] THE GOAL TEST (T5.1) green vs real `ankane/pgvector:v0.5.1`.
- [ ] Migration 0017 additive; Drizzle journal synced.
- [ ] `compromise` declared OPTIONAL; default barrel does NOT hard-require it (bundle isolation).
- [ ] CHANGELOG `[Unreleased] § Added` entry (entities now populated).
- [ ] no-paper-names clean in `src/**` (compromise impl identifiers neutral).
- [ ] Plan archived to `plans/completed/` post-merge.
- [ ] Gateway/dashboard UNCHANGED (shape contract held) — verified by the T4.1 shape test.

## Cross-references

- Blueprint: `.claude/knowledge-base/discoveries/blueprints/entity-relation-extraction-no-graphdb-blueprint.md`
- Unfreeze: CLAUDE.md Amendment 2026-06-20
- Slice 2 (deferred): relations/edges + `{nodes,edges}` graph view (LLM extraction)
- Rules: `architecture.md` (DIP boundary), `testing.md` (pyramid), `no-paper-names-in-code.md`, `deps-audit-golden-rule.md` (compromise)
