import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
registry.setDefaultLabels({ platform: 'sep' });
collectDefaultMetrics({ register: registry });

// ── Submission metrics ─────────────────────────────────────────────────────────
export const submissionCounter = new Counter({
  name: 'sep_submissions_total',
  help: 'Total submissions received',
  labelNames: ['tenant_id', 'partner_profile_id', 'status', 'environment'],
  registers: [registry],
});

export const submissionProcessingDuration = new Histogram({
  name: 'sep_submission_processing_duration_seconds',
  help: 'End-to-end submission processing duration',
  labelNames: ['partner_profile_id', 'operation', 'environment'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [registry],
});

// ── Delivery metrics ───────────────────────────────────────────────────────────
export const deliveryCounter = new Counter({
  name: 'sep_deliveries_total',
  help: 'Total delivery attempts',
  labelNames: ['partner_profile_id', 'connector_type', 'result', 'environment'],
  registers: [registry],
});

export const deliveryRetryCounter = new Counter({
  name: 'sep_delivery_retries_total',
  help: 'Total delivery retries',
  labelNames: ['partner_profile_id', 'reason'],
  registers: [registry],
});

// ── Crypto metrics ─────────────────────────────────────────────────────────────
export const cryptoOperationCounter = new Counter({
  name: 'sep_crypto_operations_total',
  help: 'Total cryptographic operations',
  labelNames: ['operation', 'result'],
  registers: [registry],
});

export const cryptoFailureCounter = new Counter({
  name: 'sep_crypto_failures_total',
  help: 'Cryptographic operation failures',
  labelNames: ['operation', 'error_code'],
  registers: [registry],
});

// ── Queue metrics ──────────────────────────────────────────────────────────────
export const queueDepthGauge = new Gauge({
  name: 'sep_queue_depth',
  help: 'Current queue depth by queue name',
  labelNames: ['queue_name'],
  registers: [registry],
});

export const deadLetterQueueDepthGauge = new Gauge({
  name: 'sep_dead_letter_queue_depth',
  help: 'Dead-letter queue depth — requires immediate operator attention',
  labelNames: ['queue_name'],
  registers: [registry],
});

// ── Key lifecycle metrics ─────────────────────────────────────────────────────
export const keyExpiryGauge = new Gauge({
  name: 'sep_keys_expiring_within_days',
  help: 'Number of active keys expiring within threshold',
  labelNames: ['threshold_days', 'tenant_id'],
  registers: [registry],
});

/**
 * Fires once per (key, tier) the first time the expiry scanner raises
 * an incident for it. Tier label is the threshold in days (7, 30, 90),
 * severity label is the Incident severity assigned at that tier.
 */
export const keyExpiryWarningCounter = new Counter({
  name: 'sep_key_expiry_warnings_total',
  help: 'Key expiry warnings raised by the expiry scanner, bucketed by tier and severity',
  labelNames: ['tier_days', 'severity', 'tenant_id'],
  registers: [registry],
});

// ── RBAC metrics ──────────────────────────────────────────────────────────────
export const rbacDeniedCounter = new Counter({
  name: 'sep_rbac_denied_total',
  help: 'Total RBAC access denials',
  labelNames: ['role', 'action', 'resource'],
  registers: [registry],
});

// ── Webhook metrics ────────────────────────────────────────────────────────────
export const webhookDispatchCounter = new Counter({
  name: 'sep_webhook_dispatches_total',
  help: 'Total webhook dispatch attempts',
  labelNames: ['result'],
  registers: [registry],
});

export const apiRequestDuration = new Histogram({
  name: 'sep_api_request_duration_seconds',
  help: 'API request duration',
  labelNames: ['method', 'path', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});
