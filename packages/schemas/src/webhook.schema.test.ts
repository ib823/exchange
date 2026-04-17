import { describe, it, expect } from 'vitest';
import { CreateWebhookSchema } from './webhook.schema';

const CUID = 'clxxxxxxxxxxxxxxxxxxxxxxxxx';
const validBase = {
  tenantId: CUID,
  url: 'https://partner.example.com/webhook',
  events: ['submission.completed'],
  secretRef: 'vault://webhooks/partner-x',
};

describe('CreateWebhookSchema', () => {
  it('accepts a valid webhook registration', () => {
    expect(CreateWebhookSchema.safeParse(validBase).success).toBe(true);
  });

  it('rejects a non-URL endpoint', () => {
    expect(CreateWebhookSchema.safeParse({ ...validBase, url: 'not-a-url' }).success).toBe(false);
  });

  it('rejects an empty events array', () => {
    expect(CreateWebhookSchema.safeParse({ ...validBase, events: [] }).success).toBe(false);
  });

  it('rejects a secretRef longer than 500 chars', () => {
    expect(
      CreateWebhookSchema.safeParse({ ...validBase, secretRef: 'x'.repeat(501) }).success,
    ).toBe(false);
  });

  it('rejects a non-CUID tenantId', () => {
    expect(CreateWebhookSchema.safeParse({ ...validBase, tenantId: 'not-a-cuid' }).success).toBe(
      false,
    );
  });
});
