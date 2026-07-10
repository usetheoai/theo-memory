# Blueprint: Graph-aware recall temporal correctness (M0)

> **Verdict placeholder:** `<pending /discover-confidence>` — target ≥ SHIPPABLE_WITH_CAVEATS.
> **Slug:** `graph-aware-recall-temporal-correctness`
> **Milestone:** M0 (ROADMAP.md · CLAUDE.md Item 27) — CORRECTNESS BUG.
> **Created:** 2026-07-10 · **Owner:** usetheodev

## Summary — the bug, in one paragraph

`PgGraphExpansionStore.expandByEntities` (the graph-aware-recall Step 8.7 pool-expansion) JOINs `memories m` and scope-confines by workspace/user/session/agent, but its final `SELECT ... WHERE` **omits `m.t_invalid IS NULL`** — the currently-valid predicate every other recall path applies (`pgvector-store.ts:172`, `pgvector-store.ts:737`, `pgvector-store.ts:787`). A memory that was **soft-deleted** (`forget()` sets `t_invalid = NOW()`, `pgvector-store.ts:716`) or **superseded by distillation** (`persistConsolidations` sets `t_invalid = NOW()`, `pgvector-store.ts:1073`) is therefore **resurfaced through graph expansion** even though it is invisible to the primary `search`/`keywordSearch`/`list` paths. Second, the store **ignores `params.filters.asOf`** even though `asOf` already flows into `params.filters` today (the DIP already carries it — see Q3), so a point-in-time `recall({ asOf })` silently gets *current-epoch* graph hits mixed into a *historical* result set.

The fix is a **parsimony rung-4 reuse** (`parsimony-ladder.md`): thread the already-shipped bi-temporal predicate `composeTemporalWhere` (`pgvector-store.ts:167-179`) into the expansion SELECT, applied **DURING the JOIN** (not post-filter), consistent with the primary path. **Zero new dependency** (Q5). The DIP does **not** need a new field — `asOf` already reaches the store via `params.filters` (Q3), which is the cleanest possible shape.

## Research questions — answers

- **Q1 (peer precedent — filter row-validity in reads):** letta declares a first-class `is_deleted` boolean column on its ORM base mixin (`.claude/knowledge-base/references/letta/letta/orm/base.py:18`) and filters it **inside the read query** — `query = query.where(cls.is_deleted == False)` — at every read entry point (`.claude/knowledge-base/references/letta/letta/orm/sqlalchemy_base.py:394-395`, `:531-533`, `:827-828`). Soft-delete (`self.is_deleted = True`, `sqlalchemy_base.py:681`) is a WRITE; reads re-apply the validity filter in-query. Precedent confirmed: **row-validity is enforced during the read, not by physical deletion** — exactly the shape TheMemory already uses (`t_invalid IS NULL`) everywhere **except** graph expansion.
- **Q2 (our canonical predicate):** `composeTemporalWhere(asOf, startParamIndex)` at `pgvector-store.ts:167-179`. When `asOf` is undefined → `t_invalid IS NULL` (`:172`). When `asOf` is set → `(t_valid IS NULL OR t_valid <= $N) AND (t_invalid IS NULL OR t_invalid > $N+1)` (`:175`) with `params: [asOf, asOf]`. Applied **DURING the query** — inside the `WHERE` of the primary `search` (`pgvector-store.ts:514`, `:538`, `:548`), `keywordSearch` (`:605`, `:613`), and `listEpisodes` (`:834`, `:878`). ADR-0011. This is the exact function to reuse.
- **Q3 (asOf routing + where graph diverges):** `RecallOptions.asOf` → `Filters.asOf` at `scoped-memory.ts:66-68` (`applySkillFilters`). `Filters.asOf` is declared at `packages/core/src/domain/scope.ts:142`. `retrieveResults` calls `runRetrievalPipeline(query, applySkillFilters(this.filters, options), …)` (`scoped-memory.ts:358` and `:380`), so `filters.asOf` is present in the pipeline's `filters`. The primary path honors it (`vectorStore.search(queryVector, internalLimit, filters)` → `composeTemporalWhere(filters.asOf, 2)`, `pipeline.ts:335` → `pgvector-store.ts:514`). **The divergence:** Step 8.7 calls `store.expandByEntities({ seedMemoryIds, filters, hops, limit })` with the **same `filters`** (`pipeline.ts:273`), so `asOf` **already arrives** in `params.filters.asOf` — but `PgGraphExpansionStore` never reads it, and its SELECT `WHERE` (`pg-graph-expansion-store.ts:88-92`) has no temporal clause at all.
- **Q4 (test boundary + the missing RED test):** the expansion boundary is unit-tested against the in-memory mirror (`packages/core/src/infrastructure/db/in-memory-graph-expansion-store.test.ts` — seed exclusion EC-1 `:32`, cross-scope isolation EC-2 `:37-44`, limit `:46-55`). **No test asserts temporal correctness** (a superseded / soft-deleted memory must not be resurfaced; an `asOf` point-in-time expansion). See Coverage Corner 1 for the exact RED tests.
- **Q5 (dependency):** NONE. `pg` `^8.13.0` (`packages/core/package.json:102`) + `drizzle-orm` `^0.45.0` (`:100`) are already declared. The fix is pure SQL over the existing `pg.Pool` the store already holds (`pg-graph-expansion-store.ts:31`). Parsimony rung 4 satisfied.
- **Q6 (real-pgvector harness):** `docker-compose.yaml:18-19` — service `pgvector`, image `ankane/pgvector:v0.5.1`, port `${POSTGRES_PORT:-5432}` (`:27`). Integration command `npm run test:integration` → `vitest run --config vitest.integration.config.ts` (`package.json:27`). See Coverage Corner 3.

