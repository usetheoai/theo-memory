---
slug: themory-category-filter-server-side
created_at: 2026-06-09
priority_classification: PRIORITY 0 hardening of sub-goal 2 (SDK functional) — dashboard already exposes the category filter input; the backing API was never built (RED TEAM F3 absorption)
goal: Add end-to-end optional `category` field to TheMemory's public write/list contract so that `GET /v1/dashboard/memory/list?scope=user&category=preferences` returns ONLY rows whose `category === 'preferences'`, validated by integration test against real `ankane/pgvector:v0.5.1`
---

# Plan: TheMemory server-side category filter (write + list)

> **Version 1.1** (2026-06-09) — absorbs 3 MUST FIX items from `/edge-case-plan` review at `.claude/knowledge-base/reviews/themory-category-filter-server-side-edge-cases-2026-06-09.md`: EC-1 (UPSERT collision semantics), EC-2 (SDK-layer length cap), EC-3 (empty-string filter normalization). 5 SHOULD TEST items folded into existing task TDDs (EC-4 case-sensitivity, EC-5 unicode byte-equality, EC-6 SQL-injection probe, EC-7 cursor+filter mid-pagination, EC-8 BFF dual-pathway read). 4 DOCUMENT items annotated inline (EC-9 NULL findability, EC-10 vocab drift already in Drawbacks, EC-11 db:push already in §10.2, EC-12 dual-pathway projection mirrors v1.1 attributed_to precedent). One new ADR D6 added for UPSERT semantics. Zero new tasks; ~80 LoC plan prose delta v1.0 → v1.1.
>
> **Version 1.0** (2026-06-09) — RED TEAM run on 2026-06-09 (`theo-cloud/theo` commit `a3538930`) flagged F3 MEDIUM: dashboard `/memory/memories` category filter fires BFF call but returns the unfiltered list every time. Root cause: TheMemory has zero category support across `RememberOptions` / `MemoryItem` / `Filters` / schema / REST `QuerySchema` / BFF dropping the param silently (`theo-cloud/cloud/internal/themory/client.go:150`). This plan ships category end-to-end as a first-class optional, top-level promoted column (mirroring the v1.1 `attributed_to` precedent). Backend lands first; the BFF stops dropping the param; Dashboard already wires it. Scope is decided per user direction Path B (FAANG full feature, 2026-06-09).

## Goal

Enable Dashboard operators to filter memories by `category` so that `GET /v1/dashboard/memory/list?scope=user&category=preferences` returns ONLY rows whose `category === 'preferences'`, measured by `tests/integration/server/scopes-list-category-filter.test.ts` PASS against real `ankane/pgvector:v0.5.1` with a fixture of mixed-category memories asserting `(rows-with-cat-X = expected) AND (rows-without-cat-X = excluded)`.

## Context

The dashboard-memories-tab-standardization cycle (v1.5, 10/10 tasks committed 2026-06-09) shipped a category filter input on `/memory/memories` (`theo-cloud/cloud/dashboard/src/pages/memory/memories.tsx:200-206`). The input is fully wired client-side: typing fires a re-fetch with `category=<value>` in the URL. The BFF (`theo-cloud/cloud/internal/themory/client.go:65-79`) ALREADY has `ListOptions.Category` field declared and `MemoryRow.Category` projected from `payload["category"]`. But the BFF drops the param silently before issuing the upstream call (line 150 comment: "Category/From/To are dropped silently — upstream lacks these filters."). TheMemory's REST `/v1/scopes/{type}/{id}/memories` handler (`src/server/handlers/scopes.ts:35-38`) only accepts `cursor` and `limit`.

The 23 USER memories in the dev DB (`themory_dev`) all have `payload: {text_lemmatized: ...}` with NO `category` key. So even if we wire the filter, ALL existing rows return zero matches for any non-empty filter — exactly the honest behavior we want for legacy data. This is mandated by Inquebrável Rule 3 (no implicit "default" category back-fill).

