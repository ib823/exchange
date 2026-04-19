// M3.A1-T06: RLS negative assertions for `exchange_profiles`.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

// Per-tenant parent partner_profile id, captured in setupParents.
const tenantPartnerProfileId: Record<string, string> = {};

assertsRlsOnTable({
  tableName: 'exchange_profiles',
  modelKey: 'exchangeProfile',
  setupParents: async (seedClient) => {
    for (const tenantId of [TENANT_A_ID, TENANT_B_ID]) {
      const partner = await seedClient.partnerProfile.create({
        data: {
          tenantId,
          name: `xprofile-parent-${tenantId}`,
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
    seedClient.exchangeProfile.create({
      data: {
        tenantId,
        name: `seed-xprofile-${tenantId}`,
        partnerProfileId: tenantPartnerProfileId[tenantId]!,
        fileTypes: ['CSV'],
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    name: `insert-xprofile-${tenantId}-${Date.now()}`,
    partnerProfileId: tenantPartnerProfileId[tenantId]!,
    fileTypes: ['CSV'],
  }),
  validUpdatePayload: () => ({ description: 'updated-by-rls-negative' }),
  cleanup: async (seedClient) => {
    await seedClient.exchangeProfile.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        name: { contains: 'xprofile' },
      },
    });
    await seedClient.partnerProfile.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        name: { contains: 'xprofile-parent' },
      },
    });
  },
});
