/**
 * MFA challenge single-use enforcement via Redis (M3.A4-T04).
 *
 * The challenge token issued in T03's login path is a stateless JWT
 * (typ: 'mfa_challenge') with a 5-minute expiry and a unique
 * challengeId. Redis tracks which challengeIds have been consumed
 * so a captured token can't be replayed even within its validity
 * window.
 *
 * Consumption model: SET key NX EX — first call to consume wins,
 * every subsequent call fails closed. TTL > JWT expiry so a
 * consumed token's Redis key outlives the JWT itself (the JWT
 * verify would have rejected it before the Redis check anyway).
 *
 * Key namespace: `sep:mfa-challenge:<challengeId>`. The `sep:`
 * prefix keeps this separate from future Redis tenants in the
 * same instance and makes debug scans easy to scope.
 *
 * Single-attempt-per-challenge discipline: a wrong TOTP code
 * burns the challenge. User must restart the login flow. Tradeoff:
 * legitimate typos require re-login; attackers can't brute-force
 * the 6-digit TOTP space against a single issued challenge. For a
 * high-value MFA path this is the right posture — 10 wrong-TOTP
 * attempts (each with a fresh challenge) still hits the
 * password-login lockout in T03.
 */

import { Injectable, OnModuleDestroy, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { createLogger } from '@sep/observability';

const logger = createLogger({ service: 'control-plane', module: 'mfa-challenge-store' });

const CHALLENGE_KEY_PREFIX = 'sep:mfa-challenge:';
/**
 * Redis TTL for the consumed marker. Set to JWT_EXPIRY + 10s buffer
 * so a challengeId's consumed marker outlives the JWT (the JWT
 * verify would have rejected it before this check anyway, but
 * belt-and-suspenders against clock skew between JWT exp and
 * Redis TTL).
 */
const CONSUMED_MARKER_TTL_SECONDS = 310;

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export type ConsumeResult =
  | { readonly consumed: true }
  | { readonly consumed: false; readonly reason: 'already-consumed' };

@Injectable()
export class MfaChallengeStore implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Try to consume a challengeId. Returns `{ consumed: true }` if
   * this is the first call for this challengeId within the TTL
   * window, `{ consumed: false, reason: 'already-consumed' }` if
   * a prior call already marked it.
   *
   * Note: this does NOT verify the JWT — the caller must have done
   * that first. This service only enforces single-use.
   */
  async consume(challengeId: string): Promise<ConsumeResult> {
    if (challengeId.length === 0) {
      return { consumed: false, reason: 'already-consumed' };
    }
    const key = `${CHALLENGE_KEY_PREFIX}${challengeId}`;
    // SET key 'consumed' NX EX 310 — atomic "set if absent with
    // TTL" returns 'OK' on success, null when the key already
    // exists.
    const result = await this.redis.set(key, 'consumed', 'EX', CONSUMED_MARKER_TTL_SECONDS, 'NX');
    if (result === 'OK') {
      return { consumed: true };
    }
    logger.info({ challengeId }, 'MFA challenge already consumed');
    return { consumed: false, reason: 'already-consumed' };
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (err) {
      logger.warn({ err: String(err) }, 'Redis quit raised — continuing shutdown');
    }
  }
}
