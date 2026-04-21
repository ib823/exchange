/**
 * Edge rate-limit registration (M3.A7-T01).
 *
 * Extracted from `main.ts` so integration tests can exercise the same
 * wiring against a test-booted NestFastifyApplication. The registration
 * is idempotent per Fastify's plugin semantics — don't call twice.
 *
 * Why per-IP at the edge (not per-user):
 *   The edge sits before any authentication / body parse. Per-IP is
 *   the only key available for pre-auth floods. User/tenant keying is
 *   layered on top via `@nestjs/throttler` in T02.
 *
 * Why a separate Redis client (not the one AuthModule uses):
 *   Storage isolation. Rate-limit traffic can spike an order of
 *   magnitude above MFA-challenge traffic; sharing a connection would
 *   mean a rate-limit burst delays MFA consume commands.
 */

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import type { createLogger } from '@sep/observability';
import { randomUUID } from 'crypto';

type Logger = ReturnType<typeof createLogger>;

export interface EdgeRateLimitOptions {
  readonly redis: Redis;
  readonly defaultMax: number;
  readonly authMax: number;
  readonly windowMs: number;
  /**
   * Logger used for onExceeded warnings. Must be the same Pino
   * instance as the rest of bootstrap so correlationId / module
   * bindings propagate.
   */
  readonly logger: Logger;
  /**
   * The `apiPrefix` prefix (e.g. 'api') — used to detect /auth/*
   * paths under the prefixed + versioned namespace.
   */
  readonly apiPrefix: string;
}

export async function registerEdgeRateLimit(
  app: NestFastifyApplication,
  opts: EdgeRateLimitOptions,
): Promise<void> {
  const mod = await import('@fastify/rate-limit');
  const rateLimit = mod.default;
  await app.register(rateLimit, {
    global: true,
    max: (request: FastifyRequest): number =>
      isAuthPath(request.url, opts.apiPrefix) ? opts.authMax : opts.defaultMax,
    timeWindow: opts.windowMs,
    redis: opts.redis,
    nameSpace: 'sep:edge-rl:',
    errorResponseBuilder: (
      request: FastifyRequest,
      context: { after: string; max: number; ttl: number },
    ): { error: Record<string, unknown> } => {
      const correlationId =
        (request.headers['x-correlation-id'] as string | undefined) ?? randomUUID();
      // The rate-limit library throws this return value and Fastify
      // reads `statusCode` off the thrown value to pick the HTTP
      // status. We define it non-enumerable so it carries the
      // Fastify-side 429 routing but stays off the JSON body the
      // client sees.
      const body: { error: Record<string, unknown> } = {
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests — retry after ${context.after}`,
          retryable: true,
          terminal: false,
          correlationId,
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
    onExceeded: (request: FastifyRequest, _key: string): void => {
      opts.logger.warn(
        { ip: request.ip, url: request.url, method: request.method },
        'Edge rate limit exceeded',
      );
    },
  });
}

/**
 * Match /auth/* under the three most-likely prefix/version shapes we
 * emit in bootstrap. Keeping the match inclusive rather than strict
 * means a future route versioning change still catches the auth paths
 * — which is the safe-default direction for a tighter limit.
 */
function isAuthPath(url: string, apiPrefix: string): boolean {
  return (
    url.startsWith('/auth/') ||
    url.startsWith(`/${apiPrefix}/auth/`) ||
    url.startsWith(`/${apiPrefix}/v1/auth/`)
  );
}