## Coverage Corner 1 — Integration Tests

**How the expansion boundary is tested today.** The traversal semantics are covered by unit tests against the in-memory mirror at `packages/core/src/infrastructure/db/in-memory-graph-expansion-store.test.ts`:

- `returns memories sharing an entity … excluding seeds` (`:23-35`) — shared-entity weight + EC-1 seed exclusion.
- `EC-2: a same-entity memory in a DIFFERENT scope is NEVER returned` (`:37-44`) — cross-scope isolation.
- `honors the limit (fan-out guard)` (`:46-55`).
- `seeds with no entities ⇒ empty` (`:57-61`).

**Gap:** none of these exercises a **temporally-invalid** row or an `asOf` window. The in-memory store's node fixture (`:16-18`) carries only `{ memoryId, entityIds, result, filters }` — no `t_invalid` / `t_valid` — so temporal correctness is untestable at the in-memory layer without extending the fixture. The **authoritative** temporal test therefore belongs at the **real-pgvector integration** layer (Corner 3), because `t_invalid`/`t_valid` live on the `memories` row and the bug is in the SQL `WHERE`.

**The RED regression tests to add** (both against real `ankane/pgvector:v0.5.1`, following the negative-case discipline of `testing.md § 4.1` — the passing behavior is "the superseded row is NOT in the result", a *wrong-answer* correctness failure):

1. **Superseded / soft-deleted memory is NOT resurfaced through graphExpand.**
   Arrange: insert memory A (seed) and memory B sharing an entity with A; soft-delete B via `deleteInScope(B, filters, hard=false)` (sets `t_invalid = NOW()`, `pgvector-store.ts:716`). Act: `expandByEntities({ seedMemoryIds: [A], filters, hops: 1, limit: 10 })`. Assert: the returned rows do **NOT** contain B. (Today, with the bug, B is returned — RED.) This is the primary M0 correctness assertion. A sibling variant supersedes B via `persistConsolidations` (`pgvector-store.ts:1073`) to prove the distillation path is covered by the same predicate.

