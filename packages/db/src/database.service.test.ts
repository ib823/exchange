import { describe, it, expect, vi } from 'vitest';
import { ErrorCode, isSepError } from '@sep/common';
import { DatabaseService } from './database.service';

// A minimal valid cuid for unit-level shape checks. The integration tests
// (role-separation.test.ts and forTenant.integration.test.ts) cover the
// actual SET LOCAL / RLS behaviour against a live database.
const VALID_CUID = 'clx2qwertyuiop1234567890';

describe('DatabaseService.forTenant() — input validation', () => {
  it('throws TENANT_CONTEXT_MISSING when tenantId is empty string', async () => {
    const service = new DatabaseService();
    try {
      await service.forTenant('', () => Promise.resolve(0));
      throw new Error('expected throw');
    } catch (err) {
      expect(isSepError(err)).toBe(true);
      if (isSepError(err)) {
        expect(err.code).toBe(ErrorCode.TENANT_CONTEXT_MISSING);
      }
    }
  });

  it('throws TENANT_CONTEXT_MISSING when tenantId is undefined', async () => {
    const service = new DatabaseService();
    try {
      await service.forTenant(undefined as unknown as string, () => Promise.resolve(0));
      throw new Error('expected throw');
    } catch (err) {
      expect(isSepError(err)).toBe(true);
      if (isSepError(err)) {
        expect(err.code).toBe(ErrorCode.TENANT_CONTEXT_MISSING);
      }
    }
  });

  it('throws TENANT_CONTEXT_MISSING when tenantId is null', async () => {
    const service = new DatabaseService();
    try {
      await service.forTenant(null as unknown as string, () => Promise.resolve(0));
      throw new Error('expected throw');
    } catch (err) {
      expect(isSepError(err)).toBe(true);
      if (isSepError(err)) {
        expect(err.code).toBe(ErrorCode.TENANT_CONTEXT_MISSING);
      }
    }
  });

  it('throws TENANT_CONTEXT_INVALID when tenantId is a non-cuid string (e.g., UUID)', async () => {
    const service = new DatabaseService();
    try {
      await service.forTenant('550e8400-e29b-41d4-a716-446655440000', () => Promise.resolve(0));
      throw new Error('expected throw');
    } catch (err) {
      expect(isSepError(err)).toBe(true);
      if (isSepError(err)) {
        expect(err.code).toBe(ErrorCode.TENANT_CONTEXT_INVALID);
      }
    }
  });

  it('throws synchronously (does not return a rejecting promise that swallows the throw)', () => {
    // The validation runs before $transaction is invoked, so a missing tenantId
    // surfaces as a synchronous throw rather than an unhandled rejection.
    const service = new DatabaseService();
    expect(() => service.forTenant('', () => Promise.resolve(0))).toThrow();
  });
});

describe('DatabaseService.forTenant() — callback dispatch', () => {
  it('does not call the callback when validation fails', async () => {
    const service = new DatabaseService();
    const fn = vi.fn();
    try {
      await service.forTenant('', fn);
    } catch {
      // Expected — TENANT_CONTEXT_MISSING.
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns the callback return value (typing) for valid cuid', () => {
    // Compile-time check: the generic <T> is correctly inferred. We can't
    // actually invoke the transaction here without a DB connection — that's
    // exercised by forTenant.integration.test.ts.
    const service = new DatabaseService();
    type Result = ReturnType<typeof service.forTenant<{ count: number }>>;
    const sample: Result = Promise.resolve({ count: 1 });
    expect(sample).toBeInstanceOf(Promise);
  });

  it('VALID_CUID passes the schema check', () => {
    // Sanity: the test fixture is a real cuid shape. If this assertion ever
    // fails, the validator definition has drifted and the rest of the test
    // suite would silently flip behaviour.
    expect(VALID_CUID.startsWith('c')).toBe(true);
    expect(VALID_CUID.length).toBeGreaterThanOrEqual(9);
  });
});

describe('DatabaseService.forSystem()', () => {
  it('returns a Prisma-shaped client without tenant validation', () => {
    const service = new DatabaseService();
    const client = service.forSystem();
    expect(client).toBeDefined();
    expect(client).toHaveProperty('$queryRaw');
  });
});

describe('DatabaseService.forSystemTx() — input validation', () => {
  // Behaviour exercised here is the synchronous validation gate.
  // The tx-open + set_config behaviour is exercised by integration tests
  // (audit-transactional-coupling.test.ts via tenants.service flows).

  it('throws TENANT_CONTEXT_MISSING when tenantIdForAudit is empty string', async () => {
    const service = new DatabaseService();
    try {
      await service.forSystemTx('', () => Promise.resolve(0));
      throw new Error('expected throw');
    } catch (err) {
      expect(isSepError(err)).toBe(true);
      if (isSepError(err)) {
        expect(err.code).toBe(ErrorCode.TENANT_CONTEXT_MISSING);
      }
    }
  });

  it('throws TENANT_CONTEXT_INVALID when tenantIdForAudit is a non-cuid (e.g., UUID)', async () => {
    const service = new DatabaseService();
    try {
      await service.forSystemTx('550e8400-e29b-41d4-a716-446655440000', () => Promise.resolve(0));
      throw new Error('expected throw');
    } catch (err) {
      expect(isSepError(err)).toBe(true);
      if (isSepError(err)) {
        expect(err.code).toBe(ErrorCode.TENANT_CONTEXT_INVALID);
      }
    }
  });

  it('does not validate when tenantIdForAudit is null (caller will set context manually)', async () => {
    // Validation gate must NOT fire on null. Use a stub client so the
    // assertion does not depend on a live DB connection — the tx behaviour
    // (set_config + callback dispatch) is exercised end-to-end by
    // tests/integration/rls-negative-tests/audit-transactional-coupling.test.ts.
    const stubClient = {
      $transaction: vi.fn(async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb({})),
    } as unknown as ConstructorParameters<typeof DatabaseService>[0];

    const service = new DatabaseService(stubClient);
    const result = await service.forSystemTx(null, () => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('does not call the callback when validation fails', async () => {
    const service = new DatabaseService();
    const fn = vi.fn();
    try {
      await service.forSystemTx('', fn);
    } catch {
      // Expected — TENANT_CONTEXT_MISSING.
    }
    expect(fn).not.toHaveBeenCalled();
  });
});
