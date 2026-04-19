import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, type Prisma } from '@sep/db';
import { SepError, ErrorCode } from '@sep/common';
import { AuditService } from '../audit/audit.service';
import type { TokenPayload } from '../auth/auth.service';

interface ApprovalRow {
  id: string;
  tenantId: string;
  action: string;
  objectType: string;
  objectId: string;
  partnerProfileId: string | null;
  initiatorId: string;
  approverId: string | null;
  status: string;
  initiatedAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  notes: string | null;
  diffSnapshot: unknown;
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly audit: AuditService,
    private readonly database: DatabaseService,
  ) {}

  // Helper takes the tx client from the caller's forTenant block so it
  // does not open a nested $transaction (which would create a redundant
  // savepoint for a single-query helper).
  private async assertTenantOwnership(
    db: Prisma.TransactionClient,
    id: string,
    tenantId: string,
  ): Promise<ApprovalRow> {
    const approval = await db.approval.findUnique({ where: { id } });
    if (approval === null || approval.tenantId !== tenantId) {
      throw new NotFoundException('Approval not found');
    }
    return approval;
  }

  private assertNotExpired(approval: { expiresAt: Date; status: string }): void {
    if (approval.status === 'PENDING' && approval.expiresAt < new Date()) {
      throw new SepError(ErrorCode.APPROVAL_EXPIRED, {
        message: 'This approval has expired',
        expiresAt: approval.expiresAt.toISOString(),
      });
    }
  }

  async findPending(
    actor: TokenPayload,
    page: number,
    pageSize: number,
  ): Promise<{
    data: ApprovalRow[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    return this.database.forTenant(actor.tenantId, async (db) => {
      const where = {
        tenantId: actor.tenantId,
        status: 'PENDING' as const,
        expiresAt: { gt: new Date() },
      };

      const [data, total] = await Promise.all([
        db.approval.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { initiatedAt: 'desc' },
        }),
        db.approval.count({ where }),
      ]);

      return {
        data,
        meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async findById(id: string, actor: TokenPayload): Promise<ApprovalRow> {
    return this.database.forTenant(actor.tenantId, (db) =>
      this.assertTenantOwnership(db, id, actor.tenantId),
    );
  }

  async approve(id: string, actor: TokenPayload, notes: string | undefined): Promise<ApprovalRow> {
    return this.database.forTenant(actor.tenantId, async (db) => {
      const approval = await this.assertTenantOwnership(db, id, actor.tenantId);

      this.assertNotExpired(approval);

      if (approval.status !== 'PENDING') {
        throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
          message: `Approval is already in ${approval.status} state`,
          currentStatus: approval.status,
        });
      }

      // Self-approval prevention
      if (approval.initiatorId === actor.userId) {
        throw new SepError(ErrorCode.APPROVAL_SELF_APPROVAL_FORBIDDEN, {
          message: 'Cannot approve your own request',
          initiatorId: approval.initiatorId,
          actorId: actor.userId,
        });
      }

      const updated = await db.approval.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approverId: actor.userId,
          respondedAt: new Date(),
          notes: notes ?? null,
        },
      });

      // Audit write happens inside the outer forTenant block so a failure
      // (e.g. PR #1's audit_events REVOKE INSERT) rolls back the approval
      // update too. M3.A2 will migrate audit.record to share the parent tx
      // directly instead of opening a nested $transaction savepoint.
      await this.audit.record({
        tenantId: actor.tenantId,
        actorType: 'USER',
        actorId: actor.userId,
        objectType: 'Approval',
        objectId: id,
        action: 'APPROVAL_GRANTED',
        result: 'SUCCESS',
        metadata: { objectType: approval.objectType, objectId: approval.objectId },
      });

      return updated;
    });
  }

  async reject(id: string, actor: TokenPayload, notes: string | undefined): Promise<ApprovalRow> {
    return this.database.forTenant(actor.tenantId, async (db) => {
      const approval = await this.assertTenantOwnership(db, id, actor.tenantId);

      this.assertNotExpired(approval);

      if (approval.status !== 'PENDING') {
        throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
          message: `Approval is already in ${approval.status} state`,
          currentStatus: approval.status,
        });
      }

      const updated = await db.approval.update({
        where: { id },
        data: {
          status: 'REJECTED',
          approverId: actor.userId,
          respondedAt: new Date(),
          notes: notes ?? null,
        },
      });

      await this.audit.record({
        tenantId: actor.tenantId,
        actorType: 'USER',
        actorId: actor.userId,
        objectType: 'Approval',
        objectId: id,
        action: 'APPROVAL_REJECTED',
        result: 'SUCCESS',
        metadata: { objectType: approval.objectType, objectId: approval.objectId },
      });

      return updated;
    });
  }
}
