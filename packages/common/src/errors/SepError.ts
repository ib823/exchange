import { ErrorCode, TERMINAL_ERROR_CODES, RETRYABLE_ERROR_CODES } from './ErrorCode';

export interface SepErrorContext {
  readonly correlationId?: string;
  readonly tenantId?: string;
  readonly submissionId?: string;
  readonly keyId?: string;
  readonly profileId?: string;
  readonly attemptNo?: number;
  readonly [key: string]: unknown;
}

export interface SepErrorJson {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  terminal: boolean;
  correlationId?: string;
  context?: Record<string, unknown>;
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

  constructor(
    code: ErrorCode,
    context: SepErrorContext = {},
    message?: string,
  ) {
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
      [ErrorCode.CRYPTO_KEY_EXPIRED]: 'The cryptographic key referenced by this profile has expired',
      [ErrorCode.CRYPTO_VERIFICATION_FAILED]: 'Signature verification failed — payload may be tampered',
      [ErrorCode.CRYPTO_UNSUPPORTED_ALGORITHM]: 'Algorithm is not permitted by the platform policy',
      [ErrorCode.TRANSPORT_CONNECTION_FAILED]: 'Could not establish connection to partner endpoint',
      [ErrorCode.TRANSPORT_HOST_KEY_MISMATCH]: 'Partner host key does not match expected fingerprint',
      [ErrorCode.TENANT_BOUNDARY_VIOLATION]: 'Resource does not belong to the requesting tenant',
      [ErrorCode.APPROVAL_REQUIRED]: 'This action requires dual-control approval before proceeding',
      [ErrorCode.APPROVAL_SELF_APPROVAL_FORBIDDEN]: 'Initiator and approver must be different users',
      [ErrorCode.VALIDATION_DUPLICATE]: 'A submission with this idempotency key has already been processed',
      [ErrorCode.REPLAY_NONCE_REUSED]: 'Request nonce has already been used — replay attack rejected',
      [ErrorCode.POLICY_ENVIRONMENT_MISMATCH]: 'Test profile cannot be used against production endpoints',
    };
    return messages[code] ?? `Platform error: ${code}`;
  }
}

/** Type guard */
export function isSepError(err: unknown): err is SepError {
  return err instanceof SepError;
}
