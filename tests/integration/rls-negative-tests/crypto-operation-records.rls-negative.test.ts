// M3.A1-T06: RLS negative assertions for `crypto_operation_records`.

import { TENANT_A_ID, TENANT_B_ID } from './_helpers/clients';
import { assertsRlsOnTable } from './_helpers/rls-assertions';

const tenantKeyReferenceId: Record<string, string> = {};

assertsRlsOnTable({
  tableName: 'crypto_operation_records',
  modelKey: 'cryptoOperationRecord',
  setupParents: async (seedClient) => {
    for (const tenantId of [TENANT_A_ID, TENANT_B_ID]) {
      const keyRef = await seedClient.keyReference.create({
        data: {
          tenantId,
          name: `crypto-parent-${tenantId}`,
          usage: ['SIGN'],
          backendType: 'PLATFORM_VAULT',
          backendRef: `vault://crypto-parent/${tenantId}`,
          fingerprint: `crypto-parent-fp-${tenantId}`,
          algorithm: 'RSA-2048',
          environment: 'TEST',
        },
      });
      tenantKeyReferenceId[tenantId] = keyRef.id;
    }
  },
  seedRow: (seedClient, tenantId) =>
    seedClient.cryptoOperationRecord.create({
      data: {
        tenantId,
        keyReferenceId: tenantKeyReferenceId[tenantId]!,
        operationType: 'SIGN',
        result: 'SUCCESS',
        algorithmPolicy: { algorithm: 'RSA-2048' },
        keyFingerprint: `seed-fp-${tenantId}`,
        performedAt: new Date(),
        actorId: 'rls-negative-test',
      },
    }),
  validInsertPayload: (tenantId) => ({
    tenantId,
    keyReferenceId: tenantKeyReferenceId[tenantId]!,
    operationType: 'SIGN',
    result: 'SUCCESS',
    algorithmPolicy: { algorithm: 'RSA-2048' },
    keyFingerprint: `insert-fp-${tenantId}-${Date.now()}`,
    performedAt: new Date(),
    actorId: 'rls-negative-test',
  }),
  validUpdatePayload: () => ({ errorCode: 'updated-by-rls-negative' }),
  // No cleanup — crypto_operation_records carries an immutability trigger
  // (crypto_operation_records_no_delete) that blocks DELETE for every role,
  // including the BYPASSRLS sep role. The KeyReference parent cannot be
  // removed either because its FK is onDelete: Restrict. Both tables
  // accumulate seed rows across local reruns; CI starts from a fresh DB so
  // accumulation is dev-only. Assertion correctness is unaffected — the 8
  // assertions target rows by primary-key id, so prior-run rows do not
  // confound them.
  cleanup: () => Promise.resolve(),
});
