// M3.A1-T06: RLS negative assertions for `api_keys`.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

assertsRlsOnTable({
  tableName: 'api_keys',
  modelKey: 'apiKey',
  seedRow: (seedClient, tenantId) =>
    seedClient.apiKey.create({
      data: {
        tenantId,
        name: `seed-apikey-${tenantId}`,
        // keyHash is unique across rows — disambiguate per tenant.
        keyHash: `seed-hash-${tenantId}-${Date.now()}-${Math.random()}`,
        prefix: `sk_seed_${tenantId.slice(-4)}`,
        role: 'INTEGRATION_ENGINEER',
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    name: `insert-apikey-${tenantId}-${Date.now()}`,
    keyHash: `insert-hash-${tenantId}-${Date.now()}-${Math.random()}`,
    prefix: `sk_ins_${tenantId.slice(-4)}`,
    role: 'INTEGRATION_ENGINEER',
  }),
  validUpdatePayload: () => ({ revocationReason: 'updated-by-rls-negative' }),
  cleanup: async (seedClient) => {
    await seedClient.apiKey.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        name: { contains: 'apikey' },
      },
    });
  },
});
