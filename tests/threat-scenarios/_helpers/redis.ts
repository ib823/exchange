/**
 * Redis client helpers for threat scenarios (M3.A8).
 */

import Redis from 'ioredis';

export const REDIS_URL: string | undefined = process.env['REDIS_URL'];
export const hasRedis: boolean = typeof REDIS_URL === 'string' && REDIS_URL.length > 0;

/**
 * Make a fresh Redis client with a scenario-unique key prefix. Tests
 * should close via `.disconnect()` in afterAll.
 *
 * Prefix is `sep:threat:<scenario>:` so a scanning ops view can
 * filter threat-test state out of a shared Redis without disturbing
 * production keyspaces.
 */
export function makeRedis(scenarioId: string): Redis {
  return new Redis(REDIS_URL ?? 'redis://localhost:6379', {
    keyPrefix: `sep:threat:${scenarioId}:`,
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });
}
