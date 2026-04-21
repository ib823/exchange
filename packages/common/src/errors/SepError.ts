import { ErrorCode, TERMINAL_ERROR_CODES, RETRYABLE_ERROR_CODES } from './ErrorCode';

export interface SepErrorContext {
  readonly correlationId?: string;
  readonly tenantId?: string;
  readonly submissionId?: string;
  readonly keyId?: string;
  readonly profileId?: string;
  readonly attemptNo?: number;
  readonly reason?: string;
  readonly message?: string;
  readonly currentStatus?: string;
  readonly targetStatus?: string;
  readonly currentState?: string;
  readonly targetState?: string;
  readonly allowedTransitions?: string[];
  readonly allowedStates?: string[];
  readonly existingSubmissionId?: string;
  readonly idempotencyKey?: string;
  readonly operation?: string;
  readonly action?: string;
  readonly expiresAt?: string;
  readonly lockedUntil?: string;
  readonly initiatorId?: string;
  readonly actorId?: string;
  readonly approverId?: string;
  readonly objectType?: string;
  readonly objectId?: string;
  readonly requiredRole?: string;
  readonly actualRole?: string;
  readonly method?: string;
  readonly path?: string;
  readonly resourceType?: string;
  readonly requestedTenantId?: string;
  readonly environment?: string;
  readonly keyEnvironment?: string;
  readonly keyState?: string;
  readonly keyUsage?: string;
  readonly usage?: string;
  readonly expectedUsage?: string;
  readonly actualUsage?: readonly string[];
  readonly algorithm?: string;
  readonly allowedAlgorithms?: string[];
  readonly cipher?: string;
  readonly allowedCiphers?: string[];
  readonly hash?: string;
  readonly allowedHashes?: string[];
  readonly bits?: number;
  readonly minimumBits?: number;
  readonly revoked?: boolean;
  readonly currentSeverity?: string;
  readonly requestedSeverity?: string;
  readonly resolvedStates?: string[];
  readonly severity?: string;
  readonly state?: string;
  readonly newSeverity?: string;
  readonly keyReferenceId?: string;
  readonly recipientKeyReferenceId?: string;
  readonly signingKeyReferenceId?: string;
  readonly decryptionKeyReferenceId?: string;
  readonly senderKeyReferenceId?: string;
  readonly requiredState?: string;
  readonly revokedAt?: string;
  readonly submissionEnvironment?: string;
  readonly violatedRule?: string;
  readonly intendedUsage?: string;
  readonly allowedUsages?: string[];
  readonly expiredAt?: string;
  readonly provided?: string;
  readonly allowed?: string[];
  readonly keySize?: number;
  readonly minRequired?: number;
  readonly fromState?: string;
  readonly toState?: string;
  readonly fromSeverity?: string;
  readonly toSeverity?: string;
  readonly field?: string;
  readonly issues?: ReadonlyArray<{ path: string; message: string }>;
  readonly backendType?: string;
  readonly transportProtocol?: string;
}

export interface SepErrorJson {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  terminal: boolean;
  correlationId?: string;
  context?: SepErrorContext;
}

/**
 * Structured platform error. All platform errors must extend or instantiate this class.
 *
 * Rules:
 * - Never expose internal context to API clients (use toClientJson())
 * - Never include key material, payloads, or secrets in context
 * - correlationId must always be set for errors in request scope
 */
export class SepError extends Error {
  public readonly code: ErrorCode;
  public readonly retryable: boolean;
  public readonly terminal: boolean;
  public readonly context: SepErrorContext;
  public readonly timestamp: Date;

  constructor(code: ErrorCode, context: SepErrorContext = {}, message?: string) {
    super(message ?? SepError.defaultMessage(code));
    this.name = 'SepError';
    this.code = code;
    this.context = Object.freeze({ ...context });
    this.terminal = TERMINAL_ERROR_CODES.has(code);
    this.retryable = !this.terminal && RETRYABLE_ERROR_CODES.has(code);
    this.timestamp = new Date();

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Safe representation for API client responses — no internal details */
  toClientJson(): SepErrorJson {
    const json: SepErrorJson = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      terminal: this.terminal,
    };
    if (typeof this.context.correlationId === 'string') {
      json.correlationId = this.context.correlationId;
    }
    return json;
  }

  /** Full representation for internal logging — includes context */
  toLogJson(): SepErrorJson & { context: SepErrorContext; stack?: string | undefined } {
    const json: SepErrorJson & { context: SepErrorContext; stack?: string | undefined } = {
      ...this.toClientJson(),
      context: this.context,
    };
    if (this.stack !== undefined) {
      json.stack = this.stack;
    }
    return json;
  }

  static defaultMessage(code: ErrorCode): string {
    const messages: Partial<Record<ErrorCode, string>> = {
      [ErrorCode.CRYPTO_KEY_EXPIRED]:
        'The cryptographic key referenced by this profile has expired',
      [ErrorCode.CRYPTO_VERIFICATION_FAILED]:
        'Signature verification failed — payload may be tampered',
      [ErrorCode.CRYPTO_UNSUPPORTED_ALGORITHM]: 'Algorithm is not permitted by the platform policy',
      [ErrorCode.TRANSPORT_CONNECTION_FAILED]: 'Could not establish connection to partner endpoint',
      [ErrorCode.TRANSPORT_HOST_KEY_MISMATCH]:
        'Partner host key does not match expected fingerprint',
      [ErrorCode.TENANT_BOUNDARY_VIOLATION]: 'Resource does not belong to the requesting tenant',
      [ErrorCode.TENANT_CONTEXT_MISSING]:
        'Tenant context is required for this database operation but was not provided',
      [ErrorCode.TENANT_CONTEXT_INVALID]: 'Tenant context value is not a valid tenant identifier',
      [ErrorCode.APPROVAL_REQUIRED]: 'This action requires dual-control approval before proceeding',
      [ErrorCode.APPROVAL_SELF_APPROVAL_FORBIDDEN]:
        'Initiator and approver must be different users',
      [ErrorCode.VALIDATION_DUPLICATE]:
        'A submission with this idempotency key has already been processed',
      [ErrorCode.REPLAY_NONCE_REUSED]:
        'Request nonce has already been used — replay attack rejected',
      [ErrorCode.POLICY_ENVIRONMENT_MISMATCH]:
        'Test profile cannot be used against production endpoints',
      [ErrorCode.CRYPTO_BACKEND_NOT_IMPLEMENTED]:
        'Key custody backend is not implemented in this milestone',
      [ErrorCode.CRYPTO_BACKEND_NOT_AVAILABLE]:
        'Key custody backend is not approved for production use',
      [ErrorCode.CRYPTO_BACKEND_UNKNOWN]: 'Key reference names an unknown key custody backend type',
      [ErrorCode.CRYPTO_BACKENDS_INCOMPATIBLE]:
        'Composite key-custody operation requires both references to resolve to the same backend',
      [ErrorCode.CRYPTO_OPERATION_NOT_SUPPORTED]:
        'Key custody backend does not support this operation',
      [ErrorCode.CRYPTO_KEY_PURPOSE_MISMATCH]:
        'Key reference does not carry the usage required for this composite operation',
    };
    return messages[code] ?? `Platform error: ${code}`;
  }
}

/** Type guard */
export function isSepError(err: unknown): err is SepError {
  return err instanceof SepError;
}
