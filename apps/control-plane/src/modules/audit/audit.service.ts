import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  DatabaseService,
  Prisma,
  type PrismaClient,
  type AuditAction,
  type ActorType,
  type Role,
  type Environment,
} from '@sep/db';
import { getConfig, SepError, ErrorCode } from '@sep/common';
import { createLogger } from '@sep/observability';

const logger = createLogger({ service: 'control-plane', module: 'audit' });

export interface RecordAuditEventParams {
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

/**
 * AuditService — append-only event writer with chained SHA-256 hash.
 *
 * record() requires a Prisma transaction client (or a raw PrismaClient for
 * legacy callers without a tx). Callers inside a `database.forTenant(...)` or
 * `database.forSystemTx(...)` block pass `db` so the audit append shares the
 * caller's tx — a business-write failure rolls back the audit append, and an
 * audit-write failure rolls back the business write. M3.A2-T02 made this the
 * standard pattern; the PrismaClient branch is retained as a safety net for
 * any caller that has no surrounding tx.
 */
@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  async record(
    tx: Prisma.TransactionClient | PrismaClient,
    params: RecordAuditEventParams,
  ): Promise<void> {
    // PrismaClient has $transaction; TransactionClient does not (Prisma's
    // ITXClientDenyList omits it). Discriminate at runtime: a raw client
    // means the caller has no tx, so open a forTenant block to provide
    // both atomicity (findFirst+create as one tx) and RLS context
    // (set_config of app.current_tenant_id required by audit_events
    // tenant_insert WITH CHECK).
    if ('$transaction' in tx) {
      return this.database.forTenant(params.tenantId, (innerTx) =>
        this.appendEvent(innerTx, params),
      );
    }
    return this.appendEvent(tx, params);
  }

  private async appendEvent(
    tx: Prisma.TransactionClient,
    params: RecordAuditEventParams,
  ): Promise<void> {
    try {
      const cfg = getConfig();

      const latest = await tx.auditEvent.findFirst({
        where: { tenantId: params.tenantId },
        orderBy: { eventTime: 'desc' },
        select: { immutableHash: true },
      });

      const previousHash = latest?.immutableHash ?? null;
      // Single timestamp for both hash computation and persistence so the
      // chain can be independently verified from persisted data.
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
          metadata: params.metadata ?? Prisma.JsonNull,
        },
      });
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.error(
        { err, params: { action: params.action, tenantId: params.tenantId } },
        'CRITICAL: audit event write failed',
      );
      throw new SepError(ErrorCode.DATABASE_ERROR, {
        operation: 'audit.record',
        action: params.action,
      });
    }
  }

  async search(params: {
    tenantId: string;
    objectType?: string;
    objectId?: string;
    action?: string;
    actorId?: string;
    correlationId?: string;
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
  }): Promise<{
    data: Array<Record<string, unknown>>;
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    const eventTimeFilter: Record<string, Date> = {};
    if (params.from !== undefined) {
      eventTimeFilter['gte'] = params.from;
    }
    if (params.to !== undefined) {
      eventTimeFilter['lte'] = params.to;
    }

    const where = {
      tenantId: params.tenantId,
      ...(params.objectType !== undefined && { objectType: params.objectType }),
      ...(params.objectId !== undefined && { objectId: params.objectId }),
      ...(params.action !== undefined && { action: params.action as AuditAction }),
      ...(params.actorId !== undefined && { actorId: params.actorId }),
      ...(params.correlationId !== undefined && { correlationId: params.correlationId }),
      ...(Object.keys(eventTimeFilter).length > 0 && { eventTime: eventTimeFilter }),
    };

    return this.database.forTenant(params.tenantId, async (db) => {
      const [data, total] = await Promise.all([
        db.auditEvent.findMany({
          where,
          orderBy: { eventTime: 'desc' },
          skip: (params.page - 1) * params.pageSize,
          take: params.pageSize,
          select: {
            id: true,
            tenantId: true,
            actorType: true,
            actorId: true,
            actorRole: true,
            objectType: true,
            objectId: true,
            action: true,
            result: true,
            correlationId: true,
            eventTime: true,
            metadata: true,
            // Never return immutableHash or previousHash — internal chain integrity only
          },
        }),
        db.auditEvent.count({ where }),
      ]);

      return {
        data,
        meta: {
          page: params.page,
          pageSize: params.pageSize,
          total,
          totalPages: Math.ceil(total / params.pageSize),
        },
      };
    });
  }
}
