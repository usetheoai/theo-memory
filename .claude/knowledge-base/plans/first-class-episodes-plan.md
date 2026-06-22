---
slug: first-class-episodes
milestone_id: M2
created_at: 2026-06-22
goal: Add a first-class episodic read surface (cursor-paginated, bi-temporal-aware) over the existing memory substrate so a consumer can list a session's events in temporal order, measured by the GOAL integration test.
---

# Plan: First-class episodic / message-log tier (M2 / gap G3)

> **Version 1.1** — edge-case MUST-FIX absorbed 2026-06-22 (`first-class-episodes-edge-cases-impl-2026-06-22.md`): EC-1 (asOf branch and default soft-delete-exclusion MUST be mutually exclusive in the WHERE builder — bi-temporal replay correctness) → T2.1; EC-2 (LIKE-metacharacter escape on `queryText` — `%`/`_`/`\`) → T2.1+T3.1. SHOULD-TEST folded into TDD: EC-3 (same-`created_at` cursor edge no-gap/no-overlap + precision round-trip) → T2.1/T4.1; EC-4 (`after`+`before` together → 422) → T3.1; EC-5 (in-memory record carries `created_at`+`id`, ordering parity) → T2.1. DOCUMENT: EC-6 (non-existent cursor value does NOT error — deliberate divergence from Letta `NoResultFound`), EC-7 (`prevCursor` forward-only/reserved in v1), EC-8 (episode boundary generalizes to user/agent tiers; Session canonical).

> **Version 1.0** — Closes gap G3: TheMemory has the substrate (history + `memories.session_id` + bi-temporal `t_valid`/`t_invalid` + `memories_session_id_idx`) but no first-class episode READ surface. This plan adds a cursor-paginated, bi-temporal-aware temporal list over the EXISTING `memories` table — `ScopedMemory.episodes(scope, opts?)` + `VectorStore.listEpisodes` (pgvector + in-memory) + REST `GET /v1/scopes/:type/:id/episodes`. The episode boundary is `session_id` (Session tier). Grounded in blueprint `first-class-episodes-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89): episode = TEMPORAL list (+ optional text filter), NOT semantic — semantic stays in the existing `recall()` (no 2nd vector store, EC-3). NO new storage engine, NO new dependency, NO new table (cursor `(created_at, id)`).

## Goal

> "Enable a consumer to list a scope's memories as a cursor-paginated, soft-delete-excluding, `asOf`-aware temporal episode log, measured by `tests/integration/episodes.test.ts` passing all 5 cases (temporal order + cursor edges + scope/workspace isolation + asOf replay + soft-deleted excluded) against real `ankane/pgvector:v0.5.1`."

## Context

