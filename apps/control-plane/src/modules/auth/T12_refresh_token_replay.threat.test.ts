/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, no-process-env */

/**
 * Threat scenario T12 — Refresh token theft / replay (M3.A8).
 *
 * Plan §6 scenario ID: T12. Primary control: one-shot refresh
 * token rotation; replay-detection chain revocation.
 *
 * Attack model:
 *   1. Legitimate client issues refresh token A, rotates A→B, B→C.
 *   2. Attacker captures A (for example from a captured log export
 *      or a mishandled browser storage).
 *   3. Attacker presents A to /auth/refresh.
 *   4. Expected: A, B, C all revoked (replay-detected), and
 *      AUTH_REFRESH_TOKEN_REPLAY returned. The legitimate client's
 *      current token C is ALSO revoked so the attacker-or-legit
 *      collusion ends the session entirely. Caller must re-login.
 *
 * Defense mechanism:
 *   RefreshTokenService.refresh observes `usedAt != null` on the
 *   presented row (because A was rotated already), triggers
 *   `revokeChain(tenantId, row.id)` which walks `replacedById` in
 *   BOTH directions, and updates every reachable row with
 *   `revocationReason = 'replay-detected'`.
 *
 * The same behavior is exercised by auth-lifecycle.integration.test.ts
 * Scenario 2 from M3.A4-T06. This scenario frames the property as a
 * discrete THREAT-scenario test with the plan §6 scenario ID, so a
 * CI run filtered to `[T*` describe prefixes surfaces the refresh-
 * replay coverage distinctly.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { DatabaseService } from '@sep/db';
import { ErrorCode } from '@sep/common';
import { RefreshTokenService } from './refresh-token.service';
import { hmacToken } from './refresh-hmac-key.provider';

const SCENARIO_ID = 'T12_refresh_token_replay';
const TENANT_ID = 'cthreatsc12refreshown0001';

const MIGRATION_URL = process.env['DATABASE_URL'];
const RUNTIME_URL = process.env['RUNTIME_DATABASE_URL'];
const hasInfra = typeof MIGRATION_URL === 'string' && typeof RUNTIME_URL === 'string';

describe.skipIf(!hasInfra)(
  `[${SCENARIO_ID}] replaying a used refresh token revokes the entire chain`,
  () => {
    let seedClient: PrismaClient;
    let runtimeClient: PrismaClient;
    let refreshTokenService: RefreshTokenService;
    let hmacKey: Buffer;
    let userId: string;
    const email = 't12-refresh-replay@sep.test';

    beforeAll(async () => {
      seedClient = new PrismaClient({
        ...(MIGRATION_URL !== undefined && { datasourceUrl: MIGRATION_URL }),
      });
      runtimeClient = new PrismaClient({
        ...(RUNTIME_URL !== undefined && { datasourceUrl: RUNTIME_URL }),
      });
      const db = new DatabaseService(runtimeClient);

      // Deterministic HMAC key so recomputing hashes in assertions
      // matches the ones the service persisted.
      hmacKey = Buffer.alloc(32, 0x7a);
      refreshTokenService = new RefreshTokenService(db, hmacKey);

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
      const u = await seedClient.user.create({
        data: { tenantId: TENANT_ID, email, displayName: 'T12 victim' },
      });
      userId = u.id;
    }, 30_000);

    afterAll(async () => {
      await seedClient.refreshToken.deleteMany({ where: { tenantId: TENANT_ID, userId } });
      await seedClient.user.deleteMany({ where: { tenantId: TENANT_ID, email } });
      await seedClient.$disconnect();
      await runtimeClient.$disconnect();
    });

    beforeEach(async () => {
      await seedClient.refreshToken.deleteMany({ where: { tenantId: TENANT_ID, userId } });
    });

    it('attacker replaying token A (after legit rotation to B and C) revokes A, B, C with replay-detected', async () => {
      const db = new DatabaseService(runtimeClient);

      // Step 1 — legitimate flow: issue A, rotate A→B, rotate B→C.
      const issuedA = await db.forTenant(TENANT_ID, (tx) =>
        refreshTokenService.issue(tx, TENANT_ID, userId),
      );
      const resultB = await refreshTokenService.refresh(issuedA.token);
      const resultC = await refreshTokenService.refresh(resultB.refreshToken.token);

      // Step 2 — attacker replays A.
      await expect(refreshTokenService.refresh(issuedA.token)).rejects.toMatchObject({
        response: expect.objectContaining({ code: ErrorCode.AUTH_REFRESH_TOKEN_REPLAY }),
      });

      // Step 3 — assert the whole chain is revoked with the
      // replay-detected reason. A, B, AND C must all carry the mark.
      const tokens = await seedClient.refreshToken.findMany({
        where: { tenantId: TENANT_ID, userId },
        select: {
          tokenHash: true,
          revokedAt: true,
          revocationReason: true,
        },
      });
      expect(tokens).toHaveLength(3);
      for (const t of tokens) {
        expect(t.revokedAt).not.toBeNull();
        expect(t.revocationReason).toBe('replay-detected');
      }
      // Verify the chain covered A (the replayed token), B, and C.
      const hashA = hmacToken(issuedA.token, hmacKey);
      const hashB = hmacToken(resultB.refreshToken.token, hmacKey);
      const hashC = hmacToken(resultC.refreshToken.token, hmacKey);
      const hashes = new Set(tokens.map((t) => t.tokenHash));
      expect(hashes.has(hashA)).toBe(true);
      expect(hashes.has(hashB)).toBe(true);
      expect(hashes.has(hashC)).toBe(true);
    });

    it('presenting C (the current legit token) AFTER the replay detection returns AUTH_REFRESH_TOKEN_INVALID, not a new rotation', async () => {
      // Run the attack once to lock down the chain; reuse fixture.
      const db = new DatabaseService(runtimeClient);
      const issuedA = await db.forTenant(TENANT_ID, (tx) =>
        refreshTokenService.issue(tx, TENANT_ID, userId),
      );
      const resultB = await refreshTokenService.refresh(issuedA.token);
      const resultC = await refreshTokenService.refresh(resultB.refreshToken.token);
      await expect(refreshTokenService.refresh(issuedA.token)).rejects.toBeDefined();

      // C is revoked by chain revocation; legit client trying to
      // rotate it fails with AUTH_REFRESH_TOKEN_INVALID (revoked),
      // NOT AUTH_REFRESH_TOKEN_REPLAY — revoked tokens are a known
      // state, replay detection only fires on usedAt != null.
      await expect(refreshTokenService.refresh(resultC.refreshToken.token)).rejects.toMatchObject({
        response: expect.objectContaining({ code: ErrorCode.AUTH_REFRESH_TOKEN_INVALID }),
      });
    });
  },
);
