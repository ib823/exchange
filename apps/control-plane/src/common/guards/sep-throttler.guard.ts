/**
 * SepThrottlerGuard (M3.A7-T02).
 *
 * Extends @nestjs/throttler's base guard, preserving its full
 * canActivate / multi-throttler dispatch / per-throttler tracker
 * behaviour. Only override is `throwThrottlingException`, which is
 * the single surface where the guard emits a 429. We replace the
 * library's default exception with a SepError(RATE_LIMIT_EXCEEDED)
 * so the HttpExceptionFilter emits the same
 * `{error:{code,message,retryable,terminal,correlationId}}` contract
 * every other SepError does.
 *
 * Retry-After: @nestjs/throttler sets `setHeaders` globally (default
 * true in v6), which emits `X-RateLimit-*` + `Retry-After` onto the
 * reply BEFORE throwing. We don't need to duplicate that here.
 */

import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { SepError, ErrorCode } from '@sep/common';

@Injectable()
export class SepThrottlerGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    _context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    // timeToExpire is in ms; surface ceil-seconds for the message so
    // ops + clients see a human value. The storage key carries the
    // throttler-name prefix, which is the most useful breadcrumb for
    // debugging which named throttler fired.
    const retrySeconds = Math.max(1, Math.ceil(throttlerLimitDetail.timeToExpire / 1000));
    throw new SepError(
      ErrorCode.RATE_LIMIT_EXCEEDED,
      { operation: throttlerLimitDetail.key },
      `Too many requests — please retry in ${retrySeconds}s`,
    );
  }
}
