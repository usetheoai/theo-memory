import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // adapters-or-local T2.1 (EC-13): unit tests under tests/unit/examples/
      // import examples/chat-with-memory/lib/memory.ts which begins with
      // `import "server-only"` as a Next.js build-time guard. Alias to a
      // noop module (same shim used by vitest.integration.config.ts) so the
      // contract tests resolve the import in the test environment.
      'server-only': new URL('./tests/integration/examples/server-only-shim.ts', import.meta.url).pathname,
      // adapters-or-local T2.2: the demo's Next.js routes use the `@/` path
      // alias (declared in examples/chat-with-memory/tsconfig.json). When
      // unit tests load route handlers in isolation (no Next.js runtime),
      // the alias must be re-declared here so `import { ... } from "@/lib/memory"`
      // resolves to the actual file.
      '@/lib/memory': new URL('./examples/chat-with-memory/lib/memory.ts', import.meta.url).pathname,
      // T2.1 (architecture-review-fixes): MCP package imports shared symbols
      // from src/agent-tools/ via this subpath. tsconfig paths handle tsc;
      // this alias handles vitest runtime resolution.
      '@usetheo/memory-agent-core': new URL('./packages/agent-core/src/index.ts', import.meta.url).pathname,
      // Consumer-DX fix: packages/core#exports now point at the built dist JS so
      // Node-SSR consumers (TheoKit/Next/Vite-SSR) can load the published
      // package (a src-only package is unresolvable when the bundler
      // externalizes it — Node cannot run raw .ts). For the test suites we want
      // the LIVE src, not a stale dist, so map every @usetheo/memory subpath
      // back to its src entry. Subpaths are listed BEFORE the base specifier so
      // the exact subpath match wins over the base prefix match (rollup-alias
      // matches the first entry whose find equals or prefixes the importee).
      '@usetheo/memory/config': new URL('./packages/core/src/config-entry.ts', import.meta.url).pathname,
      '@usetheo/memory/contract': new URL('./packages/core/src/domain/index.ts', import.meta.url).pathname,
      '@usetheo/memory/recall-trace-pg': new URL('./packages/core/src/infrastructure/db/recall-trace/index.ts', import.meta.url).pathname,
      '@usetheo/memory/theokit': new URL('./packages/core/src/infrastructure/theokit/index.ts', import.meta.url).pathname,
      '@usetheo/memory/embedders/stub': new URL('./packages/core/src/infrastructure/embedders/stub.ts', import.meta.url).pathname,
      '@usetheo/memory/embedders/openai-compatible': new URL('./packages/core/src/infrastructure/embedders/openai-compatible.ts', import.meta.url).pathname,
      '@usetheo/memory/embedders/openai': new URL('./packages/core/src/infrastructure/embedders/openai.ts', import.meta.url).pathname,
      '@usetheo/memory/embedders/local': new URL('./packages/core/src/infrastructure/embedders/local.ts', import.meta.url).pathname,
      '@usetheo/memory/embedders': new URL('./packages/core/src/infrastructure/embedders/index.ts', import.meta.url).pathname,
      '@usetheo/memory/llms/stub': new URL('./packages/core/src/infrastructure/llms/stub.ts', import.meta.url).pathname,
      '@usetheo/memory/llms/openai': new URL('./packages/core/src/infrastructure/llms/openai.ts', import.meta.url).pathname,
      '@usetheo/memory/llms': new URL('./packages/core/src/infrastructure/llms/index.ts', import.meta.url).pathname,
      '@usetheo/memory/cache-pg': new URL('./packages/core/src/infrastructure/db/recall-cache/index.ts', import.meta.url).pathname,
      '@usetheo/memory': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    include: [
      'packages/core/src/**/__tests__/**/*.test.ts',
      'packages/core/src/**/*.test.ts',
      'packages/mcp/src/**/*.test.ts',
      'packages/cli/src/**/__tests__/**/*.test.ts',
      'packages/agent-core/src/**/__tests__/**/*.test.ts',
      'tests/unit/**/*.test.ts',
      // ESTE arquivo esta em tests/integration/ mas NAO e integracao: sao
      // assertions estaticas sobre o YAML dos workflows (so readFileSync — sem
      // banco, sem OpenAI, sem rede). Estava preso na suite `test:integration`,
      // que roda APENAS no schedule das 03:00 UTC — ou seja, o teste descrito no
      // CHANGELOG como "o alarme contra a copia vendorizada virar permanente"
      // nao guardava nada em PR nem em push. Um alarme que toca uma vez por dia,
      // depois do merge, nao e um gate.
      //
      // Escopo deliberado: so este arquivo. Os outros 49 de tests/integration/
      // precisam de Postgres e/ou OpenAI e quebrariam o job sem banco. Ha mais
      // arquivos estaticos mal classificados ali (docker-compose-prod,
      // dockerfile-entrypoint, config-parity) — reclassificar todos e trabalho
      // proprio, nao carona neste commit.
      'tests/integration/publish-workflow.test.ts',
      'tests/integration/publish-npm-workflow.test.ts',
    ],
    // Agent worktrees under .claude/worktrees/ are throwaway checkouts that may
    // hold deliberately reverted code (a verifier proving a test goes RED). Left
    // unexcluded, vitest globs them and reports those intentional failures as if
    // they were the main tree's — which happened.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/worktrees/**'],
    passWithNoTests: true,
    // T0.1 absorption: npm install of 6 NEW deps (hono + adapters + commander +
    // swagger-parser) grew the contract-suite module-resolution graph; tests
    // doing `dynamic import('src/local/index.ts')` (~1097 LoC + transitive)
    // bump past Vitest's default 5s. Lift global per-test timeout to 15s to
    // restore stability without touching individual tests. The 2 affected
    // pre-existing tests (eviction-barrel, chat-with-memory-info-route) are
    // unrelated to T0.1's code surface; the slowdown is environmental.
    testTimeout: 15_000,
    typecheck: {
      enabled: true,
      // T1.7 (EC-25): `server` added so subpath-export.test-d.ts asserts
      // `@usetheo/memory/server` resolves to createServer at typecheck time.
      include: ['packages/core/src/**/__tests__/**/*.test-d.ts', 'packages/api/src/**/*.test-d.ts'],
      tsconfig: './tsconfig.contract.json',
    },
    coverage: {
      enabled: false,
    },
  },
});
