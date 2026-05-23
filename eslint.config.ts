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
    files: ['src/{core,local,theokit}/**/*.ts'],
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.contract.json', './tsconfig.local.json'],
        // tsconfig.contract.json now spans src/{core,theokit}; tsconfig.local.json spans src/{core,local}.
        // Together they cover all linted files. src/theokit/__tests__/ test files are picked up via
        // the contract project's include glob.
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
    files: ['src/{core,local,theokit}/**/__tests__/**/*.test*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      'import/order': 'off',
    },
  },
);
