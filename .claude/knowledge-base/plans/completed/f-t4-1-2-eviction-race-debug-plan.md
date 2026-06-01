# Plan: F-T4.1-2 eviction race debug — reproduce + root-cause + fix + lift hotfix

> **Version 1.1** (2026-06-01) — Absorbs 7 edge cases from `/edge-case-plan` review at `.claude/knowledge-base/reviews/f-t4-1-2-eviction-race-debug-edge-cases-2026-06-01.md`: **EC-1 MUST FIX** heisenbug character (T1.1 RED now loops 20x to maximize race-reproduction probability); **EC-2** beforeEach truncates `memories`+`entities`+`history`; **EC-3** all assertions guard `WHERE t_invalid IS NULL` per v0-4b `T7.1` BREAKING; **EC-4** pg_locks visibility helper in test; **EC-5/6/7** DOCUMENT items recorded inline as accepted risks.
>
> **Version 1.0** (2026-06-01) — First concrete plan for the F-T4.1-2 debug cycle declared as landing site in the source `adapters-stub-embedder-llm-cycle-1-fixes` ADR-DEFER-WIRING-B markers (T0.1, commit `c729d52`). Now that the deterministic stub adapters shipped in PR #25 (merged `6928880`, 2026-06-01), the OpenAI quota blocker is lifted and empirical reproduction is unblocked. This plan: (1) builds the integration test consuming the deterministic stubs that reproduces the F-T4.1-2 regression deterministically; (2) isolates the root cause in the capacity-trigger + Promise.all + postRememberHook interaction; (3) fixes the SDK race; (4) lifts the hotfix in `examples/chat-with-memory/lib/memory.ts` (commit `b2909ff`).

## Goal

Reproduce + root-cause + fix the F-T4.1-2 eviction race condition (`Promise.all([userScoped.remember, sessionScoped.remember])` with `createLocalMemory({ eviction })` enabled causes user-scope rows to be lost / `user_id = NULL`), measured by the new integration test `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` passing AGAINST eviction-enabled config + `/test-chat-with-memory` Group B (User scope) returning verdict `READY 33/33` after the hotfix `b2909ff` is lifted in `examples/chat-with-memory/lib/memory.ts`.

The action verb is **fix**; the named observable metric is `npm run test:integration -- tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` passing AGAINST `ankane/pgvector:v0.5.1` with `{ trigger: 'capacity', maxMemoriesPerScope: 10 }` eviction AND `Promise.all` parallel writes producing the expected (N user + N session) row count with `user_id IS NOT NULL` on all user-scope rows.

## Context

### What exists today

