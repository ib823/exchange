import { z } from 'zod';
import { CuidSchema, RoleSchema } from './shared.schema';

export const AuditEventResponseSchema = z.object({
  id: CuidSchema,
  tenantId: CuidSchema,
  actorType: z.enum(['USER', 'SYSTEM', 'SERVICE', 'SCHEDULER']),
  actorId: z.string(),
  actorRole: RoleSchema.nullable(),
  objectType: z.string(),
  objectId: z.string(),
  action: z.string(),
  result: z.enum(['SUCCESS', 'FAILURE']),
  correlationId: z.string().nullable(),
  eventTime: z.date().or(z.string()),
  immutableHash: z.string(),
  metadata: z.record(z.unknown()).nullable(),
});

export const AuditSearchSchema = z.object({
  objectType: z.string().optional(),
  objectId: z.string().optional(),
  action: z.string().optional(),
  actorId: z.string().optional(),
  correlationId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type AuditEventResponse = z.infer<typeof AuditEventResponseSchema>;
export type AuditSearchDto = z.infer<typeof AuditSearchSchema>;
