/**
 * Pino redaction configuration.
 * All paths listed here will be replaced with [REDACTED] in log output.
 *
 * Rules:
 * - Never log private key material
 * - Never log plaintext payload content
 * - Never log bearer tokens, API keys, or passwords
 * - Never log PII beyond what audit explicitly requires
 *
 * Add paths conservatively — it is better to over-redact than under-redact.
 */

export const REDACTED_PATHS: string[] = [
  // Key material — absolute prohibition
  'privateKey',
  'private_key',
  'privateKeyArmored',
  'privateKeyPem',
  'keyMaterial',
  'secretKey',
  'secret_key',
  'signingKey',
  'decryptionKey',
  'passphrase',
  'keyPassphrase',

  // Auth tokens and credentials
  'password',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'apiKey',
  'api_key',
  'authorization',
  'Authorization',
  'bearerToken',
  'serviceToken',
  'vaultToken',
  'VAULT_TOKEN',

  // Payload content — never in logs
  'payload',
  'payloadContent',
  'fileContent',
  'rawContent',
  'decryptedContent',
  'plaintextPayload',

  // SFTP / transport credentials
  'sftpPassword',
  'sftpPrivateKey',
  'clientCert',
  'clientKey',
  'tlsKey',
  'mtlsKey',

  // Webhook secrets
  'webhookSecret',
  'signingSecret',
  'hmacSecret',

  // Nested paths — handle common object shapes
  '*.privateKey',
  '*.passphrase',
  '*.password',
  '*.token',
  '*.apiKey',
  '*.secret',
  '*.secretKey',
  '*.keyMaterial',
  '*.payload',
  '*.authorization',

  // HTTP request/response headers
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'req.headers["x-vault-token"]',
  'req.headers["x-vault-namespace"]',
  'res.headers["set-cookie"]',

  // Vault auth material — the undici Vault client puts the root/
  // AppRole token in X-Vault-Token and optionally a namespace in
  // X-Vault-Namespace. Both must never appear in log output.
  '*.headers.authorization',
  '*.headers["x-vault-token"]',
  '*.headers["x-vault-namespace"]',
  'headers.authorization',
  'headers["x-vault-token"]',
  'headers["x-vault-namespace"]',

  // Error context that might carry sensitive data
  'err.context.passphrase',
  'err.context.privateKey',
  'err.context.payload',
  'error.context.passphrase',
  'error.context.privateKey',
];

/** Replacement string — clearly identifiable in logs */
export const REDACTION_CENSOR = '[REDACTED]';

/** Verify a field name is in the redaction list (for test assertions) */
export function isRedactedField(fieldName: string): boolean {
  return REDACTED_PATHS.some((path) => {
    if (path.startsWith('*.')) {
      return fieldName === path.slice(2);
    }
    return fieldName === path;
  });
}
