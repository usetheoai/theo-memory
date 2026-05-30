# SEPA — Iteration 9 / T5.2 / pre-COMMIT / MODE=self-audit-consolidated

## Self-audit

T5.2 mirrors T5.1 architecturally + v0.4a SleepTimeReflectionPolicy's croner reuse pattern.

- ✓ `croner` REUSED from v0.4a — ZERO new runtime dep per blueprint Q2 Rule 9 REJECT-all verdict
- ✓ EC-9 absorption: constructor eagerly probes cron via `new Cron(expr, { paused: true })`; empty/malformed strings throw `InvalidCronExpressionError`. Tests verify 6-field `* * * * * *` + 5-field `* * * * *` both accepted (croner natively supports both)
- ✓ Advisory lock pattern shared with T5.1 (`pg_try_advisory_xact_lock(hashtext('eviction_' || scope))`) so concurrent CapacityBasedTrigger + TimeBasedTrigger fires on the same scope don't double-evict
- ✓ Single-scope per trigger (consumer instantiates N triggers for N scopes — KISS; multi-scope deferred to v1.x)
- ✓ `tickNow(now)` deterministic-test entry point per plan deep dive line 799 ("override cron expression via config to fire on-demand, NOT clock mocking")
- ✓ `onTick(listener)` hook supports both test sanity check + future telemetry wiring
- ✓ `isStarted()` + idempotent `start()` / `stop()` lifecycle mirroring SleepTimeReflectionPolicy
- ✓ Soft-delete via `t_invalid = NOW()` + `WHERE id = ANY($1::uuid[]) AND t_invalid IS NULL` (D17 + idempotency)
- ✓ rowToMemoryItem helper duplicated from T5.1 (knowingly — DRY rule of three not yet hit; refactor at T6.1 evict orchestration when 3rd consumer ships)
- ✓ Paper-name scan clean
- ✓ DIP boundary clean: imports `croner` + `pg` + `../../core/dip/eviction-policy.js` + `../../core/memory-item.js` + `./triadic-scoring-policy.js`
- ✓ Plan REFACTOR step done (plan T5.2 task #4): `runFixedFractionPass` private method extracted

## Test results

- 7/7 GREEN: 4 constructor validation tests (6-field, 5-field, empty, malformed) + 3 pgvector-backed tests (tickNow evicts fraction, start/stop idempotency, real-cron 1.5s sanity check)
- 29/29 v0.4b integration suite across 6 files (lazy-half-life + recall-bookkeeping + nearest-neighbor + multiplier-integration + capacity-trigger + time-trigger)
- 520/522 contract suite unchanged
- Lint clean, typecheck clean, boundary clean

## Wiring triad

- (a) DEFER-foundation: no production caller yet (T6.1 evict orchestration is canonical first consumer). Matches T5.1 + T2.2 persister pattern.
- (b) PASS: 3 integration tests cover lifecycle + eviction + real-cron timing.
- (c) n/a: plan T5.2 declares no metric (forgetting_evict_total at T6.1 only).

## Followup logged

DRY violation: `rowToMemoryItem` + `ScopeCandidateRow` duplicated across T5.1 + T5.2 (capacity-based-trigger.ts + time-based-trigger.ts). Rule of three not hit yet; refactor at T6.1 when the 3rd consumer (evict orchestration) ships. Tracked at v0-4b-forgetting-pipeline-followups.md F4 (added in this commit).

## Verdict

READY to ship.
