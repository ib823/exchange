import { z } from 'zod';

export const ApproveRequestSchema = z.object({
  notes: z.string().max(5000).optional(),
});

export const RejectRequestSchema = z.object({
  notes: z.string().max(5000).optional(),
});

export type ApproveRequestDto = z.infer<typeof ApproveRequestSchema>;
export type RejectRequestDto = z.infer<typeof RejectRequestSchema>;
