// M3.A1-T06: RLS negative assertions for `delivery_attempts`.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

const tenantPartnerProfileId: Record<string, string> = {};
const tenantSubmissionId: Record<string, string> = {};

assertsRlsOnTable({
  tableName: 'delivery_attempts',
  modelKey: 'deliveryAttempt',
  setupParents: async (seedClient) => {
    for (const tenantId of [TENANT_A_ID, TENANT_B_ID]) {
      const partner = await seedClient.partnerProfile.create({
        data: {
          tenantId,
          name: `delivery-parent-${tenantId}`,
          partnerType: 'BANK',
          environment: 'TEST',
          transportProtocol: 'SFTP',
          config: {},
        },
      });
      tenantPartnerProfileId[tenantId] = partner.id;
      const submission = await seedClient.submission.create({
        data: {
          tenantId,
          partnerProfileId: partner.id,
          idempotencyKey: `delivery-parent-idem-${tenantId}-${Date.now()}`,
          contentType: 'application/json',
        },
      });
      tenantSubmissionId[tenantId] = submission.id;
    }
  },
  seedRow: (seedClient, tenantId) =>
    seedClient.deliveryAttempt.create({
      data: {
        tenantId,
        submissionId: tenantSubmissionId[tenantId]!,
        attemptNo: 1,
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    submissionId: tenantSubmissionId[tenantId]!,
    attemptNo: 2,
  }),
  validUpdatePayload: () => ({ remoteReference: 'updated-by-rls-negative' }),
  cleanup: async (seedClient) => {
    await seedClient.deliveryAttempt.deleteMany({
      where: { tenantId: { in: [TENANT_A_ID, TENANT_B_ID] } },
    });
    await seedClient.submission.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        idempotencyKey: { contains: 'delivery-parent-idem' },
      },
    });
    await seedClient.partnerProfile.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        name: { contains: 'delivery-parent' },
      },
    });
  },
});
