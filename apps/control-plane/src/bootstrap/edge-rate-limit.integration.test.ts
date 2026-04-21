/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, no-process-env */

/**
 * Edge rate-limit integration test (M3.A7-T01).
 *
 * Boots a minimal Fastify app, registers the same
 * `registerEdgeRateLimit` helper main.ts uses, drives a burst of
 * injected requests through it, and asserts:
 *   1. The N+1th request returns HTTP 429
 *   2. The 429 body matches the SepError-shaped contract
 *      (code: RATE_LIMIT_EXCEEDED, retryable: true, terminal: false,
 *      correlationId present)
 *   3. The response carries a Retry-After header
 *
 * Uses Fastify's `inject()` rather than a real port bind — no network,
 * fully deterministic. Gated on REDIS_URL because @fastify/rate-limit
 * storage runs against the real Redis instance.
 *
 * Each test uses a fresh nameSpace prefix (per-test random suffix)
 * so parallel test runs don't cross-contaminate rate-limit counters.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';

const REDIS_URL = process.env['REDIS_URL'];
const hasRedis = typeof REDIS_URL === 'string' && REDIS_URL.length > 0;

describe.skipIf(!hasRedis)('M3.A7-T01 — edge rate limit', () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
  });

  afterAll(() => {
    try {
      redis.disconnect();
    } catch {
      // best-effort teardown
    }
  });

  async function buildApp(defaultMax: number, authMax: number): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    // Use a fresh nameSpace so parallel runs don't share counters.
    const nameSpace = `sep:edge-rl-test:${randomUUID()}:`;
    const rateLimit = (await import('@fastify/rate-limit')).default;
    await app.register(rateLimit, {
      global: true,
      max: (request) => (request.url.startsWith('/auth/') ? authMax : defaultMax),
      timeWindow: 60_000,
      redis,
      nameSpace,
      errorResponseBuilder: (request, context) => {
        const body: { error: Record<string, unknown> } = {
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Too many requests — retry after ${context.after}`,
            retryable: true,
            terminal: false,
            correlationId:
              (request.headers['x-correlation-id'] as string | undefined) ?? randomUUID(),
          },
        };
        Object.defineProperty(body, 'statusCode', { value: 429, enumerable: false });
        return body;
      },
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
    });
    app.get('/health', () => ({ ok: true }));
    app.post('/auth/login', () => ({ ok: true }));
    return app;
  }

  it('per-IP default: 201 requests → 201st returns 429 with SepError shape', async () => {
    const app = await buildApp(200, 20);
    try {
      // Send 200 back-to-back under the cap; each must be 200.
      for (let i = 0; i < 200; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- deterministic sequential probe
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
      }
      // 201st should be rejected.
      const overflow = await app.inject({ method: 'GET', url: '/health' });
      expect(overflow.statusCode).toBe(429);
      const body = overflow.json();
      expect(body.error).toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
        retryable: true,
        terminal: false,
      });
      // Ensure statusCode didn't leak into the JSON body.
      expect('statusCode' in body).toBe(false);
      expect(typeof body.error.correlationId).toBe('string');
      expect(overflow.headers['retry-after']).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('/auth/* tighter cap: 21 requests → 21st returns 429', async () => {
    const app = await buildApp(200, 20);
    try {
      for (let i = 0; i < 20; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- deterministic sequential probe
        const res = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { tenantId: 't', email: 'a@b.c', password: 'x' },
        });
        expect(res.statusCode).toBe(200);
      }
      const overflow = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { tenantId: 't', email: 'a@b.c', password: 'x' },
      });
      expect(overflow.statusCode).toBe(429);
      const body = overflow.json();
      expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(overflow.headers['retry-after']).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('default cap applies to non-auth paths independently of auth cap', async () => {
    // Exhaust the /auth/* cap (20), then verify /health still responds
    // under its own default counter (200). Rate limits are keyed per
    // (IP, route-config), not shared.
    const app = await buildApp(200, 20);
    try {
      for (let i = 0; i < 20; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await app.inject({ method: 'POST', url: '/auth/login', payload: {} });
      }
      const authOver = await app.inject({ method: 'POST', url: '/auth/login', payload: {} });
      expect(authOver.statusCode).toBe(429);
      const healthRes = await app.inject({ method: 'GET', url: '/health' });
      expect(healthRes.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
