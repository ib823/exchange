import {
  type ExceptionFilter, Catch, type ArgumentsHost,
  HttpException, HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isSepError } from '@sep/common';
import { createLogger } from '@sep/observability';
import { randomUUID } from 'crypto';

const logger = createLogger({ service: 'control-plane', module: 'exception-filter' });

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const correlationId = (request.headers['x-correlation-id'] as string | undefined) ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let retryable = false;
    let terminal = false;

    if (isSepError(exception)) {
      const clientJson = exception.toClientJson();
      status = this.sepErrorToHttpStatus(exception.code);
      code = clientJson.code;
      message = clientJson.message;
      retryable = clientJson.retryable;
      terminal = clientJson.terminal;
      // Log full context internally — never sent to client
      logger.error({ ...exception.toLogJson(), correlationId }, 'SepError');
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      message = typeof resp === 'string' ? resp : ((resp as Record<string, unknown>)['message'] as string | undefined) ?? message;
      logger.warn({ status, message, correlationId }, 'HttpException');
    } else {
      logger.error({ correlationId, err: exception }, 'Unhandled exception');
    }

    void reply.status(status).send({
      error: { code, message, retryable, terminal, correlationId },
    });
  }

  private sepErrorToHttpStatus(code: string): number {
    if (code.startsWith('RBAC_') || code === 'TENANT_BOUNDARY_VIOLATION' || code === 'APPROVAL_SELF_APPROVAL_FORBIDDEN') {return 403;}
    if (code.includes('NOT_FOUND') || code === 'SUBMISSION_NOT_FOUND') {return 404;}
    if (code === 'VALIDATION_DUPLICATE') {return 409;}
    if (code === 'AUTH_TOKEN_INVALID' || code === 'AUTH_TOKEN_EXPIRED' || code === 'AUTH_API_KEY_INVALID') {return 401;}
    if (code === 'APPROVAL_REQUIRED') {return 202;}
    if (code.startsWith('VALIDATION_') || code.startsWith('POLICY_')) {return 422;}
    return 500;
  }
}
