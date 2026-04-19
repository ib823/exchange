/**
 * Crypto custody wiring for the control plane (M3.A5-T05a).
 *
 * Binds the four concrete `IKeyCustodyBackend` implementations behind
 * `KeyCustodyAbstraction` so every consumer (key rotation, expiry
 * scanner, future CryptoService refactor) resolves a backend the same
 * way. Exposed as `@Global()` — key custody is process-wide
 * infrastructure, not a per-feature service.
 *
 * Construction rules enforced here:
 *
 *   - `VaultClient` is built from typed config once per process.
 *   - Platform and interface-only backends are singletons.
 *   - Tenant backends are instantiated lazily by the abstraction on
 *     first use for a tenant and cached — the factory lives here so
 *     production swaps (e.g., one Vault client per tenant shard) stay
 *     DI-driven.
 */

import { Module, Global } from '@nestjs/common';
import { getConfig } from '@sep/common';
import {
  VaultClient,
  PlatformVaultBackend,
  TenantVaultBackend,
  ExternalKmsBackend,
  SoftwareLocalBackend,
  KeyCustodyAbstraction,
  DEFAULT_VAULT_CLIENT_CONFIG,
  type IKeyCustodyBackend,
  type KeyCustodyAbstractionDeps,
  type TenantVaultBackendFactory,
} from '@sep/crypto';

export const VAULT_CLIENT = Symbol('VAULT_CLIENT');
export const PLATFORM_VAULT_BACKEND = Symbol('PLATFORM_VAULT_BACKEND');
export const EXTERNAL_KMS_BACKEND = Symbol('EXTERNAL_KMS_BACKEND');
export const SOFTWARE_LOCAL_BACKEND = Symbol('SOFTWARE_LOCAL_BACKEND');
export const TENANT_VAULT_BACKEND_FACTORY = Symbol('TENANT_VAULT_BACKEND_FACTORY');

@Global()
@Module({
  providers: [
    {
      provide: VAULT_CLIENT,
      useFactory: (): VaultClient => {
        const cfg = getConfig().vault;
        return new VaultClient({
          addr: cfg.addr,
          token: cfg.token,
          namespace: cfg.namespace,
          ...DEFAULT_VAULT_CLIENT_CONFIG,
        });
      },
    },
    {
      provide: PLATFORM_VAULT_BACKEND,
      useFactory: (client: VaultClient): IKeyCustodyBackend => new PlatformVaultBackend(client),
      inject: [VAULT_CLIENT],
    },
    {
      provide: EXTERNAL_KMS_BACKEND,
      useFactory: (): IKeyCustodyBackend => new ExternalKmsBackend(),
    },
    {
      provide: SOFTWARE_LOCAL_BACKEND,
      useFactory: (): IKeyCustodyBackend => new SoftwareLocalBackend(),
    },
    {
      provide: TENANT_VAULT_BACKEND_FACTORY,
      useFactory:
        (client: VaultClient): TenantVaultBackendFactory =>
        (tenantId: string) =>
          new TenantVaultBackend(client, tenantId),
      inject: [VAULT_CLIENT],
    },
    {
      provide: KeyCustodyAbstraction,
      useFactory: (
        platform: IKeyCustodyBackend,
        tenantFactory: TenantVaultBackendFactory,
        externalKms: IKeyCustodyBackend,
        softwareLocal: IKeyCustodyBackend,
      ): KeyCustodyAbstraction => {
        const deps: KeyCustodyAbstractionDeps = {
          platformVault: platform,
          tenantVaultFactory: tenantFactory,
          externalKms,
          softwareLocal,
        };
        return new KeyCustodyAbstraction(deps);
      },
      inject: [
        PLATFORM_VAULT_BACKEND,
        TENANT_VAULT_BACKEND_FACTORY,
        EXTERNAL_KMS_BACKEND,
        SOFTWARE_LOCAL_BACKEND,
      ],
    },
  ],
  exports: [
    KeyCustodyAbstraction,
    VAULT_CLIENT,
    PLATFORM_VAULT_BACKEND,
    EXTERNAL_KMS_BACKEND,
    SOFTWARE_LOCAL_BACKEND,
    TENANT_VAULT_BACKEND_FACTORY,
  ],
})
export class CryptoCustodyModule {}
