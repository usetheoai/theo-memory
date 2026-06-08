# Plan: semantic-recall-cache-v1-5-fixes-cycle-1 — close 7 MAJOR findings post-merge

> **Version 1.1** (2026-06-03) — Absorbs `/edge-case-plan semantic-recall-cache-v1-5-fixes-cycle-1` (2026-06-03) report. **4 MUST FIX absorbed**: EC-1 (commit ORDER discipline — T0.1 commits FIRST; new § Dependency Graph clause); EC-2 (T2.2 LLM stub must capture-and-echo sourceIds to satisfy `validateProvenance`); EC-3 (T2.1 deferred-Promise gating uses microtask `Promise.resolve().then(...)` NOT `setTimeout`, plus explicit `vi.useRealTimers()`); EC-4 (T2.3 Acceptance gains explicit `SELECT scope_key FROM recall_cache` assertion in addition to row-count check). **3 SHOULD TEST absorbed inline** in TDD blocks: EC-5 (T1.1 pre-v1.5 DB defensive missing-row test); EC-6 (T2.1 await-ORDER under invalidateScope-rejects); EC-7 (T2.2 `persisted.length === 0` path no-invalidation). **3 DOCUMENT absorbed**: EC-8 (T3.2 `@deprecated` ESLint warnings on existing 4-tier tests — accept-and-document); EC-9 (T4.1 `/review` re-spawn cost ~200k tokens — use distinct date); EC-10 (EC-10 fallback path is largely theoretical for v0.1+ schema — document defensive nature in JSDoc). **Scorer false-positive cleanup**: 4 retrospective references to source plan v1.5.0's `T5.1` (the applyDimChange cascade extension in commit `05a0321`) renamed to `[source plan v1.5.0 T5.1]` so the orphan-task regex does not flag them as unmapped THIS-plan task IDs. Global DoD gains LoC budget mention per `architecture.md § Module hygiene` 500 LoC ceiling.
>
> **Version 1.0** (2026-06-03) — Closes the 7 MAJOR findings deferred from `/review semantic-recall-cache-v1-5` (2026-06-03) after the 3 quick wins (F-merge-1 + F-merge-6 + F-merge-9) shipped inline pre-merge in commit `c47e5ac`. Mirrors the `v0.7-distillation-pipeline-fixes-cycle-1` + `theo-memory-standalone-p0-fixes-cycle-1` precedents: a dedicated fix-up cycle scoped tightly to closing specific review findings without expanding the v1.5 contract surface. **Inquebrável Rule 11 (YAGNI) discipline ceiling**: this plan does NOT add features. It closes 4 test-coverage gaps + 1 plan/code reconciliation + 1 dim-canary extension + 1 scope-tier wiring decision (close-OR-defer).

## Goal

> "Close 7 MAJOR findings from `/review semantic-recall-cache-v1-5` (test coverage gaps for `reflect()` + `forget()` + EC-11 sequential await; reconcile EC-10 plan-vs-code divergence; extend `applyDimChange` canary to `recall_cache`; close-or-defer repo-tier wiring + scope-derivation kind-discrimination) so that re-running `/review semantic-recall-cache-v1-5` returns `READY_TO_MERGE` (0 MAJOR introduced by THIS cycle), measured by the consolidated review report at `.claude/knowledge-base/reviews/semantic-recall-cache-v1-5-fixes-cycle-1-review-{date}.md`."

## Context

### What exists today

- v1.5.0 cycle shipped 6 commits (4332382, 1b275c3, d1664ec, 8e3f815, b0778db, 05a0321) + 1 quick-win cycle commit (c47e5ac F-merge-1 + F-merge-6 + F-merge-9).
- `/review` returned `READY_TO_MERGE_WITH_CAVEATS` with **10 MAJOR + 14 MINOR + 23 INFO** (0 BLOCKER, 0 CRITICAL). 3 closed pre-merge; 7 remaining.
- Roadmap Item 19 flipped to `Shipped 2026-06-03` in CLAUDE.md.
- `/dogfood` gate REMAINS EVIDENCE_INSUFFICIENT.

### What's missing or broken (concretely)

