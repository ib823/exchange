/**
 * Tenant boundary test helper (M3.A8-T00b — lint debt closure for issue #8).
 *
 * Use in every integration test that exercises a controller method.
 * Verifies that accessing a resource with a mismatched tenantId returns 403,
 * not 200 or 404. A 404 on cross-tenant access would reveal resource existence.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Response as SupertestResponse } from 'supertest';

export interface TenantBoundaryCase {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  ownerTenantId: string;
  ownerToken: string;
  attackerTenantId: string;
  attackerToken: string;
  body?: Record<string, unknown>;
}

/** Narrow shape we care about in the 403 body. */
interface SepErrorResponseBody {
  readonly error?: {
    readonly code?: string;
  };
}

/** supertest's `.get/.post/.patch/.delete` signatures — keep typed. */
type SupertestMethod = 'get' | 'post' | 'patch' | 'delete';

function toSupertestMethod(m: TenantBoundaryCase['method']): SupertestMethod {
  return m.toLowerCase() as SupertestMethod;
}

export async function assertTenantBoundaryEnforced(
  app: NestFastifyApplication,
  tc: TenantBoundaryCase,
): Promise<void> {
  const supertestMod = await import('supertest');
  const supertest = supertestMod.default;
  const server = app.getHttpServer() as unknown as Parameters<typeof supertest>[0];
  const method = toSupertestMethod(tc.method);

  // Owner must be able to access their own resource
  const ownerResponse: SupertestResponse = await supertest(server)
    [method](tc.url)
    .set('Authorization', `Bearer ${tc.ownerToken}`)
    .send(tc.body);

  if (ownerResponse.status === 404) {
    throw new Error(`Owner got 404 on their own resource: ${tc.url} — seed data may be missing`);
  }

  // Attacker with different tenantId must receive 403, not 200 or 404
  const attackerResponse: SupertestResponse = await supertest(server)
    [method](tc.url)
    .set('Authorization', `Bearer ${tc.attackerToken}`)
    .send(tc.body);

  if (attackerResponse.status !== 403) {
    throw new Error(
      `TENANT BOUNDARY VIOLATION: ${tc.method} ${tc.url} ` +
        `returned ${String(attackerResponse.status)} for attacker tenant ${tc.attackerTenantId}. ` +
        `Expected 403.`,
    );
  }

  const body = attackerResponse.body as SepErrorResponseBody;
  const code = body.error?.code;
  if (code !== 'TENANT_BOUNDARY_VIOLATION' && code !== 'RBAC_INSUFFICIENT_ROLE') {
    throw new Error(`Expected TENANT_BOUNDARY_VIOLATION error code, got: ${code ?? 'none'}`);
  }
}
