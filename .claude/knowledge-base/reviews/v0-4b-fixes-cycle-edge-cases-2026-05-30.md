# Edge Case Review — v0-4b-fixes-cycle

Data: 2026-05-30
Tasks analisadas: 17 (T0.1, T1.1, T2.1, T3.1, T4.1, T5.1, T6.1, T7.1, T7.2, T8.1, T9.1, T9.2, T10.1, T11.1, T11.2, T12.1, T13.1)
Edge cases encontrados: 11 (MUST FIX: 4, SHOULD TEST: 4, DOCUMENT: 3)

## MUST FIX

### EC-1: T0.1 drizzle-kit generate needs a CLEAN throwaway DB state to produce byte-correct snapshots

- **Task afetada:** T0.1
- **Família:** State
- **Cenário:** Plan T0.1 § Tasks step 3 says "boot pgvector container + create throwaway DB". If the throwaway DB was used in a prior dev session AND has partial schema OR Drizzle journal entries already present, `npm run db:generate` will produce INCREMENTAL snapshots (diff from current state) rather than the full per-migration snapshots needed. The generated `0003_snapshot.json` would then NOT reflect schema-state-after-0003 but rather diff-from-previous-state. Subsequent `runMigrations()` against a fresh prod DB applies migrations using snapshots that assume a different baseline → silent schema corruption.
- **Impacto:** Drizzle journal sync ships with snapshots that LOOK valid (`drizzle-kit generate` exited 0) but produce wrong schema in production. BLOCKER fix becomes the next BLOCKER finding.
- **Fix sugerido:** Add step 2.5 to T0.1: `psql -c "DROP DATABASE IF EXISTS themem_journal_sync_tmp; CREATE DATABASE themem_journal_sync_tmp;"` AND step 3.5: assert `_journal.json` `entries` length increased by exactly 2 after `db:generate`.

### EC-2: T1.1 TypeScript overload `new TriadicScoringPolicy(undefined)` is ambiguous between options-object branch and positional weights=undefined branch

- **Task afetada:** T1.1
- **Família:** Format (TypeScript overload resolution)
- **Cenário:** Plan T1.1 Deep Dives § Discrimination proposes `'weights' in arg` to discriminate options-object from positional. But `undefined` (a valid first-positional value used by 8+ existing call sites) is neither a TriadicWeights nor an object — `'weights' in undefined` throws `TypeError`. The deprecated positional path expects `(undefined, undefined, null, null, evictor)` to work; the runtime check will crash on the first `undefined`.
- **Impacto:** Existing 8 test call sites + run.ts that pass `undefined` as the first positional arg crash at construction. T1.1 tests pass (use the new options-object form) but T7.1 GOAL TEST + every other v0.4b integration test crashes.
- **Fix sugerido:** Add an explicit type guard `function isOptionsObject(arg: unknown): arg is TriadicScoringPolicyOptions { return typeof arg === 'object' && arg !== null && !('recency' in arg); }` and branch with `if (arg === undefined || isWeightsLike(arg)) { /* positional */ } else { /* options */ }`. Add a RED test for `new TriadicScoringPolicy(undefined, undefined, null, null, evictor)`.

### EC-3: T7.1 forget() delegation to PgEvictor is a BREAKING CHANGE on the public API surface

- **Task afetada:** T7.1
- **Família:** Boundary / public API contract
- **Cenário:** v0.1 contract: `memory.forget(id)` → row physically deleted; raw `SELECT * FROM memories WHERE id = $1` returns 0 rows. v0.4b post-T7.1: row still exists with `t_invalid` set; raw SELECT returns 1 row. Consumers using raw SQL audit queries (e.g., to verify "this fact was forgotten") will see different behavior. The v0.1 → v0.4b migration breaks their assertions silently.
- **Impacto:** Consumer with `assert raw_select_count == 0 after forget()` test silently passes pre-v0.4b and silently fails post-v0.4b. The v0.4b CHANGELOG entry "Memory.forget(id) now soft-deletes" lands AFTER the breaking change is shipped.
- **Fix sugerido:** Add an explicit ADR row D7 to the v0-4b-fixes-cycle plan: "T7.1 introduces a PUBLIC API BEHAVIOR CHANGE on Memory.forget(); document in CHANGELOG.md `[Unreleased]` § Changed with `**BREAKING**:` prefix; bump minor version on next release." Plus add a SHOULD TEST asserting raw SELECT post-forget returns 1 row with t_invalid set (new behavior is the documented contract).

