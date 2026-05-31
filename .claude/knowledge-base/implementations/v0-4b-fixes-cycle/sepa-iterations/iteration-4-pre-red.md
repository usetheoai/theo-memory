# SEPA — Iteration 4 / Task T3.1 / Phase Pre-RED / Mode VERBOSE

Date: 2026-05-31
Agent ID: af1934843bc46b50c

## Plan recap

T3.1 generalizes 4 surfaces (CapacityBasedTrigger, TimeBasedTrigger, PgNearestNeighborProvider, getNeighborScopeId) from agent_id-hardcoded to Scope-typed; adds migration 0005 with per-tier partial indexes; closes F-dom-1 + F-dom-pg-3 CRITICAL + F-arch-4 + F-dom-4 MAJOR.

## Key findings to honor

- **[CRITICAL]** DIP widening: `NearestNeighborProvider.distance(memoryId, scope: Scope)` AND `TriadicScoringPolicy.nearestNeighborDistance(memoryId, scope: Scope)` — same commit. Both surfaces.
- **[CRITICAL]** EC-5 absorption: `getNeighborScopeId` dispatches on `scope.kind` — function only sees typed Scope, never row columns. Unit test asserts `getNeighborScopeId({kind:'session',sessionId:'Y'}) === 'Y'`. Function must be exported for unit testing OR tested via public spy provider.
- **[MAJOR]** Migration 0005 same mechanism as T0.1: `drizzle-kit generate --name=eviction_partial_indexes` against clean DB; replace bare DDL with `CREATE INDEX IF NOT EXISTS` (EC-4 REVERSAL parity); verify journal idx=5 + tag.
- **[MAJOR]** Advisory-lock key namespacing: `eviction_${scope.kind}_${scopeKey}` (not `eviction_${scopeKey}`) to prevent cross-tier false sharing (user_id='alice' vs agent_id='alice' would collide).
- **[MAJOR]** Schema.ts: 2 new partial indexes via Drizzle `index().on(...).where(sql\`...\`)`. Existing `idx_memories_eviction_score` (agent_id) STAYS — T9.1 concern.
- **[MAJOR]** 7 existing integration test files need migration in same commit per ADR D3 + plan Acceptance line 430: capacity-trigger.test.ts, time-trigger.test.ts, nearest-neighbor.test.ts, multiplier-integration.test.ts, triadic-eviction.test.ts, guardrail-long-tail.test.ts, evict-soft-delete.test.ts.
- **[MAJOR]** Helper `scope-where.ts` extracted in SAME commit as GREEN (SRP boundary for SQL construction). T6.1 owns rowToMemoryItem dedup separately.

## Recommended action

1. RED: unit test for `getNeighborScopeId` + integration test `multi-tier-eviction.test.ts` (5 tests).
2. GREEN: widen DIPs + extend `getNeighborScopeId` for user/session/agent/repo + `PgNearestNeighborProvider` impl + extract `scope-where.ts` + `CapacityBasedTrigger.fire(scope: Scope, now)` + `TimeBasedTrigger.scope: Scope` + namespaced advisory lock keys + migration 0005 (drizzle-kit + IF NOT EXISTS guard repair) + schema.ts new indexes + migrate 7 test files.
3. Wiring + SEPA pre-COMMIT VERBOSE.
