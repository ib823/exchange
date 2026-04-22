/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */

/**
 * Threat scenario T5 — Replayed submission / idempotency key replay (M3.A8).
 *
 * Plan §6 scenario ID: T5. Primary control:
 * `@@unique([tenantId, idempotencyKey])` enforcement on
 * submissions.
 *
 * Attack model:
 *   1. Legitimate client submits payload P with idempotency key K.
 *   2. Attacker captures K (from a log line / proxy /
 *      retry-observer).
 *   3. Attacker submits a different payload P' with the same K,
 *      hoping the server treats it as the same submission (if
 *      dedup is lax) or as a fresh one that bypasses quotas /
 *      delivery (if the unique constraint is missing).
 *
 * Defense mechanism (two layers):
 *   - DB layer: Prisma @@unique([tenantId, idempotencyKey])
 *     enforces a per-tenant unique index. Direct INSERT of a
 *     second row with the same (tenantId, idempotencyKey) pair
 *     fails with Postgres error 23505 (unique_violation).
 *   - Service layer: SubmissionsService.create explicitly queries
 *     by the (tenantId, idempotencyKey) tuple BEFORE the INSERT
 *     and throws SepError(VALIDATION_DUPLICATE) with the existing
 *     submission's id in context. T5 tests the DB layer directly
 *     (no service boot needed); the service-layer path is covered
 *     by the existing submissions.service.test.ts unit test.
 *
 * Cross-tenant note: the unique is (tenantId, idempotencyKey), not
 * idempotencyKey alone. Two different tenants CAN use the same key
 * legitimately — each tenant's key space is scoped. This test
 * includes a positive case asserting that cross-tenant uniqueness
 * isn't enforced, which is the intended behaviour.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { hasPostgres, makeSeedClient } from './_helpers/clients';
import { TENANTS, ensureThreatTestTenants } from './_helpers/tenants';
import { scenarioTitle } from './_helpers/scenario-id';

const TENANT_ID = TENANTS.T05_idempotency_owner;
const OTHER_TENANT_ID = TENANTS.T08_cross_tenant_victim; // any other seeded tenant works

describe.skipIf(!hasPostgres)(
  scenarioTitle(
    'T5',
    'same (tenantId, idempotencyKey) rejected as duplicate; cross-tenant unaffected',
  ),
  () => {
    let seedClient: PrismaClient;
    let partnerProfileId: string;

    beforeAll(async () => {
      seedClient = makeSeedClient();
      await ensureThreatTestTenants(seedClient, [
        'T05_idempotency_owner',
        'T08_cross_tenant_victim',
      ]);

      // Submissions require a partner profile FK. Create one (idempotent).
      const existingProfile = await seedClient.partnerProfile.findFirst({
        where: { tenantId: TENANT_ID, name: 'T5 Test Partner Profile' },
      });
      if (existingProfile === null) {
        const profile = await seedClient.partnerProfile.create({
          data: {
            tenantId: TENANT_ID,
            name: 'T5 Test Partner Profile',
            partnerType: 'BANK',
            environment: 'TEST',
            transportProtocol: 'SFTP',
            messageSecurityMode: 'SIGN_ENCRYPT',
            config: {
              sftp: {
                host: 'sftp.t5.example',
                port: 22,
                username: 'sep-t5',
                hostKeyFingerprint: 'SHA256:t5-placeholder',
                uploadPath: '/in',
                downloadPath: '/out',
              },
            },
          },
        });
        partnerProfileId = profile.id;
      } else {
        partnerProfileId = existingProfile.id;
      }
    }, 30_000);

    afterAll(async () => {
      await seedClient.submission.deleteMany({ where: { tenantId: TENANT_ID } });
      await seedClient.submission.deleteMany({ where: { tenantId: OTHER_TENANT_ID } });
      await seedClient.$disconnect();
    });

    it('second INSERT with same (tenantId, idempotencyKey) fails with Postgres 23505 unique_violation', async () => {
      const idempotencyKey = `t5-replay-${randomUUID()}`;
      const base = {
        tenantId: TENANT_ID,
        partnerProfileId,
        idempotencyKey,
        contentType: 'application/json',
        payloadRef: 'payload-ref-1',
      };

      // First INSERT succeeds.
      const first = await seedClient.submission.create({ data: base });
      expect(first.id).toBeTruthy();

      // Second INSERT with THE SAME key is rejected. Prisma maps
      // Postgres 23505 to PrismaClientKnownRequestError with code
      // P2002 (unique constraint failed).
      try {
        await seedClient.submission.create({
          data: { ...base, payloadRef: 'payload-ref-2' },
        });
        throw new Error('expected P2002 but create succeeded');
      } catch (err) {
        expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        expect((err as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
        // Target must name both tenantId and idempotencyKey — guards
        // against a future schema change that drops tenantId from the
        // unique.
        const target = (err as Prisma.PrismaClientKnownRequestError).meta?.['target'];
        const targetStr = Array.isArray(target) ? target.join(',') : String(target);
        expect(targetStr).toContain('tenantId');
        expect(targetStr).toContain('idempotencyKey');
      }
    });

    it('different tenant using the same idempotencyKey is permitted (per-tenant scope)', async () => {
      // Need a partner profile in the other tenant too.
      const otherProfile = await seedClient.partnerProfile.create({
        data: {
          tenantId: OTHER_TENANT_ID,
          name: 'T5 Cross-Tenant Partner Profile',
          partnerType: 'BANK',
          environment: 'TEST',
          transportProtocol: 'SFTP',
          messageSecurityMode: 'SIGN_ENCRYPT',
          config: {
            sftp: {
              host: 'sftp.t5-other.example',
              port: 22,
              username: 'sep-t5-other',
              hostKeyFingerprint: 'SHA256:t5-other-placeholder',
              uploadPath: '/in',
              downloadPath: '/out',
            },
          },
        },
      });
      try {
        const sharedKey = `t5-cross-${randomUUID()}`;
        const a = await seedClient.submission.create({
          data: {
            tenantId: TENANT_ID,
            partnerProfileId,
            idempotencyKey: sharedKey,
            contentType: 'application/json',
            payloadRef: 'payload-ref-a',
          },
        });
        const b = await seedClient.submission.create({
          data: {
            tenantId: OTHER_TENANT_ID,
            partnerProfileId: otherProfile.id,
            idempotencyKey: sharedKey,
            contentType: 'application/json',
            payloadRef: 'payload-ref-b',
          },
        });
        expect(a.id).not.toBe(b.id);
        expect(a.tenantId).not.toBe(b.tenantId);
        expect(a.idempotencyKey).toBe(b.idempotencyKey);
      } finally {
        await seedClient.submission.deleteMany({ where: { partnerProfileId: otherProfile.id } });
        await seedClient.partnerProfile.delete({ where: { id: otherProfile.id } });
      }
    });
  },
);
