module.exports = {
  extends: ['../../.eslintrc.base.js'],
  parserOptions: { project: './tsconfig.json' },
  overrides: [
    {
      // Threat-scenario suites sit one step outside the src tree they
      // exercise and poke at internal service shapes; same relaxations
      // the base config grants *.test.ts + the rls-negative-tests /
      // simulators / test-helpers suites carry.
      files: ['_helpers/**/*.ts', '**/*.threat.test.ts'],
      rules: {
        'no-process-env': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  ],
};
