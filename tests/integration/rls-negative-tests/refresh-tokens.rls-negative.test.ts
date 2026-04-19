// M3.A1-T06: RLS negative assertions for `refresh_tokens`.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

const tenantUserId: Record<string, string> = {};

assertsRlsOnTable({
  tableName: 'refresh_tokens',
  modelKey: 'refreshToken',
  setupParents: async (seedClient) => {
    for (const tenantId of [TENANT_A_ID, TENANT_B_ID]) {
      const user = await seedClient.user.create({
        data: {
          tenantId,
          email: `refresh-token-parent-${tenantId}@rls-negative.test`,
          displayName: `Refresh-token parent for ${tenantId}`,
        },
      });
      tenantUserId[tenantId] = user.id;
    }
  },
  seedRow: (seedClient, tenantId) =>
    seedClient.refreshToken.create({
      data: {
        tenantId,
        userId: tenantUserId[tenantId]!,
        // tokenHash is unique — disambiguate per tenant + entropy.
        tokenHash: `seed-token-${tenantId}-${Date.now()}-${Math.random()}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    userId: tenantUserId[tenantId]!,
    tokenHash: `insert-token-${tenantId}-${Date.now()}-${Math.random()}`,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }),
  validUpdatePayload: () => ({ revocationReason: 'updated-by-rls-negative' }),
  cleanup: async (seedClient) => {
    await seedClient.refreshToken.deleteMany({
      where: { tenantId: { in: [TENANT_A_ID, TENANT_B_ID] } },
    });
    await seedClient.user.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        email: { contains: 'refresh-token-parent' },
      },
    });
  },
});
