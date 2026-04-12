/** @type {import('eslint').Linter.Config} */
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier',
  ],
  rules: {
    // ── TypeScript strictness ──────────────────────────────────
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-call': 'error',
    '@typescript-eslint/no-unsafe-return': 'error',
    '@typescript-eslint/explicit-function-return-type': 'error',
    '@typescript-eslint/explicit-module-boundary-types': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/require-await': 'error',
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/prefer-nullish-coalescing': 'error',
    '@typescript-eslint/prefer-optional-chain': 'error',
    '@typescript-eslint/strict-boolean-expressions': 'error',
    '@typescript-eslint/no-unnecessary-condition': 'error',

    // ── Security: no raw process.env in business logic ─────────
    // Config must go through @sep/common config loader
    'no-process-env': 'error',

    // ── Security: no console.log (must use Pino logger) ────────
    'no-console': 'error',

    // ── Security: no eval, no implied eval ────────────────────
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',

    // ── General quality ────────────────────────────────────────
    'no-throw-literal': 'error',
    'prefer-const': 'error',
    'no-var': 'error',
    eqeqeq: ['error', 'always'],
    curly: ['error', 'all'],
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': 'error',

    // ── Import hygiene ─────────────────────────────────────────
    'no-duplicate-imports': 'error',
  },
  overrides: [
    // Allow process.env ONLY in config files and main.ts
    {
      files: [
        '**/config.ts',
        '**/config/index.ts',
        '**/main.ts',
        '**/*.config.ts',
        '**/*.config.js',
      ],
      rules: { 'no-process-env': 'off' },
    },
    // Relax some rules in test files
    {
      files: ['**/*.test.ts', '**/*.spec.ts', '**/seed.ts', '**/seed-data/**'],
      rules: {
        'no-process-env': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', '.next/', 'coverage/', '*.js'],
};
