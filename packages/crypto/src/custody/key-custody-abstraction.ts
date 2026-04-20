/**
 * Key custody dispatcher (M3.A5-T05a).
 *
 * Single entry point that maps a `KeyReferenceInput` to the concrete
 * `IKeyCustodyBackend` that owns its material. Callers never select a
 * backend directly — they always route through this abstraction so that
 *
 *   - the backend policy (which type runs where) is centralised,
 *   - tenant-scoped backends are constructed exactly once per tenant,
 *   - unknown `backendType` values (schema drift, poisoned rows) surface
 *     as `CRYPTO_BACKEND_UNKNOWN` instead of a generic `undefined` access.
 *
 * Tenant backends are cached by tenantId because
 * `TenantVaultBackend` holds a per-tenant path prefix and
 * tenant-boundary checks. Caching keeps the cross-tenant invariant a
 * construction-time property rather than a per-call one.
 *
 * Composite ops (sign-then-encrypt): routed through
 * `dispatchComposite`. The backend contract (`signAndEncrypt`) is
 * written as a same-backend operation — private signing material and
 * the recipient public key must be in-scope on the same in-process
 * openpgp.js invocation. The dispatcher enforces that precondition by
 * resolving both refs to backend *instances* and refusing a composite
 * across different instances with `CRYPTO_BACKENDS_INCOMPATIBLE`.
 *
 * Instance identity (not just backendType) is the comparison key:
 * two `TENANT_VAULT` refs for different tenantIds legitimately resolve
 * to different `TenantVaultBackend` instances (each carries a
 * per-tenant boundary invariant) and MUST be refused here — otherwise
 * a composite op could cross the tenant boundary before the backend's
 * own check fires.
 */

import { SepError, ErrorCode } from '@sep/common';
import type {
  IKeyCustodyBackend,
  KeyReferenceInput,
  Plaintext,
  Ciphertext,
} from './i-key-custody-backend';

/**
 * Factory for a per-tenant backend. The dispatcher asks the factory
 * for a backend the first time a given tenantId is seen and caches the
 * result — tenant ids are stable, and every backend built here must
 * already carry the tenant boundary invariant.
 */
export type TenantVaultBackendFactory = (tenantId: string) => IKeyCustodyBackend;

export interface KeyCustodyAbstractionDeps {
  readonly platformVault: IKeyCustodyBackend;
  readonly tenantVaultFactory: TenantVaultBackendFactory;
  readonly externalKms: IKeyCustodyBackend;
  readonly softwareLocal: IKeyCustodyBackend;
}

export class KeyCustodyAbstraction {
  private readonly tenantBackends = new Map<string, IKeyCustodyBackend>();

  constructor(private readonly deps: KeyCustodyAbstractionDeps) {}

  /**
   * Resolve the backend for `ref`. Throws `CRYPTO_BACKEND_UNKNOWN`
   * (terminal) if `ref.backendType` is not one of the four known
   * variants — this catches schema drift and corrupted DB rows.
   */
  backendFor(ref: KeyReferenceInput): IKeyCustodyBackend {
    switch (ref.backendType) {
      case 'PLATFORM_VAULT':
        return this.deps.platformVault;
      case 'TENANT_VAULT':
        return this.resolveTenantBackend(ref);
      case 'EXTERNAL_KMS':
        return this.deps.externalKms;
      case 'SOFTWARE_LOCAL':
        return this.deps.softwareLocal;
      default:
        return this.unknownBackend(ref);
    }
  }

  /**
   * Dispatch an atomic sign-then-encrypt across two refs. Routes only
   * when both refs resolve to the *same backend instance* — different
   * instances are refused with `CRYPTO_BACKENDS_INCOMPATIBLE` even if
   * they share a backendType, because cross-instance routing would
   * bypass per-instance invariants (notably tenant boundary checks on
   * `TenantVaultBackend`).
   */
  async dispatchComposite(
    signingKeyRef: KeyReferenceInput,
    recipientKeyRef: KeyReferenceInput,
    plaintext: Plaintext,
  ): Promise<Ciphertext> {
    const signingBackend = this.backendFor(signingKeyRef);
    const recipientBackend = this.backendFor(recipientKeyRef);
    if (signingBackend !== recipientBackend) {
      throw new SepError(ErrorCode.CRYPTO_BACKENDS_INCOMPATIBLE, {
        operation: 'signAndEncrypt',
        signingKeyReferenceId: signingKeyRef.id,
        recipientKeyReferenceId: recipientKeyRef.id,
        reason:
          'Composite key-custody operations require both keys to live in the same backend instance; cross-backend composites are refused to preserve per-backend invariants (tenant boundary, key custody policy).',
      });
    }
    return signingBackend.signAndEncrypt(signingKeyRef, recipientKeyRef, plaintext);
  }

  private resolveTenantBackend(ref: KeyReferenceInput): IKeyCustodyBackend {
    if (ref.tenantId.length === 0) {
      throw new SepError(ErrorCode.TENANT_CONTEXT_INVALID, {
        keyReferenceId: ref.id,
        reason: 'TENANT_VAULT backend requires a non-empty tenantId on the key reference',
      });
    }
    const cached = this.tenantBackends.get(ref.tenantId);
    if (cached !== undefined) {
      return cached;
    }
    const created = this.deps.tenantVaultFactory(ref.tenantId);
    this.tenantBackends.set(ref.tenantId, created);
    return created;
  }

  private unknownBackend(ref: KeyReferenceInput): never {
    throw new SepError(ErrorCode.CRYPTO_BACKEND_UNKNOWN, {
      backendType: ref.backendType,
      keyReferenceId: ref.id,
      reason: 'backendType is not one of PLATFORM_VAULT, TENANT_VAULT, EXTERNAL_KMS, SOFTWARE_LOCAL',
    });
  }
}
