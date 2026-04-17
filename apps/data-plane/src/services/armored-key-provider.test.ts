/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/explicit-function-return-type */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as openpgp from 'openpgp';
import { ArmoredKeyMaterialProvider } from './armored-key-provider';

vi.mock('@sep/observability', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

let publicKeyArmored: string;
let privateKeyArmored: string;
let expectedFingerprint: string;

beforeAll(async () => {
  const { publicKey, privateKey } = await openpgp.generateKey({
    type: 'rsa',
    rsaBits: 2048,
    userIDs: [{ name: 'Test Provider', email: 'test@provider.test' }],
    format: 'armored',
  });
  publicKeyArmored = publicKey;
  privateKeyArmored = privateKey;

  const parsedKey = await openpgp.readKey({ armoredKey: publicKey });
  expectedFingerprint = parsedKey.getFingerprint();
}, 30000);

describe('ArmoredKeyMaterialProvider', () => {
  const provider = new ArmoredKeyMaterialProvider();

  it('extracts real fingerprint from public key', async () => {
    const material = await provider.loadKeyMaterial(publicKeyArmored);

    expect(material.fingerprint).toBe(expectedFingerprint);
    expect(material.fingerprint).toMatch(/^[0-9a-f]{40}$/);
    expect(material.algorithm).toBe('rsa');
    expect(material.bitLength).toBe(2048);
    expect(material.armoredKey).toBe(publicKeyArmored);
  });

  it('extracts real fingerprint from private key', async () => {
    const material = await provider.loadKeyMaterial(privateKeyArmored);

    // Private key fingerprint matches public key fingerprint
    expect(material.fingerprint).toBe(expectedFingerprint);
    expect(material.algorithm).toBe('rsa');
  });

  it('throws KEY_BACKEND_UNAVAILABLE for non-PGP content', async () => {
    await expect(provider.loadKeyMaterial('vault://secret/keys/test-key')).rejects.toThrow(
      expect.objectContaining({ code: 'KEY_BACKEND_UNAVAILABLE' }),
    );
  });

  it('throws KEY_BACKEND_UNAVAILABLE for empty string', async () => {
    await expect(provider.loadKeyMaterial('')).rejects.toThrow(
      expect.objectContaining({ code: 'KEY_BACKEND_UNAVAILABLE' }),
    );
  });

  it('fingerprint matches openpgp.js extraction exactly', async () => {
    const material = await provider.loadKeyMaterial(publicKeyArmored);
    const parsedKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
    expect(material.fingerprint).toBe(parsedKey.getFingerprint());
  });
});
