/**
 * Key material provider that treats backendRef as armored PGP key material.
 *
 * M2 stub: in test environments, backendRef stores the actual armored key.
 * This provider parses the armored key to extract the REAL fingerprint
 * and algorithm — it does NOT return hardcoded values.
 *
 * M3 replaces this with a VaultKeyMaterialProvider that resolves
 * backendRef as a Vault path and retrieves the key from HashiCorp Vault.
 */

import * as openpgp from 'openpgp';
import { SepError, ErrorCode } from '@sep/common';
import { createLogger } from '@sep/observability';
import type { IKeyMaterialProvider, KeyMaterial } from '@sep/crypto';

const logger = createLogger({ service: 'data-plane', module: 'armored-key-provider' });

export class ArmoredKeyMaterialProvider implements IKeyMaterialProvider {
  async loadKeyMaterial(backendRef: string): Promise<KeyMaterial> {
    try {
      // Try to parse as a public key first, then as a private key
      let key: openpgp.Key;
      try {
        key = await openpgp.readKey({ armoredKey: backendRef });
      } catch {
        // May be a private key
        key = await openpgp.readPrivateKey({ armoredKey: backendRef });
      }

      const fingerprint = key.getFingerprint();
      const algorithmInfo = key.getAlgorithmInfo();

      // Map openpgp algorithm names to our standard names
      const algorithm = this.mapAlgorithm(algorithmInfo.algorithm);
      const bitLength = 'bits' in algorithmInfo ? Number(algorithmInfo.bits) : 0;

      return {
        armoredKey: backendRef,
        fingerprint,
        algorithm,
        bitLength,
        createdAt: key.getCreationTime(),
      };
    } catch (err) {
      if (err instanceof SepError) { throw err; }
      logger.error(
        { backendRefLength: backendRef.length },
        'Failed to parse armored key material',
      );
      throw new SepError(ErrorCode.KEY_BACKEND_UNAVAILABLE, {
        message: 'Failed to parse key material from backend reference',
      });
    }
  }

  private mapAlgorithm(openpgpAlgorithm: string): string {
    // openpgp.js returns algorithm names like 'rsaEncryptSign', 'ecdh', etc.
    const alg = openpgpAlgorithm.toLowerCase();
    if (alg.startsWith('rsa')) { return 'rsa'; }
    if (alg === 'ecdh') { return 'ecdh'; }
    if (alg === 'ecdsa') { return 'ecdsa'; }
    if (alg === 'eddsa') { return 'eddsa'; }
    return alg;
  }
}
