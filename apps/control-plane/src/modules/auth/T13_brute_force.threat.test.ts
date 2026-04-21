/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, no-await-in-loop, no-process-env */

/**
 * Threat scenario T13 — Brute-force login (M3.A8).
 *
 * Plan §6 scenario ID: T13. Primary control: rate limiting (edge +
 * NestJS throttler) AND M3.A4 account lockout. This test proves
 * BOTH layers fire, in the right order, against a brute-force
 * attack on a single user's email.
 *
 * Defense-in-depth narrative:
 *   - Controller throttler fires at 5 attempts per (IP, email) /
 *     15min. Beyond that, login requests get 429 before LoginService
 *     even runs. This protects the lockout counter from being
 *     exhausted by a trivial flood.
 *   - M3.A4 lockout fires at 10 total failures within a 30-min
 *     window. An attacker who bypasses the throttler (via multiple
 *     IPs, or by waiting out the 15-min window) still gets capped
 *     at the user level.
 *   - A locked account returns AUTH_ACCOUNT_LOCKED even on CORRECT
 *     password until lockedUntil passes.
 *
 * Lives inside apps/control-plane (not tests/threat-scenarios/)
 * because it imports LoginService + SepThrottlerGuard directly.
 * Picked up by vitest.integration.config.ts's `**\/*.threat.test.ts`
 * include glob. See `_plan/M3_A8_SELF_REVIEW.md` for the full
 * scenario-to-host-package map.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Controller, Module, Post, Body, Inject } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ZodValidationPipe } from 'nestjs-zod';
import { ThrottlerModule, Throttle } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { hash as argon2Hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { DatabaseService } from '@sep/db';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { SepThrottlerGuard } from '../../common/guards/sep-throttler.guard';
import { THROTTLER_NAMES, loginEmailTracker } from '../../common/throttler-config';
import { LoginService } from './login.service';
import { AuthService } from './auth.service';

// Scenario-local constants (inlined from tests/threat-scenarios/_helpers/
// to avoid cross-workspace deep imports; see the M3.A8 self-review for
// the scaffolding-vs-in-package tradeoff).
const SCENARIO_ID = 'T13_brute_force_login';
const TENANT_ID = 'cthreatsc13bruteforceown1';
const VICTIM_EMAIL = 't13-brute-force-victim@sep.test';
const CORRECT_PASSWORD = 'correct-horse-battery-staple-2026';
const WRONG_PASSWORD = 'wrong-password-guess';

const MIGRATION_URL = process.env['DATABASE_URL'];
const RUNTIME_URL = process.env['RUNTIME_DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'];
const hasInfra =
  typeof MIGRATION_URL === 'string' &&
  typeof RUNTIME_URL === 'string' &&
  typeof REDIS_URL === 'string';

describe.skipIf(!hasInfra)(
  `[${SCENARIO_ID}] brute-force login hits rate-limit BEFORE exhausting lockout counter`,
  () => {
    let app: NestFastifyApplication;
    let seedClient: PrismaClient;
    let runtimeClient: PrismaClient;
    let redis: Redis;
    /**
     * Admin Redis client WITHOUT keyPrefix so beforeEach can DEL
     * the fully-qualified throttler keys. ioredis applies keyPrefix
     * to all commands (including DEL) but returns keys from KEYS/SCAN
     * with the prefix baked in — deleting those via the prefixed
     * client would double-prefix and no-op. The admin client sees the
     * raw Redis keyspace.
     */
    let redisAdmin: Redis;
    let prefix: string;

    beforeAll(async () => {
      seedClient = new PrismaClient({
        ...(MIGRATION_URL !== undefined && { datasourceUrl: MIGRATION_URL }),
      });
      runtimeClient = new PrismaClient({
        ...(RUNTIME_URL !== undefined && { datasourceUrl: RUNTIME_URL }),
      });
      const db = new DatabaseService(runtimeClient);

      // Scenario-scoped keyPrefix isolates throttler state across
      // parallel threat-suite runs.
      prefix = `sep:threat:${SCENARIO_ID}:${String(Date.now())}:`;
      redis = new Redis(REDIS_URL ?? 'redis://localhost:6379', {
        keyPrefix: prefix,
        lazyConnect: false,
        maxRetriesPerRequest: 3,
      });
      redisAdmin = new Redis(REDIS_URL ?? 'redis://localhost:6379', {
        lazyConnect: false,
        maxRetriesPerRequest: 3,
      });

      // Upsert the scenario tenant (idempotent) + seed victim with a
      // real argon2id password hash.
      await seedClient.tenant.upsert({
        where: { id: TENANT_ID },
        update: {},
        create: {
          id: TENANT_ID,
          name: `Threat-Scenario ${SCENARIO_ID}`,
          legalEntityName: `Threat-Scenario ${SCENARIO_ID} LLC`,
        },
      });
      await seedClient.user.deleteMany({ where: { tenantId: TENANT_ID, email: VICTIM_EMAIL } });
      const passwordHash = await argon2Hash(CORRECT_PASSWORD);
      await seedClient.user.create({
        data: {
          tenantId: TENANT_ID,
          email: VICTIM_EMAIL,
          displayName: 'Brute Force Victim',
          passwordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });

      // Controller declared inside beforeAll — at this scope, tsc's
      // emitDecoratorMetadata doesn't propagate the constructor
      // parameter types reliably, so we use an explicit injection
      // token.
      @Controller('auth')
      class TestLoginController {
        constructor(@Inject(LoginService) private readonly login: LoginService) {}

        @Throttle({
          [THROTTLER_NAMES.authLogin]: { limit: 5, ttl: 15 * 60_000 },
        })
        @Post('login')
        async loginRoute(
          @Body() body: { tenantId: string; email: string; password: string },
        ): Promise<unknown> {
          return this.login.validatePassword(body.tenantId, body.email, body.password);
        }
      }

      @Module({
        imports: [
          ThrottlerModule.forRoot({
            throttlers: [
              { name: THROTTLER_NAMES.default, ttl: 60_000, limit: 1000 },
              {
                name: THROTTLER_NAMES.authLogin,
                ttl: 15 * 60_000,
                limit: 5,
                getTracker: loginEmailTracker,
              },
            ],
            storage: new ThrottlerStorageRedisService(redis),
          }),
        ],
        controllers: [TestLoginController],
        providers: [
          Reflector,
          { provide: DatabaseService, useValue: db },
          { provide: JwtService, useValue: { sign: (): string => 'unused-in-t13' } },
          {
            // AuthService.issueToken lives on the success path; T13
            // focuses on the PRE-issue layers (throttler + lockout),
            // so a stub return is sufficient.
            provide: AuthService,
            useValue: {
              issueToken: (): { accessToken: string; expiresIn: string } => ({
                accessToken: 'test-access',
                expiresIn: '15m',
              }),
            },
          },
          {
            // RefreshTokenService.issue is called on the no-MFA
            // success branch. Same stub rationale.
            provide: 'RefreshTokenServiceMock',
            useValue: {
              issue: (): Promise<{ token: string; expiresAt: Date }> =>
                Promise.resolve({
                  token: 'test-refresh',
                  expiresAt: new Date(Date.now() + 86_400_000),
                }),
            },
          },
          {
            provide: LoginService,
            useFactory: (
              database: DatabaseService,
              jwt: JwtService,
              auth: AuthService,
              refresh: unknown,
            ): LoginService => new LoginService(database, jwt, auth, refresh as never),
            inject: [DatabaseService, JwtService, AuthService, 'RefreshTokenServiceMock'],
          },
          { provide: APP_GUARD, useClass: SepThrottlerGuard },
        ],
      })
      class T13TestModule {}

      const moduleRef = await Test.createTestingModule({ imports: [T13TestModule] }).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalFilters(new HttpExceptionFilter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
    }, 30_000);

    afterAll(async () => {
      await app.close();
      await seedClient.user.deleteMany({ where: { tenantId: TENANT_ID, email: VICTIM_EMAIL } });
      await seedClient.$disconnect();
      await runtimeClient.$disconnect();
      redis.disconnect();
      redisAdmin.disconnect();
    }, 30_000);

    // Reset state between tests so each scenario starts clean. Use
    // the admin client (no keyPrefix) so DEL operates on the fully-
    // qualified keys KEYS returns.
    beforeEach(async () => {
      await seedClient.user.updateMany({
        where: { tenantId: TENANT_ID, email: VICTIM_EMAIL },
        data: { failedLoginAttempts: 0, lockedUntil: null, lastFailedAt: null },
      });
      const keys = await redisAdmin.keys(`${prefix}*`);
      if (keys.length > 0) {
        await redisAdmin.del(...keys);
      }
    });

    function postLogin(
      email: string,
      password: string,
    ): Promise<{
      statusCode: number;
      json(): { error?: { code?: string; message?: string } };
    }> {
      return app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: 'POST',
          url: '/auth/login',
          payload: { tenantId: TENANT_ID, email, password },
        });
    }

    it('5 wrong-password attempts reach LoginService → counter = 5, no 429, no lockout', async () => {
      for (let i = 0; i < 5; i += 1) {
        const res = await postLogin(VICTIM_EMAIL, WRONG_PASSWORD);
        expect(res.statusCode).toBe(401);
      }
      const user = await seedClient.user.findFirst({
        where: { tenantId: TENANT_ID, email: VICTIM_EMAIL },
        select: { failedLoginAttempts: true, lockedUntil: true },
      });
      expect(user?.failedLoginAttempts).toBe(5);
      expect(user?.lockedUntil).toBeNull();
    });

    it('6th wrong-password attempt returns 429 RATE_LIMIT_EXCEEDED — throttler fires BEFORE LoginService', async () => {
      for (let i = 0; i < 5; i += 1) {
        await postLogin(VICTIM_EMAIL, WRONG_PASSWORD);
      }
      const overflow = await postLogin(VICTIM_EMAIL, WRONG_PASSWORD);
      expect(overflow.statusCode).toBe(429);
      const body = overflow.json();
      expect(body.error?.code).toBe('RATE_LIMIT_EXCEEDED');
      // Load-bearing: counter stays at 5 because the guard blocked
      // before LoginService ran. Attacker can't freely ratchet the
      // lockout counter — throttler caps them at 5 per 15min window.
      const user = await seedClient.user.findFirst({
        where: { tenantId: TENANT_ID, email: VICTIM_EMAIL },
        select: { failedLoginAttempts: true },
      });
      expect(user?.failedLoginAttempts).toBe(5);
    });

    it('after throttler reset, attempts 6-10 reach LoginService and the 10th triggers account lockout', async () => {
      // Burn 5, then reset the throttler counter (simulates the
      // attacker waiting out the 15-min window OR moving to a new
      // IP). Post-reset, 5 more attempts reach LoginService.
      for (let i = 0; i < 5; i += 1) {
        await postLogin(VICTIM_EMAIL, WRONG_PASSWORD);
      }
      const keysBefore = await redisAdmin.keys(`${prefix}*`);
      if (keysBefore.length > 0) {
        await redisAdmin.del(...keysBefore);
      }
      for (let i = 0; i < 5; i += 1) {
        const res = await postLogin(VICTIM_EMAIL, WRONG_PASSWORD);
        expect(res.statusCode).toBe(401);
      }
      const user = await seedClient.user.findFirst({
        where: { tenantId: TENANT_ID, email: VICTIM_EMAIL },
        select: { failedLoginAttempts: true, lockedUntil: true },
      });
      expect(user?.failedLoginAttempts).toBe(10);
      expect(user?.lockedUntil).not.toBeNull();
      expect(user?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    });

    it('locked account: correct password still returns AUTH_ACCOUNT_LOCKED until lockedUntil passes', async () => {
      // Pre-lock the user directly so this test doesn't depend on
      // the prior test's residual state.
      const lockedUntil = new Date(Date.now() + 30 * 60_000);
      await seedClient.user.updateMany({
        where: { tenantId: TENANT_ID, email: VICTIM_EMAIL },
        data: { failedLoginAttempts: 10, lockedUntil },
      });

      const res = await postLogin(VICTIM_EMAIL, CORRECT_PASSWORD);
      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error?.code).toBe('AUTH_ACCOUNT_LOCKED');
      expect(body.error?.message).toContain('locked until');
    });
  },
);
