# ADR-0008 — Auth lifecycle: MFA, refresh tokens, lockout

**Status:** Decided (M3.A4, 2026-04-21); implemented (M3.A4)
**Deciders:** Platform engineering, security engineering
**Supersedes:** None
**Related:** ADR-0002 (argon2id), ADR-0003 (custom JWT guard), ADR-0007 (key custody)

## Context

M3.A4 adds password-based login, MFA (TOTP + recovery codes), account
lockout, and refresh token rotation. Six decisions surfaced that
future readers will otherwise have to reverse-engineer from the diff.

## Decision — lockout threshold 10/30/30

Ten wrong-password attempts in a rolling 30-minute window locks the
account for 30 minutes. Tunable at the top of `login.service.ts`.

**Why 10, not 5 or 20:**

- 5 is hostile to real users (typos under time pressure).
- 20 gives an attacker 20 guesses per 30-min cycle against every
  active account — not meaningfully different from unbounded on a
  medium-entropy password.
- 10 catches brute-force reliably (an attacker against 10,000 common
  passwords hits the lock in 10 attempts, not 10,000) while
  tolerating human error.

**Why sliding window (anchored at lastFailedAt) over fixed window:**
A fixed calendar window (e.g. "10 per hour, resets at :00") lets an
attacker burst 10 at :59 and 10 more at :01. Sliding windows anchored
at `lastFailedAt` make the 30-min budget per-incident.

## Decision — atomic counter update (single UPDATE with CASE)

The lockout counter + lockedUntil update runs in ONE SQL statement
with CASE expressions deriving the new values from the pre-image.
No read-check-write decomposition.