2. **`asOf` point-in-time expansion returns the state valid at the instant.**
   Arrange: insert A + B (shared entity, both valid at t0); soft-delete B at t1 > t0. Act: `expandByEntities` with `filters.asOf = t0` vs `filters.asOf = t2` (t2 > t1). Assert: at `asOf = t0`, B **IS** returned (it was valid then); at `asOf = t2` (and with `asOf` omitted), B is **NOT** returned. Proves the null-safe predicate (`pgvector-store.ts:175`) is threaded and the branch selection (asOf-set vs omitted) mirrors the primary path exactly.

3. **Non-regression (edge case, `testing.md § 4.1`):** a currently-valid connected memory is STILL returned with `asOf` omitted (the default `t_invalid IS NULL` branch must not accidentally hide live rows). This is the boundary companion to the negative cases above.

Fixture home: extend the existing pgvector integration suite that already constructs a real pool + runs migrations (the `test:integration` config, Corner 3). A `pg-graph-expansion-store.integration.test.ts` beside the store, or an added block in the graph-aware-recall integration file, both satisfy the pairing convention in `testing.md § 5`.

## Coverage Corner 2 — Dependencies

**Zero new dependencies (parsimony rung 4, `parsimony-ladder.md`).** The fix reuses:

- `pg` `^8.13.0` — `packages/core/package.json:102` — the `Pool` the store already holds (`pg-graph-expansion-store.ts:31`); the fix adds two bound params to the existing `params2` array + one temporal clause to the existing SQL string.
- `drizzle-orm` `^0.45.0` — `packages/core/package.json:100` — untouched (the store uses raw SQL, not the query builder; no schema change, no migration — `t_valid`/`t_invalid` columns already exist on `memories` since v0.1 per ADR-0006).

No optional dep, no vendor SDK, no new file dependency. Rung 4 ("reuse before you add") is the whole shape of this fix: the predicate function `composeTemporalWhere` is imported from the sibling `pgvector-store.ts` (already imported for `rowToResult` + `MemoriesRow` at `pg-graph-expansion-store.ts:24`), so the store consumes it with a single added named import — no new module boundary.

## Coverage Corner 3 — Tools

The real-pgvector harness the integration test runs against:

