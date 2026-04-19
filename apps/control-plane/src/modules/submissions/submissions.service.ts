import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService, Prisma, type SubmissionStatus } from '@sep/db';
import {
  SepError,
  ErrorCode,
  TERMINAL_SUBMISSION_STATUSES,
  type SubmissionStatus as CommonSubmissionStatus,
} from '@sep/common';
import { AuditService } from '../audit/audit.service';
import type { CreateSubmissionDto } from '@sep/schemas';
import type { TokenPayload } from '../auth/auth.service';

interface SubmissionRow {
  id: string;
  tenantId: string;
  sourceSystemId: string | null;
  exchangeProfileId: string | null;
  partnerProfileId: string;
  direction: string;
  correlationId: string;
  idempotencyKey: string;
  contentType: string;
  payloadRef: string | null;
  normalizedHash: string | null;
  payloadSize: number | null;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly audit: AuditService,
    private readonly database: DatabaseService,
  ) {}

  private async assertTenantOwnership(
    db: Prisma.TransactionClient,
    id: string,
    tenantId: string,
  ): Promise<SubmissionRow> {
    const submission = await db.submission.findUnique({ where: { id } });
    if (submission === null || submission.tenantId !== tenantId) {
      throw new NotFoundException('Submission not found');
    }
    return submission;
  }

  async create(
    dto: CreateSubmissionDto,
    actor: TokenPayload,
  ): Promise<{
    submissionId: string;
    correlationId: string;
    status: string;
  }> {
    return this.database.forTenant(dto.tenantId, async (db) => {
      // Check idempotency key uniqueness within tenant
      const existing = await db.submission.findUnique({
        where: {
          tenantId_idempotencyKey: {
            tenantId: dto.tenantId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
      });

      if (existing !== null) {
        throw new SepError(ErrorCode.VALIDATION_DUPLICATE, {
          message: 'Submission with this idempotency key already exists',
          existingSubmissionId: existing.id,
          idempotencyKey: dto.idempotencyKey,
        });
      }

      const correlationId = randomUUID();

      const submission = await db.submission.create({
        data: {
          tenantId: dto.tenantId,
          partnerProfileId: dto.partnerProfileId,
          sourceSystemId: dto.sourceSystemId ?? null,
          exchangeProfileId: dto.exchangeProfileId ?? null,
          contentType: dto.contentType,
          idempotencyKey: dto.idempotencyKey,
          correlationId,
          payloadRef: dto.payloadRef ?? null,
          normalizedHash: dto.normalizedHash ?? null,
          payloadSize: dto.payloadSize ?? null,
          status: 'RECEIVED',
          metadata:
            dto.metadata !== undefined ? (dto.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });

      await this.audit.record(db, {
        tenantId: dto.tenantId,
        actorType: 'USER',
        actorId: actor.userId,
        objectType: 'Submission',
        objectId: submission.id,
        action: 'SUBMISSION_RECEIVED',
        result: 'SUCCESS',
        correlationId,
      });

      return {
        submissionId: submission.id,
        correlationId: submission.correlationId,
        status: submission.status,
      };
    });
  }

  async findById(id: string, actor: TokenPayload): Promise<SubmissionRow> {
    return this.database.forTenant(actor.tenantId, (db) =>
      this.assertTenantOwnership(db, id, actor.tenantId),
    );
  }

  async findAll(
    actor: TokenPayload,
    page: number,
    pageSize: number,
    filters: {
      status: string | undefined;
      partnerProfileId: string | undefined;
      from: string | undefined;
      to: string | undefined;
    },
  ): Promise<{
    data: SubmissionRow[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    return this.database.forTenant(actor.tenantId, async (db) => {
      const createdAtFilter: Record<string, Date> = {};
      if (filters.from !== undefined) {
        createdAtFilter['gte'] = new Date(filters.from);
      }
      if (filters.to !== undefined) {
        createdAtFilter['lte'] = new Date(filters.to);
      }

      const where: Prisma.SubmissionWhereInput = {
        tenantId: actor.tenantId,
      };
      if (filters.status !== undefined) {
        where.status = filters.status as SubmissionStatus;
      }
      if (filters.partnerProfileId !== undefined) {
        where.partnerProfileId = filters.partnerProfileId;
      }
      if (Object.keys(createdAtFilter).length > 0) {
        where.createdAt = createdAtFilter;
      }

      const [data, total] = await Promise.all([
        db.submission.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: 'desc' },
        }),
        db.submission.count({ where }),
      ]);

      return {
        data,
        meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async getTimeline(
    id: string,
    actor: TokenPayload,
  ): Promise<{
    data: Array<Record<string, unknown>>;
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    // Ownership check runs in its own forTenant block. The subsequent
    // audit.search call manages its own forTenant, so we don't need to
    // hold the ownership tx open across the search query.
    await this.database.forTenant(actor.tenantId, (db) =>
      this.assertTenantOwnership(db, id, actor.tenantId),
    );

    const events = await this.audit.search({
      tenantId: actor.tenantId,
      objectType: 'Submission',
      objectId: id,
      page: 1,
      pageSize: 100,
    });

    return events;
  }

  async cancel(id: string, actor: TokenPayload): Promise<SubmissionRow> {
    return this.database.forTenant(actor.tenantId, async (db) => {
      const submission = await this.assertTenantOwnership(db, id, actor.tenantId);

      if (TERMINAL_SUBMISSION_STATUSES.has(submission.status as CommonSubmissionStatus)) {
        throw new SepError(ErrorCode.SUBMISSION_TERMINAL_STATE, {
          message: 'Cannot cancel a submission in a terminal state',
          currentStatus: submission.status,
          submissionId: id,
        });
      }

      const updated = await db.submission.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });

      await this.audit.record(db, {
        tenantId: actor.tenantId,
        actorType: 'USER',
        actorId: actor.userId,
        objectType: 'Submission',
        objectId: id,
        action: 'SUBMISSION_CANCELLED',
        result: 'SUCCESS',
        correlationId: submission.correlationId,
      });

      return updated;
    });
  }
}
