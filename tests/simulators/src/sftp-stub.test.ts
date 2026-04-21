import { describe, it, expect } from 'vitest';
import SftpClient from 'ssh2-sftp-client';
import { startSftpStub } from './sftp-stub';

describe('sftp-stub', () => {
  it('binds on a random ephemeral port on 127.0.0.1', async () => {
    const stub = await startSftpStub();
    try {
      expect(stub.port).toBeGreaterThan(0);
      expect(stub.port).toBeLessThan(65_536);
    } finally {
      await stub.close();
    }
  });

  it('captures an uploaded file under its remote path', async () => {
    const stub = await startSftpStub();
    const client = new SftpClient();
    try {
      await client.connect({
        host: '127.0.0.1',
        port: stub.port,
        username: 'any',
        password: 'any',
        // Skip host-key checks — the stub rotates keys per start.
        readyTimeout: 5_000,
      });
      const payload = Buffer.from('hello partner');
      await client.put(payload, '/incoming/message.dat');
      expect(stub.uploads.get('/incoming/message.dat')?.toString()).toBe('hello partner');
    } finally {
      await client.end().catch(() => undefined);
      await stub.close();
    }
  });
});
