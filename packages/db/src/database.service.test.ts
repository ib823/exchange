import { describe, it, expect } from 'vitest';
import { DatabaseService } from './database.service';

describe('DatabaseService', () => {
  it('forTenant() throws when tenantId is empty', () => {
    const service = new DatabaseService();
    expect(() => service.forTenant('')).toThrow('requires a non-empty tenantId');
  });

  it('forTenant() throws when tenantId is undefined (runtime bypass of type system)', () => {
    const service = new DatabaseService();
    expect(() => service.forTenant(undefined as unknown as string)).toThrow();
  });

  it('forTenant() throws when tenantId is null (runtime bypass of type system)', () => {
    const service = new DatabaseService();
    expect(() => service.forTenant(null as unknown as string)).toThrow();
  });

  it('forTenant() returns a client when given a valid tenantId', () => {
    const service = new DatabaseService();
    const client = service.forTenant('tenant-123');
    expect(client).toBeDefined();
    expect(client).toHaveProperty('$queryRaw');
  });

  it('forSystem() returns a client without requiring tenantId', () => {
    const service = new DatabaseService();
    const client = service.forSystem();
    expect(client).toBeDefined();
    expect(client).toHaveProperty('$queryRaw');
  });

  it('forTenant() and forSystem() return the same underlying client', () => {
    const service = new DatabaseService();
    const tenantClient = service.forTenant('tenant-abc');
    const systemClient = service.forSystem();
    // Today they return the same client; M3 RLS will change forTenant behavior
    expect(tenantClient).toBe(systemClient);
  });
});
