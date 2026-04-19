// M3.A1-T06: RLS negative assertions for `retention_policies`.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

assertsRlsOnTable({
  tableName: 'retention_policies',
  modelKey: 'retentionPolicy',
  seedRow: (seedClient, tenantId) =>
    seedClient.retentionPolicy.create({
      data: {
        tenantId,
        name: `seed-policy-${tenantId}`,
        description: 'rls-negative seed',
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    name: `insert-policy-${tenantId}-${Date.now()}`,
  }),
  validUpdatePayload: () => ({ description: 'updated-by-rls-negative' }),
  cleanup: async (seedClient) => {
    await seedClient.retentionPolicy.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        name: { contains: 'policy' },
      },
    });
  },
});
