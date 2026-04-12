import { z } from 'zod';
import { CuidSchema, IdempotencyKeySchema, SubmissionStatusSchema } from './shared.schema';

export const CreateSubmissionSchema = z.object({
  tenantId: CuidSchema,
  partnerProfileId: CuidSchema,
  sourceSystemId: CuidSchema.optional(),
  exchangeProfileId: CuidSchema.optional(),
  contentType: z.string().min(1).max(100),
  idempotencyKey: IdempotencyKeySchema,
  payloadRef: z.string().min(1).max(500).optional(),
  normalizedHash: z.string().length(64).optional(),
  payloadSize: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const SubmissionResponseSchema = z.object({
  submissionId: CuidSchema,
  correlationId: z.string(),
  tenantId: CuidSchema,
  status: SubmissionStatusSchema,
  createdAt: z.date().or(z.string()),
});

export const TimelineEventSchema = z.object({
  eventId: CuidSchema,
  action: z.string(),
  actorType: z.string(),
  actorId: z.string(),
  result: z.string(),
  eventTime: z.date().or(z.string()),
  correlationId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateSubmissionDto = z.infer<typeof CreateSubmissionSchema>;
export type SubmissionResponse = z.infer<typeof SubmissionResponseSchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
