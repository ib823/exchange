# M3 — Security and Trust Controls

**Status:** v1.0 — execution-ready (promoted 2026-04-18)
**Version:** 1.0 (2026-04-18)
**Supersedes:** v0.7 draft (2026-04-18), v0.6 draft (2026-04-17)
**Owner:** Platform engineering + security engineering (second reviewer strongly recommended; see §10)
**Est. duration:** 20–28 engineer-days (23–30 calendar days for solo-with-AI cadence)
**Prerequisite:** post-m3.0-baseline tag verified (main `219c1a6`, hygiene PRs #7 + #11 + #14 + #15 merged, verify script exits 0)
**Next milestone:** M3.5 (Data Plane Reality) — detailed plan authored after M3 closes

---

## Sign-off record (promotion gate per §14)

Promoted from `M3_EXECUTION_PLAN.draft.md` on 2026-04-18 with the following gate answers from the user (`@ib823`):

1. **Scope + estimate (gate 1):** Approved — in-scope list in §1.1 and 20–28 eng-day estimate accepted.
2. **Second-reviewer decision (gate 2, §10.1):** **Option (ii) — solo with CODEOWNERS self-review discipline.** Each PR to `packages/db/prisma/migrations/`, `packages/crypto/`, or `apps/control-plane/src/modules/auth/` must include an explicit self-review comment in the PR body addressing: threat model, test coverage, rollback path. No exceptions.
3. **Q9 — R8-001 owner (gate 3):** Deferred — "will name during M3.A4." Named owner must be recorded in `_plan/M3_HANDOFF.md` §5 before M3 closes (per §11 process exit).

Amendments: if any of the above needs correction, edit this block in a follow-up commit before M3.A0-T01 lands; do not silently diverge during execution.

---

## 0. Reader orientation

This plan inherits the rolling-wave discipline from `_plan/IMPLEMENTATION_PLAN.md` and refines §3.2 (M3 roadmap-mode in the portfolio plan) into execution-mode.

**What M3 does:** Adds the security controls that make the platform credibly enterprise-grade. Specifically: database-enforced tenant isolation (RLS), real key custody (Vault backend against existing `KeyBackendType` abstraction), transactionally-coupled audit evidence with append-only enforcement, MFA + refresh-token rotation + lockout, layered rate limiting, OTEL runtime wiring, partner-config Zod validation, and 14 named threat-scenario tests.

**What M3 does NOT do:** Wire real SFTP/HTTPS transport (M3.5), wire real S3 object storage (M3.5), ship the operator console (M4), deliver regulatory matrices (M5), or define SLOs and alert rules (M6). Scope discipline is identical to M3.0's — if a task looks adjacent, it probably belongs in the named milestone above.

**What's new since M3.0:**
- Dependencies are current (nestjs-zod, argon2id, Zod 3.25.76, TypeScript 5.9.3, Prisma 5.22.0, Vitest 3.2.4)
- `ArmoredKeyMaterialProvider` does not exist (confirmed via schema review) — `KeyReference.backendRef` already stores non-material references; `KeyReference.backendType` already enumerates four backend types
- OTEL cohort installed, not runtime-wired (NEW-08 deferred to M3.A9)
- Vault container runs in compose, unused by code
- `audit_events.immutableHash` and `previousHash` fields already exist (M2 hash-chain work); M3.A2 adds append-only enforcement via DB-level REVOKE plus transactional coupling
- `post-m3.0-baseline` is genuinely green: 8/8 CI on push-to-main; verify script exits 1 only because two known M3.A0 blockers (PRIOR-R1-003 and PRIOR-R4-003) are named for closure in this milestone

**What hasn't changed:** PLANS.md's acceptance register remains authoritative for deferred findings. Forensic-audit finding IDs (PRIOR-R*, NEW-*) remain traceability anchors. Authority hierarchy in IMPLEMENTATION_PLAN.md §1.2 governs tie-breaks.

---

## 1. Scope

### 1.1 In-scope — the complete list

**From PLANS.md's Formal Acceptance Register — deferrals that close here:**

| ID | Severity | Title |
|---|---|---|
| PRIOR-R1-003 | *existing gap* | TypeScript project references (M3.A0 blocker surfaced by verify script) |
| PRIOR-R4-003 | *existing gap* | exports `types` condition ordering (M3.A0 blocker) |
| PRIOR-R2-001 | CRITICAL | DB-RLS on all tenant-scoped tables |
| PRIOR-R3-001 | CRITICAL | Cross-tenant object reference protection (BOLA) — closes via R2-001 remediation |
| PRIOR-R2-002 | HIGH | Audit transactional coupling + append-only enforcement |
| PRIOR-R2-003 | HIGH | DB-authored timestamps via `set_updated_at()` trigger |
| PRIOR-R3-002 | HIGH | MFA + refresh-token rotation + account lockout |
| PRIOR-R3-004 | HIGH | Privileged-access hardening (covered by R3-002 remediation) |
| PRIOR-R6-001 | HIGH | Vault `IKeyCustodyBackend` against existing `KeyBackendType` abstraction |
| PRIOR-R6-003 | MEDIUM | 90-day key expiry warning tier wired to scanner |
| PRIOR-R4-002 | MEDIUM | Residual `as unknown as` cleanup (5 documented casts) |
| PRIOR-R4-001 | MEDIUM | Residual `throw new Error` typing (2 documented bootstraps) |
| NEW-02 | MEDIUM | Retry jitter via `Math.random()` in delivery processor |
| NEW-03 | MEDIUM | `withTimeout` helper + application to crypto processor |
| NEW-04 | MEDIUM | Zod validation for `partnerProfile.config` JSON at load |
| NEW-08 | MEDIUM | OTEL runtime wiring in both service `main.ts` files |

**From CLAUDE.md §M3.7 — the threat-scenario test suite:**
All 14 scenarios named in that section, each with explicit acceptance criteria (see §6 inventory).

**Process hygiene:**
- M3.A0 dormant-gate inventory: every CI job × every trigger type (push / pull_request / schedule / workflow_dispatch), verified actually running and exit-code green
- Crypto coverage ratchet: restore `@sep/crypto` line coverage to ≥80% (threshold fell to 73 over M3.0 via reporter artefact)
- `verify-m3-findings.mjs` authored during M3, mirroring the M3.0 script pattern

### 1.2 Out of scope — explicit deferrals

| Item | Milestone | Reason |
|---|---|---|
| Real SFTP transport wiring | M3.5 | Per Q7 decision; M3 keeps `SftpConnector` stub |
| Real HTTPS transport wiring | M3.5 | Same |
| S3 object storage wiring | M3.5 | Per Q6 user answer; M3 keeps `InMemoryObjectStorageService` |
| Pre-signed URL upload API | M3.5 | Depends on S3 wiring |
| Callback receive endpoint | M3.5 | Depends on HTTPS wiring |
| Operator console screens | M4 | `apps/operator-console` stays a stub |
| Metrics HTTP endpoint exposure | M4 | R7-001 per acceptance register |
| Retention enforcement jobs | M5 | R2-004 per acceptance register |
| BNM RMiT / PDPA / LHDN regulatory matrices | M5 or Track D | R8-002 / R8-003 / R8-004 |
| Incident reporting workflow (CSA 2024) | M4 (needs owner) | R8-001 per Q9 answer — owner assigned by M3 close at latest |
| SBOM signing + provenance attestation | M6 | R5-003 full closure target |
| SLOs + alert rules | M6 | R7-002 |
| Runbooks / DR procedures | M5 + M6 | R7-003 |
| Vault HA topology (3-node Raft) | M6 | D-M3-1; M3 ships dev-mode single-node |
| Concrete `ExternalKmsBackend` implementation | M5 or first AWS-tier customer | Per Q5 sequenced decision |
| AS2 protocol support | Post-Phase-1 | Permanent deferral |
| WebAuthn MFA | M4 | TOTP ships in M3; WebAuthn as operator-console upgrade |
| Tier-differentiated infrastructure (DEDICATED/PRIVATE hard physical separation) | Future | Per Q3 — RLS covers all tiers in Phase 1 |

If during M3 execution a task appears to need one of the above, **stop and escalate** — scope has leaked.

### 1.3 Findings not touched

PRIOR-R8-001 (Cyber Security Act 2024 incident reporting) is non-code. M3 creates the Zod schema and service interface for the workflow, but the *workflow itself* — NCII classification decisions, statutory deadline management, escalation ownership — requires the named owner per Q9. The interface is M3 scope; the operationalisation is M4 + owner sign-off.

---

## 2. Target architecture — delta from post-m3.0-baseline

### 2.1 Tenancy model (Q3 resolution confirmed)

**Decision:** Option (a) — single cluster, RLS everywhere, with routing interface already present in `DatabaseService` for future Option (b) migration (tier-differentiated pools/clusters for DEDICATED and PRIVATE tiers).

**Postgres role model:**
- `sep` (migration-only, effectively superuser) — explicit `BYPASSRLS` attribute; used only for `prisma migrate deploy`
- `sep_app` (runtime role) — no `BYPASSRLS`; every application query uses this role. RLS enforced via `FORCE ROW LEVEL SECURITY` so superuser access requires explicit opt-out

`DATABASE_URL` (migration-time) uses `sep`; `RUNTIME_DATABASE_URL` uses `sep_app`. If not already distinct in the runtime wiring, M3.A1-T01 separates them.

**Tenant-scoped table inventory (from schema.prisma review):**

15 tables have direct `tenantId` column:
`users`, `role_assignments`, `retention_policies`, `source_systems`, `partner_profiles`, `exchange_profiles`, `submissions`, `inbound_receipts`, `key_references`, `crypto_operation_records`, `audit_events`, `incidents`, `approvals`, `webhooks`, `api_keys`

2 tables reach tenancy through FK — **option (a) decision applies:** denormalize tenantId onto them as part of M3.A1 migrations:
`delivery_attempts` (currently `submissionId → submissions.tenantId`)
`webhook_delivery_attempts` (currently `webhookId → webhooks.tenantId`)

1 new table created by M3 (`refresh_tokens`) gets denormalized tenantId from its creating migration.

**Total tables under RLS after M3:** 18 (15 existing-direct + 2 denormalized + 1 new).

**Policy pattern (uniform across all tables):**

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

CREATE POLICY <table>_tenant_select ON <table>
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY <table>_tenant_insert ON <table>
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY <table>_tenant_update ON <table>
  FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY <table>_tenant_delete ON <table>
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

**Note on `audit_events`:** M3.A2 issues `REVOKE UPDATE, DELETE ON audit_events FROM sep_app`, so the `_tenant_update` and `_tenant_delete` policies become dead code on that table. They remain in the migration anyway for structural consistency — the REVOKE provides defence-in-depth over the policy.

**Session-variable mechanics:** `current_setting('app.current_tenant_id', true)` returns NULL when unset (the `true` parameter suppresses the "unrecognized configuration parameter" error). Policies fail closed on NULL via the `::uuid` cast — NULL can't cast to UUID, so any query without `SET LOCAL` fails cleanly rather than returning all rows.

`DatabaseService.forTenant()` uses `$transaction` with explicit `SET LOCAL` rather than a global session variable, because pg connection pools recycle connections across requests.

### 2.2 Key custody (Q5 resolution + schema alignment)

**Decision:** Sequenced implementation. Vault backend (`PLATFORM_VAULT` and `TENANT_VAULT` entries in the existing `KeyBackendType` enum) ships concrete in M3. `EXTERNAL_KMS` backend is interface-only with conformance tests proving contract parity — concrete wiring deferred to M5 or first AWS-tier customer.

**Schema-confirmed facts (from prisma schema review):**
- `KeyReference.backendType: KeyBackendType` already enumerates `PLATFORM_VAULT`, `TENANT_VAULT`, `EXTERNAL_KMS`, `SOFTWARE_LOCAL`
- `KeyReference.backendRef: String` already stores Vault path or KMS key ID — **not key material**
- `KeyState` already has 11 values (`DRAFT`, `IMPORTED`, `VALIDATED`, `ACTIVE`, `ROTATING`, `EXPIRED`, `REVOKED`, `RETIRED`, `SUSPENDED`, `COMPROMISED`, `DESTROYED`)
- `KeyReference.rotationTargetId` self-reference already models rotation
- No `ArmoredKeyMaterialProvider` to delete — the anti-pattern referenced in v0.6 doesn't exist in this schema

**Structural implications for M3.A5:**

```
packages/crypto/src/custody/
  IKeyCustodyBackend                 (interface)
    getPublicKey(backendRef) -> ArmoredKey
    signDetached(backendRef, payload) -> Signature
    verifyDetached(backendRef, payload, sig) -> boolean
    decrypt(backendRef, ciphertext) -> plaintext
    encryptForRecipient(recipientBackendRef, plaintext) -> ciphertext
    rotate(backendRef, newMaterial) -> newBackendRef
    revoke(backendRef) -> void

  PlatformVaultBackend               (concrete — M3 ships)
    HTTP client over Vault's KV v2 + transit engines
    ~200 lines; no node-vault dep (per ADR-0004)

  TenantVaultBackend                 (concrete — M3 ships)
    Same as PlatformVaultBackend but per-tenant mount path
    Shared HTTP client implementation; different mount routing

  ExternalKmsBackend                 (interface-only in M3)
    Every method throws SepError.of('CRYPTO_BACKEND_NOT_IMPLEMENTED',
      'External KMS backend deferred to M5 or first AWS customer')

  SoftwareLocalBackend               (interface-only in M3, dev-only)
    Every method throws SepError.of('CRYPTO_BACKEND_NOT_AVAILABLE',
      'Software-local backend not approved for production use')

  KeyCustodyAbstraction              (dispatcher)
    backendFor(keyRef: KeyReference): IKeyCustodyBackend
    selection via keyRef.backendType enum value
```

**Conformance test suite:** every method of `IKeyCustodyBackend` runs against both Vault backends abstractly; `ExternalKmsBackend` tests assert the expected typed error. When KMS lands concretely (M5+), the same tests start passing for it.

### 2.3 Audit transactional coupling (R2-002)

**Today:** `AuditService.record()` writes to `audit_events` as a separate `await` after business writes. A crash between the two commits business state without audit evidence.

**M3 target pattern (every state-changing service method):**

```typescript
await this.prisma.$transaction(async (tx) => {
  // RLS context (if not already set upstream via guard)
  await tx.$executeRaw`SET LOCAL app.current_tenant_id = ${tenantId}::text`;

  // 1. Business write
  const updated = await tx.<model>.update({ ... });

  // 2. Audit append — uses same tx
  await this.auditService.record(tx, {
    tenantId,
    actorId,
    actorType: 'USER',
    action: 'UPDATE_PARTNER_PROFILE',
    objectType: 'partner_profile',
    objectId: updated.id,
    result: 'SUCCESS',
    correlationId,
    metadata: { previousStatus, newStatus },
  });

  return updated;
});
```

**AuditService.record()` signature change:** grows an optional first parameter `tx: Prisma.TransactionClient | PrismaClient`. When `tx` is passed, uses it; when absent, creates an implicit `$transaction` for backward compatibility during migration.

**Append-only enforcement:** `REVOKE UPDATE, DELETE ON audit_events FROM sep_app`. RLS policies alone don't prevent updates; privilege revocation does.

**Hash chain verification:** `AuditEvent.immutableHash` / `previousHash` already exist (M2 work). M3 adds a scheduled job (`AuditIntegrityJob`) that periodically verifies hash-chain continuity. If a break is detected, fires a P1 incident.

### 2.4 Authentication lifecycle (R3-002 + R3-004)

**Today:** JWT access-only. No refresh, no MFA, no lockout.

**M3 target flows:**

```
POST /auth/login { email, password }
  → argon2id verify password
  → if user.mfaEnrolledAt != null:
      issue short-lived (5min) MFA challenge token
      return 403 { mfaChallengeToken }
  → else:
      issue access token (15min) + refresh token (14 days)
      return 200 { accessToken, refreshToken }
  → rate-limited: 5 attempts / 15min per (IP, email) tuple

POST /auth/mfa/verify { mfaChallengeToken, otp }
  → verify challenge token signature + expiry
  → decrypt mfaSecret via PlatformVaultBackend
  → otplib TOTP verify (window ±1 period)
  → issue access + refresh pair
  → rate-limited: 3 attempts / 5min per challenge token

POST /auth/refresh { refreshToken }
  → argon2id verify tokenHash against refresh_tokens table
  → if token.usedAt != null:
      → replay detected: revoke all tokens for user
      → fire P1 incident (AUTH_REFRESH_REPLAY)
      → return 401
  → mark token.usedAt = now(), token.replacedById = newToken.id
  → issue new access + refresh pair
  → return 200 { accessToken, refreshToken }

Lockout:
  User.failedLoginAttempts increments on wrong password
  At >= LOGIN_LOCKOUT_ATTEMPTS within LOGIN_LOCKOUT_WINDOW_SEC:
    User.lockedUntil = now() + lockout duration
  Login attempts on locked accounts return 423 LOCKED
  Admin can clear lockedUntil via /admin/users/:id/unlock
```

### 2.5 Rate limiting (OWASP API security hardening)

Three layers:

1. **`@fastify/rate-limit` at network edge** — per-IP rate limits (200/min default, 20/min for `/auth/*`)
2. **`@nestjs/throttler`** — per-API-key, per-tenant, per-endpoint overrides for sensitive actions
3. **Per-tenant quotas** — daily submission count ceiling per service tier (configurable; defaults: STANDARD 10k/day, DEDICATED 100k/day, PRIVATE unlimited)

Storage: Redis (via ioredis, already installed). Throttler backend: `ThrottlerStorageRedisService`.

### 2.6 OTEL runtime wiring (NEW-08 closure)

M3.0 installed the OTEL 0.214 cohort + smoke-tested imports. M3.A9 wires it:

- `startOtel()` helper in `packages/observability/src/otel.ts` (`NodeSDK` already available per verify script OK)
- Called before `NestFactory.create(...)` in both `apps/control-plane/src/main.ts` and `apps/data-plane/src/main.ts`
- Auto-instrumentation: Fastify, PG, ioredis, BullMQ
- OTLP exporter endpoint via `OTEL_EXPORTER_OTLP_ENDPOINT`; unset → no exporter (tracing still works locally without one)
- Trace context propagation: HTTP → BullMQ job → worker execution
- Correlation-ID header aligned with OTEL trace ID

This is distinct from metrics HTTP endpoint exposure (R7-001, M4 scope).

### 2.7 Crypto coverage ratchet

Threshold drifted 80 → 75 → 73 across M3.0 + hygiene PR (reporter artefact, not regression). M3 restores to ≥80% on `@sep/crypto` via:
- `PlatformVaultBackend` + `TenantVaultBackend` full test coverage (all 7 interface methods × 2 backends)
- `ExternalKmsBackend` + `SoftwareLocalBackend` error-path coverage
- `KeyCustodyAbstraction` dispatcher coverage including missing-backend error
- Key rotation state machine transitions (via KeyState enum)
- `KeyExpiryScanner` 90-day warning tier coverage

---

## 3. Decision points

Every question below must have a concrete answer before its governing task begins. Some resolved by Q3/Q5/Q6/Q9; the rest have defaults that execution can run against without further input.

| ID | Question | Default | Decider | Needed by |
|---|---|---|---|---|
| D-M3-1 | Vault HA topology for prod | Single-node dev for M3; 3-node Raft deferred to M6 | Platform + security | M6 |
| D-M3-2 | Vault unseal strategy (auto-unseal cloud KMS vs manual Shamir) | Deferred to M6 with production topology | Platform + security | M6 |
| D-M3-3 | MFA secret encryption key rotation cadence | 365 days; emergency playbook for compromise | Security | M3.A4 |
| D-M3-4 | Refresh token TTL | 14 days | Security | M3.A4 |
| D-M3-5 | Access token TTL | 15 minutes | Security | M3.A4 |
| D-M3-6 | Lockout threshold / window / duration | 10 attempts / 30 min / 30 min lock | Security | M3.A4 |
| D-M3-7 | RLS policy naming convention | `<table>_tenant_<operation>` | Platform | M3.A1 |
| D-M3-8 | Operator TOTP enrollment — self-service vs admin-provisioned | Self-service `/auth/mfa/enroll`; admin force re-enrollment | Platform + security | M3.A4 |
| D-M3-9 | JWT signing secret rotation window (dual-secret period) | 7 days | Security | M3.A4 |
| D-M3-10 | Crypto operation timeout | 30 seconds (retained from M3.0 config) | Platform | Retained |
| D-M3-11 | Throttler storage backend | Redis (memory breaks horizontal scale) | Platform | M3.A7 |
| D-M3-12 | Anti-replay on refresh — simple revocation vs token-family tracking | Simple revocation + replay detection (revoke-all on replay) | Security | M3.A4 |
| D-M3-13 | Regulatory ownership (R8-001) — the Q9 follow-through | Owner named by M3 close | Founder | M3 close |
| D-M3-14 | Threat-scenario tests requiring second reviewer | All 14 treated security-critical | Platform + security | M3 start |
| D-M3-15 | TOTP algorithm parameters | HMAC-SHA1, 30s period, 6 digits, ±1 window | Security | M3.A4 |
| D-M3-16 | M3.A0 RLS FK-scoped table approach | Option (a) — denormalize tenantId onto delivery_attempts + webhook_delivery_attempts | Platform | M3.A1 |

All 16 defaults are acceptance-ready — execution proceeds unless you override.

---

## 4. Task groups — structural overview

M3 has 9 task groups. Numbering preserved from v0.6 for cross-reference continuity.

| Group | Theme | Effort (eng-days) | Exit criterion |
|---|---|---|---|
| M3.A0 | Pre-M3 housekeeping + 2 blockers | 1.5–2.5 | Verify script exits 0; dormant-gate inventory complete |
| M3.A1 | Database tenant isolation (RLS) | 3–4 | Cross-tenant negative test suite passes under `sep_app` role |
| M3.A2 | Audit transactional coupling | 2–3 | Fault-injection proves atomicity on all state-changing service methods |
| M3.A3 | DB timestamps + retention hooks | 1 | `set_updated_at()` trigger active; direct-SQL update shows trigger-authored timestamp |
| M3.A5 | Key custody — Vault backends + KMS interface | 3–4 | Conformance suite passes both Vault backends; KMS + SoftwareLocal assert expected errors |
| M3.A4 | Auth lifecycle — MFA + refresh + lockout | 3–4 | All 5 auth flows tested; replay detection + lockout proven |
| M3.A6 | Partner config Zod validation (NEW-04) | 0.5 | Partner profile load fails fast on invalid config |
| M3.A7 | Rate limiting + API hardening | 1–2 | All three layers active; abuse test shows expected 429s |
| M3.A9 | OTEL runtime wiring (NEW-08) | 1 | Trace propagated HTTP → BullMQ → processor completion |
| M3.A8 | Threat-scenario tests (14 scenarios) | 4–6 | All 14 tests green; each mapped to scenario ID |
| M3.A10 | Residual M3.0 cleanup + coverage ratchet | 1 | 5 `as unknown as` removed; 2 `throw new Error` typed; crypto line coverage ≥80% |

**Estimated total: 20–28 eng-days.** 20 if everything goes well; 28 if three threat scenarios surface non-trivial test infrastructure gaps (likely given today's absence of `tests/simulators/`).

Group ordering deliberately has A5 before A4 because A4's MFA secret encryption depends on A5's Vault backend being concrete.

---

## 5. Per-task detail

Each task follows this shape:

```
M3.A<N>-T<NN> — <title>

  Goal:              <one sentence>
  Affected paths:    <files to create / modify>
  Dec dependencies:  <D-M3-N list>
  Acceptance:
    - <bullet — testable>
  Test strategy:     <unit / integration / interop / threat>
  Security mapping:  <OWASP API Top 10 2023 + CWE>
  Evidence:          <test ID, migration SQL, log query>
  Effort:            <S=0.5d / M=1d / L=2d / XL=3d+>
  Commit shape:      <conventional commit prefix>
```

---

### M3.A0 — Pre-M3 housekeeping + blockers

Closes the two blockers surfaced by `verify-m3-0-findings.mjs` plus the dormant-gate inventory.

**M3.A0-T01 — Add `composite: true` to package tsconfigs (PRIOR-R1-003 part 1)**
- Goal: Every per-package `tsconfig.json` declares `composite: true` (not inherited from base — base serves apps that can't be composite due to Next.js integration).
- Affected paths: `packages/common/tsconfig.json`, `packages/crypto/tsconfig.json`, `packages/db/tsconfig.json`, `packages/observability/tsconfig.json`, `packages/partner-profiles/tsconfig.json`, `packages/schemas/tsconfig.json` (6 files).
- Dec dependencies: none.
- Acceptance:
  - All 6 package tsconfigs contain `"composite": true` in `compilerOptions`
  - `pnpm exec tsc -b packages/common` succeeds (build one to prove composite works)
  - Verify script's PRIOR-R1-003 for packages no longer BLOCKs (app tsconfigs still BLOCK — see T02)
- Test strategy: direct build verification; no new unit tests.
- Security mapping: n/a (structural).
- Evidence: CI log of `tsc -b` success.
- Effort: S (0.5d).
- Commit shape: `fix(m3.a0): add composite:true to package tsconfigs (PRIOR-R1-003 part 1)`

**M3.A0-T02 — Remove cross-package source aliases from tsconfig.base.json (PRIOR-R1-003 part 2)**
- Goal: Remove `paths` block mapping `@sep/*` to sibling source files. Consumers must resolve via built `dist/` outputs.
- Affected paths: `tsconfig.base.json`
- Dec dependencies: T01 (composite must exist before removing source aliases)
- Acceptance:
  - `tsconfig.base.json` has no `paths` entries mapping `@sep/*` to source
  - `pnpm run typecheck` from repo root succeeds
  - Importing a symbol from another package resolves via `dist/*.d.ts`, not source
  - `apps/control-plane/src/` can still import `@sep/common` (verified by pnpm workspaces, not path alias)
- Test strategy: end-to-end typecheck verification; apps/control-plane build.
- Security mapping: n/a.
- Evidence: `pnpm run typecheck` output; visual inspection of an app's `node_modules/@sep/common` resolving to the workspace package.
- Effort: S (0.5d).
- Commit shape: `fix(m3.a0): remove cross-package source aliases (PRIOR-R1-003 part 2)`

**M3.A0-T03 — Add references arrays to consuming tsconfigs (PRIOR-R1-003 part 3)**
- Goal: Apps and packages that depend on other `@sep/*` packages declare them in `references[]` so `tsc -b` can build in correct order.
- Affected paths: `apps/control-plane/tsconfig.json`, `apps/data-plane/tsconfig.json`, `apps/operator-console/tsconfig.json`, and any inter-package dependencies (e.g., `@sep/crypto` → `@sep/common`).
- Dec dependencies: T01, T02.
- Acceptance:
  - `tsc -b` from repo root builds every package in correct topological order
  - Changing a symbol in `@sep/common` and rebuilding causes downstream packages to rebuild
- Test strategy: build verification.
- Security mapping: n/a.
- Evidence: CI build log showing ordered build.
- Effort: S (0.5d).
- Commit shape: `fix(m3.a0): add references arrays (PRIOR-R1-003 part 3)`

**M3.A0-T04 — Verify `tsc -b` works from repo root (PRIOR-R1-003 part 4)**
- Goal: Confirm the project references pipeline is complete and functional.
- Affected paths: none (verification only); may update `package.json` scripts to prefer `tsc -b`.
- Dec dependencies: T01, T02, T03.
- Acceptance:
  - `pnpm exec tsc -b` from repo root exits 0
  - Verify script's PRIOR-R1-003 status flips from BLOCK to OK
  - CI runs the build (should already, but confirm)
- Test strategy: re-run verify script after commit; expect PRIOR-R1-003 OK.
- Security mapping: n/a.
- Evidence: verify script output showing PRIOR-R1-003 OK.
- Effort: S (0.5d).
- Commit shape: `fix(m3.a0): confirm tsc -b works from root (PRIOR-R1-003 part 4)`

**M3.A0-T05 — Reorder exports conditions so `types` is first (PRIOR-R4-003)**
- Goal: Every package's `exports['.']` puts `types` before `import`/`require` so TypeScript Node16 resolution picks up type declarations correctly.
- Affected paths: `packages/common/package.json`, `packages/crypto/package.json`, `packages/db/package.json`, `packages/observability/package.json`, `packages/partner-profiles/package.json`, `packages/schemas/package.json` (6 files).
- Dec dependencies: none (independent of R1-003 work).
- Acceptance:
  - All 6 packages: `"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.js" } }`
  - `pnpm run build` still works (no runtime change)
  - `pnpm run typecheck` from a consuming app shows full type resolution (test by temporarily importing a wrong symbol — should error)
  - Verify script's PRIOR-R4-003 status flips from BLOCK to OK
- Test strategy: verify script re-run; temporary wrong-import experiment.
- Security mapping: n/a.
- Evidence: verify script output; typecheck output with deliberate type error confirming types resolved.
- Effort: S (0.5d).
- Commit shape: `fix(m3.a0): reorder exports to put types first (PRIOR-R4-003)`

**M3.A0-T06 — Dormant-gate inventory (cross-product: every gate × every trigger)**
- Goal: Systematically verify every CI job actually runs and exits green on every trigger type it claims to handle. Closes the class of gap that produced the 4 latent red gates across hygiene PRs #7, #11, #14.
- Affected paths: `.github/workflows/*.yml`; produces `_plan/M3_A0_GATE_INVENTORY.md`
- Dec dependencies: none.
- Acceptance: markdown document listing:
  - Every job in `.github/workflows/`
  - Every trigger type in that file's `on:` block
  - For each (job, trigger) pair: last green run timestamp, SHA, or explicit "never run" designation
  - For each "never run" gap: either trigger a manual run to confirm, or file a tracking issue with M3-continued milestone
  - Any gate not in GitHub branch protection required checks: either add it or document why not
- Test strategy: manual walk + GitHub Actions API query. Reproducible via `gh run list` + `gh workflow view`.
- Security mapping: supply-chain / CI integrity posture (no direct CWE).
- Evidence: `_plan/M3_A0_GATE_INVENTORY.md` committed; GitHub branch-protection screenshot or API diff.
- Effort: M (1d).
- Commit shape: `docs(m3.a0): dormant-gate inventory across all CI triggers`

**M3.A0-T07 — Produce M3.A0 handoff note**
- Goal: Record what M3.A0 closed and surface anything that shifted during execution.
- Affected paths: `_plan/M3_A0_HANDOFF.md`
- Dec dependencies: T01–T06 complete.
- Acceptance:
  - Verification table: verify script output showing 25/0/0
  - Dormant-gate inventory summary
  - Any findings surfaced during M3.A0 that changed M3 scope
  - Green-light statement: "M3.A1 through M3.A10 can begin"
- Test strategy: n/a (documentation).
- Security mapping: n/a.
- Evidence: the handoff note itself.
- Effort: S (0.5d).
- Commit shape: `docs(m3.a0): handoff note — M3.A0 complete, M3 execution cleared to start`

**M3.A0 exit criteria:**
- [ ] `verify-m3-0-findings.mjs` exits 0 (25 passed, 0 failed, 0 blocked)
- [ ] `_plan/M3_A0_GATE_INVENTORY.md` committed with every (job, trigger) pair classified
- [ ] `_plan/M3_A0_HANDOFF.md` committed
- [ ] Main CI green on push-to-main after final M3.A0 commit

**M3.A0 total effort:** 1.5–2.5 engineer-days.

---

### M3.A1 — Database tenant isolation (RLS)

Closes PRIOR-R2-001 (CRITICAL) and PRIOR-R3-001 (CRITICAL, BOLA).

**M3.A1-T01 — Runtime role separation (`sep_app` vs `sep`)**
- Goal: Confirm `sep_app` is used for all runtime DB access; `sep` used only for migrations. If not already separate, make them distinct.
- Affected paths: `infra/docker-compose.yml` (DB init), `packages/db/src/database.service.ts`, `.env.example`, `apps/*/src/main.ts` (config wiring)
- Dec dependencies: D-M3-7 (naming convention), D-M3-16 (denormalization decision)
- Acceptance:
  - `DATABASE_URL` uses `sep` role (migration-only)
  - `RUNTIME_DATABASE_URL` uses `sep_app` role
  - `PrismaClient` constructor uses `RUNTIME_DATABASE_URL` by default
  - `prisma migrate deploy` uses `DATABASE_URL`
  - `sep_app` role has no `BYPASSRLS` attribute
  - `sep` role has `BYPASSRLS` explicit
- Test strategy: integration test that connects as `sep_app` with no tenant context and asserts a SELECT on users returns 0 rows.
- Security mapping: A01:2021 Broken Access Control; CWE-284.
- Evidence: integration test ID; init.sql showing role creation.
- Effort: M (1d).
- Commit shape: `feat(m3.a1): separate sep_app runtime role from migration role`

**M3.A1-T02 — Denormalize tenantId onto FK-scoped tables (D-M3-16 option a)**
- Goal: Add `tenantId` column to `delivery_attempts` and `webhook_delivery_attempts` so RLS policies can use single-column predicates.
- Affected paths: `packages/db/prisma/schema.prisma`, new migration under `packages/db/prisma/migrations/`
- Dec dependencies: D-M3-16
- Acceptance:
  - `delivery_attempts.tenantId: String` added; backfilled from `submissionId → submissions.tenantId`
  - `webhook_delivery_attempts.tenantId: String` added; backfilled from `webhookId → webhooks.tenantId` (or `submissionId → submissions.tenantId` when `webhookId` null)
  - Index added: `@@index([tenantId])` on both tables
  - Existing relations retained
  - `prisma migrate deploy` from empty DB applies cleanly
  - Existing test fixtures updated to populate tenantId on these tables
- Test strategy: migration on fresh DB; rerun existing integration tests to confirm no regression.
- Security mapping: A01:2021; CWE-284.
- Evidence: migration SQL; `prisma migrate status` clean.
- Effort: M (1d).
- Commit shape: `feat(m3.a1): denormalize tenantId onto delivery_attempts + webhook_delivery_attempts`

**M3.A1-T03 — Add RefreshToken model with denormalized tenantId**
- Goal: Create new `RefreshToken` Prisma model with tenantId denormalized from the creating migration (not a follow-up), for M3.A4 consumption.
- Affected paths: `packages/db/prisma/schema.prisma`, new migration
- Dec dependencies: D-M3-4 (refresh TTL affects default values)
- Acceptance:
  - `RefreshToken` model: `id`, `tenantId`, `userId`, `tokenHash` (argon2id), `issuedAt`, `expiresAt`, `usedAt`, `replacedById`, `revokedAt`, `revocationReason`
  - `@@unique([tokenHash])`, `@@index([tenantId])`, `@@index([userId])`
  - Migration creates the table AND its RLS policies in one transaction (consistency-by-construction)
- Test strategy: schema lint; migration on fresh DB.
- Security mapping: A07:2021 Identification and Authentication Failures; CWE-613.
- Evidence: migration SQL; schema diff.
- Effort: S (0.5d).
- Commit shape: `feat(m3.a1): add RefreshToken model with RLS from creating migration`

**M3.A1-T04 — Enable RLS + policies on all 18 tenant-scoped tables**
- Goal: Single migration that enables RLS + defines policies for all tenant-scoped tables in one atomic operation.
- Affected paths: new migration `<ts>_enable_rls_tenant_tables`
- Dec dependencies: D-M3-7, T01, T02, T03
- Acceptance:
  - `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;` on all 18 tables
  - `CREATE POLICY <t>_tenant_<op> ON <t> FOR <op>` for each of SELECT/INSERT/UPDATE/DELETE × 18 tables (72 policies)
  - Policies use `current_setting('app.current_tenant_id', true)::uuid` predicate
  - Migration includes `BEGIN;` / `COMMIT;` block to ensure atomic application
  - Migration's `down` disables policies rather than dropping (for safe re-application)
- Test strategy: migration on fresh DB; every policy visible via `SELECT * FROM pg_policies`.
- Security mapping: A01:2021 Broken Access Control; CWE-284, CWE-639.
- Evidence: pg_policies query output showing 72 policies.
- Effort: L (2d) — high-volume but mechanical.
- Commit shape: `feat(m3.a1): enable RLS + policies on 18 tenant-scoped tables`

**M3.A1-T05 — DatabaseService.forTenant() with SET LOCAL in $transaction**
- Goal: Runtime path for RLS session-variable injection.
- Affected paths: `packages/db/src/database.service.ts`
- Dec dependencies: T01
- Acceptance:
  - `DatabaseService.forTenant(tenantId): Prisma.TransactionClient` returns a transaction-scoped client
  - Every tenant-scoped service method receives a tx from `forTenant()`, NOT a raw `PrismaClient`
  - If `tenantId` is invalid UUID → throws `SepError.of('TENANT_CONTEXT_INVALID', ...)`
  - Integration test: tenant A queries return only tenant A rows even when tenant B rows exist in the same table
- Test strategy: unit test for invalid-UUID path; integration test for isolation.
- Security mapping: A01:2021; CWE-284.
- Evidence: integration test IDs.
- Effort: M (1d).
- Commit shape: `feat(m3.a1): DatabaseService.forTenant with SET LOCAL transaction`

**M3.A1-T06 — Cross-tenant negative test suite**
- Goal: Comprehensive negative test suite proving RLS fails closed on every tenant-scoped table.
- Affected paths: `tests/integration/rls-negative-tests/` (new directory with 18 test files, one per table)
- Dec dependencies: T04, T05
- Acceptance:
  - Each table has tests: SELECT without tenant context returns 0 rows; INSERT without tenant context fails; UPDATE without tenant context affects 0 rows; DELETE without tenant context affects 0 rows
  - Each table has tests: tenant A context cannot SELECT tenant B rows; tenant A cannot INSERT with `tenant_id: tenantBId` (fails WITH CHECK); tenant A cannot UPDATE tenant B rows; tenant A cannot DELETE tenant B rows
  - All 18 × 8 = 144 negative assertions green
- Test strategy: integration tests under testcontainers-Postgres.
- Security mapping: A01:2021 BOLA; CWE-639.
- Evidence: test file IDs; CI run showing 144 assertions.
- Effort: L (2d).
- Commit shape: `test(m3.a1): cross-tenant negative test suite (144 assertions)`

**M3.A1 exit criteria:**
- [ ] All 18 tenant-scoped tables have RLS policies
- [ ] `sep_app` role is the runtime role; `sep` is migration-only
- [ ] DatabaseService.forTenant() uses `SET LOCAL` in `$transaction`
- [ ] 144-assertion negative test suite green
- [ ] New `rls-negative-tests` CI job runs and passes as required check

**M3.A1 total effort:** 3–4 engineer-days.

---

### M3.A2 — Audit transactional coupling (R2-002)

**M3.A2-T01 — AuditService.record() accepts tx parameter**
- Goal: Growing the signature to support caller-provided transactions.
- Affected paths: `apps/control-plane/src/modules/audit/audit.service.ts`, `apps/data-plane/src/modules/audit/audit.service.ts` (if separate)
- Dec dependencies: none
- Acceptance:
  - Signature: `record(tx: Prisma.TransactionClient | PrismaClient, event: AuditEventInput): Promise<AuditEvent>`
  - When `tx` is a `TransactionClient`, uses it directly
  - When `tx` is a `PrismaClient`, creates an implicit `$transaction` wrapping the append
  - Backward-compatible for all existing callers (they continue to pass a raw PrismaClient)
- Test strategy: unit tests for both branches; mock Prisma throwing mid-transaction.
- Security mapping: A09:2021 Logging and Monitoring Failures; CWE-778.
- Evidence: unit test IDs.
- Effort: M (1d).
- Commit shape: `feat(m3.a2): AuditService.record accepts optional tx parameter`

**M3.A2-T02 — Migrate all state-changing service methods to use `$transaction` + audit coupling**
- Goal: Every service method that writes business state + audits does both in a single `$transaction`.
- Affected paths: every service in `apps/control-plane/src/modules/*/` that calls both a business `.update()` / `.create()` / `.delete()` AND `auditService.record()`. Estimated 12–15 service methods across partner-profiles, exchange-profiles, submissions, approvals, keys, webhooks, users, incidents.
- Dec dependencies: T01, M3.A1 complete (for SET LOCAL pattern)
- Acceptance:
  - Every state-change service method wraps both writes in `$transaction`
  - Every such method includes `SET LOCAL app.current_tenant_id` at transaction start
  - Every audit record references the same `correlationId` as the business write
- Test strategy: integration fault-injection — mock Prisma to throw after business write, before audit. Assert business row didn't commit; audit row doesn't exist.
- Security mapping: A09:2021; CWE-778.
- Evidence: fault-injection test IDs; CI run log.
- Effort: L (2d).
- Commit shape: `feat(m3.a2): transactionally couple audit writes to business writes`

**M3.A2-T03 — Append-only enforcement via REVOKE**
- Goal: Database-level prevention of audit_events UPDATE/DELETE by runtime role.
- Affected paths: new migration `<ts>_audit_append_only`
- Dec dependencies: M3.A1-T01 (sep_app role must exist)
- Acceptance:
  - `REVOKE UPDATE, DELETE ON audit_events FROM sep_app;`
  - Integration test: connecting as sep_app and attempting UPDATE on audit_events fails with permission-denied error
  - Integration test: same for DELETE
- Test strategy: integration test under testcontainers-Postgres.
- Security mapping: A09:2021; CWE-117 (improper output neutralization for logs — defence-in-depth).
- Evidence: migration SQL; integration test IDs.
- Effort: S (0.5d).
- Commit shape: `feat(m3.a2): REVOKE audit_events update/delete from sep_app`

**M3.A2-T04 — AuditIntegrityJob (hash chain verification)**
- Goal: Scheduled job verifies `immutableHash`/`previousHash` continuity; fires P1 incident on break.
- Affected paths: `apps/control-plane/src/modules/audit/audit-integrity.job.ts` (new)
- Dec dependencies: T03
- Acceptance:
  - BullMQ scheduled job, runs every 6 hours
  - Walks `audit_events` for each tenant, verifies hash chain
  - On break: creates Incident with severity HIGH and sourceType `AUDIT_INTEGRITY`
  - Metric emitted: `sep_audit_integrity_check_total{result=success|failure}`
- Test strategy: unit test for hash-chain walk logic; integration test that inserts a tampered row and asserts incident creation.
- Security mapping: A09:2021; CWE-345 (insufficient verification of data authenticity).
- Evidence: integration test ID; incident record in test DB.
- Effort: M (1d).
- Commit shape: `feat(m3.a2): AuditIntegrityJob for hash chain verification`

**M3.A2 exit criteria:**
- [ ] All state-changing service methods wrap business+audit writes in `$transaction`
- [ ] REVOKE prevents sep_app from updating/deleting audit_events
- [ ] Fault-injection tests prove atomicity
- [ ] AuditIntegrityJob scheduled and tested

**M3.A2 total effort:** 2–3 engineer-days.

---

### M3.A3 — DB timestamps + retention hooks (R2-003)

**M3.A3-T01 — set_updated_at() trigger function**
- Goal: Single trigger function used by every mutable table.
- Affected paths: new migration `<ts>_set_updated_at_trigger`
- Dec dependencies: none
- Acceptance:
  - `CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger` creates the function
  - Function sets `NEW.updated_at = now()` and returns NEW
- Test strategy: direct SQL test on trigger behavior.
- Security mapping: A08:2021 Software and Data Integrity Failures; CWE-353.
- Evidence: migration SQL.
- Effort: S (0.5d).
- Commit shape: `feat(m3.a3): set_updated_at trigger function`

**M3.A3-T02 — Attach trigger to 10 mutable tables**
- Goal: Every table with `updatedAt` gets the trigger.
- Affected paths: same migration as T01
- Dec dependencies: T01
- Acceptance:
  - Trigger attached to: `tenants`, `users`, `retention_policies`, `source_systems`, `partner_profiles`, `exchange_profiles`, `submissions`, `key_references`, `incidents`, `webhooks` (10 tables)
  - **NOT** attached to: `audit_events`, `crypto_operation_records` (immutable), `api_keys` (uses explicit `revokedAt`/`lastUsedAt`), `role_assignments` (append-only), `delivery_attempts`, `webhook_delivery_attempts`, `inbound_receipts`, `approvals` (domain-specific timestamps)
  - Integration test: direct SQL `UPDATE users SET display_name = 'X' WHERE id = Y` shows `updated_at` changed to trigger-authored time, not client-provided time
- Test strategy: integration test with clock skew — client sets timestamp to 1990, trigger overwrites to now().
- Security mapping: A08:2021; CWE-353.
- Evidence: integration test ID.
- Effort: S (0.5d).
- Commit shape: `feat(m3.a3): attach set_updated_at trigger to 10 mutable tables`

**M3.A3-T03 — Retention policy hooks (placeholder fields)**
- Goal: Schema support for M5's retention enforcement job, without implementing enforcement.
- Affected paths: `packages/db/prisma/schema.prisma`
- Dec dependencies: none
- Acceptance:
  - `RetentionPolicy` model (may already exist per schema) has `retentionDays: Int` and `appliesTo: String` fields
  - No runtime enforcement in M3 — M5 scope
  - Clear inline comment: `// Enforcement is M5 scope (R2-004); this table provides declarative retention policy`
- Test strategy: schema round-trip.
- Security mapping: n/a (data minimization scaffolding).
- Evidence: schema diff.
- Effort: S (minimal if RetentionPolicy exists; 0.5d if new).
- Commit shape: `feat(m3.a3): retention policy schema hooks (enforcement M5)`

**M3.A3 exit criteria:**
- [ ] `set_updated_at()` trigger active on 10 mutable tables
- [ ] Integration test proves trigger-authored timestamp
- [ ] Retention policy hooks documented as M5-deferred

**M3.A3 total effort:** 1 engineer-day.

---

### M3.A5 — Key custody (Vault backends + KMS interface)

Closes PRIOR-R6-001 (HIGH). Schema confirmed: `KeyBackendType` enum has `PLATFORM_VAULT`, `TENANT_VAULT`, `EXTERNAL_KMS`, `SOFTWARE_LOCAL`; `backendRef` field stores non-material ref.

**M3.A5-T01 — IKeyCustodyBackend interface**
- Goal: TypeScript interface matching the 7 operations identified in §2.2.
- Affected paths: `packages/crypto/src/custody/i-key-custody-backend.ts` (new)
- Dec dependencies: none
- Acceptance:
  - Interface exports 7 methods with typed signatures
  - All inputs are `KeyReference` or raw `string`; no `unknown`/`any`
  - Return types use branded types where applicable (e.g., `ArmoredKey`, `Signature`)
- Test strategy: typecheck.
- Security mapping: A02:2021 Cryptographic Failures; CWE-320.
- Evidence: interface file.
- Effort: S (0.5d).
- Commit shape: `feat(m3.a5): IKeyCustodyBackend interface`

**M3.A5-T02 — Custom Vault HTTP client (per ADR-0004)**
- Goal: Thin HTTP client for Vault's KV v2 and transit engines. No `node-vault` dep.
- Affected paths: `packages/crypto/src/custody/vault-client.ts` (new)
- Dec dependencies: T01
- Acceptance:
  - Uses `undici` (already in overrides at 7.25.0) for HTTP
  - Supports: GET/POST/PUT/DELETE against Vault API
  - Handles Vault auth via token or AppRole (M3 uses dev-mode root token; prod uses AppRole per ADR-0004)
  - Retries on 5xx with exponential backoff + jitter (per M3.A7-T01 pattern)
  - Times out at `VAULT_REQUEST_TIMEOUT_MS` (default 5s)
- Test strategy: unit tests with msw mocking Vault API; integration tests with testcontainers-Vault.
- Security mapping: A02:2021; CWE-320.
- Evidence: unit + integration test IDs.
- Effort: M (1d).
- Commit shape: `feat(m3.a5): custom Vault HTTP client (per ADR-0004)`

**M3.A5-T03 — PlatformVaultBackend + TenantVaultBackend**
- Goal: Concrete implementations of `IKeyCustodyBackend` backed by Vault.
- Affected paths: `packages/crypto/src/custody/platform-vault-backend.ts`, `packages/crypto/src/custody/tenant-vault-backend.ts`
- Dec dependencies: T01, T02
- Acceptance:
  - PlatformVaultBackend uses mount path `transit/platform` + `kv/data/platform`
  - TenantVaultBackend takes `tenantId` at construction and uses `transit/tenant/<tenantId>` + `kv/data/tenant/<tenantId>`
  - All 7 interface methods implemented
  - sign/verify use Vault transit engine
  - encrypt/decrypt for recipient-specific keys use transit engine
  - getPublicKey reads from Vault KV v2
  - rotate creates new key version in transit; updates `backendRef`
  - revoke marks key as revoked (Vault transit supports revocation)
- Test strategy: unit tests (mocked client); integration tests against testcontainers-Vault running all 7 methods.
- Security mapping: A02:2021; CWE-320.
- Evidence: integration test IDs.
- Effort: M (1d).
- Commit shape: `feat(m3.a5): Platform and Tenant Vault backends`

**M3.A5-T04 — ExternalKmsBackend + SoftwareLocalBackend (interface-only)**
- Goal: Concrete classes that throw typed errors for every method.
- Affected paths: `packages/crypto/src/custody/external-kms-backend.ts`, `packages/crypto/src/custody/software-local-backend.ts`
- Dec dependencies: T01
- Acceptance:
  - Each of 7 methods throws `SepError.of('CRYPTO_BACKEND_NOT_IMPLEMENTED', <reason>)`
  - ExternalKmsBackend reason: `'External KMS backend deferred to M5 or first AWS-tier customer'`
  - SoftwareLocalBackend reason: `'Software-local backend not approved for production; use Vault'`
- Test strategy: unit tests — each method called asserts the typed error.
- Security mapping: A02:2021; CWE-320.
- Evidence: unit test IDs.
- Effort: S (0.5d).
- Commit shape: `feat(m3.a5): ExternalKms and SoftwareLocal backends (interface-only)`

**M3.A5-T05 — KeyCustodyAbstraction dispatcher**
- Goal: Service that takes a `KeyReference` and returns the correct backend.
- Affected paths: `packages/crypto/src/custody/key-custody-abstraction.ts`, `apps/control-plane/src/modules/crypto/crypto.module.ts` (wiring)
- Dec dependencies: T03, T04
- Acceptance:
  - `backendFor(keyRef: KeyReference): IKeyCustodyBackend`
  - Switch on `keyRef.backendType`:
    - `PLATFORM_VAULT` → PlatformVaultBackend
    - `TENANT_VAULT` → new TenantVaultBackend(keyRef.tenantId)
    - `EXTERNAL_KMS` → ExternalKmsBackend
    - `SOFTWARE_LOCAL` → SoftwareLocalBackend
  - Unknown backendType throws `SepError.of('CRYPTO_BACKEND_UNKNOWN', ...)`
- Test strategy: unit tests for every branch.
- Security mapping: A02:2021; CWE-320.
- Evidence: unit test IDs.
- Effort: S (0.5d).
- Commit shape: `feat(m3.a5): KeyCustodyAbstraction dispatcher`

**M3.A5-T06 — Conformance test suite**
- Goal: Every method of `IKeyCustodyBackend` runs against both Vault backends; KMS + SoftwareLocal backends assert typed errors.
- Affected paths: `tests/integration/custody/conformance.test.ts` (new)
- Dec dependencies: T03, T04, T05
- Acceptance:
  - Same test body runs `PlatformVaultBackend` and `TenantVaultBackend`; both pass
  - Same test body runs against `ExternalKmsBackend` and `SoftwareLocalBackend`; both assert `CRYPTO_BACKEND_NOT_IMPLEMENTED`
  - When `ExternalKmsBackend` is later made concrete (M5+), the test body flips from asserting-error to passing without source changes
- Test strategy: integration tests under testcontainers-Vault.
- Security mapping: A02:2021; CWE-320.
- Evidence: test file ID showing 7 methods × 4 backends = 28 conformance assertions.
- Effort: M (1d).
- Commit shape: `test(m3.a5): IKeyCustodyBackend conformance suite (4 backends × 7 methods)`

**M3.A5-T07 — 90-day key expiry warning (PRIOR-R6-003)**
- Goal: Scheduled job that scans for keys approaching expiry at 90/30/7-day tiers and emits warnings.
- Affected paths: `apps/control-plane/src/modules/keys/key-expiry-scanner.job.ts` (new), config schema updated
- Dec dependencies: none (independent of other A5 tasks)
- Acceptance:
  - BullMQ scheduled job, runs daily
  - Config values: `KEY_EXPIRY_WARNING_DAYS` (default `[90, 30, 7]`), `KEY_EXPIRY_WARNING_DAYS` validated via Zod
  - Scans all `KeyReference` rows with `state = ACTIVE` and `expiresAt < now() + warningThreshold`
  - Emits metric `sep_key_expiry_warnings_total{tier=90|30|7}`
  - Creates Incident (LOW severity for 90-day, MEDIUM for 30-day, HIGH for 7-day)
- Test strategy: unit tests for scan logic; integration test with seeded keys at each threshold.
- Security mapping: A02:2021; CWE-298 (expired/invalid cryptographic credentials).
- Evidence: integration test ID.
- Effort: M (1d).
- Commit shape: `feat(m3.a5): 90-day key expiry warning scanner (PRIOR-R6-003)`

**M3.A5 exit criteria:**
- [ ] All 4 backends implemented (2 concrete, 2 interface-only)
- [ ] Conformance suite passes: 28 assertions (7 methods × 4 backends)
- [ ] KeyCustodyAbstraction wired in crypto module
- [ ] 90-day expiry scanner scheduled and tested

**M3.A5 total effort:** 3–4 engineer-days.

---

### M3.A4 — Auth lifecycle (MFA + refresh + lockout)

Closes PRIOR-R3-002 (HIGH) and PRIOR-R3-004 (HIGH). Depends on M3.A5-T03 (PlatformVaultBackend for MFA secret encryption).

**M3.A4-T01 — User model additions + migration**
- Goal: Add MFA + lockout fields to User.
- Affected paths: `packages/db/prisma/schema.prisma`, new migration `<ts>_auth_lifecycle_fields`
- Dec dependencies: none
- Acceptance:
  - `User.mfaSecret: String?` (Vault ciphertext ref, not plaintext TOTP secret)
  - `User.mfaEnrolledAt: DateTime?`
  - `User.failedLoginAttempts: Int @default(0)`
  - `User.lockedUntil: DateTime?`
  - Migration applies cleanly on fresh DB and on DB with existing rows
- Test strategy: schema round-trip; migration replay.
- Security mapping: A07:2021; CWE-287.
- Evidence: migration SQL.
- Effort: S (0.5d).
- Commit shape: `feat(m3.a4): User MFA + lockout fields`

**M3.A4-T02 — MFA enrollment flow (`POST /auth/mfa/enroll`)**
- Goal: Self-service TOTP enrollment endpoint (D-M3-8 default).
- Affected paths: `apps/control-plane/src/modules/auth/auth.controller.ts`, `auth.service.ts`
- Dec dependencies: T01, M3.A5-T03 (MFA secret encryption), D-M3-8, D-M3-15
- Acceptance:
  - Endpoint requires authenticated user; rejects if `mfaEnrolledAt != null` already
  - Generates 160-bit random secret via `otplib.authenticator.generateSecret()`
  - Encrypts secret via `PlatformVaultBackend.encryptForRecipient(platformMfaKeyRef, secret)`
  - Stores ciphertext in `User.mfaSecret`; sets `mfaEnrolledAt = now()`
  - Returns QR code + secret string for user to scan with authenticator app
  - Rate-limited per user: 3 enrollment attempts / hour
- Test strategy: unit tests for encrypt/store path; integration test for full endpoint.
- Security mapping: A07:2021; CWE-287, CWE-308.
- Evidence: integration test ID.
- Effort: M (1d).
- Commit shape: `feat(m3.a4): MFA enrollment endpoint + encrypted secret storage`

**M3.A4-T03 — Login flow with MFA branching**
- Goal: `POST /auth/login` handles both MFA-enrolled and non-enrolled users.
- Affected paths: `auth.controller.ts`, `auth.service.ts`
- Dec dependencies: T01, T02, D-M3-5, D-M3-6, D-M3-15
- Acceptance:
  - argon2id verify password against User.passwordHash
  - If user.lockedUntil > now() → return 423 LOCKED
  - If password wrong → increment failedLoginAttempts; if >= LOGIN_LOCKOUT_ATTEMPTS, set lockedUntil
  - If password correct + mfaEnrolledAt != null:
    - Issue 5-min MFA challenge token (JWT with `typ: mfa_challenge`)
    - Reset failedLoginAttempts = 0
    - Return 403 { mfaChallengeToken }
  - If password correct + mfaEnrolledAt == null:
    - Issue access + refresh pair
    - Reset failedLoginAttempts = 0
    - Return 200 { accessToken, refreshToken }
- Test strategy: integration tests covering 6 cases: (correct pw + mfa), (correct pw + no mfa), (wrong pw), (locked), (lockout threshold hit), (post-lockout success).
- Security mapping: A07:2021; CWE-287, CWE-307.
- Evidence: integration test IDs.
- Effort: M (1d).
- Commit shape: `feat(m3.a4): login flow with MFA + lockout branching`

**M3.A4-T04 — MFA verify flow (`POST /auth/mfa/verify`)**
- Goal: Second factor of login.
- Affected paths: `auth.controller.ts`, `auth.service.ts`
- Dec dependencies: T02, T03, D-M3-15
- Acceptance:
  - Verifies challenge token signature + expiry + `typ: mfa_challenge`
  - Decrypts User.mfaSecret via PlatformVaultBackend
  - `otplib.authenticator.verify({ token: otp, secret })` with ±1 window
  - On success: issue access + refresh pair, return 200
  - On failure: increment MFA-specific attempt counter; if >3 in 5min, invalidate challenge token
- Test strategy: integration test with mocked OTP generator; clock-skew test ±30s.
- Security mapping: A07:2021; CWE-287.
- Evidence: integration test IDs.
- Effort: M (1d).
- Commit shape: `feat(m3.a4): MFA verify flow`

**M3.A4-T05 — Refresh token rotation with replay detection**
- Goal: `POST /auth/refresh` with one-shot token rotation.
- Affected paths: `auth.controller.ts`, `auth.service.ts`, `packages/db/prisma/schema.prisma` (RefreshToken from M3.A1-T03)
- Dec dependencies: M3.A1-T03, D-M3-4, D-M3-12
- Acceptance:
  - argon2id verify tokenHash against refresh_tokens table
  - If token.usedAt != null → REPLAY DETECTED:
    - Revoke all refresh tokens for user (set revokedAt = now())
    - Create Incident with type `AUTH_REFRESH_REPLAY`, severity HIGH
    - Return 401
  - On success:
    - Mark token.usedAt = now()
    - Generate new refresh token; store hash
    - Link old token.replacedById = new token.id
    - Issue new access + refresh pair
    - Return 200
- Test strategy: integration tests for happy path, replay (same token twice), expired token.
- Security mapping: A07:2021; CWE-613.
- Evidence: integration test IDs.
- Effort: M (1d).
- Commit shape: `feat(m3.a4): refresh token rotation with replay detection`

**M3.A4-T06 — JWT secret rotation support**
- Goal: Dual-secret verification during rotation windows.
- Affected paths: `packages/common/src/config/config.ts`, `apps/control-plane/src/modules/auth/auth.service.ts`
- Dec dependencies: D-M3-9
- Acceptance:
  - Config supports `JWT_SECRET` (required) and `JWT_SECRET_NEXT` (optional)
  - Tokens sign with `JWT_SECRET`
  - Tokens verify against either `JWT_SECRET` or `JWT_SECRET_NEXT` (if set)
  - Rotation playbook documented in `docs/runbooks/jwt-secret-rotation.md`
- Test strategy: unit tests — sign with old, verify with new; sign with new, verify works.
- Security mapping: A02:2021; CWE-321.
- Evidence: unit test IDs; runbook.
- Effort: S (0.5d).
- Commit shape: `feat(m3.a4): JWT secret rotation via dual-secret verification`

**M3.A4 exit criteria:**
- [ ] Enrollment, login, MFA verify, refresh, lockout flows all tested
- [ ] MFA secrets stored as Vault ciphertext, never plaintext
- [ ] Replay detection revokes all user tokens + creates incident
- [ ] JWT rotation playbook documented

**M3.A4 total effort:** 3–4 engineer-days.

---

### M3.A6 — Partner config Zod validation (NEW-04)

**M3.A6-T01 — PartnerProfileConfigSchema + load-time validation**
- Goal: Zod schema validates `partnerProfile.config` at read-time; invalid configs fail closed.
- Affected paths: `packages/schemas/src/partner-profile-config.schema.ts` (new or extended), `apps/control-plane/src/modules/partner-profiles/partner-profile.service.ts`
- Dec dependencies: none
- Acceptance:
  - Schema validates transport-specific fields (SFTP host/port/user; HTTPS endpoint URL; AS2 AS2-ID etc.)
  - `PartnerProfileService.findById()` throws `SepError.of('PARTNER_CONFIG_INVALID', ...)` when config doesn't parse
  - Test fixture with malformed config proves fail-closed
- Test strategy: unit tests with malformed fixtures.
- Security mapping: A03:2021 Injection; CWE-20.
- Evidence: unit test ID.
- Effort: S (0.5d).
- Commit shape: `feat(m3.a6): Zod validation for partnerProfile.config at load`

**M3.A6 exit criteria:**
- [ ] Schema defined and applied at load
- [ ] Fail-closed on malformed config proven by test

**M3.A6 total effort:** 0.5 engineer-days.

---

### M3.A7 — Rate limiting + API hardening

**M3.A7-T01 — @fastify/rate-limit at edge**
- Goal: Per-IP rate limits at the network edge.
- Affected paths: `apps/control-plane/src/main.ts`, `apps/data-plane/src/main.ts`
- Dec dependencies: D-M3-11
- Acceptance:
  - Default: 200 requests/minute per IP
  - `/auth/*`: 20 requests/minute per IP
  - Storage: Redis (per D-M3-11)
  - Exceeded → 429 with Retry-After header
- Test strategy: integration test hitting 21 requests in 60s to `/auth/login`, expect 429.
- Security mapping: A04:2021 Insecure Design; CWE-770.
- Evidence: integration test ID.
- Effort: M (1d).
- Commit shape: `feat(m3.a7): edge rate limiting via @fastify/rate-limit`

**M3.A7-T02 — @nestjs/throttler at controller scope**
- Goal: Per-API-key, per-tenant, per-endpoint overrides.
- Affected paths: `apps/control-plane/src/**/*.controller.ts`
- Dec dependencies: T01
- Acceptance:
  - Global default: 1000 requests/minute per API key
  - `/auth/login`: 5/15min per (IP, email) tuple
  - `/auth/mfa/verify`: 3/5min per challenge token
  - `/submissions`: tenant-quota-based (see T03)
- Test strategy: integration tests for each override.
- Security mapping: A04:2021; CWE-770.
- Evidence: integration test IDs.
- Effort: M (1d).
- Commit shape: `feat(m3.a7): @nestjs/throttler controller overrides`

**M3.A7-T03 — Per-tenant daily submission quotas**
- Goal: Quota enforcement based on service tier.
- Affected paths: `apps/control-plane/src/modules/submissions/submission.service.ts`, `packages/common/src/config/config.ts`
- Dec dependencies: T02
- Acceptance:
  - Quota stored in Redis, keyed by `quota:<tenantId>:<YYYY-MM-DD>`
  - Defaults per ServiceTier: STANDARD 10k, DEDICATED 100k, PRIVATE unlimited
  - Exceeded → 429 with meaningful error
- Test strategy: integration test seeding 10,000 submissions for a STANDARD tenant, asserting 10,001 fails.
- Security mapping: A04:2021; CWE-770.
- Evidence: integration test ID.
- Effort: S (0.5d).
- Commit shape: `feat(m3.a7): per-tenant daily submission quotas`

**M3.A7 exit criteria:**
- [ ] All three layers active
- [ ] Abuse test shows expected 429s at edge, at controller, at quota

**M3.A7 total effort:** 1–2 engineer-days.

---

### M3.A9 — OTEL runtime wiring (NEW-08)

**M3.A9-T01 — startOtel() helper**
- Goal: Single function to initialize OTEL; safe to call before NestFactory.
- Affected paths: `packages/observability/src/otel.ts` (NodeSDK already available)
- Dec dependencies: none
- Acceptance:
  - Exports `startOtel(serviceName, serviceVersion): NodeSDK`
  - OTLP exporter wired if `OTEL_EXPORTER_OTLP_ENDPOINT` set; no-op if unset
  - Auto-instrumentation: Fastify, PG, ioredis, BullMQ
  - Returns the SDK for shutdown handling
- Test strategy: smoke test that calling with no endpoint doesn't throw; integration test with collector in testcontainers.
- Security mapping: n/a.
- Evidence: integration test ID.
- Effort: M (1d).
- Commit shape: `feat(m3.a9): startOtel helper in @sep/observability`

**M3.A9-T02 — Wire startOtel() in both service mains**
- Goal: Trace propagation live in both control-plane and data-plane.
- Affected paths: `apps/control-plane/src/main.ts`, `apps/data-plane/src/main.ts`
- Dec dependencies: T01
- Acceptance:
  - `startOtel()` called before `NestFactory.create(...)`
  - SDK shutdown registered on SIGTERM
  - Trace IDs appear in Pino logs via correlation
  - End-to-end integration test: submit request → trace ID in HTTP response header → same trace ID in BullMQ job → same trace ID in processor log
- Test strategy: integration test asserting trace ID propagation across 3 process boundaries.
- Security mapping: n/a.
- Evidence: integration test ID.
- Effort: S (0.5d).
- Commit shape: `feat(m3.a9): wire startOtel in both service mains (NEW-08)`

**M3.A9 exit criteria:**
- [ ] OTEL starts in both services
- [ ] Trace context propagates HTTP → BullMQ → worker
- [ ] OTLP exporter verified with in-repo collector

**M3.A9 total effort:** 1 engineer-day.

---

### M3.A8 — Threat-scenario tests (14 scenarios)

See §6 for the full inventory with provisional acceptance criteria. Each scenario is one test file under `tests/threat-scenarios/`.

**M3.A8-T01 through M3.A8-T14** — one task per scenario. Per-task detail in §6.

**Supporting infrastructure tasks:**

**M3.A8-T00a — Test simulator scaffolding**
- Goal: `tests/simulators/` directory for bank / regulator / partner test doubles.
- Affected paths: `tests/simulators/` (new)
- Acceptance: stub SFTP server, stub HTTPS callback receiver, all with deterministic behaviors.
- Effort: M (1d).

**M3.A8-T00b — tests/helpers lint scope closure (issue #8)**
- Goal: Close the 24-error debt surfaced during hygiene PR #7.
- Affected paths: `tests/helpers/*.ts`
- Acceptance: Type response objects properly; no new eslint-disable directives; `pnpm exec eslint tests/helpers/` green.
- Effort: M (1d).

**M3.A8 exit criteria:**
- [ ] All 14 scenario tests green
- [ ] Each test maps to CLAUDE.md §M3.7 scenario ID
- [ ] Test simulator scaffolding reusable for M3.5
- [ ] tests/helpers lint debt closed

**M3.A8 total effort:** 4–6 engineer-days (14 tests × ~0.3–0.4d each + infrastructure).

---

### M3.A10 — Residual cleanup + coverage ratchet

**M3.A10-T01 — 5 `as unknown as` casts eliminated**
- Goal: Replace processor/auth casts with proper typing.
- Affected paths: data-plane processors + auth service (specific files identified during M3.A5/A4 work).
- Acceptance: `grep 'as unknown as' --include='*.ts'` returns 0 matches in runtime code.
- Effort: M (1d).
- Commit shape: `fix(m3.a10): eliminate as-unknown-as casts in processors and auth`

**M3.A10-T02 — 2 `throw new Error` typed**
- Goal: Replace plain throws with `SepError.of(...)` in config loader and db service bootstrap.
- Affected paths: `packages/common/src/config/config.ts`, `packages/db/src/database.service.ts`
- Acceptance: `grep 'throw new Error' --include='*.ts'` returns 0 matches in runtime code.
- Effort: S (0.5d).
- Commit shape: `fix(m3.a10): type bootstrap-time errors`

**M3.A10-T03 — @sep/crypto coverage restored to ≥80%**
- Goal: Add tests until coverage threshold can raise back to 80.
- Affected paths: `packages/crypto/vitest.config.ts` (threshold), new test files in `packages/crypto/src/**/*.test.ts`
- Dec dependencies: all of M3.A5 complete (coverage comes from Vault backend tests mostly)
- Acceptance: Threshold `lines: 80, statements: 80` in vitest.config; tests pass.
- Effort: M (1d) (probably less — most coverage arrives with M3.A5).
- Commit shape: `test(m3.a10): restore @sep/crypto coverage threshold to 80%`

**M3.A10-T04 — verify-m3-findings.mjs authored**
- Goal: Mechanical verification script for M3's closures, mirroring M3.0's pattern.
- Affected paths: `_plan/scripts/verify-m3-findings.mjs` (new)
- Acceptance:
  - Script checks every finding in §1.1
  - Uses same BLOCK/FAIL/OK vocabulary
  - Exit 0 when M3 complete
- Effort: M (1d).
- Commit shape: `feat(plan): verify-m3-findings.mjs for M3 closure verification`

**M3.A10 exit criteria:**
- [ ] 0 `as unknown as` in runtime
- [ ] 0 `throw new Error` in runtime
- [ ] @sep/crypto coverage ≥80%
- [ ] verify-m3-findings.mjs exits 0

**M3.A10 total effort:** 1 engineer-day (coverage may shift depending on A5 residue).

---

## 6. Threat-scenario test inventory (CLAUDE.md §M3.7)

Each scenario becomes one file under `tests/threat-scenarios/T<NN>_<name>.threat.test.ts`. Per-scenario acceptance criteria:

| # | Scenario | Primary control tested | Infrastructure needed |
|---|---|---|---|
| T1 | Stolen operator credential | MFA requirement; lockout; short access-token TTL | Postgres + Redis |
| T2 | Mis-routed payload (wrong partner profile) | Routing integrity; partner profile state machine | Postgres + simulator |
| T3 | Wrong partner public key (encryption for wrong recipient) | Key activation flow; dual-control | Postgres + Vault |
| T4 | Expired key used in signing/encryption | Key lifecycle state machine; expiry scanner | Postgres + Vault |
| T5 | Replayed submission (idempotency-key replay) | `@@unique([tenantId, idempotencyKey])` enforcement | Postgres |
| T6 | Tampered acknowledgement (partner callback) | Signature verification on inbound callbacks | Postgres + Vault |
| T7 | Secret in logs (accidental leakage) | Pino redaction paths; error sanitisation | in-process |
| T8 | Cross-tenant data exposure via API | RLS enforcement; BOLA checks | Postgres |
| T9 | Unauthorised partner profile change | RBAC + dual-control approval | Postgres |
| T10 | Malicious connector config (SSRF via partner endpoint) | Endpoint validator; DNS-rebinding pin | Postgres + simulator |
| T11 | Key rotation mid-flight (ciphertext from old key must decrypt) | Dual-key overlap window | Postgres + Vault |
| T12 | Refresh token theft / replay | One-shot rotation; replay-detection revocation | Postgres + Redis |
| T13 | Brute-force login | Rate limiting (edge + NestJS); lockout | Postgres + Redis |
| T14 | Audit chain tampering (attempted UPDATE of audit_events) | REVOKE + RLS + hash-chain verification | Postgres |

**Per-scenario acceptance criteria are written during M3.A8 task start** when the service methods they exercise have stabilized through M3.A1–A7 execution.

---

## 7. Cross-cutting specifications

### 7.1 Prisma model additions — locked

Per schema review (schema.prisma at post-m3.0-baseline):

**User (4 new fields):**
```prisma
mfaSecret          String?    // Vault ciphertext ref; plaintext never at rest
mfaEnrolledAt      DateTime?
failedLoginAttempts Int       @default(0)
lockedUntil        DateTime?
```

**New model — RefreshToken:**
```prisma
model RefreshToken {
  id               String    @id @default(cuid())
  tenantId         String    // Denormalized for RLS
  userId           String
  tokenHash        String    @unique  // argon2id of raw token
  issuedAt         DateTime  @default(now())
  expiresAt        DateTime
  usedAt           DateTime?
  replacedById     String?
  revokedAt        DateTime?
  revocationReason String?

  tenant           Tenant    @relation(fields: [tenantId], references: [id])
  user             User      @relation(fields: [userId], references: [id])

  @@index([tenantId])
  @@index([userId])
  @@index([expiresAt])
  @@map("refresh_tokens")
}
```

**DeliveryAttempt + WebhookDeliveryAttempt (M3.A1-T02 denormalization):**
```prisma
// Add to both models
tenantId String
@@index([tenantId])
```

**KeyReference:** no changes (backendType enum + backendRef already support M3 needs).

**AuditEvent:** no changes (hash-chain fields already exist from M2).

### 7.2 Error codes — new in `packages/common/src/errors/error-codes.ts`

```typescript
AUTH_MFA_REQUIRED
AUTH_MFA_INVALID
AUTH_MFA_ENROLLMENT_REQUIRED
AUTH_MFA_ALREADY_ENROLLED
AUTH_ACCOUNT_LOCKED
AUTH_TOO_MANY_ATTEMPTS
AUTH_REFRESH_REPLAY_DETECTED
AUTH_REFRESH_EXPIRED

CRYPTO_BACKEND_NOT_IMPLEMENTED
CRYPTO_BACKEND_NOT_AVAILABLE
CRYPTO_BACKEND_UNKNOWN
CRYPTO_BACKEND_UNAVAILABLE
CRYPTO_KEY_NOT_FOUND_IN_BACKEND

TENANT_CONTEXT_MISSING
TENANT_CONTEXT_INVALID

PARTNER_CONFIG_INVALID

RATE_LIMIT_EXCEEDED
QUOTA_EXCEEDED
```

Each code maps to a stable HTTP status via the error-envelope table in `IMPLEMENTATION_PLAN.md` §4.5.

### 7.3 Environment variables — new in `config.ts`

```
VAULT_ADDR              required in prod
VAULT_TOKEN             required in dev; AppRole in prod
VAULT_NAMESPACE         optional; default unset
VAULT_MOUNT_TRANSIT     default "transit"
VAULT_MOUNT_KV          default "kv"
VAULT_REQUEST_TIMEOUT_MS default 5000

JWT_SECRET              required
JWT_SECRET_NEXT         optional; enables rotation window
ACCESS_TOKEN_TTL_SEC    default 900
REFRESH_TOKEN_TTL_SEC   default 1209600 (14 days)

LOGIN_LOCKOUT_ATTEMPTS  default 10
LOGIN_LOCKOUT_WINDOW_SEC default 1800 (30 min)
LOGIN_LOCKOUT_DURATION_SEC default 1800 (30 min)

MFA_ISSUER_NAME         default "SEP Malaysia"
MFA_SECRET_ENCRYPTION_KEY_REF  default "platform/mfa-master"

KEY_EXPIRY_WARNING_DAYS array, default [90, 30, 7]

OTEL_EXPORTER_OTLP_ENDPOINT   optional; unset = no exporter
OTEL_SERVICE_NAME_CONTROL_PLANE default derived from package.json
OTEL_SERVICE_NAME_DATA_PLANE    default derived from package.json
```

All validated via Zod config loader at bootstrap. Unset required → fails closed with `CONFIG_INVALID`.

### 7.4 Migration ordering — strict

M3 produces 7 Prisma migrations. They MUST apply in this order:

1. `<ts>_auth_lifecycle_fields` — User additions (M3.A4-T01)
2. `<ts>_refresh_tokens_model` — RefreshToken + RLS policies (M3.A1-T03)
3. `<ts>_denormalize_tenant_id` — delivery_attempts + webhook_delivery_attempts (M3.A1-T02)
4. `<ts>_enable_rls_tenant_tables` — RLS + 72 policies (M3.A1-T04)
5. `<ts>_audit_append_only` — REVOKE on audit_events (M3.A2-T03)
6. `<ts>_set_updated_at_trigger` — trigger function + 10 attachments (M3.A3-T01, T02)
7. `<ts>_retention_policy_hooks` — optional placeholder (M3.A3-T03; skip if schema already has)

Each migration is reversible where possible. RLS migration has explicit `down` that DISABLES policies (not DROPS).

### 7.5 pnpm.overrides governance (per ADR-0006)

Any new override added during M3 must follow ADR-0006's three legitimate uses:
1. Cross-workspace version alignment
2. Targeted security-closure forcing
3. Temporary pin-forward with closure trigger (must file tracking issue)

Updates to `pnpm.overrides` require updating ADR-0006's "Current overrides" appendix in the same commit.

### 7.6 ADR template refinement (v0.7 addition)

All new ADRs authored during M3 must include:

```
## Status
<Accepted | Proposed | Superseded>

## Decider(s)
<names>

## Context
<...>

## Decision
<what we chose>

## Conditions for validity
<what had to be true for this decision to be correct; when any of
these change, the decision needs review>

## Consequences
<...>
```

The "Conditions for validity" field is new in v0.7. Prevents the M3.0 #6 pattern (decision valid at the time, stale when conditions changed, reversal surprising).

---

## 8. Test strategy

### 8.1 Coverage targets at M3 close

| Package | At M3 start | At M3 close | Driver |
|---|---|---|---|
| `@sep/crypto` | 73 lines | ≥80 | Vault backend tests + conformance suite + expiry scanner |
| `@sep/common` | meets floor | ≥85 | New error codes + withTimeout unit tests |
| `@sep/db` | 40 floor | ≥55 | RLS policy tests + DatabaseService.forTenant tests |
| `@sep/schemas` | meets floor | meets floor | Proportional to RefreshToken + MFA schemas |
| `apps/control-plane` | 45 floor | ≥60 | Auth flows, MFA, refresh, lockout |
| `apps/data-plane` | 20 floor | ≥30 | Residual processor cleanup; rate-limit integration |

Thresholds ratchet in `vitest.config.ts` per package AS coverage lands, not at M3 close in one cliff. Any PR that drops a threshold requires an ADR.

### 8.2 New test categories

- **RLS negative tests:** 144 assertions under `sep_app` with no tenant context or wrong tenant
- **Transactional coupling fault-injection:** inject failure at specific async boundaries
- **Conformance tests:** 28 assertions (7 methods × 4 backends)
- **Threat-scenario tests:** 14 named scenarios per §6
- **Auth flow integration:** login, enroll, verify, refresh, lockout — 6 happy paths + 8 negative paths minimum
- **OTEL trace propagation:** assert trace-ID consistency across 3 process boundaries

### 8.3 Testcontainers footprint

- Postgres 16 container (per test-suite, TRUNCATE between tests)
- Vault 1.18 dev-mode (per test-suite, `vault operator seal` between tests)
- Redis 7 (per test-suite)

Estimated CI time increase: +2–3 minutes per run. Acceptable.

---

## 9. CI changes

**New jobs:**
- `rls-negative-tests` — standalone job so RLS regressions are maximally visible
- `threat-scenarios` — runs M3.A8's 14 tests under testcontainers

**Strengthened job:**
- `security` — already has osv-scanner + trufflehog; M3.A0 dormant-gate inventory confirms both run correctly on every trigger type

**New required checks:**
- Every new job added to GitHub branch-protection required checks before merge to main
- Documented in `_plan/M3_A0_GATE_INVENTORY.md`

---

## 10. Risk register

Extends IMPLEMENTATION_PLAN §8 with M3-specific risks:

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| M3-R1 | RLS rollout causes silent data-access regression in code relying on implicit app-layer predicates | Medium | Critical | Every service method has RLS-aware integration test BEFORE RLS is turned on for its table |
| M3-R2 | Vault dev-mode fails under testcontainers at integration-test scale | Low | Medium | Share one Vault container across suites where possible |
| M3-R3 | Argon2id at OWASP params slows MFA enrollment UX | Low | Low | Tests use low-cost params; production uses OWASP params; enrollment is rare |
| M3-R4 | MFA secret encryption introduces circular boot-time dep (MFA needs Vault; Vault may be mid-boot) | Medium | Medium | Platform MFA key bootstrapped at install-time via admin script, not at app boot |
| M3-R5 | Threat-scenario tests surface architectural gaps requiring code changes outside M3 scope | Medium | Medium | Flag each as blocker when discovered; do not silently expand M3 |
| M3-R6 | Solo contributor ships 7 security-critical migrations without second-pair-of-eyes review | **High** | **Critical** | See §10.1 — strong recommendation for second reviewer |
| M3-R7 | Q9 owner for R8-001 not identified by M3 close | Medium | High | Start owner conversations NOW in parallel with M3 execution; 4–6 week lead time |
| M3-R8 | Coverage ratchet fails for @sep/crypto because work lands late | Medium | Low | Ratchet is exit criterion, not per-task gate |
| M3-R9 | M3.A0 dormant-gate inventory surfaces more latent issues, expanding scope | Medium | Low | Time-box M3.A0 at 2.5 days; anything beyond goes to follow-up issues |
| M3-R10 | `composite: true` migration breaks a cross-package typecheck path | Medium | Medium | Task ordering in M3.A0 — T01 composite, T02 remove aliases, T03 references, T04 verify. Break at any step is bisectable |
| M3-R11 | Migration 4 (RLS policies) fails partway through 72-policy creation | Low | High | Single `BEGIN/COMMIT` transaction means all-or-nothing; test migration on fresh DB before prod |

### 10.1 Second reviewer — strongly recommended

M3 is qualitatively different from M3.0. M3.0 was mechanical: swap deps, run tests, move on. M3 is architectural: RLS policies that silently leak cross-tenant data if wrong, audit coupling that silently loses evidence if wrong, MFA flows that silently bypass the second factor if wrong. Every M3 task has a silent-failure mode.

Solo-shipping this work with only AI assistance is the highest-expected-value place in all of Phase 1 to add a second pair of human eyes. Minimum bar: CODEOWNERS points at a second security-aware reviewer for `packages/db/prisma/migrations/`, `packages/crypto/`, `apps/control-plane/src/modules/auth/`. CODEOWNERS from PR #15 already structurally supports this; v0.7 asks you to commit to the discipline.

**Either answer is workable, but commit explicitly:**
- **(i) Second full-time contributor or retained security advisor** — ideal; add them to CODEOWNERS; execution proceeds normally.
- **(ii) Solo with CODEOWNERS self-review discipline** — acceptable compensating control; each PR to the three paths requires `git commit --amend -m '...'` with an explicit self-review comment in the PR body addressing: threat model, test coverage, rollback path. No exceptions.

---

## 11. Exit criteria

M3 closes when **every** item below is true:

### Capability exit
- [ ] 18 tenant-scoped tables have RLS policies; cross-tenant negative tests green
- [ ] Audit writes transactionally coupled + append-only enforced
- [ ] `set_updated_at()` trigger active on 10 mutable tables
- [ ] Key custody: Vault backends concrete; KMS + SoftwareLocal assert expected errors; conformance suite green
- [ ] Auth: MFA + refresh + lockout flows live; replay detection proven
- [ ] Rate limiting: all three layers active
- [ ] OTEL traces propagate HTTP → BullMQ → worker; OTLP exporter verified
- [ ] Partner config Zod-validated at load (NEW-04)
- [ ] 14 threat-scenario tests green

### Cleanup exit
- [ ] 0 `as unknown as` casts in runtime
- [ ] 0 `throw new Error` in runtime
- [ ] @sep/crypto line coverage ≥80%
- [ ] `verify-m3-0-findings.mjs` still exits 0 (no regressions)
- [ ] `verify-m3-findings.mjs` authored + exits 0 (M3 closure verified)

### Process exit
- [ ] All 16 §3 decision points resolved
- [ ] Q9 regulatory ownership (R8-001) resolved — owner named
- [ ] Second-reviewer decision (§10.1) committed to explicitly
- [ ] `_plan/M3_HANDOFF.md` produced
- [ ] PLANS.md updated: M3 → 🟢 COMPLETE; M3.5 → 🟡 READY
- [ ] ADRs captured for architectural decisions (tenancy routing, Vault client design, MFA secret encryption, JWT rotation)
- [ ] Post-M3 hostile-audit re-run shows R2-001, R3-001, R2-002, R6-001, R3-002 as CLOSED

### Findings closed by M3

Locked at M3 close (exit criteria complete):
PRIOR-R1-003, PRIOR-R4-003, PRIOR-R2-001, PRIOR-R3-001, PRIOR-R2-002, PRIOR-R2-003, PRIOR-R3-002, PRIOR-R3-004, PRIOR-R6-001, PRIOR-R6-003, PRIOR-R4-001, PRIOR-R4-002, NEW-02, NEW-03, NEW-04, NEW-08

Post-M3 portfolio state: approximately 70% of findings closed, tracking IMPLEMENTATION_PLAN.md §3.1 roadmap.

---

## 12. Handoff expectations

On M3 completion, produce `_plan/M3_HANDOFF.md` with:
1. §11 verification — checklist walked with evidence per item
2. Findings closed with closure evidence per finding
3. Deviations from this plan — anything that shifted at execution time and why
4. Gotchas encountered vs §10 risks predicted
5. Q9 resolution — R8-001 owner name, or escalation note
6. M3.5 intake notes — anything surfaced for M3.5 scope
7. `verify-m3-findings.mjs` final output (expected: exit 0)

Same rolling-wave discipline as M3.0 → M3: plan → execute → handoff → plan next.

---

## 13. v0.6 → v0.7 changelog

**Architecture delta (§2):**
- Key custody section rewritten against schema reality: `KeyBackendType` has 4 values not 2; `backendRef` already stores non-material refs; no `ArmoredKeyMaterialProvider` to delete
- `KeyState` enum expanded reference (11 values, not glossed)
- Tenant-scoped table inventory locked to 15+2+1 = 18 tables (was estimated "12-15")
- FK-scoped tables resolved via option (a) denormalization (Q/A #2 in user answer)

**Decision points (§3):**
- D-M3-15 added (TOTP algorithm parameters locked)
- D-M3-16 added (RLS FK-scoped decision locked)
- Count increased from 14 to 16

**Task groups (§4 + §5):**
- Effort estimate shifted 22–31 → 20–28 eng-days (schema maturity credit)
- M3.A0 scope expanded with sub-tasks for the two blockers (T01–T05 for PRIOR-R1-003 + PRIOR-R4-003) plus dormant-gate inventory (T06) + handoff (T07)
- Every task group now has per-task detail (IDs, acceptance criteria, test strategy, security mapping, evidence, effort, commit shape)
- M3.A5 scope compressed: Vault implementations concrete; KMS + SoftwareLocal interface-only

**Cross-cutting specs (§7):**
- §7.1 Prisma model additions locked (specific field types, indexes, relations)
- §7.4 migration ordering: 7 migrations sequenced
- §7.5 pnpm.overrides governance section added (per ADR-0006)
- §7.6 ADR template refined with "Conditions for validity" field

**Risk register (§10):**
- Added M3-R10 (composite migration breakage) and M3-R11 (72-policy migration atomicity)
- §10.1 made explicit: either add second reviewer OR commit to self-review discipline with named compensating controls

**Exit criteria (§11):**
- Verify scripts now explicit as start and close signals
- "verify-m3-findings.mjs authored" is an M3 task (M3.A10-T04)
- Second-reviewer decision added as process-exit requirement

---

## 14. Promotion to v1.0

Promoted 2026-04-18. See "Sign-off record" block at the top of this file for gate answers. Historical gate list retained below for traceability:

1. User signs off on the scope + estimate — **done** (gate 1)
2. User confirms second-reviewer decision (option i or ii per §10.1) — **done, option (ii)** (gate 2)
3. User confirms Q9 owner path (either named, or "will name during M3.A4") — **done, deferred to M3.A4** (gate 3)

Claude Code picks this plan up via an execution prompt analogous to M3.0's §17, starting with M3.A0 and proceeding group by group.

---

**End of M3 execution plan v1.0.**
