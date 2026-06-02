import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'referencia/**',
      'dist/**',
      '.claude/**',
      'src/core/_placeholder.ts',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylistic,
  {
    files: ['src/{core,local,theokit,agent-tools,embedders,llms,benchmarks}/**/*.ts', 'src/__tests__/**/*.ts'],
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.contract.json', './tsconfig.local.json'],
        // tsconfig.contract.json spans src/{core,theokit,agent-tools,embedders,llms};
        // tsconfig.local.json spans src/{core,local}. Together they cover all linted files
        // including src/__tests__/ (adapters-cycle-1 T2.1 — EC-6 root-no-reexport test).
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'error',
      'import/no-namespace': 'error',
      'import/order': ['warn', {
        'newlines-between': 'always',
        alphabetize: { order: 'asc' },
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'separate-type-imports',
      }],
    },
  },
  {
    files: ['src/{core,local,theokit,agent-tools,embedders,llms,benchmarks}/**/__tests__/**/*.ts', 'src/__tests__/**/*.test*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      // vitest-mock-extended `mock<T>()` produces method spies referenced as
      // `expect(mock.method).toHaveBeenCalled()`; unbound-method false-positives.
      '@typescript-eslint/unbound-method': 'off',
      'import/order': 'off',
      // Barrel-scanner tests (adapters-cycle-1 T2.1 ADR D4 enforcement +
      // subpath smoke tests) use `import * as barrel from "../index.js"`
      // intentionally to introspect the export surface.
      'import/no-namespace': 'off',
    },
  },
);
