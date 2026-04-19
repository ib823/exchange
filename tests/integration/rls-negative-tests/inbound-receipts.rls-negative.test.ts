// M3.A1-T06: RLS negative assertions for `inbound_receipts`.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

const tenantPartnerProfileId: Record<string, string> = {};

assertsRlsOnTable({
  tableName: 'inbound_receipts',
  modelKey: 'inboundReceipt',
  setupParents: async (seedClient) => {
    for (const tenantId of [TENANT_A_ID, TENANT_B_ID]) {
      const partner = await seedClient.partnerProfile.create({
        data: {
          tenantId,
          name: `inbound-parent-${tenantId}`,
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
    seedClient.inboundReceipt.create({
      data: {
        tenantId,
        partnerProfileId: tenantPartnerProfileId[tenantId]!,
        correlationId: `seed-corr-${tenantId}-${Date.now()}`,
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    partnerProfileId: tenantPartnerProfileId[tenantId]!,
    correlationId: `insert-corr-${tenantId}-${Date.now()}`,
  }),
  validUpdatePayload: () => ({ parsedStatus: 'updated-by-rls-negative' }),
  cleanup: async (seedClient) => {
    await seedClient.inboundReceipt.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        correlationId: { contains: '-corr-' },
      },
    });
    await seedClient.partnerProfile.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        name: { contains: 'inbound-parent' },
      },
    });
  },
});
