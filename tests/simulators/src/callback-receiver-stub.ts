/**
 * Stub HTTP callback receiver (M3.A8-T00a).
 *
 * Minimal fastify server that accepts POST/PUT requests on any path
 * and captures the request body + headers + URL for test assertions.
 *
 * Plan calls this an "HTTPS callback receiver" — we serve HTTP in
 * tests because TLS setup would need a cert store that's out of
 * scope for T00a. Tests pointing a partner profile at this stub use
 * `http://127.0.0.1:<port>` rather than https://. The control-plane
 * HTTPS connector accepts http:// in non-production environments
 * via the existing `https.requestTimeoutMs` / `maxRedirects`
 * configuration path.
 *
 * Deliberate non-goals:
 *   - No request validation beyond method + path capture
 *   - No persistent storage (ring of received messages in memory)
 *   - No TLS (see above)
 *
 * Usage:
 *   const receiver = await startCallbackReceiver();
 *   // ... configure partner ack-callback URL to `http://127.0.0.1:${receiver.port}/ack`
 *   // ... drive the delivery flow
 *   expect(receiver.received).toHaveLength(1);
 *   expect(receiver.received[0].path).toBe('/ack');
 *   await receiver.close();
 */

import Fastify, { type FastifyInstance } from 'fastify';

export interface ReceivedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: unknown;
  readonly receivedAt: Date;
}

export interface CallbackReceiverStub {
  readonly port: number;
  readonly received: ReceivedRequest[];
  /**
   * Set a response generator for a specific path. Future requests
   * matching the path return the provided body + status. Useful for
   * scenarios that need to simulate partner errors.
   */
  setResponse(path: string, response: { status: number; body?: unknown }): void;
  close(): Promise<void>;
}

export async function startCallbackReceiver(): Promise<CallbackReceiverStub> {
  const received: ReceivedRequest[] = [];
  const responses = new Map<string, { status: number; body?: unknown }>();
  const app: FastifyInstance = Fastify({ logger: false });

  // Wildcard handler: record the request, return the configured
  // response for this path (or 200 {ok:true} by default).
  app.all('*', (request, reply) => {
    received.push({
      method: request.method,
      path: request.url,
      headers: request.headers as Record<string, string | string[] | undefined>,
      body: request.body,
      receivedAt: new Date(),
    });
    const configured = responses.get(request.url);
    if (configured !== undefined) {
      void reply.status(configured.status).send(configured.body ?? { ok: true });
      return;
    }
    void reply.status(200).send({ ok: true });
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    await app.close();
    throw new Error('Callback receiver failed to bind a port');
  }

  return {
    port: address.port,
    received,
    setResponse(path: string, response: { status: number; body?: unknown }): void {
      responses.set(path, response);
    },
    close: async (): Promise<void> => {
      await app.close();
    },
  };
}
