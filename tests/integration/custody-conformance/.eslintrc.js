module.exports = {
  extends: ['../../../.eslintrc.base.js'],
  parserOptions: { project: './tsconfig.json' },
  overrides: [
    {
      // Conformance fixtures need process.env to gate on live Vault
      // and openpgp.readMessage returns loose types we narrow inline.
      // Same relaxations the RLS suite uses for the same reasons.
      files: ['**/*.test.ts'],
      rules: {
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
