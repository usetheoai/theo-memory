import { cpus } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Consume the LIVE core source (not a possibly-stale dist) so the eval
      // measures the code as it is on the branch. Subpaths listed before the
      // base specifier so the exact-subpath match wins over the base prefix.
      '@usetheo/memory/embedders/local': new URL(
        '../core/src/infrastructure/embedders/local.ts',
        import.meta.url,
      ).pathname,
      '@usetheo/memory/llms/openai': new URL(
        '../core/src/infrastructure/llms/openai.ts',
        import.meta.url,
      ).pathname,
      '@usetheo/memory/llms': new URL(
        '../core/src/infrastructure/llms/index.ts',
        import.meta.url,
      ).pathname,
      '@usetheo/memory': new URL('../core/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    // Default is os.availableParallelism(): one fork per core, each booting a full
    // test environment. Capping leaves headroom for the host, and costs no wall-clock
    // because the gain above this point was already noise when measured.
    maxWorkers: Math.max(2, cpus().length - 4),
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: false,
    testTimeout: 15_000,
  },
});
