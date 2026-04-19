module.exports = {
  extends: ['../../../.eslintrc.base.js'],
  parserOptions: { project: './tsconfig.json' },
  overrides: [
    {
      // Helper modules sit alongside test files and exist solely to support
      // them. Same relaxations the base config grants *.test.ts: process.env
      // is the integration gate, and the cross-table helper indexes Prisma
      // model accessors dynamically (any/unsafe-* are unavoidable there).
      files: ['_helpers/**/*.ts', '**/*.test.ts'],
      rules: {
        'no-process-env': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        // Per-table parent-id maps populated in setupParents are read by
        // seedRow/validInsertPayload — Record<string, string> indexing
        // gives string|undefined under noUncheckedIndexedAccess, but the
        // value is guaranteed populated by setupParents ordering.
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  ],
};