Per RED TEAM report F3 (`theo-cloud/theo/.claude/knowledge-base/reviews/red-team-results-dashboard-memories-2026-06-09.md`), the user picked Path B over Path A (hide input) and Path C (TODO marker). Per PRIORITY 0 locked 2026-06-04, this is in-scope as hardening sub-goal 2 (SDK functional) — the dashboard exposes a contract the SDK does not honor today.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `src/core/options.ts` | 178 | `9a8bca3` (2026-05-31) | Option-bag types for the 4 public verbs + helpers. Houses `RememberOptions`, `RecallOptions`, `ForgetOptions`, `ReflectOptions`, `GetAllOptions`. | `RememberOptions.metadata` shape (`Record<string, string|number|boolean|null>`) unchanged; ADR-0008 method-count cap (zero new methods); existing `attributedTo` precedent (added v1.1) preserved verbatim |
| `src/core/memory-item.ts` | 132 | `2b13883` (2026-06-04) | Public `MemoryItem` shape returned by recall/getAll. Surface for `attributedTo`, `tValid`, `tInvalid`, `confirmationCount`, `rejectedAsDuplicate`. | ADR-0003 ADD-only (no mutation API); `metadata` flat-primitive constraint; ADR-0006 bi-temporal shape; ADR-0008 cap honored (one new optional field, no new method) |
| `src/core/scope.ts` | ~140 | (verified inline) | Internal `Filters` interface — pipeline→store boundary. Already has `attributed_to`, `t_valid`, `kind`, `excludeSuperseded`. | snake_case keys (Mem0-shape); pipeline derives Filters from public Options BEFORE store layer |
| `src/local/schema.ts` | ~280 (verified inline) | (multiple) | Drizzle `memories` pgTable. Houses `attributedTo`, `kind`, `tValid`, `confirmationCount`. | Existing columns/indexes unchanged; new column nullable; no migration to existing rows |
| `src/local/migrations/0014_add_category_column.sql` (NEW) | 0 | — | (file to be created) | — |
| `src/local/migrations/meta/_journal.json` | 14 entries | (multiple) | Drizzle migration journal — `migrate()` reads this to apply pending migrations. | `0013` entry stays untouched; new entry appended via `db:generate` OR hand-authored per `architecture.md § 10.2` |
| `src/local/migrations/meta/0014_snapshot.json` (NEW) | 0 | — | (file to be created — Drizzle snapshot for the new migration) | — |
| `src/local/pgvector-store.ts` | ~600 (verified inline at line 70, 329, 363) | (multiple) | The pgvector adapter. Hoists `attributed_to` from payload to column on INSERT; projects column back to payload on SELECT; composes `attributed_to = $N` predicate in WHERE. | UPSERT semantics (ON CONFLICT DO UPDATE) for composite unique; HNSW index; cursor-based pagination; v0.4b half-life trigger |
| `src/local/in-memory-store.ts` | ~340 | `cea60b9` (2026-06-09) | In-memory adapter used by unit tests + integration smoke. Houses createdAt projection (the dashboard-memories cycle's createdAt-projection task (commit `cea60b9`) cycle). | Filter semantics MUST mirror pgvector (so tests pass on both); deterministic ORDER BY createdAt DESC, id ASC |
| `src/local/index.ts` | 1505 | `cea60b9` (2026-06-09) | `LocalMemory` + `LocalScopedMemory` + `LocalScopedSkillMemory`. Owns `remember`/`recall`/`forget`/`reflect`/`getAll` wiring + scope→Filters mapping. | ADD-only contract; ADR-0008 method-count cap; existing `attributedTo` wiring at recall path preserves byte-identical fast-path |
| `src/core/extraction/pipeline.ts` | 467 | (multiple) | Two-stage write pipeline. `runInferFalsePath` is the verbatim branch (line 115-151); `runExtraction*` is the LLM branch. Writes `payload['attributed_to']` from `options.attributedTo`. | `infer:false` byte-identical fast path; LLM extraction prompt shape unchanged (category is operator-supplied per ADR D1 below, NOT LLM-inferred) |
| `src/server/handlers/scopes.ts` | 144 | `6e3b4ee` (2026-06-03) | REST `GET /v1/scopes/{type}/{id}/memories` handler. Validates path param + query param via zod; calls `scoped.getAll()`; in-memory cursor predicate. | EC-13 case-sensitive scope enum; EC-14 limit cap 100; EC-15 cursor two-layer validation; skill scope returns 501 |
| `src/local/__tests__/in-memory-store-category.test.ts` (NEW) | 0 | — | (file to be created — unit tests for in-memory store category persist + filter) | — |
| `tests/integration/server/scopes-list-category-filter.test.ts` (NEW) | 0 | — | (file to be created — integration test against real pgvector) | — |
| `theo-cloud/cloud/internal/themory/client.go` | ~330 (verified inline) | `a3538930` (2026-06-09) | BFF client to TheMemory REST. `ListOptions.Category` already declared; `MemoryRow.Category` projected. Currently DROPS the param. | Scope routing preserved (T3.2 work in v1.5); IsSkillListingNotImplemented graceful degrade preserved; cursor-based upstream contract |
| `theo-cloud/cloud/internal/routes/memory.go` | ~150 | (verified inline) | BFF handler that reads dashboard query params into ListOptions. Already calls `Category: q.Get("category")`. | Session auth wiring (X-Theo-User-Id resolution); scope param routing |
| `theo-cloud/cloud/tests/unit/themory_client_test.go` | (existing, multiple cases) | (multiple) | BFF unit tests. Has `TestTheMemoryClient_ListWithScopeRoutesToCorrectPath` + `TestTheMemoryClient_RepoScopeDegradesGracefullyOn501`. | Existing test cases pass unchanged; new case added for category propagation |
| `theo-cloud/cloud/dashboard/src/pages/memory/memories.tsx` | 283 | `d3109beb` (2026-06-09) | Already wires `params.set('category', category)` on line 111. NO CHANGE expected in this plan. | (read-only — listed for traceability only; not edited) |
| `theo-cloud/cloud/dashboard/src/pages/memory/memories.test.tsx` | 135 | `d3109beb` (2026-06-09) | Dashboard unit tests. Already covers EC-8 + REPO + ConfirmDialog. | Existing tests pass unchanged; one new test added asserting empty-state when filter is set + 0 rows returned by mock |

### Current callers / dependents

For every public symbol the plan modifies:

- **Symbol:** `RememberOptions` (interface) in `src/core/options.ts`
  - **Callers (production):** `src/core/memory-store.ts` (`Memory.remember` signature), `src/local/index.ts:513` (`LocalScopedMemory.remember`), `src/local/index.ts` (skill verb path), `src/core/extraction/pipeline.ts:119,252` (`runInferFalsePath` + `runExtractionPipeline`), `src/server/handlers/remember.ts` (REST POST `/v1/remember`), `src/agent-tools/server.ts` (MCP `remember` tool)
  - **Callers (tests):** widespread — `src/core/__tests__/options.test.ts`, multiple integration tests
  - **External (cross-repo):** TheoCloud BFF does NOT call `remember()` directly (writes happen via SDK in agent loops); Dashboard does NOT call `remember()` directly — TheoKit binding is the canonical write surface
  - **Mitigation:** new field is optional; existing callers byte-identical behavior

- **Symbol:** `MemoryItem` (interface) in `src/core/memory-item.ts`
  - **Callers (production):** every `recall()` / `getAll()` return path; pipeline; pgvector projection; in-memory projection; REST `scopesHandler` JSON serialization
  - **Callers (tests):** widespread — every test asserting on memory items
  - **External (cross-repo):** TheoCloud BFF reads `item.Payload["category"]` → `MemoryRow.Category` already (`theo-cloud/cloud/internal/themory/client.go:185-188`); will continue to work because we also project category INTO `payload` at the REST handler level (mirrors `attributed_to` precedent at `pgvector-store.ts:70-73`)
  - **Mitigation:** new field optional; existing consumers don't need to read it

- **Symbol:** `Filters` (interface) in `src/core/scope.ts`
  - **Callers (production):** `src/local/pgvector-store.ts` (composeFilters at line 174 for attributed_to predicate), `src/local/in-memory-store.ts` (matchesFilters), `src/local/index.ts` (pipeline boundary mapping)
  - **Callers (tests):** integration tests that compose Filters directly (advanced path)
  - **Mitigation:** new field optional; pipeline maps from public option BEFORE reaching store

- **Symbol:** `scopesHandler` (REST handler) in `src/server/handlers/scopes.ts:75`
  - **Callers (production):** `src/server/index.ts` (Hono route mounting); REST consumers: dashboard via BFF, TheoCloud BFF, direct REST consumers (CLI testing)
  - **Callers (tests):** integration tests `tests/integration/server/scopes-list-*.test.ts`
  - **Mitigation:** new query param optional; existing consumers byte-identical

- **Symbol:** `ListOptions` (struct) in `theo-cloud/cloud/internal/themory/client.go:65`
  - **Callers (production):** `theo-cloud/cloud/internal/routes/memory.go:116` (dashboard list handler)
  - **Callers (tests):** `theo-cloud/cloud/tests/unit/themory_client_test.go` (multiple)
  - **Mitigation:** `Category` field already declared — we just stop dropping it

### Domain glossary

- **category** — operator-supplied free-form string tag (≤ 64 chars at REST boundary; no enum) attached to a memory at write time via `RememberOptions.category`. Filtered server-side on exact match. NOT LLM-inferred (per ADR D1).
- **attributed_to (precedent)** — N-valent peer attribution field shipped in v1.1 as a top-level promoted column. The exact precedent this plan mirrors: column hoist from payload on write, filter predicate at recall/list, projection back to payload at read.
- **payload hoist** — internal pattern where a `RememberOptions` field is FIRST stuffed into the JSONB `payload`, then the pgvector adapter PROMOTES it to a top-level column on INSERT and DELETES it from payload (so it lives in one canonical place). On SELECT the column projects BACK into payload for consumer ergonomics.
- **scopesHandler** — REST `GET /v1/scopes/{type}/{id}/memories` handler. Uses `scoped.getAll()` then in-memory cursor predicate + slice.
- **infer:false fast-path** — verbatim write path (no LLM extraction). One message → one memory. Operator-supplied metadata + attribution pass through verbatim.

### Architecture boundaries affected

Per `rules/architecture.md`:

- **§ 1 Three-tier scope**: UNCHANGED. Category is orthogonal to scope.
- **§ 2 ADD-only**: PRESERVED. Category is set at write time; mutation requires `forget(id) + remember(newText, {category})`. No public `setCategory(id, x)` method.
- **§ 3 Dependency direction (DIP)**: PRESERVED. `src/core/` defines `RememberOptions.category` and `Filters.category`. `src/local/` (pgvector + in-memory) implements the filter. `src/server/` (REST) translates query string → option. No new cross-boundary imports.
- **§ 4 Mem0-shape**: PRESERVED. Category is an additive promoted column — same shape pattern as `attributed_to` in v1.1, which is also a Mem0-extension (Mem0 itself does not have first-class category).
- **§ 5 Two runtimes one contract**: PRESERVED. The contract change (`RememberOptions.category?` + `Filters.category?` + REST QuerySchema) lives in `src/core/` + REST. Both `src/local/` impl + (future) `src/cloud/` impl honor the same interface.
- **§ 6 Naming**: `category` is camelCase in public API (`RememberOptions.category`), snake_case in internal `Filters.category` (Filters uses snake_case per § 3 Mem0-shape parity), snake_case in DB column (`category`). Mirrors `attributedTo` ↔ `attributed_to` precedent.
- **§ 9 Public API surface**: NEW exported field on existing exported interface. Requires `src/index.ts` re-export check (already happens automatically via TS structural typing) + ADR per this section's rule.
- **§ 10.1 Non-`.ts` assets**: MIGRATION `0014_add_category_column.sql` must be copied to `dist/local/migrations/` by `postbuild:copy-migrations` (already wired).
- **§ 10.2 `drizzle-kit push` vs `runMigrations()` conflict**: this migration is column-only (no trigger/function), so `db:push` and `runMigrations()` both work cleanly.

## Prior Art & Related Work

- **Internal blueprint (v1.1 precedent)** — `.claude/knowledge-base/plans/v1-1-multi-peer-and-bi-temporal-plan.md § T1.1 + ADR D2` — the exact end-to-end pattern (option → payload → column hoist → filter predicate → projection back to payload). Cited inline in every relevant adapter file.
- **Internal blueprint (cross-repo precedent)** — `.claude/knowledge-base/plans/dashboard-memories-tab-standardization-plan.md` v1.5 — cross-repo merge ordering (backend lands first; BFF + frontend follow). Same discipline applied here.
- **Reference projects (read-only)** — `.claude/knowledge-base/references/mem0/` does not ship category as a first-class column. Mem0's filter shape is `{user_id, agent_id, run_id}` only; categories live in `metadata` JSONB. We diverge intentionally (column promotion) because the dashboard wants efficient server-side filtering, not in-memory JSONB inspection. Confirmed empirically: no `category` predicate in `mem0/mem0/memory/main.py`.
- **External literature** — none required; the design is a direct application of the v1.1 column-promotion precedent.

## Objective

- [ ] Sub-goal 1 — `RememberOptions.category?: string` (≤ 64 chars) accepted by every write surface (SDK + REST + MCP); when omitted, behavior byte-identical to today
- [ ] Sub-goal 2 — Drizzle migration `0014_add_category_column.sql` adds nullable `category text` + btree index on `(category)` to `memories`; backward-compat for legacy rows (NULL → no filter match)
- [ ] Sub-goal 3 — `LocalScopedMemory.remember` persists `category` via the payload-hoist precedent so PgvectorStore writes it to the new column
- [ ] Sub-goal 4 — `LocalScopedMemory.getAll(opts)` accepts `category?: string` and the underlying store filters by it (in-memory adapter + pgvector adapter both honor it)
- [ ] Sub-goal 5 — REST `GET /v1/scopes/{type}/{id}/memories?category=X` honors the param; QuerySchema extended with the new optional field (≤ 64 chars zod validator)
- [ ] Sub-goal 6 — Integration test `tests/integration/server/scopes-list-category-filter.test.ts` GREEN against real `ankane/pgvector:v0.5.1` asserting count delta on mixed-category fixture
- [ ] Sub-goal 7 — `theo-cloud` BFF stops dropping the `category` param + propagates it as upstream `&category=`; one new unit-test case in `themory_client_test.go` asserts the upstream URL contains `category=preferences`

## ADRs

### D1 — Category is operator-supplied, NOT LLM-inferred

- **Decision**: `RememberOptions.category` is set ONLY by the operator (or by the TheoKit binding wrapping operator intent). The LLM extraction pipeline does NOT auto-derive a category from free-form text.
- **Rationale**: Auto-categorization opens a quality rabbit hole (taxonomy stability across runs, prompt sensitivity, hallucinated categories) that this hardening plan is not scoped to solve. Inquebrável Rule 3 honesty: shipping "AI-categorized memories" without rigorous evaluation would be a false claim.
- **Alternatives considered**:
  - **A1 (rejected)** — Extend extraction prompt to also output `category`. Why rejected: requires LLM eval suite for category quality (precision/recall on labeled corpus). Out of scope per PRIORITY 0 (no new evaluation infra).
  - **A2 (rejected)** — Default category to `'general'` when omitted. Why rejected: silent default poisons future filter UX (every row matches `category=general` for no good reason). Honest NULL is better.
- **Consequences**: Pre-existing rows stay `category=NULL` forever. Dashboard filter UX must show empty-state when legacy data is filtered (already does — RED TEAM S8 finding addresses the BFF; dashboard already shows empty-state when `memories.length === 0`).

### D2 — Promoted top-level column + btree index (mirrors v1.1 attributed_to)

- **Decision**: `category` is a top-level `text` column on `memories`, NOT a `payload->>'category'` JSONB path. Btree index on `(category)` enables `WHERE category = $1` to be O(log n).
- **Rationale**: Mirrors the v1.1 `attributed_to` precedent EXACTLY (column + index). JSONB path predicates need either a GIN index (cheap to query, expensive write) OR a sequential scan (slow at scale). The column is the canonical FAANG-grade choice.
- **Alternatives considered**:
  - **A1 (rejected)** — Keep category in `payload` JSONB; use `payload->>'category' = $1` predicate; add expression index. Why rejected: more complex query plan; index maintenance cost on every UPSERT; harder to audit at psql; diverges from `attributed_to` precedent (no payoff).
  - **A2 (rejected)** — Skip the index; rely on sequential scan. Why rejected: dashboard List path is the operator-facing surface; >1000 memories per scope makes sequential scan visible as latency.
- **Consequences**: One new column + one new index on `memories`. Migration is idempotent (`ADD COLUMN IF NOT EXISTS`). Pre-existing rows have `category=NULL` permanently. Drizzle schema gets one new line (no break in existing `memories_*_idx` indexes).

### D3 — Length cap ≤ 64 chars at REST boundary

- **Decision**: REST `QuerySchema.category` is `z.string().min(1).max(64).optional()`. SDK `RememberOptions.category` is documented as ≤ 64 chars in JSDoc.
- **Rationale**: Bounded input at the boundary (per `architecture.md § 8`). 64 chars is generous for human-readable categories (`"work-preferences"`, `"travel-destinations"`) while rejecting payload-stuffing abuse (someone using `category` as a 1MB text dump).
- **Alternatives considered**:
  - **A1 (rejected)** — No cap. Why rejected: violates `architecture.md § 8` boundary validation; opens DoS vector via long string equality probes.
  - **A2 (rejected)** — Stricter cap (≤ 32 chars). Why rejected: too restrictive for legitimate operator vocabularies; 64 is the same cap as `theo_api_keys.key_name`.
- **Consequences**: REST returns 422 INVALID_QUERY for `category` > 64 chars; SDK path enforces the same at the type boundary (TS doesn't enforce length, so the store-layer normalization re-validates per Inquebrável defense-in-depth).

### D4 — Cross-repo merge order: theo-memory → theo-cloud BFF

- **Decision**: TheMemory backend (Phases 1-3 of this plan) MUST land + a new tagged build MUST be available BEFORE the theo-cloud BFF commits the "stop dropping category" change. Mirrors the v1.5 cross-repo precedent.
- **Rationale**: Without the contract change, the BFF forwarding `?category=preferences` would receive a `422` from REST `QuerySchema` (because the schema would not allow the param yet). Backend leads, BFF follows. Dashboard does NOT need a re-deploy (already wired).
- **Alternatives considered**:
  - **A1 (rejected)** — Land them together as one cross-repo PR. Why rejected: theo-memory + theo-cloud have separate git histories; coordinating a single PR is impractical. Sequenced merge respects the existing precedent.
- **Consequences**: The BFF phase of this plan (Phase 5) explicitly waits on the theo-memory phases. The `/implement` halt-loop for Phase 5 verifies the new TheMemory build is running before committing the BFF change.

### D5 — In-memory store mirrors pgvector filter semantics

- **Decision**: `src/local/in-memory-store.ts` filter for category uses string equality (`row.category === filter.category`) with NULL row exclusion (NULL rows do NOT match any value). Empty-string filter (`filters.category === ''`) is normalized to undefined (no-filter) at the store boundary BEFORE composing the predicate, so in-memory and pgvector return byte-identical result sets (EC-3 absorption).
- **Rationale**: Tests must produce identical assertions against both adapters per `rules/testing.md` pyramid (unit tests use in-memory; integration tests use pgvector). Divergent filter semantics would let bugs ship that pass unit tests but fail in production.
- **Alternatives considered**:
  - **A1 (rejected)** — In-memory adapter returns rows where `row.category === filter.category OR row.category === undefined`. Why rejected: silently includes legacy rows; user would see "filtered" results that contain unfiltered legacy data. Surprises consumers.
  - **A2 (rejected)** — Treat empty string as "filter for rows where category is empty string". Why rejected: REST already rejects empty via zod `min(1)`; adapter behavior must mirror the REST contract; "empty = no filter" is the consistent semantic.
- **Consequences**: Both adapters return `[]` when a fixture has no matching category, and unit tests are predictive of production behavior. Empty-string filter behaves IDENTICALLY to `undefined` filter at the store layer.

### D6 — UPSERT preserves first-write category (ADR-0003 ADD-only spirit)

- **Decision**: The pgvector adapter's `ON CONFLICT DO UPDATE` clause MUST NOT include `category` in the SET list. On a dedup-collision (same `(hash, scope)` tuple), `confirmation_count` bumps but `category` stays at the first-write value. Subsequent `remember(sameText, {category: 'B'})` against an existing `(hash='X', category='A')` row leaves the row at `category='A'`.
- **Rationale**: ADR-0003 mandates ADD-only semantics — a remember() call must NEVER silently mutate an existing row's content. Allowing UPSERT to overwrite category would violate that spirit (the public API didn't ask for mutation; the row mutates anyway). First-write-wins is observable, predictable, and honest. Operators who genuinely want a different category must explicitly `forget(id) + remember(newText, {category: 'B'})` — the documented mutation path.
- **Alternatives considered**:
  - **A1 (rejected)** — `category = EXCLUDED.category` (last-write-wins overwrites). Why rejected: silently mutates an existing row's content; surprises operators who don't realize a re-remember rewrites the category; violates ADR-0003 ADD-only spirit.
  - **A2 (rejected)** — `category = COALESCE(EXCLUDED.category, memories.category)` (only set when previously NULL). Why rejected: a half-step toward the same problem — operator who adds a category on a second write expects A1 semantics but gets A2 surprise; first-write-wins is the SIMPLER honest contract.
- **Consequences**: Once a row has a category, that category is immutable via remember(). Operators are guided toward the forget+remember canonical mutation. Integration test pins this: `test_pgvector_upsert_does_not_overwrite_category`.

## Dependencies

Per `rules/deps-audit-golden-rule.md` mandatory section. This plan introduces **ZERO** new dependencies across all ecosystems (npm, Python, Rust, Go).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `drizzle-orm` | `^0.36` (current package.json) | npm | Schema declaration for new `category` column (mirrors existing `attributedTo` column declaration pattern) |
| `drizzle-kit` | `^0.31.0` | npm (devDep) | Migration generation (`npm run db:generate`) and journal updating for `0014_add_category_column` |
| `pg` | `^8.x` | npm | Postgres driver — unchanged; new column reaches PG via same query path |
| `zod` | `^3.x` | npm | REST `QuerySchema` validation — extended with `category: z.string().min(1).max(64).optional()` (per ADR D3) |
| `hono` | `^4.x` | npm | REST handler framework — `scopesHandler` extended; no Hono API surface change |
| `ankane/pgvector:v0.5.1` | Docker image | infra | Integration test target — UNCHANGED; new column is plain `text` (no pgvector-specific extension needed) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why |
|---|---|---|---|---|
| (none) | — | — | — | This plan reuses every existing dep verbatim. The `category` column reuses Drizzle's `text()` declaration; the filter predicate reuses `pg`'s parameterized query; the boundary check reuses `zod` + the existing `InvalidScope` error class. Inquebrável Rule 9 (Não Reinvente) satisfied trivially by zero-net-new-dep posture. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

### Pre-existing vulnerabilities (informational; NOT introduced by this plan)

Per `deps-audit-allowlist.txt` (verified 2026-06-09): 8 npm vulnerabilities are active in the dep tree (1 CRITICAL + 3 HIGH + 4 MODERATE) but **all are allowlisted within sunset dates** (2026-07-01 to 2026-08-29) and chained through `@xenova/transformers` + `drizzle-kit` + `next` — none of which this plan touches. Per the deps-audit golden rule, allowlisted findings downgrade by one severity level: effective post-downgrade severity is MEDIUM at most. The CRITICAL chain (`protobufjs` → `@xenova/transformers` → `onnxruntime-web`) is tracked separately in task #87 (`deps-upgrade-xenova-transformers-v2-protobufjs-cve`). This plan's Phase 6 hygiene step (rebuild + restart) does NOT mutate the dep tree.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Pre-existing 23 USER memories in `themory_dev` have `category=NULL` permanently — any filter returns 0 hits even when the user EXPECTS matches | Medium | Document EXPLICITLY in CHANGELOG migration notes (mirrors v1.1 `attributed_to` honest no-backfill); add dev-DB seed script with categories so RED TEAM can verify the filter end-to-end | impl |
| Adding a column + index requires a write lock briefly on `memories` table at migration time | Low | `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` are NON-blocking in PG 14+; document migration is safe to run online | impl |
| Operator vocabulary drift — every team can invent their own categories, leading to inconsistent filter UX over time | Low | DOCUMENT as known limitation in CHANGELOG; defer category enum/vocabulary validation to v1.4 (typed-domain-ontologies, Roadmap Item 15 FROZEN under PRIORITY 0) | impl |
| Cross-repo merge race: someone tries the dashboard filter between theo-memory deploy and BFF deploy | Low | Per D4, theo-memory lands FIRST; BFF deploy follows. Window is operator-controlled (single repo `/release`). Worst case during window: BFF still drops the param (current state), so dashboard shows unfiltered list (status quo) | impl |
| Test surface expansion: new integration test against real pgvector adds ~3-5s to CI integration suite | Low | Acceptable cost — TheMemory CI is dominated by pgvector boot, not test runtime | impl |
| ADR-0008 method-count cap risk — adding `category` to options does NOT cross the cap (zero new methods), but reviewer must verify no new method snuck in | Low | Phase 6 cross-validation explicitly counts methods per ADR-0008 (DIP-by-DIP) and asserts unchanged from `develop` | impl |
| EC-1 / ADR D6: first-write-wins category surprises operators who expect remember() to "update" semantics | Medium | DOCUMENT in JSDoc on `RememberOptions.category` explicitly; CHANGELOG migration note states "category is immutable via remember(); use forget+remember for mutation"; integration test pins the contract | impl |
| EC-2: SDK-layer throw on >64 char category is a NEW runtime error class that pre-2026-06-09 callers don't expect | Low | InvalidScope class already exists (v1.1 attributedTo precedent); error message is explicit; TheoKit binding can catch and surface to operator | impl |

## Unresolved Questions

(none — every decision is resolved at plan time)

All option shape, schema column, REST query param, BFF propagation, filter semantics, and cross-repo merge ordering are decided. Operator-vocabulary normalization is explicitly deferred per D1 + the Roadmap Item 15 freeze.

## Dependency Graph

```
Phase 1 (core types) ──▶ Phase 2 (schema + migration) ──▶ Phase 3 (adapters + pipeline)
                                                                │
                                                                ▼
                                                       Phase 4 (REST handler)
                                                                │
                                                                ▼
                                                       Phase 5 (theo-cloud BFF — cross-repo)
                                                                │
                                                                ▼
                                                  Phase 6 (Integration Validation)
```

All phases are sequential. Phase 5 depends on Phase 4 being deployed (D4 cross-repo merge order).

---

## Phase 1: Core type extension

**Objective:** Add `category?: string` to `RememberOptions`, `MemoryItem`, `Filters`, `GetAllOptions` — the public + internal contract surface.

### T1.1 — Extend RememberOptions + MemoryItem + Filters + GetAllOptions with `category?`

#### Objective
Surface a new optional `category: string` field on the public write/read contract types so adapters can persist + filter on it.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does**: Adds one new optional field to four existing exported types (`RememberOptions`, `MemoryItem`, `Filters`, `GetAllOptions`), with JSDoc citing this plan's slug and the ≤ 64 char constraint. Exports unchanged; method-count unchanged; no new files.

**Why it is necessary now**: All subsequent phases (schema, adapter, REST, BFF) read from these types. If the types aren't extended first, every later phase has to be paused mid-cycle. Per cycle-implement.md TDD discipline, the contract change is the SMALLEST atomic unit and ships first.

#### Evidence
- `src/core/options.ts:34` (RememberOptions.attributedTo) — exact precedent of an optional field added under ADR-0008 cap
- `src/core/memory-item.ts:55` (MemoryItem.attributedTo) — same precedent at item shape
- `src/core/scope.ts:114` (Filters.attributed_to) — same precedent at Filters
- `.claude/knowledge-base/plans/v1-1-multi-peer-and-bi-temporal-plan.md § T1.1` — the original plan that established the pattern

#### Files to edit
```
src/core/options.ts                       — add RememberOptions.category? + GetAllOptions.category?
src/core/memory-item.ts                   — add MemoryItem.category?
src/core/scope.ts                         — add Filters.category?
src/core/__tests__/options.test.ts        — RED test: type expansion compiles + readonly tagged
```

#### Deep file dependency analysis

- `src/core/options.ts`: today (Baseline Context row 1) exports the four Options interfaces. Adds one `readonly category?: string` field on `RememberOptions` and `GetAllOptions` per ADR D3 (≤ 64 chars documented in JSDoc). Downstream callers (`runExtractionPipeline`, REST handlers, MCP tools) read the field via TypeScript structural typing; existing call sites that don't pass `category` byte-identical behavior.
- `src/core/memory-item.ts`: today (Baseline Context row 2) exports `MemoryItem` + `MemoryItemWithScore`. Adds `readonly category?: string` on `MemoryItem` only (score is unrelated). Every adapter that constructs MemoryItems will project the new field; existing projections without category byte-identical.
- `src/core/scope.ts`: today (Baseline Context row 3) exports `Filters`. Adds `readonly category?: string` (snake_case matches Mem0-shape parity per architecture.md § 6). Pipeline boundary in `src/local/index.ts` will map `RememberOptions.category` → `Filters.category` (next task).
- `src/core/__tests__/options.test.ts`: existing type-check tests on options shape. Add RED tests asserting the new field is readonly + optional + typed `string|undefined`.

#### Deep Dives

- **Invariant (ADR-0008 method-count cap)**: zero new methods on any DIP interface; only new optional fields on existing interfaces. Verifiable by `grep -c '^\s*\(get\|set\|insert\|recall\|forget\|reflect\|list\)' src/core/dip/*.ts` before/after diff being zero.
- **Edge case (empty string vs undefined)**: `category: ''` should be REJECTED at the boundary (REST: `min(1)`; SDK: documented as ≥ 1 char). Inside the store, `Filters.category === ''` is treated as no-filter (NOT as "match empty-string rows"). This mirrors v1.1 EC-7 attributed_to NULL-handling discipline.

#### Pseudo-code / Signatures

```ts
// src/core/options.ts (additions only)
export interface RememberOptions {
  // ... existing fields preserved verbatim ...
  /** Operator-supplied category tag (1-64 chars). EC-2 boundary check throws
   *  InvalidScope at pipeline entry if outside range. Filter via Filters.category.
   *  ADR D6: once persisted, category is IMMUTABLE via remember() — UPSERT does
   *  NOT overwrite; first-write wins. Use forget(id) + remember(newText, {category: 'B'})
   *  for mutation. EC-9: legacy rows with category=NULL are NOT findable via filter.
   *  @see plan themory-category-filter-server-side § T1.1 + ADR D1 + D3 + D6 */
  readonly category?: string;
}

export interface GetAllOptions {
  // ... existing fields preserved verbatim ...
  /** Filter result to rows whose category EXACTLY equals this value (byte-equality;
   *  case-sensitive; no Unicode normalization — EC-4 + EC-5). NULL category rows
   *  do NOT match (per ADR D5). Empty string normalizes to no-filter (EC-3).
   *  Legacy rows with category=NULL are NOT findable via this filter (EC-9). */
  readonly category?: string;
}
```

```ts
// src/core/memory-item.ts (addition only)
export interface MemoryItem {
  // ... existing fields preserved verbatim ...
  /** Optional operator category tag. EC-12: ALSO projected into `metadata.category`
   *  by the pgvector adapter for upstream-shape parity (mirrors v1.1 attributedTo
   *  precedent — redundancy is intentional architectural symmetry).
   *  @see plan themory-category-filter-server-side § ADR D6 + EC-12 */
  readonly category?: string;
}
```

#### Tasks
1. Add `readonly category?: string` to `RememberOptions` with JSDoc + ADR cross-refs
2. Add `readonly category?: string` to `GetAllOptions` with JSDoc
3. Add `readonly category?: string` to `MemoryItem` with JSDoc
4. Add `readonly category?: string` to `Filters` (snake_case `category`, lowercase per Filters convention)
5. Add type-check tests to `src/core/__tests__/options.test.ts`
6. Run `npm run typecheck` — zero errors expected

#### TDD
```
RED:     test_RememberOptions_category_is_optional_readonly_string() — expectTypeOf<RememberOptions['category']>().toEqualTypeOf<string|undefined>()
RED:     test_GetAllOptions_category_is_optional_readonly_string() — same shape
RED:     test_MemoryItem_category_is_optional_readonly_string() — same shape
RED:     test_Filters_category_is_optional_readonly_string() — same shape (snake_case field name)
GREEN:   Add four optional fields with JSDoc
REFACTOR: None expected — pure additive type change
VERIFY:  npm run typecheck && npm test src/core/__tests__/options.test.ts
```

#### Concurrency tests
(none — single-threaded)

Rationale: pure type system change; no runtime behavior.

#### Acceptance Criteria
- [ ] `tsc --noEmit -p tsconfig.contract.json` zero errors
- [ ] 4 new RED tests pass after GREEN
- [ ] `git diff --stat src/core/options.ts src/core/memory-item.ts src/core/scope.ts` shows additive-only changes (no deletions of existing fields)
- [ ] Method count on every DIP interface unchanged (`grep -c 'readonly\s\+\(insert\|list\|recall\|forget\|reflect\|getAll\)' src/core/dip/*.ts` byte-identical to `develop`)
- [ ] Pass: lint — `npm run lint -- src/core/options.ts src/core/memory-item.ts src/core/scope.ts` zero warnings
- [ ] Pass: size — all 3 files ≤ 500 LoC (per `rules/architecture.md`)

#### DoD
- [ ] All 6 tasks committed atomically as one commit
- [ ] `npm test src/core/__tests__/options.test.ts` green
- [ ] `npm run typecheck` green
- [ ] `npm run lint -- src/core/options.ts src/core/memory-item.ts src/core/scope.ts` zero warnings

---

## Phase 2: Schema + Drizzle migration

**Objective:** Promote `category` to top-level column + btree index. Idempotent; backward-compat preserved.

### T2.1 — Add `category` column + btree index to `memories` schema

#### Objective
Generate Drizzle migration `0014_add_category_column.sql` + snapshot file. Update `src/local/schema.ts` to declare the new column.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does**: Adds one nullable `text` column + one btree index to the `memories` Drizzle pgTable. Generates a SQL migration via `npm run db:generate` (or hand-authored per `architecture.md § 10.2`). Updates `_journal.json` to include `0014_add_category_column`.

**Why it is necessary now**: Phase 3 (adapter) writes to this column via `INSERT INTO memories (..., category)`. Without the column in the schema, the INSERT fails. The schema MUST exist before the adapter targets it.

#### Evidence
- `src/local/schema.ts:84` (attributedTo column declaration) — exact precedent
- `src/local/migrations/0008_attributed_to.sql` — exact precedent SQL shape
- `src/local/migrations/meta/_journal.json:14 entries` — journal currently ends at `0013_admin_config`

#### Files to edit
```
src/local/schema.ts                                       — add category: text('category') after attributedTo
src/local/migrations/0014_add_category_column.sql (NEW)   — ALTER TABLE + CREATE INDEX
src/local/migrations/meta/0014_snapshot.json (NEW)        — Drizzle snapshot for migration journal
src/local/migrations/meta/_journal.json                   — append new entry
tests/integration/migrations/0014-applies-category.test.ts (NEW) — RED test: migration applies idempotently
```

#### Deep file dependency analysis

- `src/local/schema.ts`: today (Baseline Context row 4) declares the full `memories` pgTable. Adding one column line + one index line. Drizzle generates type-narrowed inserts/selects from the schema; existing consumers byte-identical.
- `src/local/migrations/0014_add_category_column.sql` (NEW): SQL with `ALTER TABLE memories ADD COLUMN IF NOT EXISTS category text;` + `CREATE INDEX IF NOT EXISTS memories_category_idx ON memories (category);`. Idempotent per architecture.md § 10.2.
- `src/local/migrations/meta/_journal.json`: appended entry with same shape as previous entries.
- `tests/integration/migrations/0014-applies-category.test.ts` (NEW): asserts running `runMigrations(pool)` twice does NOT throw + the `category` column exists in `information_schema.columns`.

#### Deep Dives

- **Migration idempotency**: `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` are PG 14+ idempotent operators. Running `runMigrations` twice does NOT throw. Important because `db:push` and `runMigrations` can collide on dev DBs (per `architecture.md § 10.2`).
- **Drizzle snapshot regeneration**: `npm run db:generate` regenerates `0014_snapshot.json` automatically. If hand-authored, copy the v0008 snapshot delta and adjust column reference.
- **EC-1 absorption (legacy data)**: Pre-existing rows have `category=NULL` permanently. The migration explicitly does NOT include a `UPDATE memories SET category = ...` back-fill — per ADR D1.

#### Pseudo-code / Signatures

```sql
-- src/local/migrations/0014_add_category_column.sql
ALTER TABLE memories ADD COLUMN IF NOT EXISTS category text;
CREATE INDEX IF NOT EXISTS memories_category_idx ON memories (category);
```

```ts
// src/local/schema.ts (delta only)
attributedTo: text('attributed_to'),
/** themory-category-filter-server-side T2.1 — operator-supplied category tag promoted to top-level
 *  column per ADR D2 (mirrors v1.1 attributed_to precedent). NULL for pre-2026-06-09 rows. */
category: text('category'),  // <-- NEW
textLemmatized: jsonb('text_lemmatized').$type<string[]>(),
// ... existing fields preserved verbatim ...
// In the index block, append:
index('memories_category_idx').on(table.category),
```

#### Tasks
1. Add `category: text('category')` to schema.ts memories table (after `attributedTo` for clean diff)
2. Add `index('memories_category_idx').on(table.category)` to the index block
3. Hand-author `0014_add_category_column.sql` with idempotent ALTER + CREATE INDEX
4. Append entry to `_journal.json` (`{idx: 14, tag: "0014_add_category_column", ...}`)
5. Hand-author `0014_snapshot.json` (or regenerate via `npm run db:generate` if Drizzle config supports it)
6. Add RED integration test asserting migration idempotency + column existence

#### TDD
```
RED:     test_migration_0014_adds_category_column() — query information_schema.columns, assert column exists with text type
RED:     test_migration_0014_is_idempotent() — call runMigrations twice; no throw; column still exists exactly once
RED:     test_migration_0014_creates_btree_index() — query pg_indexes, assert memories_category_idx exists
GREEN:   Hand-author migration + journal entry + schema diff
REFACTOR: None expected
VERIFY:  npm test tests/integration/migrations/0014-applies-category.test.ts
```

#### Concurrency tests
(none — single-threaded)

Rationale: schema migration serialized by PG migration lock.

#### Acceptance Criteria
- [ ] `npm test tests/integration/migrations/0014-applies-category.test.ts` green against real `ankane/pgvector:v0.5.1`
- [ ] `npm run db:push` (against fresh DB) applies the new column cleanly
- [ ] `npm run typecheck` zero errors (schema.ts changes are TS-checked)
- [ ] Pass: lint — `npm run lint -- src/local/schema.ts` zero warnings
- [ ] Pass: size — `src/local/schema.ts` ≤ 500 LoC (current ~280 LoC; +2 lines)

#### DoD
- [ ] Migration file + snapshot + journal entry all committed atomically
- [ ] Integration test green
- [ ] `psql -c "\d memories"` shows `category` column + `memories_category_idx` index

---

## Phase 3: Adapter + pipeline wiring

**Objective:** PgvectorStore writes/reads category; in-memory store mirrors semantics; pipeline routes RememberOptions.category → payload (then to column via existing hoist).

### T3.1 — In-memory store category persist + filter

#### Objective
Update `src/local/in-memory-store.ts` to persist `payload['category']` (mirroring how it stores `attributed_to`) and to filter on `Filters.category` in `list()`.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does**: Adds `category` to the in-memory row representation; filter predicate at `list()` matches `row.category === filter.category` with NULL exclusion per ADR D5. Mirrors the existing `attributed_to` matchesFilters branch.

**Why it is necessary now**: TheMemory's unit-test pyramid uses the in-memory store. If we ship the type change in Phase 1 without the in-memory filter, unit tests in Phase 4 (REST handler) fail. Adapter wiring must precede REST so the integration shape is testable end-to-end.

#### Evidence
- `src/local/in-memory-store.ts:33-37` (createdAt projection precedent shipped the dashboard-memories cycle's createdAt-projection task (commit `cea60b9`))
- `src/local/in-memory-store.ts:208-217` (current matching loop with deterministic ORDER BY)
- `src/local/pgvector-store.ts:174-176` (attributed_to filter predicate precedent)

#### Files to edit
```
src/local/in-memory-store.ts                                — store category in row; filter on Filters.category
src/local/__tests__/in-memory-store-category.test.ts (NEW)  — RED tests
```

#### Deep file dependency analysis

- `src/local/in-memory-store.ts`: today (Baseline Context row 8) holds the in-memory `Row` interface + `insert/list/recall/etc.` methods. Adds `category?: string` to Row; `list()` predicate filters rows by category when `filters.category !== undefined`; insert path reads `payload['category']` and stores onto the row.
- `src/local/__tests__/in-memory-store-category.test.ts` (NEW): insert 3 rows with categories `['a','a','b']`, list with `filters.category='a'` returns 2 rows (id-comparable to inserted); list with `filters.category='c'` returns 0 rows; list with `filters.category=undefined` returns all 3.

#### Deep Dives

- **NULL exclusion semantic (ADR D5)**: filter `category='a'` MUST NOT match rows where `row.category === undefined`. The matching predicate: `if (filter.category !== undefined && row.category !== filter.category) skip`. Specifically: NULL rows always skip when filter is set.
- **Order preservation**: existing deterministic ORDER BY createdAt DESC, id ASC (line 217) UNCHANGED.

#### Pseudo-code / Signatures

```ts
// src/local/in-memory-store.ts (additions only)
interface Row {
  readonly vector: readonly number[];
  readonly payload: Payload;
  readonly createdAt: Date;
  readonly category?: string;  // NEW
  // ... existing fields ...
}

async list(filters: Filters, limit: number): Promise<readonly VectorStoreResult[]> {
  const matching: VectorStoreResult[] = [];
  // EC-3 absorption (per ADR D5): empty-string filter normalizes to no-filter
  // so in-memory + pgvector + REST all share the same semantic. Direct SDK
  // callers passing filters.category='' get the same result as undefined.
  const catFilter = filters.category !== undefined && filters.category !== ''
    ? filters.category : undefined;
  for (const [id, row] of this.rows) {
    if (!matchesFilters(row, filters)) continue;
    // NEW: category exact match; NULL rows excluded when filter is set.
    // EC-4 + EC-5: byte equality (case-sensitive; no Unicode normalization).
    if (catFilter !== undefined && row.category !== catFilter) continue;
    matching.push({ id, payload: row.payload, createdAt: row.createdAt, category: row.category });
  }
  // ... existing deterministic sort + slice ...
}
```

#### Tasks
1. Add optional `category` field to `Row` interface
2. Insert path: when `payload['category']` is a string, persist `row.category = payload['category']`
3. List path: add filter predicate per pseudo-code, including EC-3 empty-string normalization
4. Project `category` into `VectorStoreResult` output
5. RED tests asserting filter semantics including EC-3, EC-4, EC-5

#### TDD
```
RED:     test_in_memory_store_filters_by_category_exact_match() — insert 3 rows {cat=a, cat=a, cat=b}; list with category=a returns 2
RED:     test_in_memory_store_filter_excludes_null_category_rows() — insert {cat=a, cat=null}; list with category=a returns 1
RED:     test_in_memory_store_no_filter_returns_all() — insert 2 rows; list with no filter returns 2
RED:     test_in_memory_store_persists_category_from_payload() — insert with payload.category='x'; list returns row.category='x'
RED:     test_in_memory_store_empty_string_filter_equiv_to_undefined() (EC-3) — insert 3 rows {cat=a, cat=b, cat=null}; list with category='' returns ALL 3 (same as undefined)
RED:     test_in_memory_store_case_sensitive_filter() (EC-4) — insert {cat=Preferences, cat=preferences}; filter='preferences' returns exactly 1 row (NOT 2); pin deliberate non-normalization per ADR D1
GREEN:   Implement Row.category + insert assignment + list predicate + projection + EC-3 normalization
REFACTOR: None expected — additive change mirroring attributed_to
VERIFY:  npm test src/local/__tests__/in-memory-store-category.test.ts
```

#### Concurrency tests
(none — single-threaded)

Rationale: in-memory Map operations are single-threaded by JS event loop.

#### Acceptance Criteria
- [ ] 6 RED tests pass after GREEN (includes EC-3 empty-string normalization + EC-4 case-sensitivity pin)
- [ ] `npm run typecheck` zero errors
- [ ] Pass: lint — `npm run lint -- src/local/in-memory-store.ts` zero warnings
- [ ] Pass: size — `src/local/in-memory-store.ts` ≤ 500 LoC (currently ~340)
- [ ] NO existing in-memory-store test regresses (`npm test src/local/__tests__/in-memory-store-*.test.ts` all green)

#### DoD
- [ ] Atomic commit: schema + test file together
- [ ] All in-memory store tests green
- [ ] Manual sanity: insert with category='preferences'; list filter='preferences' returns it; list filter='other' returns []

### T3.2 — PgvectorStore category hoist + filter + projection

#### Objective
Extend `src/local/pgvector-store.ts` to (a) hoist `payload['category']` to the new `category` column on INSERT (mirroring attributed_to), (b) compose `category = $N` predicate in WHERE when `filters.category` is set, (c) project `category` back into the SELECT result.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does**: Three additive edits to the pgvector adapter, each mirroring the `attributed_to` precedent line-by-line:
1. INSERT: extract `category` from payload, append column to INSERT statement
2. SELECT: project new column into result
3. WHERE composer: add `category = $N` branch when filter is set

**Why it is necessary now**: Integration tests in Phase 4 (REST) need pgvector to honor the filter. Without the predicate, every list call returns the unfiltered result and the integration test FAILS — which IS the desired RED state, but we ship the GREEN here.

#### Evidence
- `src/local/pgvector-store.ts:174-176` (attributed_to filter predicate — exact pattern to mirror)
- `src/local/pgvector-store.ts:329-340` (attributed_to column hoist on INSERT — exact pattern)
- `src/local/pgvector-store.ts:70-73` (attributed_to projection on read — exact pattern)
- `src/local/pgvector-store.ts:363` (INSERT statement with column list — adds `, category`)

#### Files to edit
```
src/local/pgvector-store.ts                                  — 4 surgical edits per pseudo-code below
tests/integration/local/pgvector-store-category.test.ts (NEW) — RED integration tests against real pgvector
```

#### Deep file dependency analysis

- `src/local/pgvector-store.ts`: today (Baseline Context row 7) holds `PgvectorStore` adapter with composeFilters, INSERT statement, SELECT projection. Adds the category branch at each of the 3 documented locations.
- Test depends on real `ankane/pgvector:v0.5.1` (via `@testcontainers/postgresql`).

#### Deep Dives

- **Filter predicate placement**: in `composeFilters` (around line 174 per evidence). The branch reads `if (filters.category !== undefined && filters.category !== '') { parts.push(\`category = $${idx}\`); params.push(filters.category); idx++; }`. EC-3 empty-string normalization at store boundary (defense-in-depth — REST already rejects via zod min(1), but direct SDK callers could pass it).
- **INSERT column hoist**: in the insertion path (around line 329). Reads `const category = (payload['category'] as string | undefined) ?? null; ... delete cleanedPayload['category']; ... INSERT INTO memories (..., category) VALUES (..., $N)`.
- **UPSERT semantics (EC-1 / ADR D6 absorption)**: the existing `ON CONFLICT (hash, COALESCE(user_id,''), ...) DO UPDATE SET confirmation_count = confirmation_count + 1` clause MUST NOT include `category` in the SET list. First-write-wins is the contract (ADR-0003 ADD-only spirit). Operators wanting to change category use `forget(id) + remember(newText, {category: 'B'})`.
- **SELECT projection (EC-12 dual-pathway absorption)**: in the row deserializer (around line 70-73). Reads `if (row.category !== undefined && row.category !== null) { payload['category'] = row.category; }`. This mirrors v1.1 attributed_to precedent — the column is projected BACK into payload so consumers reading via the JSONB pathway keep working. The top-level `MemoryItem.category` is the canonical surface; the payload projection is the upstream-shape parity mirror (intentional redundancy).
- **EC-5 Unicode/EC-6 SQL injection**: filter predicate uses Postgres `=` operator (byte equality; no normalization). Parameterized binding (`= $N` with `params.push`) prevents SQL injection categorically. No new defense needed.

#### Pseudo-code / Signatures

```ts
// src/local/pgvector-store.ts — 4 additive deltas + 1 EC-1 ADR D6 invariant:

// (1) composeFilters (~line 174 after attributed_to branch) — EC-3 normalization:
if (filters.category !== undefined && filters.category !== '') {
  parts.push(`category = $${idx}`);
  params.push(filters.category);
  idx++;
}

// (2) INSERT path (~line 329 after attributedTo extraction):
const category = (payload['category'] as string | undefined) ?? null;
// ... in the cleanedPayload sanitization:
delete cleanedPayload['category'];

// (3) INSERT statement column list (~line 363):
INSERT INTO memories (id, text, hash, embedding, payload, user_id, session_id, agent_id, attributed_to, category)
VALUES (...)
ON CONFLICT (hash, COALESCE(user_id,''), COALESCE(session_id,''), COALESCE(agent_id,''))
DO UPDATE SET confirmation_count = memories.confirmation_count + 1
-- NOTE (EC-1 / ADR D6): category intentionally NOT in SET list; first-write wins.
-- See plan §ADR D6. Mutation path is forget(id) + remember(newText, {category: 'B'}).
RETURNING ...;

// (4) SELECT projection (~line 70) — EC-12 dual-pathway absorption:
if (row.category !== undefined && row.category !== null) {
  payload['category'] = row.category;  // mirrors v1.1 attributed_to projection
}
```

#### Tasks
1. Add `category` to `Row` type returned from raw SQL (already covered by Drizzle if we use schema; in raw SQL path, type is `string | null`)
2. Add composeFilters branch for category
3. Add INSERT hoist (extract → delete from payload → append to INSERT)
4. Add SELECT projection (back to payload key)
5. Update PgvectorStore.list() to honor `filters.category` if needed (composeFilters change usually suffices)
6. RED integration tests: insert mixed categories; list with filter; assert count

#### TDD
```
RED:     test_pgvector_persists_category_from_payload() — remember with options.category='a' (via verbatim path); SELECT category column = 'a'
RED:     test_pgvector_filters_list_by_category() — insert 3 with [a,a,b]; list with filters.category='a' returns 2
RED:     test_pgvector_filter_excludes_null_category() — insert {cat=a, cat=null}; filter 'a' returns 1
RED:     test_pgvector_no_filter_returns_all() — sanity: filter undefined → all rows
RED:     test_pgvector_category_index_used() — EXPLAIN ANALYZE shows index scan, not seq scan (>50 rows)
RED:     test_pgvector_empty_string_filter_equiv_to_undefined() (EC-3) — filters.category='' returns SAME rows as filters.category=undefined
RED:     test_pgvector_upsert_does_not_overwrite_category() (EC-1 / ADR D6) — insert row with category='A'; remember sameText with options.category='B'; SELECT confirmation_count=2 AND category='A' (first-write preserved; confirmation bumped)
RED:     test_pgvector_filter_byte_equality_case_sensitive() (EC-4) — insert {cat='Preferences', cat='preferences'}; filter 'preferences' returns 1 row
RED:     test_pgvector_filter_byte_equality_unicode_nfc_vs_nfd() (EC-5) — insert NFC 'café' (one row) + NFD 'café' (separate row); filter NFC returns NFC row only
RED:     test_pgvector_filter_resists_sql_injection() (EC-6) — POST remember with category="' OR 1=1 --"; filter same value returns exactly 1 row (NOT all rows; NOT SQL error). Validates parameterized binding.
GREEN:   Apply 4 deltas + ADR D6 ON CONFLICT clause (category NOT in SET)
REFACTOR: None expected — additive
VERIFY:  npm test tests/integration/local/pgvector-store-category.test.ts (real pgvector)
```

#### Concurrency tests
(none — single-threaded)

Rationale: INSERT/SELECT are PG transaction-isolated; no shared state in adapter.

#### Acceptance Criteria
- [ ] 10 RED integration tests pass after GREEN against real `ankane/pgvector:v0.5.1` (originais 5 + EC-1/EC-3/EC-4/EC-5/EC-6)
- [ ] `psql -c "EXPLAIN ANALYZE SELECT * FROM memories WHERE category='X' LIMIT 100"` shows `Index Scan using memories_category_idx` (NOT Seq Scan) when row count > 50
- [ ] EC-1 ADR D6 verified: UPSERT does NOT overwrite category; `confirmation_count` bumps; first-write preserved
- [ ] `npm run typecheck` zero errors
- [ ] Pass: lint — `npm run lint -- src/local/pgvector-store.ts` zero warnings
- [ ] Pass: size — `src/local/pgvector-store.ts` ≤ 1000 LoC (currently ~600; +30 lines)
- [ ] NO existing pgvector-store integration test regresses

#### DoD
- [ ] Atomic commit: pgvector-store changes + integration test together
- [ ] Integration suite green
- [ ] Explain-analyze confirms index usage
- [ ] ADR D6 ON CONFLICT clause empiricamente verified against running pgvector

### T3.3 — Pipeline: route RememberOptions.category → payload (verbatim + LLM extraction paths)

#### Objective
Update `src/core/extraction/pipeline.ts` so `RememberOptions.category` lands in `payload['category']` on both the verbatim (`infer:false`) and LLM-extracted paths. The adapter hoist in T3.2 then promotes it to the column.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does**: Two surgical edits to `pipeline.ts` mirroring the `attributedTo` precedent at line 138-140 — extending the same payload-stuff pattern to the new option.

**Why it is necessary now**: Without this, even if pgvector knows how to hoist category, no caller actually stuffs it into payload. Pipeline is the contract bridge from public API → store.

#### Evidence
- `src/core/extraction/pipeline.ts:138-140` (attributedTo verbatim path — exact pattern)
- `src/core/extraction/pipeline.ts:252` (runExtractionPipeline entry point)

#### Files to edit
```
src/core/extraction/pipeline.ts            — stuff options.category into payload in BOTH paths
src/core/__tests__/extraction-pipeline-category.test.ts (NEW) — RED tests for both paths
```

#### Deep file dependency analysis

- `src/core/extraction/pipeline.ts`: today (Baseline Context row 10) at line 134-140 stuffs `metadata` + `attributedTo` into payload for the `infer:false` path. Adds `if (options?.category !== undefined) payload['category'] = options.category;` AT THE SAME location. Then same edit in the LLM-extraction (`infer:true`) path's `buildPayload`-call site.
- New test asserts category lands in payload for both write paths (mocked vector store records inserts).

#### Deep Dives

- **infer:true path**: LLM extraction returns N facts; each fact's payload is composed from `options.metadata` + `extracted[i].attributed_to`. Category is operator-supplied (per ADR D1), so the SAME `options.category` is propagated to ALL N facts. This is intentional — the operator's category applies to the WRITE batch, not to individual extracted facts (LLM does NOT auto-categorize per fact).

#### Pseudo-code / Signatures

```ts
// src/core/extraction/pipeline.ts — in runInferFalsePath (~line 138 after attributedTo branch):

// EC-2 absorption: SDK boundary validation BEFORE payload stuff. Mirrors the
// asOf NaN check precedent at src/local/index.ts:580 (architecture.md § 8 —
// validate at boundaries). REST already enforces 1-64 via zod min(1).max(64);
// this is defense-in-depth for direct SDK callers (TheoKit agent loops, tests,
// migration scripts) who don't transit REST.
if (options?.category !== undefined) {
  const cat = options.category;
  if (cat.length === 0 || cat.length > 64) {
    throw new InvalidScope('category must be 1-64 chars (got ' + cat.length + ')');
  }
}

if (options?.attributedTo !== undefined) {
  payload['attributed_to'] = options.attributedTo;
}
if (options?.category !== undefined) {
  payload['category'] = options.category;
}

// And same branch in the LLM-extraction path where buildPayload is called per fact.
// The length check fires ONCE at the entry of runExtractionPipeline (before
// either branch dispatch) so the cost is paid once even when LLM extracts N facts.
```

#### Tasks
1. Add EC-2 boundary length check at `runExtractionPipeline` entry (before branch dispatch)
2. Add category propagation to `runInferFalsePath` (after attributedTo line)
3. Add category propagation to LLM-extraction path's per-fact payload composition
4. RED tests for both paths + boundary check

#### TDD
```
RED:     test_pipeline_infer_false_stuffs_category_into_payload() — call runInferFalsePath with options={category:'a'}; mock store records payload.category='a'
RED:     test_pipeline_infer_true_stuffs_category_into_every_extracted_payload() — extracted=[f1,f2]; options={category:'a'}; both payloads have category='a'
RED:     test_pipeline_throws_invalid_scope_when_category_too_long() (EC-2) — options={category:'<65 chars>'}; expect throw InvalidScope('category must be 1-64 chars')
RED:     test_pipeline_throws_invalid_scope_when_category_empty() (EC-2) — options={category:''}; expect throw InvalidScope
RED:     test_pipeline_accepts_64_char_category_exact_boundary() (EC-2) — options={category:'<exactly 64 chars>'}; does NOT throw
GREEN:   Add propagation in both branches + boundary check at pipeline entry
REFACTOR: None expected
VERIFY:  npm test src/core/__tests__/extraction-pipeline-category.test.ts
```

#### Concurrency tests
(none — single-threaded)

Rationale: pure pipeline transformation; no shared mutable state.

#### Acceptance Criteria
- [ ] 5 RED tests pass after GREEN (2 propagation + 3 EC-2 boundary)
- [ ] `npm run typecheck` zero errors
- [ ] No regression in existing pipeline tests (`npm test src/core/__tests__/extraction-pipeline*.test.ts` all green)
- [ ] Pass: size — `src/core/extraction/pipeline.ts` ≤ 500 LoC (currently 467; ~+15 lines for EC-2 + propagation)
- [ ] Pass: lint zero warnings
- [ ] EC-2 verified: SDK-layer 64-char cap enforced via InvalidScope throw at pipeline entry (defense-in-depth alongside REST zod validation)

#### DoD
- [ ] Commit: pipeline + new test together
- [ ] All extraction-pipeline tests green

---

## Phase 4: REST handler + LocalScopedMemory wiring

**Objective:** REST `/v1/scopes/.../memories?category=X` parses + forwards the filter through `LocalScopedMemory.getAll`. Integration test against real pgvector.

### T4.1 — Extend REST QuerySchema + scopesHandler to honor `category`

#### Objective
Add `category` to `QuerySchema` in `src/server/handlers/scopes.ts` with zod validation `z.string().min(1).max(64).optional()` (per ADR D3). Pass through to `scoped.getAll({category})`.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does**: One zod field addition + one threading into the `scoped.getAll()` call (which already exists at line 129).

**Why it is necessary now**: This is the boundary the BFF will call. Without REST honoring the param, BFF Phase 5 has nothing to forward to.

#### Evidence
- `src/server/handlers/scopes.ts:35-38` (QuerySchema today — only cursor + limit)
- `src/server/handlers/scopes.ts:129` (scoped.getAll() call site)

#### Files to edit
```
src/server/handlers/scopes.ts                                          — extend QuerySchema + pass to getAll
src/local/index.ts                                                      — LocalScopedMemory.getAll(opts) forwards opts.category → Filters.category
tests/integration/server/scopes-list-category-filter.test.ts (NEW)     — RED integration test against pgvector
```

#### Deep file dependency analysis

- `src/server/handlers/scopes.ts`: today (Baseline Context row 11) parses `cursor` + `limit`. Add `category: z.string().min(1).max(64).optional()` to QuerySchema. After zod parse, pass `{ category: queryParse.data.category }` to `scoped.getAll()`. EC-13 / EC-14 / EC-15 invariants UNCHANGED.
- `src/local/index.ts`: today (Baseline Context row 9) `LocalScopedMemory.getAll(options?)` at line 797 (already verified) builds Filters from `this.filters` + applies onlySkills/includeSuperseded. Add: `if (options?.category !== undefined) filters.category = options.category;` BEFORE calling `vectorStore.list()`. Existing behavior byte-identical when category undefined.
- New integration test: POST 3 memories with categories `[a, a, b]` then `GET /v1/scopes/user/{id}/memories?category=a` returns 2 items.

#### Deep Dives

- **422 on validation error**: REST handler already returns 422 INVALID_QUERY for zod failures (existing pattern at line 107). Category > 64 chars triggers this path.
- **Empty string boundary**: zod `min(1)` rejects empty string with 422.
- **EC-3 defense-in-depth**: `LocalScopedMemory.getAll` ALSO normalizes empty-string to undefined when threading into Filters, so SDK callers (which bypass REST) get the same semantic as REST callers.
- **EC-7 Cursor interplay**: when both `cursor` and `category` are set, the in-memory cursor predicate filters AFTER category filter (`getAll` returns category-filtered subset; cursor then slices). Cursor encoding does NOT include category (it's a parameter of the query, not part of the resumption state). Resuming a paged query with a DIFFERENT category is a consumer error — REST does not detect it. Honest behavior: results may be empty OR coherent-but-different — NEVER throws. Pinned by `test_cursor_continuation_with_different_category_does_not_throw`.
- **EC-9 NULL findability (DOCUMENT)**: legacy rows with `category=NULL` are NOT findable via the filter. There is no syntax for `?category=NULL` (literal "null" would filter rows where the COLUMN value is the string "null"). Per ADR D1 no implicit default; operators wanting to find uncategorized memories must use the no-filter call (`GET ...?` without `category` param). Documented inline in JSDoc on `RememberOptions.category` AND `GetAllOptions.category`.

#### Pseudo-code / Signatures

```ts
// src/server/handlers/scopes.ts (delta):
const QuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** themory-category-filter-server-side T4.1 — operator filter. ADR D3 ≤ 64 char cap. */
  category: z.string().min(1).max(64).optional(),
});

// ...inside scopesHandler:
const all = await scoped.getAll(
  queryParse.data.category !== undefined ? { category: queryParse.data.category } : undefined
);
```

```ts
// src/local/index.ts (in LocalScopedMemory.getAll ~line 797):
async getAll(options?: GetAllOptions): Promise<readonly MemoryItem[]> {
  const limit = options?.topK ?? 100;
  const filters = applySkillFilters(this.filters, options);
  // EC-3 absorption: empty-string normalizes to no-filter at pipeline boundary,
  // so direct SDK callers see the same semantic as REST callers (zod rejects '').
  if (options?.category !== undefined && options.category !== '') {
    Object.assign(filters, { category: options.category });
  }
  const [results] = await this.config.vectorStore.list(filters, limit);
  // ... existing createdAt projection per T2.2 unchanged ...
}
```

#### Tasks
1. Extend QuerySchema with `category` field + zod validators
2. Pass `{category}` to `scoped.getAll()` when present
3. In `LocalScopedMemory.getAll`, merge `category` into Filters before vectorStore.list
4. RED integration test: write fixture + filter + assert count delta

#### TDD
```
RED:     test_scopes_handler_accepts_category_param() — GET ?category=a → 200 with filtered subset
RED:     test_scopes_handler_rejects_category_too_long() — GET ?category=<65chars> → 422
RED:     test_scopes_handler_rejects_empty_category() — GET ?category= → 422 (min(1))
RED:     test_scopes_handler_empty_state_when_no_match() — GET ?category=does-not-exist → 200 {items:[]}
RED:     test_scopes_handler_no_category_param_returns_all() — GET (no param) → 200 all rows (backward compat)
RED:     test_scopes_handler_category_combined_with_limit_pagination() — limit=2, category=a; returns 2 items with category=a + nextCursor
RED:     test_cursor_continuation_with_different_category_does_not_throw() (EC-7) — page 1 with category=a returns cursor C; subsequent call cursor=C&category=b returns 200 (empty OR coherent subset), NEVER throws
RED:     test_local_scoped_memory_getall_empty_string_category_equiv_undefined() (EC-3 SDK path) — getAll({category:''}) returns SAME rows as getAll() (no-filter)
GREEN:   Extend QuerySchema + thread to getAll + Filters merge + EC-3 normalization at SDK boundary
REFACTOR: None expected
VERIFY:  npm test tests/integration/server/scopes-list-category-filter.test.ts
```

#### Concurrency tests
(none — single-threaded)

Rationale: request lifecycle is single-threaded per Hono handler invocation.

#### Acceptance Criteria
- [ ] 8 RED integration tests pass against real `ankane/pgvector:v0.5.1` (6 originais + EC-3 SDK boundary + EC-7 cursor+filter)
- [ ] Existing `tests/integration/server/scopes-list-*.test.ts` tests pass UNCHANGED (no regression)
- [ ] EC-9 NULL findability documented inline in JSDoc on `RememberOptions.category` + `GetAllOptions.category`
- [ ] `npm run typecheck` zero errors
- [ ] Pass: lint — `npm run lint -- src/server/handlers/scopes.ts src/local/index.ts` zero warnings
- [ ] Pass: size — `src/server/handlers/scopes.ts` ≤ 200 LoC (currently 144; +~10 lines); `src/local/index.ts` ≤ 1600 LoC (currently 1505; +~8 lines)

#### DoD
- [ ] Commit: REST schema + index.ts wiring + integration test together
- [ ] Full TheMemory test suite green: `npm test`
- [ ] Manual sanity: `curl -H "Bearer ..." 'http://localhost:8080/v1/scopes/user/X/memories?category=preferences'` returns filtered subset

### T4.2 — Public API integration sentinel (smoke gate for `RememberOptions.category` propagation)

#### Objective
End-to-end smoke gate: `POST /v1/remember` with `{text, scope, category}` → `GET /v1/scopes/{scope}/{id}/memories?category={X}` returns the new row. Single test against real pgvector + REST.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does**: One integration test that exercises the FULL public surface end-to-end. Validates that the type changes in Phase 1, schema in Phase 2, adapter in Phase 3, and REST in Phase 4 all compose correctly.

**Why it is necessary now**: This is the canonical "wiring triad pillar (b)" per `cycle-implement.md` — integration test against real boundary. Without it, the cycle has unit-passes that may not match real-world behavior.

#### Evidence
- `tests/integration/server/scopes-list-temporal-fidelity.test.ts:1` (T3.1 precedent test from dashboard-memories cycle — same shape)

#### Files to edit
```
tests/integration/server/category-filter-public-api-smoke.test.ts (NEW) — RED smoke gate
```

#### Tasks
1. RED test composes: testcontainers pgvector → runMigrations → boot Hono server → POST /v1/remember with category → GET /v1/scopes/.../memories?category= → assert presence
2. Negative: POST without category; same GET; assert absent
3. GREEN: passes after Phase 4 T4.1 ships
4. REFACTOR: None expected

#### TDD
```
RED:     test_remember_then_list_with_category_returns_the_row() — POST {category:'a'}; GET ?category=a; assert id present
RED:     test_remember_without_category_then_list_with_category_returns_empty() — POST without cat; GET ?category=a; assert empty
GREEN:   Pass after all of Phase 4 ships
VERIFY:  npm test tests/integration/server/category-filter-public-api-smoke.test.ts
```

#### Concurrency tests
(none — single-threaded)

Rationale: single-request smoke flow; no concurrent test execution.

#### Acceptance Criteria
- [ ] 2 RED smoke tests green against real pgvector + Hono server
- [ ] Test runtime ≤ 10s (within CI integration budget)

#### DoD
- [ ] Atomic commit: smoke test alone
- [ ] Green when run in isolation AND as part of full suite

---

## Phase 5: theo-cloud BFF — stop dropping category

**Objective:** BFF forwards `category` param to upstream `/v1/scopes/...` call. Cross-repo work in `theo-cloud/cloud/`.

### T5.1 — BFF Client.List forwards `Category` param to upstream URL

#### Objective
Update `theo-cloud/cloud/internal/themory/client.go` to forward `opts.Category` as `&category=` query param when calling upstream. Remove or update the "Category/From/To are dropped silently" comment.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does**: Two lines in `client.go`: append `if opts.Category != "" { q.Set("category", opts.Category) }` after limit. Update the dropping comment to mention category is now forwarded.

**Why it is necessary now**: Per D4 cross-repo merge order, this lands AFTER theo-memory has the new build deployed. Without the upstream contract changes, this would 422 every request.

#### Evidence
- `theo-cloud/cloud/internal/themory/client.go:150` (current drop comment)
- `theo-cloud/cloud/internal/themory/client.go:144-168` (List function body)
- `theo-cloud/cloud/internal/routes/memory.go:116` (already reads category from dashboard query)

#### Files to edit
```
theo-cloud/cloud/internal/themory/client.go             — forward opts.Category as &category=
theo-cloud/cloud/tests/unit/themory_client_test.go      — new test asserting upstream URL contains category=
```

#### Deep file dependency analysis

- `theo-cloud/cloud/internal/themory/client.go`: today (Baseline Context row 14) at line 144-168 builds the upstream URL. Adds `if opts.Category != "" { q.Set("category", opts.Category) }` AFTER limit. The `MemoryRow.Category` projection at line 185-188 ALREADY reads from `payload["category"]` (mirroring how TheMemory REST handler projects the column back to payload per T3.2 (4)) — no change there.
- Existing BFF unit tests (`TestTheMemoryClient_ListWithScopeRoutesToCorrectPath`, etc.) UNCHANGED. New case appended: `TestTheMemoryClient_ListForwardsCategoryParam`.

#### Pseudo-code / Signatures

```go
// theo-cloud/cloud/internal/themory/client.go (delta in List() ~line 148):
if opts.Limit > 0 {
    q.Set("limit", strconv.Itoa(opts.Limit))
}
// NEW (replaces "dropped silently" comment for category):
if opts.Category != "" {
    q.Set("category", opts.Category)
}
// Comment update: "From/To are dropped silently — upstream lacks these filters. Category is forwarded as of plan themory-category-filter-server-side."
```

#### Tasks
1. Add forwarding clause for `opts.Category`
2. Update the comment to reflect category is now honored
3. Add unit test: ListOptions{Category: "preferences"} → upstream URL contains `category=preferences`
4. Update existing comment lines to scope removal of category from "dropped silently"

#### TDD
```
RED:     TestTheMemoryClient_ListForwardsCategoryParam — ListOptions{Category:"preferences"} → captured upstream URL contains "category=preferences"
RED:     TestTheMemoryClient_ListEmptyCategoryNotForwarded — Category:"" → URL does NOT contain "category="
RED:     TestTheMemoryClient_BFFReadsCategoryFromProjectedPayload (EC-8) — stub upstream returns {items:[{payload:{category:'a'}, category:'a'}]}; assert MemoryRow.Category=='a' (BFF reads from payload pathway; both projections present mirror v1.1 attributed_to precedent)
GREEN:   Add forwarding clause
REFACTOR: None expected
VERIFY:  go test ./cloud/tests/unit/ -run TestTheMemoryClient_List
```

#### Concurrency tests
(none — single-threaded)

Rationale: single-request URL composition; Go's net/url is thread-safe.

#### Acceptance Criteria
- [ ] 3 RED Go tests pass after GREEN (2 forwarding + EC-8 dual-pathway projection)
- [ ] Existing `TestTheMemoryClient_ListWithScopeRoutesToCorrectPath` + `TestTheMemoryClient_RepoScopeDegradesGracefullyOn501` UNCHANGED
- [ ] `go vet ./...` zero warnings
- [ ] `go build ./...` zero errors

#### DoD
- [ ] Commit on theo-cloud `develop` branch (per Unbreakable Rule 4 — NEVER main)
- [ ] Manual sanity: dashboard `/memory/memories?scope=user&category=preferences` against a TheMemory dev DB with mixed categories returns filtered subset

### T5.2 — Dashboard test extends to assert empty-state when filter set + 0 rows returned

#### Objective
Add one test to `theo-cloud/cloud/dashboard/src/pages/memory/memories.test.tsx` asserting that when the BFF returns 0 memories AND category is set, the UI shows the empty-state, NOT a fresh 0-row data grid.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does**: Adds one vitest test using the existing `render` + `mockCloudFetch` precedent. Asserts EmptyState text and absence of DataTable rows.

**Why it is necessary now**: Dashboard already wires the param; we're verifying the UI handles the empty-result case correctly. RED TEAM F3 specifically noted the UI should show empty-state, not the unfiltered full list. This test pins that behavior so a future regression cannot ship.

#### Evidence
- `theo-cloud/cloud/dashboard/src/pages/memory/memories.test.tsx:90-94` (existing empty-state test precedent — same shape)

#### Files to edit
```
theo-cloud/cloud/dashboard/src/pages/memory/memories.test.tsx — one new test
```

#### Tasks
1. Add test: `it('shows empty state when category filter is set and BFF returns zero rows', ...)` using existing render helper + initialEntries

#### TDD
```
RED:     test_dashboard_empty_state_when_category_filter_returns_zero() — initialEntries=['/memory/memories?category=does-not-exist']; mockCloudFetch returns {memories:[]}; assert "No memories match the current filters" rendered
GREEN:   Pass — current memories.tsx EmptyState branch already handles this (`category || from || to` path at line 245-247)
REFACTOR: None expected
VERIFY:  npm test src/pages/memory/memories.test.tsx
```

#### Concurrency tests
(none — single-threaded)

Rationale: single-render React test; vitest serial mode within file.

#### Acceptance Criteria
- [ ] 1 new test passes
- [ ] Existing 8/8 dashboard tests UNCHANGED
- [ ] Pass: lint — `npm run lint -- src/pages/memory/memories.test.tsx` zero warnings

#### DoD
- [ ] Commit on theo-cloud `develop`
- [ ] Full dashboard test suite green: `npm test`

---

## Phase 6: Integration Validation (MANDATORY)

> Runs after Phases 1-5. The plan is NOT done until the full chain passes against a real workload.

### Execution

**theo-memory side**:
```
npm test                                                          # unit + integration green (~70 files; pgvector containers)
npm run typecheck                                                 # zero errors
npm run lint                                                      # zero warnings
npm run test:coverage                                             # ≥ 90% on changed files; 100% on critical paths (extraction, store)
```

**theo-cloud side** (Go BFF + Vitest dashboard):
```
cd theo-cloud/theo && task test                                  # go test ./... + dashboard vitest
cd theo-cloud/theo/cloud/dashboard && npm test                   # vitest run; 8+1 tests
```

**End-to-end smoke (manual, against live dev stack)**:
```
# 1. Rebuild TheMemory + restart server (operational hygiene from RED TEAM F1 lesson)
cd /home/paulo/Projetos/usetheo/theo-memory && npm run build
bash /home/paulo/Projetos/usetheo/theo-cloud/theo/infra/scripts/local/stop-themory.sh
bash /home/paulo/Projetos/usetheo/theo-cloud/theo/infra/scripts/local/start-themory.sh

# 2. Seed mixed-category fixture via SDK or REST POST /v1/remember
#    (3 memories: category='preferences' x2, category='travel' x1, category=null x1)

# 3. Verify REST honors filter:
curl -fsS 'http://localhost:8080/v1/scopes/user/{uid}/memories?category=preferences' \
     -H 'Authorization: Bearer theo_live_*' \
     | jq '.items | length'
#   expect 2

# 4. Verify Dashboard UI:
open 'http://localhost:5173/memory/memories?scope=user&category=preferences'
#   expect 2 rows visible; URL preserves category param
```

### Acceptance Criteria

- [ ] All TheMemory test suites green (unit + integration)
- [ ] All theo-cloud BFF + Dashboard tests green
- [ ] Coverage ≥ 90% on changed files; 100% on `src/local/in-memory-store.ts`, `src/local/pgvector-store.ts`, `src/server/handlers/scopes.ts`
- [ ] Zero type errors (both repos)
- [ ] Zero lint warnings (both repos)
- [ ] Runtime sanity: REST returns filtered subset; Dashboard renders filtered rows; URL deep-link preserves category
- [ ] Migration 0014 idempotent (run twice; no throw; column exists once)
- [ ] EXPLAIN ANALYZE shows index usage on `category` predicate (validated in T3.2)

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing
2. Fix all plan-caused failures before declaring the plan complete
3. Re-run the validation chain to confirm fixes
4. Pre-existing issues are logged but do NOT block plan completion

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `RememberOptions.category?` public API surface | T1.1 | Added with JSDoc + ADR refs; ADR-0008 method cap preserved |
| 2 | `MemoryItem.category?` projection on read | T1.1 + T3.2 + T3.1 | Type field added; adapters project from column / row |
| 3 | `Filters.category?` for internal pipeline boundary | T1.1 | Added in snake_case per architecture.md § 6 |
| 4 | `GetAllOptions.category?` for `getAll(opts)` filter | T1.1 + T4.1 | Added; threaded by LocalScopedMemory.getAll |
| 5 | DB column `category` + btree index | T2.1 | Migration 0014; idempotent |
| 6 | In-memory adapter persists + filters | T3.1 | Row.category + matchesFilters predicate; NULL exclusion |
| 7 | pgvector adapter persists (column hoist) + filters + projects | T3.2 | 4 surgical deltas; integration tested against real PG |
| 8 | Extraction pipeline routes RememberOptions.category → payload | T3.3 | Both `infer:false` and LLM-extracted paths |
| 9 | REST `QuerySchema` accepts `category` param with bounds | T4.1 | zod min(1).max(64).optional() per ADR D3 |
| 10 | REST handler threads category to `scoped.getAll` | T4.1 | One line change in scopesHandler |
| 11 | End-to-end smoke: remember+list public API | T4.2 | Integration test against real pgvector + Hono |
| 12 | BFF Client.List forwards category to upstream URL | T5.1 | One forwarding clause; existing MemoryRow.Category projection preserved |
| 13 | BFF unit test asserts URL contains category= | T5.1 | Go test added |
| 14 | Dashboard test asserts empty-state when filter+0 rows | T5.2 | One vitest test added |
| 15 | Cross-repo merge ordering | T5.1 (BFF dep on TheMemory ship) + ADR D4 | Backend phases land first; T5.1 acceptance explicitly waits for TheMemory deploy |
| 16 | Pre-existing legacy rows stay `category=NULL` | T2.1 (no UPDATE backfill) + T3.2 (NULL filter excludes) | Migration ADD COLUMN only; honest empty-state for any filter on legacy data |
| 17 | Migration idempotency | T2.1 | `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` |
| 18 | Filter index usage at scale | T3.2 acceptance | EXPLAIN ANALYZE confirms btree index scan |
| 19 | Category length bounded at boundary (≤ 64) | T4.1 + ADR D3 | zod max(64) at REST; documented in JSDoc for SDK |
| 20 | RED TEAM F3 unblock (dashboard shows filtered subset OR empty-state) | T1.1 + T2.1 + T3.1 + T3.2 + T3.3 + T4.1 + T4.2 + T5.1 + T5.2 | End-to-end fix verified by Phase 6 smoke + T4.2 sentinel |
| 21 | EC-1 UPSERT collision: category NOT overwritten on conflict | T3.2 + ADR D6 | First-write-wins semantics pinned via integration test `test_pgvector_upsert_does_not_overwrite_category` |
| 22 | EC-2 SDK-layer length cap (1-64 chars) | T3.3 + EC-2 boundary check | InvalidScope throw at pipeline entry; defense-in-depth alongside REST zod validation; 3 RED tests pin boundaries |
| 23 | EC-3 empty-string filter normalization | T3.1 + T3.2 + T4.1 SDK boundary | Normalized to undefined at store layer; in-memory + pgvector + LocalScopedMemory consistent; tests in T3.1 + T3.2 + T4.1 |
| 24 | EC-4 case-sensitive filter (deliberate) | T3.1 + T3.2 | Tests pin byte-equality semantic; documented in ADR D1 |
| 25 | EC-5 Unicode byte-equality (no NFC/NFD normalization) | T3.2 integration test | NFC vs NFD test pins behavior; documented in JSDoc on GetAllOptions.category |
| 26 | EC-6 SQL-injection probe via category | T3.2 integration test | Parameterized query validated empirically; test asserts no SQL error AND no data leak |
| 27 | EC-7 cursor + filter mid-pagination | T4.1 integration test | Honest "consumer error" graceful behavior pinned — never throws; returns empty OR coherent subset |
| 28 | EC-8 BFF dual-pathway read | T5.1 Go test | Mirrors v1.1 attributed_to pattern; payload projection AND top-level field both present |
| 29 | EC-9 NULL findability disclosed honestly | T1.1 JSDoc + T4.1 Deep Dives | Operators know uncategorized rows are NOT filterable; documented inline |
| 30 | EC-12 Dual-pathway projection mirrors attributed_to | T1.1 MemoryItem JSDoc | Architectural symmetry pinned in JSDoc |

**Coverage: 30/30 gaps covered (100%)**

## Global Definition of Done

- [ ] All 6 phases completed (T1.1, T2.1, T3.1, T3.2, T3.3, T4.1, T4.2, T5.1, T5.2)
- [ ] All tests passing — `npm test` green in theo-memory; `task test` green in theo-cloud; `npm test` green in dashboard
- [ ] Zero type errors — `npm run typecheck` in theo-memory; `tsc --noEmit` in dashboard
- [ ] Zero lint warnings — `npm run lint` in theo-memory; `npm run lint` in dashboard; `go vet ./...` in theo-cloud
- [ ] File-size budget respected (per `rules/architecture.md` — no file exceeds 500 LoC; pgvector-store ≤ 1000 LoC explicit waiver inherited from existing file)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6) when the file exists in the repo
- [ ] Backward compatibility preserved — every existing API consumer byte-identical when category is omitted
- [ ] No paper names in code per `.claude/rules/no-paper-names-in-code.md` — all references stay in this plan + blueprints
- [ ] Runtime-metric proof — N/A (this plan introduces no new metric counters)
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND PR merged, move plan to `knowledge-base/plans/completed/themory-category-filter-server-side-plan.md`
- [ ] Migration 0014 included in `dist/local/migrations/` post-build (architecture.md § 10.1 enforcement)
- [ ] **Stale-dist hygiene check** — after final theo-memory commit, run `npm run build && stop-themory.sh && start-themory.sh` so RED TEAM re-run sees fresh bytes (RED TEAM F1 lesson applied)

## Failure scenarios (when I/O external)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| Postgres (pgvector) — `category` column missing at runtime | Adapter receives query without `category` column existing | testcontainers boots pre-migration DB; INSERT into memories | Migration MUST run first; if developer skips it, INSERT throws "column category does not exist" — surfaces to operator clearly (no silent payload demotion) |
| Postgres — index missing on `category` | Sequential scan instead of index scan | Drop index manually; run filter query against >50 rows | Query slows; surfaces via APM observation, NOT functional break. Mitigation: T2.1 creates the index in the migration |
| REST handler — category > 64 chars | Operator sends `?category=<huge>` | Integration test posts a 65-char category | 422 INVALID_QUERY (per ADR D3); error message includes the field name |
| REST handler — empty category param | Operator sends `?category=` | Integration test posts empty string | 422 INVALID_QUERY (zod min(1)); error surfaces honestly |
| BFF — TheMemory upstream pre-deployment (race window per D4) | BFF forwards `category=preferences` while upstream still rejects unknown param | Upstream returns 422 | BFF surfaces 502 MEMORY_UPSTREAM_UNAVAILABLE to dashboard. **Mitigation**: D4 cross-repo merge order — backend lands first |
| Operator passes `category=null` (literal string) | Edge case: filter for the literal string "null" | Integration test | Filter matches rows whose category column is the string "null" (NOT NULL rows). Honest behavior; documented in JSDoc |

## Final Phase: Integration Validation

(See Phase 6 above — same content; this header is required by template structure.)
