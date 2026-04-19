/**
 * Data-plane audit event writer.
 *
 * Mirrors the control-plane AuditService pattern: chained SHA-256 hash,
 * application-generated timestamps, append-only persistence.
 *
 * record() requires a Prisma transaction client (or a raw PrismaClient as a
 * safety net). Processors inside `database.forTenant(...)` pass `db` so the
 * audit append shares the parent tx — a business-write failure rolls back
 * the audit append and vice versa (M3.A2 transactional coupling).
 */

import { createHash } from 'crypto';
import {
  DatabaseService,
  type AuditAction,
  type ActorType,
  type Role,
  type Environment,
  type Prisma,
  type PrismaClient,
} from '@sep/db';
import { getConfig, SepError, ErrorCode } from '@sep/common';
import { createLogger } from '@sep/observability';

const logger = createLogger({ service: 'data-plane', module: 'audit-writer' });

export interface AuditEventParams {
  tenantId: string;
  actorType: ActorType;
  actorId: string;
  actorRole?: Role;
  objectType: string;
  objectId: string;
  action: AuditAction;
  result: 'SUCCESS' | 'FAILURE';
  correlationId?: string;
  traceId?: string;
  environment?: Environment;
  metadata?: Record<string, string | number | boolean | null>;
}

export class AuditWriterService {
  constructor(private readonly database: DatabaseService) {}

  async record(
    tx: Prisma.TransactionClient | PrismaClient,
    params: AuditEventParams,
  ): Promise<void> {
    if ('$transaction' in tx) {
      return this.database.forTenant(params.tenantId, (innerTx) =>
        this.appendEvent(innerTx, params),
      );
    }
    return this.appendEvent(tx, params);
  }

  private async appendEvent(
    tx: Prisma.TransactionClient,
    params: AuditEventParams,
  ): Promise<void> {
    try {
      const cfg = getConfig();

      const latest = await tx.auditEvent.findFirst({
        where: { tenantId: params.tenantId },
        orderBy: { eventTime: 'desc' },
        select: { immutableHash: true },
      });

      const previousHash = latest?.immutableHash ?? null;
      const eventTime = new Date();
      const hashInput = [
        params.tenantId,
        params.actorId,
        params.action,
        params.result,
        eventTime.toISOString(),
        previousHash ?? 'genesis',
        cfg.audit.hashSecret,
      ].join('|');

      const immutableHash = createHash('sha256').update(hashInput).digest('hex');

      await tx.auditEvent.create({
        data: {
          tenantId: params.tenantId,
          actorType: params.actorType,
          actorId: params.actorId,
          actorRole: params.actorRole ?? null,
          objectType: params.objectType,
          objectId: params.objectId,
          action: params.action,
          result: params.result,
          correlationId: params.correlationId ?? null,
          traceId: params.traceId ?? null,
          environment: params.environment ?? null,
          eventTime,
          immutableHash,
          previousHash,
          metadata: (params.metadata ?? null) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.error(
        { err, action: params.action, tenantId: params.tenantId },
        'CRITICAL: audit event write failed',
      );
      throw new SepError(ErrorCode.DATABASE_ERROR, {
        operation: 'audit.record',
        action: params.action,
      });
    }
  }
}
