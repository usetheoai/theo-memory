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
      // Consumer-DX fix: packages/core#exports now point at the built dist JS so
      // Node-SSR consumers (TheoKit/Next/Vite-SSR) can load the published
      // package. For the integration suite we want the LIVE src, not a stale
      // dist, so map every @usetheo/memory subpath back to its src entry.
      // Subpaths are listed BEFORE the base specifier so the exact subpath
      // match wins over the base prefix match.
      '@usetheo/memory/contract': new URL('./packages/core/src/domain/index.ts', import.meta.url).pathname,
      '@usetheo/memory/theokit': new URL('./packages/core/src/infrastructure/theokit/index.ts', import.meta.url).pathname,
      '@usetheo/memory/embedders/stub': new URL('./packages/core/src/infrastructure/embedders/stub.ts', import.meta.url).pathname,
      '@usetheo/memory/embedders/openai': new URL('./packages/core/src/infrastructure/embedders/openai.ts', import.meta.url).pathname,
      '@usetheo/memory/embedders/local': new URL('./packages/core/src/infrastructure/embedders/local.ts', import.meta.url).pathname,
      // Item 24 — embedder registry + fetch-based adapters (map subpaths to src for integration tests).
      '@usetheo/memory/embedders/ollama': new URL('./packages/core/src/infrastructure/embedders/ollama.ts', import.meta.url).pathname,
      '@usetheo/memory/embedders/voyage': new URL('./packages/core/src/infrastructure/embedders/voyage.ts', import.meta.url).pathname,
      '@usetheo/memory/embedders/google': new URL('./packages/core/src/infrastructure/embedders/google.ts', import.meta.url).pathname,
      '@usetheo/memory/embedders/registry': new URL('./packages/core/src/infrastructure/embedders/registry.ts', import.meta.url).pathname,
      '@usetheo/memory/embedders': new URL('./packages/core/src/infrastructure/embedders/index.ts', import.meta.url).pathname,
      '@usetheo/memory/llms/stub': new URL('./packages/core/src/infrastructure/llms/stub.ts', import.meta.url).pathname,
      '@usetheo/memory/llms/openai': new URL('./packages/core/src/infrastructure/llms/openai.ts', import.meta.url).pathname,
      '@usetheo/memory/llms': new URL('./packages/core/src/infrastructure/llms/index.ts', import.meta.url).pathname,
      '@usetheo/memory/cache-pg': new URL('./packages/core/src/infrastructure/db/recall-cache/index.ts', import.meta.url).pathname,
      '@usetheo/memory/recall-trace-pg': new URL('./packages/core/src/infrastructure/db/recall-trace/index.ts', import.meta.url).pathname,
      '@usetheo/memory/reranker-local': new URL('./packages/core/src/infrastructure/rerankers/index.ts', import.meta.url).pathname,
      '@usetheo/memory/adaptive-local': new URL('./packages/core/src/infrastructure/adaptive/index.ts', import.meta.url).pathname,
      '@usetheo/memory': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    globalSetup: ['tests/integration/global-setup.ts'],
    // Resets the shared THEOMEM_PG_URI database to a clean template clone before
    // EACH test file, so a CLI boot that migrates the dim to 384 (or a
    // destructive test) cannot leak state into the next file.
    setupFiles: ['tests/integration/_helpers/reset-shared-db.ts'],
    include: ['tests/integration/**/*.test.ts'],
    // Agent worktrees under .claude/worktrees/ are throwaway checkouts that may
    // hold deliberately reverted code (a verifier proving a test goes RED). Left
    // unexcluded, vitest globs them and reports those intentional failures as if
    // they were the main tree's — which happened.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/worktrees/**'],
    passWithNoTests: true,
    // 90s (was 30s): the CI runner is materially slower than local dev — CLI tests
    // spawn subprocesses that boot the Memory factory + call real OpenAI, and a
    // multi-step round-trip (e.g. verbs-cli remember→recall→forget→recall = 4
    // subprocess boots) legitimately exceeds 30s under shared-runner + OpenAI
    // latency. A passing test never consumes its budget; this only widens the
    // window before a genuinely slow/hung test fails, trading a little
    // fail-latency for freedom from load-induced timeout flakes.
    testTimeout: 90_000,
    hookTimeout: 90_000,
    // Retry a failed test up to 2× before declaring the run red. This suite is
    // subprocess- and network-heavy (spawned CLI processes, real OpenAI, a shared
    // self-hosted runner), which produces ROTATING single-test flakes: across
    // consecutive CI runs the same 120 files passed while a different one failed
    // each time (principles-alignment → verbs-cli → cli-consolidated), each passing
    // on the next run. Retry separates that transient class from real breakage: a
    // genuinely broken test fails all 3 attempts and still blocks the gate, while a
    // load-induced flake no longer reds an otherwise-good build.
    retry: 2,
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
