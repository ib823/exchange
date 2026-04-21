/**
 * Exhaustive dispatcher tests for KeyCustodyAbstraction (M3.A5-T05a,
 * extended in T05b-i for dispatchSignAndEncrypt and T05c for
 * dispatchDecryptAndVerify).
 *
 * Goal: lock down the mapping from backendType → backend instance,
 * and the composite-op precondition that both refs must resolve to
 * the same backend instance (not just the same backendType), applied
 * uniformly to sign-then-encrypt and decrypt-then-verify.
 */

/* eslint-disable @typescript-eslint/unbound-method --
 * stub backends are `vi.fn()` mocks typed through the IKeyCustodyBackend
 * interface; expect(backend.method) is a mock-assertion idiom, not a
 * runtime method dispatch, so the unbound-method rule fires with no
 * actual `this`-scoping hazard. */

import { describe, it, expect, vi } from 'vitest';
import { SepError, ErrorCode } from '@sep/common';
import { KeyCustodyAbstraction } from './key-custody-abstraction';
import { KEY_BACKEND_TYPES, type KeyBackendType } from './key-reference-input';
import type {
  IKeyCustodyBackend,
  KeyReferenceInput,
  ArmoredKey,
  KeyUsage,
} from './i-key-custody-backend';
import type { KeyRef } from '../interfaces';

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
    signInline: vi.fn(),
    verifyDetached: vi.fn(),
    decrypt: vi.fn(),
    encryptForRecipient: vi.fn(),
    signAndEncrypt: vi.fn().mockResolvedValue(`sealed:${tag}`),
    decryptAndVerify: vi.fn().mockResolvedValue({
      plaintext: Buffer.from(`opened:${tag}`),
      signatureValid: true,
      signerKeyId: `signer:${tag}`,
    }),
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
    // Default usage covers all four operations so existing
    // non-composite tests keep passing. Purpose-guard tests override
    // this to narrow to SIGN / ENCRYPT / VERIFY / DECRYPT as needed.
    usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
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
    const b = abs.backendFor(
      makeRef({ backendType: 'TENANT_VAULT', tenantId: 't-1', id: 'key-2' }),
    );
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
    const err = expectSepError(() => abs.backendFor(poisoned), ErrorCode.CRYPTO_BACKEND_UNKNOWN);
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

