import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '@sep/db';

const mockDb = {
  apiKey: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  tenant: {
    findUnique: vi.fn(),
  },
};

const mockDatabaseService = {
  forTenant: <T>(_tid: string, fn: (db: typeof mockDb) => Promise<T>): Promise<T> => fn(mockDb),
  forSystem: (): typeof mockDb => mockDb,
} as unknown as DatabaseService;

vi.mock('@sep/common', async () => {
  const actual = await vi.importActual<typeof import('@sep/common')>('@sep/common');
  return {
    ...actual,
    getConfig: (): { auth: { jwtSecret: string; jwtExpiry: string; jwtIssuer: string } } => ({
      auth: {
        jwtSecret: 'test-secret-that-is-at-least-32-characters-long',
        jwtExpiry: '15m',
        jwtIssuer: 'sep-control-plane',
      },
    }),
  };
});

vi.mock('@sep/observability', () => ({
  createLogger: (): Record<string, ReturnType<typeof vi.fn>> => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@node-rs/argon2', () => ({
  verify: vi.fn((hash: string, raw: string): Promise<boolean> => {
    return Promise.resolve(hash === `hashed:${raw}`);
  }),
}));

const mockJwtService = {
  sign: vi.fn().mockReturnValue('mock-jwt-token'),
};

const baseApiKey = {
  id: 'key-1',
  tenantId: 'tenant-1',
  name: 'ci-integration-key',
  prefix: 'abcd1234',
  keyHash: 'hashed:abcd1234-full-key-value',
  role: 'INTEGRATION_ENGINEER',
  active: true,
  expiresAt: null,
  lastUsedAt: null,
  createdAt: new Date(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.apiKey.update.mockResolvedValue({});
    service = new AuthService(mockJwtService as unknown as JwtService, mockDatabaseService);
  });

  describe('validateApiKey', () => {
    it('accepts a valid key and returns correct token payload', async () => {
      mockDb.apiKey.findMany.mockResolvedValue([baseApiKey]);
      mockDb.tenant.findUnique.mockResolvedValue({ status: 'ACTIVE' });

      const result = await service.validateApiKey('abcd1234-full-key-value');

      expect(result).toEqual({
        userId: 'apikey:ci-integration-key@tenant-1',
        tenantId: 'tenant-1',
        role: 'INTEGRATION_ENGINEER',
        email: 'apikey:abcd1234',
        credentialId: 'key-1',
      });
    });

    it('rejects when no keys match the prefix', async () => {
      mockDb.apiKey.findMany.mockResolvedValue([]);

      await expect(service.validateApiKey('unknown0-full-key-value')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when hash does not match (invalid key)', async () => {
      mockDb.apiKey.findMany.mockResolvedValue([baseApiKey]);

      await expect(service.validateApiKey('abcd1234-wrong-key-value')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired key', async () => {
      const expiredKey = {
        ...baseApiKey,
        keyHash: 'hashed:abcd1234-expired-key',
        expiresAt: new Date('2020-01-01'),
      };
      mockDb.apiKey.findMany.mockResolvedValue([expiredKey]);

      await expect(service.validateApiKey('abcd1234-expired-key')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a key belonging to a suspended tenant', async () => {
      mockDb.apiKey.findMany.mockResolvedValue([baseApiKey]);
      mockDb.tenant.findUnique.mockResolvedValue({ status: 'SUSPENDED' });

      await expect(service.validateApiKey('abcd1234-full-key-value')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when tenant does not exist', async () => {
      mockDb.apiKey.findMany.mockResolvedValue([baseApiKey]);
      mockDb.tenant.findUnique.mockResolvedValue(null);

      await expect(service.validateApiKey('abcd1234-full-key-value')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('actor identity (userId) is not the API key row ID', async () => {
      mockDb.apiKey.findMany.mockResolvedValue([baseApiKey]);
      mockDb.tenant.findUnique.mockResolvedValue({ status: 'ACTIVE' });

      const result = await service.validateApiKey('abcd1234-full-key-value');

      // userId must NOT equal the API key's database row ID
      expect(result.userId).not.toBe('key-1');
      // userId must be traceable to a named entity
      expect(result.userId).toContain('ci-integration-key');
      // credentialId carries the API key row ID separately
      expect(result.credentialId).toBe('key-1');
    });

    it('returns correct tenantId from the matched key', async () => {
      const keyForTenant2 = {
        ...baseApiKey,
        id: 'key-2',
        tenantId: 'tenant-2',
        keyHash: 'hashed:abcd1234-tenant2-key',
        role: 'TENANT_ADMIN',
      };
      mockDb.apiKey.findMany.mockResolvedValue([baseApiKey, keyForTenant2]);
      mockDb.tenant.findUnique.mockResolvedValue({ status: 'ACTIVE' });

      const result = await service.validateApiKey('abcd1234-tenant2-key');

      expect(result.tenantId).toBe('tenant-2');
      expect(result.role).toBe('TENANT_ADMIN');
    });
  });

  describe('issueToken', () => {
    it('issues a JWT with correct payload and config', () => {
      const payload = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        role: 'INTEGRATION_ENGINEER',
        email: 'eng@tenant.local',
      };

      const result = service.issueToken(payload);

      expect(result).toEqual({
        accessToken: 'mock-jwt-token',
        expiresIn: '15m',
      });
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        payload,
        expect.objectContaining({
          secret: 'test-secret-that-is-at-least-32-characters-long',
          expiresIn: '15m',
          issuer: 'sep-control-plane',
          jwtid: expect.stringMatching(/^[0-9a-f-]{36}$/),
        }),
      );
    });
  });
});