M2 of the memory-gaps roadmap (`.claude/knowledge-base/roadmaps/memory-gaps-roadmap.md`). The `/loop-cross-validation` vs Letta (3.58/5) flagged that Letta exposes the conversation/event history as a first-class paginated tier (`message_manager.list_messages`), while TheMemory only has the substrate. The discovery blueprint mapped Letta's list/scope/search shape onto our existing substrate: cursor pagination by `(created_at, id)`, `session_id` boundary, temporal-list-not-semantic (Letta's message `query_text` is a partial text filter; semantic lives in the separate `passage_manager` — `message_manager.py:921` vs `passage_manager.py:35`). Per the roadmap: LOW-MEDIUM risk, a read surface over existing data; also closes the deferred EC-9 (`asOf`) opportunity for memory scopes.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/options.ts` | 235 | `ab62443` (2026-06-10) | RememberOptions/RecallOptions/GetAllOptions (+ `asOf` on RecallOptions :103) | additive: add `EpisodeListOptions`; existing options unchanged |
| `packages/core/src/domain/memory-store.ts` | 235 | `1068f77` (2026-06-20) | `ScopedMemory` iface (remember/recall/forget/getAll :56-61) | additive: add `episodes()`; the 4 existing verbs unchanged |
| `packages/core/src/domain/dip/vector-store.ts` | 173 | `1068f77` (2026-06-20) | `VectorStore` DIP (`list(filters,topK,includeSoftDeleted)` :155) | additive: add `listEpisodes(filters, opts)`; existing methods unchanged (ADR-0008 method-count note) |
| `packages/core/src/infrastructure/db/pgvector-store.ts` | 977 | `1068f77` (2026-06-20) | pgvector adapter (raw SQL; `list` impl) | additive: `listEpisodes` raw SQL (cursor + t_invalid + asOf); existing SQL unchanged. NOTE: file already > 500 LoC budget — the addition is a single self-contained method (~40 LoC); a split is a separate refactor (out of scope, ADR D7) |
| `packages/core/src/infrastructure/db/in-memory-store.ts` | 479 | `1068f77` (2026-06-20) | in-memory adapter (`list`, `matchesFilters`) | additive: `listEpisodes` (filter + sort + cursor slice + asOf); existing unchanged |
| `packages/core/src/infrastructure/db/scoped-memory.ts` | 427 | `d19117c` (2026-06-21) | `LocalScopedMemory` (recall/forget/getAll façade; composeFilters isolation) | additive: `episodes()` façade; existing methods unchanged |
| `packages/core/src/index.ts` | 180+ | `a80a4e6` | core barrel | additive: export `EpisodeListOptions` + `Episode` types |
| `packages/core/src/domain/index.ts` | 190+ | `a80a4e6` | domain barrel | additive: re-export episode types |
| `packages/api/src/server/handlers/episodes.ts` (NEW) | 0 | — | (to be created) `GET .../episodes` handler | — |
| `packages/api/src/server/app.ts` | 381 | `237d056` (2026-06-21) | createServer; route table | additive: register the episodes route; existing routes unchanged |
| `packages/api/src/server/openapi-registration.ts` | 449+ | (M1) | OpenAPI registry | additive: register the episodes path |
| `tests/integration/episodes.test.ts` (NEW) | 0 | — | (to be created) GOAL test (real pgvector) | — |

### Current callers / dependents

- **Symbol:** `ScopedMemory` (`memory-store.ts:77`) — impl `LocalScopedMemory` (`scoped-memory.ts`); consumed by REST handlers + `Memory.user()/.session()/.agent()`. Adding `episodes()` is additive (first-party impl); REST is the new consumer.
- **Symbol:** `VectorStore.list` (`vector-store.ts:155`) — impls `PgvectorStore` + `InMemoryVectorStore`; callers `LocalScopedMemory.getAll` + skill `getAll`. Adding `listEpisodes` is additive; both impls must implement it (compile-enforced).
- **Symbol:** `RecallOptions.asOf` (`options.ts:103`) — the bi-temporal predicate precedent (ADR-0011) the episode list reuses.
- **External:** the theo-cloud gateway consumes the REST surface (entities/metrics pattern); the episodes endpoint is a new additive read it can adopt.

### Domain glossary
- **Episode** — a scope's memories presented as a temporal, cursor-paginated event log (NOT a new entity; a read projection of `memories`).
- **Episode boundary** — `session_id` (Session tier); the retrievable unit, mirroring Letta's `agent_id` grouping.
- **Cursor** — `(created_at, id)` composite for tie-stable ordering (we have no monotonic sequence_id; `id` breaks created_at ties).
- **asOf** — bi-temporal replay instant; null-safe predicate `(t_valid IS NULL OR t_valid <= asOf) AND (t_invalid IS NULL OR t_invalid > asOf)` (ADR-0011).
- **composeFilters** — the scope→Filters isolation helper (`scope.ts`/`scoped-memory.ts`) reused by recall/forget; episodes reuse it (same isolation).

### Architecture boundaries affected
Per `architecture.md § 3` (DIP `src/core/ ← contracts, no I/O`): `EpisodeListOptions` + the `episodes()` contract live in domain; the `listEpisodes` query is a VectorStore DIP method implemented in infrastructure (pgvector + in-memory). High-level `LocalScopedMemory.episodes()` depends on the port. No new boundary; mirrors the existing `getAll`→`list` shape.

## Prior Art & Related Work
- **Internal blueprint:** `.claude/knowledge-base/discoveries/blueprints/first-class-episodes-blueprint.md` (Techniques 1-4 + GOAL test shape + ADR D3 recommendation).
- **Reference (Letta):** `.claude/knowledge-base/references/letta/letta/services/message_manager.py:895` (`list_messages` cursor/order/scope), `:921` (text-not-embedding), `tests/managers/test_message_manager.py:329-549` (test shape).
- **Internal precedent:** ADR-0011 bi-temporal `asOf` predicate (already in `recall`); `getAll`→`VectorStore.list` (the read-projection pattern episodes mirror); `entities.ts`/`metrics.ts` REST scope-read handler shape.

## Objective
- [ ] Export `EpisodeListOptions` + `Episode`/`EpisodePage` types from `@usetheo/memory`, verified by `npm run typecheck` resolving the import (exit 0).
- [ ] Add `ScopedMemory.episodes(scope, opts?)` to the interface, verified by `git diff` showing the 4 existing verbs byte-unchanged and `npm run typecheck` exit 0.
- [ ] Implement `VectorStore.listEpisodes` in both pgvector + in-memory impls, verified by `npm test -- list-episodes` exit 0 (cursor + t_invalid + asOf + scope isolation cases).
- [ ] Implement `LocalScopedMemory.episodes()` reusing `composeFilters`, verified by `npm test -- scoped-memory-episodes` exit 0 (isolation + asOf-NaN guard).
- [ ] Serve `GET /v1/scopes/:type/:id/episodes`, verified by the api suite asserting 200 page+nextCursor, asOf-NaN 422, empty-scope 200 [] (exit 0).
- [ ] Pass the GOAL integration test 5/5 vs real `ankane/pgvector:v0.5.1`, verified by `npm run test:integration -- episodes` exit 0.

## ADRs

### D1 — Episode tier is a READ projection over existing `memories`, NO new table
- **Decision:** episodes are a temporal/bi-temporal read projection of the existing `memories` table; no `episodes`/`messages` table, no migration.
- **Rationale:** roadmap "no new storage engine"; the substrate (session_id + created_at + bi-temporal + idx) already holds everything; blueprint D3.
- **Alternatives:** (a) dedicated episodes table — REJECTED: duplicates data, needs a write path + migration; (b) sequence_id column now — DEFERRED to D2.
- **Consequences:** zero migration risk; the read is bounded by the existing `memories_session_id_idx`.

### D2 — Cursor pagination by `(created_at, id)` composite, NOT offset, NOT sequence_id
- **Decision:** `after`/`before` cursors encode `(created_at, id)`; ORDER BY `created_at {order}, id {order}`; `limit` default 50 (cap 200).
- **Rationale:** offset pagination is unstable under concurrent inserts (Letta uses a monotonic cursor); `(created_at, id)` is tie-stable without a new column.
- **Alternatives:** (a) offset/limit — REJECTED (unstable, O(n) skip); (b) add `sequence_id` column now — DEFERRED (a `(created_at,id)` cursor is sufficient for v1; sequence_id is a documented follow-up if monotonic ordering is later required).
- **Consequences:** cursor is an opaque base64 of `(created_at,id)`; same-instant rows order by id deterministically.

### D3 — `listEpisodes` on the VectorStore DIP (NOT a new EpisodeStore DIP)
- **Decision:** add `listEpisodes` to the existing `VectorStore` port (which owns `memories`), mirroring `list`.
- **Rationale:** ISP — the read belongs to the store that owns the data; a new DIP for a read of the same table is over-engineering (YAGNI); mirrors `getAll`→`list`.
- **Alternatives:** new `EpisodeStore` DIP — REJECTED (no new data owner; would duplicate the pool/connection wiring).
- **Consequences:** `VectorStore` grows one method (ADR-0008 method-count: documented, additive, read-only).

### D4 — Episode list is TEMPORAL (+ optional text filter), NOT semantic (EC-3)
- **Decision:** `episodes()` is a temporal list with an optional `queryText` partial-match (ilike); semantic search stays in the existing `recall()`.
- **Rationale:** blueprint EC-3 — Letta's message log is text-filter; semantic is the separate passage tier. TheMemory already has semantic `recall()`. A 2nd vector path would violate "no new storage engine".
- **Alternatives:** embedding search on episodes — REJECTED (duplicates recall; scope creep).
- **Consequences:** episode recall = `recall()` constrained by session + `asOf`; episode LIST = temporal.

### D5 — EC-9 skill-scope `asOf` — DEFER (keep M2 tight)
- **Decision:** M2 ships `asOf` on the episode/memory read surface only; the skill-scope `asOf` (`ScopedSkillMemory.recall({asOf})`, EC-9) is a SEPARATE code path — DEFERRED to a follow-up.
- **Rationale:** YAGNI + tight scope; skill-scope asOf needs ADR-0010 coordination; M2's value is the memory-scope episode surface.
- **Alternatives:** include EC-9 now — REJECTED (scope creep; different surface).
- **Consequences:** EC-9 remains a documented follow-up; M2 does not regress it.

### D7 — `pgvector-store.ts` file-size: add the method, defer the split
- **Decision:** `listEpisodes` is added to the existing `pgvector-store.ts` (977 LoC) as a single self-contained ~50-LoC method; splitting the file into smaller modules is NOT done in M2.
- **Rationale:** the file already exceeds the 500-LoC budget (`architecture.md`); a split is a behavior-preserving refactor with its own blast radius (every `list`/search caller). Bundling it into M2 violates SRP-of-the-change (one plan, one concern) and risks the additive read surface. KISS: ship the read; refactor separately.
- **Alternatives:** (a) split `pgvector-store.ts` in this plan — REJECTED (scope creep; unrelated refactor risk); (b) put `listEpisodes` in a NEW sibling file — REJECTED (the raw-SQL store is the single owner of `memories` queries; a sibling would fragment the query layer and duplicate the pool wiring).
- **Consequences:** the file grows ~50 LoC over budget; recorded as a documented follow-up (`pgvector-store-split`) — NOT silent debt.

### D6 — REST: 404/empty cross-scope (no existence leak), asOf NaN → 422
- **Decision:** the episodes handler returns the scope's page (empty list for an empty/foreign scope — a list endpoint does not 404 on empty); invalid `asOf` (NaN Date) → `InvalidScope` → 422; invalid cursor → 422.
- **Rationale:** mirrors the entities/metrics list handlers (a scope LIST returns `[]`, not 404 — there's no single resource to "not find"); workspace isolation via composeFilters means a foreign scope simply yields no rows (no existence leak).
- **Alternatives:** 404 on empty — REJECTED (a list endpoint's empty result is `200 []`, consistent with `GET .../memories`).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| pgvector-store.ts already > 500 LoC; adding a method grows it further | Low | Self-contained ~40 LoC method; a file split is a separate refactor (D7 note); no new responsibility added | impl |
| Cursor encoding bugs (created_at tie + id) could drop/duplicate rows at page edges | Medium | GOAL test asserts cursor edges explicitly (no gap/overlap across pages); `(created_at,id)` strict ordering | impl |
| asOf predicate divergence from recall's | Medium | Reuse the EXACT ADR-0011 predicate string; test asOf replay against rows with set t_invalid | impl |
| In-memory adapter behavioral drift from pgvector (ordering/cursor) | Medium | Same EpisodeListOptions contract; the in-memory impl sorts identically; GOAL test runs pgvector, a unit test runs in-memory with the same assertions | impl |

## Unresolved Questions
- Q1 — cursor opaque encoding: base64 of `created_at|id` vs a structured `{after_created_at, after_id}` pair? (Lean: opaque base64 cursor returned as `nextCursor`; resolve at edge-case-plan.)
- Q2 — default `order`: `asc` (oldest-first, chronological replay) or `desc` (newest-first, feed)? (Lean: `desc` newest-first default like a feed, `?order=asc` for replay; confirm at edge-case-plan.)

## Dependencies

| Dependency | Version | New/Existing | Rule 9 | CVE |
|---|---|---|---|---|
| (none — no new dependency) | — | — | The episode read reuses `pg` + drizzle + Hono + zod already shipped. Blueprint Q5 confirmed Letta's message list needs no new dep. | n/a |

> `## Dependencies` declares NO new dep (roadmap constraint). `/deps-audit` confirms.

