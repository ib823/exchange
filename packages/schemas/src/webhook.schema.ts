import { z } from 'zod';
import { CuidSchema } from './shared.schema';

export const CreateWebhookSchema = z.object({
  tenantId: CuidSchema,
  url: z.string().url(),
  events: z.array(z.string().min(1)).min(1),
  secretRef: z.string().min(1).max(500),
});

export type CreateWebhookDto = z.infer<typeof CreateWebhookSchema>;
