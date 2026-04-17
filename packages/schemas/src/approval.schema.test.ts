import { describe, it, expect } from 'vitest';
import { ApproveRequestSchema, RejectRequestSchema } from './approval.schema';

describe('ApproveRequestSchema', () => {
  it('accepts an empty body', () => {
    expect(ApproveRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a notes string', () => {
    expect(ApproveRequestSchema.safeParse({ notes: 'LGTM' }).success).toBe(true);
  });

  it('rejects notes exceeding 5000 characters', () => {
    expect(ApproveRequestSchema.safeParse({ notes: 'x'.repeat(5001) }).success).toBe(false);
  });

  it('rejects non-string notes', () => {
    expect(ApproveRequestSchema.safeParse({ notes: 42 }).success).toBe(false);
  });
});

describe('RejectRequestSchema', () => {
  it('accepts an empty body', () => {
    expect(RejectRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a notes string', () => {
    expect(RejectRequestSchema.safeParse({ notes: 'missing evidence' }).success).toBe(true);
  });

  it('rejects notes exceeding 5000 characters', () => {
    expect(RejectRequestSchema.safeParse({ notes: 'x'.repeat(5001) }).success).toBe(false);
  });
});
