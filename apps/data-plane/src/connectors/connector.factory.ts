/**
 * Connector factory — explicit switch on transport protocol.
 *
 * Adding a new protocol MUST cause a compile failure until a connector is registered.
 * Never assertion on default guarantees exhaustiveness.
 */

import { SepError, ErrorCode } from '@sep/common';
import type { ITransportConnector } from './connector.interface';
import { SftpConnector } from './sftp.connector';
import { HttpsConnector } from './https.connector';

export type TransportProtocol = 'SFTP' | 'HTTPS' | 'AS2';

const sftpConnector = new SftpConnector();
const httpsConnector = new HttpsConnector();

export function getConnector(protocol: TransportProtocol): ITransportConnector {
  switch (protocol) {
    case 'SFTP':
      return sftpConnector;
    case 'HTTPS':
      return httpsConnector;
    case 'AS2':
      throw new SepError(ErrorCode.TRANSPORT_UNSUPPORTED_PROTOCOL, {
        message: 'AS2 transport is not yet implemented',
      });
    default: {
      const _exhaustive: never = protocol;
      throw new SepError(ErrorCode.TRANSPORT_UNSUPPORTED_PROTOCOL, {
        message: `Unknown transport protocol: ${String(_exhaustive)}`,
      });
    }
  }
}
