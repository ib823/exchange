import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

// eslint-disable-next-line no-process-env -- integration gate reads env directly
const MIGRATION_URL = process.env['DATABASE_URL'];
// eslint-disable-next-line no-process-env -- integration gate reads env directly
const RUNTIME_URL = process.env['RUNTIME_DATABASE_URL'];

const hasIntegrationEnv =
  MIGRATION_URL !== undefined &&
  MIGRATION_URL.length > 0 &&
  RUNTIME_URL !== undefined &&
  RUNTIME_URL.length > 0;

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcanlogin: boolean;
}

describe.skipIf(!hasIntegrationEnv)('role separation (M3.A1-T01)', () => {
  // describe.skipIf marks tests as skipped but still evaluates the callback body.
  // Conditional spread keeps PrismaClient happy under exactOptionalPropertyTypes
  // when the env vars are unset — the skipped tests never actually connect.
  const migrationClient = new PrismaClient({
    ...(MIGRATION_URL !== undefined && { datasourceUrl: MIGRATION_URL }),
  });
  const runtimeClient = new PrismaClient({
    ...(RUNTIME_URL !== undefined && { datasourceUrl: RUNTIME_URL }),
  });

  afterAll(async () => {
    await migrationClient.$disconnect();
    await runtimeClient.$disconnect();
  });

  it('sep role has BYPASSRLS attribute explicitly set', async () => {
    const rows = await migrationClient.$queryRaw<RoleRow[]>`
      SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
      FROM pg_roles
      WHERE rolname = 'sep'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rolbypassrls).toBe(true);
  });

  it('sep_app role does NOT have BYPASSRLS attribute', async () => {
    const rows = await migrationClient.$queryRaw<RoleRow[]>`
      SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
      FROM pg_roles
      WHERE rolname = 'sep_app'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rolbypassrls).toBe(false);
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolcanlogin).toBe(true);
  });

  it('RUNTIME_DATABASE_URL connection reports current_user = sep_app', async () => {
    const rows = await runtimeClient.$queryRaw<Array<{ current_user: string }>>`
      SELECT current_user
    `;
    expect(rows[0]?.current_user).toBe('sep_app');
  });

  it('DATABASE_URL connection reports current_user = sep', async () => {
    const rows = await migrationClient.$queryRaw<Array<{ current_user: string }>>`
      SELECT current_user
    `;
    expect(rows[0]?.current_user).toBe('sep');
  });

  it('sep_app cannot CREATE TABLE (DDL is denied at schema level)', async () => {
    await expect(
      runtimeClient.$executeRawUnsafe('CREATE TABLE sep_app_ddl_probe (id text PRIMARY KEY);'),
    ).rejects.toThrow(/permission denied/i);
  });
});
