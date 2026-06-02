/**
 * Vitest config for v0.8 benchmark e2e tests (EC-4 absorption).
 *
 * Default e2e tests use vitest.e2e.config.ts with a 30-second timeout.
 * LongMemEval / LoCoMo / DMR full-run e2e tests need up to 60 minutes
 * (500 questions × ~3-5s LLM + judge round-trip = 25-40 min wall-clock).
 * This config narrows the include glob to tests/e2e/benchmarks/**\/*.test.ts
 * and bumps testTimeout to 60 minutes.
 *
 * Invoke via `npm run test:benchmark`. CI sets BENCH_RUN=true + the
 * required API keys (OPENAI_API_KEY, OPENROUTER_API_KEY) to actually
 * run the benchmarks; without those env vars the tests skip cleanly.
 *
 * @see plan v1.2 § T5.1 + EC-4
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/benchmarks/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 30_000,
    globals: false,
    fileParallelism: false,
  },
});
