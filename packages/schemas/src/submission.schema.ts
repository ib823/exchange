import { z } from 'zod';
import { CuidSchema, IdempotencyKeySchema, SubmissionStatusSchema } from './shared.schema';

/** Default payload size ceiling — 50MB. Override via MAX_PAYLOAD_SIZE_BYTES env var. */
export const DEFAULT_MAX_PAYLOAD_SIZE_BYTES = 52_428_800;

/**
 * Creates a CreateSubmissionSchema with a configurable payload size ceiling.
 * The ceiling is enforced at schema validation time — before the submission
 * record is created — to prevent oversized work from entering the queue.
 */
export function createSubmissionSchema(
  maxPayloadSizeBytes: number = DEFAULT_MAX_PAYLOAD_SIZE_BYTES,
): z.ZodObject<{
  tenantId: typeof CuidSchema;
  partnerProfileId: typeof CuidSchema;
  sourceSystemId: ReturnType<typeof CuidSchema.optional>;
  exchangeProfileId: ReturnType<typeof CuidSchema.optional>;
  contentType: z.ZodString;
  idempotencyKey: typeof IdempotencyKeySchema;
  payloadRef: z.ZodOptional<z.ZodString>;
  normalizedHash: z.ZodOptional<z.ZodString>;
  payloadSize: z.ZodOptional<z.ZodNumber>;
  metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}> {
  return z.object({
    tenantId: CuidSchema,
    partnerProfileId: CuidSchema,
    sourceSystemId: CuidSchema.optional(),
    exchangeProfileId: CuidSchema.optional(),
    contentType: z.string().min(1).max(100),
    idempotencyKey: IdempotencyKeySchema,
    payloadRef: z.string().min(1).max(500).optional(),
    normalizedHash: z.string().length(64).optional(),
    payloadSize: z
      .number()
      .int()
      .positive()
      .max(maxPayloadSizeBytes, {
        message: `Payload size exceeds maximum of ${maxPayloadSizeBytes} bytes`,
      })
      .optional(),
    metadata: z.record(z.unknown()).optional(),
  });
}

/** Default schema with 50MB ceiling — use createSubmissionSchema() for custom limits */
export const CreateSubmissionSchema = createSubmissionSchema(DEFAULT_MAX_PAYLOAD_SIZE_BYTES);

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
