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
    files: ['src/{core,local,theokit,agent-tools}/**/*.ts'],
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.contract.json', './tsconfig.local.json'],
        // tsconfig.contract.json now spans src/{core,theokit,agent-tools}; tsconfig.local.json spans src/{core,local}.
        // Together they cover all linted files including src/agent-tools/__tests__/ (v0.3 T0.1 expanded contract glob).
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
    files: ['src/{core,local,theokit,agent-tools}/**/__tests__/**/*.test*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      // vitest-mock-extended `mock<T>()` produces method spies referenced as
      // `expect(mock.method).toHaveBeenCalled()`; unbound-method false-positives.
      '@typescript-eslint/unbound-method': 'off',
      'import/order': 'off',
    },
  },
);
