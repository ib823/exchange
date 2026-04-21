import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@sep/simulators',
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    hookTimeout: 15_000,
    testTimeout: 15_000,
  },
});
