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
    // v0-8-fixes-cycle-1 T3.2 + EC-4: benchmarks/scripts/ at repo root
    // (NOT under src/) — extracted runner scaffold + 3 CLI runners now
    // gain lint enforcement (previously escaped via src/{...} pattern).
    files: ['packages/core/src/**/*.ts', 'packages/api/src/**/*.ts', 'packages/cli/src/**/*.ts', 'packages/agent-core/src/**/*.ts', 'packages/mcp/src/**/*.ts', 'benchmarks/scripts/**/*.ts'],
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
      // Honor the universal `_`-prefix convention for intentionally-unused params
      // (e.g. a DIP-contract arg a given impl does not need). Without this, the
      // recommendedTypeChecked default flags `_scope` etc. as false positives.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'separate-type-imports',
      }],
    },
  },
  {
    files: [
      'src/{core,local,theokit,embedders,llms,benchmarks}/**/__tests__/**/*.ts',
      'src/__tests__/**/*.test*.ts',
      'packages/core/src/**/__tests__/**/*.ts',
      'packages/core/src/**/*.test.ts',
      'packages/core/src/**/*.test-d.ts',
      'packages/core/src/**/_test-*.ts',
      'packages/api/src/**/__tests__/**/*.ts',
      'packages/api/src/**/*.test.ts',
      'packages/api/src/**/*.test-d.ts',
      'packages/cli/src/**/__tests__/**/*.ts',
      'packages/agent-core/src/**/__tests__/**/*.ts',
      'packages/agent-core/src/**/*.test.ts',
      'packages/cli/src/**/*.test.ts',
      'packages/cli/src/**/*.test-d.ts',
      'packages/mcp/src/**/__tests__/**/*.ts',
      'packages/mcp/src/**/*.test.ts',
      'packages/mcp/src/**/*.test-d.ts',
    ],
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
  {
    // v0-8-fixes-cycle-1 T3.2 + EC-4: CLI entry-points under
    // benchmarks/scripts/ are exempt from no-console — architecture.md
    // § 7 "No console.log in production code paths" applies to library
    // code; CLI tools legitimately use console.log/error for user
    // output. The 3 run-*.ts scripts are the canonical CLI surfaces.
    files: ['benchmarks/scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // packages/eval was unlintable: type-aware rules need the file to belong to a
    // tsconfig project, and it belongs to none of the ones above — so eslint
    // crashed rather than reporting violations, and the package was simply left
    // out of the lint script. It has its own tsconfig.typecheck.json; point the
    // parser at that instead of forcing eval into the contract project.
    files: ['packages/eval/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./packages/eval/tsconfig.typecheck.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An evaluation harness is a CLI: printing results is its whole job.
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'import/order': 'off',
    },
  },
);
