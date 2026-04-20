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

  it('signInline throws CRYPTO_BACKEND_NOT_IMPLEMENTED', async () => {
    await expect(backend.signInline(sampleRef, Buffer.from(''))).rejects.toMatchObject({
      code: ErrorCode.CRYPTO_BACKEND_NOT_IMPLEMENTED,
      context: expect.objectContaining({ operation: 'signInline' }),
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

  it('signAndEncrypt throws CRYPTO_OPERATION_NOT_SUPPORTED (distinct from NOT_IMPLEMENTED)', async () => {
    const recipientRef: KeyReferenceInput = { ...sampleRef, id: 'key-2' };
    await expect(
      backend.signAndEncrypt(sampleRef, recipientRef, Buffer.from('')),
    ).rejects.toMatchObject({
      code: ErrorCode.CRYPTO_OPERATION_NOT_SUPPORTED,
      context: expect.objectContaining({
        backendType: 'EXTERNAL_KMS',
        operation: 'signAndEncrypt',
        signingKeyReferenceId: 'key-1',
        recipientKeyReferenceId: 'key-2',
      }),
    });
  });

  it('decryptAndVerify throws CRYPTO_OPERATION_NOT_SUPPORTED (symmetric with signAndEncrypt, role-specific context keys)', async () => {
    const senderRef: KeyReferenceInput = { ...sampleRef, id: 'key-2' };
    await expect(
      backend.decryptAndVerify(sampleRef, senderRef, '' as Ciphertext),
    ).rejects.toMatchObject({
      code: ErrorCode.CRYPTO_OPERATION_NOT_SUPPORTED,
      context: expect.objectContaining({
        backendType: 'EXTERNAL_KMS',
        operation: 'decryptAndVerify',
        decryptionKeyReferenceId: 'key-1',
        senderKeyReferenceId: 'key-2',
      }),
    });
  });
});

describe('SoftwareLocalBackend', () => {
  const backend = new SoftwareLocalBackend();
  const softwareRef: KeyReferenceInput = { ...sampleRef, backendType: 'SOFTWARE_LOCAL' };

  it('all 8 single-ref methods throw CRYPTO_BACKEND_NOT_AVAILABLE', async () => {
    const cases: Array<Promise<unknown>> = [
      backend.getPublicKey(softwareRef),
      backend.signDetached(softwareRef, Buffer.from('')),
      backend.signInline(softwareRef, Buffer.from('')),
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

  it('signAndEncrypt throws CRYPTO_OPERATION_NOT_SUPPORTED (distinct from NOT_AVAILABLE)', async () => {
    const recipientRef: KeyReferenceInput = { ...softwareRef, id: 'key-2' };
    await expect(
      backend.signAndEncrypt(softwareRef, recipientRef, Buffer.from('')),
    ).rejects.toMatchObject({
      code: ErrorCode.CRYPTO_OPERATION_NOT_SUPPORTED,
      context: expect.objectContaining({
        backendType: 'SOFTWARE_LOCAL',
        operation: 'signAndEncrypt',
        signingKeyReferenceId: 'key-1',
        recipientKeyReferenceId: 'key-2',
      }),
    });
  });

  it('decryptAndVerify throws CRYPTO_OPERATION_NOT_SUPPORTED (symmetric, role-specific context keys)', async () => {
    const senderRef: KeyReferenceInput = { ...softwareRef, id: 'key-2' };
    await expect(
      backend.decryptAndVerify(softwareRef, senderRef, '' as Ciphertext),
    ).rejects.toMatchObject({
      code: ErrorCode.CRYPTO_OPERATION_NOT_SUPPORTED,
      context: expect.objectContaining({
        backendType: 'SOFTWARE_LOCAL',
        operation: 'decryptAndVerify',
        decryptionKeyReferenceId: 'key-1',
        senderKeyReferenceId: 'key-2',
      }),
    });
  });
});
