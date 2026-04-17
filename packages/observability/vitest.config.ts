import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    name: '@sep/observability',
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // vitest 3 v8 reporter counts a slightly higher line total than vitest 1
      // did (imports etc.). Threshold relaxed from 35 -> 34 during M3.0 upgrade
      // to keep the coverage gate honest without backfilling OTEL-wiring tests
      // that belong to M3.
      thresholds: { lines: 34, functions: 25, branches: 55, statements: 34 },
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
