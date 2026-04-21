import { describe, it, expect } from 'vitest';
import { startCallbackReceiver } from './callback-receiver-stub';

describe('callback-receiver-stub', () => {
  it('binds on a random ephemeral port on 127.0.0.1', async () => {
    const recv = await startCallbackReceiver();
    try {
      expect(recv.port).toBeGreaterThan(0);
      expect(recv.port).toBeLessThan(65_536);
    } finally {
      await recv.close();
    }
  });

  it('records POST requests with method / path / body / headers', async () => {
    const recv = await startCallbackReceiver();
    try {
      const url = `http://127.0.0.1:${String(recv.port)}/ack/callback-123`;
      const payload = { status: 'RECEIVED', correlationId: 'corr-1' };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-trace-id': 't-1' },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(200);
      expect(recv.received).toHaveLength(1);
      const first = recv.received[0];
      expect(first).toBeDefined();
      if (first !== undefined) {
        expect(first.method).toBe('POST');
        expect(first.path).toBe('/ack/callback-123');
        expect(first.body).toEqual(payload);
        expect(first.headers['x-trace-id']).toBe('t-1');
      }
    } finally {
      await recv.close();
    }
  });

  it('setResponse() overrides the default 200 reply', async () => {
    const recv = await startCallbackReceiver();
    try {
      recv.setResponse('/fail', { status: 503, body: { error: { code: 'PARTNER_DOWN' } } });
      const res = await fetch(`http://127.0.0.1:${String(recv.port)}/fail`, { method: 'POST' });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('PARTNER_DOWN');
    } finally {
      await recv.close();
    }
  });
});
