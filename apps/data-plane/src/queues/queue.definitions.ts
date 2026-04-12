// Queue names — single source of truth. Import from here, never hardcode strings.
export const QUEUES = {
  SUBMISSION_ACCEPTED: 'submission.accepted',
  DELIVERY_REQUESTED: 'delivery.requested',
  DELIVERY_COMPLETED: 'delivery.completed',
  DELIVERY_FAILED: 'delivery.failed',
  INBOUND_RECEIVED: 'inbound.received',
  STATUS_NORMALIZED: 'status.normalized',
  INCIDENT_CREATED: 'incident.created',
  KEY_ROTATION_PENDING: 'key.rotation.pending',
  KEY_ROTATION_COMPLETED: 'key.rotation.completed',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// Dead-letter queue suffix convention
export const DLQ_SUFFIX = '.dlq';
export const dlqName = (queue: QueueName): string => `${queue}${DLQ_SUFFIX}`;

// Default job options — override per profile
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: false,   // Keep failed jobs for inspection
};
