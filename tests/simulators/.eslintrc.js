module.exports = {
  extends: ['../../.eslintrc.base.js'],
  parserOptions: { project: './tsconfig.json' },
  overrides: [
    {
      files: ['**/*.test.ts', 'src/**/*.ts'],
      rules: {
        // Simulators are test doubles — they mimic real-world protocol
        // APIs (ssh2, fastify) whose callback shapes are loosely typed
        // upstream. Match the relaxations we grant test files + helpers
        // in rls-negative-tests / test-helpers.
        'no-process-env': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
      },
    },
  ],
};
