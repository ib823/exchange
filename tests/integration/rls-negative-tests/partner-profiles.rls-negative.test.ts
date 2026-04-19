// M3.A1-T06: RLS negative assertions for `partner_profiles`.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

assertsRlsOnTable({
  tableName: 'partner_profiles',
  modelKey: 'partnerProfile',
  seedRow: (seedClient, tenantId) =>
    seedClient.partnerProfile.create({
      data: {
        tenantId,
        name: `seed-profile-${tenantId}`,
        partnerType: 'BANK',
        environment: 'TEST',
        transportProtocol: 'SFTP',
        config: {},
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    name: `insert-profile-${tenantId}-${Date.now()}`,
    partnerType: 'BANK',
    environment: 'TEST',
    transportProtocol: 'SFTP',
    config: {},
  }),
  validUpdatePayload: () => ({ notes: 'updated-by-rls-negative' }),
  cleanup: async (seedClient) => {
    await seedClient.partnerProfile.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        name: { contains: 'profile' },
      },
    });
  },
});
