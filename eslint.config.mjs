import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/out/**',
      '**/release/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.d.ts',
      'packages/db/migrations/**',
      'apps/web/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  {
    // Node and browser globals for plain .mjs scripts (Node 22 built-ins).
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      globals: {
        process: 'readonly', console: 'readonly', fetch: 'readonly', AbortSignal: 'readonly',
        setTimeout: 'readonly', Buffer: 'readonly', URL: 'readonly', TextEncoder: 'readonly',
      },
    },
  },
  ...tseslint.configs.recommended,
  {
    // CommonJS build hooks (electron-builder loads these with require).
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', exports: 'writable', module: 'writable', __dirname: 'readonly', console: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      // Money must never be a float: block Number-based rounding helpers in domain code.
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'round', message: 'Use packages/core money helpers, not Math.round, for money.' },
      ],
    },
  },
  {
    // The money module and unit tests may use Math.round where documented.
    files: ['**/*.test.ts', '**/*.test.tsx', 'apps/**', 'packages/config/**'],
    rules: { 'no-restricted-properties': 'off' },
  },
);
