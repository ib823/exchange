/**
 * Per-tenant daily submission quota (M3.A7-T03 / NEW).
 *
 * Keeps a Redis counter per-tenant per-UTC-day. Service tier drives
 * the cap:
 *   STANDARD  → 10 000 submissions/day (plan default)
 *   DEDICATED → 100 000 submissions/day
 *   PRIVATE   → effectively unlimited (Number.MAX_SAFE_INTEGER)
 *
 * Key shape: `quota:<tenantId>:<YYYY-MM-DD>` (UTC). TTL set to 48h
 * on first INCR so the counter survives across a day-rollover race
 * but auto-expires after the billing day is safely closed.
 *
 * Concurrency: INCR returns the post-increment value, so if two
 * concurrent callers push the counter past the limit, both see the
 * over-limit value. To keep the count honest under concurrent
 * rejects we DECR on the reject path (best-effort refund). This
 * races benignly — worst case the counter reads 1-2 above the real
 * consumed count for a few hundred ms.
 *
 * Why a separate Redis connection (not the MFA / edge / throttler
 * clients): layer isolation. A submission-burst from one tenant
 * shouldn't slow MFA consume commands for another.
 *
 * Why BEFORE the DB write (not after): charging before the write
 * bounds the counter at the actual-plus-a-few-concurrent-refund-in-
 * flight. Charging after means N concurrent writes all succeed
 * before any quota check, and only one fails — letting the tenant
 * burst up to Nth of their cap in a single tick.
 */

import { Injectable, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { SepError, ErrorCode, getConfig } from '@sep/common';
import { createLogger } from '@sep/observability';

const logger = createLogger({ service: 'control-plane', module: 'submission-quota' });

export const SUBMISSION_QUOTA_REDIS = Symbol('SUBMISSION_QUOTA_REDIS');

const KEY_PREFIX = 'quota:';
/** 48h: survives a day rollover + up to 24h of clock skew / late batch. */
const KEY_TTL_SECONDS = 48 * 60 * 60;

export type ServiceTier = 'STANDARD' | 'DEDICATED' | 'PRIVATE';

@Injectable()
export class SubmissionQuotaService {
  constructor(@Inject(SUBMISSION_QUOTA_REDIS) private readonly redis: Redis) {}

  /**
   * Charge a single submission against the tenant's daily quota.
   * Throws `SepError(TENANT_QUOTA_EXCEEDED)` when the tier limit
   * would be crossed by this request; on success the counter is
   * left incremented (no explicit refund — successful requests
   * CONSUME quota).
   */
  async charge(tenantId: string, serviceTier: ServiceTier): Promise<void> {
    const limit = this.limitForTier(serviceTier);
    const key = this.keyFor(tenantId);
    const count = await this.redis.incr(key);
    if (count === 1) {
      // First increment today — set TTL so the key self-cleans.
      // Race condition: if two requests INCR before EXPIRE runs the
      // second will see count > 1 and skip EXPIRE. That's fine —
      // the TTL from the first INCR still applies.
      await this.redis.expire(key, KEY_TTL_SECONDS);
    }
    if (count > limit) {
      // Refund this request's increment so the counter reflects
      // ACTUAL successful consumption. Best-effort; we don't await
      // failures here because a failed DECR is not load-bearing
      // (the TTL will clean up eventually).
      await this.redis.decr(key).catch((err: unknown) => {
        logger.warn({ tenantId, err: String(err) }, 'Failed to refund quota INCR');
      });
      throw new SepError(
        ErrorCode.TENANT_QUOTA_EXCEEDED,
        {
          tenantId,
          // Report the cap, not the current count — current count leaks
          // tenant traffic volume; limit is a static per-tier value the
          // tenant already knows from their contract.
        },
        `Daily submission quota exceeded — tier ${serviceTier} permits ${limit}/day`,
      );
    }
  }

  /**
   * Expose current count for debug / ops dashboards. Never returns
   * an error — a Redis failure returns null so dashboards can
   * render gracefully.
   */
  async currentCount(tenantId: string): Promise<number | null> {
    try {
      const raw = await this.redis.get(this.keyFor(tenantId));
      if (raw === null) {
        return 0;
      }
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  private keyFor(tenantId: string): string {
    return `${KEY_PREFIX}${tenantId}:${this.utcDayStamp()}`;
  }

  private utcDayStamp(): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private limitForTier(tier: ServiceTier): number {
    const cfg = getConfig();
    switch (tier) {
      case 'STANDARD':
        return cfg.rateLimit.tenantQuotaStandardPerDay;
      case 'DEDICATED':
        return cfg.rateLimit.tenantQuotaDedicatedPerDay;
      case 'PRIVATE':
        return cfg.rateLimit.tenantQuotaPrivatePerDay;
      default: {
        const exhaustive: never = tier;
        throw new SepError(ErrorCode.CONFIGURATION_ERROR, {
          reason: 'Unknown service tier for quota lookup',
          operation: String(exhaustive),
        });
      }
    }
  }
}
