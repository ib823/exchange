import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { DatabaseService, Prisma, type AuditAction, type ActorType, type Role, type Environment } from '@sep/db';
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

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  async record(params: RecordAuditEventParams): Promise<void> {
    try {
      const cfg = getConfig();

      // Compute chained hash for tamper-evidence
      const db = this.database.forTenant(params.tenantId);

      const latest = await db.auditEvent.findFirst({
        where: { tenantId: params.tenantId },
        orderBy: { eventTime: 'desc' },
        select: { immutableHash: true },
      });

      const previousHash = latest?.immutableHash ?? null;
      // Use a single timestamp for both hash computation and persistence
      // to guarantee the hash chain can be independently verified from persisted data
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

      await db.auditEvent.create({
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
      // Audit write failure must surface — never swallow
      logger.error({ err, params: { action: params.action, tenantId: params.tenantId } },
        'CRITICAL: audit event write failed');
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

    const db = this.database.forTenant(params.tenantId);

    const [data, total] = await Promise.all([
      db.auditEvent.findMany({
        where,
        orderBy: { eventTime: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        select: {
          id: true, tenantId: true, actorType: true, actorId: true,
          actorRole: true, objectType: true, objectId: true, action: true,
          result: true, correlationId: true, eventTime: true,
          metadata: true,
          // Never return immutableHash or previousHash — internal chain integrity only
        },
      }),
      db.auditEvent.count({ where }),
    ]);

    return {
      data,
      meta: { page: params.page, pageSize: params.pageSize, total,
        totalPages: Math.ceil(total / params.pageSize) },
    };
  }
}
