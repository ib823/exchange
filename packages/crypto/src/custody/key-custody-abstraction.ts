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
 * C6b will extend this with a `dispatchComposite(sign, recipient, ...)`
 * helper that enforces the same-backend precondition for
 * `signAndEncrypt`; for now the dispatcher only handles single-ref
 * operations.
 */

import { SepError, ErrorCode } from '@sep/common';
import type { IKeyCustodyBackend, KeyReferenceInput } from './i-key-custody-backend';

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
