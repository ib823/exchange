/**
 * KeyBackendType enum — mirrors the Prisma enum but lives here so
 * packages/crypto stays free of direct @sep/db imports (crypto is
 * consumed by apps that own the DB client).
 *
 * Keep the literal union in lock-step with packages/db/prisma/schema.prisma
 * `enum KeyBackendType { … }`.
 */
export type KeyBackendType = 'PLATFORM_VAULT' | 'TENANT_VAULT' | 'EXTERNAL_KMS' | 'SOFTWARE_LOCAL';

export const KEY_BACKEND_TYPES: readonly KeyBackendType[] = [
  'PLATFORM_VAULT',
  'TENANT_VAULT',
  'EXTERNAL_KMS',
  'SOFTWARE_LOCAL',
] as const;
