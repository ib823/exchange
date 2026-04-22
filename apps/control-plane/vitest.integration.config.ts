import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Integration-test vitest config for control-plane (M3.A4-T06).
 *
 * Separate from vitest.config.ts so `pnpm test:unit` stays offline-safe
 * while the real-infra suite is opt-in via env:
 *
 *   DATABASE_URL, RUNTIME_DATABASE_URL — Postgres with the sep_app role
 *     set up (same env contract as tests/integration/rls-negative-tests).
 *   REDIS_URL — any Redis reachable from the test process.
 *
 * Gating happens inside each test file (describe.skipIf(...)) because a
 * missing env should skip, not fail.
 *
 * Why tests live IN the control-plane package instead of a standalone
 * tests/integration/auth-lifecycle/ package:
 *   rls-negative-tests and custody-conformance sit outside because they
 *   only need @sep/db / @sep/crypto (library packages). The auth T06
 *   scenarios exercise LoginService, RefreshTokenService,
 *   MfaChallengeStore — NestJS services from @sep/control-plane's src/.
 *   A standalone test package importing across that boundary hit
 *   tsconfig rootDir issues. Keeping the tests in-package dodges that
 *   and inherits the existing @sep/* alias resolution below.
 */
export default defineConfig({
  test: {
    name: '@sep/control-plane-integration',
    globals: true,
    environment: 'node',
    // M3.A8 adds `*.threat.test.ts` alongside `*.integration.test.ts`
    // for threat-scenario tests that need to poke at control-plane
    // internals (guards, services). Same env-gate + infra requirements.
    include: ['**/*.integration.test.ts', '**/*.threat.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Integration scenarios spawn concurrent DB writes; forks + no file
    // parallelism keeps connection-pool pressure bounded and matches the
    // rls-negative-tests pool config.
    pool: 'forks',
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
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