1. **F-merge-3 (reflect invalidation untested)** — `LocalScopedMemory.reflect()` post-success block calls `invalidateScope` (code present); ZERO test asserts the hook fires. Plan T2.2-RED-6 + T2.2-RED-7 specified the regression tests.
2. **F-merge-4 (forget invalidation integration gap)** — `LocalMemory.forget()` invalidates the derived scope (code present); only unit-level FakeCache test exists. Plan T2.2-RED-8 specified an integration test.
3. **F-merge-5 (EC-11 sequential-await ORDER not asserted)** — `factory-recall-cache.test.ts` T2.2-RED-1 asserts the CALL but NOT the AWAIT ORDER. A fire-and-forget regression (dropping `await`) would still PASS.
4. **F-merge-7 (EC-10 plan/code divergence)** — plan v1.1 § T2.2 EC-10 says "fallback to `invalidateAll()` if scope not found"; impl chose "no-op + TTL staleness" (defensible but contradicts plan AC verbatim). Inquebrável Rule 3 requires resolving the divergence.
5. **F-merge-10 (`applyDimChange` canary doesn't probe `recall_cache`)** — the v1.5.0 cascade extension (source plan `T5.1`) extended applyDimChange to ALTER `recall_cache.query_embedding` but the post-ALTER value-based canary at `src/local/index.ts:1335-1350` still only probes `memories` + `entities`.
6. **F-merge-2 + F-merge-8 (repo-tier wiring + scope-derivation kind-discrimination)** — `ScopeTierTtlConfig.repo` is REQUIRED in the public DIP but `LocalScopedSkillMemory.recall()` does NOT consult the cache. `deriveScopeFromPayload` cannot distinguish RepoScope from AgentScope (both use `agent_id` column). Both findings cluster: close-by-wiring OR close-by-deferral.

### Evidence motivating NOW (not later)

- v0.6.1 + v0.7 fix-up cycle + theo-memory-standalone-p0-fixes-cycle-1 + v1.1 fix-up cycle 2 precedents lock the pattern: dedicated fix-up cycle BEFORE PR develop → main keeps `main` clean.
- The user-chosen path "Quick wins + open follow-up plan" mandates this scope.
- Test-coverage gaps could silently regress between merges; closing now avoids context loss.

## Objective

- [ ] Sub-goal 1 — Close F-merge-3: integration test exercising `reflect()` post-success cache invalidation (Item 19 AC#3 regression guard for the reflect write surface)
- [ ] Sub-goal 2 — Close F-merge-4: integration test exercising `forget(memoryId)` cache invalidation against real pgvector + EC-10 scope-derivation verification
- [ ] Sub-goal 3 — Close F-merge-5: contract test asserting EC-11 sequential-await ORDER (cache row gone synchronously after `await remember(...)` returns)
- [ ] Sub-goal 4 — Close F-merge-7: reconcile EC-10 plan/code divergence — amend plan v1.1 → v1.2 with explicit AC text aligned to shipped behavior + ADR D9 documenting the choice
- [ ] Sub-goal 5 — Close F-merge-10: extend `applyDimChange` canary WHERE clause to include `recall_cache.query_embedding` with defensive `EXISTS` guard
- [ ] Sub-goal 6 — Close F-merge-2 + F-merge-8: explicit deferral decision — CHANGELOG note + JSDoc `@deprecated` markers + ADR D10 documenting that v1.5.0 `repo` scope tier is contract-only (skill-scope cache wiring deferred to v1.5.x mirror v1.1 EC-9 precedent)
- [ ] Sub-goal 7 — Re-run `/review semantic-recall-cache-v1-5` and verify 0 NEW MAJOR introduced; 7 closures verified

## ADRs

### D9 — EC-10 reconcile: ship "no-op + TTL staleness" not `invalidateAll()` fallback

**Decision:** When `LocalMemory.forget(memoryId)` cannot derive the memory's scope from payload (e.g., row is too old to carry `user_id`/`session_id`/`agent_id` columns, OR malformed), `deriveScopeFromPayload` returns `undefined` and the cache invalidation step is SKIPPED. The cache continues serving the now-deleted memory's previous scope-bound results until natural TTL expiry. Plan v1.1 § T2.2 EC-10 AC text is amended to match.

**Rationale:**
- v1.5.0 DIP at ADR-0008 caps `RecallCacheStore` at 4 methods (`get`/`set`/`invalidateScope`/`clearExpired`). Adding `invalidateAll()` as a 5th method violates the method-count cap.
- `clearExpired()` + TTL bounds the staleness window (default `user: 24h`, `agent: 1h`, `session: 10min`, `repo: 1h`). For an unknown-scope edge case (defensive — pre-v0.1 rows in theory), TTL-bounded staleness is acceptable.
- Inquebrável Rule 3 (extreme honesty): match plan AC to shipped reality rather than retrofit code to plan literal text.

**Alternatives:**
- A (ship `invalidateAll()` as 5th method): rejected — violates ADR-0008 method-count cap; the unknown-scope case is rare enough that the broad sweep cost (DELETE FROM recall_cache → cache cold-restart for ALL scopes) is asymmetric to the bug it fixes.
- B (loud error throw on unknown scope): rejected — `forget()` is a destructive operation; surfacing a cache-tier error there would block legitimate forget()s on legacy data. Caller should not be punished for the cache module's inability to discriminate the row.

**Consequences:** Consumers calling `forget(memoryId)` on a memory whose scope cannot be derived see TTL-bounded staleness in their next `recall()` (default ≤ 24h). Documented in README + JSDoc.

### D10 — `repo` scope tier is contract-only in v1.5.0; wiring deferred to v1.5.x

**Decision:** `ScopeTierTtlConfig.repo` field is REQUIRED in the public DIP contract (consumers must provide a value when overriding TTL). `LocalMemory.skills(repoId).recall(...)` does NOT consult the recall cache in v1.5.0 — the cache wrap lives on `LocalScopedMemory.recall()` only. Documented as a Known Limitation in CHANGELOG + JSDoc `@deprecated for v1.5.0 — wiring lands in v1.5.x`.

**Rationale:**
- Mirrors v1.1 EC-9 honest deferral precedent (bi-temporal `asOf` on skill scope deferred to follow-up cycle per plan v1.3 ADR D4 amendment).
- Closing the wiring requires extending `LocalScopedSkillMemory` (`src/local/scoped-skill-memory.ts`) AND extending `deriveScopeFromPayload` to read `payload['kind']` for RepoScope vs AgentScope discrimination. Both changes are non-trivial and risk introducing a F-merge-3/4-style test-coverage gap if rushed.
- The contract surface is already shipped (DIP requires `repo` field; consumers can construct TTL configs). Subsequent wiring is purely additive.

**Alternatives:**
- A (close wiring inline in this cycle): rejected — scope creep; F-merge-8 also requires `deriveScopeFromPayload` to read `payload['kind']` which extends the EC-10 absorption surface beyond this cycle's mandate.
- B (drop `repo` field from `ScopeTierTtlConfig`): rejected — public API breaking; consumers that already typed `recallCache: { ttlSecondsByScopeTier: { user: ..., agent: ..., session: ..., repo: ... } }` would compile-fail. Forward-compat by keeping the field over-promised but loud-deferred is honest.

**Consequences:** Consumers calling `memory.skills(repoId).recall(...)` see no cache participation (every call runs the full 9-step pipeline). Documented as Known Limitation in README § Semantic recall cache + CHANGELOG `[Unreleased]` § Changed.

## Dependency Graph (paragraph form)

Phases run sequentially with low coupling: T0 (plan v1.2 amendment + ADRs D9 + D10) → T1 (F-merge-10 canary extension + test) → T2 (F-merge-3 + F-merge-4 + F-merge-5 test additions) → T3 (CHANGELOG + JSDoc Known Limitation entries per ADR D10). T4 (Final Phase: `/review` re-run). Each Tx is independent and could be parallel-able, but sequential commits aid bisection.

**EC-1 commit ORDER discipline (NON-NEGOTIABLE)**: T0.1 MUST commit FIRST. T1.1, T2.1, T2.2, T2.3, T3.1, T3.2 all cite ADR D9 + ADR D10 in code/test JSDoc, commit bodies, and CHANGELOG entries. Citations land on text that does not yet exist if T0.1 commits AFTER them, creating dangling cross-references in the PR diff. Sequence enforcement: `git log --oneline` since the v1.1 plan-edit commit MUST show `plan(amend)` BEFORE any `fix`/`test`/`docs` commit. Cross-validation reviewer in T4.1 will flag dangling refs as fresh F-xval findings if order is violated.

## Phase T0 — plan reconcile + ADR D9 + ADR D10

**Objective:** lock the plan/code reconciliation and the deferral decisions in writing BEFORE any test or canary change.

### T0.1 — Amend plan v1.1 → v1.2 with EC-10 + repo-tier reconcile

**Files:** `.claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md` (EDIT; ALREADY-SHIPPED plan — amendment block at top)
**TDD:**
- RED: `grep "invalidateAll" .claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md` — confirm literal exists pre-edit.
- GREEN: insert "Version 1.2 (2026-06-03)" amendment block; reword T2.2 EC-10 AC: "When `deriveScopeFromPayload` cannot resolve scope, `forget()` skips cache invalidation; cache continues until TTL — bounded staleness per ADR D9". Add Known Limitation section listing `repo` scope tier deferral per ADR D10.
- REFACTOR: ensure ADR D9 + D10 cross-references resolve via `@see filesystem coordinates`.

**Acceptance:** `grep "invalidateAll" plan.md` shows the literal nowhere except inside the historical Version 1.1 amendment block. Plan parity sentinel test (if exists) PASSES.

**DoD:** plan edit committed; `npm test` unchanged (plan edits don't affect tests).

## Phase T1 — F-merge-10 canary extension

### T1.1 — Extend `applyDimChange` post-ALTER canary to `recall_cache`

**Files:** `src/local/index.ts` (EDIT — `applyDimChange()` canary block at ~1335-1350); `tests/integration/migrations/dim-change.test.ts` (EDIT — add canary assertion for recall_cache.query_embedding dim post-ALTER)

**Deep Dives:**
- Canary block at `src/local/index.ts:1307-1322` currently selects `c.relname IN ('memories', 'entities')`. Extend to `c.relname IN ('memories', 'entities', 'recall_cache')` AND wrap the `for (const row of verify.rows)` loop in a defensive check: when `recall_cache` row is absent (pre-v1.5 DB), skip the recall_cache assertion without failing.
- The cascade ALTER block at lines 1289-1308 already uses `DO $$ IF EXISTS` guards. Symmetric defensive guard in canary mirrors that discipline.

**TDD:**
- RED: integration test in `dim-change.test.ts` — set up DB at `embeddingDim=1536`, run `applyDimChange(pool, 384)`, query `pg_attribute.atttypmod` for `recall_cache.query_embedding`, assert `=== 384`. This passes pre-cycle (recall_cache IS ALTERed in shipped code) but the CANARY does not verify it. Add a second assertion: assert the canary REGEX in the source file matches `IN \('memories', 'entities', 'recall_cache'\)`. F-arch-4 style source-level sentinel.
- GREEN: extend canary WHERE + add defensive missing-row branch.
- REFACTOR: ensure error message lists `recall_cache` as a possible mismatch target.
- **EC-5 sibling test (pre-v1.5 DB path)**: `test_applyDimChange_succeeds_without_recall_cache_table` — drop the `recall_cache` table BEFORE running `applyDimChange(pool, 384)`. Assert the function completes without throwing AND the canary's recall_cache assertion is SKIPPED (not failed). Verifies the symmetric `DO $$ IF EXISTS` guard wired into the canary block — defends pre-v1.5 DBs upgrading through this dim-change path.

**Acceptance:** integration test passes; canary covers all 3 vector-bearing tables; source-level sentinel asserts the WHERE clause shape.

**DoD:** `THEOMEM_PG_URI=... npm run test:integration -- tests/integration/migrations/dim-change.test.ts` PASS; npm test unchanged at 997 / 2 skipped.

## Phase T2 — F-merge-3 + F-merge-4 + F-merge-5 test additions

### T2.1 — F-merge-5: contract test for EC-11 sequential-await ORDER

**Files:** `src/local/__tests__/factory-recall-cache.test.ts` (EDIT — append new `test()` block under `describe('T2.2 — write-trigger cache invalidation hooks', ...)`)

**Deep Dives:**
- Existing T2.2-RED-1 asserts `cache.invalidateCalls.toContainEqual(scope)` — does NOT assert the await order.
- New test: pre-warm cache via `cache.set(...)` direct call (bypass embed cost; use a FakeCache that records `setCalls`). Call `await memory.user('alice').remember('text')`. IMMEDIATELY (no `await tick()`, no `setTimeout(0)`) inspect `cache.invalidateCalls`. If the implementation drops the `await`, the call would not have happened yet by the time `remember()` returns — the assertion fails. Use the FakeCache pattern inline (no shared helper needed for this single test).
- **EC-3 absorption (microtask-only deferred resolve, NOT `setTimeout`)**: the FakeCache's `invalidateScope` returns a Promise that resolves on the next MICROTASK via `Promise.resolve().then(() => 0)` — NEVER `setTimeout`. Rationale: vitest's fake timer config (used by sibling suites) freezes `setTimeout` callbacks, causing the deferred Promise to NEVER resolve → `remember()` awaits forever → 5s vitest test-timeout per run. Add `vi.useRealTimers()` at top of the test block as defense-in-depth. Final shape:
  ```ts
  const deferred: { resolve: (n: number) => void } = { resolve: () => undefined };
  const cache = makeFakeCache();
  cache.invalidateScope = vi.fn(() => new Promise<number>((r) => { deferred.resolve = r; }));
  ```
  Test asserts: BEFORE `deferred.resolve(0)` is called, the `await remember(...)` Promise has NOT resolved. AFTER `deferred.resolve(0)`, it does.

**TDD:**
- RED: write the test. Confirm it PASSES with current implementation (await IS present at `src/local/index.ts` LocalScopedMemory.remember post-success block).
- GREEN: confirmed PASSING — implementation already honors EC-11.
- REFACTOR: add JSDoc comment to the test explaining the fire-and-forget regression scenario it defends against.
- **EC-6 sibling test**: `test_remember_awaits_invalidateScope_even_when_it_rejects` — configure FakeCache.invalidateScope to throw `Error('cache backend down')`. Assert `remember()` STILL returns successfully (existing T2.2-RED-5 contract) AND the throw is caught + logged via `vi.spyOn(console, 'error')`. Verifies the loud-but-degrade policy is intact under the EC-11 sequential-await regime.

**Acceptance:** new test passes; if a hypothetical refactor drops the `await` keyword, the test fails.

**DoD:** `npm test -- factory-recall-cache.test.ts` PASS; total contract count climbs from 997 to 998.

### T2.2 — F-merge-3: integration test for `reflect()` invalidation

**Files:** `tests/integration/cache/factory-wiring.test.ts` (EDIT — append new `it()` block); requires a `ReflectionPolicy` instance.

**Deep Dives:**
- Existing T2.2 Item 19 AC#3 test only exercises `remember()`. New test: seed ≥ 2 memories via `remember()` (so `reflect()`'s persist-derived loop has source memories), pre-warm cache via `recall()`, call `await memory.user('alice').reflect()` with a `ManualReflectionPolicy`-shape (or a real `ReflectionPolicy` from the existing test fixtures), assert cache row count for `user:alice` = 0 post-reflect.
- ReflectionPolicy injection: check `src/core/dip/reflection-policy.ts` for the policy shape. The contract is "if `persisted.length > 0` then invalidate" per the implementation at `src/local/index.ts:530-541`. Need a policy that produces ≥ 1 derived memory.
- Use the existing `tests/integration/forgetting/` reflection fixtures if available — confirmed precedent at `tests/integration/reflection/threshold-policy.test.ts`.
- **EC-2 absorption (capture-and-echo LLM stub)**: `reflect()` calls `executeReflection` → LLM → drafts → `validateProvenance(drafts, sourceIds)` THROWS when `draft.derivedFrom` IDs are not a subset of `sourceIds`. A static `DeterministicStubLLM` cannot satisfy this since the source UUIDs are generated at remember()-time. The stub MUST capture the prompt and echo back drafts whose `derivedFrom` equals the source IDs found in the prompt. Pattern: mirror `tests/integration/reflection/threshold-policy.test.ts:generateChat` — parse the user message via regex to extract source IDs, return one draft per source-id-cluster. Without this, the test fails for the WRONG REASON (reflect throws BEFORE the post-success invalidateScope hook runs) and masks the EC-6 regression it is meant to guard.

**TDD:**
- RED: write the test with the capture-and-echo LLM stub. Will FAIL if no `ReflectionPolicy` is configured (reflect() throws `ReflectionNotConfigured`). Configure with the smallest viable policy.
- GREEN: assert cache row count = 0 post-reflect-with-persisted.
- REFACTOR: extract the policy setup into a helper if reused.
- **EC-7 sibling test**: `test_reflect_with_zero_persisted_drafts_does_NOT_invalidate_cache` — same setup but configure the capture-and-echo stub to return `drafts=[]` (LLM said "no consolidation"). Pre-warm cache row; call reflect(); assert cache row count UNCHANGED (verifies the `persisted.length > 0` gate at `src/local/index.ts:530-541` prevents spurious invalidations on empty-reflection runs).

**Acceptance:** new test passes; demonstrates EC-6 absorption end-to-end.

**DoD:** `THEOMEM_PG_URI=... npm run test:integration -- tests/integration/cache/factory-wiring.test.ts` PASS; integration count climbs from 29 to 30.

### T2.3 — F-merge-4: integration test for `forget()` invalidation + EC-10 scope-derivation

**Files:** `tests/integration/cache/factory-wiring.test.ts` (EDIT — append another `it()` block); requires write + recall + forget round-trip.

**Deep Dives:**
- Existing factory-wiring integration test exercises remember + recall HIT/MISS but NOT forget.
- New test:
  - Setup: `createLocalMemory({ ...recallCache: { threshold: 0.8 } })`.
  - Write 1 memory under `user:alice` via `remember(...)`. Capture the returned memoryId.
  - Pre-warm cache via `recall(...)` for alice. Verify cache row count = 1.
  - Call `await memory.forget(memoryId)`.
  - Assert cache row count for `user:alice` = 0 (EC-10 scope-derivation worked).
  - Bonus EC-10 cross-scope isolation: write 1 memory under `user:bob`, pre-warm bob's cache, call `forget(aliceMemoryId)`, verify bob's cache row count UNCHANGED (= 1).
- **EC-4 absorption (explicit scope_key assertion)**: row-count alone is insufficient — a regression that mis-derives the scope (e.g., returns `{kind:'user', userId:'bob'}` instead of `'alice'`) would invalidate bob's row instead and the symmetric "bob count = 1, alice count = 0" might still hold by accident. Add explicit assertion: `SELECT scope_key FROM recall_cache` after the cross-scope forget(); EXPECT the result set to contain ONLY `'user:bob'` (NOT `'user:alice'` — alice's was correctly invalidated; NOT empty — bob's was correctly preserved). This verifies the derived scope_key value, not just side-effect row counts.

**TDD:**
- RED: write the test. Will PASS (LocalMemory.forget code path is shipped).
- GREEN: confirm passing.
- REFACTOR: extract memory-id capture helper if reused.

**Acceptance:** new test passes; EC-10 scope-derivation verified at integration tier; **EC-4 absorption**: explicit `SELECT scope_key FROM recall_cache` post-cross-scope-forget asserts result set contains ONLY `'user:bob'` (not just bob's row count unchanged).

**DoD:** `THEOMEM_PG_URI=... npm run test:integration -- tests/integration/cache/factory-wiring.test.ts` PASS; integration count climbs from 30 to 31.

## Phase T3 — CHANGELOG + README Known Limitations per ADR D10

### T3.1 — Document `repo` scope tier deferral

**Files:** `README.md` (EDIT — `## Semantic recall cache (v1.5)` section gains "Known limitation" callout); `CHANGELOG.md` (EDIT — `[Unreleased]` § Changed entry)

**Deep Dives:**
- README callout: "**Known limitation (v1.5.0):** `memory.skills(repoId).recall(...)` does NOT consult the recall cache — the cache wrap lives on `LocalScopedMemory.recall()` only. Skill-scope cache wiring tracked for v1.5.x. `ScopeTierTtlConfig.repo` field remains REQUIRED in the public DIP because consumer configs that set it forward-port without rewrites; the field's TTL value is dormant until the wiring lands."
- CHANGELOG entry: "Documented `repo` scope-tier cache deferral per ADR D10 of `semantic-recall-cache-v1-5-fixes-cycle-1`. v1.5.0 ships the contract surface (DIP REQUIRES `repo` field) but `LocalScopedSkillMemory.recall()` does NOT consult the cache. Mirrors the v1.1 EC-9 skill-scope `asOf` honest deferral precedent. Wiring lands in v1.5.x."

**TDD:**
- N/A — documentation-only.

**Acceptance:** README callout exists; CHANGELOG entry exists.

**DoD:** lint passes (markdown lint covers README/CHANGELOG); typecheck passes (unchanged).

### T3.2 — JSDoc `@deprecated for v1.5.0` markers + EC-10 reconcile in code

**Files:** `src/core/dip/recall-cache-store.ts` (EDIT — `ScopeTierTtlConfig.repo` JSDoc gets `@deprecated for v1.5.0 — wiring lands in v1.5.x; see CHANGELOG`); `src/local/index.ts` (EDIT — JSDoc on `deriveScopeFromPayload` cites ADR D9 + D10)

**Deep Dives:**
- `@deprecated` marker on `repo` field: TypeScript shows this in IDE tooltips, signaling consumers that the field's value is dormant. Adds Inquebrável Rule 3 honesty at the type level.
- `deriveScopeFromPayload` JSDoc gets an explicit note: "Returns `undefined` when payload has no recognizable scope tier; `LocalMemory.forget()` SKIPS cache invalidation in that case (no `invalidateAll()` fallback per ADR D9). Cache continues serving until TTL — bounded staleness."
- **EC-8 DOCUMENT (ESLint warnings on existing 4-tier tests)**: adding `@deprecated` to `ScopeTierTtlConfig.repo` field will surface `eslint-plugin-deprecation` (or TS 5.x native) warnings on EVERY existing test that constructs the full 4-tier config — including `src/core/dip/__tests__/recall-cache-store.test.ts` T0.1-RED-5 which explicitly builds `{user, agent, session, repo}`. ACCEPT-AND-DOCUMENT policy: do NOT suppress with `/* eslint-disable */` blocks; treat the warnings as informational signals that the field is contract-only. The warnings will be lifted when v1.5.x wiring lands and the `@deprecated` marker is removed. Document this in T3.2 commit body so reviewers expect them on next CI run.
- **EC-10 DOCUMENT (fallback path is defensive for v0.1+ schema)**: the `deriveScopeFromPayload` `undefined` branch only fires for (a) hypothetical pre-v0.1 rows (none in production) OR (b) consumer-side manual INSERTs bypassing the extraction pipeline. Every v0.1+ row carries a scope column (`user_id`/`session_id`/`agent_id`). JSDoc must say so explicitly: "Returns `undefined` is a defensive branch — every v0.1+ row carries a scope column populated by `runExtractionPipeline`." T2.3 does NOT need a test for this branch; it is genuinely theoretical.

**TDD:**
- RED: contract test asserting `@deprecated` token appears in the .d.ts emit for `repo` field? Skip — JSDoc only.
- GREEN: edit JSDoc.

**Acceptance:** `@deprecated` markers present; JSDoc cross-refs ADR D9 + D10 + CHANGELOG.

**DoD:** typecheck + lint clean.

## Phase T4 — Final Phase: re-run `/review`

### T4.1 — Re-run `/review semantic-recall-cache-v1-5` and verify closures

**Files:** `.claude/knowledge-base/reviews/semantic-recall-cache-v1-5-fixes-cycle-1-review-{date}.md` (NEW)

**Deep Dives:**
- `/review` re-run scopes only the commits from THIS fix-up cycle (not the full v1.5.0 surface). Use lightweight verification mode: spawn fewer agents OR ask the existing agents to focus on the deltas.
- Verify 7 closures: F-merge-3 ✓ (test exists), F-merge-4 ✓ (test exists), F-merge-5 ✓ (test exists + asserts ORDER), F-merge-7 ✓ (plan v1.2 amendment + ADR D9), F-merge-10 ✓ (canary extended), F-merge-2 ✓ (ADR D10 + CHANGELOG + JSDoc), F-merge-8 ✓ (covered by F-merge-2 deferral).
- **EC-9 DOCUMENT (re-spawn token cost ~200k + date collision avoidance)**: re-running `/review semantic-recall-cache-v1-5` within 24h of the 2026-06-03 run would COLLIDE with the existing `.claude/agents/review-semantic-recall-cache-v1-5-2026-06-03/` audit dir. Use the cycle finish date (`--date 2026-06-04` or whatever the actual day is) to spawn into a new dir. Expected cost ~150-300k tokens per cycle-review.md § Cost honesty — the gate is intentionally rigorous. If budget-constrained at runtime, T4.1 may be deferred to a separate slice and this cycle merged WITH_CAVEATS instead — documented as acceptable.

**Acceptance:** re-review report shows 0 NEW MAJOR introduced by this cycle; the 7 original MAJORs are listed as RESOLVED.

**DoD:** `/review` verdict = `READY_TO_MERGE` OR `READY_TO_MERGE_WITH_CAVEATS` (caveats acceptable only for MINORs introduced by THIS cycle).

## Coverage Matrix

| Requirement | Source | Task(s) |
|---|---|---|
| F-merge-3 reflect invalidation test | `/review` semantic-recall-cache-v1-5 | T2.2 |
| F-merge-4 forget invalidation integration test + EC-10 scope-derivation | `/review` semantic-recall-cache-v1-5 | T2.3 |
| F-merge-5 EC-11 sequential-await ORDER assertion | `/review` semantic-recall-cache-v1-5 | T2.1 |
| F-merge-7 EC-10 plan/code reconcile (ADR D9) | `/review` semantic-recall-cache-v1-5 | T0.1 + T3.2 |
| F-merge-10 applyDimChange canary extension | `/review` semantic-recall-cache-v1-5 | T1.1 |
| F-merge-2 + F-merge-8 repo-tier wiring decision (ADR D10) | `/review` semantic-recall-cache-v1-5 | T0.1 + T3.1 + T3.2 |
| `/review` re-run returns READY_TO_MERGE | this plan Goal | T4.1 |

**Coverage: 7/7 = 100%.**

## Dependencies

### Existing

| Package | Version | Used by |
|---|---|---|
| (zero new deps required) | — | this cycle reuses the existing test surface, OTel API, pg, drizzle-orm, vitest |

### New

None — Inquebrável Rule 11 (YAGNI). All changes are tests + docs + canary extension + plan-edit.

### Removed

None.

### Accepted Risks (inherited from v1.5.0 envelope)

Per `/deps-audit semantic-recall-cache-v1-5-fixes-cycle-1` (2026-06-03, verdict `PASS_WITH_CAVEATS` cap=89; report at `.claude/knowledge-base/audits/semantic-recall-cache-v1-5-fixes-cycle-1-deps-audit-2026-06-03.md`):

- **8 active allowlist CVEs** (1 CRITICAL `protobufjs` GHSA-xq3m-2v4x-88gg via `@xenova/transformers` chain; 7 HIGH/MODERATE in the same chain + esbuild/drizzle-kit chain). All have active sunsets in range (earliest 2026-07-01 for the protobufjs CRITICAL — 28 days from this cycle). NOT introduced by this fix-up cycle; matches the v1.5.0 cycle's envelope same day.
- **9 outdated MAJOR packages** (zod, eslint, typescript, openai, commander, etc.) — pre-existing repo-wide debt; none touched by this plan's scope.
- **The protobufjs CRITICAL sunset (2026-07-01) is tracked for a SEPARATE follow-up plan** (Xenova v3 upstream OR dep replacement via Rule 9 re-evaluation). Out of scope for THIS cycle's structural fix-up mandate.

## Global Definition of Done

- [ ] All Phase T0/T1/T2/T3/T4 tasks complete with per-task DoD satisfied
- [ ] `npm test` exits 0 with count ≥ 998 (T2.1 adds 1 contract test)
- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0 (with documented exception: EC-8 ESLint deprecation warnings on existing 4-tier tests are acceptable per ADR D10)
- [ ] `THEOMEM_PG_URI=... npm run test:integration -- tests/integration/cache/` exits 0 with count ≥ 31 (T2.2 + T2.3 add 2 integration tests)
- [ ] `THEOMEM_PG_URI=... npm run test:integration -- tests/integration/migrations/dim-change.test.ts` exits 0 (T1.1 adds canary verification + EC-5 pre-v1.5 defensive test)
- [ ] **File-size budget honored per `architecture.md § Module hygiene`**: no source file edited by this cycle exceeds 500 LoC; new test additions append to existing files without crossing the budget (the v1.5.0 `pgvector-recall-cache-store.ts` at 234 LoC has headroom; `src/local/index.ts` at 1439 LoC is pre-existing-debt F-arch-7 per source plan v1.1 and is NOT extended by structural code here — only the canary block at lines 1307-1322 receives ~5 added lines)
- [ ] CHANGELOG.md `[Unreleased]` entries for ADR D9 + ADR D10 deferrals
- [ ] Plan v1.5 amendment block in `.claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md` (Version 1.2 (2026-06-03))
- [ ] Plan archived to `.claude/knowledge-base/plans/completed/semantic-recall-cache-v1-5-fixes-cycle-1-plan.md` post-merge
- [ ] `/review` re-run returns `READY_TO_MERGE` OR `READY_TO_MERGE_WITH_CAVEATS` with 0 NEW MAJOR

## Followups

| # | Item | Why deferred |
|---|---|---|
| F-1 | Wire `LocalScopedSkillMemory.recall()` to consult cache + extend `deriveScopeFromPayload` to read `payload['kind']` for RepoScope vs AgentScope discrimination | v1.5.x scope expansion; requires test coverage on its own and is non-trivial — keep this cycle focused on closing existing MAJORs |
| F-2 | All 14 MINOR findings from `/review semantic-recall-cache-v1-5` | non-blocking; address opportunistically during future cycles per audit-trail-rotation policy |
| F-3 | F-dom-memory-5 LRU eviction tiebreaker (`ORDER BY created_at ASC, id ASC`) | MINOR; low-frequency edge case requiring same-microsecond burst inserts |
| F-4 | F-dom-pgvector-6 LRU terminology vs FIFO behavior | MINOR; either rename to "FIFO eviction" OR add `last_accessed_at` UPDATE on hit path — both extend the contract surface |
| F-5 | F-dom-pgvector-5 `hit_count` column never written/read | MINOR; dormant column; either drop or wire to future LFU eviction policy |
| F-6 | F-dom-pgvector-7 missing `UNIQUE (scope_key, query_embedding)` constraint | MINOR; duplicate rows tolerated; quality-of-life improvement |

## Related

- Cycle rule: `.claude/rules/cycle-plan.md` (this is the planning phase of cycle-plan; cycle-implement next)
- Cycle rule: `.claude/rules/cycle-review.md` (T4.1 invokes `/review`)
- Source plan: `.claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md` v1.1 (to be amended to v1.2 in T0.1)
- Review report: `.claude/knowledge-base/reviews/semantic-recall-cache-v1-5-review-2026-06-03.md`
- Implement-validate snapshot: `.claude/knowledge-base/reviews/semantic-recall-cache-v1-5-implement-validate-2026-06-03.md`
- Quick-win commit: `c47e5ac` (F-merge-1 + F-merge-6 + F-merge-9 closed pre-merge)
- v1.5.0 cycle commits: 4332382, 1b275c3, d1664ec, 8e3f815, b0778db, 05a0321
- Precedent fix-up cycles: `v0-7-distillation-pipeline` fix-up #1, `theo-memory-standalone-p0-fixes-cycle-1`, `v1-1-multi-peer-and-bi-temporal-fixes-cycle-2`
- Inquebrável rules cited: Rule 3 (extreme honesty), Rule 11 (YAGNI), Rule 4 (git safety)
