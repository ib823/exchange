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
      thresholds: { lines: 80, functions: 80, branches: 50, statements: 80 },
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
