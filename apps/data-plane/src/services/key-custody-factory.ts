/**
 * Build a KeyCustodyAbstraction from typed config.
 *
 * Data-plane processors instantiate KeyCustodyAbstraction directly
 * rather than receiving it via a NestJS module because BullMQ workers
 * are constructed outside the @Module DI tree. Control-plane wires the
 * same four backends via CryptoCustodyModule — this helper keeps the
 * two call sites in lock-step.
 *
 * C6b-iii will swap the legacy ArmoredKeyMaterialProvider for a Vault-
 * backed key material provider that reads from this abstraction; for
 * now the factory lives here so the processors compile against the
 * new CryptoService signature (which requires the abstraction).
 */

import { getConfig } from '@sep/common';
import {
  VaultClient,
  KeyCustodyAbstraction,
  PlatformVaultBackend,
  TenantVaultBackend,
  ExternalKmsBackend,
  SoftwareLocalBackend,
  DEFAULT_VAULT_CLIENT_CONFIG,
  type IKeyCustodyBackend,
} from '@sep/crypto';

export function createKeyCustody(): KeyCustodyAbstraction {
  const cfg = getConfig().vault;
  const vaultClient = new VaultClient({
    addr: cfg.addr,
    token: cfg.token,
    namespace: cfg.namespace,
    ...DEFAULT_VAULT_CLIENT_CONFIG,
  });
  return new KeyCustodyAbstraction({
    platformVault: new PlatformVaultBackend(vaultClient),
    tenantVaultFactory: (tenantId: string): IKeyCustodyBackend =>
      new TenantVaultBackend(vaultClient, tenantId),
    externalKms: new ExternalKmsBackend(),
    softwareLocal: new SoftwareLocalBackend(),
  });
}
