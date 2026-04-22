import {
  type ExceptionFilter,
  Catch,
  type ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isSepError, SepError, ErrorCode } from '@sep/common';
import { createLogger } from '@sep/observability';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';
import { randomUUID } from 'crypto';

const logger = createLogger({ service: 'control-plane', module: 'exception-filter' });

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let retryable = false;
    let terminal = false;

    // Normalise nestjs-zod validation errors into the platform's SepError shape
    // so clients get the same { code: VALIDATION_SCHEMA_FAILED, ... } contract
    // that manual parseBody used before §7A.
    let normalised: unknown = exception;
    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError() as ZodError;
      normalised = new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
        issues: zodError.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    if (isSepError(normalised)) {
      const clientJson = normalised.toClientJson();
      status = this.sepErrorToHttpStatus(normalised.code);
      code = clientJson.code;
      message = clientJson.message;
      retryable = clientJson.retryable;
      terminal = clientJson.terminal;
      logger.error({ ...normalised.toLogJson(), correlationId }, 'SepError');
    } else if (normalised instanceof HttpException) {
      status = normalised.getStatus();
      const resp = normalised.getResponse();
      if (typeof resp === 'string') {
        message = resp;
      } else {
        const record = resp as Record<string, unknown>;
        message = (record['message'] as string | undefined) ?? message;
        // Services sometimes wrap a SepError in an HttpException
        // (e.g. `new UnauthorizedException(sepError.toClientJson())`).
        // When that happens the response body already carries the
        // SepError contract fields; hoist them so clients don't see
        // the default INTERNAL_ERROR code with the SepError message.
        const respCode = record['code'];
        if (typeof respCode === 'string') {
          code = respCode;
        }
        const respRetryable = record['retryable'];
        if (typeof respRetryable === 'boolean') {
          retryable = respRetryable;
        }
        const respTerminal = record['terminal'];
        if (typeof respTerminal === 'boolean') {
          terminal = respTerminal;
        }
      }
      logger.warn({ status, message, code, correlationId }, 'HttpException');
    } else {
      logger.error({ correlationId, err: normalised }, 'Unhandled exception');
    }

    void reply.status(status).send({
      error: { code, message, retryable, terminal, correlationId },
    });
  }

  private sepErrorToHttpStatus(code: string): number {
    if (
      code.startsWith('RBAC_') ||
      code === 'TENANT_BOUNDARY_VIOLATION' ||
      code === 'APPROVAL_SELF_APPROVAL_FORBIDDEN'
    ) {
      return 403;
    }
    if (code.includes('NOT_FOUND') || code === 'SUBMISSION_NOT_FOUND') {
      return 404;
    }
    if (code === 'VALIDATION_DUPLICATE') {
      return 409;
    }
    if (
      code === 'AUTH_TOKEN_INVALID' ||
      code === 'AUTH_TOKEN_EXPIRED' ||
      code === 'AUTH_API_KEY_INVALID'
    ) {
      return 401;
    }
    if (code === 'APPROVAL_REQUIRED') {
      return 202;
    }
    if (code === 'RATE_LIMIT_EXCEEDED' || code === 'TENANT_QUOTA_EXCEEDED') {
      return 429;
    }
    if (code.startsWith('VALIDATION_') || code.startsWith('POLICY_')) {
      return 422;
    }
    return 500;
  }
}
