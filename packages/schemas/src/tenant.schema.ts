import { z } from 'zod';
import { CuidSchema, ServiceTierSchema } from './shared.schema';

export const CreateTenantSchema = z.object({
  name: z.string().min(2).max(120),
  legalEntityName: z.string().min(2).max(200),
  serviceTier: ServiceTierSchema.default('STANDARD'),
  defaultRegion: z.string().default('ap-southeast-1'),
  metadata: z.record(z.unknown()).optional(),
});

export const UpdateTenantSchema = CreateTenantSchema.partial();

export const TenantResponseSchema = z.object({
  id: CuidSchema,
  name: z.string(),
  legalEntityName: z.string(),
  status: z.string(),
  serviceTier: ServiceTierSchema,
  defaultRegion: z.string(),
  createdAt: z.date().or(z.string()),
  updatedAt: z.date().or(z.string()),
});

export type CreateTenantDto = z.infer<typeof CreateTenantSchema>;
export type UpdateTenantDto = z.infer<typeof UpdateTenantSchema>;
export type TenantResponse = z.infer<typeof TenantResponseSchema>;
