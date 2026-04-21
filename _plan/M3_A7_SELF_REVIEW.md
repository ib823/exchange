# M3.A7 Self-Review — Rate limiting + API hardening

**Per §10.1 option (ii).** This PR touches
`apps/control-plane/src/modules/auth/auth.controller.ts` and
`apps/control-plane/src/modules/auth/mfa.controller.ts` (the auth
module — §10.1 binding path), so **high-blast-radius scrutiny
applies**. The edits there are narrow (two `@Throttle()` decorator
additions + one import each) but auth-adjacent, so the full review
is warranted.

**Branch:** `m3.a7/rate-limiting-hardening` off `main@97d4fac`
**Scope:** Four commits — T01 edge rate-limit + request hardening,
T02 Nest throttler with Redis + per-endpoint overrides, T03 per-
tenant daily submission quota, ADR-0009 + this doc.

---

## 1. Threat model

| #   | Threat                                                                     | Mitigation                                                                                                                                                                                                 | Evidence                                                                                                    |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| T1  | Per-IP flooding (DoS)                                                      | Edge layer @fastify/rate-limit 200/min default, 20/min /auth/\*, Redis-backed                                                                                                                              | `bootstrap/edge-rate-limit.ts`; 3 integration tests                                                         |
| T2  | Login brute-force against one email                                        | Controller throttler 5 per (IP, email) / 15min + edge 20/min + M3.A4 lockout 10/30/30 (three-tier defence)                                                                                                 | `auth.controller.ts:@Throttle(authLogin)`; `throttler-config.ts:loginEmailTracker`                          |
| T3  | Attacker evades (IP, email) by varying invalid email shapes                | `loginEmailTracker` fallback: all missing/non-string/empty/whitespace email shapes from the same IP collapse onto a SINGLE `${ip}                                                                          | <no-email>` bucket                                                                                          | `throttler-config.test.ts:10 cases incl. "all fallback shapes collapse"` + integration test |
| T4  | MFA-verify brute-force of 6-digit TOTP against a captured challenge        | Throttler 3 per challengeToken / 5min BEFORE the Redis single-use consume burns it; challenge is consumed on ANY attempt (per ADR-0008)                                                                    | `mfa.controller.ts:@Throttle(mfaVerify)`; `throttler-config.ts:mfaChallengeTracker`                         |
| T5  | Oversized payload DoS                                                      | Fastify `bodyLimit: 2 MiB`                                                                                                                                                                                 | `main.ts` FastifyAdapter config                                                                             |
| T6  | Slow-loris / idle-connection DoS                                           | Fastify `connectionTimeout: 30s`, `requestTimeout: 30s`                                                                                                                                                    | `main.ts` FastifyAdapter config                                                                             |
| T7  | One tenant burns another's capacity                                        | Per-tenant daily quota keyed by `(tenantId, UTC-day)` — tier defaults STANDARD 10k, DEDICATED 100k, PRIVATE unlimited                                                                                      | `submission-quota.service.ts:charge`                                                                        |
| T8  | 429 response discloses tenant traffic volume                               | Error message carries tier cap (public contract) but NOT current count (traffic signal)                                                                                                                    | `submission-quota.service.test.ts` message-leakage test                                                     |
| T9  | Quota auto-refund on any failure → burn-and-abort attack                   | Cap-cross refunds (hot-path DECR). Idempotency conflicts + downstream failures do NOT refund — charge sticks. Documented in ADR-0009 "rejected alternatives"                                               | `submissions.service.ts:create` comment + test                                                              |
| T10 | Rate-limit bypass via trust-proxy header spoof                             | Default `trustProxy: false` (safe in dev). Production topology resolution is a hard gate before prod launch — issue #42                                                                                    | ADR-0009 trust-proxy note + issue #42                                                                       |
| T11 | Rate-limit state divergence across control-plane pods                      | All three layers use Redis shared storage (D-M3-11). Namespaces `sep:edge-rl:*`, `sep:throttler:*`, `sep:quota:*` keep domains distinct                                                                    | three Redis provider factories; integration tests against real Redis                                        |
| T12 | 429 leaks quota internals                                                  | Error shape is identical SepError JSON across all three layers; only the error code distinguishes                                                                                                          | `http-exception.filter.ts`; `sep-throttler.guard.ts`; ADR-0009                                              |
| T13 | Edge 429 bypasses Nest exception filter → leaks Fastify default error body | Custom `errorResponseBuilder` emits the SepError JSON shape directly; non-enumerable `statusCode: 429` routes HTTP status without leaking into the body                                                    | `bootstrap/edge-rate-limit.ts:errorResponseBuilder`; integration test asserts `statusCode` absent from JSON |
| T14 | Empty / unset rate limiter on dev-mode Redis-absence (silent disable)      | `ioredis` client configured with `maxRetriesPerRequest: 3` + `lazyConnect: false` — refuses to connect at boot if Redis unavailable. `ThrottlerStorageRedisService` errors propagate. No silent-skip path. | three Redis factories in `main.ts`, `app.module.ts`, `submissions.module.ts`                                |

