import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@sep/rls-negative-tests',
    globals: false,
    environment: 'node',
    include: ['**/*.rls-negative.test.ts'],
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
