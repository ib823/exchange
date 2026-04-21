# ADR-0009 — Three-layer rate limiting + API hardening

**Status:** Decided (M3.A7, 2026-04-21); implemented (M3.A7)
**Deciders:** Platform engineering, security engineering
**Related:** ADR-0008 (auth lifecycle lockout), issue #42 (trust-proxy
deployment topology)

## Context

M3.A7 adds rate limiting and API hardening to the control plane.
Three decisions surfaced that future readers will otherwise have to
reverse-engineer from the diff.

## Decision — three layers, each with a distinct key and purpose

| Layer      | Library                  | Key                                  | Default                                         | Auth override                                                             | Purpose                                      |
| ---------- | ------------------------ | ------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- |
| Edge       | `@fastify/rate-limit`    | per-IP                               | 200/min                                         | `/auth/*`: 20/min                                                         | DoS floor before anything else runs          |
| Controller | `@nestjs/throttler`      | per-API-key (authed) / per-IP (anon) | 1000/min                                        | login: 5 per (IP, email) / 15min; MFA-verify: 3 per challengeToken / 5min | Logical-resource protection after body-parse |
| Quota      | `SubmissionQuotaService` | per-(tenantId, UTC day)              | STANDARD 10k, DEDICATED 100k, PRIVATE unlimited | n/a                                                                       | Commercial-tier cap for submissions          |

**Why three tiers, not one:** each layer protects a different
resource. The edge stops IP-level floods before helmet + body parse
burn CPU. The controller stops logical abuse (login brute-force,
challenge replay) after body is available for tuple keying. The
quota enforces commercial tier contracts per billing day. Collapsing
into one layer would force a single key shape — either too coarse
(per-IP only misses per-user abuse) or too fine (per-user misses
anonymous floods before the user is known).

**Why Redis for all three:** plan decision D-M3-11. Horizontal scale
requires shared state; in-memory would break as soon as the control
plane runs on more than one pod. Each layer uses a dedicated
`ioredis` connection — same Redis instance, different socket — so a
burst at one layer doesn't starve the others' commands.

**Namespaces:**

