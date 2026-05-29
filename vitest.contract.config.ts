import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/{core,local,theokit,agent-tools}/**/__tests__/**/*.test.ts',
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
