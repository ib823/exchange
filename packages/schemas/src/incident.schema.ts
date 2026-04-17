import { z } from 'zod';
import { CuidSchema } from './shared.schema';

export const IncidentSeveritySchema = z.enum(['P1', 'P2', 'P3', 'P4']);
export const IncidentStateSchema = z.enum([
  'OPEN',
  'TRIAGED',
  'IN_PROGRESS',
  'WAITING_EXTERNAL',
  'RESOLVED',
  'CLOSED',
]);

export const CreateIncidentSchema = z.object({
  tenantId: CuidSchema,
  severity: IncidentSeveritySchema,
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  sourceType: z.string().min(1).max(100),
  sourceId: z.string().max(200).optional(),
  assignedTo: CuidSchema.optional(),
});

export const UpdateIncidentSchema = z.object({
  severity: IncidentSeveritySchema.optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  assignedTo: CuidSchema.optional(),
  state: IncidentStateSchema.optional(),
  resolution: z.string().max(5000).optional(),
});

export type CreateIncidentDto = z.infer<typeof CreateIncidentSchema>;
export type UpdateIncidentDto = z.infer<typeof UpdateIncidentSchema>;
