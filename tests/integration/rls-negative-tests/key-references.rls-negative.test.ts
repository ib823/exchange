// M3.A1-T06: RLS negative assertions for `key_references`.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

assertsRlsOnTable({
  tableName: 'key_references',
  modelKey: 'keyReference',
  seedRow: (seedClient, tenantId) =>
    seedClient.keyReference.create({
      data: {
        tenantId,
        name: `seed-key-${tenantId}`,
        usage: ['SIGN'],
        backendType: 'PLATFORM_VAULT',
        backendRef: `vault://rls-neg/seed-${tenantId}`,
        fingerprint: `seed-fingerprint-${tenantId}`,
        algorithm: 'RSA-2048',
        environment: 'TEST',
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    name: `insert-key-${tenantId}-${Date.now()}`,
    usage: ['SIGN'],
    backendType: 'PLATFORM_VAULT',
    backendRef: `vault://rls-neg/insert-${tenantId}-${Date.now()}`,
    fingerprint: `insert-fingerprint-${tenantId}-${Date.now()}`,
    algorithm: 'RSA-2048',
    environment: 'TEST',
  }),
  validUpdatePayload: () => ({ algorithm: 'RSA-4096' }),
  cleanup: async (seedClient) => {
    await seedClient.keyReference.deleteMany({
      where: {
        tenantId: { in: [TENANT_A_ID, TENANT_B_ID] },
        name: { contains: 'key' },
      },
    });
  },
});
