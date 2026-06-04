# Review: semantic-recall-cache-v1-5

**Date:** 2026-06-03
**Plan:** `.claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md` v1.1
**Branch:** `develop` (commits since `main`: 4332382, 1b275c3, d1664ec, 8e3f815, b0778db, 05a0321)
**Reviewers (spawned agents):** 7
**Implement-validate snapshot:** `.claude/knowledge-base/reviews/semantic-recall-cache-v1-5-implement-validate-2026-06-03.md` (PASS_WITH_HONEST_CAVEAT — ralph-loop direct, no formal /implement SEPA artifacts)
**Verdict:** **READY_TO_MERGE_WITH_CAVEATS**

---

## Severity matrix (consolidated, deduplicated)

| Severity | Count | Trigger |
|---|---|---|
| BLOCKER | 0 | — |
| CRITICAL | 0 | (tests reviewer flagged 2 CRITICAL on T2.2 test-coverage gaps; consolidated as MAJOR because behavior IS implemented + verified by code reading — gap is in regression-guard tests, not implementation. See F-test-gap-* below.) |
| MAJOR | 10 | listed below |
| MINOR | 14 | itemized in agent YAML files |
| INFO | 23+ | per-file "no issues" + positive controls |

**Total findings raw:** ~60 across 7 agents (deduplicated to ~47 unique).

---

## MAJOR findings (surface to human — accept WITH_CAVEATS in PR OR address)

### F-merge-1 — Paper names ("embedchain", "LangChain") in src/core/dip JSDoc

- **Severity:** MAJOR
- **Source agents:** architecture (F-arch-1)
- **File:** `src/core/dip/recall-cache-store.ts:15-19, 38`
- **Plan ref:** `.claude/rules/no-paper-names-in-code.md` (LOCKED 2026-05-30 as first-class project rule)
- **Evidence:** 5 JSDoc references — `"embedchain (similarity_threshold=0.8)"`, `"LangChain (distance_threshold=0.2 ≈ similarity 0.8)"`, `"LangChain's known calibration failure at distance 0.3"`, `"empirical consumer-pairing from embedchain gptcache_data_manager"`, `"@see Q4 embedchain (similarity_threshold=0.8)"`.
- **Recommended action:** Rewrite JSDoc to neutral wording — describe BEHAVIOR ("convergent across two independent canonical libraries") with `@see` pointer to the blueprint. Cheap follow-up commit.

### F-merge-2 — `ScopeTierTtlConfig.repo` tier is in the DIP contract but unreachable in v1.5.0

- **Severity:** MAJOR
- **Source agents:** architecture (F-arch-2), domain-memory-layer (F-dom-memory-1)
- **Files:** `src/core/dip/recall-cache-store.ts` (declares `repo` REQUIRED); `src/local/index.ts:680-697` (`LocalMemory.skills(repoId)` returns `LocalScopedSkillMemory` which does NOT thread the cache store); `src/local/scoped-skill-memory.ts` (no `recall()` cache consultation)
- **Evidence:** Cache is wired into `LocalScopedMemory.recall()` but `LocalScopedSkillMemory.recall()` runs the full 9-step pipeline regardless of cache configuration. The `repo`-tier TTL declared by the consumer in `ScopeTierTtlConfig` has no observable effect.
- **Recommended action:** Either (a) close the wiring (extend `LocalScopedSkillMemory` to consult the cache; mirror the `LocalScopedMemory.recall` wrap shape including ADR D8 BYPASS for `asOf`/`attributedTo`), OR (b) document an honest deferral in CHANGELOG mirroring v1.1 EC-9 skill-scope `asOf` precedent.

### F-merge-3 — `LocalScopedMemory.reflect()` invalidation hook has ZERO test coverage

