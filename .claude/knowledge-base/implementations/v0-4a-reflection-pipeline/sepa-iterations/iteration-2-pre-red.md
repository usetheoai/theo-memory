# SEPA — Iteration 2 / Task T0.2 / Phase pre-RED (TIGHT)

## Plan recap
- Migration `0001_reflection_columns.sql`: add `kind`/`derived_from`/`llm_importance_score` to memories + CHECK; create `reflection_counters` with composite-unique scope + CHECK against all-NULL.

## Findings
- [CRITICAL] Drizzle does NOT emit CHECK natively — manually splice into 0001_reflection_columns.sql. Test queries `pg_constraint.conname` (NOT `information_schema.check_constraints` which has eventual-consistency edge cases).
- [CRITICAL] EC-10 ordering test MUST seed v0.1 memories BEFORE applying migration. Sequence: spin pgvector → apply 0000 only → INSERT 100 v0.1 rows → apply 0001 → assert kind='extracted' default + no CHECK violation. If both migrations applied then seeded, test is meaningless.
- [MAJOR] `count: bigint({ mode: 'number' })` — confirm mode='number' (safe to 2^53-1, far above 10B). Mode 'bigint' would force BigInt downstream.
- [MAJOR] Composite-unique on `(scope_user_id, scope_session_id, scope_agent_id)` collides with Postgres NULL≠NULL semantics. The all-NULL CHECK (EC-3) blocks at row level. Verify CHECK is `NOT (user IS NULL AND session IS NULL AND agent IS NULL)`.
- [MAJOR] Naming alignment: new table fields MUST be `scopeUserId`/`scopeSessionId`/`scopeAgentId` (camelCase TS → `scope_user_id` SQL). Plan ADR D4 confirms prefix-qualified.
- [MAJOR] `derived_from JSONB` nullable + `string[]` UUID list. CHECK enforces non-null+non-empty only when kind='derived'; kind='extracted' rows MUST be NULL.
- [MAJOR] Build pipeline: `0001_*.sql` must be copied to dist/ via existing postbuild script. Verify glob is `**/*.sql` not hardcoded.
- [MAJOR] Integration test container reuse: each test fresh container (drop+recreate, NOT truncate). EC-10 ordering test specifically requires container with ONLY 0000 applied.

## Recommended action
RED tests order: (1) `schema-v0-4a.test.ts` querying pg_constraint + Drizzle introspect + CHECK violation INSERT. (2) `0001-ordering.test.ts` apply 0000 → seed → apply 0001 → assert kind='extracted'. Both with real pgvector. Confirm RED fails with "relation reflection_counters does not exist" AND "column kind does not exist" BEFORE GREEN.
