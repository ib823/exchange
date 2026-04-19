import { describe, it, expect } from 'vitest';
import { ErrorCode } from '@sep/common';
import { ExternalKmsBackend, SoftwareLocalBackend } from './stub-backends';
import type { KeyReferenceInput, Ciphertext, Signature } from './i-key-custody-backend';

const sampleRef: KeyReferenceInput = {
  id: 'key-1',
  tenantId: 'tenant-A',
  backendType: 'EXTERNAL_KMS',
  backendRef: 'arn:aws:kms:us-east-1:...',
  algorithm: 'rsa-4096',
  fingerprint: 'abc',
};

describe('ExternalKmsBackend', () => {
  const backend = new ExternalKmsBackend();

  it('getPublicKey throws CRYPTO_BACKEND_NOT_IMPLEMENTED', async () => {
    await expect(backend.getPublicKey(sampleRef)).rejects.toMatchObject({
      code: ErrorCode.CRYPTO_BACKEND_NOT_IMPLEMENTED,
      context: expect.objectContaining({ backendType: 'EXTERNAL_KMS', operation: 'getPublicKey' }),
    });
  });

  it('signDetached throws CRYPTO_BACKEND_NOT_IMPLEMENTED', async () => {
    await expect(backend.signDetached(sampleRef, Buffer.from(''))).rejects.toMatchObject({
      code: ErrorCode.CRYPTO_BACKEND_NOT_IMPLEMENTED,
    });
  });

  it('verifyDetached throws CRYPTO_BACKEND_NOT_IMPLEMENTED', async () => {
    await expect(
      backend.verifyDetached(sampleRef, Buffer.from(''), '' as Signature),
    ).rejects.toMatchObject({ code: ErrorCode.CRYPTO_BACKEND_NOT_IMPLEMENTED });
  });

  it('decrypt throws CRYPTO_BACKEND_NOT_IMPLEMENTED', async () => {
    await expect(backend.decrypt(sampleRef, '' as Ciphertext)).rejects.toMatchObject({
      code: ErrorCode.CRYPTO_BACKEND_NOT_IMPLEMENTED,
    });
  });

  it('encryptForRecipient throws CRYPTO_BACKEND_NOT_IMPLEMENTED', async () => {
    await expect(backend.encryptForRecipient(sampleRef, Buffer.from(''))).rejects.toMatchObject({
      code: ErrorCode.CRYPTO_BACKEND_NOT_IMPLEMENTED,
    });
  });

  it('rotate throws CRYPTO_BACKEND_NOT_IMPLEMENTED', async () => {
    await expect(backend.rotate(sampleRef)).rejects.toMatchObject({
      code: ErrorCode.CRYPTO_BACKEND_NOT_IMPLEMENTED,
    });
  });

  it('revoke throws CRYPTO_BACKEND_NOT_IMPLEMENTED', async () => {
    await expect(backend.revoke(sampleRef)).rejects.toMatchObject({
      code: ErrorCode.CRYPTO_BACKEND_NOT_IMPLEMENTED,
    });
  });
});

describe('SoftwareLocalBackend', () => {
  const backend = new SoftwareLocalBackend();
  const softwareRef: KeyReferenceInput = { ...sampleRef, backendType: 'SOFTWARE_LOCAL' };

  it('all 7 methods throw CRYPTO_BACKEND_NOT_AVAILABLE', async () => {
    const cases: Array<Promise<unknown>> = [
      backend.getPublicKey(softwareRef),
      backend.signDetached(softwareRef, Buffer.from('')),
      backend.verifyDetached(softwareRef, Buffer.from(''), '' as Signature),
      backend.decrypt(softwareRef, '' as Ciphertext),
      backend.encryptForRecipient(softwareRef, Buffer.from('')),
      backend.rotate(softwareRef),
      backend.revoke(softwareRef),
    ];

    for (const c of cases) {
      await expect(c).rejects.toMatchObject({
        code: ErrorCode.CRYPTO_BACKEND_NOT_AVAILABLE,
        context: expect.objectContaining({ backendType: 'SOFTWARE_LOCAL' }),
      });
    }
  });
});
