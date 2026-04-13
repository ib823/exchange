/**
 * Key material provider abstraction.
 *
 * Loads raw key material (armored PGP key) from a backend store.
 * M2 provides a stub implementation; M3 wires in real Vault integration.
 *
 * Implementations MUST:
 * - Never log key material
 * - Never cache key material beyond the immediate operation
 * - Throw SepError(KEY_BACKEND_UNAVAILABLE) on transient backend failures
 */

export interface KeyMaterial {
  readonly armoredKey: string;
  readonly fingerprint: string;
  readonly algorithm: string;
  readonly bitLength: number;
  readonly createdAt: Date;
}

export interface IKeyMaterialProvider {
  /**
   * Load key material from the backend.
   * @param backendRef — Vault path, KMS key ID, or local reference
   * @returns parsed key material metadata + armored key
   */
  loadKeyMaterial(backendRef: string): Promise<KeyMaterial>;
}
