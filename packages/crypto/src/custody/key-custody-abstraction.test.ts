/**
 * Exhaustive dispatcher tests for KeyCustodyAbstraction (M3.A5-T05a).
 *
 * Goal: lock down the mapping from backendType → backend instance.
 * Every KeyBackendType literal is exercised; the default arm is
 * exercised by casting a poisoned string into the ref.
 */

import { describe, it, expect, vi } from 'vitest';
import { SepError, ErrorCode } from '@sep/common';
import { KeyCustodyAbstraction } from './key-custody-abstraction';
import { KEY_BACKEND_TYPES, type KeyBackendType } from './key-reference-input';
import type {
  IKeyCustodyBackend,
  KeyReferenceInput,
  ArmoredKey,
} from './i-key-custody-backend';

function expectSepError(fn: () => unknown, code: ErrorCode): SepError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(SepError);
    expect((err as SepError).code).toBe(code);
    return err as SepError;
  }
  throw new Error(`expected SepError(${code}) but no error was thrown`);
}

function stubBackend(tag: string): IKeyCustodyBackend {
  return {
    getPublicKey: vi.fn().mockResolvedValue(`pub:${tag}` as ArmoredKey),
    signDetached: vi.fn(),
    verifyDetached: vi.fn(),
    decrypt: vi.fn(),
    encryptForRecipient: vi.fn(),
    rotate: vi.fn(),
    revoke: vi.fn(),
  } as unknown as IKeyCustodyBackend;
}

function makeRef(overrides: Partial<KeyReferenceInput> = {}): KeyReferenceInput {
  return {
    id: 'key-1',
    tenantId: 'tenant-a',
    backendType: 'PLATFORM_VAULT',
    backendRef: 'platform/keys/key-1',
    algorithm: 'rsa-4096',
    fingerprint: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ...overrides,
  };
}

