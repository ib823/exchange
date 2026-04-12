import { sign } from 'jsonwebtoken';

const TEST_JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long';
const TEST_EXPIRY = '1h';

export interface TestUserPayload {
  userId: string;
  tenantId: string;
  role: string;
  email: string;
}

export function makeTestToken(payload: TestUserPayload): string {
  return sign(payload, TEST_JWT_SECRET, {
    expiresIn: TEST_EXPIRY,
    issuer: 'sep-control-plane-test',
  });
}

export const TEST_TENANTS = {
  standard: 'seed-tenant-standard-001',
  dedicated: 'seed-tenant-dedicated-001',
};

export const TEST_USERS = {
  tenantAdmin: {
    userId: 'seed-user-tenant-admin-001',
    tenantId: TEST_TENANTS.standard,
    role: 'TENANT_ADMIN',
    email: 'tenant-admin@sep.local',
  },
  securityAdmin: {
    userId: 'seed-user-security-admin-001',
    tenantId: TEST_TENANTS.standard,
    role: 'SECURITY_ADMIN',
    email: 'security-admin@sep.local',
  },
  operationsAnalyst: {
    userId: 'seed-user-ops-analyst-001',
    tenantId: TEST_TENANTS.standard,
    role: 'OPERATIONS_ANALYST',
    email: 'ops-analyst@sep.local',
  },
  complianceReviewer: {
    userId: 'seed-user-compliance-rev-001',
    tenantId: TEST_TENANTS.standard,
    role: 'COMPLIANCE_REVIEWER',
    email: 'compliance-reviewer@sep.local',
  },
  attackerOtherTenant: {
    userId: 'attacker-user-001',
    tenantId: TEST_TENANTS.dedicated,
    role: 'TENANT_ADMIN',
    email: 'attacker@other-tenant.local',
  },
};

// Pre-built tokens for all test users
export const TEST_TOKENS = Object.fromEntries(
  Object.entries(TEST_USERS).map(([key, user]) => [key, makeTestToken(user)]),
) as Record<keyof typeof TEST_USERS, string>;
