import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@sep/custody-conformance-tests',
    globals: false,
    environment: 'node',
    include: ['**/conformance.test.ts'],
    // openpgp.generateKey + real Vault KV round-trips make the suite
    // heavier than unit tests. Keep per-file fork pool with serial
    // execution so Vault contention stays predictable.
    pool: 'forks',
    fileParallelism: false,
    // beforeAll generates keypairs (curve25519 is ~100ms each but we
    // allocate several) and seeds Vault; allow headroom for CI runners.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
