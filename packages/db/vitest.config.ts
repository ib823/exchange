import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    name: '@sep/db',
    globals: true,

    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      // vitest 3 v8 reporter includes prisma/seed.ts in the default coverage
      // scope; vitest 1 did not. The seed is a standalone bootstrap script
      // (no unit tests, no runtime callers), so exclude it explicitly.
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
      thresholds: { lines: 40, functions: 60, branches: 75, statements: 40 },
    },
  },
  resolve: {
    alias: {
      '@sep/common': resolve(__dirname, '../../packages/common/src'),
    },
  },
});