- **Compose service:** `pgvector`, image **`ankane/pgvector:v0.5.1`** — `docker-compose.yaml:18-19`. Env `POSTGRES_USER/PASSWORD/DB` default to `themem` (`:23-25`); host port `${POSTGRES_PORT:-5432}` (`:27`); healthcheck `pg_isready` (`:31`).
- **Bring up:** `docker compose up -d pgvector` (the file's own header note, `docker-compose.yaml:8`).
- **Run the temporal RED test:** `npm run test:integration` → `vitest run --config vitest.integration.config.ts` (`package.json:27`). The integration config is the one that talks to the live container (contrast `package.json:26` `test` = `vitest.contract.config.ts`, the unit/contract suite that must NOT touch the DB).
- **Migrations:** applied by the integration harness against the live DB (the `memories` table already carries `t_valid`/`t_invalid` from the v0.1 schema per ADR-0006 — no new migration for this fix).

## Coverage Corner 4 — Techniques

### (a) The exact predicate to reuse

`composeTemporalWhere(asOf: Date | undefined, startParamIndex: number)` at **`pgvector-store.ts:167-179`**:

- `asOf === undefined` → `{ sql: 't_invalid IS NULL', params: [], nextParamIndex: startParamIndex }` (`:172`).
- `asOf` set → `{ sql: '(t_valid IS NULL OR t_valid <= $N) AND (t_invalid IS NULL OR t_invalid > $N+1)', params: [asOf, asOf], nextParamIndex: startParamIndex + 2 }` (`:174-178`).

It is already imported-adjacent (the store imports `rowToResult`, `MemoriesRow` from the same module at `pg-graph-expansion-store.ts:24`); reuse it by adding it to that named import. **Do not re-implement the predicate** (`no-paper-names`/DRY + `parsimony-ladder.md` rung 4) — a second copy would be a DRY violation and a place for the two predicates to drift.

### (b) WHERE to add it in `pg-graph-expansion-store.ts` — the final SELECT + the CTE question

The bug and the fix are in the **final candidate SELECT `WHERE`** at `pg-graph-expansion-store.ts:88-92`. Add the temporal clause here, aliased to `m` (the `memories` alias of the candidate row):

```
       WHERE me.memory_id <> ALL($1::uuid[])
         AND m.workspace_id = $2
         AND COALESCE(m.user_id,'')    = COALESCE($3::text,'')
         AND COALESCE(m.session_id,'') = COALESCE($4::text,'')
         AND COALESCE(m.agent_id,'')   = COALESCE($5::text,'')
         AND <temporal.sql over m>          -- NEW (m.t_valid / m.t_invalid)
```

Because `composeTemporalWhere` emits bare column names (`t_invalid IS NULL`, `t_valid <= $N`), the returned SQL must be **prefixed to the `m` alias** here (the primary `search` path has no alias so it uses the bare form; this JOIN has the `m` alias, so the clause needs `m.t_invalid` / `m.t_valid`). Two equally-safe options: (i) string-replace the bare `t_valid`/`t_invalid` in `temporal.sql` with `m.t_valid`/`m.t_invalid` before splicing, or (ii) build the clause locally from the same two-branch shape but m-qualified. Option (i) keeps the single source of truth (`composeTemporalWhere`) authoritative; document the aliasing at the splice site.

**Do the seed CTE and the hop-2 edge CTE also need the temporal filter?** — the load-bearing analysis:

- **Seed CTE (`seed_entities`, `:77-78`):** it selects `entity_id` from `memory_entities WHERE memory_id = ANY($1)`. The seed ids are the **threshold-passing rows already returned by the primary `search`** (`pipeline.ts:271` slices from `scoredSorted`, which came from `vectorStore.search` that already applied the temporal filter). So the seed ids are, by construction, currently-valid (or asOf-valid) memories. **The seed CTE does not strictly need the temporal filter** for correctness of *which seeds* — but see the honest caveat below. **Recommendation for M0: scope the seed CTE too**, defensively, because (1) it is cheap (one extra clause), (2) it makes the store self-correct rather than trusting the caller to pass only valid seeds, and (3) it closes the theoretical hole where a future caller passes a stale seed id directly. This is a JOIN of `memory_entities` to `memories` — see the caveat: `memory_entities` has no `t_invalid`; the seed-scoping would require joining `memories` in the seed CTE. Given `memory_entities` rows are `ON DELETE CASCADE` on hard-delete but NOT on soft-delete, a soft-deleted seed still has its `memory_entities` rows. **Decision (ADR D1):** for M0, apply the temporal filter ONLY at the final candidate SELECT (the observable bug — a resurfaced *candidate*); scope-hardening the seed CTE against a caller passing an already-invalid seed id is a defensive follow-up (the seed always comes from the temporally-filtered primary search today, so it cannot be invalid in the current call graph). This keeps M0 minimal (KISS) and matches the observable failure.
- **Hop-2 edge CTE (`expanded_entities`, `:57-73`):** it traverses `entity_edges` to widen the entity set. It walks **edges**, not memories — `entity_edges` has no `t_invalid`/`t_valid` (edge-own bi-temporality is milestone **M1**, explicitly out of scope per the discovery plan In-Scope table and the entity-relation-extraction design). So the hop-2 CTE **does not need** (and cannot yet apply) a memory-temporal filter — it operates on the entity/edge layer, one level below memories. **The final candidate SELECT already re-JOINs `memories m` and is where every hop-2-reached memory is materialized**, so filtering there catches soft-deleted memories regardless of whether they were reached via hop-1 or hop-2. **Conclusion: only the final candidate SELECT needs the temporal predicate for M0.** (An edge whose *source memory* is invalidated is an M1 concern — edge validity derived from source memory — noted in the discovery plan Out-of-Scope.)

### (c) Threading `asOf` as a bound param through the parametrized query + the DIP

**The DIP does NOT need a new field.** `asOf` already reaches the store: `ExpandByEntitiesParams.filters` (`graph-expansion-store.ts:41-50`) is the recall `Filters`, and `Filters.asOf` (`scope.ts:142`) is populated from `RecallOptions.asOf` at `scoped-memory.ts:66` and flows into `pipeline.ts:273`'s `expandByEntities({ …, filters, … })`. So the store reads `params.filters.asOf` — the **cleanest** shape (no interface widening, no caller change, pre-release-safe by construction because nothing new is exposed).

Param threading in `pg-graph-expansion-store.ts`: today `params2` (`:39-46`) is `[seedIds($1), ws($2), user($3), session($4), agent($5), limit($6)]`. The temporal params must be appended **before** `limit` shifts, OR `limit` re-numbered. Cleanest: compute `const temporal = composeTemporalWhere(filters.asOf, 6)` (start index 6, the next free slot after the 5 existing scope params), append `...temporal.params` to `params2`, and set `LIMIT $${temporal.nextParamIndex}` (which becomes `$6` when no asOf, `$8` when asOf is set — the function returns the right `nextParamIndex`). This mirrors exactly how `search` composes `[vectorLiteral, ...temporal.params, ...filter.params, topK]` with `composeTemporalWhere(filters?.asOf, 2)` (`pgvector-store.ts:514`, `:552-557`). No user string is ever interpolated — every value stays in the parametrized array (preserves the F-sec-1 injection-safety invariant documented at `pg-graph-expansion-store.ts:48-53`).

### (d) Apply-DURING-JOIN vs post-filter — DECISION: during-JOIN

**Apply the predicate in the SQL `WHERE` (during the JOIN), NOT as a post-query `.filter()` in TS.** Justification:

1. **Consistency with the primary path.** Every other recall path (`search`, `keywordSearch`, `list`, `listEpisodes`) applies the temporal predicate in-SQL. Post-filtering only the graph path would create two different correctness mechanisms for the same invariant — a DRY/maintenance hazard and exactly the drift that let this bug exist.
2. **Correctness under `LIMIT`.** The SELECT has `ORDER BY shared_entities DESC, m.id LIMIT $N` (`:98-99`). A post-filter would fetch `LIMIT` rows *including* invalid ones, then drop them in TS — silently returning fewer than `limit` valid rows (a truncation bug). Filtering in-SQL means the `LIMIT` counts only valid rows.
3. **Peer + external precedent.** letta filters `is_deleted` **in the query** (`sqlalchemy_base.py:395`), never post-fetch. Graphiti/Zep (external, technique below) applies validity during retrieval/traversal, not as a post-pass.

### (e) Peer precedent (letta) + external technique (Graphiti/Zep)

- **letta (cloned peer, real citations):** row-validity is a first-class column (`is_deleted`, `base.py:18`) filtered **in-read** at every entry point (`sqlalchemy_base.py:394-395`, `:531-533`, `:827-828`); the soft-delete write flips the flag (`:681`) and reads re-apply the filter. This is precisely the "validity-in-read" pattern TheMemory already uses (`t_invalid IS NULL`) — the graph path is the one place it was omitted.
- **Graphiti / Zep (external, web-fetched):** bi-temporal edges carry `valid_at`/`invalid_at` ("when a fact was true") distinct from `created_at`/`expired_at` ("when the system learned it"); facts are **invalidated, not deleted**, and search reconstructs "what was true now vs. what was true at any point in time" — the point-in-time (`asOf`) capability the bug currently breaks for the graph path. Zep's retrieval combines semantic + BM25 + **breadth-first traversal**, with temporal validity applied during retrieval rather than as a post-pass — corroborating decision (d). NOTE (honest scoping): Graphiti models validity **on the edge**; TheMemory M0 derives validity **from the source memory** (edge-own bi-temporality is M1). The technique that transfers to M0 is *"apply the validity predicate during the retrieval query, and propagate the point-in-time instant into the traversal"* — which for our Postgres-JOIN shape means threading `filters.asOf` + `t_invalid`/`t_valid` into the candidate SELECT. Sources fetched 2026-07-10: [Zep paper (arXiv 2501.13956)](https://arxiv.org/html/2501.13956v1), [Graphiti GitHub](https://github.com/getzep/graphiti). (The `help.getzep.com/graphiti/core-concepts/temporal` path returned 404 on fetch — web-partial; the arXiv + GitHub sources carry the technique.)

## ADRs

### ADR D1 — Reuse `composeTemporalWhere`, apply during the candidate JOIN, derive validity from source memory, thread `asOf` via existing `filters` (no DIP change)

**Decision.** Fix `PgGraphExpansionStore.expandByEntities` by (1) importing and reusing `composeTemporalWhere` from `pgvector-store.ts:167-179` (the ADR-0011 predicate); (2) splicing its `m`-aliased SQL into the **final candidate SELECT `WHERE`** at `pg-graph-expansion-store.ts:88-92`; (3) reading `asOf` from `params.filters.asOf` (already present — no `ExpandByEntitiesParams` field added); (4) threading `...temporal.params` into `params2` with `LIMIT $${temporal.nextParamIndex}`. Apply **during the JOIN**, not as a TS post-filter. For M0, scope **only the final candidate SELECT** (the observable bug); leave the hop-2 edge CTE untouched (edge-own validity is M1) and leave the seed CTE untouched (seeds always originate from the already-temporally-filtered primary search in the current call graph).

**Rationale.**
- **DRY + rung 4 (`parsimony-ladder.md`):** one predicate function, one source of truth; a second copy would let the two drift — the very failure mode that produced this bug.
- **`architecture.md` § 2 (DIP):** the temporal predicate stays **behind** the `GraphExpansionStore` port — the pipeline caller (`pipeline.ts:273`) is unchanged and never learns about `t_invalid`; the port contract (`graph-expansion-store.ts:60-67`) is unchanged. The store, an infrastructure adapter, satisfies the invariant internally. No interface widening = pre-release-safe.
- **`testing.md` § 4.1 (negative test):** the observable failure is a *wrong answer* (a soft-deleted memory resurfaced), so the RED regression asserts a specific absence at the real-pgvector boundary before the fix — negative-case discipline.
- **During-JOIN over post-filter:** correctness under `LIMIT` + consistency with the four sibling paths + letta/Graphiti precedent (Corner 4d/4e).

**Alternatives considered.**
1. *Add `asOf`/`tInvalid` fields to `ExpandByEntitiesParams`.* Rejected — redundant; `asOf` already flows via `params.filters` (Q3). Widening the DIP would be a pre-release breaking change with no benefit.
2. *Post-filter invalid rows in TS after the query.* Rejected — breaks `LIMIT` semantics (returns < `limit` valid rows) and forks the correctness mechanism from the primary path (Corner 4d).
3. *Also scope the seed CTE and hop-2 edge CTE now.* Deferred — seed ids come from the already-filtered primary search (cannot be invalid in the current call graph); edge-own validity is M1. Scoping them now is speculative hardening (YAGNI) beyond the observable M0 bug; noted as a defensive follow-up.
4. *Re-implement the predicate inline in the graph store.* Rejected — DRY violation; the two copies would drift.

**Consequences.** Graph-expanded rows now honor soft-delete/supersession and `asOf` identically to the primary path. One follow-up seed for M1: edge-own bi-temporality + optionally scoping the seed/hop-2 CTEs to non-invalidated source memories (`entity_edges` gains `t_valid`/`t_invalid`, or the CTEs JOIN `memories` for source-memory validity).

## Blocked questions (if any)

None. All 6 research questions answered with line-exact internal citations, one real letta peer path, and web-fetched Graphiti/Zep technique sources. The only honest caveat is web-partial: the `help.getzep.com/graphiti/core-concepts/temporal` URL 404'd on fetch, but the technique is carried by the fetched arXiv paper + GitHub repo (Corner 4e) — no fabricated URL was recorded.
