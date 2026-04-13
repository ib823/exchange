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
      thresholds: { lines: 90, functions: 50, branches: 75, statements: 90 },
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
