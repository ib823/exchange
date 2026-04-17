import { z } from 'zod';
import {
  CuidSchema,
  EnvironmentSchema,
  PartnerTypeSchema,
  TransportProtocolSchema,
  MessageSecurityModeSchema,
  PartnerProfileStatusSchema,
} from './shared.schema';

export const SftpConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1),
  hostKeyFingerprint: z.string().min(1),
  uploadPath: z.string().min(1),
  downloadPath: z.string().min(1),
  privateKeyRef: z.string().optional(),
});

export const HttpsConfigSchema = z.object({
  baseUrl: z.string().url(),
  authType: z.enum(['bearer', 'apiKey', 'mtls', 'none']),
  credentialRef: z.string().optional(),
  certRef: z.string().optional(),
  keyRef: z.string().optional(),
  headers: z.record(z.string()).optional(),
  timeoutMs: z.number().int().positive().default(30000),
});

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(0).max(10).default(3),
  backoffDelayMs: z.number().int().positive().default(5000),
  backoffMultiplier: z.number().min(1).max(5).default(2),
});

export const CreatePartnerProfileSchema = z.object({
  tenantId: CuidSchema,
  name: z.string().min(2).max(200),
  partnerType: PartnerTypeSchema,
  environment: EnvironmentSchema,
  transportProtocol: TransportProtocolSchema,
  messageSecurityMode: MessageSecurityModeSchema.default('NONE'),
  config: z.object({
    sftp: SftpConfigSchema.optional(),
    https: HttpsConfigSchema.optional(),
    retryPolicy: RetryPolicySchema.optional(),
  }),
  notes: z.string().max(2000).optional(),
  effectiveDate: z.string().datetime().optional(),
  expiryDate: z.string().datetime().optional(),
});

export const UpdatePartnerProfileSchema = CreatePartnerProfileSchema.omit({
  tenantId: true,
  environment: true,
}).partial();

export const PartnerProfileResponseSchema = z.object({
  id: CuidSchema,
  tenantId: CuidSchema,
  name: z.string(),
  partnerType: PartnerTypeSchema,
  environment: EnvironmentSchema,
  status: PartnerProfileStatusSchema,
  transportProtocol: TransportProtocolSchema,
  messageSecurityMode: MessageSecurityModeSchema,
  version: z.number(),
  createdAt: z.date().or(z.string()),
  updatedAt: z.date().or(z.string()),
});

export const TransitionPartnerProfileSchema = z.object({
  targetStatus: PartnerProfileStatusSchema,
});

export type CreatePartnerProfileDto = z.infer<typeof CreatePartnerProfileSchema>;
export type UpdatePartnerProfileDto = z.infer<typeof UpdatePartnerProfileSchema>;
export type TransitionPartnerProfileDto = z.infer<typeof TransitionPartnerProfileSchema>;
export type PartnerProfileResponse = z.infer<typeof PartnerProfileResponseSchema>;
