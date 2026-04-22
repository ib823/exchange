/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, no-process-env */

/**
 * Threat scenario T1 — Stolen operator credential (M3.A8).
 *
 * Plan §6 scenario ID: T1. Primary control: MFA requirement, access-
 * token TTL, lockout (the latter is exercised in T13).
 *
 * Attack model:
 *   Attacker has stolen a user's password (phishing, reuse, breach).
 *   The user has MFA enrolled. Attacker presents the correct password
 *   and expects an access token. Defense: LoginService MUST return an
 *   MFA challenge token, NOT an access token. The attacker has no
 *   path to a usable access token without the TOTP (or recovery
 *   code).
 *
 * Defense mechanism:
 *   LoginService.validatePassword, after successful argon2Verify, checks
 *   `user.mfaEnrolledAt !== null` and branches to `issueMfaChallenge()`
 *   which returns only `{ mfaChallengeToken, expiresIn: '5m' }` —
 *   with no `accessToken` in the payload.
 *
 * Test is service-level (does not exercise HTTP) because the branching
 * decision sits inside LoginService. Observing the service return
 * shape directly is the clearest way to assert the invariant.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { hash as argon2Hash } from '@node-rs/argon2';
import { DatabaseService } from '@sep/db';
import { LoginService } from './login.service';
import { AuthService } from './auth.service';
import type { RefreshTokenService } from './refresh-token.service';

const SCENARIO_ID = 'T01_stolen_operator_credential';
const TENANT_ID = 'cthreatsc01stolenownr0001';
const CORRECT_PASSWORD = 'correct-horse-battery-staple-2026';

const MIGRATION_URL = process.env['DATABASE_URL'];
const RUNTIME_URL = process.env['RUNTIME_DATABASE_URL'];
const hasInfra = typeof MIGRATION_URL === 'string' && typeof RUNTIME_URL === 'string';

/**
 * LoginService's MFA branch calls `getConfig()` to read the JWT
 * secret for signing the challenge token. Zod validation on the
 * config requires several fields that the threat-test process
 * doesn't otherwise need. Populate them with test-value defaults
 * BEFORE `@sep/common` loads its singleton.
 */
function ensureTestEnv(): void {
  const defaults: Record<string, string> = {
    JWT_SECRET: 'threat-scenario-test-jwt-secret-minimum-32-chars',
    REFRESH_TOKEN_SECRET: 'threat-scenario-test-refresh-secret-minimum-32-chars',
    INTERNAL_SERVICE_TOKEN: 'threat-scenario-test-internal-service-token',
    WEBHOOK_SIGNING_SECRET: 'threat-scenario-test-webhook-signing-secret-32',
    AUDIT_HASH_SECRET: 'threat-scenario-test-audit-hash-secret-min32ch',
    STORAGE_ENDPOINT: 'http://localhost:9000',
    STORAGE_ACCESS_KEY: 'test',
    STORAGE_SECRET_KEY: 'test',
    STORAGE_BUCKET_PAYLOADS: 'test-payloads',
    STORAGE_BUCKET_AUDIT_EXPORTS: 'test-audit-exports',
    VAULT_ADDR: 'http://localhost:8200',
    VAULT_TOKEN: 'test-vault-token',
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
}
ensureTestEnv();

describe.skipIf(!hasInfra)(
  `[${SCENARIO_ID}] stolen password cannot bypass MFA — correct password on MFA-enrolled user returns only an MFA challenge`,
  () => {
    let seedClient: PrismaClient;
    let runtimeClient: PrismaClient;
    let loginService: LoginService;
    const email = 't01-stolen-credential@sep.test';

    beforeAll(async () => {
      seedClient = new PrismaClient({
        ...(MIGRATION_URL !== undefined && { datasourceUrl: MIGRATION_URL }),
      });
      runtimeClient = new PrismaClient({
        ...(RUNTIME_URL !== undefined && { datasourceUrl: RUNTIME_URL }),
      });
      const db = new DatabaseService(runtimeClient);

      const jwt = new JwtService({ secret: 'threat-scenario-test-secret-minimum-32-chars' });
      const authService = {
        issueToken: (): { accessToken: string; expiresIn: string } => ({
          accessToken: 'SHOULD_NOT_REACH_THIS_BRANCH',
          expiresIn: '15m',
        }),
      } as unknown as AuthService;
      const refreshTokenService = {
        issue: (): Promise<{ token: string; expiresAt: Date }> =>
          Promise.resolve({
            token: 'SHOULD_NOT_REACH_THIS_BRANCH',
            expiresAt: new Date(Date.now() + 86_400_000),
          }),
      } as unknown as RefreshTokenService;
      loginService = new LoginService(db, jwt, authService, refreshTokenService);

      await seedClient.tenant.upsert({
        where: { id: TENANT_ID },
        update: {},
        create: {
          id: TENANT_ID,
          name: `Threat-Scenario ${SCENARIO_ID}`,
          legalEntityName: `Threat-Scenario ${SCENARIO_ID} LLC`,
        },
      });
      await seedClient.user.deleteMany({ where: { tenantId: TENANT_ID, email } });
      const passwordHash = await argon2Hash(CORRECT_PASSWORD);
      await seedClient.user.create({
        data: {
          tenantId: TENANT_ID,
          email,
          displayName: 'T01 stolen-credential victim',
          passwordHash,
          // MFA enrolled. mfaSecretRef points at a Vault path the
          // service resolves later in /auth/mfa/verify — not needed
          // here because T1 proves the PRE-TOTP branching property.
          mfaEnrolledAt: new Date(),
          mfaSecretRef: 'platform/mfa-secrets/t01-victim-not-exercised',
        },
      });
    }, 30_000);

    afterAll(async () => {
      await seedClient.user.deleteMany({ where: { tenantId: TENANT_ID, email } });
      await seedClient.$disconnect();
      await runtimeClient.$disconnect();
    });

    it('correct password on MFA-enrolled user returns ONLY an MFA challenge — no access token issued', async () => {
      const result = await loginService.validatePassword(TENANT_ID, email, CORRECT_PASSWORD);

      // The attacker's expectation: { accessToken, expiresIn }.
      // Reality: { mfaChallengeToken, expiresIn }.
      expect('accessToken' in result).toBe(false);
      expect('refreshToken' in result).toBe(false);
      expect('mfaChallengeToken' in result).toBe(true);
      const challenge = (result as { mfaChallengeToken: string; expiresIn: string })
        .mfaChallengeToken;
      expect(typeof challenge).toBe('string');
      expect(challenge.length).toBeGreaterThan(0);
    });

    it('MFA challenge token carries typ=mfa_challenge and cannot be used as an access token', async () => {
      const result = await loginService.validatePassword(TENANT_ID, email, CORRECT_PASSWORD);
      const challenge = (result as { mfaChallengeToken: string }).mfaChallengeToken;

      // Decode the JWT payload without verifying (structure inspection only).
      const parts = challenge.split('.');
      expect(parts.length).toBe(3);
      const partOne = parts[1] ?? '';
      const payload = JSON.parse(Buffer.from(partOne, 'base64url').toString('utf8')) as {
        typ?: string;
        userId?: string;
        tenantId?: string;
      };
      // typ discriminates the challenge token from an access token.
      // MfaVerifyService re-checks this claim before consuming; any
      // access-token-shaped JWT presented to /auth/mfa/verify would
      // fail the typ guard.
      expect(payload.typ).toBe('mfa_challenge');
      expect(payload.tenantId).toBe(TENANT_ID);
    });
  },
);