- `sep:edge-rl:*` — `@fastify/rate-limit` (Fastify's `nameSpace`)
- `sep:throttler:*` — `@nestjs/throttler` (ioredis `keyPrefix`)
- `sep:quota:*` — `SubmissionQuotaService` (via `sep:` keyPrefix + `quota:` literal)

Flat keys across all three layers keep Redis debugging predictable —
`KEYS sep:edge-rl:*` shows the edge state cleanly.

## Decision — login keyed by (IP, email) tuple, MFA-verify by challengeToken

**Login `(IP, email)`:** Each `(IP, email)` pair gets 5 attempts per
15 minutes. This discriminates two legitimate users on the same NAT
(each gets their own bucket) and one attacker varying passwords against
one email (bucket caps at 5).

**Fallback on malformed email:** An attacker sending login requests
with missing / non-string / empty / whitespace email must not evade
the 5-cap by varying the invalid shape. The `loginEmailTracker`
normalises all such shapes to a single fallback key
`${ip}|<no-email>` — one bucket per IP for all no-email requests.
This means:

- 5 attempts per email per IP per 15min (legitimate path)
- 5 "no-email" attempts per IP per 15min (fallback bucket)
- Edge layer bounds the IP overall at 20/min across all auth paths

An attacker on one IP is capped at roughly `5 + 5×(emails_attempted)`
in a 15-min window, themselves bounded by 20/min edge-floor. Unit
tests assert the "all fallback shapes collapse to one bucket"
property explicitly.

**MFA-verify `challengeToken`:** The challenge is single-use (see
ADR-0008 MFA SET NX EX decision). This throttler caps PROBES before
the single-use burn happens, so a leaked challenge can't be
brute-forced against the 6-digit TOTP space. Key shape is
`challenge|<first-32-chars-of-JWT>` — enough entropy to avoid cross-
tenant collisions while keeping Redis keys bounded.

## Decision — 429 response shape matches SepError contract

Both rate-limit layers emit 429 responses with the same body shape
the `HttpExceptionFilter` produces for any programmatic SepError:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests — retry after 60s",
    "retryable": true,
    "terminal": false,
    "correlationId": "<uuid>"
  }
}
```

Plus `Retry-After` + `X-RateLimit-*` headers. Clients handle 429
identically regardless of which layer fired.

**Implementation wrinkle — `@fastify/rate-limit`:** the library
`throw`s the `errorResponseBuilder` return value. Fastify reads
`statusCode` off the thrown value for HTTP routing; if absent, the
default error handler emits 500. We set `statusCode: 429` with
`Object.defineProperty({enumerable: false})` so the status drives
routing but doesn't leak into the JSON body. Documented in
`bootstrap/edge-rate-limit.ts`.

**Implementation wrinkle — `@nestjs/throttler`:** `SepThrottlerGuard`
extends the base guard and overrides only
`throwThrottlingException`, throwing `SepError(RATE_LIMIT_EXCEEDED)`.
Headers (`Retry-After`, `X-RateLimit-*`) come from
`@nestjs/throttler`'s default `setHeaders: true` before the throw.

## Decision — interaction with M3.A4 lockout

The M3.A4 password lockout (10 failures / 30 min / 30 min per user)
is a SECOND tier of defence against the same class of attack the
controller throttler addresses. Layering:

1. **Edge (20/min per IP on /auth/\*):** coarse anti-flood.
2. **Controller (5 per (IP, email) / 15min):** logical login-abuse cap.
3. **User lockout (10/30/30):** per-user counter persisted in DB.

Critically, the rate limiter FIRES BEFORE the lockout counter
increments — so the rate limiter PROTECTS the lockout mechanism
from trivial exhaustion. An attacker can't burn a victim's 10-fail
budget in a single second; each request must pass layer 1 AND layer
2 AND then reach LoginService where the atomic counter increments.

## Decision — per-tenant daily quota: tier-driven, fail-closed, no grace

STANDARD 10k / DEDICATED 100k / PRIVATE unlimited maps to the
Tenant.serviceTier Prisma enum (schema.prisma). The Redis counter
uses `quota:<tenantId>:<UTC-day>` with 48h TTL (survives day rollover

- clock skew, auto-cleans the day after).

**Fail-closed discipline:** Quota INCR happens BEFORE the Prisma
write. On success the counter is left incremented (successful
requests consume quota). On cap-cross, the INCR is DECR-refunded
(best-effort) and the caller sees `TENANT_QUOTA_EXCEEDED`. On
idempotency conflict AFTER the quota charged, the counter is NOT
refunded — retry-storms must be bounded by quota, not auto-refunded.

**No grace window:** the quota cap is a hard edge. Operators who
need to lift a tenant's cap can bump the config value or upgrade the
tenant's `serviceTier` — both visible, auditable actions.

**Error message surfaces cap but NOT current count.** Tenants
already know their cap (contractual); the current count is a
real-time traffic signal that shouldn't leak to a rate-limited
caller (potential side-channel for attackers probing tenant
activity).

## Note — trust-proxy deferred to deployment topology resolution

Per-IP rate limiting correctness depends on Fastify's `trustProxy`
configuration matching the actual deployment topology.

- `trustProxy: false` (current M3.A7 setting): uses direct connection
  IP. Correct in dev (no proxy). In production, behind a load
  balancer every request keys on the LB IP — rate limiter becomes
  meaningless.
- `trustProxy: true`: honours `X-Forwarded-For` unconditionally.
  An attacker sets the header, spoofs per-IP limit trivially.
- Correct production config: `trustProxy: [<upstream CIDRs>]`,
  matching the actual LB / reverse-proxy topology.

M3.A7 ships with the Fastify default (`false`). Before production
launch, the deployment topology must be defined and `trustProxy`
set to a CIDR allow-list. Tracked as **issue #42**.

## Consequences

**Positive:**

- Three independent layers with distinct keys and failure modes
  make cost-of-exploit arithmetic transparent.
- Redis storage makes all three layers horizontally-scalable.
- Tracker fallback matrix (malformed email → single IP bucket) is
  unit-tested and documented, closing the "bucket-hopping evasion"
  attack vector.
- Error shape consistency means clients handle 429 uniformly.

**Negative:**

- Three Redis connections per control-plane instance (edge, throttler,
  quota). Trivial memory + socket cost; acceptable for layer
  isolation.
- Quota cannot be refunded on post-charge failures other than
  hot-path cap-cross. Idempotency conflicts and downstream Prisma
  failures leave the counter pessimistically-high. Operators can
  DECR manually if needed (documented).
- `trustProxy` remains a production-readiness gate (issue #42).

**Rejected alternatives:**

- **Single-layer rate limiting.** Would force one key shape; see
  "why three tiers" above.
- **In-memory storage.** Violates D-M3-11. Breaks as soon as the
  control plane runs on >1 pod — counts diverge per instance.
- **Grace window on quota cap.** Considered 1-hour grace where a
  tenant can burst 10% above cap before hard-reject. Rejected: the
  cap is a commercial contract term; soft-bursting obscures the
  contract and complicates billing reconciliation.
- **Per-request quota refund on any downstream failure.** Considered
  refunding on every post-charge exception. Rejected: opens a trivial
  burn-and-abort attack pattern where the attacker intentionally
  triggers post-charge failures to exhaust quota without counting.

## References

- `_plan/M3_EXECUTION_PLAN.md` §5 M3.A7 (T01-T03)
- `apps/control-plane/src/bootstrap/edge-rate-limit.ts` — @fastify/rate-limit registration
- `apps/control-plane/src/common/throttler-config.ts` — per-throttler trackers
- `apps/control-plane/src/common/guards/sep-throttler.guard.ts` — 429 → SepError mapping
- `apps/control-plane/src/modules/submissions/submission-quota.service.ts` — per-tenant quota
- Issue #42 — trust-proxy production-readiness follow-up
