// M3.0 §18 handoff check: confirm install-only deps load from this workspace.
// See apps/control-plane/src/__smoke__.test.ts for rationale.
import { describe, it, expect } from 'vitest';

describe('M3.0 install smoke — @sep/crypto', () => {
  it('imports @aws-sdk/client-kms (install-only, wired M3 via KeyCustodyAbstraction)', async () => {
    const mod = await import('@aws-sdk/client-kms');
    expect(typeof mod.KMSClient).toBe('function');
    expect(typeof mod.SignCommand).toBe('function');
    expect(typeof mod.VerifyCommand).toBe('function');
  });
});