### EC-4: T11.1 removing `IF NOT EXISTS` from 0003.sql breaks deployments where 0003 was previously partially applied via the F-dom-db-1 workaround

- **Task afetada:** T11.1
- **Família:** State (cross-version migration recovery)
- **Cenário:** Between v0.4b shipping (BLOCKER state — 0003 missing from journal) and v0.4b-fixes shipping (T0.1 + T11.1 land together), some users may have manually applied 0003 via `psql -f` to unblock their dev. When v0.4b-fixes ships, T0.1 adds the journal entry; T11.1 strips `IF NOT EXISTS` from 0003. Their next `runMigrations()` call will: (a) see journal entry idx=3 already absent (they never bumped journal), (b) try to apply 0003 again, (c) fail with `column already exists` because `IF NOT EXISTS` was removed by T11.1.
- **Impacto:** Users who took the F-dom-db-1 workaround between v0.4b and v0.4b-fixes get an upgrade-time crash on `runMigrations()`. F-dom-db-4 rollback runbook becomes urgent.
- **Fix sugerido:** Split T11.1 into two: (a) T11.1a — publish runbook FIRST (separate commit, doc-only); (b) T11.1b — strip `IF NOT EXISTS` AND ship a one-time data-recovery script `npm run db:repair-v0-4b-partial-state` that detects partial state and either repairs the journal or aborts with the runbook URL. KEEP `IF NOT EXISTS` on 0003 columns; this is genuinely the right idempotency model when migrations may have been applied out-of-band during a bugfix window. Plan is wrong to remove it.

## SHOULD TEST

### EC-5: T3.1 mixed-scope rows — what does `getNeighborScopeId` return when both user_id AND session_id are non-null?

- **Task afetada:** T3.1
- **Teste sugerido:** `test_getNeighborScopeId_prefers_scope_kind_over_column_presence` — seed row with user_id='X' AND session_id='Y' AND agent_id=NULL; pass `scope: { kind: 'session', sessionId: 'Y' }`; assert returns `'Y'` (session_id), NOT 'X'. Documents the tie-breaking rule (kind is authoritative; columns are derived).

### EC-6: T4.1 createLocalMemory with eviction.trigger='time' + consumer also manually instantiates a CapacityBasedTrigger → both fire on overflow

- **Task afetada:** T4.1
- **Teste sugerido:** `test_concurrent_capacity_and_time_triggers_no_double_evict` — wire BOTH triggers (one via createLocalMemory, one manually); seed over cap; assert total evictions ≤ overflow_count (advisory lock keeps them serialized; same EC-2 invariant from original v0.4b T5.1 but now tested through the public factory).

### EC-7: T9.1 2-roundtrip NN query — does the latency overhead break T7.1 GOAL TEST's 22s baseline?

- **Task afetada:** T9.1
- **Teste sugerido:** `test_triadic_eviction_goal_test_runtime_under_30s_with_2roundtrip_nn` — re-run T7.1 (1000-memory seed + 30% eviction) after T9.1's 2-roundtrip refactor; assert wall-clock ≤ 30s (plan T7.1 implicit ceiling). If the refactor pushes runtime over budget, plan T9.1 needs an ADR row deferring the HNSW-friendly refactor to v0.5 OR tuning the cache.

### EC-8: T11.2 Fisher-Yates shuffle determinism — seeded vs unseeded behavior

- **Task afetada:** T11.2
- **Teste sugerido:** `test_random_baseline_two_runs_same_seed_produce_same_recall_at_10` — run docs/forgetting-evaluation/run.ts twice with the SAME seed → assert recall@10 values byte-identical. Validates that the Fisher-Yates implementation is genuinely deterministic given a seed (regression catcher for future swaps).

