/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/explicit-function-return-type */
import { describe, it, expect, vi } from 'vitest';
import { ErrorCode } from '@sep/common';
import { getConnector } from './connector.factory';
import { SftpConnector } from './sftp.connector';
import { HttpsConnector } from './https.connector';

vi.mock('@sep/observability', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@sep/common', async () => {
  const actual = await vi.importActual<typeof import('@sep/common')>('@sep/common');
  return {
    ...actual,
    getConfig: () => ({
      sftp: { connectTimeoutMs: 30000, operationTimeoutMs: 60000 },
      https: { requestTimeoutMs: 30000, maxRedirects: 0 },
    }),
  };
});

describe('ConnectorFactory', () => {
  it('returns SftpConnector for SFTP', () => {
    const connector = getConnector('SFTP');
    expect(connector).toBeInstanceOf(SftpConnector);
  });

  it('returns HttpsConnector for HTTPS', () => {
    const connector = getConnector('HTTPS');
    expect(connector).toBeInstanceOf(HttpsConnector);
  });

  it('throws TRANSPORT_UNSUPPORTED_PROTOCOL for AS2', () => {
    expect(() => getConnector('AS2'))
      .toThrow(expect.objectContaining({ code: ErrorCode.TRANSPORT_UNSUPPORTED_PROTOCOL }));
  });
});
