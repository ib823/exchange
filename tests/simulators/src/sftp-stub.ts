/**
 * Stub SFTP server (M3.A8-T00a).
 *
 * Minimal ssh2-based SFTP server for testing the outbound delivery
 * path. Listens on 127.0.0.1 on an ephemeral port, accepts any
 * username/password, captures uploads to an in-memory map, and
 * exposes them for test assertions.
 *
 * Deliberate non-goals:
 *   - No real crypto hardening (it's a test double)
 *   - No TLS / strict host-key handling (ssh2 issues an ephemeral
 *     host key each start)
 *   - No persistence across `close()` — all state is ephemeral
 *
 * Usage:
 *   const sftp = await startSftpStub();
 *   // ... configure partner profile with host '127.0.0.1', port sftp.port
 *   // ... run the intake→delivery flow
 *   expect(sftp.uploads.get('/incoming/file.dat')).toBeDefined();
 *   await sftp.close();
 */

import { Server as Ssh2Server, utils as ssh2Utils, type AuthContext, type ServerChannel } from 'ssh2';

export interface SftpStub {
  /** Listening port — pass to the connector as host port. */
  readonly port: number;
  /** Map of remote path → bytes received. */
  readonly uploads: Map<string, Buffer>;
  /** Stop the server. Safe to call multiple times. */
  close(): Promise<void>;
}

/**
 * Ephemeral RSA host key generated at startup. Each invocation
 * yields a different key; tests that pin host-key-fingerprints
 * must read the pin from this stub, not hard-code.
 */
function generateHostKey(): string {
  const { private: privKey } = ssh2Utils.generateKeyPairSync('ed25519');
  return privKey;
}

export async function startSftpStub(): Promise<SftpStub> {
  const uploads = new Map<string, Buffer>();
  const hostKey = generateHostKey();

  return new Promise<SftpStub>((resolve, reject) => {
    const server = new Ssh2Server(
      { hostKeys: [hostKey] },
      (client) => {
        client.on('authentication', (ctx: AuthContext) => ctx.accept());
        client.on('ready', () => {
          client.on('session', (accept) => {
            const session = accept();
            session.on('sftp', (acceptSftp) => {
              const sftp = acceptSftp();
              const openHandles = new Map<number, { path: string; chunks: Buffer[] }>();
              let nextHandle = 1;
              sftp.on('OPEN', (reqid, filename) => {
                const handle = nextHandle;
                nextHandle += 1;
                openHandles.set(handle, { path: filename, chunks: [] });
                const buf = Buffer.alloc(4);
                buf.writeUInt32BE(handle, 0);
                sftp.handle(reqid, buf);
              });
              sftp.on('WRITE', (reqid, handleBuf, _offset, data) => {
                const handle = handleBuf.readUInt32BE(0);
                const entry = openHandles.get(handle);
                if (entry !== undefined) {
                  entry.chunks.push(Buffer.from(data));
                }
                sftp.status(reqid, 0 /* OK */);
              });
              sftp.on('CLOSE', (reqid, handleBuf) => {
                const handle = handleBuf.readUInt32BE(0);
                const entry = openHandles.get(handle);
                if (entry !== undefined) {
                  uploads.set(entry.path, Buffer.concat(entry.chunks));
                  openHandles.delete(handle);
                }
                sftp.status(reqid, 0);
              });
            });
          });
        });
      },
    );
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('SFTP stub failed to bind a port'));
        return;
      }
      resolve({
        port: address.port,
        uploads,
        close: (): Promise<void> =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
    server.on('error', reject);
  });
}

/** Lower-level helper for scenarios that need to inspect raw command flow. */
export interface SftpStubWithHandler {
  readonly port: number;
  close(): Promise<void>;
  onChannel(fn: (channel: ServerChannel) => void): void;
}