## Dependency Graph
```
Phase 1 (domain types + iface) ──▶ Phase 2 (VectorStore.listEpisodes + façade) ──▶ Phase 3 (REST) ──▶ Phase 4 (GOAL integration)
  T1.1 EpisodeListOptions+Episode    T2.1 DIP method + 2 impls                       T3.1 handler+route+openapi   T4.1 GOAL test
  T1.2 ScopedMemory.episodes iface   T2.2 LocalScopedMemory.episodes façade
```
Phase 1 blocks Phase 2 (impl needs the types); Phase 2 blocks Phase 3 (REST calls the façade); Phase 4 last.

---

## Phase 1: Domain — episode types + interface

### T1.1 — `EpisodeListOptions` + `Episode` projection type
#### Objective
Declare the cursor/asOf/order/limit/text option shape + the episode item projection.
#### Why this step (action + reasoning)
1. **What:** add `EpisodeListOptions` to `options.ts` + an `Episode`/`EpisodePage` type (reuse `MemoryItem` as the item; page = `{ items, nextCursor?, prevCursor? }`).
2. **Why now:** Phase 2 impl + Phase 3 REST code against this contract (DIP). Mirrors `RecallOptions`/`GetAllOptions`.
#### Evidence
`options.ts:73-103` (RecallOptions + asOf precedent); blueprint Technique 1 (cursor/order/limit).
#### Files to edit
```
packages/core/src/domain/options.ts — add EpisodeListOptions {after?,before?,limit?,order?,asOf?,queryText?}
packages/core/src/domain/memory-item.ts OR options.ts — EpisodePage { items: readonly MemoryItem[]; nextCursor?: string; prevCursor?: string }
packages/core/src/domain/options.test-d.ts (NEW or append) — RED type-shape
packages/core/src/domain/index.ts + index.ts — export
```
#### Deep file dependency analysis
- `options.ts` additive; consumed by memory-store iface (T1.2) + impls (T2.x) + REST (T3.1).
#### Deep Dives
- `EpisodeListOptions = { after?: string; before?: string; limit?: number; order?: 'asc'|'desc'; asOf?: Date; queryText?: string }`. `limit` default 50, cap 200. `order` default `desc` (Q2).
- `EpisodePage = { items: readonly MemoryItem[]; nextCursor?: string; prevCursor?: string }`.
- Invariant: I/O-free domain types (DIP).
#### Pseudo-code / Signatures
```pseudocode
interface EpisodeListOptions { after?; before?; limit?; order?: 'asc'|'desc'; asOf?: Date; queryText? }
interface EpisodePage { items: readonly MemoryItem[]; nextCursor?: string; prevCursor?: string }
```
#### Tasks
1. RED: test-d asserts the two type shapes. 2. GREEN: add types + export. 3. REFACTOR: none.
#### TDD
```
RED:     test_episode_list_options_shape() -> expectTypeOf<EpisodeListOptions>().toMatchTypeOf<{after?:string;...}>() (fails: type absent)
RED:     test_episode_page_shape()
GREEN:   add EpisodeListOptions + EpisodePage + export
REFACTOR: None expected
VERIFY:  npm run typecheck
```
#### Concurrency tests
(none — single-threaded)
Pure type declaration.
#### Acceptance Criteria
- [ ] `npm run typecheck` exits 0 with both types exported from `@usetheo/memory`
- [ ] `npm run lint` exits 0 with zero warnings on changed files
- [ ] every changed file ≤ 500 lines (`wc -l`)
#### DoD
- [ ] `npm run typecheck` exit 0 with barrels exporting the types; `npm run lint` exit 0.