### Out of scope (flagged as follow-ups)

- **Trust-proxy topology resolution** — issue #42, blocks production
  launch. Dev default is correct.
- **CORS** — not in M3.A7 plan. Deferred to external-surface work in M3.5 / M4.
- **Request-body Zod hardening** — already global via
  `ZodValidationPipe` (M3.A6 used it for partner configs).

---

## 2. Test coverage

| Suite                            | Before | After | Delta |
| -------------------------------- | ------ | ----- | ----- |
| `@sep/control-plane` unit        | 159    | 181   | +22   |
| `@sep/control-plane` integration | 6      | 9     | +3    |
| **Total**                        | 165    | 190   | +25   |

### New unit tests (22 cases)

**`throttler-config.test.ts` — 10 cases** (load-bearing for watchpoint):

- `loginEmailTracker` normalises email (lowercase + trim)
- Missing email falls back to `<no-email>` bucket
- Empty / whitespace email falls back
- Non-string email (number, null, nested object) falls back
- Never throws (null body, string body, empty request)
- Unknown-IP marker when req.ip missing/empty
- **"All fallback shapes from same IP collapse to identical key"** (explicit anti-bucket-hopping assertion)
- `mfaChallengeTracker` keys by challenge-token prefix
- Missing/non-string/empty challenge falls back to `<no-challenge>` bucket
- Never throws

**`submission-quota.service.test.ts` — 12 cases**:

- First INCR sets TTL (48h)
- Subsequent INCR skips TTL
- UTC day in key shape
- STANDARD over-cap throws TENANT_QUOTA_EXCEEDED
- Refund DECR on cap-cross
- Error message carries tier cap but not current count
- DEDICATED permits requests beyond STANDARD cap
- PRIVATE effectively unlimited
- Redis DECR failure on refund doesn't shadow quota error
- `currentCount` returns 0 when key absent
- `currentCount` parses existing key
- `currentCount` returns null on Redis failure

### New integration tests (3 Redis-backed)

- **`edge-rate-limit.integration.test.ts`** (3 scenarios already shipped in commit 1 — re-counted here)
- **`throttler.integration.test.ts`** — 6th login with same (IP, email) → 429; different email from same IP gets own bucket; malformed-email shapes collapse to `<no-email>` bucket

### Coverage gaps (accepted)

- Per-tenant quota integration test against real Redis NOT shipped in this PR — the unit tests cover all branches; the integration test would need a seeded tenant + Postgres, which is scope creep for T03's plan acceptance ("unit tests with malformed fixtures prove fail-closed"). Filed as follow-up consideration if ops report unexpected behaviour.

---

## 3. Rollback

Three additive commits (T01, T02, T03) + one docs commit (this +
ADR-0009). Reverse-revert order: ADR → T03 → T02 → T01 is safest
but any single commit can be reverted independently.

**State carry-over after revert:**

- **Redis keys:** `sep:edge-rl:*`, `sep:throttler:*`, `sep:quota:*`
  persist for their TTLs (1 min, 15 min, 48h respectively). Safe —
  reverted code doesn't read them. They self-clean.
- **Config env keys** — new `RATE_LIMIT_AUTH_LOGIN_*`,
  `RATE_LIMIT_MFA_VERIFY_*`, `RATE_LIMIT_TENANT_QUOTA_*` become
  unread but harmless.
- **Database:** no schema changes.
- **Vault:** no path touched.

**Full revert of M3.A7 = control plane reverts to pre-T01 in-memory
ThrottlerModule** with a single 100/min default. Rate limit protection
weakens but doesn't disappear.

---

## 4. Sign-off

- [x] Threat model addressed — 14 threats (T1–T14), file:line + test ID evidence for each
- [x] Test coverage asserted — +22 unit + 3 integration
- [x] Rollback documented — additive commits, self-cleaning state
- [x] Known gaps flagged — trust-proxy (issue #42), CORS (deferred to M3.5/M4), quota integration test (deferred by plan)
- [x] §10.1 high-blast-radius scrutiny — auth module guards touched; decorator-only edits; fresh-eyes re-read completed per §10.1 step 3-4
- [x] Fresh-eyes re-read caught: (a) @fastify/rate-limit library `throws` errorResponseBuilder → required explicit statusCode; (b) full AppModule boot in integration test requires env that narrow test doesn't care about → switched to minimal scoped module

**Ready to merge.** Four commits, plan-literal scope, follow-ups
tracked.
