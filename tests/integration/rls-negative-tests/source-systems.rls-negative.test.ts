// M3.A1-T06: RLS negative assertions for `source_systems`.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

assertsRlsOnTable({
  tableName: 'source_systems',
  modelKey: 'sourceSystem',
  seedRow: (seedClient, tenantId) =>
    seedClient.sourceSystem.create({
      data: {
        tenantId,
        name: `seed-source-${tenantId}`,
        description: 'rls-negative seed',
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    name: `insert-source-${tenantId}-${Date.now()}`,
  }),
  validUpdatePayload: () => ({ description: 'updated-by-rls-negative' }),
  cleanup: async (seedClient) => {
    await seedClient.sourceSystem.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        name: { contains: 'source' },
      },
    });
  },
});
