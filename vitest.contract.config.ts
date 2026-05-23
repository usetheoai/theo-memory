import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/{core,local}/**/__tests__/**/*.test.ts'],
    passWithNoTests: true,
    typecheck: {
      enabled: true,
      include: ['src/core/**/__tests__/**/*.test-d.ts'],
      tsconfig: './tsconfig.contract.json',
    },
    coverage: {
      enabled: false,
    },
  },
});
