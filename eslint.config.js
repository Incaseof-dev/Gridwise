import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['out/', 'dist/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      'src/main/**',
      'src/preload/**',
      'src/core/**',
      'src/cli/**',
      'test/**',
      'e2e/**',
      'scripts/**',
      '*.config.*',
    ],
    languageOptions: { globals: globals.node },
  },
  { files: ['src/renderer/**'], languageOptions: { globals: globals.browser }, ...reactHooks.configs.flat.recommended },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // core must stay runnable without Electron (docs/architecture.md §1)
    files: ['src/core/**'],
    rules: { 'no-restricted-imports': ['error', { paths: ['electron'] }] },
  },
);