**The bug (empirical observation, hotfix commit `b2909ff` body):**
- With `createLocalMemory({ eviction: { trigger: 'capacity', maxMemoriesPerScope: 10 } })` active + parallel `Promise.all([userScoped.remember(...), sessionScoped.remember(...)])` from `examples/chat-with-memory/lib/theomemory-plugin.ts:100-103 rememberTurn`: DB state shows `user_id IS NULL` on all rows; user-scope rows LOST entirely (only session-scope writes survive).
- Empirical isolation: with eviction OFF, 5 rows persist (3 user + 2 session); with eviction ON, 3 rows persist (0 user + 3 session).
- Hotfix `b2909ff` (`examples/chat-with-memory/lib/memory.ts:117-148 resolveEviction`) returns `{ enabled: false, reason: 'hotfix-2026-05-31' }` REGARDLESS of `THEOMEM_EVICTION_DEMO=1` env. The hotfix is demo-scoped only; SDK direct path works (per `examples-chat-with-memory-v0-4b-expansion-implement-validate-2026-05-31.md` § Gate 5: "67 passed" integration tests with eviction).
- The OpenAI quota exhaust originally blocked empirical re-isolation. The adapters-stub-embedder-llm-cycle-1 (PR #25) shipped `DeterministicStubEmbedder` + `DeterministicStubLLM` at `@usetheo/memory/embedders/stub` + `@usetheo/memory/llms/stub` SPECIFICALLY to unblock this debug cycle — `THEOMEM_USE_STUB_ADAPTERS=1` env in `examples/chat-with-memory/lib/memory.ts` swaps OpenAI for stubs; same swap works programmatically in the new integration test.

**Surfaces relevant to the race:**

| File | Role | Lines |
|---|---|---|
| `examples/chat-with-memory/lib/theomemory-plugin.ts` | `rememberTurn` calls `Promise.all([userScoped.remember, sessionScoped.remember])` | 87-128 |
| `examples/chat-with-memory/lib/memory.ts` | `resolveEviction` HOTFIX disabled | 117-148 |
| `src/local/eviction/capacity-based-trigger.ts` | `CapacityBasedTrigger.fire(scope, now)` invoked as `postRememberHook` after each `remember()` | 1-179 |
| `src/local/eviction/scope-where.ts` | `advisoryLockKey(scope)` kind-namespaced lock keys (per v0.4b-fixes T3.1 EC-5 absorption) | full file |
| `src/local/eviction/pg-evictor.ts` | `PgEvictor.evict(memoryItems)` SQL UPDATE with `t_invalid` soft-delete | full file |
| `src/core/memory.ts` (or wherever `LocalMemory.remember` lives) | Two-stage write pipeline; calls `postRememberHook` AFTER inserts complete | TBD by T1.2 root-cause |

**The HYPOTHESIS (informed by empirical evidence, NOT yet proven):**

When `Promise.all([userScoped.remember(...), sessionScoped.remember(...)])` runs:

1. Both `remember()` calls INSERT rows concurrently into `memories` table.
2. After each INSERT, the `postRememberHook` (capacity-trigger) fires `CapacityBasedTrigger.fire(scope, now)`.
3. `fire()` runs SQL: `SELECT count(*) FROM memories WHERE <scope-where>` → if count > maxMemoriesPerScope, runs UPDATE setting `t_invalid` on oldest rows.
4. **The race candidate:** if the postRememberHook for SESSION scope sees both rows (user + session) AND uses a generic WHERE clause (not properly scope-namespaced), it could mark the user-scope row as `t_invalid` (soft-delete). But the symptom is `user_id IS NULL` — that's NOT a soft-delete signature; that's an INSERT writing wrong column data.
5. **Alternative hypothesis:** the demo `lib/memory.ts:resolveEviction` may have wired the eviction config in a way that mutates the memory factory state shared across `userScoped` and `sessionScoped` (e.g., `LocalMemoryConfig.eviction` getter side-effecting on each scope creation). The first sub-scope creation snapshots `userId`; the second sub-scope's creation overwrites the captured `userId` → null/undefined.
6. **Another alternative:** advisory-lock key collision OR scope-where clause leaking across scopes during concurrent INSERT.

T1.2 investigation phase isolates which hypothesis holds.

### Why this matters NOW

1. **Hotfix `b2909ff` is technical debt with a name:** it's documented in `lib/memory.ts:8-23` as "until F-T4.1-2 root cause is identified". Lifting requires the root-cause fix.
2. **Eviction is the gateway to v1.0:** roadmap Item 6 (v0.4b forgetting pipeline) was the headline production-readiness milestone of 2026-05-31. The hotfix puts the demo's eviction surface behind a feature flag that always returns `false` — the demo cannot dogfood eviction until the race is fixed.
3. **Deterministic stubs are SHIPPED:** PR #25 (`6928880`) merged 2026-06-01. The blocker for empirical reproduction is GONE. We declared `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` as the landing site in 2 ADR-DEFER-WIRING-B markers. This cycle delivers that landing site + the fix.
4. **The race may also affect SDK direct consumers** (not just the demo). If `Promise.all([memory.user(a).remember(x), memory.session(b).remember(y)])` with eviction is a documented pattern (it IS — per v0.4b plan's `createLocalMemory({ eviction })` examples), then ANY consumer using both eviction + parallel scoped writes faces this bug. Diagnostic priority: HIGH.

### Accepted risks (declared upfront)

- **EC-A — Root cause may be in the SDK eviction code, not the demo wiring.** If T1.2 isolation confirms the bug reproduces in pure-SDK test (no demo path), the fix lives in `src/local/eviction/*` (capacity-trigger + scope-where + postRememberHook composition). This is the more likely case based on the empirical evidence shape (user_id NULL = INSERT writing wrong column, not soft-delete). Scope expansion: 2-3 files in `src/local/eviction/` + possibly `src/core/memory.ts` (postRememberHook plumbing).
- **EC-B — Root cause may be ONLY in the demo wiring.** Less likely but possible — `lib/memory.ts:resolveEviction` could mutate the `LocalMemoryConfig.eviction` object in a way that the second `memory.session(b)` creation overrides the first's `userId` capture. If T1.2 confirms this, the fix is demo-scoped (smaller surface). Hot path: ~10 LoC in `lib/memory.ts` + verifying `Memory.user(id)` / `Memory.session(id)` are truly independent sub-scope factories.
- **EC-C — Existing SDK integration tests (67 PASS at PR #24 baseline) don't catch this:** because they don't use the `Promise.all` parallel pattern from `rememberTurn`. The new test `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` is the FIRST integration test exercising this specific shape. T1.1 RED will demonstrate the bug; T2.1 GREEN will fix it.
- **EC-D — Lifting hotfix `b2909ff` is a behavior change in the demo.** The demo's eviction surface (which has been DISABLED since 2026-05-31) becomes ACTIVE again. Risk: any consumer using `THEOMEM_EVICTION_DEMO=1` may see new eviction behavior they hadn't seen. Mitigation: T3.1 lifts the hotfix in a SEPARATE commit (clearly atomic, easy to revert). T3.2 re-runs `/test-chat-with-memory` Group H (eviction scenarios) to confirm 3/3 PASS post-lift.
- **EC-E — `t_invalid` soft-delete artifact:** v0-4b `T7.1` BREAKING shipped `t_invalid IS NOT NULL` semantics for forget(). Any new test seeding rows for eviction reproduction must guard with `WHERE t_invalid IS NULL` to count "live" rows correctly. The validation report on the source cycle confirms this is honored in 67/67 existing integration tests.
- **EC-F — File-size budgets:** any new code under `src/local/eviction/` honors `architecture.md § Module hygiene` 500 LoC cap; new test file under `tests/integration/forgetting/` honors no specific cap but should stay focused (≤ 200 LoC for a targeted reproduction).

### Compliance scope

Honors `architecture.md § 3 DIP` — fixes stay outside `src/core/` if possible; if `src/core/memory.ts` post-hook plumbing needs change, it stays DIP-clean. Honors `architecture.md § 6 + § 7` naming + hygiene. Honors `testing.md § Pyramid` — integration test against real `ankane/pgvector:v0.5.1`. Honors `testing.md § Determinism` — uses `DeterministicStubEmbedder` + `DeterministicStubLLM` for reproducibility across runs. Honors `no-paper-names-in-code.md`. Honors `dogfood-golden-rule.md` (no production-ready claim — v1.0 still gated). Honors `cycle-implement.md § Hard gates #5` wiring triad (the new integration test IS the pillar-b evidence for the fix). Honors Inquebrável Rule 3 (extreme honesty — the bug IS a race; we don't ship a "looks fixed" patch without empirical proof). Honors Inquebrável Rule 5 (TDD — RED reproduces, GREEN fixes).

## ADRs

### D1 — Reproduction test lives in `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` (exact path declared in source-cycle ADR-DEFER markers)

**Decision:** the new integration test takes the EXACT filename declared in the 2 ADR-DEFER-WIRING-B markers landed by `adapters-stub-embedder-llm-cycle-1-fixes` T0.1.

**Alternatives considered:**
- (A) `tests/integration/eviction/f-t4-1-2-race.test.ts` — semantically more accurate (it's an eviction race, not forgetting per se) but **REJECTED** because it doesn't match the declared landing site. Honesty discipline: where we said it would land, it lands.
- (B) `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` (CHOSEN) — matches declared landing site exactly.
- (C) Put the test under `src/local/__tests__/eviction-race.test.ts` — **REJECTED**: this is an integration test against real pgvector, not a unit test. Belongs under `tests/integration/`.

**Rationale:** Inquebrável Rule 3 — the ADR-DEFER markers in the implementation contract are a CONTRACT. Honoring the path verbatim is the simplest way to satisfy the contract.

**Consequences:** the directory `tests/integration/forgetting/` already exists (v0.4b shipped there); the new file fits naturally.

### D2 — Investigation order: SDK-only reproduction FIRST, then demo-path reproduction

**Decision:** T1.1 writes a PURE-SDK integration test (no demo dependency) that mimics `rememberTurn`'s `Promise.all` shape. If T1.1 RED reproduces F-T4.1-2 against the SDK alone, the root cause is in `src/local/eviction/*`. If T1.1 RED PASSES (no reproduction), T1.2 writes a SECOND test that wires through the demo singleton (`lib/memory.ts`) and isolates the demo-only contribution.

**Alternatives considered:**
- (A) Demo-path reproduction first — **REJECTED**: harder to debug (more moving parts); SDK-first is the smaller surface.
- (B) Both in parallel — **REJECTED**: violates KISS; if SDK-only reproduces, demo test is wasted work.
- (C) SDK-only first (CHOSEN) — bisects the bug surface with minimum work.

**Rationale:** KISS + bisection discipline. Smaller surface failing first directs effort to the right layer.

**Consequences:** T1.1 may PASS (no bug at SDK layer); if so T1.2 is mandatory. Token cost: same in either case (just shifts where the fix lives).

### D3 — Fix at the layer where the bug reproduces (NOT both layers preemptively)

**Decision:** apply the fix at the SHALLOWEST layer where T1.x reproduces F-T4.1-2. If SDK reproduces, fix SDK; demo lift becomes trivial. If demo reproduces but SDK doesn't, fix demo only.

**Alternatives considered:**
- (A) Fix at both layers "defensively" — **REJECTED**: violates YAGNI; one layer fix is sufficient.
- (B) Fix at the layer where the bug reproduces (CHOSEN).

**Rationale:** YAGNI + Single Source of Truth — if SDK is correct, demo wiring should be simple; if SDK is buggy, fixing it cascades the correctness to demo.

**Consequences:** the fix scope is bounded by T1.x findings.

### D4 — Lift hotfix `b2909ff` in a SEPARATE atomic commit AFTER GREEN

**Decision:** T3.1 reverts the hotfix block in `lib/memory.ts:117-148` in its own commit, named `revert(examples)(f-t4-1-2): lift hotfix b2909ff — F-T4.1-2 root cause fixed (T3.1)`. The commit body cites the root-cause fix commit + the new reproduction test + empirical re-validation.

**Alternatives considered:**
- (A) Lift hotfix in the same commit as the SDK fix — **REJECTED**: two changes (SDK behavior + demo wiring behavior) in one commit muddles the revert story.
- (B) Lift hotfix in a separate atomic commit (CHOSEN) — clear revert target if anything regresses.
- (C) Lift hotfix BEFORE GREEN — **REJECTED**: would re-expose the bug to demo users mid-cycle.

**Rationale:** Inquebrável Rule 4 + Git safety — atomic, named revert commit is reviewable + revertable.

**Consequences:** the commit history will show: T2.x (fix) → T3.1 (lift). Clear narrative.

### D5 — `/test-chat-with-memory` re-run with eviction ENABLED is the integration validation gate

**Decision:** T3.2 invokes `/test-chat-with-memory` with `THEOMEM_EVICTION_DEMO=1` set (which now activates the eviction wiring post-lift). Expected: 33/33 PASS including Group H eviction scenarios. If anything fails, the cycle HALTS and we don't push.

**Alternatives considered:**
- (A) Skip /test-chat-with-memory; rely on integration tests only — **REJECTED**: the previous validation report PARTIAL was a /test-chat-with-memory finding (B1 surfacing F-T4.1-2). The same gate must now PASS to close the loop.
- (B) Re-run /test-chat-with-memory (CHOSEN).

**Rationale:** symmetric closure — the gate that surfaced the bug is the gate that confirms the fix.

**Consequences:** Chrome MCP availability is a prerequisite for T3.2. If Chrome MCP is locked (per F-T4.1-1 known issue), T3.2 BLOCKS until unlocked. NOT a defect of this cycle.

### D6 — No new npm deps (Inquebrável Rule 9)

**Decision:** any code change uses existing deps + Node built-ins. No `package.json` deps modification.

**Alternatives considered:**
- (A) Add a transactional library (e.g., `@databases/pg` for typed-transactions) to wrap `Promise.all` in a single BEGIN/COMMIT — **REJECTED**: would mask the bug instead of fixing it; adding a dep to "fix" a race that lives in our own eviction layer is bad engineering + bloats consumer bundle.
- (B) Add a concurrency-control library (e.g., `p-limit`) to serialize parallel `remember()` calls — **REJECTED**: changes the API contract (consumers expect parallel-safe `Promise.all`); fixing the race at its true source is the only honest path.
- (C) No new deps; fix at the source (CHOSEN) — Node built-ins (`pg` already in deps for SQL) + `node:crypto` (already in use) suffice.

**Rationale:** Inquebrável Rule 9 (Não Reinvente) and Rule 8 (Fail-Fast). The cycle is a bug fix, not a feature addition; adding deps to mask race conditions is fail-silent.

**Consequences:** `/deps-audit` verdict PASS_WITH_CAVEATS (4 pre-existing MODERATE allowlisted carry forward from source cycle unchanged, sunset 2026-08-23). Zero new attack surface.

## Dependency Graph

```
T0.1 (pre-flight + scaffold integration test file)
  ↓
T1.1 (SDK-only reproduction test — RED expected; if PASS, T1.2 runs)
  ↓ (branches based on T1.1 outcome)
  ├── T1.2 (demo-path reproduction — only if T1.1 PASS)
  │     ↓
  │   T2.1-demo (fix in lib/memory.ts)
  │     ↓
  │   T2.2 (verify GREEN on T1.2)
  │
  └── T2.1-sdk (fix in src/local/eviction/* — most likely path)
        ↓
      T2.2 (verify GREEN on T1.1)

T3.1 (lift hotfix b2909ff — separate atomic commit)
  ↓ (depends on T2.2 GREEN)
T3.2 (/test-chat-with-memory re-run — expects 33/33 READY)
  ↓
T4.1 (integration validation gate + push)
```

## Phases

### T0.1 — Pre-flight + integration test scaffold

**Plan reference:** ADR D1 + plan § Context.

**Files to edit:**
- `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` (NEW; scaffold with imports + container setup, NO assertions yet)

**Deep file dependency analysis:**
- `vitest.integration.config.ts` already covers `tests/integration/**/*.test.ts` — new file reachable without config change.
- `tests/integration/forgetting/` directory exists (v0.4b shipped tests there); convention compatible.
- Test imports: `createLocalMemory` from `@usetheo/memory`, `PgvectorStore` + `runMigrations`, `DeterministicStubEmbedder` from `@usetheo/memory/embedders/stub`, `DeterministicStubLLM` from `@usetheo/memory/llms/stub`. All exports exist post PR #25.
- pg test container: `ankane/pgvector:v0.5.1` per existing integration test convention.

**TDD:**
- **RED:** new file with `describe.skip(...)` placeholder → `npm run test:integration -- tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` reports 0 tests run.
- **GREEN:** scaffold compiles + container setup works (no assertions yet).
- **REFACTOR:** n/a.

**Acceptance criteria:**
- [ ] File exists at exact declared path
- [ ] Imports resolve (typecheck PASS)
- [ ] Empty test suite runs without runtime error

**COMMIT:** `test(integration)(f-t4-1-2): scaffold f-t4-1-2-stub-reproduction.test.ts (T0.1)`

### T1.1 — SDK-only reproduction (RED expected)

**Plan reference:** ADR D2 + plan § Hypothesis 4-6.

**Files to edit:**
- `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` (extend)

**TDD (EC-1 + EC-2 + EC-3 + EC-4 absorption):**
- **RED:** add test `it('reproduces F-T4.1-2: parallel user/session remember with eviction loses user-scope rows (20-iteration heisenbug loop)', async () => {...})`:
  1. `beforeEach`: TRUNCATE `memories`, `entities`, `history` (EC-2 absorption — fresh state per trial)
  2. Create `Pool` → run migrations (once, in `beforeAll`)
  3. **20-iteration loop** (EC-1 absorption — heisenbug character; race may fire 1/100; 20× maximizes reproduction probability):
     ```ts
     for (let trial = 0; trial < 20; trial++) {
       await truncateTables(pool);
       const memory = await createLocalMemory({
         embedder: new DeterministicStubEmbedder(),
         llm: new DeterministicStubLLM(),
         vectorStore: new PgvectorStore(pool),
         reflectionPolicy: new ManualReflectionPolicy(),
         eviction: { trigger: 'capacity', maxMemoriesPerScope: 10 },
       });
       const userScoped = memory.user('alice');
       const sessionScoped = memory.session('s1');
       for (let i = 0; i < 5; i++) {
         await Promise.all([
           userScoped.remember(`fact-u-${trial}-${i}`),
           sessionScoped.remember(`fact-s-${trial}-${i}`),
         ]);
       }
       // EC-3 absorption: assertions guard `t_invalid IS NULL` (v0-4b `T7.1` BREAKING)
       const userActive = await pool.query(
         "SELECT COUNT(*)::int AS n FROM memories WHERE t_invalid IS NULL AND user_id = 'alice' AND session_id IS NULL",
       );
       const sessActive = await pool.query(
         "SELECT COUNT(*)::int AS n FROM memories WHERE t_invalid IS NULL AND user_id IS NULL AND session_id = 's1'",
       );
       const userNull = await pool.query(
         "SELECT COUNT(*)::int AS n FROM memories WHERE t_invalid IS NULL AND user_id IS NULL AND session_id IS NULL",
       );
       expect(userActive.rows[0].n, `trial ${trial}: user-scope rows`).toBe(5);
       expect(sessActive.rows[0].n, `trial ${trial}: session-scope rows`).toBe(5);
       expect(userNull.rows[0].n, `trial ${trial}: orphan rows (BUG signature)`).toBe(0);
       await memory.dispose();
     }
     ```
  4. **Test runtime budget**: 20 trials × ~200ms/trial ≈ 4s. Acceptable for `tests/integration/` per existing 30s warn threshold.
- **Expected RED outcome:** at least 1 trial out of 20 has `userNull.rows[0].n > 0` (the F-T4.1-2 signature). Test FAILS with trial-number annotated assertion.
- **Alternative RED outcome:** if ALL 20 trials PASS, the bug is demo-only — T1.2 fires.
- **GREEN:** deferred to T2.1 (fix lives in the right layer per T1.1's outcome).
- **REFACTOR:** extract `truncateTables(pool)` helper if reused; for now inline is KISS.

**EC-4 absorption (optional diagnostic helper for T1.2 if T1.1 PASSes):** add a `dumpPgLocks(pool)` helper that queries `pg_locks` mid-test on demand. Not part of T1.1 RED's primary assertion path; used for post-mortem if reproduction is intermittent across trials.
- **Expected RED outcome:** if hypothesis 4 or 5 holds, the assertion FAILS — actual state shows `user_id IS NULL` on rows that should be user-scope. The bug is REPRODUCED in pure-SDK test.
- **Alternative RED outcome:** if the test PASSES (no reproduction at SDK layer), T1.2 fires; the bug is demo-only.
- **GREEN:** deferred to T2.1 (fix lives in the right layer per T1.1's outcome).
- **REFACTOR:** n/a until GREEN.

**Acceptance criteria:**
- [ ] Test runs against real pgvector
- [ ] Either RED reproduces F-T4.1-2 (proceed to T2.1-sdk) OR test PASSes (proceed to T1.2)

**COMMIT:** `test(integration)(f-t4-1-2): SDK-only reproduction — RED demonstrates F-T4.1-2 (T1.1)`

### T1.2 — Demo-path reproduction (only if T1.1 PASSES)

**Plan reference:** ADR D2 fallback path.

**Files to edit:**
- `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` (extend with a second test)

**TDD:**
- **RED:** new test exercising the demo's getSingleton() → rememberTurn() path via `THEOMEM_USE_STUB_ADAPTERS=1` env. Same Promise.all shape; same assertions on DB state.
- **Expected RED:** if T1.1 passed and the bug is demo-only, this reproduces.

**Acceptance criteria:**
- [ ] Test runs against real pgvector with the hotfix temporarily disabled (test-scope override OR direct singleton construction)
- [ ] RED reproduces F-T4.1-2 if T1.1 didn't

**COMMIT:** `test(integration)(f-t4-1-2): demo-path reproduction — RED (T1.2)`

(Skip if T1.1 reproduced.)

### T2.1-sdk — Fix in `src/local/eviction/*` (most likely path)

**Plan reference:** ADR D3.

**Files to edit:** (TBD per T1.x findings)
- Likely: `src/local/eviction/capacity-based-trigger.ts` AND/OR `src/local/eviction/scope-where.ts` AND/OR the postRememberHook plumbing in `src/core/memory.ts` (or wherever it lives).
- Plus: the fixed code must include a regression test at `src/local/eviction/__tests__/f-t4-1-2-regression.test.ts` (unit-level if applicable) OR rely on the integration test alone (depends on fix shape).

**TDD:**
- **GREEN:** T1.1 RED test passes after fix. All existing 67 eviction integration tests still PASS (no regressions).
- **REFACTOR:** clean up the fix to honor SOLID/Clean Code; tests stay green.

**Acceptance criteria:**
- [ ] T1.1 PASSes
- [ ] All existing eviction + forgetting integration tests still PASS (67/67 baseline preserved)
- [ ] `npm test` baseline 573/2-skip preserved (no contract suite regression)
- [ ] DIP boundary preserved
- [ ] LoC delta minimal (target: ≤ 30 lines net new in src/local/eviction/*)

**COMMIT:** `fix(eviction)(f-t4-1-2): <root-cause-specific message> — T1.1 GREEN (T2.1)`

### T2.1-demo — Fix in `lib/memory.ts` (fallback path)

**Plan reference:** ADR D3 fallback.

**Files to edit:**
- `examples/chat-with-memory/lib/memory.ts` (specific block TBD by T1.2 findings)

(Apply only if T1.2 reproduced, T1.1 didn't.)

### T2.2 — Verify GREEN + full regression suite

**Plan reference:** Plan § Goal.

**Files to edit:** (no source code edits; verification gate only)

#### TDD

This task is the verification gate, NOT new bug-fix code. The TDD discipline IS satisfied by T1.1's RED-then-GREEN pattern; T2.2 is the harness validating no collateral defect across the broader test surface.

- **RED:** the existing T1.1 test (committed in T1.1) is the prevention-of-regression guard. Pre-T2.1 it fails; post-T2.1 it must PASS.
- **GREEN:** T2.1's fix makes T1.1 PASS. T2.2 is the AGGREGATE confirmation across the full test suite.
- **REFACTOR:** n/a.

Explicit per `testing.md`: "doc-only/verification changes do NOT require a separate RED test; the upstream RED suffices when the verification is purely AGGREGATE."

**Tasks:**
1. `npm run test:integration -- tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` PASS
2. `npm run test:integration` (full integration suite) PASS — no regressions
3. `npm test` (contract suite) PASS — 573/2-skip baseline preserved
4. `npm run typecheck` exit 0
5. `npm run lint` exit 0

**Acceptance criteria:**
- [ ] All 5 checks PASS
- [ ] T1.1 RED-now-GREEN regression test passes consistently across 3 consecutive runs (race-condition stability check)

**COMMIT:** (folded into T2.1's commit OR separate `chore(test)(f-t4-1-2): verify GREEN — full regression suite (T2.2)`)

### T3.1 — Lift hotfix `b2909ff` in `lib/memory.ts`

**Plan reference:** ADR D4.

**Files to edit:**
- `examples/chat-with-memory/lib/memory.ts` (revert lines 117-148 to honor `THEOMEM_EVICTION_DEMO=1` env var; remove `'hotfix-2026-05-31'` reason path)

**TDD:**
- **RED:** N/A (revert).
- **GREEN:** demo boots with `THEOMEM_EVICTION_DEMO=1` and reports `eviction=enabled (capacity, max=10)` instead of `eviction=disabled (reason: hotfix-2026-05-31)`.
- Manual smoke test acceptable here (the integration tests already cover SDK behavior; this is wiring revert).

**Acceptance criteria:**
- [ ] Hotfix block removed; original `resolveEviction` logic restored
- [ ] Demo `npm run build` PASS
- [ ] Comment block at lines 8-23 + 117-148 removed (no longer accurate)
- [ ] CHANGELOG entry mentions the lift

**COMMIT:** `revert(examples)(f-t4-1-2): lift hotfix b2909ff — F-T4.1-2 root cause fixed (T3.1)`

### T3.2 — `/test-chat-with-memory` re-run with eviction enabled

**Plan reference:** ADR D5.

**Tasks:**
1. Invoke `/test-chat-with-memory` (skill); set `THEOMEM_EVICTION_DEMO=1` in the skill's env
2. Verify verdict: 33/33 READY (Group H eviction scenarios 3/3 PASS; Groups A-G also PASS)
3. Confirm Group B (User scope) DOES NOT regress on the F-T4.1-2 surface that originally surfaced the bug
4. If Chrome MCP locked (F-T4.1-1 known issue), DEFER and surface honestly — NOT a defect of this cycle

**Acceptance criteria:**
- [ ] /test-chat-with-memory verdict READY 33/33 OR honest BLOCKED on F-T4.1-1 with no F-T4.1-2 evidence in run

**COMMIT:** `chore(review)(f-t4-1-2): /test-chat-with-memory READY 33/33 — F-T4.1-2 closed (T3.2)`

### T4.1 — Integration validation gate + push + plan archive

**Plan reference:** standard /implement T4.1 pattern.

**Tasks:**
1. `npm test` PASS
2. `npm run typecheck` exit 0
3. `npm run lint` exit 0
4. `npm run test:integration` PASS (including new reproduction test)
5. `npm pack --dry-run` (no contract changes expected; sanity check)
6. CHANGELOG entry under `[Unreleased] § Fixed` for F-T4.1-2 root cause + hotfix lift
7. Commit + push to origin/develop
8. Open release PR develop → main with summary

**Acceptance criteria:**
- [ ] All 8 checks PASS
- [ ] Validation report written at `.claude/knowledge-base/reviews/f-t4-1-2-eviction-race-debug-implement-validate-2026-06-01.md`

**COMMIT:** `chore(implement)(f-t4-1-2): validation gate + push (T4.1)`

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Reproduce F-T4.1-2 deterministically using stubs | T0.1 + T1.1 | New integration test consuming `DeterministicStubEmbedder` + `DeterministicStubLLM` |
| 2 | Isolate root cause to SDK or demo | T1.1 + T1.2 | Bisection via SDK-first then demo-path reproduction |
| 3 | Fix root cause | T2.1-sdk OR T2.1-demo | Targeted fix at the layer that reproduces |
| 4 | Verify GREEN without regressions | T2.2 | Full test suite + integration suite + contract suite re-run |
| 5 | Lift hotfix `b2909ff` | T3.1 | Atomic revert commit with clear narrative |
| 6 | Re-run /test-chat-with-memory to confirm READY 33/33 | T3.2 | Symmetric gate — same surface that surfaced the bug confirms the fix |
| 7 | Update CHANGELOG with fix narrative | T4.1 | `[Unreleased] § Fixed` entry citing plan slug |
| 8 | Push + open release PR | T4.1 | Develop → main PR after /review |

8 / 8 mapped. Coverage Matrix: 100%.

## Global Definition of Done

- [ ] All 6 task groups (T0.1, T1.x, T2.x, T3.x, T4.1) committed
- [ ] `npm test` exit 0 (baseline 573/2-skip preserved)
- [ ] `npm run typecheck` exit 0
- [ ] `npm run lint` exit 0
- [ ] `npm run test:integration` PASS (incl. new reproduction test + 67 existing eviction tests baseline)
- [ ] `npm run build` PASS (no contract changes; sanity check)
- [ ] CHANGELOG.md `[Unreleased] § Fixed` entry mentions F-T4.1-2 + hotfix lift
- [ ] No `production-ready` / `production-grade` / `v1.0 ready` token introduced
- [ ] No paper names in src/test code
- [ ] File-size budgets respected (LoC delta minimal — target ≤ 30 lines net new under src/local/eviction/*)
- [ ] DIP boundaries preserved
- [ ] Hotfix `b2909ff` reverted in `examples/chat-with-memory/lib/memory.ts`
- [ ] /test-chat-with-memory verdict READY 33/33 OR honest BLOCKED on F-T4.1-1 (Chrome MCP)
- [ ] Pushed to origin/develop
- [ ] Plan moved to `.claude/knowledge-base/plans/completed/` AFTER `/review` returns READY_TO_MERGE AND PR merged

## Final Phase: Integration Validation (T4.1)

`npm test && npm run typecheck && npm run lint && npm run test:integration && grep -E 'F-T4.1-2|f-t4-1-2' CHANGELOG.md | wc -l` returns exit 0 AND ≥ 1 CHANGELOG match.

Re-run of `/review f-t4-1-2-eviction-race-debug` OPTIONAL if BLOCKER=0 and no new architectural change in remediation set; otherwise mandatory.
