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
  resolve: {
    alias: {
      // `server-only` is a Next.js build-time guard that throws when imported
      // from non-server code. Integration tests run outside Next.js and need
      // to import `examples/chat-with-memory/lib/memory.ts` (which uses the
      // guard). Alias to a noop so the import succeeds in test environment.
      'server-only': new URL('./tests/integration/examples/server-only-shim.ts', import.meta.url).pathname,
      // Post-workspace-restructure: the @usetheo/memory/agent-tools subpath
      // was extracted to @usetheo/memory-cli. The MCP package still imports
      // from the old subpath; this alias bridges the gap at test time.
      '@usetheo/memory-agent-core': new URL('./packages/agent-core/src/index.ts', import.meta.url).pathname,
      // MCP package barrel — vitest uses node ESM resolution which does NOT
      // auto-map .js → .ts. This alias lets `import('@usetheo/memory-mcp')`
      // and transitive imports from packages/mcp/ resolve correctly.
      '@usetheo/memory-mcp': new URL('./packages/mcp/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    globalSetup: ['tests/integration/global-setup.ts'],
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
