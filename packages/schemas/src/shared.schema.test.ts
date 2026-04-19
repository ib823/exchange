import { describe, it, expect } from 'vitest';
import {
  PaginationSchema,
  CuidSchema,
  EnvironmentSchema,
  RoleSchema,
  KeyStateSchema,
} from './shared.schema';

describe('PaginationSchema', () => {
  it('accepts valid pagination params', () => {
    const result = PaginationSchema.safeParse({ page: 2, pageSize: 50 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.pageSize).toBe(50);
    }
  });

  it('applies defaults when omitted', () => {
    const result = PaginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
    }
  });

  it('rejects page < 1', () => {
    expect(PaginationSchema.safeParse({ page: 0 }).success).toBe(false);
  });

  it('rejects pageSize < 1', () => {
    expect(PaginationSchema.safeParse({ pageSize: 0 }).success).toBe(false);
  });

  it('rejects pageSize > 100', () => {
    expect(PaginationSchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(PaginationSchema.safeParse({ pageSize: 1000000 }).success).toBe(false);
  });

  it('coerces string numbers', () => {
    const result = PaginationSchema.safeParse({ page: '3', pageSize: '10' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.pageSize).toBe(10);
    }
  });
});

describe('EnvironmentSchema', () => {
  it('accepts valid environments', () => {
    expect(EnvironmentSchema.safeParse('TEST').success).toBe(true);
    expect(EnvironmentSchema.safeParse('CERTIFICATION').success).toBe(true);
    expect(EnvironmentSchema.safeParse('PRODUCTION').success).toBe(true);
  });

  it('rejects invalid environments', () => {
    expect(EnvironmentSchema.safeParse('STAGING').success).toBe(false);
    expect(EnvironmentSchema.safeParse('test').success).toBe(false);
  });
});

describe('RoleSchema', () => {
  it('accepts all 6 defined roles', () => {
    const roles = [
      'PLATFORM_SUPER_ADMIN',
      'TENANT_ADMIN',
      'SECURITY_ADMIN',
      'INTEGRATION_ENGINEER',
      'OPERATIONS_ANALYST',
      'COMPLIANCE_REVIEWER',
    ];
    for (const role of roles) {
      expect(RoleSchema.safeParse(role).success).toBe(true);
    }
  });
});

describe('KeyStateSchema', () => {
  it('accepts all defined key states', () => {
    const states = [
      'DRAFT',
      'IMPORTED',
      'VALIDATED',
      'ACTIVE',
      'ROTATING',
      'EXPIRED',
      'REVOKED',
      'RETIRED',
    ];
    for (const state of states) {
      expect(KeyStateSchema.safeParse(state).success).toBe(true);
    }
  });
});

describe('CuidSchema', () => {
  it('accepts valid CUID', () => {
    expect(CuidSchema.safeParse('clx2qwertyuiop1234567890').success).toBe(true);
  });

  it('accepts a freshly-shaped 25-char cuid', () => {
    // The pattern produced by `cuid()` defaults: c + 24 base-32 chars.
    expect(CuidSchema.safeParse('cl9z3a4b5c6d7e8f9g0h1i2j3').success).toBe(true);
  });

  it('rejects empty string', () => {
    expect(CuidSchema.safeParse('').success).toBe(false);
  });

  it('rejects UUID-shaped strings (M3.A1 §3 — Tenant.id is cuid, not UUID)', () => {
    expect(CuidSchema.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(false);
  });

  it('rejects too-short strings', () => {
    expect(CuidSchema.safeParse('cabc').success).toBe(false);
  });

  it('rejects strings whose first char is not c', () => {
    expect(CuidSchema.safeParse('xlx2qwertyuiop1234567890').success).toBe(false);
  });

  it('rejects null and undefined at runtime', () => {
    expect(CuidSchema.safeParse(null).success).toBe(false);
    expect(CuidSchema.safeParse(undefined).success).toBe(false);
  });
});
