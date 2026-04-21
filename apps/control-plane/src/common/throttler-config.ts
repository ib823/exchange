/**
 * Throttler trackers + names (M3.A7-T02).
 *
 * @nestjs/throttler's per-throttler `getTracker` fires once per
 * request per named throttler. The function we return becomes part
 * of the key that @nestjs/throttler passes into the storage, so the
 * shape it emits determines how many logical buckets live in Redis.
 */

import type { FastifyRequest } from 'fastify';

export const THROTTLER_NAMES = Object.freeze({
  default: 'default',
  authLogin: 'authLogin',
  mfaVerify: 'mfaVerify',
});

/**
 * Key login attempts by `(ip, email)` so multiple users on the same
 * NAT share no bucket, but one attacker hammering one email is
 * bounded.
 *
 * Fallback: if `request.body.email` is missing, non-string, or empty
 * after trim, key on `${ip}|<no-email>` — a stable bucket per IP.
 * Rationale: an attacker sending login requests with no email must
 * NOT bypass the controller-layer limit. The fallback bucket caps
 * them at the same N-per-window budget (per IP), so the only
 * escalation path left is multiple IPs (which the edge layer's
 * 20/min per-IP still bounds).
 *
 * Never throws. A thrown tracker would propagate up through the
 * Nest guard and turn into a 500, which would EITHER surface an
 * attack to the attacker OR mask it from defenders. Both bad.
 */
export function loginEmailTracker(req: Record<string, unknown>): string {
  const fastifyReq = req as unknown as FastifyRequest;
  const ip =
    typeof fastifyReq.ip === 'string' && fastifyReq.ip.length > 0 ? fastifyReq.ip : 'unknown-ip';
  const body = fastifyReq.body as { email?: unknown } | undefined;
  const rawEmail = body?.email;
  if (typeof rawEmail !== 'string') {
    return `${ip}|<no-email>`;
  }
  const normalised = rawEmail.toLowerCase().trim();
  if (normalised.length === 0) {
    return `${ip}|<no-email>`;
  }
  return `${ip}|${normalised}`;
}

/**
 * Key MFA verify by the challenge token. The challenge is single-use
 * (see MfaChallengeStore) so a single challenge naturally caps at 1
 * success; this throttler caps at N unsuccessful probes, limiting
 * the blast surface of a challenge-token leak even before the
 * Redis-SET-NX consume burns it.
 *
 * Fallback: if no challengeToken on the body, key by IP so a bad-
 * body flood still meets the throttler. Same defensive posture as
 * loginEmailTracker.
 */
export function mfaChallengeTracker(req: Record<string, unknown>): string {
  const fastifyReq = req as unknown as FastifyRequest;
  const ip =
    typeof fastifyReq.ip === 'string' && fastifyReq.ip.length > 0 ? fastifyReq.ip : 'unknown-ip';
  const body = fastifyReq.body as { challengeToken?: unknown } | undefined;
  const raw = body?.challengeToken;
  if (typeof raw !== 'string' || raw.length === 0) {
    return `${ip}|<no-challenge>`;
  }
  // JWTs can be long — hash-prefix to a stable short string so
  // Redis keys don't bloat. First 32 chars of the token are enough
  // entropy to avoid collisions across legit callers in any realistic
  // window.
  return `challenge|${raw.slice(0, 32)}`;
}