### T1.2 — `ScopedMemory.episodes()` interface method
#### Objective
Add the episode read verb to the scoped contract.
#### Why this step (action + reasoning)
1. **What:** append `episodes(scope, opts?): Promise<EpisodePage>` to `ScopedMemory` (`memory-store.ts:77`).
2. **Why now:** the façade (T2.2) + REST (T3.1) need the contract; additive — the 4 verbs (remember/recall/forget/getAll) are unchanged.
#### Evidence
`memory-store.ts:56-61` (existing verbs); blueprint D3.
#### Files to edit
```
packages/core/src/domain/memory-store.ts — add episodes() to ScopedMemory
packages/core/src/domain/memory-store.test-d.ts (append) — RED: episodes in keyset
```
#### Deep file dependency analysis
- `ScopedMemory` impl is `LocalScopedMemory` (T2.2 implements it — compile-enforced).
#### Deep Dives
- `episodes(scope: Scope, opts?: EpisodeListOptions): Promise<EpisodePage>`. Invariant: additive; the 4 existing verbs' signatures byte-identical.
#### Tasks
1. RED: test-d asserts `episodes` in ScopedMemory keys + signature. 2. GREEN: add method to interface. 3. REFACTOR: none.
#### TDD
```
RED:     test_scoped_memory_has_episodes() -> expectTypeOf<ScopedMemory['episodes']>().parameters... (fails: method absent)
GREEN:   add episodes() to the interface
REFACTOR: None expected
VERIFY:  npm run typecheck
```
#### Concurrency tests
(none — single-threaded)
Interface declaration only.
#### Acceptance Criteria
- [ ] `npm run typecheck` exits 0; the 4 existing verbs unchanged (git diff shows only an addition)
- [ ] `npm run lint` exits 0 with zero warnings
- [ ] file ≤ 500 lines
#### DoD
- [ ] `npm run typecheck` exit 0; `git diff` shows the 4 existing verbs unchanged.

