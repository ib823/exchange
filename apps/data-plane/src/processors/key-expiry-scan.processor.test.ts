/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method, no-duplicate-imports --
 * unbound-method fires because vi.fn()-stubbed mocks expose methods
 * that look unbound at the type level; the `expect(mock.method)` idiom
 * is a vitest assertion target, not a runtime call. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sep/observability', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  keyExpiryWarningCounter: { inc: vi.fn() },
}));

vi.mock('@sep/common', async () => {
  const actual = await vi.importActual<typeof import('@sep/common')>('@sep/common');
  return {
    ...actual,
    getConfig: () => ({
      audit: { hashSecret: 'test-hash-secret-minimum-32-characters' },
      crypto: {
        keyExpiryEarlyWarningDays: 90,
        keyExpiryAlertDays: 30,
        keyExpiryCriticalDays: 7,
      },
    }),
  };
});

// Captured through the DB mock so tests can inspect the cross-tenant
// KeyReference listing call and stub its result.
const mockKeyReferenceFindMany = vi.fn();

const mockIncident = {
  findFirst: vi.fn(),
  create: vi.fn().mockResolvedValue({ id: 'inc-new' }),
};

const mockAuditEventCreate = vi.fn().mockResolvedValue({ id: 'audit-row' });

const mockForSystemClient = {
  keyReference: { findMany: mockKeyReferenceFindMany },
};

const mockTenantClient = {
  incident: mockIncident,
  auditEvent: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: mockAuditEventCreate,
  },
  $executeRaw: vi.fn().mockResolvedValue(undefined),
  $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@sep/db', () => ({
  DatabaseService: vi.fn().mockImplementation(() => ({
    forSystem: () => mockForSystemClient,
    forTenant: <T>(_tid: string, fn: (db: typeof mockTenantClient) => Promise<T>): Promise<T> =>
      fn(mockTenantClient),
  })),
}));

// Pull the processor in AFTER the mocks so the imports resolve
// against the stubbed @sep/db / @sep/observability.
import { KeyExpiryScanProcessor } from './key-expiry-scan.processor';
import { DatabaseService } from '@sep/db';
import { keyExpiryWarningCounter } from '@sep/observability';