## DOCUMENT

### EC-9: T2.1 db:push assumes `psql` is on PATH; not all dev environments have it

- **Risco aceito:** Plan T2.1 wraps `drizzle-kit push` with a `psql -f` invocation. Devs on machines without psql (e.g., minimal Docker dev containers, Bazel sandboxes) will see `db:push` crash. The error message will be diagnostic enough (`psql: command not found`). v0.4b-fixes prerequisite addition: README mentions PG client tools. Defer "fully psql-free push" to v0.5 where Drizzle may model triggers natively.

### EC-10: T13.1 re-run /review may surface NEW BLOCKER/CRITICAL from T3.1's scope-tier refactor (high-risk area)

- **Risco aceito:** ADR D2 already documents this contingency: "if the re-run finds NEW BLOCKER/CRITICAL after T13.1, a v0-4b-fixes-cycle v1.1 must be drafted." The plan honestly acknowledges the re-run is the metric, not a guaranteed pass. T3.1 + T4.1 + T7.2 together rewrite ~40% of the v0.4b eviction-tier code; new review findings are plausible.

### EC-11: T9.2 controlled-concurrency test infrastructure may exceed vitest's native primitives

- **Risco aceito:** Plan T9.2 says "integration test that reproduces it under controlled concurrency" but vitest has no native worker_threads orchestration. The simplest implementation is `Promise.all([...])` on a shared pool — sufficient to demonstrate the race window exists but NOT to reliably reproduce timing-sensitive failures. The race window is BOUNDED by BEFORE-UPDATE-OF trigger semantics (eventual consistency guaranteed within tx commit horizon). Test as eventual-consistency, not as race-trigger. If reliable race-trigger is needed, defer to v0.4b.2.

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 1 | 1 | 0 | 0 |
| T1.1 | 1 | 1 | 0 | 0 |
| T2.1 | 1 | 0 | 0 | 1 |
| T3.1 | 1 | 0 | 1 | 0 |
| T4.1 | 1 | 0 | 1 | 0 |
| T5.1 | 0 | 0 | 0 | 0 |
| T6.1 | 0 | 0 | 0 | 0 |
| T7.1 | 1 | 1 | 0 | 0 |
| T7.2 | 0 | 0 | 0 | 0 |
| T8.1 | 0 | 0 | 0 | 0 |
| T9.1 | 1 | 0 | 1 | 0 |
| T9.2 | 1 | 0 | 0 | 1 |
| T10.1 | 0 | 0 | 0 | 0 |
| T11.1 | 1 | 1 | 0 | 0 |
| T11.2 | 1 | 0 | 1 | 0 |
| T12.1 | 0 | 0 | 0 | 0 |
| T13.1 | 1 | 0 | 0 | 1 |
| **Total** | **11** | **4** | **4** | **3** |

**Veredicto: PLANO PRECISA DE AJUSTE** — 4 MUST FIX edges must be absorbed into plan v1.1 before `/plan-confidence` runs. Specifically:

1. **EC-1 (T0.1)**: add DROP DATABASE step + journal-entry-count assertion
2. **EC-2 (T1.1)**: add explicit type guard for `undefined` first-arg + RED test for backward-compat path
3. **EC-3 (T7.1)**: add ADR row marking forget() as BREAKING change + raw-SELECT post-state SHOULD TEST
4. **EC-4 (T11.1)**: split into T11.1a (runbook publish) + T11.1b (idempotency + repair script); KEEP `IF NOT EXISTS` on 0003 (plan recommendation is wrong)

The 4 SHOULD TEST + 3 DOCUMENT items can be absorbed by either:
- Plan v1.1 author adding sub-bullets under existing T3.1/T4.1/T9.1/T11.2/T2.1/T13.1/T9.2 tasks, OR
- The `/implement` halt-loop adding them inline during execution (per the SEPA absorption pattern from the original v0.4b cycle)

Per `cycle-plan.md` chain order: absorb 4 MUST FIX into plan v1.1, THEN proceed to `/deps-audit` → `/plan-confidence`.
