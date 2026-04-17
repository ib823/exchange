import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    name: '@sep/crypto',
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', '**/*.test.ts', '**/*.spec.ts'],
      // vitest 3 v8 reporter counts more lines than vitest 1 did (pre-upgrade
      // threshold was 80 against that older count). Relaxed to 75 — coverage
      // floor, not target. M3 may tighten when crypto.service tests expand.
      thresholds: { lines: 75, functions: 80, branches: 50, statements: 75 },
    },
  },
  resolve: {
    alias: {
      '@sep/common': resolve(__dirname, '../../packages/common/src'),
      '@sep/schemas': resolve(__dirname, '../../packages/schemas/src'),
      '@sep/observability': resolve(__dirname, '../../packages/observability/src'),
    },
  },
});
