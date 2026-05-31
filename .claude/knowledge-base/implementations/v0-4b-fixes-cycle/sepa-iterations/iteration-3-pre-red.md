# SEPA — Iteration 3 / Task T2.1 / Phase Pre-RED / Mode TIGHT

Date: 2026-05-31
Agent ID: a9949741b56f2fd07

## Plan recap

- T2.1 makes `npm run db:push` also apply trigger-bearing migrations (currently only 0004) via psql, so dev DBs match prod schema; closes F-dom-db-2 CRITICAL + EC-9.

## Findings

- **[CRITICAL]** RED test option (a) `execSync('npm run db:push')` couples to npm + dotenv + shell loading. Option (c) hybrid — test imports the SAME `applyTriggerMigrations(connString)` helper that GREEN script invokes — is the honest shape per testing.md "test behavior, not implementation". Avoid option (b) which re-implements SQL apply in the test.
- **[MAJOR]** EC-9 placement: `### Prerequisites` subsection UNDER `## Quickstart`. Voice-guide BODY tier (below `## How it works`) is technical-direct; `psql` is a tool name, fits there. Anchor the GREEN error message at this subsection name.
- **[MAJOR]** Error-message contract for EC-9 must be TESTABLE: assert when PATH lacks psql, helper throws with anchored message.
- **[MAJOR]** REFACTOR glob: simple regex over `src/local/migrations/*.sql` (only 0004 matches today). JSDoc note: regex-based is sufficient while migrations are hand-authored; revisit if migration count > 20 OR false-positive `CREATE TRIGGER` strings appear in comments.
- **[MAJOR]** Idempotency: 0004 uses `CREATE OR REPLACE FUNCTION` + `CREATE OR REPLACE TRIGGER` (PG 14+ semantics — verified). Test runs helper TWICE; asserts still-present + no error.
- **[INFO]** Plan TDD RED matches option (c) shape — does NOT mandate `execSync`. Good.

## Recommended action

RED: `tests/integration/db-push/trigger-applied.test.ts` (NEW) that (1) provisions throwaway DB, (2) drizzle-kit pushes schema via Pool, (3) dynamic-imports the GREEN helper `scripts/apply-trigger-migrations.mjs`, (4) calls it, (5) asserts `memories_reset_half_life_on_importance_update_trg` present in `information_schema.triggers`, (6) calls AGAIN — asserts idempotency. Sibling test: missing-psql → anchored error.

EC-9 README edit: `### Prerequisites` under `## Quickstart` listing `psql` (PostgreSQL 14+ client tools), Docker, Node 20.x — anchor.