---

## Phase 2: Infrastructure — listEpisodes + façade

### T2.1 — `VectorStore.listEpisodes` DIP method + pgvector + in-memory impls
#### Objective
The cursor/asOf/scope-isolated temporal query over `memories`.
#### Why this step (action + reasoning)
1. **What:** add `listEpisodes(filters, opts): Promise<EpisodePage>` to the `VectorStore` DIP + implement in pgvector (raw SQL) + in-memory.
2. **Why now:** the façade (T2.2) delegates here; mirrors `list`. Per D3 the read belongs to the store that owns `memories`.
#### Evidence
`vector-store.ts:155` (list signature to mirror); `pgvector-store.ts` list impl + ADR-0011 asOf predicate; `in-memory-store.ts` matchesFilters.
#### Files to edit
```
packages/core/src/domain/dip/vector-store.ts — add listEpisodes(filters, opts) to the port
packages/core/src/infrastructure/db/pgvector-store.ts — raw-SQL impl (ORDER BY created_at,id; cursor; t_invalid; asOf; queryText ilike)
packages/core/src/infrastructure/db/in-memory-store.ts — filter+sort+cursor-slice impl
packages/core/src/infrastructure/db/__tests__/list-episodes.test.ts (NEW) — RED unit (in-memory): order, cursor edges, asOf, t_invalid excl, queryText
```
#### Deep file dependency analysis
- `vector-store.ts` additive method; both impls must implement (compile-enforced). pgvector raw SQL parameterized (no injection); in-memory mirrors semantics.
#### Deep Dives
- Cursor decode: base64 `created_at|id` → WHERE `(created_at, id) < (cur_created_at, cur_id)` for `before`/desc (and `>` for after/asc), order-aware. **EC-3:** the cursor predicate is a row-value comparison using the SAME comparator as `ORDER BY created_at <ord>, id <ord>` (UUID `id` compared lexicographically). `encodeCursor` serializes `created_at` at FULL pg precision (ISO ms) so a JS `Date` round-trip does not truncate and skip a same-ms sibling row. **EC-6:** the cursor is a VALUE comparison, NOT an id lookup — a cursor whose value matches no row yields the page from that point (possibly empty); it does NOT throw (deliberate divergence from Letta `NoResultFound`).
- asOf (**EC-1 — bi-temporal correctness, MUTUALLY EXCLUSIVE branches**): `if (asOf) → WHERE (t_valid IS NULL OR t_valid <= $asOf) AND (t_invalid IS NULL OR t_invalid > $asOf)` (exact ADR-0011 predicate) ELSE `→ WHERE t_invalid IS NULL`. NEVER AND the default `t_invalid IS NULL` clause onto the asOf branch — a row soft-deleted AFTER asOf MUST still appear at asOf. The two clauses are an if/else, not a conjunction.
- queryText (**EC-2 — LIKE-pattern escape**): optional `text ILIKE $q ESCAPE '\'` where `$q = '%' || escapeLike(raw) || '%'` and `escapeLike(s) = s.replace(/[\\%_]/g, c => '\\'+c)` (partial text, NOT embedding — D4). The in-memory impl mirrors the escape semantics (literal substring match after un-escaping wildcards).
- scope isolation: `filters` (workspace_id + session_id/user_id/agent_id) ANDed — same composeFilters output recall/forget use.
- limit: `LIMIT min(opts.limit ?? 50, 200) + 1` over-fetch to compute nextCursor (truncation disclosure).
- **EC-5 (in-memory parity):** the in-memory `listEpisodes` sorts by `(created_at, id)` identically to pgvector; if the in-memory record does not already persist `created_at`, the impl adds it so the unit contract matches the GOAL (pgvector) behavior.
#### Pseudo-code / Signatures
```pseudocode
listEpisodes(filters, opts): Promise<EpisodePage>
  cap = min(opts.limit ?? 50, 200)
  rows = SELECT ... FROM memories
         WHERE <filters AND-composed> AND <asOf-predicate or t_invalid IS NULL>
               [AND text ILIKE %q%] [AND cursor-predicate]
         ORDER BY created_at <order>, id <order>
         LIMIT cap+1
  hasMore = rows.length > cap; page = rows.slice(0,cap)
  nextCursor = hasMore ? encode(last(page).created_at, last(page).id) : undefined
  return { items: page.map(toItem), nextCursor }
```
#### Tasks
1. RED: in-memory unit test (order/cursor/asOf/t_invalid/queryText). 2. GREEN: DIP method + both impls. 3. REFACTOR: extract cursor encode/decode helper (shared, pure).
#### TDD
```
RED:     test_list_episodes_temporal_order(); test_list_episodes_cursor_edges_no_gap_no_overlap(); test_list_episodes_cursor_same_created_at_no_gap_no_overlap() [EC-3]; test_list_episodes_asof_replay_includes_row_soft_deleted_after_asof() [EC-1]; test_list_episodes_excludes_soft_deleted(); test_list_episodes_querytext_escapes_like_metachars() [EC-2]; test_in_memory_list_episodes_orders_by_created_at_then_id() [EC-5] (fail: method absent)
GREEN:   add listEpisodes to DIP + pgvector + in-memory (asOf/soft-delete as if/else per EC-1; ILIKE ESCAPE per EC-2)
REFACTOR: extract encodeCursor/decodeCursor + escapeLike pure helpers
VERIFY:  npm test -- list-episodes
```
#### Concurrency tests
(none — single-threaded)
Read-only query; no shared mutable state. Cursor stability under concurrent inserts is a correctness property of the `(created_at,id)` ordering, asserted by the cursor-edge test (not a race test — reads are independent).
#### Acceptance Criteria
- [ ] `npm test -- list-episodes` exits 0 (in-memory: order, cursor edges no-gap/no-overlap, asOf, soft-delete exclusion, queryText)
- [ ] both `VectorStore` impls compile against the new method (`npm run typecheck` 0)
- [ ] `npm run lint` exits 0; pgvector SQL is parameterized (no string-interpolated user input)
- [ ] the new method is ≤ ~60 LoC in each impl; cursor helper ≤ 40 LoC
#### DoD
- [ ] `npm test -- list-episodes` exit 0; `npm run typecheck` exit 0; SQL parameterized (`$1` placeholders, no string interpolation).

