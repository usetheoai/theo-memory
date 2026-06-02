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
    },
  },
  test: {
    include: [
      'src/{core,local,theokit,agent-tools,embedders,llms}/**/__tests__/**/*.test.ts',
      'src/__tests__/**/*.test.ts',
      'tests/unit/**/*.test.ts',
    ],
    passWithNoTests: true,
    typecheck: {
      enabled: true,
      include: ['src/{core,theokit}/**/__tests__/**/*.test-d.ts'],
      tsconfig: './tsconfig.contract.json',
    },
    coverage: {
      enabled: false,
    },
  },
});
