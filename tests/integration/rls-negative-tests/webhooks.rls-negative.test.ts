// M3.A1-T06: RLS negative assertions for `webhooks`.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

assertsRlsOnTable({
  tableName: 'webhooks',
  modelKey: 'webhook',
  seedRow: (seedClient, tenantId) =>
    seedClient.webhook.create({
      data: {
        tenantId,
        url: `https://rls-negative.test/seed/${tenantId}`,
        events: ['submission.completed'],
        secretRef: `vault://webhooks/seed-${tenantId}`,
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    url: `https://rls-negative.test/insert/${tenantId}-${Date.now()}`,
    events: ['submission.failed'],
    secretRef: `vault://webhooks/insert-${tenantId}-${Date.now()}`,
  }),
  validUpdatePayload: () => ({ active: false }),
  cleanup: async (seedClient) => {
    await seedClient.webhook.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        url: { contains: 'rls-negative.test' },
      },
    });
  },
});
