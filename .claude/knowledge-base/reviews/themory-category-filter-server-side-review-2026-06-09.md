# Review: themory-category-filter-server-side

**Date:** 2026-06-09
**Reviewers (spawned agents):** 7 (architecture, tests, wiring, cross-validation, domain-memory-layer, domain-pgvector-schema, domain-db-migrations)
**Plan version:** v1.2 (SHIPPABLE_WITH_CAVEATS 70.0 at `/plan-confidence`)
**Commits audited:**
- theo-memory: `50a67cf`, `4392e5f`, `2634a82`, `44830c2`, `543e9c0`, `8792e2c`, `e5e1ba7`, `3181a67` (8 commits) + audit-trail `d06f271` (code-quality) + per-phase mini-reviews
- theo-cloud: `627f4ef9` (T5.1 BFF Go), `1cdc6005` (T5.2 Dashboard test)

**Findings aggregate:** 0 BLOCKER · 0 HIGH · 1 MEDIUM (pre-existing debt) · ~8 LOW · ~50 INFO

**Verdict:** READY_TO_MERGE_WITH_CAVEATS

(Manual consolidation — `consolidate_findings.py` returned 0 due to YAML-schema mismatch between agent output shape and parser expectation; raw YAMLs at `.claude/agents/review-themory-category-filter-server-side-2026-06-09/findings/*.yaml` remain the source of truth. Each agent's verbatim verdict + inline summary was preserved below.)

## Per-agent verdicts

| Agent | Verdict | Critical absorption verified |
|---|---|---|
| architecture | PASS_NO_BLOCKERS | ADR D6 UPSERT discipline ✓, DIP boundary clean, ADR-0008 cap honored, zero paper-name additions |
| tests | PASS_WITH_LOW_RECOMMENDATIONS | 39 RED→GREEN tests across 7 files; pyramid balanced (15 unit + 24 integration); EC-1..EC-12 all covered |
| wiring | WIRING_TRIAD_HONEST_PASS | 13/13 symbols pillar (a) functional callers; 13/13 pillar (b) integration tests; (c) n/a per plan |
| cross-validation | READY_TO_MERGE_WITH_CAVEATS | 30/30 Coverage Matrix rows resolved; 6/6 ADRs honored; plan drift = none |
| domain-memory-layer | PASS_WITH_CAVEATS | 8-phase write + 9-step retrieval preserved; ADD-only honored; Princípios 1+2+3 honored; **1 MEDIUM pre-existing debt** |
| domain-pgvector-schema | READY_TO_MERGE | Migration 0014 idempotent; ON CONFLICT DO UPDATE category-excluded verified line-by-line; btree appropriate; EC-6 SQL-injection probe PASS |
| domain-db-migrations | PASS | 0014_*.sql idempotent; journal idx=14 ascending; column + index empirically verified on live `themem_pgvector` container |

## MEDIUM finding (1 — pre-existing debt, NOT introduced by this cycle)

### F-dom-mem-1: `LocalScopedMemory.getAll` does NOT project top-level `MemoryItem.category` field

- **Severity:** MEDIUM
- **Found by:** domain-memory-layer
- **File:** `src/local/index.ts:825-845` (the `getAll` map function)
- **Plan reference:** T4.1 + EC-12 (dual-pathway projection)
- **Observation:** The `MemoryItem` mapper at `src/local/index.ts:825-835` projects `metadata: { ...r.payload }` (which carries `category` via the EC-12 payload-pathway), but does NOT explicitly set top-level `item.category`. Consumers reading `item.category` (the top-level field added in T1.1) on results from `getAll` will see `undefined` even when the underlying row has a category in payload.
- **Pre-existing scope (NOT a regression introduced by this cycle):** The IDENTICAL gap exists for the v1.1 `attributedTo` precedent — `getAll` at the same location ALSO doesn't project top-level `attributedTo`. This is a pre-existing pattern that this plan correctly mirrored.
- **Impact:** Mitigated — consumers reading via `item.metadata.category` (EC-12 dual-pathway) get the value; only the top-level field is empty at this specific code path. REST consumers reach via `pgvector-store.rowToResult` which DOES project both top-level + payload (T3.2 verified).
- **Recommended action:** Lift the projection at `src/local/index.ts:825-845` to project `category` (and the v1.1 `attributedTo`) at the top-level field. Track as a separate hygiene cycle — does NOT block merge.

## LOW findings (~8 — non-blocking nits)

| ID | Agent | File | Action |
|---|---|---|---|
| F-arch-17 | architecture | `src/core/extraction/pipeline.ts` (497/500 LoC) | Observation — track for future EC absorption split |
| F-tests-1 | tests | `tests/integration/server/scopes-list-category-filter.test.ts` EC-7 | Add `expect(cursor).toBeDefined()` precondition |
| F-tests-2 | tests | `tests/integration/pgvector-store-category.test.ts` § 5 | Documented inline — index proven QUERYABLE, not chosen under realistic workload (60-row corpus) |
| F-tests-3 | tests | scopes-list-category-filter test | 6× `eslint-disable no-unsafe-*` (inherits sibling precedent) |
| F-tests-4 | tests | options.test.ts | Double-assertion (`expectTypeOf` + regex) — documented self-defense |
| F-tests-5 | tests | migration-0014.test.ts | Missing `beforeEach(TRUNCATE)` — order-fragile under parallel vitest |
| F-tests-6 | tests | smoke test | `?.id === ?.id` undefined-equality theoretical edge, mitigated by `.toHaveLength(1)` |
| F-dom-pg-1 | domain-pgvector | `pgvector-store.ts:573-616` `update()` | Latent — `update()` lacks `category` hoist (no production caller; conformance test only). Mirror the same fix as the v1.1 attributedTo precedent in a follow-up. |
| F-dom-pg-2 | domain-pgvector | `0014_snapshot.json` absent | Pre-existing pattern (0011 and 0013 also lack snapshots). Document or backfill all 3 together. |

## Edge-case coverage report (per plan v1.2 § EC absorption)

| EC | Description | Test pin | Status |
|---|---|---|---|
| EC-1 | UPSERT collision: category NOT overwritten | `tests/integration/pgvector-store-category.test.ts:test_pgvector_upsert_does_not_overwrite_category` (T3.2) | ✓ COVERED |
| EC-2 | SDK 1-64 char boundary | `src/core/__tests__/extraction-pipeline-category.test.ts` (3 tests: 0, 65, exact-64) (T3.3) | ✓ COVERED |
| EC-3 | Empty-string filter normalization (3 layers) | in-memory + pgvector + LocalScopedMemory.getAll all pinned (T3.1 + T3.2 + T4.1) | ✓ COVERED |
| EC-4 | Case-sensitive byte equality | `pgvector-store-category.test.ts § 8` + `in-memory-store-category.test.ts § 6` | ✓ COVERED |
| EC-5 | Unicode NFC vs NFD distinct | `pgvector-store-category.test.ts § 9` | ✓ COVERED |
| EC-6 | SQL injection probe | `pgvector-store-category.test.ts § 10` (parameterized binding verified) | ✓ COVERED |
| EC-7 | Cursor + changed category mid-pagination graceful | `scopes-list-category-filter.test.ts § 7` | ✓ COVERED |
| EC-8 | BFF dual-pathway read | cross-repo `theo-cloud/cloud/tests/unit/themory_client_test.go:TestTheMemoryClient_BFFReadsCategoryFromProjectedPayload` (T5.1) | ✓ COVERED |
| EC-9 | NULL findability honest disclosure | JSDoc on `RememberOptions.category` + `GetAllOptions.category` (T1.1) + smoke gate test (T4.2) | ✓ COVERED |
| EC-12 | Dual-pathway projection (top-level + payload) | `pgvector-store-category.test.ts § 1` + Go `TestTheMemoryClient_BFFReadsCategoryFromProjectedPayload` | ✓ COVERED |

**Coverage: 10/10 in-scope EC items.**

## Cross-validation summary (cross-validation agent)

| Plan task | Implementing commit | AC met? | DoD met? | Diverged? |
|---|---|---|---|---|
| T1.1 | `50a67cf` | ✓ | ✓ | — |
| T2.1 | `4392e5f` | ✓ | ✓ | — |
| T3.1 | `2634a82` | ✓ | ✓ | — |
| T3.2 | `44830c2` | ✓ | ✓ | — |
| T3.3 | `543e9c0` | ✓ | ✓ | — |
| T4.1 | `8792e2c` | ✓ | ✓ | — |
| T4.2 | `e5e1ba7` | ✓ | ✓ | — |
| T5.1 | theo-cloud `627f4ef9` | ✓ | ✓ | — (ADR D4 verified: theo-memory rebuilt + restarted at 13:30:29; T5.1 at 13:33:55 +3m26s after) |
| T5.2 | theo-cloud `1cdc6005` | ✓ | ✓ | — |

Coverage Matrix: 30/30 rows resolved.

## ADR compliance

- **ADR D1** (operator-supplied, NOT LLM-inferred) — `grep "category" src/core/extraction/prompt.ts` returns ZERO hits. ✓
- **ADR D2** (top-level column + btree, mirrors v1.1 attributed_to) — schema.ts:95 + 158 + migration 0014 verified. ✓
- **ADR D3** (1-64 char cap at REST AND SDK) — REST: `scopes.ts:45` + `schemas.ts:60` both `min(1).max(64)`. SDK: `pipeline.ts:268-280` throws InvalidScope. ✓
- **ADR D4** (cross-repo merge order) — TheMemory rebuilt + restarted at 13:30:29; theo-cloud T5.1 committed at 13:33:55 (3m26s delta). ✓
- **ADR D5** (in-memory mirrors pgvector NULL semantics) — both adapters tested for the same NULL-exclusion + empty-string normalization behavior. ✓
- **ADR D6** (UPSERT first-write-wins; ADD-only spirit) — `pgvector-store.ts:411-413` ON CONFLICT clause contains ONLY `confirmation_count = … + 1`; category INTENTIONALLY omitted from SET. Empirical pin via `test_pgvector_upsert_does_not_overwrite_category`. ✓

## Quality gates summary

| Gate | Status |
|---|---|
| npm test (full suite) | PASS |
| npm run typecheck | PASS (zero errors) |
| npm run lint | PASS (zero warnings on changed files) |
| coverage | SKIP (no `test:coverage` script in package.json — pre-existing project state) |
| wiring triad pillar (a) | 4/4 functional callers + 9/9 transitive ✓ |
| wiring triad pillar (b) | 39/39 integration/unit tests ✓ |
| wiring triad pillar (c) | n/a (plan declared no new metrics) |
| /code-quality verdict | PASS_WITH_CAVEATS 89 (hard cap on pre-existing `@modelcontextprotocol/sdk/*` subpaths, NOT this cycle) |
| Edge-case absorption | 10/10 |
| Coverage Matrix | 30/30 |

## Pre-existing non-regressions (filtered out per /review prompt — do NOT count against this cycle)

- 10/21 failures in `tests/integration/pgvector-store.test.ts` (1536-dim VEC_A vs 384-dim schema mismatch) — pre-existing, confirmed via git-stash baseline at /implement startup.
- `/code-quality` hard cap on `@modelcontextprotocol/sdk/*` nested subpath imports — pre-existing, allowlisted with sunset 2026-08-28.
- 12 unrelated dirty-tree files stashed at /implement startup (`stash@{0}` 2026-06-09 pre-implement themory-category-filter snapshot) + 1 secondary stash (`stash@{1}` dogfood degradation logs).

## Spawned agents (audit trail)

- `.claude/agents/review-themory-category-filter-server-side-2026-06-09/architecture.md`
- `.claude/agents/review-themory-category-filter-server-side-2026-06-09/tests.md`
- `.claude/agents/review-themory-category-filter-server-side-2026-06-09/wiring.md`
- `.claude/agents/review-themory-category-filter-server-side-2026-06-09/cross-validation.md`
- `.claude/agents/review-themory-category-filter-server-side-2026-06-09/domain-memory-layer.md`
- `.claude/agents/review-themory-category-filter-server-side-2026-06-09/domain-pgvector-schema.md`
- `.claude/agents/review-themory-category-filter-server-side-2026-06-09/domain-db-migrations.md`
- `.claude/agents/review-themory-category-filter-server-side-2026-06-09/findings/*.yaml` (7 raw YAMLs)

## Handoff decision

**READY_TO_MERGE_WITH_CAVEATS** per `cycle-review.md § Verdicts`:

- Zero BLOCKER (no HALT condition fires)
- Zero HIGH (well under the ≤ 2 HIGH cap)
- 1 MEDIUM is **PRE-EXISTING DEBT not introduced by this cycle** (F-dom-mem-1 — same pattern exists for v1.1 attributedTo; tracked for separate hygiene follow-up)
- ~8 LOW + ~50 INFO are nits non-blocking

Next per `cycle-release.md`: `/release` opens a develop→main PR with auto-derived semver bump (likely MINOR — `Added` section). Human approves merge per Unbreakable Rule 4. On merge, the post-merge phase runs (no roadmap checkbox flip since plan does not declare `milestone_id`).

Caveats to mention in the PR description:
1. F-dom-mem-1 follow-up — `LocalScopedMemory.getAll` does not project top-level `category` (mirrors pre-existing `attributedTo` gap; separate hygiene cycle).
2. F-dom-pg-1 follow-up — `PgvectorStore.update()` lacks category hoist (latent; no production caller).
3. F-dom-pg-2 — backfill missing `0014_snapshot.json` (consistent with pre-existing pattern; cosmetic).
4. F-tests-5 — add `beforeEach(TRUNCATE)` to migration-0014 test for parallel-mode safety.
5. Pre-existing dirty-tree stash@{0} + stash@{1} remain for operator recovery.
