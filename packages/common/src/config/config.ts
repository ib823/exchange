import { z } from 'zod';

// ── Schema ────────────────────────────────────────────────────────────────────
const ConfigSchema = z.object({
  app: z.object({
    nodeEnv: z.enum(['development', 'test', 'production', 'ci']).default('development'),
    appEnv: z.enum(['local', 'dev', 'ci', 'test', 'staging', 'production']).default('dev'),
    logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  }),

  controlPlane: z.object({
    port: z.coerce.number().int().min(1024).max(65535).default(3000),
    host: z.string().default('0.0.0.0'),
    apiPrefix: z.string().default('api'),
  }),

  dataPlane: z.object({
    port: z.coerce.number().int().min(1024).max(65535).default(3001),
    host: z.string().default('0.0.0.0'),
  }),

  database: z.object({
    url: z.string().url(),
    poolMin: z.coerce.number().int().min(1).default(2),
    poolMax: z.coerce.number().int().min(1).default(10),
    connectionTimeoutMs: z.coerce.number().int().positive().default(5000),
  }),

  redis: z.object({
    url: z.string(),
    keyPrefix: z.string().default('sep:'),
    queue: z.object({
      defaultMaxAttempts: z.coerce.number().int().min(1).default(3),
      defaultBackoffDelayMs: z.coerce.number().int().positive().default(5000),
      deadLetterTtlMs: z.coerce.number().int().positive().default(604_800_000),
    }),
  }),

  storage: z.object({
    endpoint: z.string().url(),
    accessKey: z.string().min(1),
    secretKey: z.string().min(1),
    region: z.string().default('ap-southeast-1'),
    bucketPayloads: z.string().min(1),
    bucketAuditExports: z.string().min(1),
    forcePathStyle: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .default('true'),
    maxPayloadSizeBytes: z.coerce.number().int().positive().default(52_428_800),
    // M3.0 §10.3: schema-only field (no enforcement yet). When true, the
    // tenant's payload and audit-export buckets MUST be pinned to MY region.
    // Wiring happens in M3 once RLS and tenant-scoped config resolution land.
    myResidency: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .default('false'),
  }),

  vault: z.object({
    addr: z.string().url(),
    token: z.string().min(1),
    kvMount: z.string().default('secret'),
    transitMount: z.string().default('transit'),
    namespace: z.string().default('sep/'),
  }),

  auth: z.object({
    jwtSecret: z.string().min(32, 'JWT secret must be at least 32 characters'),
    jwtExpiry: z.string().default('15m'),
    jwtIssuer: z.string().default('sep-control-plane'),
    refreshTokenSecret: z.string().min(32),
    refreshTokenExpiry: z.string().default('7d'),
    apiKeyPrefix: z.string().default('sep_'),
    apiKeyHashRounds: z.coerce.number().int().min(10).max(14).default(12),
  }),

  internalAuth: z.object({
    serviceToken: z.string().min(32, 'Internal service token must be at least 32 characters'),
  }),

  crypto: z.object({
    defaultAlgorithm: z.string().default('rsa'),
    defaultKeySize: z.coerce.number().int().default(4096),
    defaultHash: z.string().default('sha256'),
    defaultCompression: z.string().default('zlib'),
    defaultOutputFormat: z.enum(['armored', 'binary']).default('armored'),
    keyExpiryAlertDays: z.coerce.number().int().positive().default(30),
    keyExpiryCriticalDays: z.coerce.number().int().positive().default(7),
    keyRotationOverlapDays: z.coerce.number().int().positive().default(7),
  }),

  rateLimit: z.object({
    ttlMs: z.coerce.number().int().positive().default(60_000),
    maxPerWindow: z.coerce.number().int().positive().default(100),
    submissionMax: z.coerce.number().int().positive().default(50),
  }),

  webhook: z.object({
    signingSecret: z.string().min(32),
    timeoutMs: z.coerce.number().int().positive().default(10_000),
    maxRetries: z.coerce.number().int().min(0).default(3),
    retryDelayMs: z.coerce.number().int().positive().default(5_000),
  }),

  audit: z.object({
    hashSecret: z.string().min(32),
    retentionDays: z.coerce.number().int().positive().default(2_555),
  }),

  sftp: z.object({
    connectTimeoutMs: z.coerce.number().int().positive().default(30_000),
    operationTimeoutMs: z.coerce.number().int().positive().default(60_000),
    maxRetryAttempts: z.coerce.number().int().min(0).default(3),
    retryDelayMs: z.coerce.number().int().positive().default(10_000),
  }),

  https: z.object({
    requestTimeoutMs: z.coerce.number().int().positive().default(30_000),
    maxRedirects: z.coerce.number().int().min(0).default(0),
  }),

  features: z.object({
    dualControlEnabled: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .default('true'),
    webhookEnabled: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .default('true'),
    auditExportEnabled: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .default('true'),
    keyRotationEnabled: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .default('true'),
    malwareScanEnabled: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .default('false'),
  }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

// ── Loader — the ONLY place process.env is accessed ───────────────────────────
function loadConfig(): AppConfig {
  const raw = {
    app: {
      nodeEnv: process.env['NODE_ENV'],
      appEnv: process.env['APP_ENV'],
      logLevel: process.env['LOG_LEVEL'],
    },
    controlPlane: {
      port: process.env['CONTROL_PLANE_PORT'],
      host: process.env['CONTROL_PLANE_HOST'],
      apiPrefix: process.env['CONTROL_PLANE_API_PREFIX'],
    },
    dataPlane: {
      port: process.env['DATA_PLANE_PORT'],
      host: process.env['DATA_PLANE_HOST'],
    },
    database: {
      url: process.env['DATABASE_URL'],
      poolMin: process.env['DATABASE_POOL_MIN'],
      poolMax: process.env['DATABASE_POOL_MAX'],
      connectionTimeoutMs: process.env['DATABASE_CONNECTION_TIMEOUT_MS'],
    },
    redis: {
      url: process.env['REDIS_URL'],
      keyPrefix: process.env['REDIS_KEY_PREFIX'],
      queue: {
        defaultMaxAttempts: process.env['QUEUE_DEFAULT_MAX_ATTEMPTS'],
        defaultBackoffDelayMs: process.env['QUEUE_DEFAULT_BACKOFF_DELAY_MS'],
        deadLetterTtlMs: process.env['QUEUE_DEAD_LETTER_TTL_MS'],
      },
    },
    storage: {
      endpoint: process.env['STORAGE_ENDPOINT'],
      accessKey: process.env['STORAGE_ACCESS_KEY'],
      secretKey: process.env['STORAGE_SECRET_KEY'],
      region: process.env['STORAGE_REGION'],
      bucketPayloads: process.env['STORAGE_BUCKET_PAYLOADS'],
      bucketAuditExports: process.env['STORAGE_BUCKET_AUDIT_EXPORTS'],
      forcePathStyle: process.env['STORAGE_FORCE_PATH_STYLE'],
      maxPayloadSizeBytes: process.env['MAX_PAYLOAD_SIZE_BYTES'],
      myResidency: process.env['STORAGE_MY_RESIDENCY'],
    },
    vault: {
      addr: process.env['VAULT_ADDR'],
      token: process.env['VAULT_TOKEN'],
      kvMount: process.env['VAULT_KV_MOUNT'],
      transitMount: process.env['VAULT_TRANSIT_MOUNT'],
      namespace: process.env['VAULT_NAMESPACE'],
    },
    auth: {
      jwtSecret: process.env['JWT_SECRET'],
      jwtExpiry: process.env['JWT_EXPIRY'],
      jwtIssuer: process.env['JWT_ISSUER'],
      refreshTokenSecret: process.env['REFRESH_TOKEN_SECRET'],
      refreshTokenExpiry: process.env['REFRESH_TOKEN_EXPIRY'],
      apiKeyPrefix: process.env['API_KEY_PREFIX'],
      apiKeyHashRounds: process.env['API_KEY_HASH_ROUNDS'],
    },
    internalAuth: {
      serviceToken: process.env['INTERNAL_SERVICE_TOKEN'],
    },
    crypto: {
      defaultAlgorithm: process.env['CRYPTO_DEFAULT_ALGORITHM'],
      defaultKeySize: process.env['CRYPTO_DEFAULT_KEY_SIZE'],
      defaultHash: process.env['CRYPTO_DEFAULT_HASH'],
      defaultCompression: process.env['CRYPTO_DEFAULT_COMPRESSION'],
      defaultOutputFormat: process.env['CRYPTO_DEFAULT_OUTPUT_FORMAT'],
      keyExpiryAlertDays: process.env['KEY_EXPIRY_ALERT_DAYS'],
      keyExpiryCriticalDays: process.env['KEY_EXPIRY_CRITICAL_DAYS'],
      keyRotationOverlapDays: process.env['KEY_ROTATION_OVERLAP_DAYS'],
    },
    rateLimit: {
      ttlMs: process.env['RATE_LIMIT_TTL_MS'],
      maxPerWindow: process.env['RATE_LIMIT_MAX_PER_WINDOW'],
      submissionMax: process.env['RATE_LIMIT_SUBMISSION_MAX'],
    },
    webhook: {
      signingSecret: process.env['WEBHOOK_SIGNING_SECRET'],
      timeoutMs: process.env['WEBHOOK_TIMEOUT_MS'],
      maxRetries: process.env['WEBHOOK_MAX_RETRIES'],
      retryDelayMs: process.env['WEBHOOK_RETRY_DELAY_MS'],
    },
    audit: {
      hashSecret: process.env['AUDIT_HASH_SECRET'],
      retentionDays: process.env['AUDIT_RETENTION_DAYS'],
    },
    sftp: {
      connectTimeoutMs: process.env['SFTP_CONNECT_TIMEOUT_MS'],
      operationTimeoutMs: process.env['SFTP_OPERATION_TIMEOUT_MS'],
      maxRetryAttempts: process.env['SFTP_MAX_RETRY_ATTEMPTS'],
      retryDelayMs: process.env['SFTP_RETRY_DELAY_MS'],
    },
    https: {
      requestTimeoutMs: process.env['HTTPS_REQUEST_TIMEOUT_MS'],
      maxRedirects: process.env['HTTPS_MAX_REDIRECT'],
    },
    features: {
      dualControlEnabled: process.env['FEATURE_DUAL_CONTROL_ENABLED'],
      webhookEnabled: process.env['FEATURE_WEBHOOK_ENABLED'],
      auditExportEnabled: process.env['FEATURE_AUDIT_EXPORT_ENABLED'],
      keyRotationEnabled: process.env['FEATURE_KEY_ROTATION_ENABLED'],
      malwareScanEnabled:
        process.env['MALWARE_SCAN_ENABLED'] ??
        process.env['FEATURE_MALWARE_SCAN_ENABLED'] ??
        'false',
    },
  };

  const result = ConfigSchema.safeParse(raw);

  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${formatted}`);
  }

  return result.data;
}

// Singleton — validated once at module load time
let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (_config === null) {
    _config = loadConfig();
  }
  return _config;
}

/** Reset for testing only */
export function _resetConfigForTest(): void {
  _config = null;
}

export const config = new Proxy({} as AppConfig, {
  get(_target, prop: string): AppConfig[keyof AppConfig] {
    return getConfig()[prop as keyof AppConfig];
  },
});
