# Review: first-class-episodes (M2 / gap G3)

**Date:** 2026-06-22
**Branch:** develop
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-database, domain-api-design
**Findings:** 24 total (BLOCKER: 0, HIGH: 2, MEDIUM: 7, LOW: 8, INFO: 7)
**Verdict:** READY_TO_MERGE

> Hand-consolidated from the 6 agent finding files under `.claude/agents/review-first-class-episodes-2026-06-22/findings/` (the `consolidate_findings.py` aggregator has a known bug that drops finding files — meta-defect logged in M1 backlog; consolidation done manually here per Inquebrável Rule 3).

## BLOCKER findings
None.

## HIGH findings (both FIXED inline — commit `fix(episodes): close /review HIGH+MEDIUM inline`)

### F-tests-1 / F-xval-1 — façade unit test missing (T2.2 declared but not created)
- Found by: tests, cross-validation
- The plan's T2.2 declared `scoped-memory-episodes.test.ts`; the façade (`episodes()` asOf-NaN guard, nextCursor/hasMore, composeFilters isolation) shipped unit-untested.
- **FIXED:** added `packages/core/src/infrastructure/db/scoped-memory-episodes.test.ts` (4 tests, against real InMemoryVectorStore, in the always-on contract suite). 4/4 green.

### F-tests-2 / F-dom-db-7 — cursor not deterministically exercised (same-ms + only DESC+after)
- Found by: tests, domain-database
- The same-`created_at` id-tiebreak boundary + the ASC/before cursor combinations had no deterministic coverage.
- **FIXED:** added GOAL cases 8 (identical `created_at` via direct SQL → id-tiebreak no-gap/no-overlap) + 9 (all 4 combos asc|desc × after|before). **This uncovered a REAL BUG:**
  - **BUGFIX (pgvector listEpisodes cursor):** the cursor was INCLUSIVE for `ASC+after`. Root cause: the `created_at` column is timestamptz (microsecond) but the cursor carries a JS-Date/ISO millisecond value (the `pg` driver truncates timestamptz→Date at ms), so `col_µs > cursor_ms` matched the boundary row itself. DESC accidentally worked (`<` excluded it); ASC leaked it back in. Fixed by comparing AND ordering on `date_trunc('milliseconds', created_at)` so the column and the cursor share one granularity, with the unique `id` as the intra-ms tie-break. GOAL now 9/9 incl. all 4 combos + same-ms.

## MEDIUM findings

| ID | Found by | Summary | Disposition |
|---|---|---|---|
| F-arch-1 | architecture | VectorStore JSDoc ADR-0008 count stale (11) | **FIXED** → "13 required" |
| F-tests-4 | tests | handler 200 test didn't assert wire-shape | **FIXED** — asserts snake_case `created_at`/`scope_type` |
| F-tests-3 | tests | `before` cursor had no positive test | **FIXED** by GOAL case 9 (before in both orders) |
| F-tests-5 | tests | façade asOf-NaN guard unreached | **FIXED** by F-tests-1 façade unit |
| F-wire-1 | wiring | REST→façade→**real-pg** seam not integration-tested (GOAL uses SDK path; handler uses stub) | **ACCEPTED (follow-up)** — both sides tested in isolation (handler 7 vs stub; SDK→pg GOAL 9); the handler↔façade mapping is a thin option-passthrough. Documented follow-up `episodes-rest-real-pg-integration`. |
| F-dom-db-5 | domain-database | unscoped `listEpisodes(undefined,…)` would seq-scan+sort | **ACCEPTED** — the façade ALWAYS supplies scope filters (reachable path bounded by `memories_session_id_idx`); optional partial composite index is a documented follow-up. |
| F-dom-api-3 | domain-api-design | DTO drops `tValid`/`tInvalid`/`attributedTo`/`hash` | **ACCEPTED (follow-up)** — adequate for a v1 feed; surfacing the validity window for `asOf` disambiguation is a documented enhancement. |

## LOW / INFO (selected)
- F-arch-2 / F-tests-6 — stale test names → **FIXED** ("13 methods"; "literal-substring (no wildcard)").
- F-arch-4 — in-memory sort duplicated comparator → **FIXED** (reuses `compareCreatedAtId`, DRY).
- F-arch-3 — `in-memory-store.ts` crossed 500 LoC (479→~560) → **ACCEPTED** (test/dev fixture adapter; recorded as honest debt alongside `pgvector-store-split` per ADR D7 rationale).
- F-dom-api-2 — 422 (episodes) vs 400 (legacy `.../memories`) for bad cursor → **ACCEPTED** — deliberate per ADR D6 (aligns with the 4-verb asOf→422 precedent; retro-changing the legacy endpoint would be breaking). Honest disclosure: a consumer hitting both sees the divergence.
- F-wire-2 / F-dom-api-3 — `EpisodePage.prevCursor` reserved/forward-only v1 → **ACCEPTED** (EC-7 YAGNI).
- F-tests-7 — "malformed base64" cursor test path lenient → **ACCEPTED** (the other two decode-failure cases — bad date, missing id — do exercise the throw → 422).
- F-dom-db-6 — pgvector compares `id` as uuid, in-memory as JS string → **ACCEPTED** (agree for canonical lowercase UUIDs = production path).
- Numerous INFO confirmations: DIP boundary clean (I/O-free domain), EC-1 mutual-exclusivity structurally guaranteed via shared `composeTemporalWhere`, SQL fully parameterized, param-index accounting correct, workspace isolation present (`workspaceBoundMemory`), auth + rate-limit inherited via `/v1/scopes/*` middleware, no migration (D1), no paper names.

## Cross-validation summary
- Plan tasks: 6. Fully implemented: 6 (T2.2 façade gap closed in fix commit). Partially: 0. Missing: 0. Diverged: 2 documented improvements (episodes signature has no scope param — matches the existing 4-verb pattern; DIP returns rows not EpisodePage — nextCursor computed in façade; types in `episode.ts` not `options.ts`). ADRs D1-D7 all honored. Coverage Matrix 13/13.

## Quality gates summary
- `npm run typecheck`: PASS (0 errors)
- `npm run lint`: PASS (0 warnings)
- Contract suite (core+mcp): PASS — 1083 passed, 2 skipped
- API suite: PASS — 212 passed
- Integration vs real `ankane/pgvector:v0.5.1`: PASS — episodes GOAL 9/9 + regression 49/49
- `/code-quality`: PASS 100 (0 dead code, 0 fabricated symbols, 0 orphan exports)

## Spawned agents (audit trail)
- .claude/agents/review-first-class-episodes-2026-06-22/architecture.md (+ findings/architecture.yaml)
- .claude/agents/review-first-class-episodes-2026-06-22/tests.md (+ findings/tests.yaml)
- .claude/agents/review-first-class-episodes-2026-06-22/wiring.md (+ findings/wiring.yaml)
- .claude/agents/review-first-class-episodes-2026-06-22/cross-validation.md (+ findings/cross-validation.yaml)
- .claude/agents/review-first-class-episodes-2026-06-22/domain-database.md (+ findings/domain-database.yaml)
- .claude/agents/review-first-class-episodes-2026-06-22/domain-api-design.md (+ findings/domain-api-design.yaml)

## Handoff decision
**READY_TO_MERGE.** 0 BLOCKER. Both HIGH fixed inline (one uncovered + fixed a real ASC-cursor precision bug). All actionable MEDIUMs fixed; the 3 accepted MEDIUMs are documented follow-ups with rationale (no plan-DoD gap). The slice is fully wired (triad holds), faithfully implements the plan (13/13 coverage, ADRs D1-D7 honored), and all gates are green against real pgvector.