describe('KeyCustodyAbstraction', () => {
  it('routes PLATFORM_VAULT to the platformVault backend', () => {
    const platform = stubBackend('platform');
    const abs = new KeyCustodyAbstraction({
      platformVault: platform,
      tenantVaultFactory: (): IKeyCustodyBackend => stubBackend('tenant'),
      externalKms: stubBackend('kms'),
      softwareLocal: stubBackend('local'),
    });
    expect(abs.backendFor(makeRef({ backendType: 'PLATFORM_VAULT' }))).toBe(platform);
  });

  it('routes EXTERNAL_KMS to the externalKms backend', () => {
    const kms = stubBackend('kms');
    const abs = new KeyCustodyAbstraction({
      platformVault: stubBackend('platform'),
      tenantVaultFactory: (): IKeyCustodyBackend => stubBackend('tenant'),
      externalKms: kms,
      softwareLocal: stubBackend('local'),
    });
    expect(abs.backendFor(makeRef({ backendType: 'EXTERNAL_KMS' }))).toBe(kms);
  });

  it('routes SOFTWARE_LOCAL to the softwareLocal backend', () => {
    const local = stubBackend('local');
    const abs = new KeyCustodyAbstraction({
      platformVault: stubBackend('platform'),
      tenantVaultFactory: (): IKeyCustodyBackend => stubBackend('tenant'),
      externalKms: stubBackend('kms'),
      softwareLocal: local,
    });
    expect(abs.backendFor(makeRef({ backendType: 'SOFTWARE_LOCAL' }))).toBe(local);
  });

  it('invokes the tenantVaultFactory with the ref tenantId for TENANT_VAULT', () => {
    const tenantBackend = stubBackend('tenant');
    const factory = vi.fn().mockReturnValue(tenantBackend);
    const abs = new KeyCustodyAbstraction({
      platformVault: stubBackend('platform'),
      tenantVaultFactory: factory,
      externalKms: stubBackend('kms'),
      softwareLocal: stubBackend('local'),
    });
    const result = abs.backendFor(makeRef({ backendType: 'TENANT_VAULT', tenantId: 'tenant-xyz' }));
    expect(factory).toHaveBeenCalledWith('tenant-xyz');
    expect(result).toBe(tenantBackend);
  });

  it('caches tenant backends by tenantId — same tenant returns same instance', () => {
    const factory = vi.fn().mockImplementation(() => stubBackend('tenant'));
    const abs = new KeyCustodyAbstraction({
      platformVault: stubBackend('platform'),
      tenantVaultFactory: factory,
      externalKms: stubBackend('kms'),
      softwareLocal: stubBackend('local'),
    });
    const a = abs.backendFor(makeRef({ backendType: 'TENANT_VAULT', tenantId: 't-1' }));
    const b = abs.backendFor(makeRef({ backendType: 'TENANT_VAULT', tenantId: 't-1', id: 'key-2' }));
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('creates a distinct tenant backend per tenantId', () => {
    const backendFor = new Map<string, IKeyCustodyBackend>();
    const factory = vi.fn().mockImplementation((id: string) => {
      const b = stubBackend(`tenant-${id}`);
      backendFor.set(id, b);
      return b;
    });
    const abs = new KeyCustodyAbstraction({
      platformVault: stubBackend('platform'),
      tenantVaultFactory: factory,
      externalKms: stubBackend('kms'),
      softwareLocal: stubBackend('local'),
    });
    const a = abs.backendFor(makeRef({ backendType: 'TENANT_VAULT', tenantId: 't-1' }));
    const b = abs.backendFor(makeRef({ backendType: 'TENANT_VAULT', tenantId: 't-2' }));
    expect(a).not.toBe(b);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('refuses TENANT_VAULT with an empty tenantId (fails closed with TENANT_CONTEXT_INVALID)', () => {
    const abs = new KeyCustodyAbstraction({
      platformVault: stubBackend('platform'),
      tenantVaultFactory: (): IKeyCustodyBackend => stubBackend('tenant'),
      externalKms: stubBackend('kms'),
      softwareLocal: stubBackend('local'),
    });
    expectSepError(
      () => abs.backendFor(makeRef({ backendType: 'TENANT_VAULT', tenantId: '' })),
      ErrorCode.TENANT_CONTEXT_INVALID,
    );
  });

  it('throws CRYPTO_BACKEND_UNKNOWN for a backendType outside the enum', () => {
    const abs = new KeyCustodyAbstraction({
      platformVault: stubBackend('platform'),
      tenantVaultFactory: (): IKeyCustodyBackend => stubBackend('tenant'),
      externalKms: stubBackend('kms'),
      softwareLocal: stubBackend('local'),
    });
    const poisoned = makeRef({
      backendType: 'LEGACY_HSM' as unknown as KeyBackendType,
    });
    const err = expectSepError(
      () => abs.backendFor(poisoned),
      ErrorCode.CRYPTO_BACKEND_UNKNOWN,
    );
    expect(err.context).toMatchObject({ backendType: 'LEGACY_HSM', keyReferenceId: 'key-1' });
  });

  it('covers every KeyBackendType literal (no silent missing case)', () => {
    const platform = stubBackend('platform');
    const externalKms = stubBackend('kms');
    const softwareLocal = stubBackend('local');
    const tenantBackend = stubBackend('tenant');
    const abs = new KeyCustodyAbstraction({
      platformVault: platform,
      tenantVaultFactory: (): IKeyCustodyBackend => tenantBackend,
      externalKms,
      softwareLocal,
    });
    const expected: Record<KeyBackendType, IKeyCustodyBackend> = {
      PLATFORM_VAULT: platform,
      TENANT_VAULT: tenantBackend,
      EXTERNAL_KMS: externalKms,
      SOFTWARE_LOCAL: softwareLocal,
    };
    for (const t of KEY_BACKEND_TYPES) {
      expect(abs.backendFor(makeRef({ backendType: t }))).toBe(expected[t]);
    }
  });
});