- **Severity:** MAJOR
- **Source agents:** tests (F-tests-1 — CRITICAL), wiring (F-wire-2), domain-memory-layer (F-dom-memory-2)
- **File:** `src/local/index.ts` `LocalScopedMemory.reflect()` post-success block (the hook IS present per code reading)
- **Plan ref:** T2.2-RED-6 + T2.2-RED-7 (EC-6 absorption)
- **Evidence:** Zero `reflect()` invocations in any cache test file. Item 19 AC#3 inline guard at `tests/integration/cache/semantic-recall-cache.test.ts` only exercises the `remember()` write path.
- **Recommended action:** Add integration test in `tests/integration/cache/factory-wiring.test.ts` OR `cache-invalidation.test.ts`: pre-warm cache → call `reflect()` with `ManualReflectionPolicy` + a seed of ≥ 2 source memories so `persisted.length > 0` triggers the hook → assert cache row count = 0 → next recall returns FRESH.

### F-merge-4 — `LocalMemory.forget()` invalidation hook lacks integration test (unit-only via FakeCache)

- **Severity:** MAJOR
- **Source agents:** tests (F-tests-2 — CRITICAL), wiring (F-wire-1), domain-memory-layer (F-dom-memory-2)
- **File:** `src/local/index.ts` `LocalMemory.forget()` (EC-10 `deriveScopeFromPayload` + targeted invalidateScope is present per code reading)
- **Plan ref:** T2.2-RED-8 + T2.2-RED-9 (EC-10 absorption)
- **Evidence:** Existing `factory-recall-cache.test.ts` covers `remember()` invocation only; no test exercises the forget path against a real cache row + asserts the post-forget cache state.
- **Recommended action:** Add integration test: write a memory via `remember()` → pre-warm cache via `recall()` → call `forget(memoryId)` → assert cache row count for that scope = 0. Bonus: verify EC-10 scope-derivation — write under `user:alice` AND `session:S1`; forget the session-scoped memory; only `session:S1` cache is invalidated.

### F-merge-5 — EC-11 sequential-await ORDER not asserted (only the CALL is)

- **Severity:** MAJOR
- **Source agents:** tests (F-tests-4)
- **File:** `src/local/__tests__/factory-recall-cache.test.ts:166-176` (T2.2-RED-1)
- **Plan ref:** T2.2-RED-10 (EC-11 absorption — "remember() awaits invalidateScope before returning; sequential discipline")
- **Evidence:** Existing test asserts `invalidateCalls.toContainEqual(scope)` — does NOT lock the awaiting discipline. A fire-and-forget regression (e.g., dropping `await` on the hook) would still PASS the existing assertion.
- **Recommended action:** Add a test that pre-warms the cache, calls `await memory.user('alice').remember(...)`, then IMMEDIATELY (no `await tick()`) calls `cache.get(...)` and asserts it returns `undefined`. Fail mode if the hook is fire-and-forget: the cache row would still be present synchronously.

### F-merge-6 — T5.1 stderr regression smoke diverges from EC-14 stderr-spy convention

- **Severity:** MAJOR
- **Source agents:** tests (F-tests-5)
- **File:** `tests/integration/cache/semantic-recall-cache.test.ts` (the third sibling smoke)
- **Plan ref:** T2.3 § Testing note (EC-14 DOCUMENT — install `vi.spyOn(process.stderr, 'write')` per cycle-1 T2.2 precedent at `embedder-cache-gate-warning.test.ts`)
- **Evidence:** T5.1 smoke uses raw `process.stderr.write = ((chunk) => ...)` override + try/finally restoration instead of `vi.spyOn().mockImplementation()` + `vi.restoreAllMocks()`. Works, but breaks the convention claimed in plan T2.3.
- **Recommended action:** Refactor to `vi.spyOn(process.stderr, 'write').mockImplementation((): true => true)` matching the canonical pattern. Cleanup commit.

### F-merge-7 — EC-10 fallback diverged from plan AC

- **Severity:** MAJOR
- **Source agents:** cross-validation (F-xval-6)
- **File:** `src/local/index.ts` `LocalMemory.forget()` post-success block
- **Plan ref:** Plan v1.1 T2.2 § Acceptance Criteria EC-10: "fallback to `invalidateAll()` if not found"
- **Evidence:** Implementation chose `if (scopeFromMemory !== undefined) { invalidateScope }` — when the scope is NOT discoverable, the cache is left alone (documented in JSDoc + commit msg as "cache continues serving until TTL — bounded staleness"). Plan literal says fall back to a global sweep.
- **Recommended action:** Either (a) implement `invalidateAll()` (a 4th method outside ADR-0008 cap — NOT recommended), OR (b) amend plan v1.2 to align the AC with the shipped no-op + TTL behavior (Inquebrável Rule 3 — match plan to reality, not the other way around). The current behavior is DEFENSIBLE (eviction by TTL is acceptable for an unknown-scope edge case) but the plan-vs-code divergence MUST be reconciled.