**Why not Prisma's fluent `update({ data: { increment: 1 } })`:**
The increment works, but we need CONDITIONAL logic ("set lockedUntil
only if counter crossed threshold IN-WINDOW"). Splitting that into
(read → check → update) opens a race under concurrent wrong-password
attempts — two parallel requests both see counter=9, both increment
to 10, both miss the lockout trigger OR both trigger and issue
conflicting lockedUntil values.

The single-UPDATE-with-CASE solution uses Postgres's row-level lock
taken by UPDATE to serialise concurrent attempts. Parallel 10th-and-
11th wrong-password requests land on the same lock; the 11th sees
the post-UPDATE counter at 10 and the lockedUntil already set.

Evidence: T06 scenario 7 asserts that 10 concurrent wrong-password
attempts produce `failedLoginAttempts = 10` exactly — never <10
under concurrency.

## Decision — refresh tokens use HMAC-SHA256, not argon2id

The `RefreshToken.tokenHash` column is computed as
`HMAC-SHA256(rawToken, key)` where `key` is a 256-bit secret stored
in Vault at `platform/auth/refresh-hmac-key`.

**Why not argon2id (which the original schema comment suggested):**

1. **Determinism.** Argon2id embeds a random salt so it produces a
   different hash each time. Unique-index lookup by tokenHash is
   therefore impossible — the refresh path would have to SELECT all
   unexpired tokens for a given user and verify each, defeating the
   unique index.
2. **Input entropy.** Argon2id's slow-hashing design defends against
   offline brute-force of LOW-entropy passwords. Refresh tokens are
   256-bit cryptographically-random values; brute-forcing this input
   space is infeasible regardless of hash function speed.
3. **Per-request cost.** Argon2id takes ~100 ms per verification.
   At refresh traffic volumes (one per access-token expiry, ~every
   15 min per active session) this is negligible — but there's no
   security benefit to pay for it.

**Stolen-DB-alone attack:** HMAC-SHA256 under a Vault-stored key
gives the same "stolen DB alone is insufficient" property argon2id
offers for passwords, delivered differently. Without the HMAC key,
the stolen `tokenHash` values cannot be used to generate tokens
that would match a future lookup — the HMAC relationship is
one-way given only the hash.

**Schema-comment tripwire:** The pre-M3.A4 schema comment said
"argon2id of raw token". That comment was rewritten in T05 with
the full rationale inline plus a "do NOT fix this back to argon2id"
note. Prevents a future reviewer from "correcting" the choice back
to the wrong answer.

## Decision — strict refresh replay detection (no grace window)

A refresh token presented with `usedAt != null` triggers chain
revocation: every token linked by `replacedById` in both directions
is revoked with `revocationReason='replay-detected'`.

**Why no grace window:**
A used token being presented a second time means one of two things:
either the legitimate holder's network stack retried mid-use, or an
attacker captured the token. We cannot distinguish these at
presentation time. Choosing "assume attack" forces a re-login;
choosing "assume retry" with a grace window lets the attacker ride
the window indefinitely.

A stolen-token threat model treats re-login as a cheap
inconvenience; a stolen-token enabled-attacker treats the grace
window as free access. The asymmetry favors strict detection.

**Chain walk:** Revocation walks both forward (via `replacedById`)
AND backward (rows whose `replacedById` points into our set).
Backward is the important direction: if an attacker used token A to
get B, and the legitimate client later presents A, we must revoke
B too — we don't know which party holds it.

## Decision — TOTP window ±30 seconds (one neighbour)

otplib `verify({ epochTolerance: 30 })` accepts the current 30-s
window plus one neighbour (90-s total acceptance).

**Why one neighbour, not zero or two+:**

- Zero rejects any device whose clock drifts even slightly — user
  frustration for no real security gain.
- Two or more neighbours (150-s acceptance) weakens the one-time
  property: a code is valid for 150 seconds, multiplying the
  brute-force surface.
- One neighbour is the industry standard (Google Authenticator,
  Authy, etc. all default to this).

## Decision — MFA challenge single-use via Redis SET NX EX

After login issues an MFA challenge JWT (T03), the MFA verify
endpoint (T04) atomically claims the challengeId in Redis:
`SET sep:mfa-challenge:<id> 'consumed' NX EX 310`. First call
wins; replays return `AUTH_MFA_CHALLENGE_CONSUMED`.

**Why SET NX EX over a separate GET-check-SET:**
The `NX EX` combination is atomic at the Redis command level.
GET-then-SET opens a race: two parallel calls both GET null, both
SET 'consumed', both proceed to TOTP verify, both potentially
issue tokens if the TOTP happens to be valid.

**Why 310s TTL (longer than the 300s JWT expiry):**
Belt-and-suspenders against clock skew between JWT exp and Redis
TTL. The JWT verify rejects expired JWTs before the Redis check
runs anyway — but if the clocks disagree by a few seconds the
extra 10s keeps the consumed marker valid until the JWT is
unambiguously dead.

**Challenge-burn-on-wrong-TOTP:**
The Redis consume happens BEFORE the TOTP verify. A wrong TOTP
burns the challenge — user must re-login. Prevents brute-force of
the 6-digit TOTP space against a single issued challenge.
Tradeoff: legitimate typos cost a re-login. For a high-value MFA
path this is the right posture; the password-login lockout (10/30/30)
still catches repeated wrong-TOTP attempts at a higher tier.

## Decision — HMAC key bootstrap at module init, fail-closed

The refresh-token HMAC key is loaded from Vault exactly once per
control-plane process, during NestJS module init. A Vault read
failure throws `KEY_BACKEND_UNAVAILABLE` and aborts module init —
the process refuses to start.

**Why fail-closed at boot:**
Running with a missing or wrong HMAC key would mean every refresh
produces a garbage hash. The unique-index lookup would fail on
legitimate refresh attempts, triggering `AUTH_REFRESH_TOKEN_INVALID`
on every session in a loop. That's worse than "process won't
start" because users see auth flapping rather than a clean
deployment rollback signal.

**First-deploy bootstrap:** If the Vault path is absent (404 → the
CRYPTO_KEY_NOT_FOUND code the VaultClient maps), the provider
generates a fresh 256-bit key and writes it. Subsequent process
starts find the same key. Keeps dev bring-up zero-friction.

## Consequences

**Positive:**

- Lockout atomic-CASE design is concurrency-safe and was surfaced
  explicitly in T06 scenario 7.
- HMAC-SHA256 choice is documented inline in the schema so a
  future reviewer cannot "fix" it back without reading the
  rationale.
- MFA challenge burn-on-wrong-code forces cost onto attackers
  without blocking legitimate users beyond a single re-login.
- Fail-closed boot on missing HMAC key makes bad deployments
  visible immediately rather than in a user-facing auth flap.

**Negative:**

- No JWT secret rotation (tracked as issue #36). Session survives
  until natural expiry after secret rotation is planned.
- Recovery-code VERIFICATION endpoint not shipped in M3.A4 —
  `/auth/mfa/recover` is a known gap. Generation + storage
  (argon2id-hashed) work; verification path is T06 follow-up or
  M3.A6 work. Surfaces as "user loses TOTP device" has no
  recovery path until the endpoint ships.
- Refresh token issuance not wired into login / MFA-verify
  success paths in M3.A4. `POST /auth/refresh` exists but tokens
  to present come only from direct `RefreshTokenService.issue()`
  calls. T06 follow-up commit will wire issuance into the access-
  token-issuance paths. (This is listed as Negative rather than
  Unknown because it's a real functional gap the review will
  likely push back on.)

**Rejected alternatives:**

- **Argon2id for refresh tokens.** See Decision — HMAC-SHA256
  section. The pre-M3.A4 schema comment picked this, which is why
  the schema comment now carries an explicit reversal.
- **Shorter or longer lockout duration than 30 min.** 5 min was
  considered (easier user recovery, less deterrent); 60 min was
  considered (stronger deterrent, harsher on legit users). 30
  min is the middle ground that matches D-M3-6.
- **Grace window on replay detection.** Considered 60s tolerance
  for retry storms. Rejected because the asymmetry of "attacker
  rides the window" outweighs "legitimate retry loses session."

## Related findings

Contributes to PRIOR-R3-001 closure (auth silent-failure modes).
Creates new issue (#36) for JWT secret rotation.

## References

- `_plan/M3_EXECUTION_PLAN.md` §5 M3.A4
- `apps/control-plane/src/modules/auth/login.service.ts` —
  atomic lockout UPDATE
- `apps/control-plane/src/modules/auth/refresh-token.service.ts` —
  chain-revocation replay detection
- `apps/control-plane/src/modules/auth/refresh-hmac-key.provider.ts` —
  fail-closed boot
- `apps/control-plane/src/modules/auth/mfa-challenge-store.service.ts` —
  Redis SET NX EX single-use

## Addendum — T06 integration-surfaced bugs + two corrections (2026-04-21)

Writing the T06 integration suite surfaced two production bugs that
mocked unit tests missed. Both are fixed; this addendum records
what changed and why, so a future reader hitting the same shape
doesn't re-derive the answer.

### Correction — failed-login UPDATE runs in its own transaction

**Original decision text:** "The lockout counter + lockedUntil
update runs in ONE SQL statement with CASE expressions".

**Bug:** Running the UPDATE and the `throw AUTH_INVALID_CREDENTIALS`
inside the SAME Prisma `$transaction` callback made the throw roll
back the UPDATE. The counter never incremented. The atomic-CASE
property was correct for concurrency, but the enclosing-transaction
rollback defeated the persistence of the new counter value.

**Fix:** `LoginService.validatePassword` now runs three separate
`forTenant` calls: Step 1 (read), Step 2 (failure UPDATE, only on
wrong password — auto-commits before throw), Step 3 (success UPDATE

- token issuance). The atomic-CASE property survives; the commit
  boundary moves to the correct place.

**Detected by:** M3.A4-T06 Scenario 1 (15 parallel wrong-password
→ counter=10). First run showed counter=0, which is only possible
if the UPDATE never committed.

### Correction — refresh tokens carry a tenantId prefix

**Original decision text:** "The `refresh_tokens.tokenHash` column
is computed as `HMAC-SHA256(rawToken, key)`".

**Bug:** `RefreshTokenService.refresh` used
`this.database.forSystem().refreshToken.findUnique({where:{tokenHash}})`
expecting `forSystem()` to bypass RLS. But the runtime `forSystem()`
returns a client connected as `sep_app`, which has `rolbypassrls =
false`. Without `app.current_tenant_id` set, the RLS policy on
refresh_tokens evaluates `tenantId = NULL` and returns 0 rows for
every legitimate refresh attempt.

**Fix:** The raw token is now a two-part envelope:

```
<tenantId>.<base64url(32-byte random)>
```

The tenantId prefix is not a secret (the caller knows their tenant
from login). `refresh()` parses the prefix, validates the cuid
shape (malformed → AUTH_REFRESH_TOKEN_INVALID, same shape as
"unknown token"), and uses `forTenant(tenantId, ...)` for the
lookup. No privileged client required.

**Security implications of revealing tenantId in the token:**

- An attacker who captures a refresh token already has access to
  everything that token grants — knowing the tenant adds nothing.
- An attacker probing with arbitrary strings sees a uniform
  AUTH_REFRESH_TOKEN_INVALID response shape whether the prefix
  is well-formed-but-unregistered, malformed, or non-cuid.
- The 256-bit random suffix is unchanged — cryptographic entropy
  of the token is preserved.

**tokenHash shape:** HMAC-SHA256 of the FULL envelope. Storage
format unchanged (64-char hex digest in `refresh_tokens.tokenHash`
unique index). Migration compatibility: M3.A4 is not yet merged,
so no tokens exist in production to migrate.

**Detected by:** M3.A4-T06 Scenario 2 (chain revocation). First
run threw AUTH_REFRESH_TOKEN_INVALID on the first rotate A→B
because findUnique returned null.

### Decision — recovery-code verification (retroactive)

`POST /auth/mfa/recover` ships in this PR. Rationale:

- Same JWT challenge token as `/auth/mfa/verify`.
- Same Redis single-use claim (challenge is burned on
  presentation regardless of which endpoint).
- Walks the `RecoveryCode` rows for the user, argon2Verify each
  until match.
- Brute-force cap: 3 per-user failures per 30 min sliding window
  (stored in Redis at `sep:mfa-recovery-failures:<userId>`), with
  1s / 5s / lockout delay schedule. Tighter than the password
  lockout (10 threshold) because a successful recovery code
  bypasses MFA entirely — higher-value target.

### Note — `forSystem()` is not a BYPASSRLS client

The misdiagnosed original implementation assumed `forSystem()` on
`DatabaseService` returned a privileged client. It does not — it
returns the runtime client (sep_app role, RLS forced). This ADR
records the observation; a cleaner rename or the addition of a
distinct `forSystemBypassRls(fn)` helper is out of scope for M3.A4
and will be filed as a separate issue.
