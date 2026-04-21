/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, no-process-env */

/**
 * M3.A4-T06 integration scenarios.
 *
 * The 4th scenario (cross-tenant RLS on refresh_tokens) is owned by
 * the existing M3.A1-T06 suite at
 *   tests/integration/rls-negative-tests/refresh-tokens.rls-negative.test.ts
 * which asserts the 8-part negative-access matrix (SELECT/INSERT/
 * UPDATE/DELETE against the other tenant + tenantId-mismatch insert
 * attempts). The three scenarios that remain are the auth-specific
 * ones — they exercise control-plane SERVICES (not just DB policy)
 * so they live in the control-plane package and run via
 * `pnpm --filter @sep/control-plane test:integration`.
 *
 * Gate: DATABASE_URL + RUNTIME_DATABASE_URL (Postgres) and REDIS_URL
 * (Redis). If any is missing the suite skips. Matches the
 * rls-negative-tests gating contract.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hash as argon2Hash } from '@node-rs/argon2';
import Redis from 'ioredis';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '@sep/db';
import { ErrorCode } from '@sep/common';
import { LoginService } from './login.service';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';
import { MfaChallengeStore } from './mfa-challenge-store.service';
import { hmacToken } from './refresh-hmac-key.provider';

const MIGRATION_URL = process.env['DATABASE_URL'];
const RUNTIME_URL = process.env['RUNTIME_DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'];
const hasPostgres =
  typeof MIGRATION_URL === 'string' &&
  MIGRATION_URL.length > 0 &&
  typeof RUNTIME_URL === 'string' &&
  RUNTIME_URL.length > 0;
const hasRedis = typeof REDIS_URL === 'string' && REDIS_URL.length > 0;

// Fixed cuid shape matching CuidSchema (leading 'c' + lowercase alnum).
// Disjoint from the rls-negative-tests tenants so we don't race on
// teardown/seed with that suite running in parallel.
const TENANT_ID = 'cauthlifecyclet06tenant0001';

// Use a pre-computed argon2id hash of 'CorrectPassword!' so the test
// doesn't pay the hashing cost on every test. Hashes are not secrets
// (we're testing lockout math, not argon2). Computed once offline:
//   $argon2id$v=19$... — regenerated in beforeAll to avoid committing
//   a fixed hash.
let knownPasswordHash: string;
const CORRECT_PASSWORD = 'CorrectPassword!';
const WRONG_PASSWORD = 'WrongPassword!';

describe.skipIf(!hasPostgres)('M3.A4-T06 — auth lifecycle integration (Postgres)', () => {
  let seedClient: PrismaClient;
  let runtimeClient: PrismaClient;
  let db: DatabaseService;
  let hmacKey: Buffer;
  let loginService: LoginService;
  let refreshTokenService: RefreshTokenService;

  beforeAll(async () => {
    seedClient = new PrismaClient({
      ...(MIGRATION_URL !== undefined && { datasourceUrl: MIGRATION_URL }),
    });
    runtimeClient = new PrismaClient({
      ...(RUNTIME_URL !== undefined && { datasourceUrl: RUNTIME_URL }),
    });
    db = new DatabaseService(runtimeClient);

    // Shared HMAC key for the RefreshTokenService under test. Real
    // prod key lives in Vault; for the integration test we construct
    // a deterministic 32-byte buffer so recomputing hashes matches.
    hmacKey = Buffer.alloc(32, 0x7a);

    // AuthService needs JwtService + DatabaseService. We only exercise
    // issueToken (not validateApiKey) so the DB stub is unused but
    // required to satisfy the constructor type.
    const jwt = new JwtService({ secret: 'integration-test-secret' });
    const authService = new AuthService(jwt, db);
    refreshTokenService = new RefreshTokenService(db, hmacKey);
    loginService = new LoginService(db, jwt, authService, refreshTokenService);

    await seedClient.tenant.upsert({
      where: { id: TENANT_ID },
      update: {},
      create: {
        id: TENANT_ID,
        name: 'Auth-Lifecycle Integration Tenant',
        legalEntityName: 'Auth-Lifecycle T06 LLC',
      },
    });

    knownPasswordHash = await argon2Hash(CORRECT_PASSWORD);
  });

  afterAll(async () => {
    await seedClient.refreshToken.deleteMany({ where: { tenantId: TENANT_ID } });
    await seedClient.user.deleteMany({ where: { tenantId: TENANT_ID } });
    await seedClient.$disconnect();
    await runtimeClient.$disconnect();
  });

  describe('Scenario 1 — concurrent wrong-password attempts produce atomic lockout', () => {
    // 15 parallel wrong-password attempts against a single user. The
    // atomic CASE UPDATE must produce failedLoginAttempts = 10 exactly
    // (the 11-15th serialise on the row lock after the account is
    // already locked). Asserts ADR-0008's atomicity claim — no races
    // where two parallel "counter was 9, set to 10" updates both run.
    const email = 't06-concurrent-lockout@sep.test';

    beforeEach(async () => {
      await seedClient.user.deleteMany({ where: { tenantId: TENANT_ID, email } });
      await seedClient.user.create({
        data: {
          tenantId: TENANT_ID,
          email,
          displayName: 'Concurrent lockout test user',
          passwordHash: knownPasswordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastFailedAt: null,
        },
      });
    });

    it('15 parallel wrong-password requests end with failedLoginAttempts = 10 and lockedUntil set', async () => {
      const attempts = Array.from({ length: 15 }, () =>
        loginService
          .validatePassword(TENANT_ID, email, WRONG_PASSWORD)
          .catch((err: unknown) => err),
      );
      const results = await Promise.all(attempts);

      for (const r of results) {
        // Some errors are AUTH_INVALID_CREDENTIALS (pre-lockout failures);
        // others land after lockout and surface as AUTH_ACCOUNT_LOCKED.
        const code = (r as { response?: { code?: string } }).response?.code;
        expect([ErrorCode.AUTH_INVALID_CREDENTIALS, ErrorCode.AUTH_ACCOUNT_LOCKED]).toContain(code);
      }

      const user = await seedClient.user.findFirst({
        where: { tenantId: TENANT_ID, email },
        select: { failedLoginAttempts: true, lockedUntil: true },
      });
      expect(user).not.toBeNull();
      expect(user?.failedLoginAttempts).toBe(10);
      expect(user?.lockedUntil).not.toBeNull();
      expect(user?.lockedUntil instanceof Date ? user.lockedUntil.getTime() : 0).toBeGreaterThan(
        Date.now(),
      );
    });
  });

  describe('Scenario 2 — refresh token chain revocation on replay', () => {
    // Issue A, rotate A→B, rotate B→C, then present A again (replay).
    // All three rows must end with revokedAt set and
    // revocationReason='replay-detected'.
    const email = 't06-chain-revocation@sep.test';
    let userId: string;

    beforeEach(async () => {
      await seedClient.refreshToken.deleteMany({ where: { tenantId: TENANT_ID } });
      await seedClient.user.deleteMany({ where: { tenantId: TENANT_ID, email } });
      const u = await seedClient.user.create({
        data: {
          tenantId: TENANT_ID,
          email,
          displayName: 'Chain revocation test user',
        },
      });
      userId = u.id;
    });

    it('replaying A after chain A→B→C revokes all three with reason=replay-detected', async () => {
      // Issue A via the service's public API (forTenant wrapper).
      const issuedA = await db.forTenant(TENANT_ID, (tx) =>
        refreshTokenService.issue(tx, TENANT_ID, userId),
      );

      // Rotate A → B
      const resultB = await refreshTokenService.refresh(issuedA.token);
      expect(resultB.userId).toBe(userId);

      // Rotate B → C
      const resultC = await refreshTokenService.refresh(resultB.refreshToken.token);
      expect(resultC.userId).toBe(userId);

      // Replay A → chain revocation
      await expect(refreshTokenService.refresh(issuedA.token)).rejects.toMatchObject({
        response: expect.objectContaining({ code: ErrorCode.AUTH_REFRESH_TOKEN_REPLAY }),
      });

      const tokens = await seedClient.refreshToken.findMany({
        where: { tenantId: TENANT_ID, userId },
        select: {
          tokenHash: true,
          revokedAt: true,
          revocationReason: true,
          replacedById: true,
        },
      });
      // A, B, C — three rows.
      expect(tokens).toHaveLength(3);
      for (const t of tokens) {
        expect(t.revokedAt).not.toBeNull();
        expect(t.revocationReason).toBe('replay-detected');
      }
      // The chain's linkage survived revocation — we didn't drop the
      // audit trail.
      const hashA = hmacToken(issuedA.token, hmacKey);
      const hashB = hmacToken(resultB.refreshToken.token, hmacKey);
      type TokenRow = (typeof tokens)[number];
      const rowA = tokens.find((t: TokenRow) => t.tokenHash === hashA);
      const rowB = tokens.find((t: TokenRow) => t.tokenHash === hashB);
      expect(rowA?.replacedById).not.toBeNull();
      expect(rowB?.replacedById).not.toBeNull();
    });
  });
});

describe.skipIf(!hasRedis)('M3.A4-T06 — MFA challenge single-use (Redis)', () => {
  let redis: Redis;
  let store: MfaChallengeStore;

  beforeAll(() => {
    redis = new Redis(REDIS_URL ?? 'redis://localhost:6379');
    store = new MfaChallengeStore(redis);
  });

  afterAll(async () => {
    try {
      await store.onModuleDestroy();
    } catch {
      // onModuleDestroy calls quit() — safe to swallow on teardown.
    }
  });

  describe('Scenario 3 — SET NX EX atomicity under concurrent consume', () => {
    // 20 parallel consume() calls against the same challengeId.
    // Redis SET NX EX guarantees exactly one returns {consumed: true},
    // the rest {consumed: false}. Asserts the atomicity property
    // called out in ADR-0008's "why SET NX EX over a separate
    // GET-check-SET" section.
    it('exactly one of 20 concurrent consume() calls returns consumed=true', async () => {
      const challengeId = `t06-concurrent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const results = await Promise.all(
        Array.from({ length: 20 }, () => store.consume(challengeId)),
      );
      const winners = results.filter((r) => r.consumed === true);
      const losers = results.filter((r) => r.consumed === false);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(19);
      for (const l of losers) {
        expect((l as { reason?: string }).reason).toBe('already-consumed');
      }
    });
  });
});
