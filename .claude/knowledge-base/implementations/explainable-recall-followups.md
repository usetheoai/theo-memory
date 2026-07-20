# Followups — explainable-recall implementation

Opportunistic findings + pre-existing issues surfaced during the halt-loop (NOT in the current commit's scope). Per `/implement` skill § anti-patterns (log, don't scope-creep).

## Pre-existing (not caused by this plan)

- **`packages/core/src/infrastructure/db/schema.ts` type errors at HEAD — AND `drizzle-kit generate` is BROKEN project-wide because of them.** `npm run typecheck` reports TS2339 on `schema.ts:223` (`category`), `:254` + `:255` (`attributedTo`). Confirmed pre-existing (`schema.ts` byte-identical to HEAD). **CONFIRMED runtime impact (T1.1):** `npm run db:generate` (`drizzle-kit generate`) CRASHES at `schema.ts:223:36` — `TypeError: Cannot read properties of undefined (reading 'name')` inside an `IndexBuilderOn.on(...)` — i.e. an index references a column (`category`) that does not exist on its table. So the whole project cannot generate migrations until this is fixed. **Workaround used by T1.1:** the `0023_recall_traces.sql` migration + `_journal.json` entry were HAND-AUTHORED (the runner's `migrate()` applies by journal — no snapshot needed; the integration test proves it applies cleanly). **VERIFIED root cause (2026-07-20):** an **unclosed JSDoc** `/**` at `schema.ts:155` (the `themory-category-filter-server-side` comment) is missing its closing `*/`, so the `category: text('category')` column def at `:159` is swallowed INTO the comment and never actually defined. The `memories_category_idx` index at `:223` then references `table.category` (undefined) → `drizzle-kit` crashes at `IndexBuilderOn.on` (`reading 'name'` of undefined) and `tsc` reports `Property 'category' does not exist`. The `attributedTo` errors at `:254-255` are almost certainly the same unclosed-comment pattern. **The fix is tiny** (add the missing `*/` before `:159`, likely at the end of `:158`), but it is PRE-EXISTING debt in the `memories` table — OUT OF SCOPE for T1.1's `recall_traces` work (scope discipline: log, don't scope-creep). **Recommended hardening (separate slice, HIGH — likely a 1-2 char fix that unbreaks `db:generate` + strict typecheck project-wide):** close the JSDoc at `:158` (and check `:254`). Consider filing an issue.

- **Missing `meta/0023_snapshot.json`** (SEPA T1.1 MEDIUM) — the hand-authored 0023 has a `_journal.json` entry + `.sql` (enough for `migrate()` at apply time; the integration test passed), but NO drizzle snapshot. Once the `schema.ts:155` bug is fixed and `db:generate` works again, it will diff against `0022_snapshot.json`, NOT see `recall_traces`, and emit a DUPLICATE/conflicting `0023`. **Before the next generated migration:** either backfill a `0023_snapshot.json` (run `db:generate` post-fix and reconcile) or hand-write the snapshot. Noted so it does not bite Phase 2+.

## Wiring deferrals

- **T0.1 `RecallTraceStore` pillar (b)** — ADR-DEFER-WIRING-B: a Phase-0 contract has no integration test yet; the symbol is exercised by an integration test in T2.1 (`pg-store` round-trip) and the final GOAL TEST. Type-level coverage exists now via `recall-trace-store.test-d.ts`. Pillar (a) PASS, pillar (c) n/a (no metric declared for T0.1).

## Carry-forward to T4.1 (SEPA T2.1 MEDIUM)

- **T4.1 factory MUST call `validateRecallTraceStoreConfig` before constructing `PgRecallTraceStore`.** The constructor does NOT self-validate; a direct `new PgRecallTraceStore(pool, { maxRowsPerRecall: NaN })` → `slice(0, NaN)` silently persists 0 rows (fail-silent, contra EC-1 fail-fast). The plan assigns validation to the factory resolver (T4.1) — the T4.1 auditor must confirm `resolveRecallTraceStore` validates the POJO config (mirrors `resolveRecallCacheStore` → `validateRecallCacheStoreConfig`).

## Pre-existing full-suite failures (PROVEN, not from this plan)

`npm test` (full contract suite) reports ~53 failing tests across 8 files: `schema.test.ts`, `schema-v0-4a/4b/6.test.ts`, `eviction-barrel.test.ts`, `cli.test.ts`, `run-server.test.ts`, `run-mcp-server.test.ts`. **PROVEN pre-existing (2026-07-20):** checked out commit `c624ce5` (the original HEAD, before ANY explainable-recall work) and `schema.test.ts` fails there too (7 failed). Root cause = the same `schema.ts:155` unclosed-JSDoc bug (see above) — it crashes drizzle `getTableConfig` at runtime, cascading to every test that imports the db/core barrel. **This plan's own domain is clean:** memory-event.test + retrieval/pipeline + recall-trace-store + recall-trace integration = all green (33 unit + integration). The final validation gate (Step 5) MUST scope failures to the diff / treat these 8 files as pre-existing per the plan's "If Validation Fails" clause. Fixing `schema.ts:155` (1-2 chars) unbreaks all 8.

## T3.1 adaptive-relax trace caveat

When `deps.retrievalPolicy` (adaptive retrieval, Item 13, default OFF) runs its Step-8.6 relax re-filter, the recall trace reflects the PRIMARY (strict) threshold pass only — a candidate the adaptive stage later recovers may still appear as a drop. Acceptable for S1 (adaptive is opt-in + rare); the trace is honest about the strict pass. Refine if adaptive + trace are used together in production.

## T4.1 cache-hit / trace interaction caveat

When BOTH the semantic recall cache (v1.5, opt-in) AND recall tracing (S1, opt-in) are enabled, a recall served from the cache (`cache.get` hit) returns early WITHOUT running `runRetrievalPipeline` → no trace row is written for that recall. This is correct-by-construction: a cache hit re-serves a previously-computed kept set and produces no FRESH drops to explain (the drops were traced when the result was first computed on the miss that populated the cache). Documented, not a bug. If per-hit drop attribution is ever required, the cache would need to also persist the drop set alongside the result set — out of scope for S1.

## SEPA T4.1 note

The pre-COMMIT SEPA for T4.1 was launched but its process was terminated before emitting a verdict (session boundary). Self-verification stood in: threading confirmed complete (recallTraceStore survives `withWorkspace` — local-memory.ts:90 — and all 3 scoped creations); validate-before-DB order confirmed in resolveRecallTraceStore; THE GOAL TEST 5/5 green end-to-end (incl. EC-1 + EC-3 fail-fast). The cache-hit caveat above is the one anticipated finding, resolved as documented-by-design.
