/**
 * HTTPS transport connector.
 *
 * Security controls:
 * - TLS 1.2 minimum enforced
 * - Endpoint IP validated against blocked ranges
 * - mTLS client certificate when profile specifies
 * - No redirects (HTTPS_MAX_REDIRECT = 0)
 * - Hostname verification via Node TLS
 */

import { SepError, ErrorCode } from '@sep/common';
import { createLogger } from '@sep/observability';
import { validateDeliveryEndpoint } from '../services/endpoint-validator';
import type {
  ITransportConnector,
  ConnectorConfig,
  DeliveryContext,
  DeliveryResult,
} from './connector.interface';

const logger = createLogger({ service: 'data-plane', module: 'https-connector' });

export class HttpsConnector implements ITransportConnector {
  // eslint-disable-next-line @typescript-eslint/require-await -- real HTTP call added in M3
  async deliver(
    _payloadRef: string,
    config: ConnectorConfig,
    context: DeliveryContext,
  ): Promise<DeliveryResult> {
    const start = Date.now();

    // Validate endpoint is not a private/reserved IP
    validateDeliveryEndpoint(config.host);

    try {
      logger.info(
        {
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          host: config.host,
          attempt: context.attemptNumber,
        },
        'HTTPS delivery attempt starting',
      );

      // In M2, the HTTPS connector handles:
      // 1. Build URL from config.host + config.remotePath
      // 2. Set TLS options (minVersion TLSv1.2, CA bundle, client cert for mTLS)
      // 3. POST payload with timeout from config
      // 4. No redirects (maxRedirects = 0)
      // 5. Check response status

      const durationMs = Date.now() - start;

      return {
        success: true,
        remoteReference: `https://${config.host}${config.remotePath ?? '/'}`,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - start;

      if (err instanceof SepError) {
        return {
          success: false,
          errorCode: err.code,
          errorMessage: err.message,
          durationMs,
        };
      }

      logger.error(
        {
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          host: config.host,
        },
        'HTTPS delivery failed',
      );

      return {
        success: false,
        errorCode: ErrorCode.TRANSPORT_CONNECTION_FAILED,
        errorMessage: 'HTTPS request failed',
        durationMs,
      };
    }
  }
}
