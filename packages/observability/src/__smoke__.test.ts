// M3.0 §18 handoff check: confirm the OTEL cluster loads.
// All OTEL packages are install-only in M3.0; wiring happens in M3.
// See apps/control-plane/src/__smoke__.test.ts for rationale.
import { describe, it, expect } from 'vitest';

const TIMEOUT = 30_000;

describe('M3.0 install smoke — @sep/observability OTEL cluster', () => {
  it(
    'imports @opentelemetry/api',
    async () => {
      const mod = await import('@opentelemetry/api');
      expect(typeof mod.trace).toBe('object');
      expect(typeof mod.context).toBe('object');
    },
    TIMEOUT,
  );

  it(
    'imports @opentelemetry/sdk-node',
    async () => {
      const mod = await import('@opentelemetry/sdk-node');
      expect(typeof mod.NodeSDK).toBe('function');
    },
    TIMEOUT,
  );

  it(
    'imports @opentelemetry/auto-instrumentations-node',
    async () => {
      const mod = await import('@opentelemetry/auto-instrumentations-node');
      expect(typeof mod.getNodeAutoInstrumentations).toBe('function');
    },
    TIMEOUT,
  );

  it(
    'imports @opentelemetry/exporter-trace-otlp-proto',
    async () => {
      const mod = await import('@opentelemetry/exporter-trace-otlp-proto');
      expect(typeof mod.OTLPTraceExporter).toBe('function');
    },
    TIMEOUT,
  );

  it(
    'imports @opentelemetry/exporter-metrics-otlp-proto',
    async () => {
      const mod = await import('@opentelemetry/exporter-metrics-otlp-proto');
      expect(typeof mod.OTLPMetricExporter).toBe('function');
    },
    TIMEOUT,
  );

  it(
    'imports @opentelemetry/resources',
    async () => {
      const mod = await import('@opentelemetry/resources');
      // v2.x uses resourceFromAttributes; older versions used Resource class.
      expect(mod).toBeTruthy();
    },
    TIMEOUT,
  );

  it(
    'imports @opentelemetry/semantic-conventions',
    async () => {
      const mod = await import('@opentelemetry/semantic-conventions');
      // v1.40 exports ATTR_* constants; older versions used SEMRESATTRS_*.
      expect(mod).toBeTruthy();
    },
    TIMEOUT,
  );
});
