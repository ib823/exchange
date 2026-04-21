/**
 * HMAC key bootstrap for refresh token hashing (M3.A4-T05).
 *
 * Fetches the refresh-token HMAC key from Vault KV v2 at
 * `platform/auth/refresh-hmac-key` at module init, holds it in
 * process memory for the lifetime of the control-plane process.
 *
 * Why bootstrap fetch (not per-request):
 *   - The key is process-scope anyway; fetching on every refresh
 *     would add 10-50 ms of Vault HTTP latency with no security
 *     gain.
 *   - Rotation is an operational event that would coordinate
 *     process restarts; a live rotate-and-reload is out of scope
 *     for M3.A4.
 *
 * Fail-closed at boot: if the Vault fetch fails, this provider
 * throws and the control-plane module init aborts. Better to
 * refuse to start than to run with a bad HMAC key — every refresh
 * would produce a garbage hash, unique-index lookup would fail,
 * and every refresh would look like a replay (chain revocation).
 *
 * First-deploy bootstrap: the path may not exist yet in Vault.
 * If `kvRead` returns 404, this provider generates a fresh
 * 256-bit key, writes it with `kvWrite`, and uses it. Subsequent
 * process starts find the same key and load it. This keeps dev
 * bring-up cheap (no manual seed step) while guaranteeing a
 * unique key per Vault instance.
 */

import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { VaultClient } from '@sep/crypto';
import { SepError, ErrorCode } from '@sep/common';
import { createLogger } from '@sep/observability';

const logger = createLogger({ service: 'control-plane', module: 'refresh-hmac-key' });

const KV_MOUNT = 'kv';
const KEY_PATH = 'platform/auth/refresh-hmac-key';
const KEY_BYTES = 32; // 256-bit HMAC key

export const REFRESH_HMAC_KEY = Symbol('REFRESH_HMAC_KEY');

interface StoredHmacKey {
  /** base64-encoded 256-bit HMAC key */
  readonly keyBase64: string;
  readonly createdAt: string;
}

/**
 * Bootstraps the refresh HMAC key from Vault. Resolves to a Buffer
 * containing the 256-bit key. Throws SepError on Vault failure
 * after the first-deploy auto-seed path is exhausted.
 */
export async function loadRefreshHmacKey(vault: VaultClient): Promise<Buffer> {
  try {
    const stored = await vault.kvRead<StoredHmacKey>(KV_MOUNT, KEY_PATH);
    const key = Buffer.from(stored.keyBase64, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new SepError(ErrorCode.CRYPTO_KEY_INVALID_STATE, {
        reason: 'Refresh HMAC key is not 32 bytes — possible corruption',
      });
    }
    logger.info({ path: KEY_PATH }, 'Refresh HMAC key loaded from Vault');
    return key;
  } catch (err) {
    if (err instanceof SepError && err.code === ErrorCode.CRYPTO_KEY_NOT_FOUND) {
      // First-deploy: path absent. Seed a fresh key.
      return seedRefreshHmacKey(vault);
    }
    logger.error(
      { path: KEY_PATH, err: String(err) },
      'Refresh HMAC key load failed — refusing to start control-plane',
    );
    throw new SepError(ErrorCode.KEY_BACKEND_UNAVAILABLE, {
      operation: 'loadRefreshHmacKey',
      reason: 'Vault kvRead failed at module init',
    });
  }
}

async function seedRefreshHmacKey(vault: VaultClient): Promise<Buffer> {
  const key = randomBytes(KEY_BYTES);
  const payload: StoredHmacKey = {
    keyBase64: key.toString('base64'),
    createdAt: new Date().toISOString(),
  };
  try {
    await vault.kvWrite<StoredHmacKey>(KV_MOUNT, KEY_PATH, payload);
  } catch (err) {
    logger.error({ err: String(err) }, 'Refresh HMAC key seed failed');
    throw new SepError(ErrorCode.KEY_BACKEND_UNAVAILABLE, {
      operation: 'seedRefreshHmacKey',
      reason: 'Vault kvWrite failed during first-deploy HMAC key seed',
    });
  }
  logger.warn(
    { path: KEY_PATH },
    'Refresh HMAC key absent at boot; seeded a fresh 256-bit key. Subsequent starts will load the same key.',
  );
  return key;
}

/**
 * Compute HMAC-SHA256 of a raw refresh token under the process-
 * scope key. Deterministic — same input always produces the same
 * hash — so the `refresh_tokens.tokenHash` unique index can be
 * used for lookup.
 */
export function hmacToken(rawToken: string, key: Buffer): string {
  return createHmac('sha256', key).update(rawToken, 'utf8').digest('hex');
}

/**
 * Constant-time equality check for two HMAC-SHA256 hex digests.
 * Not strictly required (the unique-index lookup is the primary
 * comparison path), but kept here for any code path that verifies
 * a recomputed hash against a stored one.
 */
export function constantTimeHmacEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}
