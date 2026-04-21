import { defineConfig } from 'vitest/config';

/**
 * Threat-scenario suite vitest config (M3.A8).
 *
 * Env gating (skipIf inside tests reads these):
 *   DATABASE_URL, RUNTIME_DATABASE_URL — Postgres with sep + sep_app
 *     roles (matches rls-negative-tests contract).
 *   REDIS_URL — Redis for auth / throttler / quota scenarios.
 *   VAULT_ADDR, VAULT_TOKEN — Vault for crypto-class scenarios.
 *
 * pool: 'forks' + fileParallelism: false — scenarios mutate shared
 * infra state (Redis counters, Vault keys). Sequential execution
 * keeps flakes bounded and the order visible in CI.
 */
export default defineConfig({
  test: {
    name: '@sep/threat-scenarios',
    globals: false,
    environment: 'node',
    include: ['**/*.threat.test.ts'],
    pool: 'forks',
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
