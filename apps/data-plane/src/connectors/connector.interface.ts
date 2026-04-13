/**
 * Transport connector interface.
 *
 * All connectors implement this interface. The ConnectorFactory selects
 * the correct implementation based on the partner profile's transportProtocol.
 */

export interface DeliveryContext {
  tenantId: string;
  submissionId: string;
  correlationId: string;
  partnerProfileId: string;
  attemptNumber: number;
}

export interface ConnectorConfig {
  host: string;
  port?: number | undefined;
  username?: string | undefined;
  remotePath?: string | undefined;
  hostKeyFingerprint?: string | undefined;
  clientCertRef?: string | undefined;
  caBundleRef?: string | undefined;
  apiKeyRef?: string | undefined;
  timeoutMs?: number | undefined;
}

export interface DeliveryResult {
  success: boolean;
  remoteReference?: string;
  errorCode?: string;
  errorMessage?: string;
  durationMs: number;
}

export interface ITransportConnector {
  deliver(
    payloadRef: string,
    config: ConnectorConfig,
    context: DeliveryContext,
  ): Promise<DeliveryResult>;
}
