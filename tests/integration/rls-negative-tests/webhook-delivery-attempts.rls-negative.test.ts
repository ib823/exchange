// M3.A1-T06: RLS negative assertions for `webhook_delivery_attempts`.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

const tenantWebhookId: Record<string, string> = {};

assertsRlsOnTable({
  tableName: 'webhook_delivery_attempts',
  modelKey: 'webhookDeliveryAttempt',
  setupParents: async (seedClient) => {
    for (const tenantId of [TENANT_A_ID, TENANT_B_ID]) {
      const webhook = await seedClient.webhook.create({
        data: {
          tenantId,
          url: `https://rls-negative.test/wda-parent/${tenantId}`,
          events: ['submission.completed'],
          secretRef: `vault://webhooks/wda-parent-${tenantId}`,
        },
      });
      tenantWebhookId[tenantId] = webhook.id;
    }
  },
  seedRow: (seedClient, tenantId) =>
    seedClient.webhookDeliveryAttempt.create({
      data: {
        tenantId,
        webhookId: tenantWebhookId[tenantId]!,
        eventType: 'submission.completed',
        success: true,
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    webhookId: tenantWebhookId[tenantId]!,
    eventType: 'submission.failed',
    success: false,
  }),
  validUpdatePayload: () => ({ errorMessage: 'updated-by-rls-negative' }),
  cleanup: async (seedClient) => {
    await seedClient.webhookDeliveryAttempt.deleteMany({
      where: { tenantId: { in: [TENANT_A_ID, TENANT_B_ID] } },
    });
    await seedClient.webhook.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        url: { contains: 'wda-parent' },
      },
    });
  },
});
