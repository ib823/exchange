/**
 * Tenant boundary test helper.
 *
 * Use in every integration test that exercises a controller method.
 * Verifies that accessing a resource with a mismatched tenantId returns 403,
 * not 200 or 404. A 404 on cross-tenant access would reveal resource existence.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export interface TenantBoundaryCase {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  ownerTenantId: string;
  ownerToken: string;
  attackerTenantId: string;
  attackerToken: string;
  body?: Record<string, unknown>;
}

export async function assertTenantBoundaryEnforced(
  app: NestFastifyApplication,
  tc: TenantBoundaryCase,
): Promise<void> {
  const { default: supertest } = await import('supertest');
  const server = app.getHttpServer();

  // Owner must be able to access their own resource
  const ownerResponse = await supertest(server)
    [tc.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'](tc.url)
    .set('Authorization', `Bearer ${tc.ownerToken}`)
    .send(tc.body);

  if (ownerResponse.status === 404) {
    throw new Error(`Owner got 404 on their own resource: ${tc.url} — seed data may be missing`);
  }

  // Attacker with different tenantId must receive 403, not 200 or 404
  const attackerResponse = await supertest(server)
    [tc.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'](tc.url)
    .set('Authorization', `Bearer ${tc.attackerToken}`)
    .send(tc.body);

  if (attackerResponse.status !== 403) {
    throw new Error(
      `TENANT BOUNDARY VIOLATION: ${tc.method} ${tc.url} ` +
        `returned ${attackerResponse.status} for attacker tenant ${tc.attackerTenantId}. ` +
        `Expected 403.`,
    );
  }

  const body = attackerResponse.body as { error?: { code?: string } };
  if (
    body.error?.code !== 'TENANT_BOUNDARY_VIOLATION' &&
    body.error?.code !== 'RBAC_INSUFFICIENT_ROLE'
  ) {
    throw new Error(
      `Expected TENANT_BOUNDARY_VIOLATION error code, got: ${body.error?.code ?? 'none'}`,
    );
  }
}
