// M3.A1-T06: RLS negative assertions for `users`.
//
// First file in the suite — also serves as the smoke test that the
// helper, env contract, and seed/teardown loop work end-to-end. Pattern
// is identical for the other 16 helper-driven tables; audit_events
// diverges and lives in its own handwritten file.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

assertsRlsOnTable({
  tableName: 'users',
  modelKey: 'user',
  seedRow: (seedClient, tenantId) =>
    seedClient.user.create({
      data: {
        tenantId,
        email: `seed-${tenantId}@rls-negative.test`,
        displayName: `Seed for ${tenantId}`,
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    email: `insert-${tenantId}-${Date.now()}@rls-negative.test`,
    displayName: 'INSERT probe',
  }),
  validUpdatePayload: () => ({ displayName: 'UPDATE probe' }),
  cleanup: async (seedClient) => {
    await seedClient.user.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        email: { contains: 'rls-negative.test' },
      },
    });
  },
});
