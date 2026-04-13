import { describe, it, expect } from 'vitest';
import { CreateSubmissionSchema, createSubmissionSchema, DEFAULT_MAX_PAYLOAD_SIZE_BYTES } from './submission.schema';

const validSubmission = {
  tenantId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
  partnerProfileId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
  contentType: 'application/json',
  idempotencyKey: 'idem-abc-123-def-456',
};

describe('CreateSubmissionSchema', () => {
  it('accepts a valid submission without payloadSize', () => {
    const result = CreateSubmissionSchema.safeParse(validSubmission);
    expect(result.success).toBe(true);
  });

  it('accepts payloadSize within ceiling', () => {
    const result = CreateSubmissionSchema.safeParse({
      ...validSubmission,
      payloadSize: 1024,
    });
    expect(result.success).toBe(true);
  });

  it('accepts payloadSize at exactly the ceiling', () => {
    const result = CreateSubmissionSchema.safeParse({
      ...validSubmission,
      payloadSize: DEFAULT_MAX_PAYLOAD_SIZE_BYTES,
    });
    expect(result.success).toBe(true);
  });

  it('rejects payloadSize above the default ceiling (50MB + 1)', () => {
    const result = CreateSubmissionSchema.safeParse({
      ...validSubmission,
      payloadSize: DEFAULT_MAX_PAYLOAD_SIZE_BYTES + 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue?.path).toContain('payloadSize');
      expect(issue?.code).toBe('too_big');
    }
  });

  it('rejects excessively large payloadSize (5GB)', () => {
    const result = CreateSubmissionSchema.safeParse({
      ...validSubmission,
      payloadSize: 5_368_709_120,
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero payloadSize (must be positive)', () => {
    const result = CreateSubmissionSchema.safeParse({
      ...validSubmission,
      payloadSize: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative payloadSize', () => {
    const result = CreateSubmissionSchema.safeParse({
      ...validSubmission,
      payloadSize: -100,
    });
    expect(result.success).toBe(false);
  });
});

describe('createSubmissionSchema (custom ceiling)', () => {
  it('enforces a custom ceiling smaller than default', () => {
    const schema = createSubmissionSchema(1_048_576); // 1MB
    const result = schema.safeParse({
      ...validSubmission,
      payloadSize: 1_048_577, // 1MB + 1
    });
    expect(result.success).toBe(false);
  });

  it('accepts payloadSize within custom ceiling', () => {
    const schema = createSubmissionSchema(1_048_576); // 1MB
    const result = schema.safeParse({
      ...validSubmission,
      payloadSize: 1_048_576,
    });
    expect(result.success).toBe(true);
  });
});