### F-merge-8 — `deriveScopeFromPayload` cannot distinguish RepoScope from AgentScope rows

- **Severity:** MAJOR
- **Source agents:** domain-memory-layer (F-dom-memory-3)
- **File:** `src/local/index.ts` `deriveScopeFromPayload()`
- **Evidence:** Both `RepoScope` (skill rows) and `AgentScope` persist under `agent_id` column per ADR-0010 EC-4 (`filtersFromScope` line ~218). When forget()ting a skill row, `deriveScopeFromPayload` returns `{ kind: 'agent', agentId }` instead of `{ kind: 'repo', repoId }` — wrong scope_key derivation.
- **Mitigated by F-merge-2:** dormant in v1.5.0 because LocalScopedSkillMemory does NOT consult cache; becomes silently wrong the moment skill-scope cache wiring lands.
- **Recommended action:** Read `payload['kind']` first; when `'skill'`, return `{ kind: 'repo', repoId: agentId as string }`. Bundle with F-merge-2 fix.

### F-merge-9 — Internal JSDoc contradiction in `GET_SQL` constant about NaN semantics

- **Severity:** MAJOR
- **Source agents:** domain-pgvector-schema (F-dom-pgvector-1)
- **File:** `src/local/recall-cache/pgvector-recall-cache-store.ts` lines 22-27 (file JSDoc) vs lines 65-68 (GET_SQL JSDoc)
- **Evidence:** File JSDoc correctly states PG NaN > all values (so SQL `>=` does NOT exclude NaN; `isZeroNorm()` guard is load-bearing). GET_SQL constant JSDoc carries the pre-absorption WRONG claim that "`(1 - NaN) >= 0.8` evaluates false". A future maintainer reading only the SQL JSDoc could delete the `isZeroNorm()` guard "because the SQL filters it" — silently reintroducing the EC-8 cache-poisoning bug.
- **Recommended action:** Update GET_SQL JSDoc to mirror the file-level rationale (PG NaN > x is TRUE) + explicitly cite the `isZeroNorm()` guard as the canonical EC-8 absorption.

### F-merge-10 — `applyDimChange` post-ALTER canary does NOT probe `recall_cache.query_embedding`

- **Severity:** MAJOR
- **Source agents:** domain-pgvector-schema (F-dom-pgvector-2), domain-db-migrations (F-dom-dbmig-2)
- **File:** `src/local/index.ts` `applyDimChange()` lines ~1335-1350 (canary block); cascade extension ~1290-1308
- **Evidence:** Canary probes `c.relname IN ('memories', 'entities')` only. The T5.1 cascade now ALTERs `recall_cache.query_embedding` inside the same BEGIN/COMMIT but is excluded from the value-based canary. If the `DO $$ EXISTS` block silently no-ops (e.g., race with another connection that just dropped the table) the canary would NOT catch a recall_cache dim divergence.
- **Recommended action:** Extend the canary WHERE clause to `c.relname IN ('memories', 'entities', 'recall_cache')` AND make the absence of a `recall_cache` row NOT fail (the table may not exist on pre-v1.5 DBs by design). Mirror the same defensive `DO $$ IF EXISTS` pattern in the verification.

---

## MINOR findings (log; merge can proceed)

Itemized in the per-agent YAML files. Summary:

| ID | Category | Description |
|---|---|---|
| F-arch-3 + F-dom-memory-4 | DRY | `resolveCacheTtl()` re-declares `DEFAULT_TTL_SECONDS_BY_SCOPE_TIER` inline at `src/local/index.ts:340` instead of importing |
| F-arch-4 | Hygiene | `performance.now()` used without `import { performance } from 'node:perf_hooks'` (architecture.md § 7 node: prefix rule) |
| F-arch-5 | Readability | Redundant `if (!cacheApplicable \|\| cache === undefined)` at recall() — TS narrowing leakage |
| F-wire-3 | Coverage | applyDimChange cascade only indirectly exercised via T5.1 (no direct `dim-change.test.ts` extension) |
| F-wire-4 | Coverage | cache-pg subpath lacks published-package resolution smoke (first-party imports use src/ path) |
| F-wire-5 | Coverage | `deriveScopeFromPayload` `undefined` return branch untested |
| F-xval-1 | Naming drift | Plan uses `skill` literal in `ScopeTierTtlConfig` text; impl uses `repo` (semantically correct per ADR-0010) |
| F-xval-2 | Coverage | EC-9/EC-11/T2.2-RED-3/6/7 covered structurally not via explicit named regression tests |
| F-xval-3, 4, 7 | Cosmetic | File/field-name drifts from plan but semantically equivalent |
| F-xval-5 | Coverage | EC-9 MVCC concurrent get during clearExpired not explicitly asserted |
| F-dom-memory-5 | Determinism | `DELETE_OLDEST_SQL` `ORDER BY created_at ASC` has no tiebreaker — under same-microsecond burst inserts (the EC-7 race), eviction order is non-deterministic. Recommend `ORDER BY created_at ASC, id ASC` |
| F-dom-pgvector-3 | Comment hygiene | Migration claims "HNSW partial index" but no WHERE predicate (it's a regular HNSW); also name contains "scope" but indexes `query_embedding` |
| F-dom-pgvector-4 + F-dom-dbmig-1 | Implicit defaults | HNSW comment says `m=16, ef_construction=64` but SQL has no `WITH (...)` clause; relies on pgvector v0.5.1 defaults. Functionally identical but silent on future pgvector default drift |
| F-dom-pgvector-5 | Dead schema | `hit_count` column declared but never written or read; either drop or document for future LFU use |
| F-dom-pgvector-6 | Terminology | Eviction is FIFO (`ORDER BY created_at`) but called "LRU" throughout. True LRU would require `last_accessed_at` updates on `get()`. Either rename to "FIFO eviction" OR add the `last_accessed_at` UPDATE on hit path |
| F-dom-pgvector-7 | Duplicate rows | No `UNIQUE (scope_key, query_embedding)` constraint and no `ON CONFLICT` on INSERT. Repeated identical queries could land multiple rows, triggering premature eviction of distinct queries |
| F-dom-pgvector-8 | Test parity | No `schema-v1-5.test.ts` unit-level parity test (other migrations have them). Integration test exists at migration-0010.test.ts |
| F-dom-dbmig-3 | Asymmetric guard | recall_cache cascade steps use `DO $$ IF EXISTS` but the `DROP INDEX IF EXISTS recall_cache_scope_hnsw_idx` at line ~1284 is unguarded. Functionally safe but inconsistent |
| F-dom-dbmig-4 | Test specificity | `migration-0010.test.ts` HNSW assertion only matches `/hnsw/` + `/vector_cosine_ops/` regex — does NOT lock m/ef_construction values |
| F-dom-dbmig-5 | Traceability | Agent brief stated "EC-52 verifies 0010_recall_cache.sql ships" — actually `publish-readiness.test.ts` is the coarser glob check |

---

## Edge-case coverage report

Programmatic `edge_case_coverage.py` regex extraction reports 4/59 covered, 55 missing — **but the script is noisy** because it matches plan bullets (Acceptance Criteria, Decisions, Rationales) as "edge cases" rather than the explicit `EC-N` absorption labels. The honest assessment from the cross-validation reviewer is:

- **Covered (12 of 15 plan-declared ECs):** EC-1, EC-2, EC-3, EC-4, EC-5, EC-6 (implementation), EC-7, EC-8, EC-10 (implementation, with F-merge-7 plan divergence), EC-11 (implementation, with F-merge-5 test gap), EC-12, EC-15
- **DOCUMENT-only (3 of 15):** EC-13, EC-14, EC-15 — verified absorbed via plan + JSDoc citations
- **Partially covered (test gap):** EC-6 (reflect hook code present, test missing — F-merge-3); EC-9 (concurrent get during clearExpired not asserted — MINOR F-xval-5)
- **Diverged from plan:** EC-10 (impl chose no-op + TTL fallback; plan said `invalidateAll()` — F-merge-7)

---

## Cross-validation summary

| Plan task | Commit | Implemented | Acceptance Criteria met | DoD satisfied | Notes |
|---|---|---|---|---|---|
| T0.1 13th DIP | 4332382 | Yes | Yes (10/10 contract tests) | Yes | EC-1 + EC-3 + EC-13 absorbed; `repo` discriminator (not `skill`) matches ADR-0010 |
| T0.2 Migration 0010 | 1b275c3 | Yes | Yes | Yes | parity sentinel test (atttypmod=1536) passes |
| T1.1 PgvectorRecallCacheStore | d1664ec | Yes | Yes (13 unit + 14 integration) | Yes | EC-7, EC-8 (with F-merge-9 JSDoc inconsistency), EC-12 absorbed |
| T1.2 LRU eviction | d1664ec | Yes | Yes (EC-7 race verified) | Yes | F-dom-memory-5 MINOR tiebreaker; F-dom-pgvector-6 terminology |
| T2.1 Factory wiring | 8e3f815 | Yes | Yes (10 contract + 4 integration) | Yes | EC-2, EC-4, EC-5 absorbed |
| T2.2 Write-trigger invalidation | 8e3f815 | Yes (code) / Partial (tests) | Partial | Partial | F-merge-3, F-merge-4, F-merge-5, F-merge-7 |
| T2.3 Stub-embedder warning | b0778db | Yes | Yes (4 contract) | Yes | F-merge-6 EC-14 convention drift in T5.1 sibling smoke |
| T3.1 OTel metrics | b0778db | Yes | Yes (4 unit + 3 integration) | Yes | Inline MeterProvider per Inquebrável Rule 11 |
| T4.1 Subpath + isolation | b0778db | Yes | Yes (5 integration) | Yes | F-merge-2 surfaces that the repo-tier surface is incomplete |
| T5.1 THE GOAL TEST | 05a0321 | Yes | Yes (hit rate 0.60 ≥ 0.50) | Yes | Honest disclosure: 4/10 pairs under threshold |
| T5.2 Docs | 05a0321 | Yes | Yes | Yes | CLAUDE.md Item 19 flipped to Shipped 2026-06-03 |

- **Plan tasks:** 11 (T0.1, T0.2, T1.1, T1.2, T2.1, T2.2, T2.3, T3.1, T4.1, T5.1, T5.2)
- **Fully implemented:** 10
- **Partially (test gaps):** 1 (T2.2 — code present, regression tests under-shipped)
- **Missing:** 0
- **Diverged:** 1 (T2.2 EC-10 plan-AC divergence — F-merge-7)

---

## Quality gates summary

| Gate | Result | Tighter `/review` threshold | Met? |
|---|---|---|---|
| `npm test` | 997 PASS / 2 skipped | (no /implement target was 999; -2 honestly explained) | YES (within margin) |
| `npm run typecheck` | 0 errors | 0 errors | YES |
| `npm run lint` | 0 warnings | 0 warnings | YES |
| `npm run test:coverage` | n/a | ≥ 100% on critical paths | SKIPPED — coverage script does not exist in this repo (pre-existing gap; not cycle-introduced) |
| Integration tests | 29/29 cache + 31 isolation = 60 PASS | all PASS | YES |
| Wiring triad | (a) 16/16 PASS, (b) 13/16 PASS (3 gaps → F-merge-3/4/wire-3), (c) 3/3 PASS | full triad | PARTIAL (b gaps are MAJOR but not BLOCKER) |
| THE GOAL TEST hit rate | 6/10 = 0.60 | ≥ 0.5 | YES |
| `/dogfood` gate | EVIDENCE_INSUFFICIENT (unchanged from pre-cycle) | Honest disclosure required | YES (CHANGELOG + CLAUDE.md Item 19 documented) |

---

## Spawned agents (audit trail)

- `.claude/agents/review-semantic-recall-cache-v1-5-2026-06-03/architecture.md` → `findings/architecture.yml`
- `.claude/agents/review-semantic-recall-cache-v1-5-2026-06-03/tests.md` → `findings/tests.yml`
- `.claude/agents/review-semantic-recall-cache-v1-5-2026-06-03/wiring.md` → `findings/wiring.yml`
- `.claude/agents/review-semantic-recall-cache-v1-5-2026-06-03/cross-validation.md` → `findings/cross-validation.yml`
- `.claude/agents/review-semantic-recall-cache-v1-5-2026-06-03/domain-memory-layer.md` → `findings/domain-memory-layer.yml`
- `.claude/agents/review-semantic-recall-cache-v1-5-2026-06-03/domain-pgvector-schema.md` → `findings/domain-pgvector-schema.yml`
- `.claude/agents/review-semantic-recall-cache-v1-5-2026-06-03/domain-db-migrations.md` → `findings/domain-db-migrations.yml`

---

## Handoff decision

**READY_TO_MERGE_WITH_CAVEATS**

- **0 BLOCKER**, **0 CRITICAL** — no merge halt.
- **10 MAJOR** surface to human; address now OR document acceptance in PR description (per cycle-review.md § Soft gates).
- **14 MINOR** logged for follow-up cycles; merge can proceed.

### Recommended pre-merge cleanup (quick wins)

1. **F-merge-1** (paper-names cleanup) — JSDoc rewrite in `src/core/dip/recall-cache-store.ts`. ~10 minutes.
2. **F-merge-9** (NaN JSDoc consistency) — single comment fix in `src/local/recall-cache/pgvector-recall-cache-store.ts:65-68`. ~5 minutes.
3. **F-merge-6** (EC-14 stderr-spy convention) — refactor 1 test block in `semantic-recall-cache.test.ts`. ~10 minutes.

### Recommended follow-up cycle (`semantic-recall-cache-v1-5-fixes-cycle-1`)

The remaining 7 MAJOR findings cluster cleanly into a follow-up cycle. Suggested scope:

- **F-merge-3 + F-merge-4 + F-merge-5** — close T2.2 test coverage gaps (reflect hook integration test, forget hook integration test, EC-11 sequential await ordering assertion). Mirrors the v0.7.1 LLM-MEASURED follow-up pattern.
- **F-merge-2 + F-merge-8** — close the repo-tier wiring + `deriveScopeFromPayload` kind-discrimination, OR document honest deferral in CHANGELOG + ADR-0011 supplementary (mirror v1.1 EC-9 precedent).
- **F-merge-7** — reconcile plan T2.2 EC-10 AC vs shipped behavior (amend plan v1.2 OR implement `invalidateAll()` fallback — Inquebrável Rule 3 requires resolving the divergence).
- **F-merge-10** — extend `applyDimChange` canary to include `recall_cache.query_embedding`.

### Honest cycle disclosures (carry-over to PR description)

- Loop ran via `ralph-loop:ralph-loop` direct invocation (NOT the formal `/implement` skill). No SEPA agent + paired knowledge skill auto-generation; no `.claude/knowledge-base/implementations/{slug}/sepa-iterations/` logs.
- `npm run test:coverage` script is absent in `package.json` — pre-existing repo gap; not introduced by this cycle.
- `/dogfood` gate REMAINS EVIDENCE_INSUFFICIENT — Roadmap Item 19 status was flipped to `Shipped 2026-06-03` in CLAUDE.md, but Item 11 v1.0 production-ready gate is unblocked ONLY by `/dogfood` returning `EVIDENCE_SUFFICIENT` (anchor scenario "Claude Code auto-memory backed by TheMemory" running ≥ 30 days).

### What NOT to do

- Do NOT bypass the F-merge findings via PR-description acceptance without reading them; F-merge-2 in particular is a contract-shape gap that affects the public DIP advertised to consumers.
- Do NOT silently expand the v1.5.0 surface to fix F-merge-2 without an ADR amendment (the plan + blueprint locked the repo-tier as a contract item but didn't trace through to the skill-scope recall wrap — that's an honest gap, not a bug).
