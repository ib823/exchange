// M3.A1-T06: RLS negative assertions for `role_assignments`.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

// Parent user ids per tenant — needed for the FK userId column. Captured
// in setupParents and reused by seedRow + validInsertPayload.
const tenantUserId: Record<string, string> = {};

assertsRlsOnTable({
  tableName: 'role_assignments',
  modelKey: 'roleAssignment',
  setupParents: async (seedClient) => {
    for (const tenantId of [TENANT_A_ID, TENANT_B_ID]) {
      const user = await seedClient.user.create({
        data: {
          tenantId,
          email: `roleassign-parent-${tenantId}@rls-negative.test`,
          displayName: `Role-assign parent for ${tenantId}`,
        },
      });
      tenantUserId[tenantId] = user.id;
    }
  },
  seedRow: (seedClient, tenantId) =>
    seedClient.roleAssignment.create({
      data: {
        tenantId,
        userId: tenantUserId[tenantId]!,
        role: 'OPERATIONS_ANALYST',
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    userId: tenantUserId[tenantId]!,
    // Different role from the seeded one — avoids tripping the (tenantId,
    // userId, role) unique constraint while still being a valid INSERT.
    role: 'INTEGRATION_ENGINEER',
  }),
  validUpdatePayload: () => ({ scope: 'updated-by-rls-negative' }),
  cleanup: async (seedClient) => {
    await seedClient.roleAssignment.deleteMany({
      where: { tenantId: { in: [TENANT_A_ID, TENANT_B_ID] } },
    });
    await seedClient.user.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        email: { contains: 'roleassign-parent' },
      },
    });
  },
});
