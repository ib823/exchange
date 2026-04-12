import { describe, it, expect } from 'vitest';
import { QUEUES, DLQ_SUFFIX, dlqName, DEFAULT_JOB_OPTIONS, type QueueName } from './queue.definitions';

describe('queue.definitions', () => {
  it('defines all 9 required queues', () => {
    expect(Object.keys(QUEUES)).toHaveLength(9);
    expect(QUEUES.SUBMISSION_ACCEPTED).toBe('submission.accepted');
    expect(QUEUES.DELIVERY_REQUESTED).toBe('delivery.requested');
    expect(QUEUES.DELIVERY_COMPLETED).toBe('delivery.completed');
    expect(QUEUES.DELIVERY_FAILED).toBe('delivery.failed');
    expect(QUEUES.INBOUND_RECEIVED).toBe('inbound.received');
    expect(QUEUES.STATUS_NORMALIZED).toBe('status.normalized');
    expect(QUEUES.INCIDENT_CREATED).toBe('incident.created');
    expect(QUEUES.KEY_ROTATION_PENDING).toBe('key.rotation.pending');
    expect(QUEUES.KEY_ROTATION_COMPLETED).toBe('key.rotation.completed');
  });

  it('queue names are unique', () => {
    const values = Object.values(QUEUES);
    expect(new Set(values).size).toBe(values.length);
  });

  it('queue names use dot notation', () => {
    for (const name of Object.values(QUEUES)) {
      expect(name).toMatch(/^[a-z]+(\.[a-z]+)+$/);
    }
  });

  it('dlqName appends DLQ_SUFFIX', () => {
    const name = QUEUES.SUBMISSION_ACCEPTED;
    expect(dlqName(name)).toBe(`${name}${DLQ_SUFFIX}`);
    expect(dlqName(name)).toBe('submission.accepted.dlq');
  });

  it('DLQ_SUFFIX is .dlq', () => {
    expect(DLQ_SUFFIX).toBe('.dlq');
  });

  it('DEFAULT_JOB_OPTIONS has correct retry settings', () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
    expect(DEFAULT_JOB_OPTIONS.backoff.type).toBe('exponential');
    expect(DEFAULT_JOB_OPTIONS.backoff.delay).toBe(5000);
  });

  it('DEFAULT_JOB_OPTIONS keeps failed jobs for inspection', () => {
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toBe(false);
  });

  it('QueueName type covers all queue values', () => {
    const allQueues: QueueName[] = Object.values(QUEUES);
    expect(allQueues).toHaveLength(9);
  });
});
