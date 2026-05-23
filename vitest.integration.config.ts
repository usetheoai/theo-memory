import { defineConfig } from 'vitest/config';

/**
 * Integration test config for v0.1 local runtime — T0.2 of v0-1-local-runtime plan v1.3.
 *
 * Targets tests/integration/** against a real Postgres + pgvector container
 * (ankane/pgvector:v0.5.1 via docker-compose). Tests are gated by THEOMEM_PG_URI
 * env var: when absent, tests SKIP cleanly (describe.skipIf pattern in test files).
 *
 * Why a separate config (per blueprint D7 + ADR D1.5):
 *   - vitest.contract.config.ts runs in milliseconds (in-memory + mocks)
 *   - vitest.integration.config.ts requires Docker; longer timeout (30s for DB setup)
 *   - Two configs map cleanly to `npm test` vs `npm run test:integration`
 *
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § T0.2
 * @see .claude/rules/testing.md § Pyramid
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globals: false,
    // Integration tests all share the same Postgres + pgvector container.
    // Parallel file execution causes TRUNCATE races and FK constraint violations
    // (see T6.1 fix log: history-manager.test seeded memories were nuked by
    // pgvector-store.test's TRUNCATE running concurrently).
    fileParallelism: false,
    coverage: {
      enabled: false,
    },
  },
});
