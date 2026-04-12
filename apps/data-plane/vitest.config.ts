import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    name: '@sep/data-plane',
    globals: true,

    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: { lines: 75, functions: 75, branches: 70, statements: 75 },
    },
  },
  resolve: {
    alias: {
      '@sep/common': resolve(__dirname, '../../packages/common/src'),
      '@sep/schemas': resolve(__dirname, '../../packages/schemas/src'),
      '@sep/crypto': resolve(__dirname, '../../packages/crypto/src'),
      '@sep/observability': resolve(__dirname, '../../packages/observability/src'),
      '@sep/db': resolve(__dirname, '../../packages/db/src'),
      '@sep/partner-profiles': resolve(__dirname, '../../packages/partner-profiles/src'),
    },
  },
});
