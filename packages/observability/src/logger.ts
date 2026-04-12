import pino, { type Logger, type LoggerOptions } from 'pino';
import { REDACTED_PATHS, REDACTION_CENSOR } from './redaction';

export interface LoggerContext {
  service: string;
  module?: string;
  tenantId?: string;
  correlationId?: string;
}

let _appLogLevel: string = 'info';

export function setLogLevel(level: string): void {
  _appLogLevel = level;
}

function buildOptions(ctx: LoggerContext, isDev: boolean): LoggerOptions {
  const opts: LoggerOptions = {
    level: _appLogLevel,
    redact: {
      paths: REDACTED_PATHS,
      censor: REDACTION_CENSOR,
    },
    base: {
      service: ctx.service,
      module: ctx.module,
      pid: typeof process !== 'undefined' ? process.pid : undefined,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
  };

  if (isDev) {
    opts.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  }

  return opts;
}

/**
 * Create a namespaced logger for a service/module.
 * Always use this factory — never instantiate pino directly.
 *
 * @example
 * const logger = createLogger({ service: 'control-plane', module: 'submissions' });
 * logger.info({ submissionId, tenantId }, 'Submission accepted');
 */
export function createLogger(ctx: LoggerContext, isDev = false): Logger {
  const base = pino(buildOptions(ctx, isDev));
  if (ctx.tenantId !== undefined || ctx.correlationId !== undefined) {
    return base.child({
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
    });
  }
  return base;
}

/**
 * Create a child logger with additional bound context.
 * Use within request scope to bind correlationId and tenantId.
 */
export function childLogger(
  parent: Logger,
  ctx: Partial<LoggerContext> & { correlationId?: string; tenantId?: string },
): Logger {
  return parent.child(ctx);
}
