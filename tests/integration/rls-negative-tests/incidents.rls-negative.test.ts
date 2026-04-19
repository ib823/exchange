// M3.A1-T06: RLS negative assertions for `incidents`.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

assertsRlsOnTable({
  tableName: 'incidents',
  modelKey: 'incident',
  seedRow: (seedClient, tenantId) =>
    seedClient.incident.create({
      data: {
        tenantId,
        severity: 'P3',
        title: `seed-incident-${tenantId}`,
        sourceType: 'rls-negative-test',
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    severity: 'P3',
    title: `insert-incident-${tenantId}-${Date.now()}`,
    sourceType: 'rls-negative-test',
  }),
  validUpdatePayload: () => ({ description: 'updated-by-rls-negative' }),
  cleanup: async (seedClient) => {
    await seedClient.incident.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        title: { contains: 'incident' },
      },
    });
  },
});