### T2.2 — `LocalScopedMemory.episodes()` façade
#### Objective
Wire the scope→filters→listEpisodes path.
#### Why this step (action + reasoning)
1. **What:** implement `episodes()` in `LocalScopedMemory`: composeFilters(scope) → `vectorStore.listEpisodes(filters, opts)`; validate `asOf` (NaN→InvalidScope).
2. **Why now:** REST (T3.1) calls this; reuses the SAME composeFilters isolation as recall/forget (no new isolation logic).
#### Evidence
`scoped-memory.ts` recall/forget composeFilters usage; ADR-0011 asOf NaN validation (`options.ts:96`).
#### Files to edit
```
packages/core/src/infrastructure/db/scoped-memory.ts — add episodes() façade
packages/core/src/infrastructure/db/__tests__/scoped-memory-episodes.test.ts (NEW) — RED: composeFilters isolation + asOf NaN throws InvalidScope
```
#### Deep file dependency analysis
- Reuses composeFilters (same as recall/forget) → isolation parity. Delegates to vectorStore.listEpisodes.
#### Deep Dives
- `asOf` NaN guard: `if (opts?.asOf && Number.isNaN(opts.asOf.getTime())) throw new InvalidScope('asOf must be a valid Date')` (mirror recall).
- Invariant: same isolation as recall/forget (composeFilters with workspace_id + scope tier).
#### Tasks
1. RED: test (delegates with composed filters; asOf NaN throws). 2. GREEN: implement. 3. REFACTOR: none.
#### TDD
```
RED:     test_episodes_composes_scope_filters(); test_episodes_asof_nan_throws_invalid_scope() (fail: method absent)
GREEN:   implement episodes() façade
REFACTOR: None expected
VERIFY:  npm test -- scoped-memory-episodes
```
#### Concurrency tests
(none — single-threaded)
Façade delegates a read; no shared state.
#### Acceptance Criteria
- [ ] `npm test -- scoped-memory-episodes` exits 0 (composeFilters isolation + asOf NaN → InvalidScope)
- [ ] `npm run lint` exits 0; file ≤ 500 lines after the addition (currently 427 + ~25)
#### DoD
- [ ] unit green; typecheck green; isolation reuses composeFilters (no bespoke filter code).

