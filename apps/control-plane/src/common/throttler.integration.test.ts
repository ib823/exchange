/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, no-process-env */

/**
 * Nest throttler integration (M3.A7-T02).
 *
 * Boots a MINIMAL Nest module (ThrottlerModule + one test controller)
 * against real Redis, fires the same sequence main.ts would see, and
 * asserts the (IP, email) tuple tracker + <no-email> fallback bucket
 * behave correctly. Deliberately NOT booting the full AppModule
 * because (a) it needs Vault + Postgres + JWT secret env the narrow
 * test doesn't care about, and (b) this test's goal is the throttler
 * wiring itself — unit tests cover the trackers' logic in isolation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Controller, Module, Post, Body, Injectable } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ThrottlerModule, Throttle } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { SepThrottlerGuard } from './guards/sep-throttler.guard';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { THROTTLER_NAMES, loginEmailTracker } from './throttler-config';

const REDIS_URL = process.env['REDIS_URL'];
const hasRedis = typeof REDIS_URL === 'string' && REDIS_URL.length > 0;

// Controller mirroring what auth.controller does on login: public,
// Throttle({authLogin: ...}). Returns 200 on any body.
@Injectable()
class FakeLoginController {}

@Controller('auth')
class TestAuthController {
  @Post('login')
  @Throttle({
    [THROTTLER_NAMES.authLogin]: { limit: 5, ttl: 15 * 60_000 },
  })
  login(@Body() _body: unknown): { ok: true } {
    return { ok: true };
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
      storage: new ThrottlerStorageRedisService(
        new Redis(REDIS_URL ?? 'redis://localhost:6379', {
          // Fresh prefix per test run so we don't clash with parallel runs
          // or with main.ts's 'sep:throttler:' namespace.
          keyPrefix: `sep:throttler-test:${Date.now()}:`,
          lazyConnect: false,
          maxRetriesPerRequest: 3,
        }),
      ),
    }),
  ],
  controllers: [TestAuthController],
  providers: [FakeLoginController, { provide: APP_GUARD, useClass: SepThrottlerGuard }],
})
class TestThrottlerModule {}

describe.skipIf(!hasRedis)('M3.A7-T02 — Nest throttler (authLogin tracker)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestThrottlerModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('6th login attempt with same (IP, email) returns 429 with RATE_LIMIT_EXCEEDED', async () => {
    const email = `int-${Date.now()}-a@example.test`;
    const payload = { tenantId: 't', email, password: 'x' };
    const fastify = app.getHttpAdapter().getInstance();

    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fastify.inject({ method: 'POST', url: '/auth/login', payload });
      expect(res.statusCode).toBe(201); // Nest default POST status when no @HttpCode
    }
    const overflow = await fastify.inject({ method: 'POST', url: '/auth/login', payload });
    expect(overflow.statusCode).toBe(429);
    const body = overflow.json();
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.error.retryable).toBe(true);
    expect(body.error.terminal).toBe(false);
    expect(typeof body.error.correlationId).toBe('string');
  });

  it('different email from the same IP gets its own bucket', async () => {
    const ts = Date.now();
    const emailA = `int-${ts}-ipshare-a@example.test`;
    const emailB = `int-${ts}-ipshare-b@example.test`;
    const fastify = app.getHttpAdapter().getInstance();

    // Burn emailA's full cap (5) + one 429.
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fastify.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { tenantId: 't', email: emailA, password: 'x' },
      });
    }
    // emailB still has its own 5-budget.
    const res = await fastify.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { tenantId: 't', email: emailB, password: 'x' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('malformed-email shapes all collapse to <no-email> bucket (watchpoint)', async () => {
    const fastify = app.getHttpAdapter().getInstance();
    const shapes = [
      { tenantId: 't', password: 'x' }, // missing email
      { tenantId: 't', email: '', password: 'x' },
      { tenantId: 't', email: '   ', password: 'x' },
      { tenantId: 't', email: 42, password: 'x' },
      { tenantId: 't', email: null, password: 'x' },
    ];
    for (const payload of shapes) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fastify.inject({ method: 'POST', url: '/auth/login', payload });
      expect(res.statusCode).toBe(201);
    }
    const overflow = await fastify.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { tenantId: 't', email: '', password: 'x' },
    });
    expect(overflow.statusCode).toBe(429);
    expect(overflow.json().error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
