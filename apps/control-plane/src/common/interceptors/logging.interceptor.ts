import { Injectable, type NestInterceptor, type ExecutionContext, type CallHandler } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { createLogger } from '@sep/observability';
import { randomUUID } from 'crypto';
import type { FastifyRequest } from 'fastify';

const logger = createLogger({ service: 'control-plane', module: 'http' });

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const correlationId = (req.headers['x-correlation-id'] as string | undefined) ?? randomUUID();
    const startMs = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          logger.info(
            { method: req.method, url: req.url, correlationId, durationMs: Date.now() - startMs },
            'Request completed',
          );
        },
        error: (err: unknown) => {
          logger.warn(
            { method: req.method, url: req.url, correlationId, durationMs: Date.now() - startMs, err },
            'Request failed',
          );
        },
      }),
    );
  }
}