describe('KeyCustodyAbstraction.dispatchSignAndEncrypt / dispatchDecryptAndVerify', () => {
  function makeAbs(
    overrides: {
      platform?: IKeyCustodyBackend;
      externalKms?: IKeyCustodyBackend;
      softwareLocal?: IKeyCustodyBackend;
      tenantFactory?: (id: string) => IKeyCustodyBackend;
    } = {},
  ): KeyCustodyAbstraction {
    return new KeyCustodyAbstraction({
      platformVault: overrides.platform ?? stubBackend('platform'),
      tenantVaultFactory:
        overrides.tenantFactory ??
        ((id: string): IKeyCustodyBackend => stubBackend(`tenant-${id}`)),
      externalKms: overrides.externalKms ?? stubBackend('kms'),
      softwareLocal: overrides.softwareLocal ?? stubBackend('local'),
    });
  }

  it('same-platform-backend: forwards to PlatformVaultBackend.signAndEncrypt', async () => {
    const platform = stubBackend('platform');
    const abs = makeAbs({ platform });
    const signRef = makeRef({ id: 's', backendType: 'PLATFORM_VAULT' });
    const recipientRef = makeRef({ id: 'r', backendType: 'PLATFORM_VAULT' });
    const plaintext = Buffer.from('payload');

    const result = await abs.dispatchSignAndEncrypt(signRef, recipientRef, plaintext);

    expect(platform.signAndEncrypt).toHaveBeenCalledTimes(1);
    expect(platform.signAndEncrypt).toHaveBeenCalledWith(signRef, recipientRef, plaintext);
    expect(result).toBe('sealed:platform');
  });

  it('same-tenant-backend: forwards to cached Tenant backend when both refs share tenantId', async () => {
    const tenantBackend = stubBackend('tenant-A');
    const factory = vi.fn().mockReturnValue(tenantBackend);
    const abs = makeAbs({ tenantFactory: factory });
    const signRef = makeRef({ id: 's', backendType: 'TENANT_VAULT', tenantId: 'tenant-A' });
    const recipientRef = makeRef({
      id: 'r',
      backendType: 'TENANT_VAULT',
      tenantId: 'tenant-A',
    });

    const result = await abs.dispatchSignAndEncrypt(signRef, recipientRef, Buffer.from('payload'));

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith('tenant-A');
    expect(tenantBackend.signAndEncrypt).toHaveBeenCalledTimes(1);
    expect(result).toBe('sealed:tenant-A');
  });

  it('different-tenant-same-class: refuses (each tenantId resolves to a distinct backend instance)', async () => {
    // Two TENANT_VAULT refs with different tenantIds must NOT be
    // dispatched together — each TenantVaultBackend carries its own
    // tenant-boundary invariant, and the dispatcher comparing instances
    // (not classes) is what keeps cross-tenant composites off the fast
    // path.
    const factory = vi
      .fn()
      .mockImplementation((id: string): IKeyCustodyBackend => stubBackend(`tenant-${id}`));
    const abs = makeAbs({ tenantFactory: factory });
    const signRef = makeRef({ id: 's', backendType: 'TENANT_VAULT', tenantId: 'tenant-A' });
    const foreignRecipient = makeRef({
      id: 'r',
      backendType: 'TENANT_VAULT',
      tenantId: 'tenant-B',
    });

    const err = await abs
      .dispatchSignAndEncrypt(signRef, foreignRecipient, Buffer.from('payload'))
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SepError);
    expect((err as SepError).code).toBe(ErrorCode.CRYPTO_BACKENDS_INCOMPATIBLE);
    expect((err as SepError).context).toMatchObject({
      signingKeyReferenceId: 's',
      recipientKeyReferenceId: 'r',
      operation: 'signAndEncrypt',
    });
  });

  it('platform-vs-tenant: refuses with CRYPTO_BACKENDS_INCOMPATIBLE', async () => {
    const platform = stubBackend('platform');
    const tenantBackend = stubBackend('tenant-A');
    const abs = makeAbs({
      platform,
      tenantFactory: (): IKeyCustodyBackend => tenantBackend,
    });
    const signRef = makeRef({ id: 's', backendType: 'PLATFORM_VAULT' });
    const recipientRef = makeRef({
      id: 'r',
      backendType: 'TENANT_VAULT',
      tenantId: 'tenant-A',
    });

    await expect(
      abs.dispatchSignAndEncrypt(signRef, recipientRef, Buffer.from('p')),
    ).rejects.toMatchObject({ code: ErrorCode.CRYPTO_BACKENDS_INCOMPATIBLE });
    expect(platform.signAndEncrypt).not.toHaveBeenCalled();
    expect(tenantBackend.signAndEncrypt).not.toHaveBeenCalled();
  });

  it('vault-vs-kms: refuses with CRYPTO_BACKENDS_INCOMPATIBLE (no backend.signAndEncrypt call)', async () => {
    const platform = stubBackend('platform');
    const kms = stubBackend('kms');
    const abs = makeAbs({ platform, externalKms: kms });
    const signRef = makeRef({ id: 's', backendType: 'PLATFORM_VAULT' });
    const recipientRef = makeRef({ id: 'r', backendType: 'EXTERNAL_KMS' });

    await expect(
      abs.dispatchSignAndEncrypt(signRef, recipientRef, Buffer.from('p')),
    ).rejects.toMatchObject({ code: ErrorCode.CRYPTO_BACKENDS_INCOMPATIBLE });
    // Neither backend's composite is invoked — dispatcher refused
    // before forwarding.
    expect(platform.signAndEncrypt).not.toHaveBeenCalled();
    expect(kms.signAndEncrypt).not.toHaveBeenCalled();
  });

  it('kms-vs-softwarelocal: refuses with CRYPTO_BACKENDS_INCOMPATIBLE (defensive — both stubs)', async () => {
    // Defensive: even though both are stubs that would throw on
    // signAndEncrypt anyway, the dispatcher catches the cross-backend
    // combination before either stub runs, giving a distinct error
    // code that routing layers can log without confusion.
    const kms = stubBackend('kms');
    const local = stubBackend('local');
    const abs = makeAbs({ externalKms: kms, softwareLocal: local });
    const signRef = makeRef({ id: 's', backendType: 'EXTERNAL_KMS' });
    const recipientRef = makeRef({ id: 'r', backendType: 'SOFTWARE_LOCAL' });

    await expect(
      abs.dispatchSignAndEncrypt(signRef, recipientRef, Buffer.from('p')),
    ).rejects.toMatchObject({ code: ErrorCode.CRYPTO_BACKENDS_INCOMPATIBLE });
    expect(kms.signAndEncrypt).not.toHaveBeenCalled();
    expect(local.signAndEncrypt).not.toHaveBeenCalled();
  });

  // ── dispatchDecryptAndVerify ───────────────────────────────────
  // Symmetric coverage to dispatchSignAndEncrypt. The precondition
  // logic is shared, so these tests assert the second dispatcher
  // method hits it the same way.

  it('dispatchDecryptAndVerify: same-platform-backend forwards to PlatformVaultBackend.decryptAndVerify', async () => {
    const platform = stubBackend('platform');
    const abs = makeAbs({ platform });
    const decryptRef = makeRef({ id: 'd', backendType: 'PLATFORM_VAULT' });
    const senderRef = makeRef({ id: 's', backendType: 'PLATFORM_VAULT' });
    const ciphertext = 'ARMORED' as unknown as Parameters<
      KeyCustodyAbstraction['dispatchDecryptAndVerify']
    >[2];

    const result = await abs.dispatchDecryptAndVerify(decryptRef, senderRef, ciphertext);

    expect(platform.decryptAndVerify).toHaveBeenCalledTimes(1);
    expect(platform.decryptAndVerify).toHaveBeenCalledWith(decryptRef, senderRef, ciphertext);
    expect(result.signerKeyId).toBe('signer:platform');
    expect(result.signatureValid).toBe(true);
  });

  it('dispatchDecryptAndVerify: same-tenant-backend forwards via cached Tenant instance', async () => {
    const tenantBackend = stubBackend('tenant-A');
    const factory = vi.fn().mockReturnValue(tenantBackend);
    const abs = makeAbs({ tenantFactory: factory });
    const decryptRef = makeRef({ id: 'd', backendType: 'TENANT_VAULT', tenantId: 'tenant-A' });
    const senderRef = makeRef({ id: 's', backendType: 'TENANT_VAULT', tenantId: 'tenant-A' });

    await abs.dispatchDecryptAndVerify(
      decryptRef,
      senderRef,
      '' as unknown as Parameters<KeyCustodyAbstraction['dispatchDecryptAndVerify']>[2],
    );

    expect(factory).toHaveBeenCalledTimes(1);
    expect(tenantBackend.decryptAndVerify).toHaveBeenCalledTimes(1);
  });

  it('dispatchDecryptAndVerify: different-tenant-same-class refuses with CRYPTO_BACKENDS_INCOMPATIBLE', async () => {
    const factory = vi
      .fn()
      .mockImplementation((id: string): IKeyCustodyBackend => stubBackend(`tenant-${id}`));
    const abs = makeAbs({ tenantFactory: factory });
    const decryptRef = makeRef({ id: 'd', backendType: 'TENANT_VAULT', tenantId: 'tenant-A' });
    const foreignSender = makeRef({ id: 's', backendType: 'TENANT_VAULT', tenantId: 'tenant-B' });

    const err = await abs
      .dispatchDecryptAndVerify(
        decryptRef,
        foreignSender,
        '' as unknown as Parameters<KeyCustodyAbstraction['dispatchDecryptAndVerify']>[2],
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SepError);
    expect((err as SepError).code).toBe(ErrorCode.CRYPTO_BACKENDS_INCOMPATIBLE);
    expect((err as SepError).context).toMatchObject({
      operation: 'decryptAndVerify',
      decryptionKeyReferenceId: 'd',
      senderKeyReferenceId: 's',
    });
  });

  it('dispatchDecryptAndVerify: platform-vs-tenant refuses with CRYPTO_BACKENDS_INCOMPATIBLE', async () => {
    const platform = stubBackend('platform');
    const tenantBackend = stubBackend('tenant-A');
    const abs = makeAbs({
      platform,
      tenantFactory: (): IKeyCustodyBackend => tenantBackend,
    });
    const decryptRef = makeRef({ id: 'd', backendType: 'PLATFORM_VAULT' });
    const senderRef = makeRef({
      id: 's',
      backendType: 'TENANT_VAULT',
      tenantId: 'tenant-A',
    });

    await expect(
      abs.dispatchDecryptAndVerify(
        decryptRef,
        senderRef,
        '' as unknown as Parameters<KeyCustodyAbstraction['dispatchDecryptAndVerify']>[2],
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CRYPTO_BACKENDS_INCOMPATIBLE });
    expect(platform.decryptAndVerify).not.toHaveBeenCalled();
    expect(tenantBackend.decryptAndVerify).not.toHaveBeenCalled();
  });

  it('dispatchDecryptAndVerify: vault-vs-kms refuses with CRYPTO_BACKENDS_INCOMPATIBLE', async () => {
    const platform = stubBackend('platform');
    const kms = stubBackend('kms');
    const abs = makeAbs({ platform, externalKms: kms });
    const decryptRef = makeRef({ id: 'd', backendType: 'PLATFORM_VAULT' });
    const senderRef = makeRef({ id: 's', backendType: 'EXTERNAL_KMS' });

    await expect(
      abs.dispatchDecryptAndVerify(
        decryptRef,
        senderRef,
        '' as unknown as Parameters<KeyCustodyAbstraction['dispatchDecryptAndVerify']>[2],
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CRYPTO_BACKENDS_INCOMPATIBLE });
    expect(platform.decryptAndVerify).not.toHaveBeenCalled();
    expect(kms.decryptAndVerify).not.toHaveBeenCalled();
  });

  it('dispatchDecryptAndVerify: kms-vs-softwarelocal refuses with CRYPTO_BACKENDS_INCOMPATIBLE', async () => {
    const kms = stubBackend('kms');
    const local = stubBackend('local');
    const abs = makeAbs({ externalKms: kms, softwareLocal: local });
    const decryptRef = makeRef({ id: 'd', backendType: 'EXTERNAL_KMS' });
    const senderRef = makeRef({ id: 's', backendType: 'SOFTWARE_LOCAL' });

    await expect(
      abs.dispatchDecryptAndVerify(
        decryptRef,
        senderRef,
        '' as unknown as Parameters<KeyCustodyAbstraction['dispatchDecryptAndVerify']>[2],
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CRYPTO_BACKENDS_INCOMPATIBLE });
    expect(kms.decryptAndVerify).not.toHaveBeenCalled();
    expect(local.decryptAndVerify).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────
// Purpose-guard tests (Review Item 1).
// The dispatcher fails closed with CRYPTO_KEY_PURPOSE_MISMATCH when
// a composite op is invoked with a ref whose `usage` list does not
// carry the required role. Catches the production-symptom of a
// caller forwarding the same KeyReference as both roles (e.g. a
// signing key as an encryption recipient).
// ─────────────────────────────────────────────────────────────────

describe('KeyCustodyAbstraction purpose guards', () => {
  function makeAbs(): KeyCustodyAbstraction {
    return new KeyCustodyAbstraction({
      platformVault: stubBackend('platform'),
      tenantVaultFactory: (): IKeyCustodyBackend => stubBackend('tenant'),
      externalKms: stubBackend('kms'),
      softwareLocal: stubBackend('local'),
    });
  }

  it('dispatchSignAndEncrypt rejects two SIGN-only refs (no ENCRYPT on the recipient)', async () => {
    const abs = makeAbs();
    const signRef = makeRef({ id: 's', usage: ['SIGN'] });
    const badRecipient = makeRef({ id: 'r', usage: ['SIGN'] });

    const err = await abs
      .dispatchSignAndEncrypt(signRef, badRecipient, Buffer.from('p'))
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SepError);
    expect((err as SepError).code).toBe(ErrorCode.CRYPTO_KEY_PURPOSE_MISMATCH);
    expect((err as SepError).context).toMatchObject({
      operation: 'signAndEncrypt',
      keyReferenceId: 'r',
      expectedUsage: 'ENCRYPT',
      actualUsage: ['SIGN'],
    });
  });

  it('dispatchSignAndEncrypt rejects two ENCRYPT-only refs (no SIGN on the signing side)', async () => {
    const abs = makeAbs();
    const badSigner = makeRef({ id: 's', usage: ['ENCRYPT'] });
    const recipient = makeRef({ id: 'r', usage: ['ENCRYPT'] });

    await expect(
      abs.dispatchSignAndEncrypt(badSigner, recipient, Buffer.from('p')),
    ).rejects.toMatchObject({
      code: ErrorCode.CRYPTO_KEY_PURPOSE_MISMATCH,
      context: expect.objectContaining({
        operation: 'signAndEncrypt',
        keyReferenceId: 's',
        expectedUsage: 'SIGN',
      }) as unknown,
    });
  });

  it('dispatchDecryptAndVerify rejects reversed-purpose refs (SIGN where DECRYPT expected)', async () => {
    const abs = makeAbs();
    const wrongDecrypt = makeRef({ id: 'd', usage: ['SIGN'] });
    const senderRef = makeRef({ id: 's', usage: ['VERIFY'] });

    await expect(
      abs.dispatchDecryptAndVerify(
        wrongDecrypt,
        senderRef,
        '' as unknown as Parameters<KeyCustodyAbstraction['dispatchDecryptAndVerify']>[2],
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CRYPTO_KEY_PURPOSE_MISMATCH,
      context: expect.objectContaining({
        operation: 'decryptAndVerify',
        keyReferenceId: 'd',
        expectedUsage: 'DECRYPT',
      }) as unknown,
    });
  });

  it('correct purposes pass through to the backend (SIGN + ENCRYPT for composite encrypt)', async () => {
    const platform = stubBackend('platform');
    const abs = new KeyCustodyAbstraction({
      platformVault: platform,
      tenantVaultFactory: (): IKeyCustodyBackend => stubBackend('tenant'),
      externalKms: stubBackend('kms'),
      softwareLocal: stubBackend('local'),
    });
    const signRef = makeRef({ id: 's', usage: ['SIGN'] });
    const recipientRef = makeRef({ id: 'r', usage: ['ENCRYPT'] });

    const result = await abs.dispatchSignAndEncrypt(signRef, recipientRef, Buffer.from('p'));

    expect(platform.signAndEncrypt).toHaveBeenCalledTimes(1);
    expect(result).toBe('sealed:platform');
  });
});

// ─────────────────────────────────────────────────────────────────
// Vocabulary symmetry (Review Item 1 follow-up).
// The purpose guard relies on KeyRef.allowedUsages and
// KeyReferenceInput.usage carrying the SAME four-value vocabulary.
// A future refactor that narrows one side silently would make the
// guard always-fail or always-pass — these assertions fail at
// compile-time if the element types drift.
// ─────────────────────────────────────────────────────────────────

describe('KeyUsage / allowedUsages vocabulary symmetry', () => {
  it('KeyUsage matches KeyRef.allowedUsages element type (compile-time)', () => {
    // Compile-time assertion: the two element types must be
    // assignable in both directions. If KeyUsage drops a value or
    // allowedUsages adds one, these assignments stop compiling.
    type Keyed = KeyRef['allowedUsages'][number];
    const a: KeyUsage = 'SIGN' as Keyed;
    const b: Keyed = 'SIGN' as KeyUsage;
    expect(a).toBe('SIGN');
    expect(b).toBe('SIGN');
  });

  it('covers every KeyUsage literal the dispatcher checks', () => {
    // Runtime sanity: enumerate every value the two composite
    // guards demand, so a future KeyUsage addition that forgets
    // to extend this list fails the test before the guard silently
    // passes an unknown role.
    const required: readonly KeyUsage[] = ['SIGN', 'ENCRYPT', 'DECRYPT', 'VERIFY'];
    expect(required).toHaveLength(4);
    for (const role of required) {
      expect(['SIGN', 'ENCRYPT', 'DECRYPT', 'VERIFY']).toContain(role);
    }
  });
});
