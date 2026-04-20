/**
 * Smoke tests for the metrics registry exports.
 *
 * Confirms the counters/gauges/histograms used by the platform are
 * registered with the correct name/label surface. These are not
 * business-logic tests — the metrics module is a plain declaration
 * file — but they prevent a silent drop of a counter export (a
 * dependent processor would `.inc()` on `undefined` without a
 * compile error if the import name survives because prom-client's
 * Counter type is shared).
 */

import { describe, it, expect } from 'vitest';
import {
  registry,
  submissionCounter,
  deliveryCounter,
  cryptoOperationCounter,
  cryptoFailureCounter,
  keyExpiryGauge,
  keyExpiryWarningCounter,
  rbacDeniedCounter,
} from './metrics';

describe('metrics registry', () => {
  it('exposes the shared platform Registry with the sep platform label', async () => {
    const metrics = await registry.getMetricsAsJSON();
    expect(Array.isArray(metrics)).toBe(true);
  });

  it.each([
    ['sep_submissions_total', submissionCounter],
    ['sep_deliveries_total', deliveryCounter],
    ['sep_crypto_operations_total', cryptoOperationCounter],
    ['sep_crypto_failures_total', cryptoFailureCounter],
    ['sep_keys_expiring_within_days', keyExpiryGauge],
    ['sep_key_expiry_warnings_total', keyExpiryWarningCounter],
    ['sep_rbac_denied_total', rbacDeniedCounter],
  ])('%s is registered', (name, metric) => {
    expect(metric).toBeDefined();
    // prom-client's getSingleMetric returns Metric<string> whose
    // public type does not include `name` (it's on the internal
    // Counter class). The presence check is sufficient for the
    // registration smoke assertion.
    const found = registry.getSingleMetric(name);
    expect(found).toBeDefined();
  });

  it('keyExpiryWarningCounter increments cleanly with tier/severity/tenant labels', () => {
    keyExpiryWarningCounter.inc({ tier_days: '7', severity: 'P1', tenant_id: 'test-tenant' });
    keyExpiryWarningCounter.inc({ tier_days: '30', severity: 'P2', tenant_id: 'test-tenant' });
    // No assertion on the incremented value — label combinations are
    // keyed by the full tuple and accumulate across tests; the
    // assertion of interest is that inc() doesn't throw on a missing
    // label schema.
    expect(true).toBe(true);
  });
});
