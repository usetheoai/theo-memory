import { defineConfig } from 'vitest/config';

/**
 * E2E test config — T7.1 of v0-3-agent-tools-mcp plan v1.1.
 *
 * Targets `tests/e2e/**` for subprocess + transport-boundary tests. Spawns
 * built `dist/agent-tools/cli.js` via `child_process.spawn` so requires
 * `npm run build` to have run first (per `pretest:e2e` script).
 *
 * Gated by THEOMEM_PG_URI like integration tests; describe.skipIf pattern in
 * test files. EC-17 false-green-skip guard in test bodies.
 *
 * @see plan T7.1 § Tasks step 1 — EC-8 build-before-test ordering
 */
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globals: false,
    fileParallelism: false,
  },
});
