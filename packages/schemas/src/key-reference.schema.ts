import { z } from 'zod';
import { CuidSchema, EnvironmentSchema, KeyStateSchema } from './shared.schema';

export const KeyUsageSchema = z.enum(['ENCRYPT','DECRYPT','SIGN','VERIFY','WRAP','UNWRAP']);
export const KeyBackendTypeSchema = z.enum([
  'PLATFORM_VAULT','TENANT_VAULT','EXTERNAL_KMS','SOFTWARE_LOCAL',
]);

export const CreateKeyReferenceSchema = z.object({
  tenantId: CuidSchema,
  partnerProfileId: CuidSchema.optional(),
  name: z.string().min(2).max(200),
  usage: z.array(KeyUsageSchema).min(1),
  backendType: KeyBackendTypeSchema,
  backendRef: z.string().min(1).max(500),
  fingerprint: z.string().min(8).max(128),
  algorithm: z.string().min(1).max(50),
  environment: EnvironmentSchema,
  expiresAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const KeyReferenceResponseSchema = z.object({
  id: CuidSchema,
  tenantId: CuidSchema,
  name: z.string(),
  usage: z.array(KeyUsageSchema),
  backendType: KeyBackendTypeSchema,
  fingerprint: z.string(),
  algorithm: z.string(),
  version: z.number(),
  state: KeyStateSchema,
  environment: EnvironmentSchema,
  activatedAt: z.date().or(z.string()).nullable(),
  expiresAt: z.date().or(z.string()).nullable(),
  createdAt: z.date().or(z.string()),
});

export type CreateKeyReferenceDto = z.infer<typeof CreateKeyReferenceSchema>;
export type KeyReferenceResponse = z.infer<typeof KeyReferenceResponseSchema>;