function makeJob(scanAt?: string) {
  return {
    data: scanAt !== undefined ? { scanAt } : {},
  } as any;
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

describe('KeyExpiryScanProcessor', () => {
  let processor: KeyExpiryScanProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIncident.create.mockResolvedValue({ id: 'inc-new' });
    processor = new KeyExpiryScanProcessor(new DatabaseService());
  });

  it('raises P1 for a key expiring in 3 days (≤ 7 tier)', async () => {
    mockKeyReferenceFindMany.mockResolvedValueOnce([
      { id: 'key-critical', tenantId: 't-1', name: 'bank-prod', expiresAt: daysFromNow(3) },
    ]);
    mockIncident.findFirst.mockResolvedValue(null);

    await processor.process(makeJob());

    expect(mockIncident.create).toHaveBeenCalledTimes(1);
    expect(mockIncident.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 't-1',
        severity: 'P1',
        sourceType: 'KeyReference',
        sourceId: 'key-critical',
      }),
      select: { id: true },
    });
    expect(keyExpiryWarningCounter.inc).toHaveBeenCalledWith({
      tier_days: '7',
      severity: 'P1',
      tenant_id: 't-1',
    });
  });

  it('raises P2 for a key expiring in 20 days (> 7, ≤ 30 tier)', async () => {
    mockKeyReferenceFindMany.mockResolvedValueOnce([
      { id: 'key-warning', tenantId: 't-2', name: 'bank-test', expiresAt: daysFromNow(20) },
    ]);
    mockIncident.findFirst.mockResolvedValue(null);

    await processor.process(makeJob());

    expect(mockIncident.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ severity: 'P2', sourceId: 'key-warning' }),
      select: { id: true },
    });
    expect(keyExpiryWarningCounter.inc).toHaveBeenCalledWith({
      tier_days: '30',
      severity: 'P2',
      tenant_id: 't-2',
    });
  });

  it('raises P3 for a key expiring in 75 days (> 30, ≤ 90 tier)', async () => {
    mockKeyReferenceFindMany.mockResolvedValueOnce([
      { id: 'key-early', tenantId: 't-3', name: 'reg-prod', expiresAt: daysFromNow(75) },
    ]);
    mockIncident.findFirst.mockResolvedValue(null);

    await processor.process(makeJob());

    expect(mockIncident.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ severity: 'P3', sourceId: 'key-early' }),
      select: { id: true },
    });
    expect(keyExpiryWarningCounter.inc).toHaveBeenCalledWith({
      tier_days: '90',
      severity: 'P3',
      tenant_id: 't-3',
    });
  });

  it('chooses the narrowest tier when multiple apply (3 days → P1, not P2 or P3)', async () => {
    mockKeyReferenceFindMany.mockResolvedValueOnce([
      { id: 'key-both', tenantId: 't-1', name: 'k', expiresAt: daysFromNow(3) },
    ]);
    mockIncident.findFirst.mockResolvedValue(null);

    await processor.process(makeJob());

    expect(mockIncident.create).toHaveBeenCalledTimes(1);
    expect(mockIncident.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ severity: 'P1' }),
      select: { id: true },
    });
  });

  it('skips creating a duplicate when an open-like incident already exists at the tier', async () => {
    mockKeyReferenceFindMany.mockResolvedValueOnce([
      { id: 'key-dup', tenantId: 't-1', name: 'k', expiresAt: daysFromNow(5) },
    ]);
    // existsOpenForSource returns true → findFirst returns a row
    mockIncident.findFirst.mockResolvedValue({ id: 'existing-inc' });

    await processor.process(makeJob());

    expect(mockIncident.create).not.toHaveBeenCalled();
    expect(keyExpiryWarningCounter.inc).not.toHaveBeenCalled();
  });

  it('handles a batch mixing all three tiers and one out-of-range key', async () => {
    mockKeyReferenceFindMany.mockResolvedValueOnce([
      { id: 'k-critical', tenantId: 't-1', name: 'k', expiresAt: daysFromNow(5) },
      { id: 'k-warning', tenantId: 't-1', name: 'k', expiresAt: daysFromNow(25) },
      { id: 'k-early', tenantId: 't-1', name: 'k', expiresAt: daysFromNow(60) },
      { id: 'k-far', tenantId: 't-1', name: 'k', expiresAt: daysFromNow(365) },
    ]);
    mockIncident.findFirst.mockResolvedValue(null);

    await processor.process(makeJob());

    // Only three incidents — the 365-day key is out of range.
    expect(mockIncident.create).toHaveBeenCalledTimes(3);
    const severities = mockIncident.create.mock.calls.map(
      (call: any[]) => call[0].data.severity,
    );
    expect(severities).toEqual(expect.arrayContaining(['P1', 'P2', 'P3']));
  });

  it('does not raise for keys already past expiry (state machine handles those)', async () => {
    mockKeyReferenceFindMany.mockResolvedValueOnce([
      { id: 'k-past', tenantId: 't-1', name: 'k', expiresAt: daysFromNow(-5) },
    ]);
    mockIncident.findFirst.mockResolvedValue(null);

    await processor.process(makeJob());

    expect(mockIncident.create).not.toHaveBeenCalled();
  });

  it('honours an explicit scanAt from the job payload (reproducible scans)', async () => {
    const scanAt = '2026-06-01T00:00:00Z';
    // Key expires 10 days after the scan instant → P2.
    const expiresAt = new Date('2026-06-11T00:00:00Z');
    mockKeyReferenceFindMany.mockResolvedValueOnce([
      { id: 'k', tenantId: 't-1', name: 'k', expiresAt },
    ]);
    mockIncident.findFirst.mockResolvedValue(null);

    await processor.process(makeJob(scanAt));

    expect(mockIncident.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ severity: 'P2' }),
      select: { id: true },
    });
  });

  it('queries only ACTIVE keys with a non-null expiresAt bounded by the widest tier', async () => {
    mockKeyReferenceFindMany.mockResolvedValueOnce([]);

    await processor.process(makeJob());

    expect(mockKeyReferenceFindMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        state: 'ACTIVE',
        expiresAt: expect.objectContaining({
          not: null,
          gt: expect.any(Date),
          lte: expect.any(Date),
        }),
      }),
      select: expect.any(Object),
    });
  });
});
