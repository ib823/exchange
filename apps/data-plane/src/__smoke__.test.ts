// M3.0 §18 handoff check: confirm install-only deps load from this workspace.
// See apps/control-plane/src/__smoke__.test.ts for rationale.
import { describe, it, expect } from 'vitest';

const TIMEOUT = 30_000;

describe('M3.0 install smoke — @sep/data-plane', () => {
  it(
    'imports @aws-sdk/client-s3 (install-only, wired M3.5)',
    async () => {
      const mod = await import('@aws-sdk/client-s3');
      expect(typeof mod.S3Client).toBe('function');
      expect(typeof mod.PutObjectCommand).toBe('function');
      expect(typeof mod.GetObjectCommand).toBe('function');
    },
    TIMEOUT,
  );

  it(
    'imports @aws-sdk/s3-request-presigner (install-only, wired M3.5)',
    async () => {
      const mod = await import('@aws-sdk/s3-request-presigner');
      expect(typeof mod.getSignedUrl).toBe('function');
    },
    TIMEOUT,
  );

  it(
    'imports clamscan (install-only, wired M3 for malware scanning)',
    async () => {
      const mod = await import('clamscan');
      // clamscan ships as a class via default export; check module loads.
      expect(mod).toBeTruthy();
    },
    TIMEOUT,
  );

  it(
    'imports undici at promoted version (§11 override 7.25.0)',
    async () => {
      const mod = await import('undici');
      expect(typeof mod.fetch).toBe('function');
      expect(typeof mod.Agent).toBe('function');
    },
    TIMEOUT,
  );
});
