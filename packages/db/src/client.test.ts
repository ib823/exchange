import { describe, it, expect } from 'vitest';
import { getPrismaClient } from './client';

describe('getPrismaClient', () => {
  it('returns a singleton Prisma client', () => {
    const client1 = getPrismaClient();
    const client2 = getPrismaClient();
    expect(client1).toBe(client2);
  });

  it('client has expected model properties', () => {
    const client = getPrismaClient();
    expect(client).toHaveProperty('tenant');
    expect(client).toHaveProperty('submission');
    expect(client).toHaveProperty('auditEvent');
    expect(client).toHaveProperty('keyReference');
    expect(client).toHaveProperty('apiKey');
    expect(client).toHaveProperty('webhook');
    expect(client).toHaveProperty('incident');
    expect(client).toHaveProperty('approval');
  });
});
