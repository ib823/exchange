import { describe, it, expect } from 'vitest';
import { CreateIncidentSchema, UpdateIncidentSchema } from './incident.schema';

const CUID = 'clxxxxxxxxxxxxxxxxxxxxxxxxx';
const validCreate = {
  tenantId: CUID,
  severity: 'P1' as const,
  title: 'Outbound delivery stuck in PROCESSING',
  sourceType: 'submission',
};

describe('CreateIncidentSchema', () => {
  it('accepts a minimal valid incident', () => {
    expect(CreateIncidentSchema.safeParse(validCreate).success).toBe(true);
  });

  it('accepts optional description, sourceId, assignedTo', () => {
    const result = CreateIncidentSchema.safeParse({
      ...validCreate,
      description: 'context',
      sourceId: 'sub-123',
      assignedTo: CUID,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown severity', () => {
    expect(CreateIncidentSchema.safeParse({ ...validCreate, severity: 'CRITICAL' }).success).toBe(
      false,
    );
  });

  it('rejects title shorter than 1 character', () => {
    expect(CreateIncidentSchema.safeParse({ ...validCreate, title: '' }).success).toBe(false);
  });

  it('rejects non-CUID tenantId', () => {
    expect(CreateIncidentSchema.safeParse({ ...validCreate, tenantId: 'not-a-cuid' }).success).toBe(
      false,
    );
  });
});

describe('UpdateIncidentSchema', () => {
  it('accepts partial updates (all fields optional)', () => {
    expect(UpdateIncidentSchema.safeParse({}).success).toBe(true);
    expect(UpdateIncidentSchema.safeParse({ state: 'TRIAGED' }).success).toBe(true);
    expect(UpdateIncidentSchema.safeParse({ severity: 'P3', resolution: 'fixed' }).success).toBe(
      true,
    );
  });

  it('rejects an invalid state transition value', () => {
    expect(UpdateIncidentSchema.safeParse({ state: 'DONE' }).success).toBe(false);
  });
});
