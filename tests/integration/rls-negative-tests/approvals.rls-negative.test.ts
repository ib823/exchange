// M3.A1-T06: RLS negative assertions for `approvals`.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

const tenantInitiatorId: Record<string, string> = {};

assertsRlsOnTable({
  tableName: 'approvals',
  modelKey: 'approval',
  setupParents: async (seedClient) => {
    for (const tenantId of [TENANT_A_ID, TENANT_B_ID]) {
      const user = await seedClient.user.create({
        data: {
          tenantId,
          email: `approval-initiator-${tenantId}@rls-negative.test`,
          displayName: `Approval initiator for ${tenantId}`,
        },
      });
      tenantInitiatorId[tenantId] = user.id;
    }
  },
  seedRow: (seedClient, tenantId) =>
    seedClient.approval.create({
      data: {
        tenantId,
        action: 'PARTNER_PROFILE_ACTIVATE',
        objectType: 'PartnerProfile',
        objectId: `seed-target-${tenantId}`,
        initiatorId: tenantInitiatorId[tenantId]!,
        // 7 days from now — well outside the assertion window.
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    action: 'KEY_ACTIVATE',
    objectType: 'KeyReference',
    objectId: `insert-target-${tenantId}-${Date.now()}`,
    initiatorId: tenantInitiatorId[tenantId]!,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }),
  validUpdatePayload: () => ({ notes: 'updated-by-rls-negative' }),
  cleanup: async (seedClient) => {
    await seedClient.approval.deleteMany({
      where: { tenantId: { in: [TENANT_A_ID, TENANT_B_ID] } },
    });
    await seedClient.user.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        email: { contains: 'approval-initiator' },
      },
    });
  },
});
