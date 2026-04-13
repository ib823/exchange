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
      thresholds: { lines: 40, functions: 60, branches: 75, statements: 40 },
    },
  },
  resolve: {
    alias: {
      '@sep/common': resolve(__dirname, '../../packages/common/src'),
    },
  },
});
