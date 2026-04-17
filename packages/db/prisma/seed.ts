import {
  PrismaClient,
  Role,
  ServiceTier,
  Environment,
  TransportProtocol,
  MessageSecurityMode,
  PartnerType,
  PartnerProfileStatus,
  KeyBackendType,
  KeyUsage,
  KeyState,
  UserStatus,
} from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// Deterministic IDs for idempotent re-seeding
const IDS = {
  tenantStandard: 'seed-tenant-standard-001',
  tenantDedicated: 'seed-tenant-dedicated-001',
  users: {
    platformAdmin: 'seed-user-platform-admin-001',
    tenantAdmin: 'seed-user-tenant-admin-001',
    securityAdmin: 'seed-user-security-admin-001',
    integrationEngineer: 'seed-user-integration-eng-001',
    operationsAnalyst: 'seed-user-ops-analyst-001',
    complianceReviewer: 'seed-user-compliance-rev-001',
  },
  retentionPolicy: 'seed-retention-policy-standard-001',
  partnerProfile: 'seed-partner-profile-bank-test-001',
  keyReference: 'seed-key-ref-signing-001',
  sourceSystem: 'seed-source-system-erp-001',
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Starting seed...');

  // ── Tenants ──────────────────────────────────────────────────────────────
  const tenantStandard = await prisma.tenant.upsert({
    where: { id: IDS.tenantStandard },
    update: {},
    create: {
      id: IDS.tenantStandard,
      name: 'Acme Corp (Seed)',
      legalEntityName: 'Acme Corporation Sdn Bhd',
      status: UserStatus.ACTIVE,
      serviceTier: ServiceTier.STANDARD,
      defaultRegion: 'ap-southeast-1',
    },
  });

  const tenantDedicated = await prisma.tenant.upsert({
    where: { id: IDS.tenantDedicated },
    update: {},
    create: {
      id: IDS.tenantDedicated,
      name: 'Regulated Bank (Seed)',
      legalEntityName: 'Regulated Bank Berhad',
      status: UserStatus.ACTIVE,
      serviceTier: ServiceTier.DEDICATED,
      defaultRegion: 'ap-southeast-1',
    },
  });

  console.log(`  ✓ Tenants: ${tenantStandard.name}, ${tenantDedicated.name}`);

  // ── Retention Policy ─────────────────────────────────────────────────────
  await prisma.retentionPolicy.upsert({
    where: { id: IDS.retentionPolicy },
    update: {},
    create: {
      id: IDS.retentionPolicy,
      tenantId: tenantStandard.id,
      name: 'Standard 7-Year Retention',
      encryptedArtifactDays: 90,
      decryptedArtifactDays: 0,
      auditRetentionDays: 2555,
      operatorLogDays: 365,
      incidentHistoryDays: 2555,
      legalHold: false,
    },
  });

  console.log('  ✓ Retention policy');

  // ── Users — one per role ─────────────────────────────────────────────────
  const userDefs: Array<{
    id: string;
    email: string;
    displayName: string;
    role: Role;
    tenantId: string;
  }> = [
    {
      id: IDS.users.platformAdmin,
      email: 'platform-admin@sep.local',
      displayName: 'Platform Admin (Seed)',
      role: Role.PLATFORM_SUPER_ADMIN,
      tenantId: tenantStandard.id,
    },
    {
      id: IDS.users.tenantAdmin,
      email: 'tenant-admin@sep.local',
      displayName: 'Tenant Admin (Seed)',
      role: Role.TENANT_ADMIN,
      tenantId: tenantStandard.id,
    },
    {
      id: IDS.users.securityAdmin,
      email: 'security-admin@sep.local',
      displayName: 'Security Admin (Seed)',
      role: Role.SECURITY_ADMIN,
      tenantId: tenantStandard.id,
    },
    {
      id: IDS.users.integrationEngineer,
      email: 'integration-engineer@sep.local',
      displayName: 'Integration Engineer (Seed)',
      role: Role.INTEGRATION_ENGINEER,
      tenantId: tenantStandard.id,
    },
    {
      id: IDS.users.operationsAnalyst,
      email: 'ops-analyst@sep.local',
      displayName: 'Operations Analyst (Seed)',
      role: Role.OPERATIONS_ANALYST,
      tenantId: tenantStandard.id,
    },
    {
      id: IDS.users.complianceReviewer,
      email: 'compliance-reviewer@sep.local',
      displayName: 'Compliance Reviewer (Seed)',
      role: Role.COMPLIANCE_REVIEWER,
      tenantId: tenantStandard.id,
    },
  ];

  for (const def of userDefs) {
    const user = await prisma.user.upsert({
      where: { id: def.id },
      update: {},
      create: {
        id: def.id,
        tenantId: def.tenantId,
        email: def.email,
        displayName: def.displayName,
        status: UserStatus.ACTIVE,
      },
    });

    await prisma.roleAssignment.upsert({
      where: { tenantId_userId_role: { tenantId: def.tenantId, userId: user.id, role: def.role } },
      update: {},
      create: {
        tenantId: def.tenantId,
        userId: user.id,
        role: def.role,
        grantedBy: 'seed',
      },
    });
  }

  console.log('  ✓ Users: 6 created (one per role)');

  // ── Source System ─────────────────────────────────────────────────────────
  await prisma.sourceSystem.upsert({
    where: { id: IDS.sourceSystem },
    update: {},
    create: {
      id: IDS.sourceSystem,
      tenantId: tenantStandard.id,
      name: 'ERP-SAP-PROD (Seed)',
      description: 'SAP ERP production instance — seed data only',
      allowedIps: ['127.0.0.1', '::1'],
      active: true,
    },
  });

  console.log('  ✓ Source system');

  // ── Partner Profile (DRAFT — no real bank params) ─────────────────────────
  await prisma.partnerProfile.upsert({
    where: { id: IDS.partnerProfile },
    update: {},
    create: {
      id: IDS.partnerProfile,
      tenantId: tenantStandard.id,
      name: 'Generic Bank H2H — TEST (Seed)',
      partnerType: PartnerType.BANK,
      environment: Environment.TEST,
      status: PartnerProfileStatus.DRAFT,
      transportProtocol: TransportProtocol.SFTP,
      messageSecurityMode: MessageSecurityMode.SIGN_ENCRYPT,
      config: {
        _note: 'Seed profile only — no real bank parameters',
        sftp: {
          host: 'sftp.simulator.local',
          port: 22,
          username: 'sep-test',
          hostKeyFingerprint: 'SEED_PLACEHOLDER',
          uploadPath: '/upload',
          downloadPath: '/download',
        },
      },
      notes: 'Created by database seed — not suitable for any real exchange',
    },
  });

  console.log('  ✓ Partner profile (DRAFT)');

  // ── Key Reference (DRAFT — no real key material) ──────────────────────────
  await prisma.keyReference.upsert({
    where: { id: IDS.keyReference },
    update: {},
    create: {
      id: IDS.keyReference,
      tenantId: tenantStandard.id,
      name: 'Seed Signing Key — TEST',
      usage: [KeyUsage.SIGN, KeyUsage.VERIFY],
      backendType: KeyBackendType.PLATFORM_VAULT,
      backendRef: 'secret/sep/seed/keys/signing-test-001',
      fingerprint: sha256('seed-placeholder-fingerprint'),
      algorithm: 'rsa4096',
      version: 1,
      state: KeyState.DRAFT,
      environment: Environment.TEST,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      metadata: { _note: 'Seed key reference — no real key material in Vault at this path' },
    },
  });

  console.log('  ✓ Key reference (DRAFT)');

  // ── Summary ───────────────────────────────────────────────────────────────
  const counts = {
    tenants: await prisma.tenant.count(),
    users: await prisma.user.count(),
    roleAssignments: await prisma.roleAssignment.count(),
    partnerProfiles: await prisma.partnerProfile.count(),
    keyReferences: await prisma.keyReference.count(),
    sourceSystems: await prisma.sourceSystem.count(),
    retentionPolicies: await prisma.retentionPolicy.count(),
  };

  console.log('\nSeed complete:');
  for (const [entity, count] of Object.entries(counts)) {
    console.log(`  ${entity}: ${count}`);
  }
}

main()
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
