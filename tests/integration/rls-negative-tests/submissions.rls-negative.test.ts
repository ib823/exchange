// M3.A1-T06: RLS negative assertions for `submissions`.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

const tenantPartnerProfileId: Record<string, string> = {};

assertsRlsOnTable({
  tableName: 'submissions',
  modelKey: 'submission',
  setupParents: async (seedClient) => {
    for (const tenantId of [TENANT_A_ID, TENANT_B_ID]) {
      const partner = await seedClient.partnerProfile.create({
        data: {
          tenantId,
          name: `submission-parent-${tenantId}`,
          partnerType: 'BANK',
          environment: 'TEST',
          transportProtocol: 'SFTP',
          config: {},
        },
      });
      tenantPartnerProfileId[tenantId] = partner.id;
    }
  },
  seedRow: (seedClient, tenantId) =>
    seedClient.submission.create({
      data: {
        tenantId,
        partnerProfileId: tenantPartnerProfileId[tenantId]!,
        // (tenantId, idempotencyKey) is unique — disambiguate per tenant.
        idempotencyKey: `seed-idem-${tenantId}-${Date.now()}-${Math.random()}`,
        contentType: 'application/json',
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    partnerProfileId: tenantPartnerProfileId[tenantId]!,
    idempotencyKey: `insert-idem-${tenantId}-${Date.now()}-${Math.random()}`,
    contentType: 'application/json',
  }),
  validUpdatePayload: () => ({ errorMessage: 'updated-by-rls-negative' }),
  cleanup: async (seedClient) => {
    await seedClient.submission.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        idempotencyKey: { contains: '-idem-' },
      },
    });
    await seedClient.partnerProfile.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        name: { contains: 'submission-parent' },
      },
    });
  },
});
