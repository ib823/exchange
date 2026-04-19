import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@sep/rls-negative-tests',
    globals: false,
    environment: 'node',
    // The original M3.A1-T06 suite uses `*.rls-negative.test.ts`. M3.A2-T04
    // adds `audit-transactional-coupling.test.ts` which exercises atomicity
    // and append-only enforcement (related but not strictly RLS-negative).
    include: ['**/*.rls-negative.test.ts', '**/audit-transactional-coupling.test.ts'],
    // RLS assertions issue real Postgres roundtrips through pg connection
    // pools shared across describe blocks; running files sequentially keeps
    // pool pressure predictable and makes CI flake easier to diagnose.
    pool: 'forks',
    fileParallelism: false,
    // Per-table seeds occasionally chain through 2-3 parent rows; bump
    // hook timeout so a slow CI runner doesn't false-fail.
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