---

## Phase 3: REST surface

### T3.1 — `GET /v1/scopes/:type/:id/episodes` handler + route + OpenAPI
#### Objective
HTTP cursor-list surface for episodes.
#### Why this step (action + reasoning)
1. **What:** `episodesHandler` (mirror `entities.ts`/`metrics.ts` scope-read pattern) + register route + OpenAPI; query params `after/before/limit/order/asOf/q`; map InvalidScope→422; empty/foreign scope→`200 {items:[]}` (D6).
2. **Why now:** the façade (T2.2) exists; the gateway/dashboard consume this. Mirrors the shipped scope-read handlers.
#### Evidence
`packages/api/src/server/handlers/entities.ts` (scope-read pattern); `app.ts` route table; M1 openapi-registration precedent.
#### Files to edit
```
packages/api/src/server/handlers/episodes.ts (NEW) — handler + zod query schema
packages/api/src/server/app.ts — register GET /v1/scopes/:type/:id/episodes
packages/api/src/server/openapi-registration.ts — register the path
packages/api/src/server/__tests__/episodes.test.ts (NEW) — RED: 200 page+nextCursor, cursor param, asOf NaN 422, empty scope 200 [], isolation
```
#### Deep file dependency analysis
- Handler resolves `workspaceBoundMemory(c, memory).<tier>(id).episodes(opts)`; maps InvalidScope→422. Mirrors entities/metrics.
#### Deep Dives
- Query zod: `after?/before?: string; limit?: coerce.number().int().positive().max(200); order?: enum(asc,desc); asOf?: string→Date (NaN→422); q?: string`. **EC-4:** a `.superRefine` rejects `after` AND `before` supplied together → 422 (ambiguous combination; cheaper than a precedence rule).
- Response: `{ items: [...], nextCursor? }`. **EC-7:** v1 computes `nextCursor` only (forward pagination — the GOAL shape); `prevCursor` is reserved/forward-only (a follow-up computes it if a consumer needs backward paging). Empty/foreign scope → `200 { items: [] }` (no existence leak; a list has no single resource to 404).
- **EC-8:** `:type` accepts `user`/`session`/`agent`; `episodes` is the temporal projection of whatever tier is addressed (Session is the canonical conversational episode per blueprint D3; user/agent return that tier's memories in temporal order — consistent with the existing `GET .../memories` tier generalization).
#### Tasks
1. RED: handler tests (200 page, cursor, asOf 422, empty 200 [], isolation). 2. GREEN: handler+route+openapi. 3. REFACTOR: none.
#### TDD
```
RED:     test_get_episodes_200_page_with_next_cursor(); test_get_episodes_cursor_param(); test_get_episodes_asof_nan_422(); test_get_episodes_empty_scope_200_empty(); test_get_episodes_invalid_limit_422(); test_get_episodes_after_and_before_conflict_422() [EC-4] (fail: route absent -> 404)
GREEN:   implement handler + route + openapi
REFACTOR: None expected
VERIFY:  (api config) vitest run packages/api/src/server/__tests__/episodes.test.ts
```
#### Concurrency tests
(none — single-threaded)
Stateless HTTP handler.
#### Failure scenarios note
The only external I/O is the pg query (via the façade); a DB error propagates to the centralized error mapper (500). asOf NaN / bad cursor / bad limit → 422 (validation). See `## Failure scenarios`.
#### Acceptance Criteria
- [ ] api episodes test asserts 200 page+nextCursor / cursor param / asOf NaN 422 / empty-scope 200 [] / invalid-limit 422 / cross-scope isolation
- [ ] OpenAPI registry includes `/v1/scopes/{type}/{id}/episodes` GET with 200/422 responses
- [ ] `npm run lint` exits 0; handler ≤ 500 lines
#### DoD
- [ ] api tests green (run via packages/api/vitest.config.ts — root `npm test` does NOT cover packages/api); typecheck green.

---

## Coverage Matrix
| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | EpisodeListOptions + Episode types | T1.1 | domain types |
| 2 | ScopedMemory.episodes() (additive) | T1.2 | interface method |
| 3 | listEpisodes cursor + asOf + t_invalid + scope isolation | T2.1 | DIP + 2 impls |
| 4 | episodes() façade reusing composeFilters | T2.2 | LocalScopedMemory |
| 5 | REST GET .../episodes (cursor, 422, empty 200, isolation) | T3.1 | episodesHandler |
| 6 | GOAL: temporal order + cursor edges + isolation + asOf + soft-delete excl | T4.1 | integration test vs real pgvector |
| 7 | no new dep / no new table / temporal-not-semantic | T2.1 + T4.1 | reuse existing `memories`/`pg` in T2.1; GOAL test T4.1 proves no new store; ADRs D1/D4 |
| 8 | EC-1 asOf vs soft-delete mutually-exclusive (bi-temporal correctness) | T2.1 + T4.1 | if/else WHERE branch + GOAL assertion |
| 9 | EC-2 LIKE-metachar escape on queryText | T2.1 + T3.1 | escapeLike + ILIKE ESCAPE |
| 10 | EC-3 same-created_at cursor edge + precision round-trip | T2.1 + T4.1 | row-value comparison + full-precision cursor |
| 11 | EC-4 after+before conflict → 422 | T3.1 | zod superRefine |
| 12 | EC-5 in-memory created_at+id parity | T2.1 | in-memory ordering test |
| 13 | EC-6/7/8 documented behaviors | T1.1 + T2.1 + T3.1 | recorded in Deep Dives (no existence-leak / forward-only cursor / tier generalization) |

**Coverage: 13/13 (100%)** — EC-9 skill-scope asOf is an explicit NON-GOAL (deferred per ADR D5), so it is not a coverage row.

## Global Definition of Done
- [ ] All phases completed (T1.1→T4.1 committed; verified by `git log --oneline`)
- [ ] `npm test` (core+mcp) + api suite (`packages/api/vitest.config.ts`) + `npm run test:integration` exit 0
- [ ] `npm run typecheck` exit 0 (0 errors); `npm run lint` exit 0 (0 warnings)
- [ ] File-size budget respected — new files `≤ 500` LoC (`wc -l`); pgvector addition self-contained per D7 note
- [ ] CHANGELOG `[Unreleased]` updated (Rule 6)
- [ ] Backward compatible — `git diff` shows ScopedMemory's 4 verbs + VectorStore's existing methods unchanged (additive only)
- [ ] No new dependency (`/deps-audit` PASS); no new table/migration
- [ ] No paper names in `src/**`
- [ ] `/code-quality` PASS (no dead exports — episodes() wired to REST + GOAL test; no fabricated symbols)
- [ ] Plan archived after `/review` READY_TO_MERGE + merge

## Failure scenarios
| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres:memories` (DB) | query error mid-list | (integration) malformed cursor reaching SQL | decode rejects bad cursor → 422 BEFORE SQL; a genuine DB error → 500 via central mapper (no partial page) |
| `asOf` input | NaN Date | api test sends `?asOf=not-a-date` | `InvalidScope` → 422 (no SQL executed) |
| cross-scope/workspace | foreign id | integration: list a foreign session/workspace | `200 { items: [] }` (composeFilters yields no rows; no existence leak) |

## Final Phase: Integration Validation (MANDATORY)

### T4.1 — GOAL integration test
**Objective:** prove the episode surface end-to-end vs real `ankane/pgvector:v0.5.1`.
#### TDD
```
RED:     test_goal_episodes_temporal_order(); test_goal_episodes_cursor_edges_no_gap_overlap() [+EC-3 same-created_at edge]; test_goal_episodes_scope_workspace_isolation(); test_goal_episodes_asof_replay_includes_row_soft_deleted_after_asof() [EC-1]; test_goal_episodes_soft_deleted_excluded() -> all vs real pgvector
GREEN:   author tests/integration/episodes.test.ts (createLocalMemory + PgvectorStore; remember N in a session; list/cursor/asOf/forget→excluded)
REFACTOR: None expected
VERIFY:  THEOMEM_PG_URI=... npm run test:integration -- episodes
```
#### Concurrency tests
(none — single-threaded)
Sequential remember→list assertions; gated by THEOMEM_PG_URI (skips clean when unset).
### Execution
```
npm test                       # core+mcp contract
(api) vitest run --config packages/api/vitest.config.ts
npm run typecheck && npm run lint
THEOMEM_PG_URI=... npm run test:integration -- episodes
```
### Acceptance Criteria
- [ ] All suites green — `npm test`, the api vitest suite, and `npm run test:integration` exit 0
- [ ] Coverage `≥ 90%` on changed files (cursor helper 100%)
- [ ] `npm run typecheck` exit 0 (zero type errors); `npm run lint` exit 0 (zero warnings)
- [ ] Failure scenarios green — `npm run test:integration` asserts asOf NaN→`422`, foreign scope→`200 []`, bad cursor→`422`
- [ ] GOAL test 5/5 — `npm run test:integration -- episodes` exit 0 vs real pgvector
### If Validation Fails
1. Separate plan-caused vs pre-existing failures. 2. Fix plan-caused. 3. Re-run. 4. Log pre-existing in PR.
