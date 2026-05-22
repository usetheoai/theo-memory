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
    files: ['src/core/**/*.ts'],
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.contract.json',
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
    files: ['src/core/**/__tests__/**/*.test*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      'import/order': 'off',
    },
  },
);
